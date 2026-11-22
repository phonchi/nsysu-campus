#!/usr/bin/env python3
"""v12.1 WP-D2：運動區資料 → public/data/sports.json 與 public/data/interiors/fitness.json。

    python3 -B tools/apply_v12_sports.py            # 寫檔（冪等）
    python3 -B tools/apply_v12_sports.py --dry-run  # 只印摘要
    python3 -B tools/apply_v12_sports.py --check    # 與現有檔案比對
    選項：--trace PATH（sports-trace.json，預設在 artifacts/v12/reference/）

內容（docs/spec-v12.md 第 5 節；型別見 round2-astra.md §4「運動、portal 與帆船」）：
  venues        場地多邊形，逐筆取自空拍描圖 sports-trace.json（不含海域中心候選與體育館）
  timedCourses  TimedCourse 兩條：田徑場第 1 道一圈（4 個 gate）、大池 50 m 來回
  fitnessPortal FitnessPortal：體育館北側外牆前，不在實心碰撞盒內
  equipment     EquipmentSpec：跑步機與健身車（世界座標 = 室內場景原點 + 區域座標）
  fitnessCenters 第一體適能中心（portal 進出的示意室內）、第二體適能中心（只有示意門牌）
fitness.json 是示意室內場景，用區域座標；它不進 walkthrough/index.json。
"""
from __future__ import annotations

import math

import v12_world_common as C
from v12_world_common import P2, P3

OUT = C.DATA / 'sports.json'
OUT_INTERIOR = C.DATA / 'interiors/fitness.json'

SKIP = {'gym', 'sea-center-candidate', 'sea-center-candidate-north'}
# S8 的場館清單有列名的場地才掛 S8；看臺、館舍等量體只有描圖依據。
S8_KINDS = {'track', 'pitch', 'volleyball', 'basketball', 'tennis', 'swimming_pool', 'baseball', 'skating_rink'}
COPY_KEYS = ('inner', 'courts', 'parts', 'diamond', 'infieldClay', 'track', 'pool', 'center', 'angleDeg', 'size', 'confidence', 'areaM2')
LANE_WIDTH = 1.22
RUN_LINE = 0.30                  # 第 1 道的量測線在內緣外 0.30 m
CORRIDOR_LANES = 2               # 計時走廊含第 1、2 道，避免稍微踩線就失效
ARC_STEPS = 16
POOL_LANE = 4
POOL_GATE_INSET = 1.0            # gate 線離池壁
# 體育館區域座標（x 東、z 南，原點是量體中心）：北側附屬棟外牆在 z=-27。
PORTAL_LOCAL = (-6.0, -28.6)
RETURN_LOCAL = [(-6.0, -30.2), (-3.5, -30.2), (-8.5, -30.2)]
INTERIOR_DEPTH = -30.0           # 示意室內放在體育館正下方的世界高度
ROOM = [[-8.0, -5.0], [8.0, -5.0], [8.0, 5.0], [-8.0, 5.0]]
ROOM_HEIGHT = 3.6
TREADMILLS_X = (-5.0, -2.5, 0.0)
BIKES_Z = (-2.5, 0.0, 2.5)


def obround(cx: float, zn: float, zs: float, r: float) -> list[tuple[float, float]]:
    """逆時針（由上往下看的真實方向）跑一圈：西側直道南端 → 南彎 → 東側直道往北 → 北彎 → 西側直道往南。不重複首點。"""
    pts = [(cx - r * math.cos(math.pi * k / ARC_STEPS), zs + r * math.sin(math.pi * k / ARC_STEPS)) for k in range(ARC_STEPS + 1)]
    pts += [(cx + r * math.cos(math.pi * k / ARC_STEPS), zn - r * math.sin(math.pi * k / ARC_STEPS)) for k in range(ARC_STEPS + 1)]
    return pts


