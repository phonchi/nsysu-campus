#!/usr/bin/env python3
"""v9.1 door edits to SC.json, idempotent. Each door is read from the door arc on the official plan; positions are 2x plan pixels, snapped to the room's nearest wall.
Each becomes a floor virtualPortalOverrides entry, which replaces the planner's doors on other walls. Rooms absent from DOORS keep their planned door (see artifacts/v9.1/verification.md)."""
import hashlib
import json
import sys
from pathlib import Path
from shapely.geometry import LineString, Point, Polygon, box

ROOT = Path(__file__).resolve().parents[1]
SC = ROOT / 'public/data/walkthrough/SC.json'
REVIEW = ROOT / 'public/data/walkthrough/final-three-door-source-review.json'
# The planner clips rooms to the stair bodies, so doors go on the clipped walls.
CLIPPED = json.loads((ROOT / 'public/data/walkthrough/campus-structure.json').read_text())['roomOverrides']
NEAR, MARGIN, WIDTH = .7, .56, 1.0
# SC4019's trace runs a thin tail along SC4024's corridor wall (2x plan pixels: x0, x1, z0, z1).
TRIM = {'SC-4F': {'034': (2460, 2565, 1325, 1352)}}
# Voids drawn with an X on the plans (same units: x0, x1, z0, z1), the narrow one under the north stair and the small one south of it.
VOIDS = {'SC-2F': [(2980, 3165, 890, 1000)], 'SC-3F': [(2855, 2970, 385, 755), (2985, 3170, 868, 948)], 'SC-4F': [(2822, 2937, 392, 765), (2950, 3165, 875, 955)]}
# The trace took plan lettering for building (local x0, z0, x1, z1): "東綜合大樓" on 1F and 3F, the SC4023-26 labels on 4F.
LETTERING = {'SC-1F': (-95, 25.45, 40, 45), 'SC-3F': (-67, 23.6, -52, 30), 'SC-4F': (-35, 23.0, -13, 30)}
# X-marked shaft beside the SC-stair-5, B1 to 4F on both plan sets (local x0, z0, x1, z1; B1 from its own registration).
SHAFT = {'SC-B1': (-24.8, 14.7, -22.8, 16.7), **{f: (-25.1, 14.8, -23.1, 16.9) for f in ('SC-1F', 'SC-2F', 'SC-3F', 'SC-4F')}}
# B1 and RF were registered schematically. Their stairs, read off the plans, all sit the same way off the 1F-4F stair stack (local metres).
SHIFT = {'SC-B1': (1.85, 0.0), 'SC-RF': (1.6, 2.0)}
# Door-leaf fragments in the trace that a door can't cut through: filled, inside the room (2x plan pixels: x0, x1, z0, z1).
FILL = {'SC-B1': {'037': [(738, 772, 2205, 2275)], '055': [(1366, 1405, 2184, 2262)], '039': [(1170, 1213, 2186, 2262), (1198, 1226, 1925, 1965), (1168, 1200, 1985, 2012)], '040': [(1361, 1395, 1928, 1972)]}}
# Traced as rooms; the plans draw stair lobbies and a light well outside the wall. (The structure tool drops them from the walls.)
KINDS = {'SC-B1-region-001': 'light-well', 'SC-B1-region-026': 'light-well', 'SC-B1-region-042': 'stair-lobby', 'SC-B1-region-047': 'stair-lobby',
         'SC-3F-region-022': 'lift-symbol', 'SC-4F-region-033': 'lift-symbol'}
