#!/usr/bin/env python3
"""Generate the playable Hamasen street context and append its street graph.

The frozen OSM extract contains only mapped buildings, street geometry and
entrance/stop nodes. Generate context before terrain, then extend the existing
outdoor graph before applying the v12 bus patches.
"""
from __future__ import annotations

import argparse
from collections import defaultdict
import hashlib
import json
import math
from pathlib import Path
import xml.etree.ElementTree as ET

from scipy.spatial import cKDTree
from shapely import make_valid, set_precision
from shapely.geometry import LineString, Point, Polygon, box, shape
from shapely.ops import polygonize, substring, transform, unary_union
from shapely.strtree import STRtree

from build_campus_structure import project
from build_outdoor_graph import Terrain, densify
from hamasen_infill import SHOP_STREETS, fill_streets, landmark_polygons


ROOT = Path(__file__).resolve().parents[1]
WALK = ROOT/'public/data/walkthrough'
SNAPSHOT = ROOT/'data/sources/osm/osm-hamasen.json'
OVERTURE = ROOT/'data/sources/hamasen/overture-buildings.json'
FACADES = ROOT/'data/sources/hamasen/facades.json'
POIS = ROOT/'data/sources/hamasen/pois.json'
SHOPFRONTS = ROOT/'data/sources/hamasen/shopfronts.json'
INFILL = ROOT/'data/sources/hamasen/street-infill.json'
STRUCTURE = WALK/'campus-structure.json'
GRAPH = WALK/'outdoor-graph.json'
PLAY_AREA = box(190, 100, 1000, 744)
# Mountain-foot blocks, the town grid and the west side of the former station yard.
ORIGINAL_DISTRICT = Polygon([(272,188), (347,153), (540,146), (660,163), (825,203), (961,297),
                    (994,389), (994,677), (915,708), (795,735), (570,735), (385,720),
                    (323,634), (298,492), (256,410), (258,301)])
# The ferry frontage is on the east side of the pier. Include the existing
# waterfront footway and shore approach inside the southern play limit.
SOUTH_EXTENSION = Polygon([(323,634), (351,686), (356,744), (795,744), (795,735), (570,735), (385,720)])
DISTRICT = ORIGINAL_DISTRICT.union(SOUTH_EXTENSION)
INNER_PLAY = PLAY_AREA.buffer(-1.01)
SOUTH_BUILDING_CLIP = box(191.01,101.01,998.99,744)
MAIN_STREETS = {'臨海一路', '臨海二路', '鼓山一路', '濱海一路', '濱海二路'}
ARCADE_STREETS = {'臨海二路', '鼓山一路', '濱海一路', '濱海二路', '麗雄街', '鼓元街', '鼓波街'}
TEMPLE_PLAZA = 203577800
EXIT_WAYS = {310011987: 1, 303165537: 2}
STOP_WAYS = {'hamasen-orange-stop': 249154068, 'hamasen-campus-stop': 239205291}
STOP_POINTS = {'hamasen-orange-stop': 2835097772, 'hamasen-campus-stop': 2470169309}
RAIL_PARK_POINT = 11598582446
RAIL_KINDS = {'disused', 'rail', 'light_rail'}
PLATFORM_WAYS = {435657348, 1056803932, 1247688196}
# The footprint IDs replaced by the eight authored landmark models (landmarks.ts).
MODEL_WAYS = {203315651, 203577798, 310010753, 1388408941, 203342621, 205060865} | set(EXIT_WAYS) | PLATFORM_WAYS
STREET_WIDTHS = {'tertiary': 8, 'residential': 6.5, 'unclassified': 6, 'living_street': 5, 'service': 4.5,
                 'footway': 2.4, 'pedestrian': 4, 'path': 2, 'steps': 2.4, 'cycleway': 2.4}
VEHICLE_KINDS = {'tertiary', 'residential', 'unclassified', 'living_street', 'service'}
WAY_TAGS = {'building', 'building:part', 'building:levels', 'building:colour', 'building:material', 'height',
            'min_height', 'roof:shape', 'roof:colour', 'name', 'highway', 'footway', 'layer', 'tunnel', 'bridge',
            'access', 'motor_vehicle', 'motorcar', 'oneway', 'foot', 'bicycle', 'service', 'width', 'sidewalk',
            'railway', 'type', 'area', 'surface', 'landuse', 'leisure'}
POINT_IDS = {3153721082, 1166364342, 6409381015, 6409381018, 800606203, 7274325309,
             RAIL_PARK_POINT, *STOP_POINTS.values()}
EXCLUDED_ACCESS = {'private', 'no'}


def write_json(path, data, *, compact=False):
    if compact:
        text = json.dumps(data, ensure_ascii=False, separators=(',', ':'))
    else:
        text = json.dumps(data, ensure_ascii=False, indent=2)
    path.write_text(text+'\n', encoding='utf-8')


def tags(el, keep):
    return {tag.attrib['k']: tag.attrib['v'] for tag in el.iterfind('tag') if tag.attrib['k'] in keep}


def ground_kind(info):
    if info.get('leisure') == 'park':
        return 'grass'
    if info.get('area') == 'yes' and info.get('surface') in {'asphalt','concrete','concrete:plates','paving_stones'}:
        return 'paving'
    if info.get('landuse') == 'religious' and 'building' not in info:
        return 'yard'


def snapshot_from_xml(path, retrieved_at):
    raw = path.read_bytes()
    root = ET.fromstring(raw)
    bounds = root.find('bounds').attrib
    bbox = tuple(float(bounds[key]) for key in ('minlon', 'minlat', 'maxlon', 'maxlat'))
    nodes = {int(node.attrib['id']): node for node in root.iterfind('node')}
    coord = lambda el: [float(el.attrib['lat']), float(el.attrib['lon'])]
    points = {str(oid): {'ll': coord(node), 'tags': tags(node, {'name', 'railway', 'highway', 'ref', 'entrance'})}
              for oid, node in nodes.items() if oid in POINT_IDS}
    context_points = {'trees': [], 'streetLights': []}
    for oid, node in sorted(nodes.items()):
        info = tags(node, {'natural', 'highway'})
        key = 'trees' if info.get('natural') == 'tree' else 'streetLights' if info.get('highway') == 'street_lamp' else None
        if key and DISTRICT.covers(Point(project(*coord(node)))):
            context_points[key].append({'osmId': oid, 'll': coord(node)})
    ways = []
    lines = {}
    for way in root.iterfind('way'):
        oid = int(way.attrib['id'])
        info = tags(way, WAY_TAGS)
        ll = [coord(nodes[int(nd.attrib['ref'])]) for nd in way.iterfind('nd')]
        lines[oid] = ll
        if not ('building' in info or 'building:part' in info or info.get('highway') in STREET_WIDTHS
                or info.get('railway') in RAIL_KINDS or ground_kind(info)):
            continue
        ways.append({'id': oid, 'tags': info, 'll': ll})
    relations = []
    for relation in root.iterfind('relation'):
        info = tags(relation, WAY_TAGS)
        if 'building' not in info and 'building:part' not in info:
            continue
        members = [{'way': int(m.attrib['ref']), 'role': m.get('role', '')}
                   for m in relation.iterfind('member') if m.get('type') == 'way']
        if not members or any(m['way'] not in lines for m in members):
            continue
        relations.append({'id': int(relation.attrib['id']), 'tags': info,
                          'members': [{**m, 'll': lines[m['way']]} for m in members]})
    url = 'https://api.openstreetmap.org/api/0.6/map?bbox='+','.join(map(str, bbox))
    return {'source': {'url': url, 'bbox': bbox, 'retrievedAt': retrieved_at,
                       'rawSha256': hashlib.sha256(raw).hexdigest(),
                       'license': 'ODbL 1.0 © OpenStreetMap contributors',
                       'licenseUrl': 'https://www.openstreetmap.org/copyright'},
            'points': points, 'ways': sorted(ways, key=lambda w: w['id']),
            'relations': sorted(relations, key=lambda r: r['id']), 'contextPoints': context_points}


