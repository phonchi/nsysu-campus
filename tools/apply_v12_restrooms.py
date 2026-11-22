#!/usr/bin/env python3
"""v12 restrooms for the seven other buildings (EN, BI, PH, CH, EC, MS, EV), idempotent.

1F: WC symbols read off the official 1F plan (native image pixels) -> basis map-derived where the room can stand
    at the symbol; merged men/women icons are split in two (the one nearer the corridor entrance is the women's room).
2F and above (not RF, not basements): the same floor-local position, basis schematic. A floor where nothing fits, or
    where the access planner rejects the result, is skipped and the reason is kept in floor.v12Restrooms.

Run after apply_v12_lifts.py and apply_v12_sc_rooms.py, before build_floor_access.py.

  python3 tools/apply_v12_restrooms.py [--buildings EN,BI] [--check] [--dry-run] [--no-plan] [--retry-rejected]
"""
import argparse
import copy
import json
import v12_common as C

REPORT = 'tools/apply_v12_restrooms.py'
G = lambda slot, px, symbol, **kw: dict(slot=slot, px=px, symbol=symbol, **kw)
# 1F plan pixels of each WC symbol (round1-fable (B), native resolution of data/official-plans/walkthrough/<bid>-1F.webp).
_STAIR = 'campus-structure 的示意樓梯核心與樓梯口（stairCores body + 1.6 m apron）蓋住了圖上的廁所隔間；放寬到 1.8×2.2 m 的搜尋也找不到合法位置。'
WC_1F = {
    # wpd-run: skip = no legal spot even with the relaxed search (artifacts/v12/impl/wpd-run/manual_search.py); kept in
    # floor.v12Restrooms.skipped on every storey (upper storeys only repeat the 1F position).
    'EN': [G('P1', (975, 63), 'f', skip='1F 北端女廁：'+_STAIR),
           G('P2', (1315, 65), 'accessible', skip='1F 東北角廁所：'+_STAIR),
           G('P2', (1315, 65), 'm', skip='1F 東北角廁所：'+_STAIR),
           G('P3', (447, 441), 'mf'), G('P4', (325, 108), 'f')],
    'BI': [G('P1', (305, 410), 'f'), G('P2', (382, 386), 'mf'), G('P3', (305, 475), 'accessible'), G('P4', (384, 433), 'accessible', skipOn=['BI-1F'], skip='1F 的男女合併圖示與無障礙圖示在同一個約 2.6×5.1 m 的隔間，連 1.8×2.2 m 也放不下三間；自動擺位把無障礙廁所推進圖上的電梯格，改為不建。上層照常沿用位置。')],
    'PH': [G('P1', (310, 357), 'f', locationNote='1F 平面圖只看到女廁圖示。')],
    'CH': [G('P1', (402, 148), 'mf'), G('P2', (402, 217), 'accessible'), G('P3', (491, 215), 'mf')],
    'EC': [G('P1', (220, 175), 'mf'), G('P2', (553, 175), 'accessible', skip='無障礙廁所小格夾在中央樓梯與 EC1011-2 之間；放寬到 runtime 允許的最小尺寸（EC 比例下約 1.86×2.23 m）仍找不到合法位置。')],
    'MS': [G('P1', (378, 432), 'mf'), G('P2', (335, 524), 'accessible')],
    'EV': [G('P1', (397, 255), 'text', locationNote='CAD 圖只標「廁所」，未分性別。'), G('P2', (490, 270), 'text', locationNote='CAD 圖只標「廁所」，未分性別。')],
}


def empty_block(reasons):
    return dict(version=1, tool=REPORT, note='這層的 v12 廁所被 access planner 否決，未建。', generated=[], sourceRooms={}, sourceIndex={}, sourceOverrides=[], placements=[], skipped=[], plannerRejected=reasons)


