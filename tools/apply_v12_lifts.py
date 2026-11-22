#!/usr/bin/env python3
"""Upgrade campus-structure.json.lifts to LiftGeometryV12 (docs/spec-v12.md, round2-astra §4), idempotent.

Evidence grades:
  SC  existing car (plan symbol, already map-derived): 2.0 x 2.0 shaft from center/size, door on the east face.
  EV  elevator-shaft polygons already in EV.json (1F, 2F, 3F, 5F, 6F): shaft = bounding box of their intersection;
      4F has no shaft frame on its plan, so it uses that same intersection (written into the stop's evidence.note).
  EN, BI, PH, CH, EC, MS  lift symbol / shaft frame read off the 1F plan (native pixels). A frame of a plausible
      size becomes the shaft (map-derived); otherwise a 2.0 x 2.0 shaft at the symbol (schematic). If that spot cannot
      serve the storeys (blocked, or not on the main circulation) the v9 schematic position is kept and the reason recorded.
Old fields (center, angle, size, stops[].floorId/level/storey, basis) stay for the old pipeline.
The build-time car obstacle is `<liftId>-car@<floorId>` (tools/build_floor_access.py).

Run BEFORE apply_v12_sc_rooms.py / apply_v12_restrooms.py (restrooms avoid the lifts; lifts ignore restrooms).

  python3 tools/apply_v12_lifts.py [--check] [--dry-run] [--no-plan]
"""
import argparse
import copy
import json
import math
from shapely.geometry import Point, Polygon, box
from shapely.ops import unary_union
import v12_common as C
from v12_common import A

SHAFT_KINDS = ('elevator-shaft', 'lift-shaft', 'vertical-service', 'lift-symbol')
SIDE_ANGLE = {'W': 0.0, 'E': math.pi, 'N': math.pi / 2, 'S': 3 * math.pi / 2}  # opening direction = -angle (existing convention)
# 1F plan pixels (round1-fable (C)): lift symbol centre, X-marked frame (x0, y0, x1, y1) if drawn, door side if readable.
PLAN = {
    'EN': dict(symbol=(1027, 401), frame=None, door=None, note='橘色電梯符號；圖上此處沒有打叉井框（西棟另有一個井 (282,115)，未採用）。'),
    'BI': dict(symbol=(462, 377), frame=(430, 345, 500, 410), door='S', note='橘色電梯符號與外框，開口像在南側。'),
    'PH': dict(symbol=(400, 359), frame=(352, 315, 428, 400), door=None, note='橘色電梯符號與外框。'),
    'CH': dict(symbol=(571, 266), frame=(540, 212, 605, 270), door='S', note='橘色電梯符號，井框在符號上方。'),
    'EC': dict(symbol=(383, 178), frame=(335, 145, 368, 185), door='E', note='橘色電梯符號，西側有兩個井框。'),
    'MS': dict(symbol=(498, 405), frame=(462, 368, 535, 445), door=None, note='橘色電梯符號與外框。'),
}
ABSORB_MAX_AREA = 16
CORRIDOR_MIN_AREA = 100
SILL_GAP = .15  # max car-to-landing-door gap along the door axis (local m); a 2.0 shaft with a 1.7 car
EV_DOOR = 'S'  # EV-1F.webp: door line on the south side of the X-marked box (527-607, 235-300 px)


def storey_of(f, top):
    return f.get('storeyIndex') or (top + 1 if f['level'] == 99 else f['level'])


def clean(v):
    return round(v, 6) + 0.0


def geometry(centre, w, d, angle):
    """Axis-aligned shaft w (x) by d (z); angle is a multiple of 90 degrees."""
    ux, uz = round(math.cos(angle)), round(math.sin(angle)); half = (w if ux else d) / 2; cx, cz = centre
    shaft = C.rect(cx - w / 2, cz - d / 2, cx + w / 2, cz + d / 2)
    door = [clean(cx - ux * half), clean(cz - uz * half)]; approach = [clean(cx - ux * (half + .8)), clean(cz - uz * (half + .8))]
    width = d if ux else w
    ex, ez, fx, fz = cx - ux * half, cz - uz * half, cx - ux * (half + 1.6), cz - uz * (half + 1.6)  # door face, far edge of the landing
    apron = box(min(ex, fx), cz - width / 2, max(ex, fx), cz + width / 2) if ux else box(cx - width / 2, min(ez, fz), cx + width / 2, max(ez, fz))
    return dict(shaft=shaft, body=Polygon(shaft), apron=apron, door=door, approach=approach, tangent=[clean(-uz), clean(ux)])