def coords(way):
    return [project(lat, lon) for lat, lon in way['ll']]


def rounded(points):
    return [[round(x, 2), round(z, 2)] for x, z in points]


def parts(shape, geometry_type):
    if shape.geom_type == geometry_type and not shape.is_empty:
        yield shape
    elif hasattr(shape, 'geoms'):
        for child in shape.geoms:
            yield from parts(child, geometry_type)


def number(tag):
    try:
        value = float(tag.rstrip(' m') if isinstance(tag, str) else tag)
        return value if math.isfinite(value) and value > 0 else None
    except (TypeError, ValueError):
        return None


def underground(info):
    return info.get('tunnel') in {'yes','building_passage'} or info.get('layer', '0').startswith('-')


def street_margin(road):
    sidewalk = road.get('sidewalk')
    return 1.35 if road['name'] in MAIN_STREETS or bool(sidewalk and sidewalk not in {'no', 'none', 'separate'}) else .42


def temple_plaza(data):
    return Polygon(rounded(coords(next(way for way in data['ways'] if way['id'] == TEMPLE_PLAZA))))


def street_reserve(roads, plaza, *, tolerance=.025):
    return unary_union([plaza.buffer(tolerance), *(
        LineString(road['points']).buffer(road['width']/2+street_margin(road), cap_style='flat', join_style='mitre')
        .buffer(tolerance, join_style='mitre')
        for road, _, _ in roads if not road['bridge'] and road['osmId'] != TEMPLE_PLAZA
    )])


def set_back(poly, reserve):
    clipped = poly.intersects(reserve)
    candidates = parts(poly.difference(reserve), 'Polygon') if clipped else [poly]
    for piece in sorted(candidates, key=lambda p: (-p.area, p.bounds)):
        if clipped:
            piece = piece.simplify(.012, preserve_topology=True)
        rounded_piece = Polygon(rounded(list(piece.exterior.coords)), [rounded(list(r.coords)) for r in piece.interiors])
        snapped = [piece] if rounded_piece.is_valid else parts(set_precision(piece, .01), 'Polygon')
        for candidate in snapped:
            if not clipped or (candidate.area >= 14 and candidate.area/candidate.length >= .85):
                yield candidate


def setback_records(records, reserve):
    for oid, info, poly, kind, index in records:
        pieces = [poly] if kind != 'overture' and oid in MODEL_WAYS else set_back(poly, reserve)
        for part_index, piece in enumerate(pieces):
            yield oid, info, piece, kind, index+10000*part_index


def playable_building(poly):
    if not DISTRICT.intersects(poly):
        return None
    if INNER_PLAY.covers(poly):
        return poly
    if SOUTH_EXTENSION.intersects(poly):
        return poly.intersection(SOUTH_BUILDING_CLIP)
    return None


def osm_buildings(data):
    """Keep full connected building rings including the inner rings of multipolygons."""
    outlines = []
    members = set()
    for relation in data.get('relations', []):
        outer = [LineString(coords(m)) for m in relation['members'] if m['role'] in {'', 'outer', 'outline'}]
        inner = [LineString(coords(m)) for m in relation['members'] if m['role'] == 'inner']
        if not outer:
            continue
        shells = list(polygonize(unary_union(outer)))
        if not shells:
            continue
        holes = unary_union(list(polygonize(unary_union(inner))))
        outlines.append((relation['id'], relation['tags'], unary_union(shells).difference(holes), 'relation'))
        members.update(m['way'] for m in relation['members'] if m['role'] in {'', 'outer', 'outline', 'inner'})
    for way in data['ways']:
        info = way['tags']
        if way['id'] in members or not ('building' in info or 'building:part' in info):
            continue
        ps = coords(way)
        if len(ps) >= 4 and ps[0] == ps[-1]:
            outlines.append((way['id'], info, make_valid(Polygon(ps)), 'way'))
    # Surface part outlines with their own footprints can close unmapped breaks. Overlapping
    # parts need a vertical model and would duplicate the parent shell in this footprint renderer.
    shell_polys = [s for _, t, s, _ in outlines if 'building' in t and not underground(t)]
    shells = STRtree(shell_polys)
    for oid, info, polygon, kind in outlines:
        if (underground(info) or info.get('building:part') == 'roof' or (number(info.get('min_height')) or 0) > .25
                or ('building' not in info and any(shell_polys[int(i)].covers(polygon) for i in shells.query(polygon)))):
            continue
        playable = [piece for poly in parts(polygon, 'Polygon')
                    if (clipped := playable_building(poly)) is not None
                    for piece in parts(clipped, 'Polygon')]
        for i, poly in enumerate(playable):
            if poly.area >= 3:
                yield oid, info, poly, kind, i


def frontage_edge(poly, street_tree, streets, bearing=None):
    if isinstance(bearing, str):
        bearing = {'north': 0, 'east': 90, 'south': 180, 'west': 270}.get(bearing.lower())
    facing = None if bearing is None else (math.sin(math.radians(bearing)), -math.cos(math.radians(bearing)))
    candidates = []
    for i, (a, b) in enumerate(zip(poly.exterior.coords, list(poly.exterior.coords)[1:])):
        if math.dist(a, b) < 1.5:
            continue
        middle = Point((a[0]+b[0])/2, (a[1]+b[1])/2)
        street = street_tree.nearest(middle)
        if street is None:
            continue
        road = streets[int(street)]
        distance = road.distance(middle)
        if facing:
            dx, dz = b[0]-a[0], b[1]-a[1]
            s = 1 if poly.exterior.is_ccw else -1
            facing_cost = 1-s*(dz*facing[0]-dx*facing[1])/math.hypot(dx, dz)
        else:
            facing_cost = 0
        candidates.append((facing_cost, distance, -math.dist(a,b), i))
    return min(candidates)[-1] if candidates else None


def frontage_options(model, street_tree, street_records, occupied_tree, footprints, reference=None):
    """Find usable spans with a clear outward line to a mapped street."""
    polygon = Polygon(model['polygon'], model.get('holes', []))
    ring = model['polygon']
    winding = 1 if polygon.exterior.is_ccw else -1
    for edge, (a, b) in enumerate(zip(ring, ring[1:] + ring[:1])):
        dx, dz = b[0]-a[0], b[1]-a[1]
        length = math.hypot(dx, dz)
        if length < 2.6 or min(a[1], b[1]) >= 743.99:
            continue
        tx, tz = dx/length, dz/length
        nx, nz = winding*tz, -winding*tx
        width = min(12.4 if model['id']=='hamasen-osm-310901110' and edge==2 else 6.2, length-.65)
        pad = width/2 + .30
        projection = length/2 if reference is None else (reference.x-a[0])*tx + (reference.y-a[1])*tz
        along = max(pad, min(length-pad, projection))
        for center in dict.fromkeys((along, length/2, pad, length-pad)):
            x, z = a[0]+tx*center, a[1]+tz*center
            door = Point(x, z)
            for i in sorted(street_tree.query(door.buffer(26))):
                road, line = street_records[int(i)]
                target = line.interpolate(line.project(door))
                vx, vz = target.x-x, target.y-z
                distance = math.hypot(vx, vz)
                if not .9 < distance < 26 or z+nz*.65 > 744:
                    continue
                facing = (vx*nx+vz*nz)/distance
                if facing < .56:
                    continue
                sight = LineString([(x+nx*.06, z+nz*.06), target])
                if any(footprints[int(j)].intersection(sight).length > .12 for j in occupied_tree.query(sight)):
                    continue
                score = distance + (1-facing)*8 + (reference.distance(door)*1.1 if reference is not None else 0)
                yield score, edge, center, width, (x,z), (nx,nz), road, target


