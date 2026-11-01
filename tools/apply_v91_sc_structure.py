#!/usr/bin/env python3
"""v9.1: SC stairs, lift and voids as the official plans draw them, idempotent. Replaces the schematic SC entries in campus-structure.json
(run after build_campus_structure.py, before build_floor_access.py). A stair runs up one straight stack, so B1 and RF, whose plans register less well, inherit the 1F-4F position."""
import json
import math
from pathlib import Path
from shapely.geometry import Point, Polygon, box
from shapely.affinity import rotate, translate

ROOT = Path(__file__).resolve().parents[1]
PATH = ROOT / 'public/data/walkthrough/campus-structure.json'
SC = json.loads((ROOT / 'public/data/walkthrough/SC.json').read_text())
# Traced as rooms, but the plans draw them as stair lobbies open to their doors, or as a light well outside the wall.
NOT_ROOMS = {'SC-B1': ['SC-B1-region-001', 'SC-B1-region-026', 'SC-B1-region-042', 'SC-B1-region-047']}
STOREY = {'SC-B1': -1, 'SC-1F': 1, 'SC-2F': 2, 'SC-3F': 3, 'SC-4F': 4, 'SC-RF': 5}
LEVEL = {'SC-B1': -1, 'SC-1F': 1, 'SC-2F': 2, 'SC-3F': 3, 'SC-4F': 4, 'SC-RF': 99}
ALL = list(STOREY)
NORTH_IN, SOUTH_IN, WEST_IN = math.pi / 2, -math.pi / 2, 0.0  # the side the flights are entered from
STAIRS = [
    # id, centre, entered from, length, width, apron, floors, what the plans show
    ('SC-stair-1', (-20.15, -3.16), WEST_IN, 3.2, 2.5, 1.2, ALL[:5], '北側狹長挑空上端的梯，B1 至 4F 都畫有踏階；RF 未見。'),
    ('SC-stair-2', (-.07, 3.45), NORTH_IN, 4.1, 4.4, 1.6, ALL, '中央主梯，B1 至 RF 都畫有踏階，踏階沿南北。'),
    ('SC-stair-3', (-70.41, 15.8), SOUTH_IN, 3.2, 3.8, .6, ALL, '東綜合大樓西側梯，B1 至 RF 都畫有踏階，南面開口；2F 南緣到牆僅約 0.6 m。'),
    ('SC-stair-4', (-52.29, 15.8), SOUTH_IN, 3.2, 3.8, .6, ALL, '東綜合大樓東側梯，B1 至 RF 都畫有踏階，南面開口；2F 南緣到牆僅約 0.6 m。'),
    ('SC-stair-5', (-28.44, 16.54), NORTH_IN, 4.6, 2.5, 1.6, ALL, '電梯旁的梯，B1 至 RF 都畫有踏階，北面朝走廊。'),
    ('SC-stair-6', (7.75, 17.0), NORTH_IN, 3.6, 2.1, 1.6, ALL[1:5], '中庭東側梯，1F 至 4F 都畫有踏階（3F 未上色）；B1、RF 未見。'),
]
LINK_END = {'SC-EN-2': (-87.3, 12.6)}
LIFT = dict(id='SC-lift-1', center=[-14.4, 14.95], angle=math.pi, size=2.0, floors=ALL[:5], evidence='位置依官方平面圖電梯符號，開口朝東側走廊。')


def rect(center, length, width, angle):
    return translate(rotate(box(-length / 2, -width / 2, length / 2, width / 2), angle, origin=(0, 0), use_radians=True), *center)


def carve(rooms, geom):
    cut = geom.buffer(.12, join_style=2)
    for rid, poly in list(rooms.items()):
        if poly is None or not poly.intersects(cut):
            continue
        rest = poly.difference(cut)
        parts = sorted([g for g in getattr(rest, 'geoms', [rest]) if g.geom_type == 'Polygon'], key=lambda g: -g.area)
        rooms[rid] = parts[0] if parts and parts[0].area >= 1.6 else None


