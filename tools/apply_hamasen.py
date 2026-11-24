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
from shapely import make_valid
from shapely.geometry import LineString, Point, Polygon, box, shape
from shapely.ops import polygonize, substring, transform, unary_union
from shapely.strtree import STRtree

from build_campus_structure import project
from build_outdoor_graph import Terrain, densify
from hamasen_infill import SHOP_STREETS, fill_streets


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
EXIT_WAYS = {310011987: 1, 303165537: 2}
STOP_WAYS = {'hamasen-orange-stop': 249154068, 'hamasen-campus-stop': 239205291}
STOP_POINTS = {'hamasen-orange-stop': 2835097772, 'hamasen-campus-stop': 2470169309}
RAIL_PARK_POINT = 11598582446
RAIL_KINDS = {'disused', 'rail', 'light_rail'}
PLATFORM_WAYS = {435657348, 1056803932, 1247688196}
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


def arcade_fits(model, depth):
    if model.get('holes') or not 1 <= depth <= 4:
        return False
    poly = model['polygon']
    edge = model['frontage']['edge']
    a, b = poly[edge], poly[(edge+1)%len(poly)]
    dx, dz = b[0]-a[0], b[1]-a[1]
    length = math.hypot(dx, dz)
    if length < 3:
        return False
    polygon = Polygon(poly)
    winding = 1 if polygon.exterior.is_ccw else -1
    tx, tz = dx/length, dz/length
    nx, nz = -winding*tz, winding*tx
    distances = [(x-a[0])*nx + (z-a[1])*nz for x,z in poly]
    if min(distances) < -.05:
        return False
    crossings = sum((p >= depth) != (q >= depth) for p,q in zip(distances, distances[1:] + distances[:1]))
    if crossings != 2:
        return False
    span = max(math.dist(a, p) for p in poly)+1
    back = Polygon([(a[0]+tx*u+nx*v, a[1]+tz*u+nz*v)
                    for u,v in [(-span,depth),(span,depth),(span,span),(-span,span)]])
    return back.intersection(polygon).area >= polygon.area*.4


def style_streets(buildings, road_segments, evidence):
    """Keep surveyed facade values and infer only unrecorded street-house details."""
    street_records = [(road, line) for road, _, line in road_segments
                      if not road['bridge'] and road['kind'] in VEHICLE_KINDS | {'pedestrian','footway','steps'}]
    street_tree = STRtree([line for _, line in street_records])
    footprints = [Polygon(b['polygon'], b.get('holes', [])) for b in buildings]
    occupied_tree = STRtree(footprints)
    for b in buildings:
        if b.get('synthetic') or b['facade'] not in {'residential','commercial','shophouse'}:
            continue
        record = evidence.get(str(b.get('osmId', b.get('gersId'))), {})
        seed = int.from_bytes(hashlib.sha256(b['id'].encode()).digest()[:4], 'big')
        options = sorted(frontage_options(b, street_tree, street_records, occupied_tree, footprints),
                         key=lambda option:option[0] - (5 if option[6]['name'] in MAIN_STREETS else 0))
        if 'frontageFacing' in record:
            options.sort(key=lambda option:option[1] != b['frontage']['edge'])
        if options:
            _, edge, _, _, _, normal, road, _ = options[0]
            depth = b.get('frontage', {}).get('arcadeDepth')
            frontage = b['frontage'] = {'edge':edge, 'commercial':road['name'] in (MAIN_STREETS | SHOP_STREETS)}
            for _, side, _, width, _, outward, side_road, _ in options:
                if side != edge and width >= 3 and side_road['osmId'] != road['osmId'] and abs(sum(a*c for a,c in zip(normal,outward))) < .55:
                    frontage['cornerEdge'] = side
                    break
            if depth is None and b['storeys'] > 1 and (road['name'] in MAIN_STREETS or (b['facade']=='shophouse' and seed % 4 == 0)):
                depth = 1.55 + .20*(seed % 4)
            if depth and arcade_fits(b, depth):
                frontage['arcadeDepth'] = depth
        elif 'frontageFacing' not in record:
            b.pop('frontage', None)
        # Level counts from the map and the photographic dossier take precedence.
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


