#!/usr/bin/env python3
"""Apply on-campus dining & dormitory POIs to campus-info.json and outdoor-graph.json."""
from __future__ import annotations

import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'data/sources/campus-life-pois.json'
INFO = ROOT / 'public/data/campus-info.json'
GRAPH = ROOT / 'public/data/walkthrough/outdoor-graph.json'


def write_json(path: Path, data: object, *, compact: bool = False) -> None:
    if compact:
        text = json.dumps(data, ensure_ascii=False, separators=(',', ':'))
    else:
        text = json.dumps(data, ensure_ascii=False, indent=1)
    path.write_text(text + '\n', encoding='utf-8')


def nearest_node(nodes: list[dict], x: float, z: float) -> tuple[dict, float]:
    best = None
    best_d = float('inf')
    for node in nodes:
        nx, _, nz = node['p']
        d = math.hypot(nx - x, nz - z)
        if d < best_d:
            best_d = d
            best = node
    assert best is not None
    return best, best_d


def main() -> None:
    src = json.loads(SOURCE.read_text(encoding='utf-8'))
    info = json.loads(INFO.read_text(encoding='utf-8'))
    graph = json.loads(GRAPH.read_text(encoding='utf-8'))

    buildings: dict = info['buildings']
    for bid, patch in src.get('buildingUpdates', {}).items():
        if bid not in buildings:
            continue
        card = buildings[bid]
        if 'summary' in patch:
            card['summary'] = patch['summary']
        if 'facts' in patch:
            card['facts'] = list(patch['facts'])

    nodes: list[dict] = graph['nodes']
    anchors: dict = graph.setdefault('anchors', {})
    # Remove any stale campus-poi / campus-dorm entries before writing fresh set.
    for key in [k for k in list(buildings) if k.startswith(('campus-poi-', 'campus-dorm-'))]:
        buildings.pop(key, None)
    for key in [k for k in list(anchors) if k.startswith(('campus-poi-', 'campus-dorm-'))]:
        anchors.pop(key, None)

    report = []
    for place in src['places']:
        pid = place['id']
        px, pz = place['position']
        node, dist = nearest_node(nodes, px, pz)
        ax, ay, az = node['p']
        buildings[pid] = {
            'name': place['name'],
            'kind': place['kind'],
            'category': place['category'],
            'summary': place['summary'],
            'facts': list(place.get('facts', [])),
            'links': list(place.get('links', [])),
            'poi': {
                'position': [round(px, 2), round(pz, 2)],
                'approach': [round(ax, 2), round(ay, 2), round(az, 2)],
                'labelHeight': place.get('labelHeight', 4.5),
                'street': place.get('area', '中山大學校內'),
                'buildingIds': [],
            },
        }
        anchors[pid] = {
            'node': node['id'],
            'label': place['name'],
            'roadNode': node['id'],
        }
        report.append((pid, place['name'], node['id'], round(dist, 1)))

    write_json(INFO, info, compact=False)
    write_json(GRAPH, graph, compact=True)
    print(f'Applied {len(report)} campus dining/dormitory POIs:')
    for pid, name, nid, d in report:
        print(f'  {pid:30s} {name:20s} -> node {nid} ({d}m)')


if __name__ == '__main__':
    main()