def frontage_frame(model, edge):
    ring = model['polygon']
    a, b = ring[edge], ring[(edge+1) % len(ring)]
    length = math.dist(a, b)
    tx, tz = (b[0]-a[0])/length, (b[1]-a[1])/length
    winding = 1 if Polygon(ring).exterior.is_ccw else -1
    nx, nz = -winding*tz, winding*tx
    return length, lambda along, inward: (a[0]+tx*along+nx*inward, a[1]+tz*along+nz*inward)


def arcade_strip(model, edge, depth, *, start=0, far=None):
    length, at = frontage_frame(model, edge)
    return Polygon([at(0, start), at(length, start), at(length, far or depth), at(0, far or depth)])


def arcade_edges(model):
    front = model.get('frontage', {})
    return [(front[edge], front[depth]) for edge, depth in
            (('edge', 'arcadeDepth'), ('cornerEdge', 'cornerArcadeDepth')) if front.get(depth)]


def arcade_depth(model, edge, road, existing=()):
    ice_corner = model['id'] == 'hamasen-osm-310901110' and road['name'] == '延平街' and existing
    if (road['name'] not in ARCADE_STREETS and not ice_corner) or model['storeys'] < 2:
        return None
    length, at = frontage_frame(model, edge)
    if length < 3:
        return None
    footprint = Polygon(model['polygon'], model.get('holes', []))
    previous = [arcade_strip(model, e, d) for e, d in existing]
    preferred = 2.40 if road['name'] in MAIN_STREETS else 2.20
    for depth in (preferred, 2.10, 1.95, 1.80):
        end = min(1.20, length*.18)
        centre = LineString([at(end, depth*.55), at(length-end, depth*.55)])
        if not footprint.buffer(-.10).covers(centre):
            continue
        strip = arcade_strip(model, edge, depth)
        back = footprint.difference(unary_union([strip, *previous]))
        behind = arcade_strip(model, edge, depth, start=depth, far=depth+2.20)
        if back.area < footprint.area*.38 or back.intersection(behind).area < behind.area*.58:
            continue
        if max((p.area for p in parts(back, 'Polygon')), default=0) < back.area*.85:
            continue
        return depth
    return None


def style_frontage(model, options, preferred_edge=None):
    if not options:
        return
    if preferred_edge is not None:
        options = sorted(options, key=lambda option: option[1] != preferred_edge)
    _, edge, _, _, _, normal, road, _ = options[0]
    front = model['frontage'] = {'edge':edge, 'commercial':road['name'] in (MAIN_STREETS | SHOP_STREETS)}
    primary = arcade_depth(model, edge, road)
    if primary:
        front['arcadeDepth'] = primary
        front['arcadeStyle'] = 'arched' if road['name'] in {'臨海二路', '鼓山一路'} else 'flat'
    candidates = [option for option in options
                  if option[1] != edge and option[3] >= 3 and option[6]['name']
                  and option[6]['name'] != road['name']
                  and abs(sum(a*b for a,b in zip(normal,option[5]))) < .55]
    for _, side, _, _, _, _, side_road, _ in candidates:
        front.setdefault('cornerEdge', side)
        if (primary and (side-edge) % len(model['polygon']) in {1, len(model['polygon'])-1}
                and (depth := arcade_depth(model, side, side_road, [(edge, primary)]))):
            front.update(cornerEdge=side, cornerArcadeDepth=depth)
            break


def style_streets(buildings, road_segments, evidence):
    street_records = [(road, line) for road, _, line in road_segments
                      if not road['bridge'] and road['osmId'] != TEMPLE_PLAZA
                      and road['kind'] in VEHICLE_KINDS | {'pedestrian','footway','steps'}]
    street_tree = STRtree([line for _, line in street_records])
    footprints = [Polygon(b['polygon'], b.get('holes', [])) for b in buildings]
    occupied_tree = STRtree(footprints)
    for b in buildings:
        if b['facade'] not in {'residential','commercial','shophouse'}:
            continue
        record = evidence.get(str(b.get('osmId', b.get('gersId'))), {})
        seed = int.from_bytes(hashlib.sha256(b['id'].encode()).digest()[:4], 'big')
        options = sorted(frontage_options(b, street_tree, street_records, occupied_tree, footprints),
                         key=lambda option:option[0] - (5 if option[6]['name'] in ARCADE_STREETS else 0))
        prefer_known = b.get('synthetic') or 'frontageFacing' in record
        preferred = b.get('frontage', {}).get('edge') if prefer_known else None
        if b.get('synthetic'):
            on_street = [option for option in options if option[6]['name'] == b.get('street')]
            options = on_street + [option for option in options if option[6]['name'] != b.get('street')]
        if options:
            style_frontage(b, options, preferred)
        elif not prefer_known:
            b.pop('frontage', None)
        if b.pop('_inferredStoreys', False):
            if b['storeys'] == 3 and seed % 11 in (0, 1, 2, 3):
                b['storeys'] = 2 if seed % 11 < 3 else 4
            if 'heightM' not in b:
                b['heightM'] = round(b['storeys']*3.25 + (seed % 17-8)*.06, 2)
    return street_tree, street_records, occupied_tree, footprints


def ferry_roads(data, infill):
    area = Polygon(infill['ferryVisualGround'])
    for way in data['ways']:
        info = way['tags']
        if info.get('name') not in {'濱海一路','濱海二路'} or info.get('highway') not in VEHICLE_KINDS:
            continue
        line = LineString(coords(way)).intersection(area).difference(PLAY_AREA)
        for i, segment in enumerate(parts(line, 'LineString')):
            if segment.length > .2:
                yield ({'id':f'hamasen-osm-{way["id"]}-visual-{i}','kind':info['highway'],
                        'name':info['name'], 'district':'hamasen', 'visualOnly':True, 'tunnel':False,
                        'width':number(info.get('width')) or STREET_WIDTHS[info['highway']],
                        'points':rounded(segment.coords), 'bridge':False, 'osmId':way['id']}, info, segment)


EXPANDED_SHOPS = {'ferry-haizhibing':'hamasen-osm-310901110', 'yuanfu-yakiniku-rice':'hamasen-osm-588119541'}
SHOP_APPROACH = {'yuanfu-yakiniku-rice':'濱海一路88巷', 'matou-auntie-danbing':'濱海一路'}
SHOP_ADDRESS_POINT = {'ferry-haizhibing':(456.5, 743.1)}