def apply(bid, data, structure, strict=True, retry=False):
    data = copy.deepcopy(data); protected = C.protected_ids(bid); required = {}; problems = []; priors = {}
    for f in data['floors']: priors[f['id']] = C.restore_baseline(f)
    baselines = {f['id']: copy.deepcopy(f) for f in data['floors']}
    first = next(f for f in data['floors'] if f['level'] == 1)
    spots = [dict(g, at=C.to_local(first, g['px'])) for g in WC_1F[bid]]
    for f in data['floors']:
        if f['level'] == 99 or f['level'] < 1: continue
        prior = priors[f['id']]
        if prior and prior.get('plannerRejected') and not retry:
            f['v12Restrooms'] = empty_block(prior['plannerRejected']); continue
        ground = f['level'] == 1
        groups = [dict(g, locationNote=g.get('locationNote', '圖示中心讀圖誤差約 ±0.6 m。') if ground else f"沿用 {first['id']} 平面圖符號的位置；本層未對圖。") for g in spots]
        made, issues = C.add_restrooms(bid, f, structure, groups, REPORT, protected, 'map-derived' if ground else 'schematic',
                                       strict=ground and strict, max_region_area=40 if ground else 25)
        problems += issues
        if made: required[f['id']] = made
    return data, baselines, required, problems


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--buildings', default=','.join(WC_1F)); ap.add_argument('--check', action='store_true'); ap.add_argument('--dry-run', action='store_true')
    ap.add_argument('--no-plan', action='store_true'); ap.add_argument('--allow-failures', action='store_true'); ap.add_argument('--retry-rejected', action='store_true')
    args = ap.parse_args(); structure = json.loads(C.STRUCTURE.read_text()); total = 0
    for bid in args.buildings.split(','):
        path = C.DATA / f'{bid}.json'; raw = path.read_bytes(); data = json.loads(raw)
        updated, baselines, required, problems = apply(bid, data, structure, strict=not args.allow_failures, retry=args.retry_rejected and not args.check)
        count = sum(len(v) for v in required.values()); total += count
        if args.check:
            C.commit_building(bid, raw, updated, '', check=True); print(f'{bid}: {count} restrooms on {len(required)} floors, current and idempotent'); continue
        for p in problems: print('PROBLEM', p)
        if any(str(p).startswith('FATAL') for p in problems) and not args.allow_failures:
            raise SystemExit(f'{bid}: a 1F restroom could not be placed; nothing written for this building. Fix WC_1F or pass --allow-failures.')
        if not args.no_plan:
            for f in updated['floors']:
                fid = f['id']
                if fid not in required: continue
                print('validating', fid, flush=True); failures = C.planner_problems(bid, baselines[fid], f, structure, required[fid])
                if not failures: continue
                for p in failures: print('PLANNER', p)
                if f['level'] == 1 and not args.allow_failures: raise SystemExit(f'{fid}: access planner rejected the 1F restrooms; nothing written for this building.')
                # Upper floors only repeat the 1F position: drop this floor and remember why.
                f.clear(); f.update(copy.deepcopy(baselines[fid])); f['v12Restrooms'] = empty_block(failures); required.pop(fid)
        for f in updated['floors']:
            for r in f['rooms']:
                if r.get('kind') == 'restroom':
                    xs = [p[0] for p in r['polygon']]; zs = [p[1] for p in r['polygon']]
                    print(f"  {r['id']:24} {r['displayName']:6} x {min(xs):8.3f}..{max(xs):8.3f} z {min(zs):8.3f}..{max(zs):8.3f} door {r['door']['position']} basis {r['basis']}")
            block = f.get('v12Restrooms') or {}
            for p in block.get('placements', []) + block.get('skipped', []): print('   ', f['id'], p)
            if block.get('plannerRejected'): print('   ', f['id'], 'planner rejected:', block['plannerRejected'])
        if args.dry_run: continue
        wrote = C.commit_building(bid, raw, updated, f'v12：{bid} 新增廁所房間（1F 依平面圖 WC 符號，其餘樓層沿用同一位置、示意）。', check=False)
        print(bid, 'written' if wrote else 'already current', C.sha(path.read_bytes()))
    if args.check: C.sync_rooms_index(check=True); print(f'v12 restrooms current: {total} rooms in {args.buildings}; rooms.json current')
    elif not args.dry_run: C.sync_rooms_index()


if __name__ == '__main__': main()
