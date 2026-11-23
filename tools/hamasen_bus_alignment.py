"""Project the frozen, directed OSM road alignments for the Hamasen bus stops."""
from __future__ import annotations

import hashlib
import json
import math
from functools import lru_cache
from pathlib import Path

from build_campus_structure import project

ROOT = Path(__file__).resolve().parents[1]
SNAPSHOT = ROOT / 'data/sources/osm/osm-hamasen-bus.json'
DIRECTIONS = ('gateToTerminal', 'terminalToGate')
NO_ACCESS = {'no', 'private'}
FORWARD = {'yes', '1', 'true'}


@lru_cache(maxsize=1)
def _load() -> tuple[dict, dict[int, tuple[float, float]], str]:
    raw = SNAPSHOT.read_bytes()
    data = json.loads(raw)
    points = {int(node): project(*coordinates) for node, coordinates in data['nodes'].items()}
    return data, points, hashlib.sha256(raw).hexdigest()


def _berth(way_nodes: list[int], points: dict[int, tuple[float, float]], stop: tuple[float, float]):
    """Measure from the mapped curb node to its nearest point on the road."""
    candidates = []
    for i, (a, b) in enumerate(zip(way_nodes, way_nodes[1:]), start=1):
        ax, az = points[a]
        bx, bz = points[b]
        dx, dz = bx - ax, bz - az
        if dx == dz == 0:
            continue
        along = ((stop[0] - ax) * dx + (stop[1] - az) * dz) / (dx * dx + dz * dz)
        fraction = max(0.0, min(1.0, along))
        projected = ax + fraction * dx, az + fraction * dz
        candidates.append((math.dist(stop, projected), i, projected))
    _, index, projected = min(candidates)
    return index, projected


def _alignment(data, terminal, direction, points, berth_index):
    gate = data['gateNode']
    current, destination = (gate, 'berth') if direction == 'gateToTerminal' else ('berth', gate)
    path = []
    for way_id, start, end in terminal[direction]:
        if start != current:
            raise ValueError(f'OSM way {way_id} does not connect at node {current}')
        way = data['ways'][str(way_id)]
        road_nodes = list(way['nodes'])
        if way_id == terminal['roadWay']:
            road_nodes.insert(berth_index, 'berth')
        first, last = road_nodes.index(start), road_nodes.index(end)
        step = 1 if first < last else -1
        tags = way['tags']
        oneway = tags.get('oneway')
        if (any(tags.get(key) in NO_ACCESS for key in ('access', 'vehicle', 'motor_vehicle', 'motorcar', 'bus'))
                or (step == -1 and oneway in FORWARD)
                or (step == 1 and oneway == '-1')):
            raise ValueError(f'OSM way {way_id} cannot be driven from {start} to {end}')
        segment = [points[road_nodes[i]] for i in range(first, last + step, step)]
        path.extend(segment[1:] if path else segment)
        current = end
    if current != destination:
        raise ValueError(f'{direction} ended at {current}, expected {destination}')
    return path


@lru_cache(maxsize=2)
def _routes(terminal_id):
    data, nodes, _ = _load()
    terminal = data['terminals'][terminal_id]
    stop_road = data['ways'][str(terminal['roadWay'])]['nodes']
    index, projected = _berth(stop_road, nodes, nodes[terminal['stopNode']])
    points = {**nodes, 'berth': projected}
    return tuple(_alignment(data, terminal, direction, points, index) for direction in DIRECTIONS)


def alignments(terminal_id: str) -> tuple[list[list[float]], list[list[float]]]:
    """Return world XZ paths from gate-out to berth and from berth to gate-in."""
    outbound, inbound = _routes(terminal_id)
    return [[round(x, 3), round(z, 3)] for x, z in outbound], [[round(x, 3), round(z, 3)] for x, z in inbound]


def provenance(terminal_id: str) -> dict:
    """Describe the frozen extracts and the measured length of each directed path."""
    data, _, digest = _load()
    terminal = data['terminals'][terminal_id]
    paths = _routes(terminal_id)
    return {
        'file': str(SNAPSHOT.relative_to(ROOT)),
        'sha256': digest,
        'license': data['license'],
        'licenseUrl': data['licenseUrl'],
        'extracts': list(data['sources'].values()),
        'gateOsmNodeId': data['gateNode'],
        'terminalOsmNodeId': terminal['stopNode'],
        'terminalRoadWayId': terminal['roadWay'],
        'directions': {
            direction: {
                'osmWayIds': [way for way, _, _ in terminal[direction]],
                'lengthM': round(sum(math.dist(a, b) for a, b in zip(path, path[1:])), 1),
            }
            for direction, path in zip(DIRECTIONS, paths)
        },
    }