def place_shopfronts(buildings, street_tree, street_records, occupied_tree, footprints, legacy_ids):
    pois = json.loads(POIS.read_text(encoding='utf-8'))
    aliases = {b['id'].removeprefix('hamasen-'): b['id'] for b in buildings if b['id'].startswith('hamasen-osm-')}
    by_id = {b['id']: b for b in buildings}
    results = []
    chosen = []
    for shop in pois['shops']:
        sid = shop['id']
        photo_fit = by_id.get(f'hamasen-infill-shop-{sid}')
        mapped = photo_fit['id'] if photo_fit else EXPANDED_SHOPS.get(sid) or shop['buildingId']
        primary = by_id.get(aliases.get(mapped, mapped))
        reference = Point(SHOP_ADDRESS_POINT.get(sid, (shop['x'], shop['z'])))
        address_street = shop['address'].split('鼓山區',1)[1]
        names = {r['name'] for r, _ in street_records if r['name'] and address_street.startswith(r['name'])}
        wanted = SHOP_APPROACH.get(sid) or max(names, key=len)
        uncertain = not photo_fit and (primary is None or (shop.get('buildingDistanceM') or 0) > 5)
        candidates = [primary] if primary else []
        if uncertain:
            candidates += [b for b,p in zip(buildings, footprints)
                           if b is not primary and not b.get('synthetic') and b['facade'] in {'shophouse','residential','commercial'} and p.distance(reference) < 45]
        options = []
        for b in candidates:
            for option in frontage_options(b, street_tree, street_records, occupied_tree, footprints, reference):
                _, edge, along, width, _, _, road, _ = option
                if any(other['edge'] == edge and abs(along-other['along']) < (width+other['width'])/2+.3
                       for other in b.get('shopfronts', [])):
                    continue
                # Use the documented street where its approach is physically available.
                same_street = road['name'] == wanted
                nearby_lane = road['name'] and road['name'].startswith(wanted)
                street_cost = 0 if same_street else 14 if nearby_lane else 32
                # For incomplete footprints, locate the nearest building on the
                # address street first, then choose its best unobstructed bay.
                footprint_gap = Polygon(b['polygon']).distance(reference) if uncertain else 0
                shared_front = any(s['edge'] == edge for s in b.get('shopfronts', []))
                shared_bonus = 9 if shared_front and same_street and reference.distance(Point(option[4])) < 12 else 0
                options.append(((street_cost, footprint_gap, option[0]-shared_bonus), b, option))
        if not options:
            raise ValueError(f'{sid} has no clear street-facing span')
        _, b, (_, edge, along, width, (x,z), (nx,nz), road, target) = min(options, key=lambda row:row[0])
        if sid=='ferry-haizhibing' and road['name'] != '濱海一路':
            raise ValueError('The ice shop entrance must face Binhai 1st Road')
        bay = {'id':sid,'name':shop['name'],'category':shop['category'],
               'edge':edge,'along':round(along,3),'width':round(width,3)}
        b.setdefault('shopfronts', []).append(bay)
        chosen.append((shop, b, bay, (x,z), (nx,nz), road, target, photo_fit, uncertain, wanted))

    for _, b, bay, _, _, road, _, _, _, _ in chosen:
        if bay is not b['shopfronts'][0]:
            continue
        options = list(frontage_options(b, street_tree, street_records, occupied_tree, footprints))
        preferred = max(b['shopfronts'], key=lambda row: (sum(s['edge'] == row['edge'] for s in b['shopfronts']), row['width']))
        options.sort(key=lambda option: (option[6]['name'] != road['name'], option[0]))
        style_frontage(b, options, preferred['edge'])

    for shop, b, bay, (x,z), (nx,nz), road, target, photo_fit, uncertain, wanted in chosen:
        sid, edge = bay['id'], bay['edge']
        depth = dict(arcade_edges(b)).get(edge, 0)
        offset = -depth*.55 if depth else .38
        stand = [round(x+offset*nx,3), round(z+offset*nz,3)]
        distance = math.hypot(target.x-x, target.y-z)
        sidewalk = max(.37, distance-road['width']/2-.08)/distance
        curb_approach = [round(x+(target.x-x)*sidewalk,3), round(z+(target.y-z)*sidewalk,3)]
        bay['approach'] = curb_approach
        alias = b['id'].removeprefix('hamasen-')
        actual_id = alias if alias in legacy_ids else b['id']
        results.append({'id':sid,'name':shop['name'],'buildingId':actual_id,'edge':edge,'roadId':road['id'],
                        'street':road['name'],'x':stand[0],'z':stand[1],
                        'facing':[round(nx,6),round(nz,6)],'streetPoint':rounded([target.coords[0]])[0],
                        'approach':stand,
                        'placement':'photo-approximation' if photo_fit else 'nearest-street-facing' if uncertain else 'corner-approach' if wanted != road['name'] else 'footprint'})
        shop.update(buildingId=actual_id, inDistrict=True,
                    buildingDistanceM=round(Polygon(b['polygon']).distance(Point(shop['x'], shop['z'])),2))
        shop.pop('needsDistrictExpansion', None)
    return pois, {'shops':results}


def building_model(oid, info, poly, kind, part_index, evidence, street_tree, streets):
    exit_number = EXIT_WAYS.get(oid)
    facade = evidence.get('facade') or ('station' if exit_number else 'platform' if oid in PLATFORM_WAYS else {
        'apartments':'residential', 'residential':'residential', 'commercial':'commercial', 'office':'commercial',
        'temple':'temple', 'school':'civic', 'shed':'warehouse', 'transportation':'civic', 'retail':'shophouse',
        'warehouse':'warehouse', 'industrial':'warehouse', 'train_station':'civic',
    }.get(info.get('building'), 'shophouse' if poly.area < 195 else 'residential'))
    height = number(evidence.get('heightM')) or number(info.get('height'))
    levels = number(evidence.get('storeys')) or number(info.get('building:levels'))
    if levels is None:
        levels = 1 if facade in {'station','platform','temple','warehouse'} else 3 if poly.area < 240 else 4
    tone = evidence.get('tone') or info.get('building:colour') or {
        'station':'station', 'platform':'concrete', 'warehouse':'industrial', 'shophouse':'tile',
        'commercial':'gray-blue', 'temple':'sand', 'civic':'cream', 'residential':'porcelain',
    }.get(facade, 'concrete')
    roof_shape = evidence.get('roofShape') or info.get('roof:shape', 'flat')
    roof_shape = {'gabled':'gable','hipped':'hip','skillion':'shed'}.get(roof_shape, roof_shape)
    roof_shape = roof_shape if roof_shape in {'flat','gable','hip','shed'} else 'flat'
    model_id = f'hamasen-osm-{oid}' if kind == 'way' else f'hamasen-osm-relation-{oid}' if kind == 'relation' else f'hamasen-ov-{oid}'
    model = {'id': model_id+(f'-{part_index}' if part_index else ''), 'district': 'hamasen',
             'name': info.get('name'), 'polygon': rounded(list(poly.exterior.coords)[:-1]), 'storeys': levels,
             'tone': tone, 'facade': facade, 'roofShape': roof_shape}
    if not (number(evidence.get('storeys')) or number(info.get('building:levels'))) and facade in {'residential','commercial','shophouse'}:
        model['_inferredStoreys'] = True
    if info.get('sourceRecovery'):
        model['sourceRecovery'] = True
    if poly.interiors:
        model['holes'] = [rounded(list(r.coords)[:-1]) for r in poly.interiors]
    model['osmId' if kind in {'way','relation'} else 'gersId'] = oid
    if kind == 'relation':
        model['osmType'] = kind
    roof_tone = evidence.get('roofTone') or info.get('roof:colour')
    if roof_tone:
        model['roofTone'] = roof_tone
    if exit_number:
        model.update(stationExit=exit_number, heightM=height or 4.4)
    elif height:
        model['heightM'] = height
    elif facade == 'platform':
        model['heightM'] = 4.6
    edge_index = frontage_edge(poly, street_tree, streets, evidence.get('frontageFacing'))
    if edge_index is not None:
        model['frontage'] = {'edge': edge_index}
        if depth := number(evidence.get('arcadeDepth')):
            model['frontage']['arcadeDepth'] = depth
    if evidence.get('signText'):
        model['signText'] = evidence['signText']
    return model


