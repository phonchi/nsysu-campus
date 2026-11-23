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
from shapely.geometry import LineString, Point, Polygon, box
from shapely.ops import substring, unary_union

from build_campus_structure import project
from build_outdoor_graph import Terrain, densify


ROOT = Path(__file__).resolve().parents[1]
WALK = ROOT/'public/data/walkthrough'
SNAPSHOT = ROOT/'data/sources/osm/osm-hamasen.json'
STRUCTURE = WALK/'campus-structure.json'
GRAPH = WALK/'outdoor-graph.json'
PLAY_AREA = box(190, 100, 952, 700)
MAIN_WAYS = (310675368, 249154067, 232769121, 232769117, 249154068, 211139350, 239205291)
EXIT_WAYS = {310011987: 1, 303165537: 2}
# The alley joins the original campus graph just outside the district buffer.
CONNECTING_WAYS = {232769111}
STOP_WAYS = {'hamasen-orange-stop': 249154068, 'hamasen-campus-stop': 239205291}
STOP_POINTS = {'hamasen-orange-stop': 2835097772, 'hamasen-campus-stop': 2470169309}
STREET_WIDTHS = {'tertiary': 8, 'residential': 6.5, 'unclassified': 6, 'living_street': 5, 'service': 4.5,
                 'footway': 2.4, 'pedestrian': 4, 'path': 2, 'steps': 2.4, 'cycleway': 2.4}
VEHICLE_KINDS = {'tertiary', 'residential', 'unclassified', 'living_street', 'service'}
WAY_TAGS = {'building', 'building:levels', 'height', 'name', 'highway', 'footway', 'layer', 'tunnel', 'bridge',
            'access', 'motor_vehicle', 'motorcar', 'oneway', 'foot', 'bicycle', 'service', 'width'}
POINT_IDS = {3153721082, 1166364342, 6409381015, 6409381018, 800606203, 7274325309, *STOP_POINTS.values()}
EXCLUDED_ACCESS = {'private', 'no'}


def write_json(path, data, *, compact=False):
    if compact:
        text = json.dumps(data, ensure_ascii=False, separators=(',', ':'))
    else:
        text = json.dumps(data, ensure_ascii=False, indent=2)
    path.write_text(text+'\n', encoding='utf-8')


def tags(el, keep):
    return {tag.attrib['k']: tag.attrib['v'] for tag in el.iterfind('tag') if tag.attrib['k'] in keep}


def snapshot_from_xml(path, retrieved_at):
    raw = path.read_bytes()
    root = ET.fromstring(raw)
    bounds = root.find('bounds').attrib
    bbox = tuple(float(bounds[key]) for key in ('minlon', 'minlat', 'maxlon', 'maxlat'))
    nodes = {int(node.attrib['id']): node for node in root.iterfind('node')}
    coord = lambda el: [float(el.attrib['lat']), float(el.attrib['lon'])]
    points = {str(oid): {'ll': coord(node), 'tags': tags(node, {'name', 'railway', 'highway', 'ref', 'entrance'})}
              for oid, node in nodes.items() if oid in POINT_IDS}
    ways = []
    for way in root.iterfind('way'):
        info = tags(way, WAY_TAGS)
        if 'building' not in info and info.get('highway') not in STREET_WIDTHS:
            continue
        ways.append({'id': int(way.attrib['id']), 'tags': info,
                     'll': [coord(nodes[int(nd.attrib['ref'])]) for nd in way.iterfind('nd')]})
    url = 'https://api.openstreetmap.org/api/0.6/map?bbox='+','.join(map(str, bbox))
    return {'source': {'url': url, 'bbox': bbox, 'retrievedAt': retrieved_at,
                       'rawSha256': hashlib.sha256(raw).hexdigest(),
                       'license': 'ODbL 1.0 © OpenStreetMap contributors',
                       'licenseUrl': 'https://www.openstreetmap.org/copyright'},
            'points': points, 'ways': sorted(ways, key=lambda w: w['id'])}


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
        value = float(tag.rstrip(' m'))
        return value if math.isfinite(value) and value > 0 else None
    except (AttributeError, ValueError):
        return None


