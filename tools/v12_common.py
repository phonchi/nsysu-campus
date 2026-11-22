#!/usr/bin/env python3
"""Shared helpers for the v12 data tools (room splits, restrooms, lifts, rooms.json index).

Nothing here writes at import time. Building JSONs are always rebuilt from a restored
baseline (the rooms as they were before any v12 tool ran), so every tool is idempotent
and can be re-run after the v9 / v9.1 / office-expansion tools.
"""
from __future__ import annotations
import copy, hashlib, json, math, sys
from datetime import datetime, timezone
from pathlib import Path
from shapely.geometry import Polygon, Point, LineString, box
from shapely.ops import unary_union
from shapely.prepared import prep

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_floor_access as A  # noqa: E402  (pure functions only)

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'public/data/walkthrough'
REVIEW = DATA / 'final-three-door-source-review.json'
STRUCTURE = DATA / 'campus-structure.json'
ROOMS_INDEX = ROOT / 'public/data/rooms.json'
BIDS = ['SC', 'EN', 'BI', 'PH', 'CH', 'EC', 'MS', 'EV']
WC_ALIASES = ['廁所', '洗手間', 'WC', 'toilet']
MIN_BOX = (1.8, 2.2)  # hard floor (coordinator ruling, wpd-run round 2): split pairs and retried groups may go down to 1.8 x 2.2 m
PREFERRED_BOX = (2.0, 2.4)  # placement tries this first; only a group that cannot be placed retries with RELAXED_SIZES
RUNTIME_WORLD_BOX = (2.0, 2.4)  # src/world/restroom-interiors.ts planRestroom gate, in world metres (local x placement scale)


def min_box(bid):
    """Smallest restroom bounding box (local metres) for one building: coordinator floor 1.8 x 2.2 and the runtime gate 2.0 x 2.4 world."""
    scale = json.loads(STRUCTURE.read_text())['placements'][bid]['scale']
    return (round(max(MIN_BOX[0], RUNTIME_WORLD_BOX[0] / scale) + .005, 2), round(max(MIN_BOX[1], RUNTIME_WORLD_BOX[1] / scale) + .005, 2))


REGION_MAX_AREA = 16  # a traced region larger than this is never turned into a restroom (coordinator ruling)
CLEARANCE = .42
V12_REPORTS = ('tools/apply_v12_sc_rooms.py', 'tools/apply_v12_restrooms.py')
PART = {
    'F': dict(gender='female', accessible=False, displayName='女廁', suffix='F'),
    'M': dict(gender='male', accessible=False, displayName='男廁', suffix='M'),
    'A': dict(gender='unisex', accessible=True, displayName='無障礙廁所', suffix='A'),
    'U': dict(gender='unisex', accessible=False, displayName='廁所', suffix='U'),
    # merged men/women icon that cannot hold a legal pair even at 1.8 x 2.2 m: one shared room
    'S': dict(gender='unisex', accessible=False, displayName='廁所（男女共用）', suffix='U'),
}
SYMBOL_PARTS = {'mf': ['F', 'M'], 'f': ['F'], 'm': ['M'], 'accessible': ['A'], 'text': ['U']}


def dump(data, indent=2):
    return json.dumps(data, ensure_ascii=False, indent=indent) + '\n'