def overture_buildings(osm, bands, excluded):
    if not OVERTURE.exists():
        return
    existing = [record[2] for record in osm]
    tree = STRtree(existing)
    data = json.loads(OVERTURE.read_text(encoding='utf-8'))
    for feature in data['features']:
        prop = feature['properties']
        if prop['id'] in excluded:
            continue
        if prop.get('is_underground') or (prop.get('level') or 0) < 0 or (prop.get('min_height') or 0) > .25:
            continue
        osm_source = any(s.get('dataset') == 'OpenStreetMap' for s in prop.get('sources') or [])
        geom = make_valid(transform(lambda lon,lat: project(lat,lon), shape(feature['geometry'])))
        playable = [piece for poly in parts(geom, 'Polygon')
                    if (clipped := playable_building(poly)) is not None
                    for piece in parts(clipped, 'Polygon')]
        for i, poly in enumerate(playable):
            if poly.area < 7:
                continue
            overlap = sum(poly.intersection(existing[int(j)]).area for j in tree.query(poly))
            recovered = osm_source or poly.area < 10
            if overlap/poly.area > .22:
                recovered = True
                if osm_source or overlap/poly.area > .72:
                    continue
                overlaps = [existing[int(j)] for j in tree.query(poly)]
                uncovered = poly.difference(unary_union(overlaps).buffer(.10))
                candidates = [p for p in parts(uncovered,'Polygon') if p.area >= 18
                              and p.area/p.length >= 1.1 and bands.buffer(1.2).covers(p)]
            elif recovered:
                candidates = [poly] if overlap < .05 and bands.buffer(1.2).covers(poly) else []
            else:
                candidates = [poly]
            for j, piece in enumerate(candidates):
                yield prop['id'], {'building':prop.get('class') or prop.get('subtype'),
                    'building:levels':prop.get('num_floors'), 'height':prop.get('height'), 'name':prop.get('name'),
                    'building:colour':prop.get('facade_color'), 'roof:colour':prop.get('roof_color'),
                    'roof:shape':prop.get('roof_shape') or 'flat', 'sourceRecovery':recovered}, piece, 'overture', i+j*100


def ferry_background(data, infill, roads):
    area = Polygon(infill['ferryVisualGround']).difference(PLAY_AREA).buffer(-.04)
    lines = [line for _,_,line in roads]
    reserve = street_reserve(roads, temple_plaza(data))
    source = json.loads(OVERTURE.read_text(encoding='utf-8'))['features']
    picked = []
    for feature in source:
        info = feature['properties']
        if (info['id'] in infill.get('excludedOverture', {}) or info.get('is_underground')
                or (info.get('level') or 0) < 0 or (info.get('min_height') or 0) > .25):
            continue
        polygon = make_valid(transform(lambda lon,lat:project(lat,lon),shape(feature['geometry'])))
        if not area.intersects(polygon):
            continue
        for p in parts(polygon.intersection(area).difference(reserve),'Polygon'):
            if p.area < 17 or p.area/p.length < .85:
                continue
            if any(p.intersection(q).area > p.area*.12 for q in picked):
                continue
            model = building_model(info['id'], {'building:levels':info.get('num_floors')},p,'overture',0,{},STRtree(lines),lines)
            model.update(id=f'hamasen-ov-ferry-view-{info["id"]}-{len(picked)}', visualOnly=True)
            picked.append(p)
            yield model


def district(data, infill=None):
    # The bus generator imports this function and replays the current district.
    load_infill = infill is None
    if load_infill:
        infill = json.loads(INFILL.read_text())
    original, extension = [], []
    for way in data['ways']:
        oid, info, ps = way['id'], way['tags'], coords(way)
        kind = info.get('highway')
        if kind not in STREET_WIDTHS or len(ps) < 2 or underground(info):
            continue
        if info.get('oneway') == '-1':
            ps.reverse()
        line = LineString(ps)
        for output, geometry, suffix in ((original, line.intersection(ORIGINAL_DISTRICT), ''),
                                        (extension, line.intersection(SOUTH_EXTENSION).difference(ORIGINAL_DISTRICT), '-south')):
            for i, part in enumerate(parts(geometry, 'LineString')):
                if part.length < .5:
                    continue
                if line.project(Point(part.coords[0])) > line.project(Point(part.coords[-1])):
                    part = part.reverse()
                road = {'id': f'hamasen-osm-{oid}'+suffix+(f'-{i}' if i else ''), 'kind': kind, 'name': info.get('name'),
                        'width': number(info.get('width')) or STREET_WIDTHS[kind], 'points': rounded(part.coords),
                        'tunnel': False, 'bridge': info.get('bridge') == 'yes', 'osmId': oid, 'district': 'hamasen'}
                for key in ('sidewalk', 'surface'):
                    if value := info.get(key):
                        road[key] = value
                output.append((road, info, part))
    road_segments = original + extension
    if load_infill:
        context = json.loads(STRUCTURE.read_text())['context']
        return [b for b in context['background'] if b.get('district') == 'hamasen' and not b.get('visualOnly')], road_segments
    streets = [line for road, info, line in road_segments if road['kind'] in VEHICLE_KINDS or road['kind'] == 'pedestrian']
    street_tree = STRtree(streets)
    evidence = json.loads(FACADES.read_text(encoding='utf-8')).get('buildings', {}) if FACADES.exists() else {}
    osm = list(osm_buildings(data))
    reserves = street_reserve([*road_segments, *ferry_roads(data, infill)], temple_plaza(data))
    overture = overture_buildings(osm, unary_union([Polygon(p) for p in infill['frontageBands']]),
                                 infill.get('excludedOverture', {}))
    buildings = [building_model(oid, tags, poly, kind, i, evidence.get(str(oid), {}), street_tree, streets)
                 for oid, tags, poly, kind, i in setback_records([*osm, *overture], reserves)]
    return buildings, road_segments


def add_context(structure, data, buildings, road_segments, infill):
    context = structure['context']
    background = {row['id']: row for row in context['background'] if not row['id'].startswith(('hamasen-osm-', 'hamasen-ov-', 'hamasen-infill-'))}
    legacy = {row['id']: row for row in background.values() if row.get('district') == 'hamasen'}
    managed_osm = {f'osm-{oid}' for oid, _, _, kind, _ in osm_buildings(data) if kind == 'way'}
    reserves = street_reserve([*road_segments, *ferry_roads(data, infill)], temple_plaza(data))
    for old_id, old in list(background.items()):
        if not old_id.startswith('osm-') or not DISTRICT.intersects(Polygon(old['polygon'])):
            continue
        if old_id in managed_osm:
            legacy[old_id] = background.pop(old_id)
        elif old_id.split('-')[1].isdigit() and int(old_id.split('-')[1]) not in MODEL_WAYS:
            poly = Polygon(old['polygon'], old.get('holes', []))
            if poly.intersects(reserves):
                del background[old_id]
                for i, piece in enumerate(set_back(poly, reserves)):
                    id = f'{old_id}-setback-{i}' if i else old_id
                    background[id] = {**old, 'id':id, 'polygon':rounded(list(piece.exterior.coords)[:-1]),
                                      'holes':[rounded(list(ring.coords)[:-1]) for ring in piece.interiors]}
    for model in buildings:
        old_id = f'osm-{model.get("osmId")}'
        if model['id'] == f'hamasen-osm-{model.get("osmId")}' and old_id in legacy:
            original = {key:value for key,value in legacy[old_id].items()
                        if key not in {'frontage', 'holes', 'shopfronts', 'sharedWalls'}}
            background[old_id] = {**original, **model, 'id':old_id}
        else:
            background[model['id']] = model
    context['background'] = list(background.values())
    roads = [r for r in context['roads'] if not r['id'].startswith('hamasen-osm-')]
    replacement_way_ids = {f'osm-{r["osmId"]}' for r, _, _ in road_segments}
    retained = []
    for road in roads:
        if road['id'].split('-outside-')[0] not in replacement_way_ids:
            retained.append(road)
            continue
        line = LineString(road['points'])
        if not DISTRICT.intersects(line):
            retained.append(road)
            continue
        outside = list(parts(line.difference(DISTRICT), 'LineString'))
        base_id = road['id'] if '-outside-' in road['id'] else road['id']+'-outside'
        for i, line in enumerate(outside):
            if line.length > .25:
                segment_id = base_id if len(outside)==1 and '-outside-' in road['id'] else f'{base_id}-{i}'
                retained.append({**road, 'id':segment_id, 'points':rounded(line.coords)})
    # The picture continues south of the collision boundary.
    context['roads'] = [*retained, *(r for r, _, _ in road_segments), *(r for r, _, _ in ferry_roads(data,infill))]
    rails = []
    ground = []
    for way in data['ways']:
        info = way['tags']
        points = coords(way)
        if (kind := ground_kind(info)) and len(points) >= 4 and points[0] == points[-1]:
            for surface in parts(make_valid(Polygon(points)).intersection(DISTRICT), 'Polygon'):
                if surface.area > 4:
                    ground.append({'kind':kind, 'polygon':rounded(list(surface.exterior.coords)[:-1])})
        if info.get('railway') not in RAIL_KINDS or underground(info):
            continue
        for i, line in enumerate(parts(LineString(points).intersection(DISTRICT), 'LineString')):
            if line.length > 1:
                rails.append({'id': f'hamasen-rail-{way["id"]}-{i}', 'kind':info['railway'], 'points':rounded(line.coords)})
    ground.extend([{'kind':'parking','polygon':infill['portalParking']},
                   {'kind':'paving','polygon':infill['waterfrontPavement']},
                   {'kind':'grass','polygon':infill['schoolGround']}])
    ground.extend({'kind':'paving','polygon':polygon} for polygon in infill.get('quayPaving', []))
    context['hamasen'] = {'ferryVisualGround':infill['ferryVisualGround'],'ferryHarbor':infill['ferryHarbor'],'ferryLand':infill['ferryLand'],'polygon': rounded(list(DISTRICT.exterior.coords)[:-1]), 'rails': rails, 'ground':ground,
        **{key:rounded(project(*row['ll']) for row in rows) for key, rows in data.get('contextPoints', {}).items()}}
    structure['sources']['hamasen'] = {**data['source'], 'file': str(SNAPSHOT.relative_to(ROOT)),
                                      'sha256': hashlib.sha256(SNAPSHOT.read_bytes()).hexdigest()}
    if OVERTURE.exists():
        structure['sources']['hamasen']['overture'] = {**json.loads(OVERTURE.read_text(encoding='utf-8'))['source'],
            'file':str(OVERTURE.relative_to(ROOT)), 'sha256':hashlib.sha256(OVERTURE.read_bytes()).hexdigest()}
    if FACADES.exists():
        structure['sources']['hamasen']['facades'] = {'file':str(FACADES.relative_to(ROOT)),
            'sha256':hashlib.sha256(FACADES.read_bytes()).hexdigest()}
    return structure


