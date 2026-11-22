#!/usr/bin/env python3
"""v12 SC rooms, idempotent: split SC2005 / SC2003 / SC1011 into sub-rooms and add the SC restrooms (B1-4F).

Order: v9 -> v9.1 (structure, doors) -> office expansion -> apply_v12_lifts.py -> THIS -> apply_v12_restrooms.py
       -> verify_data.py --lock (after review) -> build_floor_access.py -> walk:bake -> verify_walk_data.py.
Re-running build_walkthrough_data.py or build_campus_structure.py undoes parts of this; run this tool again after them.

  python3 tools/apply_v12_sc_rooms.py            # apply (runs the real access planner on every touched floor)
  python3 tools/apply_v12_sc_rooms.py --check    # assert already applied, idempotent, review pin current
  python3 tools/apply_v12_sc_rooms.py --dry-run  # place and validate, print the report, write nothing

Every run rebuilds from the restored baseline kept in floor.roomSplits / floor.v12Restrooms (sourceRooms), so the
official source maps and the reviewed SC-B1 rooms are never touched. Writes SC.json, the source-review pin (+history),
the SC1014 clip in campus-structure.json and the v12 rows of public/data/rooms.json.
"""
import argparse
import copy
import json
from shapely.geometry import Polygon, box
import v12_common as C

REPORT = 'tools/apply_v12_sc_rooms.py'
V91_REPORT = 'tools/apply_v91_sc_doors.py'
DESIGN_NOTE = '隔間依使用者回報，位置示意'
M, S = 'map-derived', 'schematic'
# x of every wall west -> east, and whether that wall can be read off the official plan (round1-fable (A)).
SPLITS = {
    'SC-2F': {
        'SC-2F-SC2005': dict(code='SC2005', xs=[-11.11, -8.96, -6.71], walls=[M, M, M], evidence='SC-2F.webp 標籤「SC2005」中間的直牆，像素 x≈1677'),
        'SC-2F-SC2003': dict(code='SC2003', xs=[-0.11, 2.163, 4.437, 6.71], walls=[M, M, S, M], evidence='SC-2F.webp「SC」與「2003」之間的直牆，像素 x≈1912（與等分差 0.02 m）；第三道牆無圖可依'),
    },
    'SC-1F': {
        'SC-1F-SC1011': dict(code='SC1011', xs=[-22.77, -20.51, -18.34, -16.17], walls=[M, M, S, M], evidence='SC-1F.webp「SC」與「1011」之間的直牆，像素 x≈1484；第三道牆無圖可依', keepDoor=True),
    },
}
G = lambda slot, at, symbol, **kw: dict(slot=slot, at=list(at), symbol=symbol, **kw)
# Plan-symbol centres in floor-local metres (round1-fable (B)); 'mf' = merged men/women icon, 'f' = purple women icon.
# v12 wpd-run fallbacks. The automatic placement found no legal spot for these groups: the plan's WC cells are smaller than
# the 2.0 x 2.4 m minimum or open onto a secondary free core. Rectangles below come from a relaxed search
# (artifacts/v12/impl/wpd-run/manual_search.py: any free core, per-part door side, exact 2.0 x 2.4 allowed; still no
# overlap with rooms/stairs/lifts, door front free, corridor not cut). Round 2 (coordinator): sizes may go down to 1.8 x 2.2 m;
# a merged icon with no legal pair becomes one shared room (part 'S', 廁所（男女共用）) — placed automatically by add_restrooms.
# skip = no legal spot at all even at 1.8 x 2.2 m; recorded in floor.v12Restrooms.skipped.
_MAN = '範圍與門位為示意：圖上隔間小於 2.0×2.4 m 下限或不臨主要走廊，v12 wpd-run 以放寬搜尋擺放。'
_ONE = '圖上為男女合併圖示，但可用空間放不下兩間 2.0×2.4 m 且各自臨走廊的房間，暫列一間不分性別（同描圖區域無法切分時的規則）；需人工複核。'
_M = lambda part, rect, door, outward: dict(part=part, rect=rect, door=door, outward=outward)
_NOSPOT = '放寬到 1.8×2.2 m、任何空間核心、各自門向，仍找不到男、女兩間或一間共用廁所的合法位置。'
_SKIP_NW_F = '圖上女廁隔間約 2.3×2.1 m，在無障礙廁所南側；兩間都放到 2.0×2.4 m 以上且各自有門通往走廊的空間不存在（無障礙廁所的門只能朝南開進這一格）。'
SC_3F = [G('NW', (-23.5, -7.3), 'accessible', manual=[_M('A', (-24.8, -8.5, -22.8, -6.1), (-23.8, -6.1), (0, 1))], extentNote=_MAN),
         G('NW', (-23.5, -5.2), 'f', skip=_SKIP_NW_F + '放寬到 1.8×2.2 m 仍找不到合法位置。'),
         G('MN', (-16.4, -7.6), 'mf'),
         G('NE', (11.8, -7.6), 'mf'),
         G('S', (-14.3, 17.3), 'mf'),
         G('EE', (-37.8, 13.3), 'mf'),
         G('EW', (-84.5, 13.3), 'mf')]