def district(data):
    by_id = {way['id']: way for way in data['ways']}
    main = [LineString(coords(by_id[oid])) for oid in MAIN_WAYS]
    study_area = unary_union(main).buffer(105).intersection(PLAY_AREA)
    buildings, road_segments = [], []
    for way in by_id.values():
        oid, info, ps = way['id'], way['tags'], coords(way)
        kind = info.get('highway')
        if 'building' in info and len(ps) >= 4 and ps[0] == ps[-1]:
            for i, poly in enumerate(parts(make_valid(Polygon(ps)), 'Polygon')):
                if poly.area < 3 or not study_area.intersects(poly) or not PLAY_AREA.buffer(-1.01).covers(poly):
                    continue
                exit_number = EXIT_WAYS.get(oid)
                levels = number(info.get('building:levels'))
                height = number(info.get('height'))
                if levels is None:
                    levels = 1 if exit_number or info['building'] in {'shed', 'transportation'} else 3 if poly.area < 240 else 4
                tone = 'station' if exit_number else ('porcelain', 'sand', 'gray-green', 'brick')[oid % 4]
                model = {'id': f'hamasen-osm-{oid}'+(f'-{i}' if i else ''), 'name': info.get('name'),
                         'polygon': rounded(list(poly.exterior.coords)[:-1]), 'storeys': levels, 'tone': tone, 'osmId': oid}
                if exit_number:
                    model.update(heightM=4.4, stationExit=exit_number)
                if height:
                    model['heightM'] = height
                buildings.append(model)
        if kind not in STREET_WIDTHS or len(ps) < 2 or info.get('tunnel') in {'yes', 'building_passage'} or info.get('layer', '0').startswith('-'):
            continue
        if info.get('oneway') == '-1':
            ps.reverse()
        line = LineString(ps)
        clip = PLAY_AREA if oid in CONNECTING_WAYS else study_area
        for i, part in enumerate(parts(line.intersection(clip), 'LineString')):
            if part.length < .5:
                continue
            road = {'id': f'hamasen-osm-{oid}'+(f'-{i}' if i else ''), 'kind': kind, 'name': info.get('name'),
                    'width': number(info.get('width')) or STREET_WIDTHS[kind], 'points': rounded(part.coords),
                    'tunnel': False, 'bridge': info.get('bridge') == 'yes', 'osmId': oid}
            road_segments.append((road, info, part))
    return buildings, road_segments


def add_context(structure, data, buildings, road_segments):
    context = structure['context']
    for key in ('background', 'roads'):
        context[key] = [row for row in context[key] if not row['id'].startswith('hamasen-osm-')]
    for key, additions in (('background', buildings), ('roads', [road for road, _, _ in road_segments])):
        existing = {row['id'] for row in context[key]}
        context[key].extend(row for row in additions if f'osm-{row["osmId"]}' not in existing)
    structure['sources']['hamasen'] = {**data['source'], 'file': str(SNAPSHOT.relative_to(ROOT)),
                                      'sha256': hashlib.sha256(SNAPSHOT.read_bytes()).hexdigest()}
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

    solid = unary_union([Polygon(item['polygon']) for item in buildings]).buffer(.29)

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
    stop_labels = {'hamasen-orange-stop': '哈瑪星站 1 號出口・橘1延', 'hamasen-campus-stop': '哈瑪星站 2 號出口・校園公車'}
    for name, oid in STOP_POINTS.items():
        p = node_point(oid)
        idx = walk_link(p, veh_p|walk_p)
        anchor(name, idx, stop_labels[name], f'OSM node {oid}', roadNode=road_nodes[name])
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