def main():
    data = json.loads(PATH.read_text())
    cores = []
    for sid, center, angle, length, width, apron, floors, evidence in STAIRS:
        cores.append(dict(id=sid, center=list(center), angle=angle, length=length, width=width, apron=apron, basis='map-derived', evidence=evidence,
                          levels=[dict(floorId=f, level=LEVEL[f], storey=STOREY[f], basis='map-derived', roomConflictArea=0.0, landingConnected=True) for f in floors]))
    data['stairCores']['SC'] = cores
    stops = [dict(floorId=f, level=LEVEL[f], storey=STOREY[f]) for f in LIFT['floors']]
    data['lifts']['SC'] = [dict(id=LIFT['id'], center=LIFT['center'], angle=LIFT['angle'], size=LIFT['size'], stops=stops, basis='map-derived', evidence=LIFT['evidence'])]
    for f in SC['floors']:
        fid = f['id']
        rooms = {r['id']: Polygon(r['polygon']).buffer(0) for r in f['rooms'] if len(r['polygon']) >= 3}
        original = dict(rooms)
        for rid in NOT_ROOMS.get(fid, []):
            rooms[rid] = None
        for core in cores:
            if any(l['floorId'] == fid for l in core['levels']):
                ux, uz = math.cos(core['angle']), math.sin(core['angle'])
                carve(rooms, rect(core['center'], core['length'], core['width'], core['angle']))
                d = core['length'] / 2 + core['apron'] / 2
                carve(rooms, rect((core['center'][0] - ux * d, core['center'][1] - uz * d), core['apron'], core['width'], core['angle']))
        if fid in LIFT['floors']:
            carve(rooms, rect(LIFT['center'], LIFT['size'], LIFT['size'], LIFT['angle']))
        changed = {rid: (None if p is None else [[round(x, 4), round(z, 4)] for x, z in list(p.exterior.coords)[:-1]]) for rid, p in rooms.items() if p is not original[rid]}
        if changed:
            data['roomOverrides'][fid] = changed
        else:
            data['roomOverrides'].pop(fid, None)
        print(fid, 'clipped', {k.split('-')[-1]: (None if v is None else len(v)) for k, v in changed.items()})
    # The links to EN landed on the old gallery. Run each one's own width on to the real wall ("往工學院" on the plans), and open the end where it arrives.
    place = data['placements']['SC']
    c, s, k = math.cos(place['rotation']), math.sin(place['rotation']), place['scale']
    to_local = lambda p: (((p[0] - place['x']) * c - (p[1] - place['z']) * s) / k, ((p[0] - place['x']) * s + (p[1] - place['z']) * c) / k)
    floors = {f['id']: f for f in SC['floors']}
    for link in data['connectors']:
        if 'SC' not in link['buildings']:
            continue
        fid = next(f for f in link['floors'] if f.startswith('SC-'))
        if link['id'] in LINK_END:
            # Lands where the plans write "往工學院".
            ex, ez = LINK_END[link['id']]
            link['a'] = [round(place['x'] + (ex * c + ez * s) * k, 3), round(place['z'] + (-ex * s + ez * c) * k, 3)]
            gap = math.dist(link['a'], link['b']); ux, uz = (link['b'][0] - link['a'][0]) / gap, (link['b'][1] - link['a'][1]) / gap
            half = link['width'] / 2
            link['gap'] = round(gap, 3)
            link['rails'] = [[[round(link['a'][0] + ux * .6 + sx * -uz * half, 3), round(link['a'][1] + uz * .6 + sx * ux * half, 3)], [round(link['b'][0] - ux * .6 + sx * -uz * half, 3), round(link['b'][1] - uz * .6 + sx * ux * half, 3)]] for sx in (-1, 1)]
        a, b = to_local(link['a']), to_local(link['b'])
        ax, az = a[0] - b[0], a[1] - b[1]; n = math.hypot(ax, az); ax, az = ax / n, az / n  # towards SC
        shape = Polygon(floors[fid]['outline']).buffer(-.3)
        reach = next((d * .25 for d in range(1, 80) if shape.contains(Point(a[0] + ax * d * .25, a[1] + az * d * .25))), 2.0)
        half = link['width'] / 2 / k
        tx, tz = -az, ax
        link['landing'] = [[a[0] + sx * tx * half + ax * d, a[1] + sx * tz * half + az * d] for sx, d in ((-1, 0), (1, 0), (1, reach), (-1, reach))]
        link['openings'][fid] = [{'p': [round(a[0], 4), round(a[1], 4)], 'width': round(link['width'] / k, 3)}]
    # Wall gaps kept for the old gallery: without it the walls are the building's own.
    for fid in list(data.get('railGaps', {})):
        if fid.startswith('SC-'):
            del data['railGaps'][fid]
    PATH.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')


main()