SC_4F = [G('NW', (-23.5, -7.3), 'accessible', manual=[_M('A', (-24.5, -8.5, -22.5, -6.1), (-23.5, -6.1), (0, 1))], extentNote=_MAN),
         G('NW', (-23.5, -5.2), 'f', locationNote='紫色女廁圖示，性別以圖為準。', manual=[_M('F', (-26.5, -8.2, -24.5, -5.8), (-25.5, -5.8), (0, 1))],
           extentNote=_MAN + '圖上女廁隔間放不下（無障礙廁所的門朝南開進這一格）；放在西側最近的合法空位，偏移約 2.7 m。'),
         G('MN', (-16.4, -7.6), 'mf'),
         G('NE', (11.8, -7.6), 'mf'),
         G('S', (-14.3, 17.3), 'mf', manual=[_M('F', (-16.0, 16.0, -13.6, 18.0), (-14.8, 18.0), (0, 1)), _M('M', (-13.6, 16.0, -11.2, 18.0), (-12.4, 18.0), (0, 1))],
           extentNote=_MAN + '合併圖示切成男、女兩間，依「靠走廊入口為女廁」。'),
         G('EE', (-37.8, 13.3), 'mf'), G('EW', (-84.5, 13.3), 'mf')]
SC_WC = {
    'SC-B1': [G('MN', (-16.6, -8.0), 'text', locationNote='圖上只標「廁所」，未分性別。', reshape=(-17.7809, -9.1738, -14.2977, -6.9102),
                reshapeNote='描圖外框含門弧缺口，runtime planRestroom 放不下隔間（v12/fix1）；改為描圖外接矩形 3.48×2.26 m，門位（門弧）不變。'),
              G('NE', (12.2, -8.0), 'text', skip='圖上「廁所」就是受審查保護的 SC-B1-region-010（3.65×1.86 m）；不改動受審房間，也不在走廊另放（會擋住該房間的門）。')],
    'SC-1F': [
        # The merged icon sits inside the traced SC1014 rectangle: cut its north-east corner (ends at the stair clip, z=-4.53).
        G('NW', (-24.0, -7.3), 'mf', carve='SC-1F-SC1014', manual=[
            dict(part='F', rect=(-25.48, -6.64, -22.88, -4.53), door=(-22.88, -5.585), outward=(1, 0)),
            dict(part='M', rect=(-25.48, -8.75, -22.88, -6.64), door=(-22.88, -7.695), outward=(1, 0))]),
        # wpd-run overlay check: the automatic spot (2.0 m east, z -9.9..-7.3) stuck out through the north wall with its door
        # outside. Manual rect on the plan cell (walls about x -18.2..-14.5, z -8.9..-6.6); it isolates a ~15 m2 strip of
        # free space that the outline includes north/west of the cell, which is why the automatic and relaxed searches refused it.
        G('MN', (-16.1, -7.7), 'accessible', manual=[_M('A', (-17.1, -8.9, -14.7, -6.6), (-14.7, -7.75), (1, 0))],
          extentNote=_MAN + '放在圖上無障礙廁所隔間內，門朝東側走廊。'),
        G('NE', (11.6, -7.7), 'accessible'), G('S', (-14.3, 17.3), 'mf'), G('EW', (-84.4, 17.6), 'mf')],
    'SC-2F': [G('NW', (-23.5, -7.3), 'accessible'), G('NW', (-23.5, -5.2), 'f', locationNote='紫色女廁圖示，性別以圖為準。'),
              G('MN', (-16.4, -7.6), 'mf', skip='圖上男女合併廁所位於 SC2007 北側窄格；' + _NOSPOT),
              G('NE', (10.0, -7.4), 'accessible'),
              G('NE', (12.1, -7.4), 'mf', skip='同一格內的無障礙廁所已佔用可用空間；' + _NOSPOT),
              G('S', (-14.3, 17.3), 'mf')],
    'SC-3F': SC_3F,
    'SC-4F': SC_4F,
}
CARVES = {'SC-1F': {'SC-1F-SC1014': [(-25.48, -8.75, -22.88, -4.53)]}}