def build(trace: dict, terrain, warnings: list[str]) -> tuple[dict, dict]:
    ground = (lambda x, z: terrain.height_at(x, z)) if terrain else (lambda x, z: C.GROUND_Y)

    # ---- 場地 ----
    venues = []
    for f in trace['facilities']:
        if f['id'] in SKIP:
            continue
        v = {'id': f['id'], 'name': f.get('name_zh', f['id']), 'kind': f.get('kind', 'site'), 'polygon': [P2(*p) for p in f['polygon']]}
        for key in COPY_KEYS:
            if key in f:
                v[key] = f[key]
        osm = f.get('osm') or (f.get('osmCheck') or {}).get('osmId')
        v['basis'] = 'map-derived'
        v['provenance'] = {'imagery': C.IMAGERY_PROVENANCE, 'osm': C.OSM_PROVENANCE, 'osmId': osm}
        v.update(C.binding('S8') if v['kind'] in S8_KINDS else {'sources': [], 'sourceIds': [], 'designNote': '量體只有描圖依據'})
        venues.append(v)

    # ---- 跑圈計時 ----
    t = C.facility(trace, 'track')['track']
    (cx, zn), (_, zs) = t['semicircleCentres']
    if zn > zs:
        zn, zs = zs, zn
    r0 = float(t['kerbInnerRadius'])
    ri, ro, rl = r0, r0 + CORRIDOR_LANES * LANE_WIDTH, r0 + RUN_LINE
    line = obround(cx, zn, zs, rl)
    lap = C.path_length(line + line[:1])
    if abs(lap - float(t.get('lapLane1_m', 399))) > 3:
        warnings.append(f'第 1 道量測線算出 {lap:.1f} m，與描圖的 {t.get("lapLane1_m")} m 差超過 3 m')
    outer, inner = obround(cx, zn, zs, ro), obround(cx, zn, zs, ri)
    keyhole_ring = outer + outer[:1] + inner[:1] + inner[:0:-1] + inner[:1]
    gy = ground(cx - rl, zs)

    def gate(gid, ax, az, bx, bz, dx, dz):
        return {'id': gid, 'a': P3(ax, ground(ax, az), az), 'b': P3(bx, ground(bx, bz), bz), 'direction': [dx, dz]}
    run = {
        'id': 'track-lap', 'mode': 'run', 'name': '田徑場一圈計時', 'lane': 1, 'lapLengthM': C.num(lap, 1),
        'corridor': [P2(*p) for p in keyhole_ring], 'corridorOuter': [P2(*p) for p in outer], 'corridorInner': [P2(*p) for p in inner],
        'centerline': [P2(*p) for p in line], 'corridorLanes': [1, CORRIDOR_LANES],
        'gates': [gate('start', cx - ri, zs, cx - ro, zs, 0, 1), gate('south-bend', cx, zs + ri, cx, zs + ro, 1, 0),
                  gate('east-200m', cx + ri, zn, cx + ro, zn, 0, -1), gate('north-bend', cx, zn - ri, cx, zn - ro, -1, 0)],
        'requiredGateSequence': ['start', 'south-bend', 'east-200m', 'north-bend', 'start'],
        'startPoint': P3(cx - rl, gy, zs - 1.5), 'startYaw': C.yaw_of(0, 1), 'direction': '逆時針：起點在西側直道南端，先進南彎',
        'basis': 'map-derived', 'provenance': {'imagery': C.IMAGERY_PROVENANCE, 'osm': C.OSM_PROVENANCE},
        'designNote': '第 1 道約 399 m；corridor 是含第 1、2 道的環帶，寫成「外圈＋內圈反向」的單一多邊形（偶奇規則判斷內外），另給 corridorOuter／corridorInner',
        **C.binding('S8'),
    }

    # ---- 泳池計時 ----
    pool = C.facility(trace, 'pool-main')
    x0, z0, x1, z1 = C.bbox(pool['polygon'])
    lanes = int(pool.get('pool', {}).get('lanes', 8))
    lw = float(pool.get('pool', {}).get('laneWidthM', 2.5))
    first = z0 + ((z1 - z0) - (lanes - 1) * lw) / 2
    lane_z = first + (POOL_LANE - 1) * lw
    _, surface, _ = C.pool_levels([P2(*p) for p in pool['polygon']], terrain)
    east, west = x1 - POOL_GATE_INSET, x0 + POOL_GATE_INSET

    def pool_gate(gid, x, dx):
        return {'id': gid, 'a': P3(x, surface, lane_z - lw / 2), 'b': P3(x, surface, lane_z + lw / 2), 'direction': [dx, 0]}
    swim = {
        'id': 'pool-50-return', 'mode': 'swim', 'name': '大池 50 m 來回計時', 'waterId': 'pool-main', 'lane': POOL_LANE, 'distanceM': 100, 'gateDistanceM': C.num(2*(x1-x0-2*POOL_GATE_INSET),1),
        'corridor': [P2(x0, lane_z - lw / 2), P2(x1, lane_z - lw / 2), P2(x1, lane_z + lw / 2), P2(x0, lane_z + lw / 2)],
        'gates': [pool_gate('start', east, -1), pool_gate('turn', west, -1), pool_gate('finish', east, 1)],
        'requiredGateSequence': ['start', 'turn', 'finish'],
        'startPoint': P3(x1 - 0.5, surface, lane_z), 'startYaw': C.yaw_of(-1, 0),
        'basis': 'map-derived', 'provenance': {'imagery': C.IMAGERY_PROVENANCE, 'osm': C.OSM_PROVENANCE},
        'designNote': f'第 {POOL_LANE} 道，從東端出發游到西端折返；gate 線離池壁 {POOL_GATE_INSET} m，水道數示意', **C.binding('S8'),
    }

    # ---- 體適能中心 ----
    try:
        boxes = C.solid_boxes('gym')
        gcx, gcz, _ = C.landmark_frame('gym')
    except (OSError, ValueError, KeyError) as e:
        C.die(f'讀不到體育館的 placements.json 或 gym.collision.json：{e}')
    tx, tz = C.landmark_to_world('gym', *PORTAL_LOCAL)
    returns = [C.landmark_to_world('gym', *p) for p in RETURN_LOCAL]
    for label, (x, z) in [('入口觸發點', (tx, tz))] + [('返回點', p) for p in returns]:
        if C.in_solid(x, z, boxes, 0.5):
            C.die(f'體適能中心{label} ({x:.2f}, {z:.2f}) 在體育館的實心碰撞盒內（含 0.5 m 邊距），請調整 PORTAL_LOCAL／RETURN_LOCAL')
    if not C.in_solid(tx, tz, boxes, 2.5):
        C.die(f'體適能中心入口觸發點 ({tx:.2f}, {tz:.2f}) 離體育館外牆超過 2.5 m，不算在外牆前')
    origin = [C.num(gcx), INTERIOR_DEPTH, C.num(gcz)]
    world = lambda p: P3(origin[0] + p[0], origin[1] + p[1], origin[2] + p[2])
    local_equipment = []
    for i, x in enumerate(TREADMILLS_X):
        local_equipment.append({'id': f'treadmill-{i + 1}', 'kind': 'treadmill', 'position': [x, 0.0, -3.6], 'yaw': C.yaw_of(0, -1),
                                'approach': [x, 0.0, -2.2], 'exitPoints': [[x, 0.0, -2.0], [x + 1.1, 0.0, -2.6]]})
    for i, z in enumerate(BIKES_Z):
        local_equipment.append({'id': f'bike-{i + 1}', 'kind': 'stationary-bike', 'position': [6.2, 0.0, z], 'yaw': C.yaw_of(1, 0),
                                'approach': [4.0, 0.0, z], 'exitPoints': [[3.8, 0.0, z], [3.8, 0.0, z + 0.9]]})
    spawn_local = [0.0, 0.0, 3.2]
    interior = {
        'version': 1, 'generatedBy': 'tools/apply_v12_sports.py', 'id': 'fitness-center-1', 'name': '第一體適能中心（室內示意）',
        'frame': '區域公尺：x 向東、y 向上、z 向南；世界座標 = origin + 區域座標（yaw 0）', 'origin': origin, 'yaw': 0,
        'room': {'polygon': ROOM, 'height': ROOM_HEIGHT, 'floorY': 0.0},
        'door': {'position': [0.0, 0.0, 5.0], 'width': 1.8, 'wall': 'south', 'exitTrigger': [0.0, 0.0, 4.3], 'portalId': 'fitness-portal-gym'},
        'spawn': spawn_local, 'spawnYaw': C.yaw_of(0, -1), 'equipment': local_equipment,
        'decor': [{'kind': 'fitness_station', 'position': [-6.5, 0.0, 1.5], 'yaw': 0}, {'kind': 'fitness_station', 'position': [-6.5, 0.0, 3.5], 'yaw': 0},
                  {'kind': 'mirror-wall', 'wall': 'north'}, {'kind': 'sign', 'text': '第一體適能中心（示意）', 'position': [0.0, 2.4, 4.9]}],
        'npcSpots': [[-3.5, 0.0, 1.0], [3.0, 0.0, 2.0]],
        'basis': 'schematic', 'designNote': '室內配置示意，不是依實際樓層重建；不進 walkthrough/index.json', **C.binding('S8', 'S9'),
    }
    equipment = [{**e, 'position': world(e['position']), 'approach': world(e['approach']), 'exitPoints': [world(p) for p in e['exitPoints']],
                  'sceneId': interior['id'], 'basis': 'schematic', **C.binding('S8','S9')} for e in local_equipment]
    portal = {
        'id': 'fitness-portal-gym', 'exteriorTrigger': P3(tx, ground(tx, tz), tz), 'exteriorReturnPoints': [P3(x, ground(x, z), z) for x, z in returns],
        'interiorSceneId': interior['id'], 'interiorSpawn': world(spawn_local), 'host': 'gym', 'label': '體適能中心',
        'basis': 'schematic', 'designNote': '體育館北側外牆加的示意入口，不改 gym.glb；入口方位沒有來源依據', **C.binding('S9'),
    }
    stand = C.facility(trace, 'grandstand')
    block = stand.get('parts', {}).get('centralBlock') or stand['polygon']
    _, bz0, _, bz1 = C.bbox(block)
    sign = (C.bbox(stand['polygon'])[2] + 1.0, (bz0 + bz1) / 2)   # 看臺東緣外 1 m，對著中央量體
    centers = [
        {'id': 'fitness-1', 'name': '第一體適能中心', 'host': 'gym', 'portalId': portal['id'], 'sceneId': interior['id'], 'enterable': True,
         'basis': 'schematic', 'designNote': '以 portal 進出的示意室內', **C.binding('S8', 'S9')},
        {'id': 'fitness-2', 'name': '第二體適能中心（示意）', 'host': 'grandstand', 'enterable': False, 'signPosition': P3(sign[0], ground(*sign), sign[1]),
         'signYaw': C.yaw_of(1, 0), 'basis': 'schematic', 'designNote': '位置示意：只在看臺東緣（對著中央量體）設門牌，不可進入', **C.binding('S8')},
    ]
    sports = {
        'version': 1, 'generatedBy': 'tools/apply_v12_sports.py',
        'units': '世界公尺：x 向東、y 向上、z 向南；P2 = [x, z]，P3 = [x, y, z]，Y 已含 runtime 地面偏移 GROUND_Y',
        'conventions': {'yaw': '繞 +Y；前進方向 = (-sin yaw, -cos yaw)', 'gates': 'a、b 是 gate 線的兩端，direction 是通過方向的單位向量 [dx, dz]',
                        'heights': '陸上點的 Y 取三角形插值地表，runtime 應重新取樣；泳池 gate 的 Y 是水面', 'angleDeg': '場地長軸方向，由 +x 量向 +z'},
        'provenance': {'imagery': C.IMAGERY_PROVENANCE, 'osm': C.OSM_PROVENANCE, 'notModelled': ['射箭場（找不到位置）', '多功能空間（找不到位置）']},
        'facilities': venues, 'courses': [run, swim], 'portals': [portal], 'equipment': equipment, 'fitnessCenters': centers,
        'groundNotes': ['棒壘球場與溜冰場在 CAMPUS_GROUND（x < -330）之外，地面要延伸過去', '網球場與沙灘多邊形重疊，沙灘要從網球區退開，以海堤道路為界',
                        '田徑場紅色鋪面向南延伸到 z 約 493.7，超出 CAMPUS_GROUND 的 480'],
    }
    # Canonical loader scene uses world coordinates. Equipment is owned only by
    # sports.equipment; duplicating it here would render every item twice.
    interior['scenes'] = [{'id': interior['id'], 'polygon': [P2(origin[0]+p[0], origin[2]+p[1]) for p in ROOM],
                           'floorY': origin[1], 'exitPoint': world(interior['door']['exitTrigger']), 'equipment': [],
                           'basis': 'schematic', 'designNote': interior['designNote'], **C.binding('S8','S9')}]
    return sports, interior