def sha(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def polys(g):
    if g is None or g.is_empty: return []
    if g.geom_type == 'Polygon': return [g]
    return [p for child in getattr(g, 'geoms', []) for p in polys(child)]


def ring(p):
    return [[round(x, 4), round(z, 4)] for x, z in list(p.exterior.coords)[:-1]]


def rect(x0, z0, x1, z1):
    return [[round(x0, 4), round(z0, 4)], [round(x1, 4), round(z0, 4)], [round(x1, 4), round(z1, 4)], [round(x0, 4), round(z1, 4)]]


def bbox_dims(points):
    xs = [p[0] for p in points]; zs = [p[1] for p in points]
    return sorted([max(xs) - min(xs), max(zs) - min(zs)])


def bbox_ok(points, minimum=MIN_BOX):
    a, b = bbox_dims(points)
    return a >= minimum[0] - 1e-6 and b >= minimum[1] - 1e-6


def to_pixels(floor, p):
    t = floor['transform']; m = t['metresPerPixel']; ox, oy = t['imageOriginPixels']
    return [p[0] / m + ox, p[1] / m + oy]


def to_local(floor, px):
    t = floor['transform']; m = t['metresPerPixel']; ox, oy = t['imageOriginPixels']
    return [(px[0] - ox) * m, (px[1] - oy) * m]


# ---------------------------------------------------------------- baseline / blocks
def restore_baseline(floor):
    """Undo roomSplits and v12Restrooms on one floor (in place). Returns the prior v12Restrooms block."""
    splits = floor.pop('roomSplits', None); wc = floor.pop('v12Restrooms', None)
    if splits and splits.get('version') != 1: raise ValueError('Unknown roomSplits version on ' + floor['id'])
    if wc and wc.get('version') != 1: raise ValueError('Unknown v12Restrooms version on ' + floor['id'])
    generated = set(); sources = []; source_overrides = []
    if splits:
        generated |= {cid for ids in splits['children'].values() for cid in ids}
        sources += [(splits['sourceIndex'][rid], room) for rid, room in splits['sourceRooms'].items()]
        source_overrides += splits.get('sourceOverrides', [])
    if wc:
        generated |= set(wc['generated'])
        sources += [(wc['sourceIndex'][rid], room) for rid, room in wc['sourceRooms'].items()]
        source_overrides += wc.get('sourceOverrides', [])
    if not splits and not wc: return None
    rooms = [r for r in floor['rooms'] if r['id'] not in generated]
    for index, room in sorted(sources, key=lambda item: item[0]):
        at = next((i for i, r in enumerate(rooms) if r['id'] == room['id']), None)
        if at is None: rooms.insert(index, copy.deepcopy(room))
        else: rooms[at] = copy.deepcopy(room)
    floor['rooms'] = rooms
    if 'virtualPortalOverrides' in floor or source_overrides:
        kept = [e for e in floor.get('virtualPortalOverrides', [])
                if e.get('roomId') not in generated and e.get('neighborRoomId') not in generated
                and (e.get('sourceReview') or {}).get('report') not in V12_REPORTS]
        for entry in sorted(source_overrides, key=lambda e: e['index']):
            if not any(e.get('roomId') == entry['entry']['roomId'] for e in kept):
                kept.insert(min(entry['index'], len(kept)), copy.deepcopy(entry['entry']))
        floor['virtualPortalOverrides'] = kept
        if not kept and wc and wc.get('overridesKeyAdded'): floor.pop('virtualPortalOverrides')
    return wc


# ---------------------------------------------------------------- floor geometry
class FloorCtx:
    """Effective rooms (structure overrides applied) and everything else that blocks one floor."""

    def __init__(self, bid, floor, structure, with_lifts=True, skip_ids=()):
        self.bid = bid; self.f = floor; fid = floor['id']
        self.shape = Polygon(floor['outline'], [h for h in floor.get('holes', []) if len(h) >= 3]).buffer(0)
        overrides = structure.get('roomOverrides', {}).get(fid, {})
        self.rooms = {}; self.kinds = {}
        for r in floor.get('rooms', []):
            if r['id'] in skip_ids: continue
            pts = overrides[r['id']] if r['id'] in overrides else r.get('polygon')
            if not pts or len(pts) < 3: continue
            p = Polygon(pts).buffer(0)
            if not p.is_empty: self.rooms[r['id']] = p; self.kinds[r['id']] = r.get('kind')
        hard = []; self.stairs = []; self.lifts = []
        for v in floor.get('verticalServices') or []:
            if len(v.get('polygon', [])) >= 3: hard.append(Polygon(v['polygon']).buffer(0))
        for core in structure.get('stairCores', {}).get(bid, []):
            if not any(l['floorId'] == fid for l in core['levels']): continue
            body = Polygon(A._rect(core['center'], core['length'], core['width'], core['angle']))
            apron = Polygon(A._rect(A._apron_center(core, core['length'], core['width']), core.get('apron', 1.6), core['width'], core['angle']))
            self.stairs += [body, apron]
        if with_lifts:
            for lift in structure.get('lifts', {}).get(bid, []):
                if not any(s['floorId'] == fid for s in lift['stops']): continue
                self.lifts += [lift_body(lift), lift_apron(lift)]
        for c in structure.get('connectors', []):
            if fid in c.get('openings', {}) and c.get('landing'): hard.append(Polygon(c['landing']).buffer(0))
        self.services = unary_union(hard) if hard else Polygon()
        self.hard = unary_union([*hard, *self.stairs, *self.lifts]) if hard or self.stairs or self.lifts else Polygon()

    def free(self, extra=()):
        blocked = unary_union([*self.rooms.values(), self.hard, *extra])
        return self.shape.difference(blocked)


def cores(free):
    return sorted([g for g in polys(free.buffer(-CLEARANCE)) if g.area > .05], key=lambda g: -g.area)


def lift_body(lift):
    if lift.get('shaftPolygon'): return Polygon(lift['shaftPolygon']).buffer(0)
    return Polygon(A._rect(lift['center'], lift['size'], lift['size'], lift['angle']))


def lift_apron(lift, depth=1.6):
    ux, uz = math.cos(lift['angle']), math.sin(lift['angle']); half = lift_half_depth(lift)
    centre = [lift['center'][0] - ux * (half + depth / 2), lift['center'][1] - uz * (half + depth / 2)]
    return Polygon(A._rect(centre, depth, lift['size'], lift['angle']))


def lift_half_depth(lift):
    """Distance from the lift centre to its door face, along the opening direction (-angle)."""
    if not lift.get('shaftPolygon'): return lift['size'] / 2
    ux, uz = math.cos(lift['angle']), math.sin(lift['angle']); cx, cz = lift['center']
    return max(-((x - cx) * ux + (z - cz) * uz) for x, z in lift['shaftPolygon'])


# ---------------------------------------------------------------- restroom placement
def _parts_for(cx, cz, side, n, w, d):
    """n rooms side by side behind one wall; `side` is the wall the doors are on (N/S/E/W)."""
    horizontal = side in 'NS'; W, D = (w * n, d) if horizontal else (d, w * n); out = []
    for k in range(n):
        if horizontal:
            x0 = cx - W / 2 + k * w; r = (x0, cz - D / 2, x0 + w, cz + D / 2)
            door = [x0 + w / 2, cz + D / 2 if side == 'S' else cz - D / 2]; outward = (0, 1 if side == 'S' else -1)
        else:
            z0 = cz - D / 2 + k * w; r = (cx - W / 2, z0, cx + W / 2, z0 + w)
            door = [cx + W / 2 if side == 'E' else cx - W / 2, z0 + w / 2]; outward = (1 if side == 'E' else -1, 0)
        out.append(dict(rect=r, door=door, outward=outward))
    return box(cx - W / 2, cz - D / 2, cx + W / 2, cz + D / 2), out


def _door_front(part, depth=1.0, width=1.0):
    (x, z), (ox, oz) = part['door'], part['outward']
    if ox: return box(min(x, x + ox * depth), z - width / 2, max(x, x + ox * depth), z + width / 2)
    return box(x - width / 2, min(z, z + oz * depth), x + width / 2, max(z, z + oz * depth))


SIZES = [(2.2, 2.6), (2.6, 2.2), (2.05, 2.45), (2.45, 2.05)]
RELAXED_SIZES = [(2.0, 2.4), (2.4, 2.0), (1.9, 2.3), (2.3, 1.9), (1.8, 2.2), (2.2, 1.8)]


def place_rects(ctx, centre, n, radius, placed, step=.3, sizes=SIZES):
    """Nearest free spot for n adjoining restrooms whose doors open onto the main circulation.
    Returns (parts, offset, main_core) or None. Deterministic: same inputs, same answer."""
    free0 = ctx.free(placed); base = cores(free0)
    if not base: return None
    main = base[0]; pad = free0.buffer(1e-6); covers = prep(pad).covers
    steps = int(radius / step); cands = []
    for ix in range(-steps, steps + 1):
        for iz in range(-steps, steps + 1):
            dist = math.hypot(ix * step, iz * step)
            if dist > radius + 1e-9: continue
            for si, side in enumerate('SNEW'):
                for zi, (w, d) in enumerate(sizes):
                    cands.append((round(dist, 4), zi, si, ix, iz, side, w, d))
    cands.sort()

    def usable(cx, cz, side, w, d):
        g, parts = _parts_for(cx, cz, side, n, w, d)
        if not covers(g): return None
        for part in parts:
            if not covers(_door_front(part)): return None
            stand = Point(part['door'][0] + part['outward'][0] * .55, part['door'][1] + part['outward'][1] * .55)
            if main.distance(stand) > .25: return None
        return g, parts

    for dist, _, _, ix, iz, side, w, d in cands:
        cx, cz = centre[0] + ix * step, centre[1] + iz * step
        found = usable(cx, cz, side, w, d)
        if not found: continue
        # Slide back against the wall behind (away from the doors) so no sliver is left.
        bx, bz = {'S': (0, -1), 'N': (0, 1), 'E': (-1, 0), 'W': (1, 0)}[side]; last = None
        for k in range(1, 13):
            slid = usable(cx + bx * k * .05, cz + bz * k * .05, side, w, d)
            if not slid: break
            last = (k, slid)
        if last and last[0] < 12:  # a wall within 0.6 m behind: rest against it
            cx, cz, found = cx + bx * last[0] * .05, cz + bz * last[0] * .05, last[1]
        g, parts = found
        after = cores(free0.difference(g))
        if not after or len(after) > len(base): continue
        if after[0].area < main.area - (g.bounds[2] - g.bounds[0] + 1) * (g.bounds[3] - g.bounds[1] + 1): continue
        return parts, math.hypot(cx - centre[0], cz - centre[1]), main
    return None


def find_region(ctx, floor, centre, protected, taken, max_area=40):
    """An unnamed traced room candidate that contains the plan symbol (4..max_area m2), if any."""
    p = Point(centre); hits = []
    for r in floor['rooms']:
        if r.get('kind') != 'room-candidate' or r.get('code') or r['id'] in protected or r['id'] in taken: continue
        poly = ctx.rooms.get(r['id'])
        if poly is None or poly.geom_type != 'Polygon' or not 4 <= poly.area <= min(max_area, REGION_MAX_AREA) or poly.distance(p) > .5: continue
        hits.append((poly.area, r['id'], r, poly))
    return min(hits)[2:] if hits else None


def split_region(poly, minimum=MIN_BOX):
    minx, minz, maxx, maxz = poly.bounds
    if maxx - minx >= maxz - minz:
        mid = (minx + maxx) / 2; halves = [box(minx - 1, minz - 1, mid, maxz + 1), box(mid, minz - 1, maxx + 1, maxz + 1)]
    else:
        mid = (minz + maxz) / 2; halves = [box(minx - 1, minz - 1, maxx + 1, mid), box(minx - 1, mid, maxx + 1, maxz + 1)]
    parts = [poly.intersection(h) for h in halves]
    if any(p.geom_type != 'Polygon' or p.area < 4 or not bbox_ok(ring(p), minimum) for p in parts): return None
    return parts


def restroom_fields(part, symbol, basis, floor, centre, extent_basis, extent_note, location_basis, location_note, design_note):
    spec = PART[part]; px = to_pixels(floor, centre)
    locator = f"{floor['id']} 平面圖符號，像素 ({px[0]:.0f}, {px[1]:.0f})，local ({centre[0]:.2f}, {centre[1]:.2f})"
    return dict(code='WC', kind='restroom', displayName=spec['displayName'], gender=spec['gender'], accessible=spec['accessible'],
                planSymbol=symbol, aliases=list(WC_ALIASES), basis=basis, designNote=design_note,
                evidence=dict(sourceId=floor['sourceId'], locator=locator, basis=extent_basis, note=extent_note),
                locationEvidence=dict(sourceId=floor['sourceId'], locator=locator, basis=location_basis, note=location_note))


def door_override(report, rid, door, outward, basis='schematic'):
    far = [round(door[0] + outward[0] * .02, 4), round(door[1] + outward[1] * .02, 4)]
    return dict(roomId=rid, neighborRoomId='@public', planDoor=True, basis=basis,
                sourceReview=dict(report=report, entryId=rid),
                suggestedPortal=dict(width=1.0, perRoomPosition={rid: [round(door[0], 4), round(door[1], 4)], '@public': far}),
                geometryWarning='v12 指定門位；只在這道門的範圍內開洞。')


def add_restrooms(bid, floor, structure, groups, report, protected, location_basis, strict=True, radius=4.0, baseline_index=None, max_region_area=40):
    """Place every group of one floor. Mutates floor (rooms, overrides, v12Restrooms block).
    groups: [{slot, at:[x,z], symbol, parts?:[...], manual?:[{part, rect, door, outward}], carve?:roomId}]
    baseline_index: room id -> index in the floor's baseline room list (before any v12 edit on this floor).
    Returns (restroom ids, problems)."""
    ctx = FloorCtx(bid, floor, structure); lowest = min_box(bid)
    relaxed_sizes = [(w, d) for w, d in RELAXED_SIZES if min(w, d) >= lowest[0] - 1e-6 and max(w, d) >= lowest[1] - 1e-6]
    block = dict(version=1, tool=report, note='v12 廁所：位置依平面圖符號或沿用 1F 位置；範圍、男女分隔與門位為示意，內裝由 runtime 配置。',
                 generated=[], sourceRooms={}, sourceIndex={}, sourceOverrides=[], placements=[], skipped=[])
    if 'virtualPortalOverrides' not in floor: block['overridesKeyAdded'] = True
    placed = []; problems = []; taken = set(); new_rooms = []; overrides = floor.setdefault('virtualPortalOverrides', [])
    index_of = baseline_index or {r['id']: i for i, r in enumerate(floor['rooms'])}
    existing = {r['id'] for r in floor['rooms']}

    def remember(room):
        if room['id'] not in block['sourceRooms']:
            block['sourceRooms'][room['id']] = copy.deepcopy(room); block['sourceIndex'][room['id']] = index_of[room['id']]

    for group in groups:
        centre = group['at']; symbol = group['symbol']; kinds = group.get('parts') or SYMBOL_PARTS[symbol]
        slot = group['slot']; rid = lambda part: f"{floor['id']}-WC-{slot}-{PART[part]['suffix']}"
        loc_note = group.get('locationNote', '圖示中心讀圖誤差約 ±0.6 m。')
        if group.get('skip') and (not group.get('skipOn') or floor['id'] in group['skipOn']):  # wpd-run: a reviewed decision that this group has no legal spot
            block['skipped'].append(dict(slot=slot, symbol=symbol, reason=group['skip'])); continue
        if group.get('manual'):
            target = next(r for r in floor['rooms'] if r['id'] == group['carve']) if group.get('carve') else None
            cut = unary_union([box(*m['rect']) for m in group['manual']])
            if target is not None:
                remember(target); rest = Polygon(target['polygon']).buffer(0).difference(cut)
                target['polygon'] = ring(max(polys(rest), key=lambda g: g.area)); ctx.rooms[target['id']] = ctx.rooms[target['id']].difference(cut)
                target['v12Carved'] = '為 v12 廁所裁出缺口（位置依平面圖 WC 符號，範圍示意）。'
            for m in group['manual']:
                room = dict(id=rid(m['part']), **restroom_fields(m['part'], symbol, 'schematic', floor, centre, 'schematic', group.get('extentNote', '範圍與男女分隔為示意；合併圖示依「靠走廊入口為女廁」切分。'), location_basis, loc_note, '位置依平面圖，男女分隔及內裝示意'),
                            polygon=rect(*m['rect']), door=dict(position=[round(v, 4) for v in m['door']], width=1.0, basis='schematic', note='v12 示意門位，朝向走廊。'))
                new_rooms.append(room); overrides.append(door_override(report, room['id'], m['door'], m['outward'])); placed += [box(*m['rect']), _door_front(m)]
            block['placements'].append(dict(slot=slot, mode='manual', offset=0))
            continue
        region = find_region(ctx, floor, centre, protected, taken, max_region_area)
        if region:
            source, poly = region; taken.add(source['id'])
            has_override = source['id'] in structure.get('roomOverrides', {}).get(floor['id'], {})
            halves = split_region(poly, lowest) if len(kinds) == 2 and not has_override else None
            if len(kinds) == 1 or halves is None:
                if not bbox_ok(ring(poly), PREFERRED_BOX if len(kinds) == 1 else lowest):
                    taken.discard(source['id'])  # too small to be a restroom: fall through to free placement
                else:
                    remember(source); part = kinds[0] if len(kinds) == 1 else 'S'
                    note = '範圍沿用官方圖面描圖區域。' if len(kinds) == 1 else '描圖區域不足以切成男、女兩間（或已被樓梯裁切），暫列一間不分性別；需人工複核。'
                    if len(kinds) == 2: problems.append(f"NOTE {floor['id']} {slot}: region {source['id']} could not be split; kept as one shared restroom")
                    source.update(restroom_fields(part, symbol, 'map-derived' if len(kinds) == 1 and location_basis == 'map-derived' else 'schematic', floor, centre, 'map-derived', note, location_basis, loc_note, '範圍依描圖，內裝示意'))
                    if group.get('reshape'):  # wpd-run: runtime planRestroom cannot fit a stall in the traced outline (door-arc notches)
                        shape = box(*group['reshape']); others = unary_union([q for k, q in ctx.rooms.items() if k != source['id']] + [ctx.hard])
                        if shape.intersection(others).area > .01 or not ctx.shape.buffer(.01).covers(shape): raise ValueError(f"{source['id']}: reshape rectangle overlaps rooms/services or leaves the floor")
                        source['polygon'] = rect(*group['reshape']); ctx.rooms[source['id']] = shape
                        source['evidence'] = dict(source['evidence'], basis='schematic', note=group.get('reshapeNote', '描圖外框含門弧缺口，內裝放不下；改為同範圍的矩形（門位不變）。'))
                    block['placements'].append(dict(slot=slot, mode='region', regionId=source['id'], offset=0))
                    continue
            else:
                remember(source); door0 = Point(source['door']['position']); order = sorted(range(2), key=lambda i: halves[i].distance(door0))
                main = (cores(ctx.free(placed)) or [poly])[0]
                if symbol == 'mf':  # the half nearer the corridor entrance is the women's room
                    order = sorted(range(2), key=lambda i: (halves[i].distance(main), halves[i].distance(door0)))
                keeper = min(range(2), key=lambda i: halves[i].distance(door0)); children = []
                for part, i in zip(kinds, order):
                    half = halves[i]; child = {k: copy.deepcopy(v) for k, v in source.items() if k not in ('sourceRegionPixels',)}
                    child.update(id=rid(part), polygon=ring(half), splitFrom=source['id'],
                                 **restroom_fields(part, symbol, 'schematic', floor, centre, 'schematic', '外牆依描圖；男女分隔線為示意（合併圖示對半切）。', location_basis, loc_note, '位置依平面圖，男女分隔及內裝示意'))
                    if i != keeper:
                        other = halves[keeper]; free_now = ctx.free(placed); best = None
                        coords = list(half.exterior.coords)
                        for a, b in zip(coords, coords[1:]):
                            length = math.dist(a, b); mid = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
                            if length < 1.1 or other.distance(Point(mid)) < .05: continue
                            nx, nz = (b[1] - a[1]) / length, -(b[0] - a[0]) / length
                            for sign in (1, -1):
                                probe = Point(mid[0] + nx * sign * .5, mid[1] + nz * sign * .5)
                                if free_now.covers(probe) and (best is None or length > best[0]): best = (length, mid)
                        if best is None:
                            shared = half.buffer(.05).intersection(other.boundary); c = shared.centroid if not shared.is_empty else half.representative_point(); best = (0, (c.x, c.y))
                        child['door'] = dict(position=[round(best[1][0], 4), round(best[1][1], 4)], width=1.0, basis='schematic', note='v12 示意門位。')
                    children.append(child)
                keep_id = rid(kinds[order.index(keeper)])
                for at, entry in enumerate(list(overrides)):
                    if source['id'] not in (entry.get('roomId'), entry.get('neighborRoomId')): continue
                    block['sourceOverrides'].append(dict(index=at, entry=copy.deepcopy(entry)))
                    text = json.dumps(entry, ensure_ascii=False).replace('"' + source['id'] + '"', '"' + keep_id + '"')
                    overrides[overrides.index(entry)] = json.loads(text)
                floor['rooms'] = [r for r in floor['rooms'] if r['id'] != source['id']]; ctx.rooms.pop(source['id'], None)
                for child, i in zip(children, order): ctx.rooms[child['id']] = halves[i]
                new_rooms += children
                block['placements'].append(dict(slot=slot, mode='region-split', regionId=source['id'], offset=0))
                continue
        found = place_rects(ctx, centre, len(kinds), radius, placed)
        relaxed = False
        if not found:  # coordinator ruling: retry down to 1.8 x 2.2 m before giving up
            found = place_rects(ctx, centre, len(kinds), radius, placed, sizes=relaxed_sizes) if relaxed_sizes else None; relaxed = bool(found)
        if not found and symbol == 'mf':  # no legal pair even at 1.8 x 2.2: one shared room (coordinator ruling)
            found = place_rects(ctx, centre, 1, radius, placed, sizes=relaxed_sizes or SIZES); relaxed = bool(found) and bool(relaxed_sizes)
            if found: kinds = ['S']; problems.append(f"NOTE {floor['id']} {slot}: merged icon kept as one shared restroom (no legal pair even at 1.8 x 2.2 m)")
        if not found:
            message = f"{floor['id']} {slot}: no free {len(kinds)}-room spot within {radius} m of ({centre[0]:.2f}, {centre[1]:.2f})"
            block['skipped'].append(dict(slot=slot, reason='no-free-spot')); problems.append(('FATAL ' if strict else '') + message); continue
        parts, offset, main = found
        if symbol == 'mf':  # nearer the middle of the main circulation = nearer the corridor entrance
            c = main.centroid; parts = sorted(parts, key=lambda p: math.dist(p['door'], (c.x, c.y)))
        near = offset <= 1.0
        for part, spot in zip(kinds, parts):
            split = len(kinds) == 2 and symbol == 'mf'
            basis = 'map-derived' if location_basis == 'map-derived' and near and not split else 'schematic'
            note = ('圖示處已被房間或動線佔用，移到最近的可用空位；' if not near else '') + ('預設尺寸放不下，依協調者裁決縮小（不低於 1.8×2.2 m，且換算世界尺寸不低於 runtime 的 2.0×2.4 m）；' if relaxed else '') + ('合併圖示切成男、女兩間，依「靠走廊入口為女廁」；' if split else '') + '範圍為示意矩形。'
            room = dict(id=rid(part), **restroom_fields(part, symbol, basis, floor, centre, 'schematic', note, location_basis if near else 'schematic', loc_note + (f' 實際擺位偏移 {offset:.2f} m。' if offset > .01 else ''), '位置依平面圖，範圍及內裝示意' if location_basis == 'map-derived' else '沿用 1F 位置，範圍及內裝示意'),
                        polygon=rect(*spot['rect']), door=dict(position=[round(v, 4) for v in spot['door']], width=1.0, basis='schematic', note='v12 示意門位，朝向走廊。'))
            new_rooms.append(room); overrides.append(door_override(report, room['id'], spot['door'], spot['outward'])); placed += [box(*spot['rect']), _door_front(spot)]
        block['placements'].append(dict(slot=slot, mode='free', offset=round(offset, 3), **({'relaxed': True} if relaxed else {}), **({'parts': kinds} if kinds == ['S'] else {})))
    ids = [r['id'] for r in new_rooms]
    if len(set(ids)) != len(ids) or any(i in existing for i in ids): raise ValueError('duplicate restroom id on ' + floor['id'])
    floor['rooms'] = floor['rooms'] + new_rooms
    block['generated'] = ids
    restrooms = [r for r in floor['rooms'] if r.get('kind') == 'restroom']
    for r in restrooms:
        if not bbox_ok(r['polygon'], lowest): raise ValueError(f"restroom {r['id']} is smaller than {lowest[0]}x{lowest[1]} m: {bbox_dims(r['polygon'])}")
    if not overrides and block.get('overridesKeyAdded'): floor.pop('virtualPortalOverrides')
    if restrooms or block['skipped']: floor['v12Restrooms'] = block
    return [r['id'] for r in restrooms], problems


# ---------------------------------------------------------------- planner validation
def review_entries(fid):
    review = json.loads(REVIEW.read_text()); out = []
    for entry in review['entries']:
        if entry['floorId'] != fid: continue
        entry = dict(entry); entry['sourceReview'] = dict(report=str(REVIEW), entryId=':'.join([entry['floorId'], entry['roomId'], entry['neighborRoomId']])); out.append(entry)
    return out


def plan(bid, floor, structure):
    prepared, entry = A._apply_structure(floor, bid, structure)
    return A.plan_floor_access(prepared, service_stair=None, portal_overrides=review_entries(floor['id']), vertical_entry=entry)


def planner_problems(bid, before, after, structure, required):
    """Rooms the real access planner can no longer reach, and required rooms it cannot reach at all."""
    old = plan(bid, before, structure)['report']; new_plan = plan(bid, after, structure); new = new_plan['report']
    gone = {r['id'] for r in before['rooms']} - {r['id'] for r in after['rooms']}
    lost = sorted(set(new.get('unreachableRoomIds', [])) - set(old.get('unreachableRoomIds', [])) - set(required))
    missing = sorted(r for r in required if r in new.get('unreachableRoomIds', []) or r not in new_plan['primaryPortalByRoom'])
    rejected = [i for i in new['issues'] if i['type'] == 'reviewed-portal-override-rejected' and i.get('roomId') in set(required)]
    overlaps = [i for i in new['issues'] if i['type'] in ('overlapping-room-polygons', 'room-outside-floor') and i not in old['issues']
                and not (set(i.get('roomIds', [i.get('roomId')])) & gone)]
    out = []
    if lost: out.append(f"{after['id']}: rooms became unreachable: {lost}")
    if missing: out.append(f"{after['id']}: new rooms unreachable: {missing}")
    if rejected: out.append(f"{after['id']}: door overrides rejected: {[(i['roomId'], i['reason']) for i in rejected]}")
    if overlaps: out.append(f"{after['id']}: new geometry issues: {overlaps}")
    if old.get('status') == 'complete' and new.get('status') != 'complete': out.append(f"{after['id']}: access status complete -> {new.get('status')}")
    return out


# ---------------------------------------------------------------- writing with the review pin
def reviewed_rooms(bid, data, review):
    ids = {(e['floorId'], e[k]) for e in review['entries'] if e.get('buildingId') == bid for k in ('roomId', 'neighborRoomId')}
    return [r for f in data['floors'] for r in f['rooms'] if (f['id'], r['id']) in ids]


def protected_ids(bid):
    review = json.loads(REVIEW.read_text())
    return {e[k] for e in review['entries'] if e.get('buildingId') == bid for k in ('roomId', 'neighborRoomId')}


def commit_building(bid, raw, updated, reason, check):
    """Write {bid}.json and refresh its source-review pin. In check mode only asserts. Returns True if written."""
    path = DATA / f'{bid}.json'; payload = dump(updated).encode()
    review = json.loads(REVIEW.read_text()); pins = review.get('sourceBuildingSHA256', {}); old = sha(raw); new = sha(payload)
    assert reviewed_rooms(bid, json.loads(raw), review) == reviewed_rooms(bid, updated, review), f'{bid}: reviewed rooms would change'
    if check:
        assert payload == raw, f'{bid}.json: v12 data has not been applied (or the tool is not idempotent)'
        assert bid not in pins or pins[bid] == old, f'{bid}: stale source-review pin'
        return False
    if payload == raw: return False
    if bid in pins:
        if pins[bid] != old: raise ValueError(f'{bid}: existing source-review pin is stale; refusing to refresh blindly')
        pins[bid] = new
        review.setdefault('sourceSHARefreshHistory', []).append(dict(date=datetime.now(timezone.utc).isoformat(), building=bid, oldSHA256=old, newSHA256=new, reason=reason + ' Reviewed rooms and neighbour geometry unchanged.'))
    path.write_bytes(payload)
    if bid in pins: REVIEW.write_text(dump(review))
    return True


# ---------------------------------------------------------------- public/data/rooms.json
def rooms_index_rows():
    """v12 rows derived from the building JSONs: split children (with aliases) and every restroom."""
    rows = []; parents = set()
    for bid in BIDS:
        data = json.loads((DATA / f'{bid}.json').read_text())
        for f in data['floors']:
            width, height = f.get('imageWidth'), f.get('imageHeight')
            for r in f['rooms']:
                is_split = bool(r.get('splitFrom')) and r.get('kind') != 'restroom'
                if r.get('kind') != 'restroom' and not is_split: continue
                c = Polygon(r['polygon']).buffer(0).representative_point() if len(r['polygon']) >= 3 else Point(r['door']['position'])
                px = to_pixels(f, [c.x, c.y])
                x = min(1, max(0, px[0] / width)) if width else .5; y = min(1, max(0, px[1] / height)) if height else .5
                row = dict(id='v12-' + r['id'], buildingId=bid, floorId=f['id'], code=r.get('code', ''), x=round(x, 6), y=round(y, 6), sourceId=f.get('sourceId'))
                if is_split:
                    parents.add((bid, r['aliases'][0])); row.update(status='user-reported', aliases=list(r['aliases']), splitFrom=r['aliases'][0])
                else:
                    row.update(name=r['displayName'], kind='restroom', gender=r['gender'], accessible=r['accessible'],
                               keywords=list(dict.fromkeys([*WC_ALIASES, r['displayName']])), status=r['basis'])
                row.update(walkRoomId=r['id'], floorLabel=f.get('label'), v12=True); rows.append(row)
    return rows, parents


def sync_rooms_index(check=False):
    raw = ROOMS_INDEX.read_text(); rows = json.loads(raw); new_rows, parents = rooms_index_rows()
    kept = [r for r in rows if not r.get('v12') and (r.get('buildingId'), r.get('code')) not in parents]
    payload = dump(kept + new_rows)
    if check:
        assert payload == raw, 'public/data/rooms.json: v12 rows are stale'
        return False
    if payload != raw: ROOMS_INDEX.write_text(payload)
    return payload != raw
