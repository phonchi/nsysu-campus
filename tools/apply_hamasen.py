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


ROOT = Path(__file__).resolve().parents[1]
WALK = ROOT/'public/data/walkthrough'
SNAPSHOT = ROOT/'data/sources/osm/osm-hamasen.json'
OVERTURE = ROOT/'data/sources/hamasen/overture-buildings.json'
FACADES = ROOT/'data/sources/hamasen/facades.json'
STRUCTURE = WALK/'campus-structure.json'
GRAPH = WALK/'outdoor-graph.json'
PLAY_AREA = box(190, 100, 1000, 744)
# Mountain-foot blocks, the town grid and the west side of the former station yard.
DISTRICT = Polygon([(272,188), (347,153), (540,146), (660,163), (825,203), (961,297),
                    (994,389), (994,677), (915,708), (795,735), (570,735), (385,720),
                    (323,634), (298,492), (256,410), (258,301)])
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
        for i, poly in enumerate(parts(polygon, 'Polygon')):
            if poly.area >= 3 and DISTRICT.intersects(poly) and PLAY_AREA.buffer(-1.01).covers(poly):
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


def overture_buildings(osm, road_segments):
    if not OVERTURE.exists():
        return
    existing = [record[2] for record in osm]
    tree = STRtree(existing)
    lines = [line for road, _, line in road_segments if road['kind'] in VEHICLE_KINDS and not road['bridge']]
    road_tree = STRtree(lines)
    data = json.loads(OVERTURE.read_text(encoding='utf-8'))
    for feature in data['features']:
        prop = feature['properties']
        if prop.get('is_underground') or (prop.get('level') or 0) < 0 or (prop.get('min_height') or 0) > .25:
            continue
        if any(s.get('dataset') == 'OpenStreetMap' for s in prop.get('sources') or []):
            continue
        geom = make_valid(transform(lambda lon,lat: project(lat,lon), shape(feature['geometry'])))
        for i, poly in enumerate(parts(geom, 'Polygon')):
            if poly.area < 10 or not DISTRICT.intersects(poly) or not PLAY_AREA.buffer(-1.01).covers(poly):
                continue
            overlap = sum(poly.intersection(existing[int(j)]).area for j in tree.query(poly))
            if overlap/poly.area > .22 or any(poly.intersection(lines[int(j)]).length > 2 for j in road_tree.query(poly)):
                continue
            yield prop['id'], {'building':prop.get('class') or prop.get('subtype'),
                'building:levels':prop.get('num_floors'), 'height':prop.get('height'), 'name':prop.get('name'),
                'building:colour':prop.get('facade_color'), 'roof:colour':prop.get('roof_color'),
                'roof:shape':prop.get('roof_shape') or 'flat'}, poly, 'overture', i


def district(data):
    road_segments = []
    for way in data['ways']:
        oid, info, ps = way['id'], way['tags'], coords(way)
        kind = info.get('highway')
        if kind not in STREET_WIDTHS or len(ps) < 2 or underground(info):
            continue
        if info.get('oneway') == '-1':
            ps.reverse()
        line = LineString(ps)
        for i, part in enumerate(parts(line.intersection(DISTRICT), 'LineString')):
            if part.length < .5:
                continue
            if line.project(Point(part.coords[0])) > line.project(Point(part.coords[-1])):
                part = part.reverse()
            road = {'id': f'hamasen-osm-{oid}'+(f'-{i}' if i else ''), 'kind': kind, 'name': info.get('name'),
                    'width': number(info.get('width')) or STREET_WIDTHS[kind], 'points': rounded(part.coords),
                    'tunnel': False, 'bridge': info.get('bridge') == 'yes', 'osmId': oid, 'district': 'hamasen'}
            for key in ('sidewalk', 'surface'):
                if value := info.get(key):
                    road[key] = value
            road_segments.append((road, info, part))
    streets = [line for road, info, line in road_segments if road['kind'] in VEHICLE_KINDS or road['kind'] == 'pedestrian']
    street_tree = STRtree(streets)
    evidence = json.loads(FACADES.read_text(encoding='utf-8')).get('buildings', {}) if FACADES.exists() else {}
    osm = list(osm_buildings(data))
    buildings = [building_model(oid, tags, poly, kind, i, evidence.get(str(oid), {}), street_tree, streets)
                 for oid, tags, poly, kind, i in [*osm, *overture_buildings(osm, road_segments)]]
    return buildings, road_segments


def add_context(structure, data, buildings, road_segments):
    context = structure['context']
    background = {row['id']: row for row in context['background'] if not row['id'].startswith(('hamasen-osm-', 'hamasen-ov-'))}
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
        if road['id'] not in replacement_way_ids:
            retained.append(road)
            continue
        outside = list(parts(LineString(road['points']).difference(DISTRICT), 'LineString'))
        for i, line in enumerate(outside):
            if line.length > .25:
                retained.append({**road, 'id':f'{road["id"]}-outside-{i}', 'points':rounded(line.coords)})
    context['roads'] = [*retained, *(r for r, _, _ in road_segments)]
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
    context['hamasen'] = {'polygon': rounded(list(DISTRICT.exterior.coords)[:-1]), 'rails': rails, 'ground':ground,
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
    for road, info, line in road_segments:
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
                classification = kind if travel or kind not in VEHICLE_KINDS else 'footway'
                edge(a, b, classification)
                source_edges.append({'from': a, 'to': b, 'osmWayId': oid, 'kind': classification,
                                     'oneway': info.get('oneway') in {'yes', '-1', '1', 'true'}})
    if set(road_nodes) != set(STOP_WAYS):
        raise ValueError('Missing vehicle approaches for Hamasen bus stops')

    solid = unary_union([Polygon(item['polygon'], item.get('holes', [])) for item in buildings]).buffer(.29)

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
    buildings, roads = district(data)
    baseline = json.loads(args.input.read_text())
    result = add_context(baseline, data, buildings, roads) if args.action == 'context' else add_graph(baseline, data, buildings, roads)
    write_json(args.output, result, compact=args.action == 'graph')
    print(f'Hamasen: {len(buildings)} building footprints, {len(roads)} street segments → {args.output}')


if __name__ == '__main__':
    main()
