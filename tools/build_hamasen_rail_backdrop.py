#!/usr/bin/env python3
"""Freeze a small display-only land and skyline extract east of the Hamasen rail yard."""
from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import math
from pathlib import Path
import xml.etree.ElementTree as ET

import numpy as np
from pyproj import Transformer
from scipy import ndimage
from shapely import contains_xy, make_valid
from shapely.geometry import LineString, Polygon, box
from shapely.ops import polygonize, unary_union

from build_campus_structure import LAT0, LON0, project
from build_terrain import DEM_STEP, bilinear, load_dem


ROOT = Path(__file__).resolve().parents[1]
OSM_BBOX = '120.2761,22.6190,120.2811,22.6252'
OSM_URL = f'https://api.openstreetmap.org/api/0.6/map?bbox={OSM_BBOX}'
PARK_URL = 'https://api.openstreetmap.org/api/0.6/relation/6650289/full'
GRID = (1008, -96, 1504, 960, 16)


def parts(geometry, name):
    if geometry.geom_type == name:
        yield geometry
    else:
        for part in getattr(geometry, 'geoms', []):
            yield from parts(part, name)


def rounded(points):
    return [[round(x, 2), round(z, 2)] for x, z in points]


def height(tags):
    for key, scale in [('height', 1), ('building:levels', 3.2)]:
        try:
            metres = float(tags.get(key, '').removesuffix(' m')) * scale
            if 2 < metres < 80:
                return round(metres, 2)
        except ValueError:
            continue
    return {'warehouse': 5, 'transportation': 4, 'transporation': 4,
            'apartments': 12, 'office': 10, 'hotel': 16}.get(tags.get('building'), 7)


def map_ways(raw):
    root = ET.fromstring(raw)
    coords = {n.attrib['id']: project(float(n.attrib['lat']), float(n.attrib['lon']))
              for n in root.findall('node')}
    ways = {w.attrib['id']: ([coords[n.attrib['ref']] for n in w.findall('nd')],
                            {t.attrib['k']: t.attrib['v'] for t in w.findall('tag')})
            for w in root.findall('way')}
    return root, ways


def extract_osm(raw, park_raw):
    _, ways = map_ways(raw)
    buildings, rails, greens, water = [], [], [], []
    view = box(*GRID[:4])
    rail_view = box(994, GRID[1], GRID[2], GRID[3])
    for wid, (points, tags) in ways.items():
        if len(points) < 2 or tags.get('tunnel') == 'yes':
            continue
        if tags.get('railway') in {'rail', 'disused', 'light_rail'}:
            for segment in parts(LineString(points).intersection(rail_view), 'LineString'):
                if segment.length >= 4:
                    rails.append({'osmId': int(wid), 'kind': tags['railway'], 'points': rounded(segment.coords)})
        if len(points) < 4 or points[0] != points[-1]:
            continue
        footprint = make_valid(Polygon(points)).intersection(view)
        for polygon in parts(footprint, 'Polygon'):
            if tags.get('building') not in {None, 'roof', 'no'} and polygon.area >= 24:
                buildings.append({'osmId': int(wid), 'kind': tags['building'], 'height': height(tags),
                                  'polygon': rounded(list(polygon.exterior.coords)[:-1])})
            if tags.get('landuse') == 'grass':
                greens.append(rounded(list(polygon.exterior.coords)[:-1]))
            if tags.get('natural') == 'water':
                water.append(polygon)
    # The open railway park itself is mapped as a multipolygon, OSM relation 6650289.
    root, park_ways = map_ways(park_raw)
    park = root.find("relation[@id='6650289']")
    if park is not None:
        lines = [LineString(park_ways[m.attrib['ref']][0]) for m in park.findall('member')
                 if m.attrib.get('role') == 'outer' and m.attrib['ref'] in park_ways]
        for polygon in parts(unary_union(list(polygonize(lines))).intersection(view), 'Polygon'):
            greens.append(rounded(list(polygon.exterior.coords)[:-1]))
    return buildings, rails, greens, unary_union(water)


def ground_survey(water):
    xmin, zmin, xmax, zmax, cell = GRID
    xs, zs = np.arange(xmin, xmax + 1, cell), np.arange(zmin, zmax + 1, cell)
    x, z = np.meshgrid(xs, zs)
    k = 111320 * math.cos(math.radians(LAT0))
    transformer = Transformer.from_crs(4326, 3826, always_xy=True)
    east, north = transformer.transform(LON0 + x/k, LAT0 - z/110574)
    g, e0, n0, provision = load_dem()
    i, j = (north-n0)/DEM_STEP, (east-e0)/DEM_STEP
    nodata = np.isnan(g)
    land = ((i >= 0) & (j >= 0) & (i < g.shape[0]-1) & (j < g.shape[1]-1)
            & (bilinear(nodata.astype(float), i, j) < .5) & ~contains_xy(water, x, z))
    nearest = ndimage.distance_transform_edt(nodata, return_distances=False, return_indices=True)
    relative = bilinear(g[tuple(nearest)], i, j)
    terrain = json.loads((ROOT/'public/data/terrain/terrain.json').read_text())
    datum = terrain['zeroDatum']['twvd2001_m']
    depth = terrain['seaLevel']
    relative = relative - datum
    relative = np.where(relative < 0, relative*(-depth/datum), relative)
    heights = [round(max(float(h), depth+.1)-.055, 3) if active else None
               for h, active in zip(relative.ravel(), land.ravel())]
    return {'origin': [xmin, zmin], 'cell':cell, 'cols':len(xs), 'rows':len(zs),
            'heights':heights}, {'dataset': provision['dataset'], 'license':provision['license'],
            'archiveSha256':provision['archiveSha256'], 'datum':datum}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('osm', type=Path, help='Frozen small OSM bbox response, as XML or gzip.')
    parser.add_argument('park', type=Path, help='Full railway park OSM relation response, as XML or gzip.')
    parser.add_argument('--out', type=Path, default=ROOT/'public/data/terrain/hamasen-rail-backdrop.json')
    args = parser.parse_args()
    def read(path):
        raw = path.read_bytes()
        return gzip.decompress(raw) if path.suffix == '.gz' else raw
    raw, park_raw = read(args.osm), read(args.park)
    buildings, rails, greens, water = extract_osm(raw, park_raw)
    land, dem = ground_survey(water)
    output = {'terrain': land, 'buildings':buildings, 'rails':rails, 'greens':greens,
              'sources': {'osm': {'url':OSM_URL, 'sha256':hashlib.sha256(raw).hexdigest(),
                                  'parkUrl':PARK_URL, 'parkSha256':hashlib.sha256(park_raw).hexdigest(),
                                  'attribution':'© OpenStreetMap contributors',
                                  'license':'https://www.openstreetmap.org/copyright'}, 'dtm':dem}}
    args.out.write_text(json.dumps(output, ensure_ascii=False, separators=(',', ':'))+'\n')
    print(f'{len(buildings)} mapped buildings, {len(rails)} track segments, '
          f'{sum(h is not None for h in land["heights"])} surveyed land samples → {args.out}')


if __name__ == '__main__':
    main()