DOORS = {
    'SC-3F': {'021': (4142, 1085, 'v'), '008': (4114, 258), '009': (4114, 302), '011': (4108, 452), '014': (4114, 497), '015': (4108, 647), '016': (4114, 692), '019': (4114, 835),
              '003': (3408, 370), '004': (3603, 370), '005': (3892, 370), '006': (3955, 366), '007': (3188, 230), '013': (3188, 715, 'v'), '017': (3184, 790, 'v'),
              '002': (2776, 325, 'v'), '010': (2776, 425), '012': (2710, 476), '030': (2058, 1364), '032': (1700, 1372), '024': (2786, 1315),
              '028': (1385, 1370), '025': (1042, 1210, 'v'), '023': (612, 1366), '031': (225, 1368), '033': (564, 1290)},
    'SC-4F': {'006': (4070, 272), '010': (4070, 314), '011': (4070, 467), '016': (4070, 512), '018': (4070, 657), '019': (4068, 700), '025': (4070, 845),
              '002': (3250, 380), '004': (3968, 384), '005': (3150, 272), '009': (3150, 312), '015': (3150, 510), '020': (3150, 657), '023': (3150, 692), '024': (3150, 845),
              '001': (2746, 340, 'v'), '012': (2746, 430), '014': (2680, 488), '022': (2746, 815), '034': (2665, 1310), '040': (2350, 1346), '041': (2390, 1346), '042': (2540, 1346),
              '032': (1892, 1030), '036': (1892, 1077), '037': (2035, 1364), '031': (1845, 1364), '030': (1370, 1370), '029': (892, 1364), '039': (366, 1240),
              '026': (320, 1138), '027': (410, 1140), '028': (505, 1140), '038': (462, 1245)},
    'SC-B1': {'012': (3410, 1418), '014': (3410, 1452), '019': (3410, 1560), '020': (3410, 1612), '023': (3410, 1720), '024': (3410, 1772), '010': (3448, 1250),
              '008': (2750, 1432), '046': (3432, 2270, 'v'), '033': (3423, 1969), '056': (2671, 2176), '051': (2628, 2118, 'v'), '025': (2610, 1832), '013': (2650, 1480), '011': (2644, 1305),
              '002': (2602, 1250), '005': (2306, 1400), '006': (2306, 1305), '016': (2306, 1485), '021': (2306, 1795), '032': (2064, 1950, 'v'), '041': (1960, 1994),
              '048': (2365, 2002), '049': (2316, 2225, 'v'), '055': (1366, 2215, 'v'),
              '015': (1994, 1465, 'v'), '039': (1213, 2202, 'v'), '035': (530, 2172), '036': (724, 1950, 'v'), '037': (738, 2240, 'v'), '040': (1361, 1950, 'v'), '052': (2215, 2074), '053': (565, 2240, 'v')},
    'SC-1F': {'SC1011': (2873, 1151)},
    'SC-2F': {'SC2001': (4114, 1125, 'v'), 'SC2011': (2772, 367, 'v')},
}


def wall_at(poly, p):
    """The nearest axis-aligned edge to p: (axis along the wall, wall coordinate). Door-arc spikes are too short to count."""
    best = None
    for a, b in zip(poly, poly[1:] + poly[:1]):
        for axis in (0, 1):
            across = 1 - axis
            if abs(a[across] - b[across]) > .12:
                continue
            length = abs(a[axis] - b[axis])
            near = LineString([a, b]).distance(Point(p))
            # Nearest wall first: beside a corner the longer partition must not win over the wall with the arc.
            rank = (round(near / .2), -length)
            if near <= NEAR and length >= .4 and (best is None or rank < best[0]):
                best = (rank, axis, (a[across] + b[across]) / 2)
    return best and best[1:]


def door_entry(f, room, target, forced=None):
    clipped = CLIPPED.get(f['id'], {})
    poly = clipped.get(room['id']) or room['polygon']
    found = (1, target[0]) if forced == 'v' else wall_at(poly, target)
    if not found:
        print('no wall', room['id'], target)
        return None
    axis, wall = found
    across = 1 - axis
    # Keep the leaf off the corners of this wall.
    along = [v[axis] for v in poly if abs(v[across] - wall) <= .75]
    lo, hi = min(along) + MARGIN, max(along) - MARGIN
    at = max(lo, min(hi, target[axis])) if lo <= hi else (min(along) + max(along)) / 2
    inward = 1 if Polygon(poly).buffer(0).representative_point().coords[0][across] > wall else -1
    door, far = [0, 0], [0, 0]
    door[axis] = far[axis] = at
    door[across], far[across] = wall, wall - inward * .02
    neighbor = '@public'
    for other in f['rooms']:
        if other is room or (other['id'] in clipped and clipped[other['id']] is None):
            continue
        shape = Polygon(clipped.get(other['id']) or other['polygon']).buffer(0)
        # Straight across the wall, so the room beside this one along the same corridor doesn't count.
        probes = [wall - inward * d for d in (.35, .7, 1.0)]
        if any(shape.distance(Point([at, c] if axis == 0 else [c, at])) <= .1 for c in probes):
            neighbor = other['id']
            # First point of the neighbour straight across the wall: a diagonal portal would twist the door.
            for d in (x * .05 for x in range(1, 25)):
                c = wall - inward * d
                q = [at, c] if axis == 0 else [c, at]
                if shape.buffer(.002).covers(Point(q)):
                    far = q
                    break
            break
    door = [round(v, 4) for v in door]; far = [round(v, 4) for v in far]
    room['door']['position'] = door
    room['door'].update(basis='map-derived', width=WIDTH, note='依官方平面圖門弧；未經現地。')
    room['door'].pop('outsideHint', None)
    return {'roomId': room['id'], 'neighborRoomId': neighbor, 'planDoor': True, 'basis': 'map-derived',
            'sourceReview': {'report': 'tools/apply_v91_sc_doors.py', 'entryId': room['id']},
            'suggestedPortal': {'width': WIDTH, 'perRoomPosition': {room['id']: door, neighbor: far}},
            'geometryWarning': '官方平面圖門弧把描圖的牆切碎；只在這道門的範圍內修正。'}


