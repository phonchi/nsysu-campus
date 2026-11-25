#!/usr/bin/env python3
"""Add the verified Hamasen cards and outdoor approaches.

Run after apply_hamasen.py graph and before apply_v12_bus.py and map:build.
--check also accepts the final graph with the bus layer in place.
"""
from __future__ import annotations

import argparse
from collections import defaultdict
import json
import math
import re

from shapely.affinity import rotate, translate
from shapely.geometry import LineString, Point, Polygon, box
from shapely.ops import unary_union

from apply_hamasen import (DISTRICT, GRAPH, MODEL_WAYS, PLAY_AREA, POIS, ROOT, SHOPFRONTS, STRUCTURE,
                           VEHICLE_KINDS, Terrain, arcade_piers, ground_footprint)

INFO = ROOT / 'public/data/campus-info.json'
CONTENT = POIS.with_name('content-final.json')
MODELS = ROOT / 'public/models/landmarks'
PREFIX = 'hamasen-poi-'
# Exterior landings at the school gate, the foot of the temple/Wude approach,
# the station plaza/ramp ends and the pedestrian side of the ferry terminal.
LANDMARKS = {
    'gushan-elementary-school': ('hamasen-gushan-school', (492.75, 323)),
    'kaohsiung-butokuden': ('hamasen-wude', (601, 223)),
    'hamasen-daitian-temple': ('hamasen-temple', (503.89, 477.37)),
    'mrt-hamasen-exit-1': ('hamasen-mrt-exit-1', (700, 489.4)),
    'mrt-hamasen-exit-2': ('hamasen-mrt-exit-2', (917.65, 540.2)),
    'lrt-hamasen': ('hamasen-light-rail', (942.5, 563)),
    'takao-railway-museum': ('hamasen-railway-museum', (918.3, 536.4)),
    'gushan-ferry-pier': ('hamasen-gushan-ferry', (376.35, 737.4)),
}
# The ferry sign is on the southern half of the long street facade.
LANDMARK_SUBJECTS = {'gushan-ferry-pier': (365.07, 741.69)}


def read(path):
    return json.loads(path.read_text(encoding='utf-8'))


def xz(node):
    x, _, z = node['p']
    return x, z


def graph_text(graph):
    return json.dumps(graph, ensure_ascii=False, separators=(',', ':')) + '\n'


def shop_candidates(front, approach):
    if 'approach' in front:
        yield front['approach']
    elif approach:
        yield approach
    x, z = front['x'], front['z']
    nx, nz = front['facing']
    # Recessed doors and very narrow waterfront alleys can put the supplied
    # approach inside a footprint. Try the outside normal and nearby frontage.
    for offset in (1.2, 1.6, 2, 2.5, 3, 3.6, 4.2, .8, .5):
        for side in (0, -.6, .6, -1.2, 1.2, -2, 2, -3, 3):
            yield x + nx * offset - nz * side, z + nz * offset + nx * side


def model_footprints(placements):
    for model in LANDMARKS.values():
        model_id = model[0]
        place = placements[model_id]
        yaw = place['yaw']
        for part in read(MODELS / f'{model_id}.collision.json')['boxes']:
            x, _, z = part['center']
            w, _, d = part['size']
            rect = rotate(box(-w/2, -d/2, w/2, d/2), -part['yaw'], origin=(0, 0), use_radians=True)
            rect = translate(rect, x, z)
            yield translate(rotate(rect, -yaw, origin=(0, 0), use_radians=True), *place['centroid'])