def split_floor(floor, specs, baseline_index):
    block = dict(version=1, basis=S, note=DESIGN_NOTE + '；編號由西向東，-1 在西。內牆依據見各子房間 wallBasis。', sourceRooms={}, sourceIndex={}, children={}, sourceOverrides=[])
    overrides = floor.setdefault('virtualPortalOverrides', []); made = []
    for pid, spec in specs.items():
        at = next((i for i, r in enumerate(floor['rooms']) if r['id'] == pid), None)
        if at is None: raise ValueError(f'{pid} is missing; restore the baseline before splitting')
        parent = floor['rooms'][at]; pts = parent['polygon']; xs = [p[0] for p in pts]; zs = [p[1] for p in pts]
        if len(pts) != 4 or abs(min(xs) - spec['xs'][0]) > 1e-6 or abs(max(xs) - spec['xs'][-1]) > 1e-6 or parent.get('code') != spec['code']:
            raise ValueError(f'Unexpected {pid} outline; refusing to split it')
        z0, z1 = min(zs), max(zs); wall = parent['door']['position'][1]
        if min(abs(wall - z0), abs(wall - z1)) > 1e-6: raise ValueError(f'{pid}: door is not on its corridor wall')
        outward = (0, -1) if abs(wall - z0) < 1e-6 else (0, 1)
        block['sourceRooms'][pid] = copy.deepcopy(parent); block['sourceIndex'][pid] = baseline_index[pid]; children = []
        for n, (x0, x1) in enumerate(zip(spec['xs'], spec['xs'][1:]), 1):
            cid = f'{pid}-{n}'; west, east = spec['walls'][n - 1], spec['walls'][n]; polygon = C.rect(x0, z0, x1, z1)
            keep = spec.get('keepDoor') and x0 <= parent['door']['position'][0] <= x1
            door = copy.deepcopy(parent['door']) if keep else dict(position=[round((x0 + x1) / 2, 4), wall], width=1.0, basis=S, note='v12 隔間後每間正中的示意門，朝向走廊。')
            child = {**copy.deepcopy(parent), 'id': cid, 'code': f"{spec['code']}-{n}", 'polygon': polygon, 'door': door,
                     'basis': M if west == M and east == M else S, 'aliases': [spec['code']], 'splitFrom': pid, 'designNote': DESIGN_NOTE,
                     'wallBasis': dict(west=west, east=east, evidence=spec['evidence']),
                     'sourceRegionPixels': [[round(v, 3) for v in C.to_pixels(floor, p)] for p in polygon]}
            children.append(child)
            if keep:
                # The v9.1 plan door moves to this child; coordinates stay exactly as they were.
                old = next((e for e in overrides if e.get('roomId') == pid), None)
                if old is not None:
                    block['sourceOverrides'].append(dict(index=overrides.index(old), entry=copy.deepcopy(old)))
                    overrides[overrides.index(old)] = json.loads(json.dumps(old, ensure_ascii=False).replace('"' + pid + '"', '"' + cid + '"'))
                else:
                    entry = C.door_override(V91_REPORT, cid, door['position'], outward, basis=door['basis'])
                    entry['geometryWarning'] = '官方平面圖門弧把描圖的牆切碎；只在這道門的範圍內修正。'; overrides.append(entry)
                moved = next(e for e in overrides if e.get('roomId') == cid)['suggestedPortal']['perRoomPosition'][cid]
                if moved != door['position']: raise ValueError(f'{cid}: migrated plan door moved: {moved} != {door["position"]}')
            else:
                overrides.append(C.door_override(REPORT, cid, door['position'], outward))
        if any(e.get('roomId') == pid or e.get('neighborRoomId') == pid for e in overrides): raise ValueError(f'{pid}: a door override still points at the split room')
        floor['rooms'][at:at + 1] = children; block['children'][pid] = [c['id'] for c in children]; made += block['children'][pid]
    floor['roomSplits'] = block
    return made