def ground_footprint(model):
    footprint = Polygon(model['polygon'], model.get('holes', []))
    return footprint.difference(unary_union([arcade_strip(model, edge, depth) for edge, depth in arcade_edges(model)]))


def arcade_piers(model):
    """Reserve the column envelopes used by the district collision builder."""
    placed = []
    for edge, _ in arcade_edges(model):
        length, at = frontage_frame(model, edge)
        count = max(1, math.floor(length/4.6+.5))
        shops = [s for s in model.get('shopfronts', []) if s['edge'] == edge]
        for i in range(count+1):
            along = max(.26, min(length-.26, length*i/count))
            shop = next((s for s in shops if abs(along-s['along']) < min(s['width']/2-.28, 1.35)), None)
            if shop:
                side = -1 if along < shop['along'] else 1
                along = max(.26, min(length-.26, shop['along']+side*(shop['width']/2+.06)))
            centre = at(along, .25)
            if any(math.dist(centre, p) < .82 for p in placed):
                continue
            placed.append(centre)
            yield Polygon([at(along+u, .25+v) for u,v in [(-.225,-.225),(.225,-.225),(.225,.225),(-.225,.225)]])


def district_solid(buildings, *, margin=.30):
    buildings = [b for b in buildings if not b.get('visualOnly') and b.get('osmId') not in MODEL_WAYS]
    footprints = [ground_footprint(b) for b in buildings]
    piers = [pier for b in buildings for pier in arcade_piers(b)]
    # Landmarks have bespoke openings and decks. Their pads are support, not walls.
    return unary_union([*footprints, *piers, *landmark_polygons(ROOT, margin=0, walking=True)]).buffer(margin)