def add_pois(graph):
    context = read(STRUCTURE)['context']
    sources = read(POIS)
    places = {p['id']: p for kind in ('landmarks', 'shops') for p in sources[kind]}
    fronts = {p['id']: p for p in read(SHOPFRONTS)['shops']}
    cards = read(CONTENT)['infoCards']
    if set(cards) != set(LANDMARKS) | set(fronts):
        raise ValueError('Card IDs must match the landmark models and shopfronts.')
    placements = read(MODELS / 'placements.json')
    terrain = Terrain()
    buildings = [b for kind in ('background', 'landmarks') for b in context[kind]]
    footprints = [ground_footprint(b) for b in buildings if not b.get('visualOnly')
                  and b.get('osmId') not in MODEL_WAYS
                  and not (b['id'].startswith('osm-') and b['id'].split('-')[1].isdigit()
                           and int(b['id'].split('-')[1]) in MODEL_WAYS)]
    footprints.extend(pier for b in buildings for pier in arcade_piers(b))
    footprints.extend(model_footprints(placements))
    solid = unary_union(footprints).buffer(.34)
    usable = DISTRICT.intersection(PLAY_AREA.buffer(-.38))
    streets = [(LineString(r['points']), r['width']) for r in context['roads']
               if r.get('district') == 'hamasen' and r['kind'] in VEHICLE_KINDS and not r.get('tunnel')]
    lane_centers = unary_union([line.buffer(min(width * .24, 1.6)) for line, width in streets])
    water = unary_union([Polygon(w['points']) for w in context['water'] if w['kind'] == 'water'])
    approaches = {s['id']: s['approach'] for b in buildings for s in b.get('shopfronts', [])}
    nodes, edges, kinds, anchors = (graph[key] for key in ('nodes', 'edges', 'edgeKind', 'anchors'))
    previous = graph.pop('hamasenPois', None)
    if previous:
        del nodes[previous['baseNodes']:]
        del edges[previous['baseEdges']:]
        del kinds[previous['baseEdges']:]
        for key in list(anchors):
            if key.startswith(PREFIX):
                del anchors[key]
    base_nodes, base_edges = len(nodes), len(edges)
    # Only attach to street nodes reachable from the tunnel portal. Reject
    # connectors through buildings and the model collision footprints.
    neighbors = defaultdict(list)
    for (a, b, _), kind in zip(edges, kinds):
        if kind != 'tunnel':
            neighbors[a].append(b)
            neighbors[b].append(a)
    start = anchors['hamasen-east-link']['node']
    connected = {start}
    pending = [start]
    while pending:
        for node in neighbors[pending.pop()]:
            if node not in connected:
                connected.add(node)
                pending.append(node)
    street_nodes = [(node['id'], xz(node)) for node in nodes if node['id'] in connected and DISTRICT.covers(Point(xz(node)))]
    result = {}
    for key, card in cards.items():
        pid = PREFIX + key
        place = places[key]
        if key in LANDMARKS:
            model, entrance = LANDMARKS[key]
            candidates = [entrance]
            position = LANDMARK_SUBJECTS.get(key, placements[model]['centroid'])
            label_height = place['appearance']['heightM'] + 1
            street = place['street']
        else:
            front = fronts[key]
            candidates = shop_candidates(front, approaches.get(key))
            position = [front['x'], front['z']]
            label_height = 4.5
            street = front['street']
        for candidate in candidates:
            x, z = (round(v, 2) for v in candidate)
            point = Point(x, z)
            if not usable.covers(point) or solid.covers(point) or lane_centers.covers(point) or water.covers(point):
                continue
            y = round(terrain.y(x, z), 2)
            nearby = sorted((math.dist((x, z), pos), n, pos) for n, pos in street_nodes)
            links = []
            for distance, n, pos in nearby:
                if distance > 25 or len(links) == 3:
                    break
                if abs(y - nodes[n]['p'][1]) > max(.7, distance * .37):
                    continue
                path = LineString([(x, z), pos])
                if distance > .02 and (solid.intersects(path) or water.intersects(path)):
                    continue
                links.append((distance, n))
            if links:
                break
        else:
            raise ValueError(f'{key}: no clear outdoor approach near {position} ({entrance if key in LANDMARKS else approaches.get(key)})')
        n = links[0][1] if links[0][0] <= .02 else len(nodes)
        if n == len(nodes):
            nodes.append({'id': n, 'p': [x, y, z]})
            for _, other in links:
                edges.append([n, other, round(math.dist(nodes[n]['p'], nodes[other]['p']), 2)])
                kinds.append('anchor-link')
        anchors[pid] = {'node': n, 'label': card['name'], 'source': str(POIS.relative_to(ROOT))}
        result[pid] = {**card, 'poi': {'position': position, 'approach': nodes[n]['p'], 'labelHeight': label_height,
                                      'street': street, 'buildingIds': place.get('buildingIds', [place.get('buildingId')])}}
    graph['stats'].update(nodes=len(nodes), edges=len(edges), totalLength=round(sum(e[2] for e in edges), 1))
    graph['hamasenPois'] = {'baseNodes': base_nodes, 'baseEdges': base_edges}
    return result


def info_text(original, cards):
    # Each generated entry starts on its own line. Remove only these entries
    # before appending the refreshed block, even if new manual entries follow it.
    original = re.sub(r',\n  "hamasen-poi-[^"]+": \{.*?\n  \}', '', original, flags=re.S)
    end = original.index('\n },\n "stories":')
    entries = json.dumps(cards, ensure_ascii=False, indent=1).splitlines()[1:-1]
    return original[:end] + ',\n' + '\n'.join(' ' + entry for entry in entries) + original[end:]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    parser.add_argument('--graph-only', action='store_true', help='Rebuild approaches without rewriting campus-info.json.')
    parser.add_argument('--graph', type=type(GRAPH), default=GRAPH)
    args = parser.parse_args()
    graph = read(args.graph)
    if 'hamasen' not in graph:
        parser.error('Run apply_hamasen.py graph first.')
    bus = graph.get('v12')
    graph_before = graph_text(graph)
    if bus:
        from apply_v12_bus import strip_v12
        strip_v12(graph)
        graph_before = graph_text(graph)
    cards = add_pois(graph)
    original = INFO.read_text(encoding='utf-8') if not args.graph_only else None
    info = info_text(original, cards) if original is not None else None
    graph_stale = graph_text(graph) != graph_before
    if ((args.check or bus) and graph_stale) or (args.check and info != original):
        parser.exit(1, 'Hamasen POIs are stale. Regenerate the graph, POIs and bus layer in order.\n')
    if not args.check:
        if graph_stale:
            args.graph.write_text(graph_text(graph), encoding='utf-8')
        if info != original:
            INFO.write_text(info, encoding='utf-8')
    print(f'Hamasen POIs: {len(cards)} cards and outdoor approaches')


if __name__ == '__main__':
    main()