def shifted(f, dx, dz):
    move = lambda p: [round(p[0] + dx, 4), round(p[1] + dz, 4)]
    f['outline'] = [move(p) for p in f['outline']]
    f['holes'] = [[move(p) for p in h] for h in f['holes']]
    for room in f['rooms']:
        room['polygon'] = [move(p) for p in room['polygon']]
        room['door']['position'] = move(room['door']['position'])
    for note in f.get('mapAnnotations', []):
        if note.get('position'):
            note['position'] = move(note['position'])
    t = f['transform']
    t['imageOriginPixels'] = [t['imageOriginPixels'][0] - dx / t['metresPerPixel'], t['imageOriginPixels'][1] - dz / t['metresPerPixel']]
    t['alignmentBasis'] = 'stair-stack-v9.1'
    review = json.loads(REVIEW.read_text())
    for entry in review['entries']:
        if entry['floorId'] == f['id']:
            spots = entry['suggestedPortal']['perRoomPosition']
            for rid in spots:
                spots[rid] = move(spots[rid])
    REVIEW.write_text(json.dumps(review, ensure_ascii=False, indent=2) + '\n')


def main():
    data = json.loads(SC.read_text())
    for f in data['floors']:
        if f['id'] in SHIFT and f['transform'].get('alignmentBasis') != 'stair-stack-v9.1':
            shifted(f, *SHIFT[f['id']])
        for room in f['rooms']:
            if room['id'] in KINDS:
                room['kind'] = KINDS[room['id']]
            key = room['id'].rsplit('-', 1)[-1]
            if key in FILL.get(f['id'], {}):
                t = f['transform']; m = t['metresPerPixel']; ox, oy = t['imageOriginPixels']
                shape = Polygon(room['polygon']).buffer(0)
                for x0, x1, z0, z1 in FILL[f['id']][key]:
                    shape = shape.union(box((x0 / 2 - ox) * m, (z0 / 2 - oy) * m, (x1 / 2 - ox) * m, (z1 / 2 - oy) * m))
                room['polygon'] = [[round(x, 4), round(y, 4)] for x, y in list(Polygon(shape.exterior).simplify(.002).exterior.coords)[:-1]]
        if '--shift-only' in sys.argv:
            continue
        t = f['transform']; m = t['metresPerPixel']; ox, oy = t['imageOriginPixels']
        for x0, x1, z0, z1 in VOIDS.get(f['id'], []):
            hole = [[round((x / 2 - ox) * m, 4), round((z / 2 - oy) * m, 4)] for x, z in ((x0, z0), (x1, z0), (x1, z1), (x0, z1))]
            if hole not in f['holes']:
                f['holes'].append(hole)
        # 3F and 4F corridors end in a windowed outer wall on both plan sets; 2F's west wing is an open terrace.
        if f['id'] in ('SC-3F', 'SC-4F'):
            f['enclosedWalls'] = True
        if f['id'] in LETTERING:
            shape = Polygon(f['outline']).buffer(0).difference(box(*LETTERING[f['id']]))
            shape = max(getattr(shape, 'geoms', [shape]), key=lambda q: q.area)
            f['outline'] = [[round(x, 4), round(y, 4)] for x, y in list(shape.exterior.coords)[:-1]]
        if f['id'] in SHAFT:
            x0, z0, x1, z1 = SHAFT[f['id']]
            f['verticalServices'] = [dict(id=f"{f['id']}-shaft-x", kind='shaft', basis='map-derived', polygon=[[x0, z0], [x1, z0], [x1, z1], [x0, z1]])]
        table = DOORS.get(f['id'])
        if not table:
            continue
        entries = []
        for room in f['rooms']:
            key = room['id'].rsplit('-', 1)[-1]
            if key in TRIM.get(f['id'], {}):
                x0, x1, z0, z1 = [(v / 2 - (ox if i < 2 else oy)) * m for i, v in enumerate(TRIM[f['id']][key])]
                shape = Polygon(room['polygon']).buffer(0).difference(box(x0, z0, x1, z1))
                shape = max(getattr(shape, 'geoms', [shape]), key=lambda q: q.area)
                room['polygon'] = [[round(x, 4), round(y, 4)] for x, y in list(shape.exterior.coords)[:-1]]
        for room in f['rooms']:
            key = room['id'].rsplit('-', 1)[-1]
            if key in table:
                X, Z, *forced = table[key]
                entry = door_entry(f, room, [(X / 2 - ox) * m, (Z / 2 - oy) * m], *forced)
                if entry:
                    entries.append(entry)
        f['virtualPortalOverrides'] = entries
    SC.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')
    review = json.loads(REVIEW.read_text())
    sha = hashlib.sha256(SC.read_bytes()).hexdigest()
    if review['sourceBuildingSHA256']['SC'] != sha:
        review['sourceBuildingSHA256']['SC'] = sha
        review.setdefault('sourceSHARefreshHistory', []).append('v9.1: SC.json 3F/4F/B1 doors from plan door arcs; reviewed B1 entry unaffected.')
    REVIEW.write_text(json.dumps(review, ensure_ascii=False, indent=2) + '\n')
    print('SC', sha)


main()