class Floor:
    def __init__(self, bid, f, structure):
        # Restrooms the v12 tools put into free space are ignored (they are placed after the lifts and avoid them);
        # converted or split traced regions still count as rooms, exactly as they did before v12.
        block = f.get('v12Restrooms') or {}; by_id = {r['id']: r for r in f.get('rooms', [])}
        skip = {rid for rid in block.get('generated', []) if rid in by_id and not by_id[rid].get('splitFrom')}
        self.f = f; ctx = C.FloorCtx(bid, f, structure, with_lifts=False, skip_ids=skip); self.ctx = ctx
        self.protected = C.protected_ids(bid); self.codes = {r['id']: r.get('code') for r in f.get('rooms', [])}
        self.walk = ctx.shape if bid in A.NO_GALLERY else Polygon(Polygon(f['outline']).exterior).buffer(1.4, join_style=3).difference(unary_union([Polygon(h).buffer(0) for h in f.get('holes', []) if len(h) >= 3] or [Polygon()]))
        self.rooms = {rid: p for rid, p in ctx.rooms.items() if ctx.kinds[rid] not in SHAFT_KINDS}
        self.services = [(v.get('id'), v.get('kind'), Polygon(v['polygon']).buffer(0)) for v in f.get('verticalServices') or [] if len(v.get('polygon', [])) >= 3]
        self.stairs = unary_union(ctx.stairs) if ctx.stairs else Polygon()
        self.room_union = unary_union(list(self.rooms.values()) or [Polygon()])

    def own(self, body):
        return [sid for sid, kind, p in self.services if p.area > 0 and p.intersection(body).area >= .5 * min(p.area, body.area)]

    def plain(self, rid, max_area=None, min_area=None):
        """An uncoded, unreviewed traced room-candidate (the only kind a lift may absorb)."""
        p = self.rooms[rid]
        return (self.ctx.kinds.get(rid) == 'room-candidate' and not self.codes.get(rid) and rid not in self.protected
                and (max_area is None or p.area <= max_area) and (min_area is None or p.area >= min_area))

    def absorbable(self, g, symbol=None):
        """wpd-run round 2 (coordinator ruling 2): small uncoded regions (<= 16 m2) under the shaft that contain the plan
        symbol (or lie mostly inside the shaft) become part of the shaft and stop being rooms."""
        body = g['body']; out = []
        for rid, p in self.rooms.items():
            hit = p.intersection(body).area
            if hit < .05 or not self.plain(rid, max_area=ABSORB_MAX_AREA): continue
            if (symbol is not None and p.contains(symbol)) or hit >= .5 * p.area: out.append(rid)
        return out

    def corridors(self, g):
        """EV (coordinator ruling 1): large uncoded traced corridors (>= 100 m2) under the shaft or its landing are public circulation."""
        zone = g['body'].union(g['apron'])
        return [rid for rid, p in self.rooms.items() if p.intersection(zone).area >= .05 and self.plain(rid, min_area=CORRIDOR_MIN_AREA)]

    def check(self, g, allow_room_carve=False, absorb=()):
        body, apron = g['body'], g['apron']; own = set(self.own(body))
        others = unary_union([p for sid, _, p in self.services if sid not in own] or [Polygon()])
        mine = unary_union([p for sid, _, p in self.services if sid in own] or [Polygon()])
        rooms = unary_union([p for rid, p in self.rooms.items() if rid not in absorb] or [Polygon()]) if absorb else self.room_union
        if not self.walk.buffer(.01).covers(body.union(apron)): return 'outside the walkable outline'
        # runtime cuts the shaft hole in the floor slab only when the whole shaft lies on it (walk-world holeFits)
        if not self.ctx.shape.buffer(.01).covers(body): return 'shaft outside the floor slab'
        if body.intersection(unary_union([others, self.stairs])).area >= .05: return 'shaft overlaps a stair or another service'
        if not allow_room_carve and body.intersection(rooms).area >= .05: return 'shaft overlaps a room'
        front = apron.difference(mine)
        if front.intersection(unary_union([rooms.difference(body) if allow_room_carve else rooms, others, self.stairs])).area >= .05: return 'landing overlaps a room, stair or service'
        free = self.walk.difference(unary_union([rooms, others, mine, self.stairs, body])); parts = C.cores(free)
        if not parts or not front.buffer(-.05).intersects(parts[0]): return 'landing is not on the main circulation'
        return None