def place_shopfronts(buildings, street_tree, street_records, occupied_tree, footprints):
    pois = json.loads(POIS.read_text(encoding='utf-8'))
    aliases = {b['id'].removeprefix('hamasen-'): b['id'] for b in buildings if b['id'].startswith('hamasen-osm-')}
    by_id = {b['id']: b for b in buildings}
    results = []
    for shop in pois['shops']:
        sid = shop['id']
        photo_fit = by_id.get(f'hamasen-infill-shop-{sid}')
        mapped = photo_fit['id'] if photo_fit else EXPANDED_SHOPS.get(sid) or shop['buildingId']
        primary = by_id[aliases.get(mapped, mapped)]
        reference = Point(SHOP_ADDRESS_POINT.get(sid, (shop['x'], shop['z'])))
        address_street = shop['address'].split('鼓山區',1)[1]
        names = {r['name'] for r, _ in street_records if r['name'] and address_street.startswith(r['name'])}
        wanted = SHOP_APPROACH.get(sid) or max(names, key=len)
        uncertain = not photo_fit and (shop.get('buildingDistanceM') or 0) > 5
        candidates = [primary]
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
                options.append(((street_cost, footprint_gap, option[0]), b, option))
        if not options:
            raise ValueError(f'{sid} has no clear street-facing span')
        _, b, (_, edge, along, width, (x,z), (nx,nz), road, target) = min(options, key=lambda row:row[0])
        if sid=='ferry-haizhibing':
            if road['name'] != '濱海一路':
                raise ValueError('The ice shop entrance must face Binhai 1st Road')
            b['frontage'] = {'edge':edge,'commercial':True,'cornerEdge':0}
            if arcade_fits(b, 1.6):
                b['frontage']['arcadeDepth'] = 1.6
        frontage = b.get('frontage', {})
        depth = frontage.get('arcadeDepth', 0) if frontage.get('edge') == edge else 0
        # The anchor is on the walkable side of the recessed threshold.
        offset = .30-depth
        actual_id = b['id']
        if actual_id == aliases.get(shop['buildingId']):
            actual_id = shop['buildingId']
        distance = math.hypot(target.x-x, target.y-z)
        sidewalk = max(.37, distance-road['width']/2-.08)/distance
        approach = [round(x+(target.x-x)*sidewalk,3), round(z+(target.y-z)*sidewalk,3)]
        b.setdefault('shopfronts', []).append({'id':sid,'name':shop['name'],'category':shop['category'],
                                              'edge':edge,'along':round(along,3),'width':round(width,3),'approach':approach})
        results.append({'id':sid,'name':shop['name'],'buildingId':actual_id,'edge':edge,'roadId':road['id'],
                        'street':road['name'],'x':round(x+offset*nx,3),'z':round(z+offset*nz,3),
                        'facing':[round(nx,6),round(nz,6)],'streetPoint':rounded([target.coords[0]])[0],
                        'placement':'photo-approximation' if photo_fit else 'nearest-street-facing' if uncertain else 'corner-approach' if wanted != road['name'] else 'footprint'})
        if photo_fit or sid in EXPANDED_SHOPS or uncertain:
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


def overture_buildings(osm, road_segments, bands):
    if not OVERTURE.exists():
        return
    existing = [record[2] for record in osm]
    tree = STRtree(existing)
    lines = [line for road, _, line in road_segments if road['kind'] in VEHICLE_KINDS and not road['bridge']]
    road_tree = STRtree(lines)
    gushan_clearance = unary_union([line.buffer(road['width']/2 + .40)
                                   for road, _, line in road_segments if road['id'] == 'hamasen-osm-205152895'])
    data = json.loads(OVERTURE.read_text(encoding='utf-8'))
    for feature in data['features']:
        prop = feature['properties']
        if prop.get('is_underground') or (prop.get('level') or 0) < 0 or (prop.get('min_height') or 0) > .25:
            continue
        osm_source = any(s.get('dataset') == 'OpenStreetMap' for s in prop.get('sources') or [])
        geom = make_valid(transform(lambda lon,lat: project(lat,lon), shape(feature['geometry'])))
        playable = [piece for poly in parts(geom, 'Polygon')
                    if (clipped := playable_building(poly)) is not None
                    for piece in parts(clipped, 'Polygon')]
        for i, poly in enumerate(playable):
            if poly.area < 7 or any(poly.intersection(lines[int(j)]).length > 2 for j in road_tree.query(poly)):
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
                if prop['id'] == '265474bb-09e5-4acf-af15-34ad1bbe7514':
                    # The orthophoto shows asphalt under this footprint's western edge.
                    # Keep the mapped road and leave room for the projecting façade trim.
                    piece = piece.difference(gushan_clearance)
                    if piece.is_empty or piece.geom_type != 'Polygon':
                        raise ValueError('Gushan 1st Road setback must retain one building footprint')
                yield prop['id'], {'building':prop.get('class') or prop.get('subtype'),
                    'building:levels':prop.get('num_floors'), 'height':prop.get('height'), 'name':prop.get('name'),
                    'building:colour':prop.get('facade_color'), 'roof:colour':prop.get('roof_color'),
                    'roof:shape':prop.get('roof_shape') or 'flat', 'sourceRecovery':recovered}, piece, 'overture', i+j*100


