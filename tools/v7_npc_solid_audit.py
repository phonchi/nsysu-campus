#!/usr/bin/env python3
"""Offline: no NPC schedule spot, story NPC spot, quest zone or anchor used by the walk may sit inside a solid landmark box."""
import json, math, sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
P = json.loads((ROOT / 'public/models/landmarks/placements.json').read_text())
Z = json.loads((ROOT / 'public/data/story-zones.json').read_text())
G = json.loads((ROOT / 'public/data/walkthrough/outdoor-graph.json').read_text())
N = json.loads((ROOT / 'public/data/npcs.json').read_text())
Q = json.loads((ROOT / 'public/data/quests.json').read_text())
nodes = G['nodes']
def node(i):
    p = nodes[i]['p']
    return p[0], p[2]
def anchor(a):
    if isinstance(a, list): return tuple(a)
    z = Z['zones'].get(a)
    if z: return tuple(z['p'])
    g = G['anchors'].get(a)
    return tuple(node(g['node'])) if g else None
boxes = []
for lid, p in P.items():
    if not isinstance(p, dict) or 'centroid' not in p or p.get('path') or lid == 'tunnel': continue
    f = ROOT / f'public/models/landmarks/{lid}.collision.json'
    if not f.exists(): continue
    cx, cz = p['centroid']; yaw = p.get('yaw', 0)
    for b in json.loads(f.read_text())['boxes']:
        if b['size'][1] < 1.2 or b['center'][1] - b['size'][1] / 2 > 1.5: continue  # kerbs and overhead slabs do not trap a walker
        x, _, z = b['center']; c, s = math.cos(yaw), math.sin(yaw)
        boxes.append((lid, cx + x * c + z * s, cz - x * s + z * c, b['size'][0] / 2, b['size'][2] / 2, yaw + b['yaw']))
def inside(x, z, m=.3):
    for lid, bx, bz, hx, hz, yaw in boxes:
        c, s = math.cos(yaw), math.sin(yaw); dx, dz = x - bx, z - bz
        if abs(dx * c - dz * s) < hx + m and abs(dx * s + dz * c) < hz + m: return lid
spots = []
for n in N['npcs']:
    for preset, v in (n.get('schedule') or {}).items():
        if not v: continue
        a = anchor(v['at'])
        if a: o = v.get('offset', [0, 0]); spots.append((f"npc {n['id']} {preset} at={v['at']}", a[0] + o[0], a[1] + o[1]))
for sid, v in Z.get('npcs', {}).items():
    a = anchor(v['at'])
    if a: o = v.get('offset', [0, 0]); spots.append((f"story {sid} at={v['at']}", a[0] + o[0], a[1] + o[1]))
for q in Q['quests']:
    for s in q['steps']:
        k, i = s['target'].split(':')
        if k == 'zone' and anchor(i): spots.append((f"quest {q['id']}/{s['id']} {s['target']}", *anchor(i)))
for a in ['arcade', 'admin', 'library', 'YH', 'SPORT', 'CMSS']:
    if anchor(a): spots.append((f'ambient anchor {a}', *anchor(a)))
bad = [(name, round(x, 2), round(z, 2), inside(x, z)) for name, x, z in spots if inside(x, z)]
for row in bad: print(row)
print(f'{len(spots)} spots, {len(boxes)} solid boxes, {len(bad)} inside')
sys.exit(1 if bad else 0)