def add_arcade_network(buildings, road_segments, nodes, street_nodes, node_at, edge, clear):
    streets = [(r, line) for r, _, line in road_segments if r['name'] in ARCADE_STREETS and not r['bridge']]
    if not streets:
        return [], []
    road_index = STRtree([line for _, line in streets])
    spans = []
    for b in buildings:
        for face, depth in arcade_edges(b):
            length, at = frontage_frame(b, face)
            centre = at(length/2, 0)
            options = []
            for i in road_index.query(Point(centre).buffer(24)):
                road, line = streets[int(i)]
                target = line.interpolate(line.project(Point(centre)))
                outward = at(length/2, -1)
                distance = target.distance(Point(centre))
                if distance < .1 or ((target.x-centre[0])*(outward[0]-centre[0]) +
                                    (target.y-centre[1])*(outward[1]-centre[1])) < .55*distance:
                    continue
                options.append((distance, road['name']))
            if not options and b['id'] != 'hamasen-osm-310901110':
                continue
            street = min(options)[1] if options else '濱海一路'
            ends = [.48, length-.48]
            while ends[0]+1 < ends[1] and not clear(at(ends[0], depth*.55), at(ends[1], depth*.55)):
                ends[0] += .20
                ends[1] -= .20
            points = tuple(at(u, depth*.55) for u in ends)
            if ends[1]-ends[0] < 1 or not clear(*points):
                continue
            shops = [(s['along'], at(s['along'], depth*.55)) for s in b.get('shopfronts', [])
                     if s['edge'] == face and ends[0] < s['along'] < ends[1]
                     and clear(points[0], at(s['along'], depth*.55)) and clear(at(s['along'], depth*.55), points[1])]
            spans.append((b['id'], street, face, points, shops))

    endpoints = [p for _, _, _, ends, _ in spans for p in ends]
    index = STRtree([Point(p) for p in endpoints])
    links = {}
    adjacent = defaultdict(set)
    for k, p in enumerate(endpoints):
        i = k//2
        a, street, _, (p0, p1), _ = spans[i]
        options = []
        for j in index.query(Point(p).buffer(3)):
            j = int(j)
            b, other_street, _, (q0, q1), _ = spans[j//2]
            q = endpoints[j]
            if i == j//2 or (a != b and street != other_street):
                continue
            dx, dz = p1[0]-p0[0], p1[1]-p0[1]
            ex, ez = q1[0]-q0[0], q1[1]-q0[1]
            parallel = (dx*ex+dz*ez)/(math.hypot(dx,dz)*math.hypot(ex,ez))
            if a != b:
                along = dx*(q[0]-p[0])+dz*(q[1]-p[1])
                across = abs(dx*(q[1]-p[1])-dz*(q[0]-p[0]))/math.hypot(dx,dz)
                if abs(parallel) < .87 or across > 1.15 or (k%2 == j%2) == (parallel > 0) or along*(1 if k%2 else -1) < 0:
                    continue
            if clear(p, q):
                options.append((math.dist(p, q), j))
        if options:
            links[k] = min(options)[1]
    joins = [(k, j) for k, j in links.items() if k < j and links.get(j) == k]
    for k, j in joins:
        adjacent[k//2].add(j//2)
        adjacent[j//2].add(k//2)

    street_ids = sorted(street_nodes)
    street_points = [nodes[n]['p'][::2] for n in street_ids]
    street_tree = STRtree([Point(p) for p in street_points])
    groups, arcade_links = [], []
    seen = set()
    for first in range(len(spans)):
        if first in seen:
            continue
        group, queue = {first}, [first]
        while queue:
            for n in sorted(adjacent[queue.pop()] - group):
                group.add(n)
                queue.append(n)
        seen.update(group)
        occupied = sorted({spans[i][0] for i in group})
        if len(occupied) < 2 and sum(math.dist(*spans[i][3]) for i in group) < 10:
            continue
        group_ends = [k for i in sorted(group) for k in (2*i, 2*i+1)]
        joined = {k for pair in joins if pair[0]//2 in group for k in pair}
        exits = [k for k in group_ends if k not in joined] or [group_ends[0], group_ends[-1]]
        access = []
        for k in exits:
            p, q = endpoints[k], endpoints[k^1]
            length = math.dist(p, q)
            options = []
            # End piers and corner splays can block a diagonal from the
            # centreline endpoint. Try the adjacent opening within the span.
            for offset in (0, .85, 1.50, 2.15, 3.0, 4.0):
                if offset > length*.45:
                    break
                fraction = offset/length
                approach = tuple(a+(b-a)*fraction for a,b in zip(p,q))
                for j in street_tree.query(Point(approach).buffer(22)):
                    j = int(j)
                    options.append((offset+math.dist(approach, street_points[j]), offset, j, approach))
            for _, offset, j, p in sorted(options):
                if clear(p, street_points[j]):
                    order = length-offset if k%2 else offset
                    access.append((k//2, order, p, street_ids[j]))
                    break
        if len(access) < 2:
            continue
        endpoint_ids = {k:node_at(endpoints[k], exact=True) for k in group_ends}
        entries = [(i, order, node_at(p, exact=True), n) for i,order,p,n in access]
        new_edges = []
        for i in sorted(group):
            p, q = spans[i][3]
            interior = [(math.dist(p, spot), node_at(spot, exact=True)) for _,spot in spans[i][4]]
            interior.extend((order, n) for span,order,n,_ in entries if span == i)
            ordered = [endpoint_ids[2*i], *(n for _,n in sorted(interior)), endpoint_ids[2*i+1]]
            new_edges.extend(zip(ordered, ordered[1:]))
        new_edges.extend((endpoint_ids[k], endpoint_ids[j]) for k,j in joins if k//2 in group)
        new_edges.extend((entry, street) for _,_,entry,street in entries)
        for a, b in new_edges:
            if edge(a, b, 'footway'):
                arcade_links.append([a, b])
        groups.append({'buildings':occupied, 'street':spans[first][1], 'entrances':[n for _,_,n,_ in entries]})
    return groups, arcade_links


def add_graph(graph, data, buildings, road_segments):
    if 'v12' in graph:
        raise ValueError('Build the district on the base graph, then apply the v12 bus patches.')
    terrain = Terrain()
    nodes, edges, kinds = graph['nodes'], graph['edges'], graph['edgeKind']
    anchors = graph['anchors']
    previous = graph.pop('hamasen', None)
    graph.pop('hamasenPois', None)
    if previous:
        del nodes[previous['baseNodes']:]
        del edges[previous['baseEdges']:]
        del kinds[previous['baseEdges']:]
        graph['stats'].update(previous['baseStats'])
        for key in list(anchors):
            if key.startswith('hamasen-'):
                del anchors[key]
    base_stats = {key: graph['stats'][key] for key in ('nodes', 'edges', 'totalLength')}
    base_nodes, base_edges = len(nodes), len(edges)
    # Match old graph positions without reassigning their IDs or changing campus bus references.
    old_tree = cKDTree([(node['p'][0], node['p'][2]) for node in nodes])
    recent = {}
    pairs = {tuple(sorted((a, b))) for a, b, _ in edges}
    source_edges = []

    def node_at(point, *, exact=False):
        x, z = map(lambda v: round(v, 2), point)
        key = x, z
        if key in recent:
            return recent[key]
        d, idx = old_tree.query(key)
        if d < (.012 if exact else .55) and abs(nodes[idx]['p'][1]-terrain.y(x, z)) < .25:
            recent[key] = int(idx)
            return int(idx)
        idx = len(nodes)
        nodes.append({'id': idx, 'p': [x, round(terrain.y(x, z), 2), z]})
        recent[key] = idx
        return idx

    def edge(a, b, kind):
        key = tuple(sorted((a, b)))
        if a == b or key in pairs:
            return
        edges.append([a, b, round(math.dist(nodes[a]['p'], nodes[b]['p']), 2)])
        kinds.append(kind)
        pairs.add(key)
        return True

    def node_point(oid):
        return project(*data['points'][str(oid)]['ll'])

    def anchor(key, node, label, source, **extras):
        anchors[key] = {'node': node, 'label': label, 'source': source, **extras}

    by_point = defaultdict(list)
    for name, oid in STOP_WAYS.items():
        by_point[oid].append((name, Point(node_point(STOP_POINTS[name]))))
    road_nodes = {}
    veh_p = set()
    walk_p = set()
    crossing_point = Point(node_point(7274325309))
    solid = district_solid(buildings)
    # The south road marked through the ferry hall is intentionally absent
    # from the road graph; the authored sidewalk is its public approach.
    south_solid = unary_union([solid, *(Polygon(b['polygon']) for b in buildings if b.get('osmId') == 205060865)])

    def add_streets(segments, *, clear_footprints=False):
        for road, info, line in segments:
            kind, oid = road['kind'], road['osmId']
            if info.get('access') in EXCLUDED_ACCESS or road['bridge']:
                continue
            breaks = {0.0, line.length}
            for name, point in by_point[oid]:
                if line.distance(point) > 15:
                    continue
                where = line.project(point)
                breaks.add(where)
                road_nodes[name] = node_at(line.interpolate(where).coords[0], exact=True)
            if oid == 239205291:
                breaks.add(line.project(crossing_point))
            positions = sorted(breaks)
            travel = kind in VEHICLE_KINDS and info.get('motor_vehicle') not in EXCLUDED_ACCESS and info.get('motorcar') not in EXCLUDED_ACCESS
            if not travel and info.get('foot') in EXCLUDED_ACCESS:
                continue
            for start, end in zip(positions, positions[1:]):
                segment = substring(line, start, end)
                ids = [node_at(p) for p in densify(list(segment.coords))]
                (veh_p if travel else walk_p).update(ids)
                for a, b in zip(ids, ids[1:]):
                    if a == b:
                        continue
                    if clear_footprints or oid == TEMPLE_PLAZA:
                        path = LineString([(nodes[n]['p'][0], nodes[n]['p'][2]) for n in (a,b)])
                        if path.intersects(south_solid if clear_footprints else solid):
                            continue
                    classification = kind if travel or kind not in VEHICLE_KINDS else 'footway'
                    edge(a, b, classification)
                    source_edges.append({'from': a, 'to': b, 'osmWayId': oid, 'kind': classification,
                                         'oneway': info.get('oneway') in {'yes', '-1', '1', 'true'}})

    add_streets(row for row in road_segments if '-south' not in row[0]['id'])
    if set(road_nodes) != set(STOP_WAYS):
        raise ValueError('Missing vehicle approaches for Hamasen bus stops')

    def walk_link(p, choices, *, max_distance=30, exact=True):
        idx = node_at(p, exact=exact)
        ranked = sorted((math.dist(p, (nodes[n]['p'][0], nodes[n]['p'][2])), n) for n in choices if n != idx)
        if idx in choices:
            return idx
        for distance, n in ranked:
            _, _, z = nodes[n]['p']
            x = nodes[n]['p'][0]
            if distance > max_distance:
                break
            if abs(terrain.y(*p)-nodes[n]['p'][1]) < 2 and not LineString([p, (x, z)]).intersects(solid):
                edge(idx, n, 'anchor-link')
                return idx
        raise ValueError(f'Hamasen pedestrian approach at {p} lacks a clear street link')

    east = min((i for i in range(base_nodes) if nodes[i]['p'][0] > 288),
               key=lambda i: math.dist((nodes[i]['p'][0], nodes[i]['p'][2]), (290.54, 226.99)))
    anchor('hamasen-east-link', east, '西子灣隧道東口外', 'OSM way 310675368')
    exit_1 = walk_link((700.0, 489.4), veh_p|walk_p)
    exit_2 = walk_link(node_point(6409381015), veh_p|walk_p)
    anchor('hamasen-exit-1', exit_1, '哈瑪星站 1 號出口', 'OSM node 3153721082 and way 310011987')
    anchor('hamasen-exit-2', exit_2, '哈瑪星站 2 號出口', 'OSM node 6409381015 and way 303165537')
    if str(RAIL_PARK_POINT) in data['points']:
        park = walk_link(node_point(RAIL_PARK_POINT), veh_p|walk_p)
        anchor('hamasen-rail-park', park, '哈瑪星鐵道園區前場', 'OSM node 11598582446 on way 914410234')
    stop_labels = {'hamasen-orange-stop': '哈瑪星站 1 號出口・橘1延', 'hamasen-campus-stop': '哈瑪星站 2 號出口・校園公車'}
    for name, oid in STOP_POINTS.items():
        p = node_point(oid)
        idx = walk_link(p, veh_p|walk_p)
        anchor(name, idx, stop_labels[name], f'OSM node {oid}', roadNode=road_nodes[name])
    # Add the extension after the existing approaches so saved bus node
    # sequences and the original town graph retain their IDs.
    add_streets((row for row in road_segments if '-south' in row[0]['id']), clear_footprints=True)
    # The ferry hall interrupts the mapped sidewalk farther north. Join its
    # south-side segment to the adjacent living street at the open forecourt.
    ferry_walk = recent[(365.95, 734.72)]
    ferry_street = recent[(372.84, 734.30)]
    if not solid.intersects(LineString([nodes[n]['p'][::2] for n in (ferry_walk, ferry_street)])):
        edge(ferry_walk, ferry_street, 'footway')
    plaza = temple_plaza(data)
    centre = plaza.difference(solid).representative_point()
    if not centre.is_empty:
        p = centre.coords[0]
        for n in sorted(walk_p | veh_p):
            q = nodes[n]['p'][::2]
            if (centre.distance(Point(q)) <= 24 and plaza.buffer(.05).covers(LineString([p, q]))
                    and not solid.intersects(LineString([p, q]))):
                edge(node_at(p, exact=True), n, 'footway')
    # A clipped spur or a private entrance with no measured public connection stays
    # visible in the street context. The route graph only keeps paths joined to campus.
    neighbors = defaultdict(list)
    for a, b, _ in edges:
        neighbors[a].append(b)
        neighbors[b].append(a)
    connected = set(range(base_nodes))
    pending = list(range(base_nodes))
    while pending:
        for n in neighbors[pending.pop()]:
            if n not in connected:
                connected.add(n)
                pending.append(n)
    keep = {old: new for new, old in enumerate(sorted(connected))}
    for name, entry in anchors.items():
        for key in ('node', 'roadNode'):
            if key in entry and entry[key] not in keep:
                raise ValueError(f'Hamasen anchor {name} is disconnected ({key})')
            if key in entry:
                entry[key] = keep[entry[key]]
    if len(keep) < len(nodes):
        nodes[:] = [{**node, 'id':keep[i]} for i, node in enumerate(nodes) if i in keep]
        retained = [([keep[a],keep[b],w], k) for (a,b,w), k in zip(edges,kinds) if a in keep and b in keep]
        edges[:] = [e for e, _ in retained]
        kinds[:] = [k for _, k in retained]
        source_edges = [{**entry,'from':keep[entry['from']],'to':keep[entry['to']]} for entry in source_edges
                        if entry['from'] in keep and entry['to'] in keep]
    recent = {point:keep[n] for point,n in recent.items() if n in keep}
    pairs = {tuple(sorted((a, b))) for a,b,_ in edges}

    def clear(p, q):
        if not PLAY_AREA.covers(Point(p)) or not PLAY_AREA.covers(Point(q)):
            return False
        line = LineString([p, q])
        if solid.intersects(line):
            return False
        steps = max(1, math.ceil(line.length/.5))
        heights = [terrain.y(*line.interpolate(i/steps, normalized=True).coords[0]) for i in range(steps+1)]
        return min(heights) > -.50 and max((abs(a-b) for a,b in zip(heights,heights[1:])), default=0) <= .24

    arcades, arcade_links = add_arcade_network(buildings, road_segments, nodes,
                                              {keep[n] for n in veh_p|walk_p if n in keep}, node_at, edge, clear)
    graph['stats'].update(nodes=len(nodes), edges=len(edges), totalLength=round(sum(e[2] for e in edges), 1))
    graph['source']['terrainSha256'] = terrain.m['sha256']
    graph['hamasen'] = {'tool': 'tools/apply_hamasen.py', 'baseNodes': base_nodes, 'baseEdges': base_edges, 'baseStats': base_stats,
                        'source': str(SNAPSHOT.relative_to(ROOT)), 'sourceSha256': hashlib.sha256(SNAPSHOT.read_bytes()).hexdigest(),
                        'vehicleWayIds': sorted({e['osmWayId'] for e in source_edges if e['kind'] in VEHICLE_KINDS}),
                        'arcades':arcades, 'arcadeEdges':arcade_links,
                        'edges': source_edges}
    return graph


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='action', required=True)
    snapshot = sub.add_parser('snapshot')
    snapshot.add_argument('xml', type=Path)
    snapshot.add_argument('--retrieved-at', required=True)
    for action, path in [('context', STRUCTURE), ('graph', GRAPH)]:
        command = sub.add_parser(action)
        command.add_argument('--input', type=Path, default=path)
        command.add_argument('--output', type=Path, default=path)
    args = parser.parse_args()
    if args.action == 'snapshot':
        write_json(SNAPSHOT, snapshot_from_xml(args.xml, args.retrieved_at), compact=True)
        return
    data = json.loads(SNAPSHOT.read_text())
    infill = json.loads(INFILL.read_text())
    baseline = json.loads(args.input.read_text())
    if args.action == 'context':
        buildings, roads = district(data, infill)
        structure, graph = baseline, json.loads(GRAPH.read_text())
        managed = {oid for oid, _, _, kind, _ in osm_buildings(data) if kind == 'way'}
        managed_ids = {f'osm-{oid}' for oid in managed}
        legacy_ids = {b['id'] for b in structure['context']['background'] if b['id'].startswith('osm-')}
        protected = [Polygon(b['polygon'],b.get('holes',[])) for key in ('landmarks','background')
                     for b in structure['context'][key]
                     if not b['id'].startswith('hamasen-') and b.get('osmId') not in managed
                     and b['id'] not in managed_ids]
        shore_roads = list(ferry_roads(data, infill))
        reserve = street_reserve([*roads, *shore_roads], temple_plaza(data))
        additions, report = fill_streets(ROOT, infill, buildings, roads, graph, protected, rounded, street_margin, reserve)
        buildings += additions
        print('Infill:', json.dumps(report, ensure_ascii=False))
        print('Source recoveries:', [b['id'] for b in buildings if b.get('sourceRecovery')])
        evidence = json.loads(FACADES.read_text(encoding='utf-8'))['buildings']
        pois, shopfronts = place_shopfronts(buildings, *style_streets(buildings, [*roads,*shore_roads], evidence), legacy_ids)
        shore_buildings = list(ferry_background(data,infill,[*roads,*shore_roads]))
        print(f'Source-backed visual context south of play boundary: {len(shore_buildings)} buildings')
        result = add_context(baseline, data, buildings+shore_buildings, roads, infill)
        if args.output == STRUCTURE:
            write_json(POIS, pois)
            write_json(SHOPFRONTS, shopfronts)
    else:
        from apply_v12_bus import strip_v12
        buildings, roads = district(data)
        strip_v12(baseline)
        result = add_graph(baseline, data, buildings, roads)
    write_json(args.output, result, compact=args.action == 'graph')
    print(f'Hamasen: {len(buildings)} building footprints, {len(roads)} street segments → {args.output}')


if __name__ == '__main__':
    main()