def main():
    ap = C.cli(__doc__)
    ap.add_argument('--trace', help='sports-trace.json 的路徑')
    args = ap.parse_args()
    warnings: list[str] = []
    terrain = C.load_terrain(warnings)
    trace, trace_path = C.load_trace(args.trace)
    print(f'描圖：{trace_path}；地形：{"已載入" if terrain else "未載入"}')
    sports, interior = build(trace, terrain, warnings)
    errors = []
    for v in sports['facilities']:
        errors += C.polygon_problems(v['polygon'], f'場地 {v["id"]}')
    for c in sports['courses']:
        for key in ('corridorOuter', 'corridorInner') if 'corridorOuter' in c else ('corridor',):
            errors += C.polygon_problems(c[key], f'{c["id"]} {key}')
    if errors:
        C.die('幾何檢查沒過，未寫檔：\n  ' + '\n  '.join(errors[:30]))
    print('\nsports.json 摘要')
    for v in sports['facilities']:
        x0, z0, x1, z1 = C.bbox(v['polygon'])
        print(f'  場地 {v["id"]:16s} {v["kind"]:14s} x {x0:.1f}..{x1:.1f}  z {z0:.1f}..{z1:.1f}  球場 {len(v.get("courts", []))}  來源 {v["sourceIds"]}')
    for c in sports['courses']:
        print(f'  計時 {c["id"]:15s} {c["mode"]}  gate {[g["id"] for g in c["gates"]]}  順序 {c["requiredGateSequence"]}  起點 {c["startPoint"]}' + (f'  一圈 {c["lapLengthM"]} m' if 'lapLengthM' in c else ''))
        for g in c['gates']:
            print(f'      gate {g["id"]:11s} a {g["a"]}  b {g["b"]}  方向 {g["direction"]}')
    p = sports['portals'][0]
    print(f'  體適能入口 {p["exteriorTrigger"]}；返回點 {p["exteriorReturnPoints"]}；室內出生點 {p["interiorSpawn"]}')
    print(f'  器材 {len(sports["equipment"])} 台：' + '、'.join(f'{e["id"]} {e["position"]}' for e in sports['equipment']))
    stale = [C.emit(OUT, C.dump(sports), args), C.emit(OUT_INTERIOR, C.dump(interior), args)]
    C.finish(args, stale, warnings)


if __name__ == '__main__':
    main()