def stop_of(f, top, g, basis, locator, note=None):
    evidence = dict(sourceId=f.get('sourceId', 'campus-structure'), locator=locator, basis=basis)
    if note: evidence['note'] = note
    return dict(floorId=f['id'], level=f['level'], storey=storey_of(f, top), approach=g['approach'],
                landingDoor=dict(center=g['door'], tangent=g['tangent'], clearWidth=.9), evidence=evidence)


def record(bid, lid, centre, angle, size, g, stops, basis, evidence, text, floors, legacy):
    replaced = []
    for s in stops:
        fl = floors[s['floorId']]
        replaced += [sid for sid in fl.own(g['body']) if sid and not sid.endswith('-shaft-x')]
    replaced += [f"{lid}-car@{s['floorId']}" for s in stops]
    # cabinSize is car-local: [0] along the door axis (angle), [1] across it. The runtime cuts the whole shaft out of
    # each upper slab and centres the car in it, so along the door axis the car must reach the landing sill (gap
    # <= SILL_GAP) or a rider stepping out falls into the shaft (BI's frame is 2.93 m deep, wpd-run fix).
    cabin = round(max(1.1, size - .3), 3); xs = [p[0] for p in g['shaft']]; zs = [p[1] for p in g['shaft']]
    depth = (max(xs) - min(xs)) if round(math.cos(angle)) else (max(zs) - min(zs))
    car_depth = round(max(cabin, depth - 2 * SILL_GAP), 3)
    if car_depth > cabin:
        evidence = dict(evidence, note=evidence.get('note', '') + f'車廂沿開門方向加深為 {car_depth} m（井道深 {depth:.2f} m），讓車廂門貼齊層門門檻；車廂尺寸是配合井道的示意值，不是讀圖結果。')
    out = dict(id=lid, buildingId=bid, center=[round(centre[0], 3), round(centre[1], 3)], angle=angle, size=size, cabinSize=[car_depth, cabin],
               shaftPolygon=g['shaft'], replacesServiceIds=replaced, stops=stops, basis=basis, evidence=evidence, evidenceText=text)
    if legacy: out['legacy'] = legacy
    return out


def runs_from_ground(order, floors, g, symbol=None, absorbed=None):
    """Contiguous stops starting at 1F, like the v9 builder. absorbed (out): floorId -> absorbed room ids."""
    stops = []; why = {}
    for f in order:
        absorb = floors[f['id']].absorbable(g, symbol)
        reason = floors[f['id']].check(g, absorb=absorb)
        if reason is None:
            stops.append(f)
            if absorbed is not None and absorb: absorbed[f['id']] = absorb
        else:
            why[f['id']] = reason
            if stops or f['level'] >= 1: break
    return (stops if stops and stops[0]['level'] == 1 else []), why


def restore_absorbed(structure):
    """Undo the roomOverrides a previous run of this tool wrote (lift.absorbedRooms), so every run starts from the same trace."""
    overrides = structure.setdefault('roomOverrides', {})
    for lifts in structure.get('lifts', {}).values():
        for lift in lifts:
            for e in lift.get('absorbedRooms', []):
                fo = overrides.setdefault(e['floorId'], {})
                if 'previousOverride' in e: fo[e['roomId']] = copy.deepcopy(e['previousOverride'])
                else: fo.pop(e['roomId'], None)
                if not fo: overrides.pop(e['floorId'])


def absorb(structure, absorbed, reason):
    """Suppress the absorbed rooms (roomOverrides -> None, the existing 'structure removes this room' convention). Returns the record."""
    overrides = structure.setdefault('roomOverrides', {}); out = []
    for fid in sorted(absorbed):
        for rid in sorted(absorbed[fid]):
            fo = overrides.setdefault(fid, {}); e = dict(floorId=fid, roomId=rid, reason=reason(fid, rid))
            if rid in fo: e['previousOverride'] = copy.deepcopy(fo[rid])
            fo[rid] = None; out.append(e)
    return out