def ferry_background(data, infill, roads):
    area = Polygon(infill['ferryVisualGround']).difference(PLAY_AREA).buffer(-.04)
    lines = [line for _,_,line in roads]
    source = json.loads(OVERTURE.read_text(encoding='utf-8'))['features']
    picked = []
    for feature in source:
        info = feature['properties']
        if info.get('is_underground') or (info.get('level') or 0) < 0 or (info.get('min_height') or 0) > .25:
            continue
        polygon = make_valid(transform(lambda lon,lat:project(lat,lon),shape(feature['geometry'])))
        if not area.intersects(polygon):
            continue
        for p in parts(polygon.intersection(area),'Polygon'):
            if p.area < 17 or any(p.intersection(line).length > 1 for line in lines):
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
    streets = [line for road, info, line in road_segments if road['kind'] in VEHICLE_KINDS or road['kind'] == 'pedestrian']
    street_tree = STRtree(streets)
    evidence = json.loads(FACADES.read_text(encoding='utf-8')).get('buildings', {}) if FACADES.exists() else {}
    osm = list(osm_buildings(data))
    buildings = [building_model(oid, tags, poly, kind, i, evidence.get(str(oid), {}), street_tree, streets)
                 for oid, tags, poly, kind, i in [*osm, *overture_buildings(osm, road_segments, unary_union([Polygon(p) for p in infill['frontageBands']]))]]
    if load_infill:
        context = json.loads(STRUCTURE.read_text())['context']
        buildings += [b for b in context['background'] if b.get('synthetic')]
    return buildings, road_segments


def add_context(structure, data, buildings, road_segments, infill):
    context = structure['context']
    background = {row['id']: row for row in context['background'] if not row['id'].startswith(('hamasen-osm-', 'hamasen-ov-', 'hamasen-infill-'))}
    for model in buildings:
        old_id = f'osm-{model.get("osmId")}'
        if model['id'] == f'hamasen-osm-{model.get("osmId")}' and old_id in background:
            background[old_id] = {**background[old_id], **model, 'id':old_id}
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
    solid = unary_union([Polygon(item['polygon'], item.get('holes', [])) for item in buildings]).buffer(.29)

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
                    if clear_footprints:
                        path = LineString([(nodes[n]['p'][0], nodes[n]['p'][2]) for n in (a,b)])
                        if path.intersects(solid):
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
    graph['stats'].update(nodes=len(nodes), edges=len(edges), totalLength=round(sum(e[2] for e in edges), 1))
    graph['source']['terrainSha256'] = terrain.m['sha256']
    graph['hamasen'] = {'tool': 'tools/apply_hamasen.py', 'baseNodes': base_nodes, 'baseEdges': base_edges, 'baseStats': base_stats,
                        'source': str(SNAPSHOT.relative_to(ROOT)), 'sourceSha256': hashlib.sha256(SNAPSHOT.read_bytes()).hexdigest(),
                        'vehicleWayIds': sorted({e['osmWayId'] for e in source_edges if e['kind'] in VEHICLE_KINDS}),
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
    buildings, roads = district(data, infill)
    baseline = json.loads(args.input.read_text())
    if args.action == 'context':
        structure, graph = baseline, json.loads(GRAPH.read_text())
    else:
        structure, graph = json.loads(STRUCTURE.read_text()), baseline
    protected = [Polygon(b['polygon'],b.get('holes',[])) for key in ('landmarks','background')
                 for b in structure['context'][key] if not b.get('synthetic')]
    if args.action == 'context':
        additions, report = fill_streets(ROOT, infill, buildings, roads, graph, protected, rounded)
        buildings += additions
        print('Infill:', json.dumps(report, ensure_ascii=False))
        print('Source recoveries:', [b['id'] for b in buildings if b.get('sourceRecovery')])
    else:
        buildings += [b for b in structure['context']['background'] if b.get('synthetic')]
    if args.action == 'context':
        evidence = json.loads(FACADES.read_text(encoding='utf-8'))['buildings']
        shore_roads = list(ferry_roads(data, infill))
        pois, shopfronts = place_shopfronts(buildings, *style_streets(buildings, [*roads,*shore_roads], evidence))
        shore_buildings = list(ferry_background(data,infill,shore_roads))
        print(f'Source-backed visual context south of play boundary: {len(shore_buildings)} buildings')
        result = add_context(baseline, data, buildings+shore_buildings, roads, infill)
        if args.output == STRUCTURE:
            write_json(POIS, pois)
            write_json(SHOPFRONTS, shopfronts)
    else:
        from apply_v12_bus import strip_v12
        strip_v12(baseline)
        result = add_graph(baseline, data, buildings, roads)
    write_json(args.output, result, compact=args.action == 'graph')
    print(f'Hamasen: {len(buildings)} building footprints, {len(roads)} street segments → {args.output}')


if __name__ == '__main__':
    main()