def carve_structure(structure):
    """Keep the stair-clipped SC1014 override in step with the restroom notch. Pure."""
    structure = copy.deepcopy(structure)
    for fid, rooms in CARVES.items():
        for rid, cuts in rooms.items():
            pts = structure.get('roomOverrides', {}).get(fid, {}).get(rid)
            if not pts: continue
            poly = Polygon(pts).buffer(0)
            for cut in cuts:
                if poly.intersection(box(*cut)).area > 1e-6: poly = poly.difference(box(*cut))
            if abs(poly.area - Polygon(pts).area) > 1e-6: structure['roomOverrides'][fid][rid] = C.ring(max(C.polys(poly), key=lambda g: g.area))
    return structure


def apply(data, structure, strict=True):
    data = copy.deepcopy(data); required = {}; problems = []; protected = C.protected_ids('SC')
    for f in data['floors']: C.restore_baseline(f)
    baselines = {f['id']: copy.deepcopy(f) for f in data['floors']}
    for f in data['floors']:
        fid = f['id']; index = {r['id']: i for i, r in enumerate(f['rooms'])}; ids = []
        for parent in SPLITS.get(fid, {}):
            if parent in structure.get('roomOverrides', {}).get(fid, {}): raise ValueError(f'{parent} has a structure clip; split it there too')
        if fid in SPLITS: ids += split_floor(f, SPLITS[fid], index)
        if fid in SC_WC:
            made, issues = C.add_restrooms('SC', f, structure, SC_WC[fid], REPORT, protected, M, strict=strict, baseline_index=index)
            ids += made; problems += issues
        if ids: required[fid] = ids
    return data, baselines, required, problems


def summary(data):
    for f in data['floors']:
        for r in f['rooms']:
            if r.get('kind') == 'restroom' or (r.get('splitFrom') and r.get('kind') == 'room'):
                xs = [p[0] for p in r['polygon']]; zs = [p[1] for p in r['polygon']]
                print(f"  {r['id']:26} {r.get('displayName', r.get('code')):6} x {min(xs):8.3f}..{max(xs):8.3f} z {min(zs):8.3f}..{max(zs):8.3f} door {r['door']['position']} basis {r['basis']}")
        for p in (f.get('v12Restrooms') or {}).get('placements', []): print('   ', f['id'], p)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--check', action='store_true'); ap.add_argument('--dry-run', action='store_true')
    ap.add_argument('--no-plan', action='store_true', help='skip the access-planner validation (not recommended)')
    ap.add_argument('--allow-failures', action='store_true', help='write even if a restroom group could not be placed')
    args = ap.parse_args()
    path = C.DATA / 'SC.json'; raw = path.read_bytes(); data = json.loads(raw)
    structure_raw = C.STRUCTURE.read_text(); structure = json.loads(structure_raw); carved = carve_structure(structure)
    updated, baselines, required, problems = apply(data, carved, strict=not args.allow_failures)
    if args.check:
        assert structure == carved, 'campus-structure.json: SC1014 clip has no restroom notch'
        C.commit_building('SC', raw, updated, '', check=True); C.sync_rooms_index(check=True)
        rooms = sum(len(v) for v in required.values())
        print(f'SC v12 rooms are current and idempotent: {rooms} sub-rooms/restrooms on {len(required)} floors; reviewed B1 rooms unchanged; review pin and rooms.json current')
        return
    for p in problems: print('PROBLEM', p)
    if any(not str(p).startswith('NOTE') for p in problems) and not args.allow_failures: raise SystemExit('Restroom placement failed; nothing written. Fix the spec (or pass --allow-failures).')
    if not args.no_plan:
        failures = []
        for f in updated['floors']:
            if f['id'] in required:
                print('validating', f['id'], flush=True); failures += C.planner_problems('SC', baselines[f['id']], f, carved, required[f['id']])
        for p in failures: print('PLANNER', p)
        if failures and not args.allow_failures: raise SystemExit('Access planner rejected the new rooms; nothing written.')
    summary(updated)
    if args.dry_run: print('dry run: nothing written'); return
    if carved != structure: C.STRUCTURE.write_text(C.dump(carved))
    wrote = C.commit_building('SC', raw, updated, 'v12：SC2005/SC2003/SC1011 依使用者回報拆成子房間（位置示意），SC1011 的 v9.1 固定門遷移到 SC-1F-SC1011-1（座標不變）；新增 B1–4F 廁所並在 SC1014 裁出 WC 缺口。', check=False)
    C.sync_rooms_index()
    print('SC.json', 'written' if wrote else 'already current', C.sha(path.read_bytes()))


if __name__ == '__main__': main()