def upgrade(structure, buildings):
    structure = copy.deepcopy(structure); lifts = structure.setdefault('lifts', {}); notes = []
    restore_absorbed(structure)
    for bid in C.BIDS:
        b = buildings[bid]; top = max(f['level'] for f in b['floors'] if f['level'] != 99)
        usable = [f for f in b['floors'] if f.get('outline') and len(f['outline']) >= 3]
        floors = {f['id']: Floor(bid, f, structure) for f in usable}; by_id = {f['id']: f for f in usable}
        order = sorted([f for f in usable if f['level'] >= 1], key=lambda f: storey_of(f, top))
        current = (lifts.get(bid) or [None])[0]
        legacy = (current or {}).get('legacy') or (current and dict(center=current['center'], angle=current['angle'], size=current['size'], stops=[s['floorId'] for s in current['stops']], basis=current['basis'],
                                                                     evidence=current.get('evidenceText', current.get('evidence'))))
        lid = f'{bid}-lift-1'
        if bid == 'SC':
            centre, angle, size = legacy['center'], legacy['angle'], legacy['size']; g = geometry(centre, size, size, angle)
            stops = [stop_of(by_id[fid], top, g, 'map-derived', f'{fid} 平面圖電梯符號（1F–4F 橘色符號平均 local (-14.3, 14.8)；B1 CAD 圖 (1302,1012) px 打叉方格）') for fid in legacy['stops']]
            evidence = dict(sourceId=by_id['SC-1F']['sourceId'], locator='SC-1F～4F 平面圖橘色電梯符號、SC-B1 CAD 圖打叉方格；與既有車廂中心相差不到 0.4 m', basis='map-derived',
                            note='井框由既有車廂 center/size 生成 2.0×2.0；開口朝東側走廊。SC-*-shaft-x 是西側另一個較大的井，不屬於這部電梯，不列入 replacesServiceIds。')
            lifts[bid] = [record(bid, lid, centre, angle, size, g, stops, 'map-derived', evidence, legacy['evidence'], floors, legacy)]
            continue
        if bid == 'EV':
            shafts = {f['id']: [p for _, kind, p in floors[f['id']].services if kind == 'elevator-shaft'] for f in usable}
            have = {fid: unary_union(ps) for fid, ps in shafts.items() if ps}
            if len(have) < 2: raise SystemExit('EV: fewer than two elevator-shaft polygons; cannot place the lift from data')
            inter = None
            for p in have.values(): inter = p if inter is None else inter.intersection(p)
            if inter.is_empty or inter.area < 1.5: raise SystemExit(f'EV: elevator-shaft polygons do not overlap enough across storeys (area {inter.area:.2f})')
            x0, z0, x1, z1 = inter.bounds; w, d = round(x1 - x0, 3), round(z1 - z0, 3); centre = [round((x0 + x1) / 2, 3), round((z0 + z1) / 2, 3)]
            size = round(min(2.0, w, d), 2); best = None
            for side in [EV_DOOR, *[s for s in 'SNEW' if s != EV_DOOR]]:
                angle = round(SIDE_ANGLE[side], 5); g = geometry(centre, w, d, angle); ok = []; why = {}; took = {}
                for f in [f for f in order if f['level'] != 99]:
                    fl = floors[f['id']]
                    # Coordinator ruling 1: large uncoded traced corridors at the shaft/landing are public circulation;
                    # on a storey without a shaft frame, small uncoded regions under the shaft are absorbed by it (ruling 2).
                    ab = sorted(set(fl.corridors(g)) | (set(fl.absorbable(g)) if f['id'] not in have else set()))
                    reason = fl.check(g, absorb=ab)
                    if reason is None:
                        ok.append(f)
                        if ab: took[f['id']] = ab
                    else: why[f['id']] = reason
                if best is None or len(ok) > len(best[2]): best = (angle, g, ok, why, side, took)
            angle, g, ok, why, side, took = best
            if len(ok) < 2:
                # v12 run (wpd-run): EV's traced corridors are room-candidates (e.g. EV-1F-region-009, 255 m2), so no side
                # gets two landings. Same fallback as the other buildings: keep the v9 data (EV had no lift) and report it.
                notes.append(f'EV: the shaft has fewer than two usable landings, kept the v9 data (no lift): {why}'); continue
            if why: notes.append(f'EV lift skips {why}')
            stops = []
            big = lambda fid, rid: floors[fid].rooms[rid].area >= CORRIDOR_MIN_AREA
            why_note = lambda fid, rid: (f'無代碼描圖區域（{floors[fid].rooms[rid].area:.0f} m²）是電梯廳前的走廊，依協調者裁決改列公共動線，讓層門 approach 接上主幹' if big(fid, rid)
                                         else f'無代碼小描圖區域（{floors[fid].rooms[rid].area:.1f} m²）在井道內，併入井道')
            for f in ok:
                fid = f['id']; extra = '；'.join(f'{rid}：{why_note(fid, rid)}' for rid in took.get(fid, []))
                if fid in have:
                    stops.append(stop_of(f, top, g, 'map-derived', f'{fid} verticalServices elevator-shaft 多邊形（官方圖打叉井框）', extra or None)); continue
                stops.append(stop_of(f, top, g, 'schematic', f'{fid} 平面圖沒有井框', '取上下層（' + '、'.join(sorted(have)) + '）elevator-shaft 的交集作為本層井道。' + (extra and '；' + extra)))
            absorbed_ev = absorb(structure, took, why_note)
            evidence = dict(sourceId=by_id['EV-1F']['sourceId'], locator='EV.json verticalServices elevator-shaft：' + '、'.join(sorted(have)) + '；EV-1F.webp 打叉方格約 (527–607, 235–300) px',
                            basis='map-derived', note=f'井道取各層井框交集的外接矩形 {w}×{d} m；無井框的樓層取上下層交集。開口朝{dict(S="南", N="北", E="東", W="西")[side]}側。')
            lifts[bid] = [record(bid, lid, centre, angle, size, g, stops, 'map-derived', evidence, '位置依 EV.json 既有電梯井多邊形（官方圖打叉井框）。', floors, None)]
            if absorbed_ev: lifts[bid][0]['absorbedRooms'] = absorbed_ev
            continue
        spec = PLAN[bid]; first = next(f for f in b['floors'] if f['level'] == 1)
        symbol = C.to_local(first, spec['symbol']); frame = None; symbol_pt = Point(symbol)
        if spec['frame']:
            a = C.to_local(first, spec['frame'][:2]); c = C.to_local(first, spec['frame'][2:]); w, d = abs(c[0] - a[0]), abs(c[1] - a[1])
            if 1.6 <= w <= 3.2 and 1.6 <= d <= 3.2: frame = dict(centre=[(a[0] + c[0]) / 2, (a[1] + c[1]) / 2], w=round(w, 3), d=round(d, 3))
            else: notes.append(f'{bid}: plan frame is {w:.2f} x {d:.2f} m, not a single lift shaft; using a 2.0 x 2.0 shaft at the symbol')
        base = frame or dict(centre=symbol, w=2.0, d=2.0); basis = 'map-derived' if frame else 'schematic'
        prefer = [SIDE_ANGLE[spec['door']]] if spec['door'] else []
        angles = list(dict.fromkeys([round(a, 5) for a in [*prefer, legacy['angle'] % (2 * math.pi), 0.0, math.pi / 2, math.pi, 3 * math.pi / 2]]))
        need = max(2, len(legacy['stops']) - 1); chosen = None; tried = {}
        # wpd-run round 2: up to 3 m from the symbol (upper-storey traces are registered 1-3 m apart from 1F); nearest wins.
        offsets = sorted(((math.hypot(ix * .25, iz * .25), ix * .25, iz * .25) for ix in range(-12, 13) for iz in range(-12, 13)), key=lambda o: (round(o[0], 4), o[1], o[2]))
        for dist, dx, dz in [o for o in offsets if o[0] <= 3.0 + 1e-9]:
            centre = [round(base['centre'][0] + dx, 3), round(base['centre'][1] + dz, 3)]
            for angle in angles:
                g = geometry(centre, base['w'], base['d'], angle); took = {}; stops, why = runs_from_ground(order, floors, g, symbol_pt, took)
                if dist == 0: tried[angle] = why
                if len(stops) >= need and (chosen is None or len(stops) > len(chosen[3])): chosen = (centre, angle, g, stops, dist, took)
            if chosen: break
        px = f"{first['id']} 平面圖電梯符號像素 ({spec['symbol'][0]}, {spec['symbol'][1]})" + (f"，井框 {spec['frame']}" if spec['frame'] else '') + f"，local ({symbol[0]:.2f}, {symbol[1]:.2f})"
        if chosen:
            centre, angle, g, stops, dist, took = chosen; size = round(min(2.0, base['w'], base['d']), 2)
            if dist > 1.0: basis = 'schematic'  # moved more than the plan-reading tolerance: position no longer map-derived
            took = {fid: ids for fid, ids in took.items() if any(f['id'] == fid for f in stops)}
            absorb_note = lambda fid, rid: f"無代碼小描圖區域（{floors[fid].rooms[rid].area:.1f} m²）含電梯符號或大半在井道內，依協調者裁決併入井道"
            note = spec['note'] + ('井框依圖換算。' if frame else '圖上沒有可用的井框，井道用 2.0×2.0。') + (f'為避開房間與動線，位置微調 {dist:.2f} m。' if dist else '') + '開口方向取能接到主要走廊的一側' + ('（與圖上讀到的方向一致）。' if prefer and angle == round(prefer[0], 5) else '。')
            out = [stop_of(f, top, g, basis if f['level'] == 1 else 'schematic', px if f['level'] == 1 else f"沿用 {first['id']} 的位置；本層未對圖",
                           '；'.join(f"{rid}：{absorb_note(f['id'], rid)}" for rid in took.get(f['id'], [])) or None) for f in stops]
            absorbed_rec = absorb(structure, took, absorb_note)
            lifts[bid] = [record(bid, lid, centre, angle, size, g, out, basis, dict(sourceId=first['sourceId'], locator=px, basis=basis, note=note),
                                 '位置依官方 1F 平面圖電梯符號換算。' if frame else '位置依官方 1F 平面圖電梯符號換算；井道尺寸示意。', floors, legacy)]
            if absorbed_rec: lifts[bid][0]['absorbedRooms'] = absorbed_rec
        else:
            centre, angle, size = legacy['center'], legacy['angle'], legacy['size']; g = geometry(centre, size, size, angle); moved = 0
            # wpd-run round 2: the v9 spot must also pass today's checks (shaft on the slab of every stop, landing on the
            # main circulation); otherwise take the nearest spot within 2 m of it that does.
            if any(floors[fid].check(g) for fid in legacy['stops']):
                near = sorted(((math.hypot(ix * .25, iz * .25), ix * .25, iz * .25) for ix in range(-8, 9) for iz in range(-8, 9)), key=lambda o: (round(o[0], 4), o[1], o[2]))
                for dist, dx, dz in [o for o in near if o[0] <= 2.0 + 1e-9]:
                    hit = next((a for a in angles if not any(floors[fid].check(geometry([centre[0] + dx, centre[1] + dz], size, size, a)) for fid in legacy['stops'])), None)
                    if hit is not None:
                        centre, angle, moved = [round(centre[0] + dx, 3), round(centre[1] + dz, 3)], hit, dist; g = geometry(centre, size, size, angle); break
                else: notes.append(f'{bid}: the v9 lift spot fails the slab/landing checks and nothing within 2 m passes; kept as is')
            note = spec['note'] + f'圖上位置無法服務 {need} 層以上（{json.dumps(tried, ensure_ascii=False)}），沿用 v9 的示意位置' + (f'（為讓井道完整落在樓板上並接到走廊，移動 {moved:.2f} m）' if moved else '') + '；不代表實際電梯位置。'
            out = [stop_of(by_id[fid], top, g, 'schematic', '示意位置（v9 動線搜尋結果）') for fid in legacy['stops']]
            lifts[bid] = [record(bid, lid, centre, angle, size, g, out, 'schematic', dict(sourceId=first['sourceId'], locator=px, basis='schematic', note=note), legacy['evidence'], floors, legacy)]
            notes.append(f'{bid}: plan position rejected, kept the v9 schematic lift: {tried}')
    return structure, notes


def planner_regressions(before, after, buildings):
    """Run the real access planner on every storey whose lift changed."""
    out = []
    for bid in C.BIDS:
        old = (before.get('lifts', {}).get(bid) or [None])[0]; new = (after['lifts'].get(bid) or [None])[0]
        same = old and new and all(old.get(k) == new.get(k) for k in ('center', 'angle', 'size')) and [s['floorId'] for s in old['stops']] == [s['floorId'] for s in new['stops']] and before.get('roomOverrides') == after.get('roomOverrides')
        if same or not new: continue
        touched = {s['floorId'] for s in new['stops']} | {s['floorId'] for s in (old or {}).get('stops', [])}
        for f in buildings[bid]['floors']:
            if f['id'] not in touched: continue
            print('validating', f['id'], flush=True); a = C.plan(bid, f, before); b = C.plan(bid, f, after)
            # rooms this tool suppressed (absorbed into a shaft / reclassified as circulation) leave the count on purpose
            ob, oa = before.get('roomOverrides', {}).get(f['id'], {}), after.get('roomOverrides', {}).get(f['id'], {})
            removed = [rid for rid, v in oa.items() if v is None and ob.get(rid, 0) is not None]
            newly = sorted(set(b['report'].get('unreachableRoomIds', [])) - set(a['report'].get('unreachableRoomIds', [])))
            if newly: out.append(f"{f['id']}: rooms became unreachable: {newly}")
            if b['report']['reachableRoomCount'] < a['report']['reachableRoomCount'] - len(removed) or (a.get('entry') is not None and b.get('entry') is None):
                out.append(f"{f['id']}: reachable {a['report']['reachableRoomCount']} -> {b['report']['reachableRoomCount']}, entry {a.get('entry')} -> {b.get('entry')}")
            for landing in b.get('liftLandings', []):
                if not landing['connectedToPublicRoot']: out.append(f"{f['id']}: lift approach {landing['approach']} is not on the public root")
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--check', action='store_true'); ap.add_argument('--dry-run', action='store_true'); ap.add_argument('--no-plan', action='store_true'); ap.add_argument('--allow-failures', action='store_true')
    args = ap.parse_args(); raws = {bid: (C.DATA / f'{bid}.json').read_bytes() for bid in C.BIDS}; buildings = {bid: json.loads(raw) for bid, raw in raws.items()}
    # replacesServiceIds needs globally unique ids: give every vertical service one first.
    for bid in C.BIDS:
        changed = False
        for f in buildings[bid]['floors']:
            ids = {v.get('id') for v in f.get('verticalServices') or []}
            for n, v in enumerate(f.get('verticalServices') or [], 1):
                if not v.get('id'):
                    new = f"{f['id']}-service-{n:02}"
                    while new in ids: new += 'x'
                    v['id'] = new; ids.add(new); changed = True
        if changed:
            assert not args.check, f'{bid}.json has vertical services without ids'
            if not args.dry_run: C.commit_building(bid, raws[bid], buildings[bid], 'v12：補上 verticalServices 的 id（供電梯 replacesServiceIds 參照）。', check=False)
    seen = [v['id'] for bid in C.BIDS for f in buildings[bid]['floors'] for v in f.get('verticalServices') or []]
    assert len(seen) == len(set(seen)), 'vertical service ids are not globally unique'
    structure = json.loads(C.STRUCTURE.read_text()); updated, notes = upgrade(structure, buildings)
    if args.check:
        assert structure == updated, 'campus-structure.json lifts are not the current LiftGeometryV12 data'
        print('LiftGeometryV12 current and idempotent:', {bid: [s['floorId'] for s in l[0]['stops']] if l else [] for bid, l in updated['lifts'].items()}); return
    for n in notes: print('NOTE', n)
    for bid, l in updated['lifts'].items():
        for lift in l: print(f"  {lift['id']:10} centre {lift['center']} angle {lift['angle']} shaft {lift['shaftPolygon'][0]}..{lift['shaftPolygon'][2]} basis {lift['basis']} stops {[s['floorId'] for s in lift['stops']]}")
    if not args.no_plan:
        failures = planner_regressions(structure, updated, buildings)
        for p in failures: print('PLANNER', p)
        if failures and not args.allow_failures: raise SystemExit('Access planner regressions; nothing written.')
    if args.dry_run: print('dry run: nothing written'); return
    if updated != structure: C.STRUCTURE.write_text(C.dump(updated)); print('campus-structure.json written')
    else: print('campus-structure.json already current')


if __name__ == '__main__': main()
