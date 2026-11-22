#!/usr/bin/env python3
"""v12.1 WP-D2：海域資料 → public/data/sea.json（另寫 public/data/v12-sources.json 來源登錄）。

    python3 -B tools/apply_v12_sea.py            # 寫檔（冪等）
    python3 -B tools/apply_v12_sea.py --dry-run  # 只印摘要與地形探測
    python3 -B tools/apply_v12_sea.py --check    # 與現有檔案比對
    python3 -B tools/apply_v12_sea.py --strict   # 地形探測有警告就失敗

內容（docs/spec-v12.md 第 5 節；型別見 round2-astra.md §4「水域、日期與活動」「運動、portal 與帆船」）：
  waterBodies   WaterBodySpec[]：西子灣游泳區（浮球圈出）、游泳池大池、小池
  waterRoutes   WaterRouteSpec[]：SUP、獨木舟各一條，從沙灘北端（海域中心一側）下水
  seaCenter、buoys、lifeguardChair、surfZone、sailingViewPoint、sailingShow（兩隊各 4 艘）、hazards、wave（daily-wave-v1）
幾何常數寫在本檔上方；Y 取 runtime 相同的三角形插值地表，讀不到地形時退回預設值並警告。
這支工具不檢查碰撞世界；地形探測只回報「預期是水／陸地的點實際高度」，由協調者判讀。
"""
from __future__ import annotations

import math

import v12_world_common as C
from v12_world_common import P2, P3

OUT = C.DATA / 'sea.json'

# ---- 設計常數（世界公尺）---------------------------------------------------------------------------------------------
BEACH_EDGE_X = -330.0            # 沙灘多邊形的臨海邊（src/walk-art.ts 的 gx0）
SWIM_POLYGON = [[-330.2, 90.0], [-366.0, 90.0], [-381.0, 125.0], [-388.0, 160.0], [-381.0, 180.0], [-366.0, 190.0], [-330.2, 190.0]]
SWIM_OFFSET_RANGE = (25.0, 60.0)  # 浮球線離沙灘多邊形的距離範圍（spec §5）
BUOY_SPACING = 10.0
SWIM_ENTRIES_Z = (115.0, 160.0, 180.0)
CHAIR = (-320.0, 160.0)          # 救生員椅：沙灘中段，面向海（西）
SURF_POLYGON = [[-350.0, 242.0], [-378.0, 242.0], [-378.0, 274.0], [-350.0, 274.0]]
SURF_BEACH_POINT = (-307.0, 252.0)
SEA_CENTER = (-228.0, -37.0)     # spec §5：位置示意
SEA_CENTER_SIZE = (16.0, 10.0)
RACK = (-304.0, 58.0)            # 沙灘北端的器材架（示意），下水點旁
VIEWPOINT = (-316.0, 296.0)      # 海堤觀賞點（示意）：沙灘南端、海堤道路邊
# 依棒壘球場與溜冰場描圖外推約 15 m 的禁入區；實際防波堤與消波塊沒有描繪。
REVETMENT = [[-331.0, 314.0], [-440.0, 347.0], [-485.0, 343.0], [-485.0, 430.0], [-422.0, 443.0], [-331.0, 470.0]]
SUP = {
    'launch': (-327.7, 62.0),
    'waypoints': [[-332, 62], [-378, 58], [-402, 78], [-406, 118], [-404, 158], [-418, 160], [-422, 118], [-414, 70], [-380, 48], [-332, 58]],
    'corridor': [[-330.2, 44], [-330.2, 84], [-372, 84], [-394, 100], [-396, 170], [-432, 170], [-434, 60], [-400, 38]],
}
KAYAK = {
    'launch': (-327.7, 72.0),
    'waypoints': [[-332, 72], [-382, 68], [-412, 86], [-428, 130], [-430, 180], [-424, 222], [-440, 224], [-446, 180], [-444, 128], [-428, 74], [-386, 52], [-332, 68]],
    'corridor': [[-330.2, 52], [-330.2, 84], [-372, 84], [-394, 100], [-398, 236], [-452, 236], [-454, 60], [-410, 36]],
}
SAIL = {'center': (-493.0, 235.0), 'halfLength': 35.0, 'radius': {'nsysu': 22.0, 'osaka': 27.0}, 'boats': 4, 'spacing': 0.25, 'teamOffset': 0.125}
SAIL_MIN_GAP = 20.0              # 帆船路徑離游泳區至少這麼遠


def stadium(cx: float, cz: float, half: float, r: float, steps: int = 12) -> list[tuple[float, float]]:
    """南北向的操場形封閉航線（不重複首點）：東側直線往北、北端半圓、西側直線往南、南端半圓。"""
    pts = [(cx + r, cz + half), (cx + r, cz - half)]
    pts += [(cx + r * math.cos(math.pi * k / steps), cz - half - r * math.sin(math.pi * k / steps)) for k in range(1, steps + 1)]
    pts.append((cx - r, cz + half))
    pts += [(cx - r * math.cos(math.pi * k / steps), cz + half + r * math.sin(math.pi * k / steps)) for k in range(1, steps)]
    return pts


def rect(cx: float, cz: float, sx: float, sz: float) -> list:
    return [P2(cx - sx / 2, cz - sz / 2), P2(cx + sx / 2, cz - sz / 2), P2(cx + sx / 2, cz + sz / 2), P2(cx - sx / 2, cz + sz / 2)]


def build(terrain, trace, warnings: list[str]) -> dict:
    sea_y = C.num(terrain.sea_level if terrain else C.sea_level_y(), 3)
    ground = (lambda x, z: terrain.height_at(x, z)) if terrain else (lambda x, z: C.GROUND_Y)
    # 沙灘網格在 runtime 被抬到至少海面上 0.12 m（walk-art.ts 的 drape），再加上網格本身的 0.01 m。
    sand = lambda x, z: max(ground(x, z), sea_y + 0.12) + 0.01
    height_note = '海面 Y = terrain.json seaLevel（絕對世界高度）；陸上點的 Y 取三角形插值地表（沙灘至少海面上 0.13 m），runtime 應以實際支撐面重新取樣'
    if terrain is None:
        height_note = '沒有讀到地形：陸上點的 Y 是預設值，runtime 必須重新取樣'

    # ---- 游泳區 ----
    swim = [P2(*p) for p in SWIM_POLYGON]
    boundary = swim[:1] + swim[1:]  # 沿開放水域的邊界：由北岸端點繞外側到南岸端點
    buoys = [P3(x, sea_y, z) for x, z, _ in C.resample([tuple(p) for p in boundary], BUOY_SPACING)]
    entries = [P3(BEACH_EDGE_X + 2.3, sand(BEACH_EDGE_X + 2.3, z), z) for z in SWIM_ENTRIES_Z]
    safe = [p[:] for p in entries]
    chair = P3(CHAIR[0], sand(*CHAIR), CHAIR[1])
    # Shore approaches only; runtime starts from the player's current position.
    rescue = [[P3(BEACH_EDGE_X - 0.2, sea_y, z), safe[i]] for i, z in enumerate(SWIM_ENTRIES_Z)]
    bodies = [{
        'id': 'sea-swim', 'kind': 'sea', 'name': '西子灣游泳區', 'polygon': swim, 'surfaceY': sea_y,
        'entryPoints': entries, 'exitPoints': entries, 'rescuePaths': rescue, 'safeReturnPoints': safe,
        'basis': 'schematic', 'designNote': '浮球圈出的範圍示意：沙灘臨海邊向外 25–60 m，避開南側防波堤與消波塊的禁入區',
        'shoreOffsetRangeM': list(SWIM_OFFSET_RANGE), **C.binding('S1', 'S2', 'S4'),
    }]

    # ---- 泳池（描圖）----
    for fid, wid, name, basis, note in (
            ('pool-main', 'pool-main', '游泳池大池', 'map-derived', '50×21 m、8 道、東西向，依正射影像描圖；水道數示意'),
            ('pool-small', 'pool-small', '游泳池小池', 'schematic', '小池在藍色遮陽頂下，水面看不到；範圍取屋頂輪廓，約 30×11 m，示意')):
        f = C.facility(trace, fid)
        poly = [P2(*p) for p in f['polygon']]
        x0, z0, x1, z1 = C.bbox(poly)
        deck, surface, samples = C.pool_levels(poly, terrain)
        if samples and max(samples) - min(samples) > 0.3:
            warnings.append(f'{wid}：池角地表高差 {max(samples) - min(samples):.2f} m（{samples}），池邊需要整平')
        cz = (z0 + z1) / 2
        if fid == 'pool-main':
            from apply_v12_sports import POOL_LANE
            lanes, lw = 8, 2.5
            lane_z = z0 + ((z1 - z0) - (lanes - 1) * lw) / 2 + (POOL_LANE - 1) * lw
            ins = [P3(x1 + 1.2, deck, lane_z), P3((x0 + x1) / 2, deck, z1 + 1.0)]
            outs = ins + [P3(x0 - 1.2, deck, cz)]
            safe_points = [P3((x0 + x1) / 2, deck, z1 + 2.5)]
        else:
            ins = [P3((x0 + x1) / 2, deck, z0 - 1.0)]
            outs = ins + [P3(x1 + 1.2, deck, cz)]
            safe_points = [P3((x0 + x1) / 2, deck, z0 - 2.5)]
        body = {
            'id': wid, 'kind': 'pool', 'name': name, 'polygon': poly, 'surfaceY': surface, 'deckY': deck,
            'entryPoints': ins, 'exitPoints': outs, 'rescuePaths': [[P3((x0 + x1) / 2, surface, cz), safe_points[0]]], 'safeReturnPoints': safe_points,
            'basis': basis, 'designNote': note, 'provenance': {'imagery': C.IMAGERY_PROVENANCE, 'osm': C.OSM_PROVENANCE, 'osmId': f.get('osm')},
            **C.binding('S8', 'S4'),
        }
        if fid == 'pool-main':
            body['lanes'] = {'count': 8, 'widthM': 2.5, 'axis': 'x', 'note': '水道數示意'}
        bodies.append(body)

    # ---- SUP／獨木舟 ----
    exclusions = [swim, [P2(*p) for p in SURF_POLYGON], [P2(*p) for p in REVETMENT]]
    routes = []
    for craft, spec, ids, note in (('sup', SUP, ('S2', 'S3'), '立式划槳航線示意'), ('kayak', KAYAK, ('S2', 'S3', 'S12'), '獨木舟航線示意；夕陽時段開放（S12）')):
        launch = P3(spec['launch'][0], sand(*spec['launch']), spec['launch'][1])
        routes.append({
            'id': f'{craft}-loop', 'waterId': 'sea-swim', 'craft': craft, 'launchPoint': launch, 'returnPoint': launch,
            'waypoints': [P2(*p) for p in spec['waypoints']], 'corridor': [P2(*p) for p in spec['corridor']], 'exclusions': exclusions,
            'closed': True, 'lengthM': C.num(C.path_length(spec['waypoints'] + spec['waypoints'][:1]), 1),
            'basis': 'schematic', 'designNote': note + '；從沙灘北端（海域中心一側）下水，繞過游泳區外側', **C.binding(*ids),
        })

    # ---- 帆船賽（情境重現）----
    boats = []
    for t, team in enumerate(('nsysu', 'osaka')):
        loop = stadium(*SAIL['center'], SAIL['halfLength'], SAIL['radius'][team])
        path = [P3(x, sea_y, z) for x, z in loop]
        for k in range(SAIL['boats']):
            boats.append({'id': f'{team}-{k + 1}', 'team': team, 'path': path, 'startProgress': C.num(k * SAIL['spacing'] + t * SAIL['teamOffset'], 3)})
    show = {
        'id': 'sail-regatta-2025', 'waterId': 'sea-swim', 'viewingAnchorId': 'sail-view', 'boats': boats,
        'title': '臺日風帆友誼賽（情境重現）', 'label': '情境重現', 'reenactment': True,
        'teamLabels': {'nsysu': '中山', 'osaka': '日本隊'}, 'boatModel': 'laser_dinghy', 'pathClosed': True,
        'basis': 'schematic', 'designNote': '依 2025 年第四屆臺日風帆友誼賽的四對四團隊賽重現；航線示意，不模擬逐航次比分', **C.binding('S7'),
    }

    sx, sz = SEA_CENTER_SIZE
    return {
        'version': 1,
        'generatedBy': 'tools/apply_v12_sea.py',
        'units': '世界公尺：x 向東、y 向上、z 向南；P2 = [x, z]，P3 = [x, y, z]，Y 已含 runtime 地面偏移 GROUND_Y',
        'conventions': {'yaw': '繞 +Y；前進方向 = (-sin yaw, -cos yaw)，與 story-zones.json 的座位相同', 'heights': height_note,
                        'closedPaths': 'waterRoutes[].waypoints 與 sailingShow.boats[].path 是封閉迴圈，末點接回首點（首點不重複）'},
        'surface': {'surfaceY': sea_y, 'note': '航線共用 sea-swim 的海面高度、政策與救援點；航行範圍由 corridor 決定'},
        'wave': {
            'algorithm': 'daily-wave-v1', 'implementedBy': 'src/walk/water-policy.ts（Astra）', 'timezone': 'Asia/Taipei',
            'quota': {'ge1': 0.20, 'ge2': 0.03}, 'thresholdsM': {'surfAndTrainingOnly': 1, 'closed': 2}, 'comparison': '>=',
            'display': '無條件捨去到 0.1 m', 'periods': {'day': 'open', 'sunset': 'open', 'night': 'closed'},
            'notSimulated': ['颱風警報', '打雷'], 'qa': 'qa=1&qaWave=<m>&qaSea=clear|thunder|typhoon|closed',
            'basis': 'schematic', 'designNote': '浪高是依日期決定的遊戲數值，不是即時海象；門檻依 S1 原文', **C.binding('S1', 'S12'),
        },
        'beachReference': {'polygon': [P2(*p) for p in C.BEACH_POLYGON], 'seawardEdgeX': BEACH_EDGE_X, 'source': 'src/walk-art.ts:153（Astra 會把南端從網球區退開）'},
        'waterBodies': bodies,
        'waterRoutes': routes,
        'seaCenter': {
            'id': 'sea-center', 'name': '海域中心', 'position': P3(SEA_CENTER[0], ground(*SEA_CENTER), SEA_CENTER[1]),
            'footprint': rect(SEA_CENTER[0], SEA_CENTER[1], sx, sz), 'rentalDesk': P3(SEA_CENTER[0] - sx / 2 - 1.5, ground(SEA_CENTER[0] - sx / 2 - 1.5, SEA_CENTER[1]), SEA_CENTER[1]),
            'signboard': {'position': P3(SEA_CENTER[0] - sx / 2 - 2.5, ground(SEA_CENTER[0] - sx / 2 - 2.5, SEA_CENTER[1] + 3), SEA_CENTER[1] + 3), 'yaw': C.yaw_of(-1, 0)},
            'craftRack': {'position': P3(RACK[0], sand(*RACK), RACK[1]), 'note': '沙灘北端的器材架（示意），SUP 與獨木舟由此下水'},
            'equipment': ['立式划槳', '獨木舟', '衝浪板', '風浪板', '帆船', '雷射型帆船'],
            'basis': 'schematic', 'designNote': '位置示意', **C.binding('S2', 'S3'),
        },
        'buoyBoundary': {'id': 'swim-buoys', 'waterId': 'sea-swim', 'model': 'swim_buoy', 'spacingM': BUOY_SPACING, 'positions': buoys,
                  'basis': 'schematic', 'designNote': '沿游泳區的開放水域邊界每 10 m 一顆，位置示意', **C.binding('S4')},
        'buoys': buoys,
        'lifeguardChair': {'id': 'lifeguard-chair', 'model': 'lifeguard_chair', 'position': chair, 'yaw': C.yaw_of(-1, 0), 'npcId': 'lifeguard-sea',
                           'basis': 'schematic', 'designNote': '沙灘中段，面向游泳區；位置示意', **C.binding('S4')},
        'surfZone': {
            'id': 'surf-zone', 'name': '衝浪教學區', 'polygon': [P2(*p) for p in SURF_POLYGON], 'surfaceY': sea_y,
            'position': P3(SURF_BEACH_POINT[0], sand(*SURF_BEACH_POINT), SURF_BEACH_POINT[1]),
            'beachPoint': P3(SURF_BEACH_POINT[0], sand(*SURF_BEACH_POINT), SURF_BEACH_POINT[1]), 'eventId': 'ev-surf-class', 'activity': 'surf-class',
            'basis': 'schematic', 'designNote': '游泳區南側的教學區，範圍示意；浪高 1 m 以上未滿 2 m 時仍開放衝浪課', **C.binding('S1', 'S6', 'S14'),
        },
        'sailingViewPoint': {'id': 'sail-view', 'zoneId': 'sail-view', 'position': P3(VIEWPOINT[0], ground(*VIEWPOINT), VIEWPOINT[1]), 'radius': 10,
                             'lookAt': P2(*SAIL['center']), 'basis': 'schematic', 'designNote': '海堤觀賞點，位置示意', **C.binding('S7')},
        'anchors': {'sail-view': P3(VIEWPOINT[0], ground(*VIEWPOINT), VIEWPOINT[1])},
        'sailingShow': show,
        'hazards': [{'id': 'south-revetment', 'kind': 'breakwater', 'polygon': [P2(*p) for p in REVETMENT], 'basis': 'schematic',
                     'designNote': '依棒壘球場與溜冰場描圖外推約 15 m 的禁入區示意；實際防波堤與消波塊位置沒有描繪', 'sources': [], 'sourceIds': []},
                    {'id': 'seawall-apron', 'kind': 'breakwater', 'polygon': [[-335, 477], [-80, 543], [-85, 560], [-340, 494]],
                     'basis': 'schematic', 'designNote': '沿海堤實際 path 的海側外推 10–27 m，供消波塊使用；避開球場陸地與活動水域', 'sources': [], 'sourceIds': []}],
        'lines': {
            'speaker': 'lifeguard-sea',
            'buoyExceed': {'text': '嗶——游出游泳區浮球線了！為了安全，請先往岸邊游回來。', 'sourceIds': ['S4']},
            'nightClosed': {'text': '天黑了，夜間不開放下水，明天白天或傍晚再來吧。', 'sourceIds': [], 'note': '夜間關閉為遊戲設定'},
            'waveGe1': {'text': '今天浪高一公尺以上，只開放衝浪和訓練，其他暫停喔。', 'sourceIds': ['S1']},
            'waveGe2': {'text': '浪高兩公尺以上了，全海域禁止下水，請先退回岸上！', 'sourceIds': ['S1']},
            'storm': {'text': '遇上海上颱風警報或打雷就得停止活動離場，安全第一。', 'sourceIds': ['S1']},
        },
        'signboard': {
            'placeholder': '{h} 由 runtime 換成今日浪高（公尺，無條件捨去到 0.1）',
            'open': '今日浪高{h}公尺，海域正常開放，請先登記下水。',
            'surfOnly': '今日浪高{h}公尺，依規定僅開放衝浪與訓練活動。',
            'closed': '今日浪高{h}公尺，依規定禁止所有水上活動。',
            'night': '夜間海域不開放，請於白天或傍晚開放時段再來。',
            'weatherNote': '遇海上颱風警報或打雷，請依管理人員要求停止活動並離場。',
            'sourceIds': ['S1', 'S2'], 'sources': [],
        },
    }


def probe(data: dict, terrain, warnings: list[str]):
    """印出關鍵點的地表高度；預期是水卻在海面以上（或相反）就記警告。"""
    if terrain is None:
        return
    sea = terrain.sea_level
    print(f'\n地形探測（海面 Y = {sea:.3f}）')
    print('  岸線掃描：每列由 x=-240 向西找第一個低於海面的點')
    for z in range(40, 301, 20):
        x = -240.0
        while x >= -560 and terrain.height_at(x, z) >= sea - 0.05:
            x -= 2
        print(f'    z={z:4d}  ' + (f'水線約在 x={x:.0f}（地表 {terrain.height_at(x, z):.2f}）' if x >= -560 else '到 x=-560 都沒有低於海面'))
    checks = []
    for b in data['waterBodies'][:1]:
        checks += [(f'游泳區頂點 {p}', p, 'water') for p in b['polygon'][1:-1]]
        checks += [(f'游泳區入水點 {p}', [p[0], p[2]], 'land') for p in b['entryPoints']]
    for r in data['waterRoutes']:
        checks += [(f'{r["id"]} 航點 {p}', p, 'water') for p in r['waypoints']]
        checks.append((f'{r["id"]} 下水點', [r['launchPoint'][0], r['launchPoint'][2]], 'land'))
    checks += [(f'衝浪區頂點 {p}', p, 'water') for p in data['surfZone']['polygon'][1:3]]
    for boat in data['sailingShow']['boats'][::4]:
        checks += [(f'帆船 {boat["team"]} 航線點', [p[0], p[2]], 'water') for p in boat['path'][::6]]
    checks += [('海域中心', [data['seaCenter']['position'][0], data['seaCenter']['position'][2]], 'land'),
               ('救生員椅', [data['lifeguardChair']['position'][0], data['lifeguardChair']['position'][2]], 'land'),
               ('帆船觀賞點', [data['sailingViewPoint']['position'][0], data['sailingViewPoint']['position'][2]], 'land')]
    bad = 0
    for label, p, expect in checks:
        h = terrain.height_at(p[0], p[1])
        wet = h < sea
        if wet != (expect == 'water'):
            bad += 1
            warnings.append(f'地形探測：{label} 預期是{"水" if expect == "water" else "陸地"}，地表高度 {h:.2f}（海面 {sea:.2f}）')
    print(f'  探測 {len(checks)} 點，{bad} 點與預期不符')


def summary(data: dict):
    print('\nsea.json 摘要')
    for b in data['waterBodies']:
        x0, z0, x1, z1 = C.bbox(b['polygon'])
        print(f'  水域 {b["id"]:10s} {b["kind"]:4s} 頂點 {len(b["polygon"])}  x {x0:.1f}..{x1:.1f}  z {z0:.1f}..{z1:.1f}  水面 Y {b["surfaceY"]}  入水點 {len(b["entryPoints"])}  basis {b["basis"]}')
    for r in data['waterRoutes']:
        print(f'  航線 {r["id"]:10s} 航點 {len(r["waypoints"])}  長 {r["lengthM"]} m  下水點 {r["launchPoint"]}')
    print(f'  浮球 {len(data["buoys"])} 顆；第一顆 {data["buoys"][0]}，最後一顆 {data["buoys"][-1]}')
    print(f'  海域中心 {data["seaCenter"]["position"]}；救生員椅 {data["lifeguardChair"]["position"]}；觀賞點 {data["sailingViewPoint"]["position"]}')
    teams = {}
    for boat in data['sailingShow']['boats']:
        teams[boat['team']] = teams.get(boat['team'], 0) + 1
    xs = [p[0] for boat in data['sailingShow']['boats'] for p in boat['path']]
    zs = [p[2] for boat in data['sailingShow']['boats'] for p in boat['path']]
    print(f'  帆船 {len(data["sailingShow"]["boats"])} 艘 {teams}；航線 x {min(xs):.1f}..{max(xs):.1f}  z {min(zs):.1f}..{max(zs):.1f}')
    print(f'  浪高演算法 {data["wave"]["algorithm"]}')


def self_check(data: dict) -> list[str]:
    """寫檔前的硬性幾何檢查（與 verify_v12_world.py 重疊的最小集合，錯了就不寫）。"""
    errors = []
    swim = data['waterBodies'][0]['polygon']
    beach = data['beachReference']['polygon']
    for label, poly in [('游泳區', swim), ('衝浪區', data['surfZone']['polygon'])] + [(r['id'] + ' corridor', r['corridor']) for r in data['waterRoutes']] + [(h['id'], h['polygon']) for h in data['hazards']] + [(b['id'], b['polygon']) for b in data['waterBodies'][1:]]:
        errors += C.polygon_problems(poly, label)
    far = max(C.dist_point_poly(p, beach) for p in swim)
    if not SWIM_OFFSET_RANGE[0] <= far <= SWIM_OFFSET_RANGE[1]:
        errors.append(f'游泳區最遠離沙灘 {far:.1f} m，不在 {SWIM_OFFSET_RANGE} 內')
    if C.polys_overlap(swim, beach):
        errors.append('游泳區與沙灘多邊形重疊')
    hazard = data['hazards'][0]['polygon']
    for label, poly in [('游泳區', swim), ('衝浪區', data['surfZone']['polygon'])] + [(r['id'] + ' corridor', r['corridor']) for r in data['waterRoutes']]:
        if C.polys_overlap(poly, hazard):
            errors.append(f'{label} 伸進防波堤禁入區')
    for r in data['waterRoutes']:
        for p in r['waypoints']:
            if not C.in_poly(p, r['corridor']):
                errors.append(f'{r["id"]}：航點 {p} 不在 corridor 內')
            if any(C.in_poly(p, ex) for ex in r['exclusions']):
                errors.append(f'{r["id"]}：航點 {p} 在禁入範圍內')
    for boat in data['sailingShow']['boats']:
        path = [[p[0], p[2]] for p in boat['path']]
        for route in data['waterRoutes']:
            if C.path_polygon_gap(path + path[:1], route['corridor']) < 10:
                errors.append(f"帆船 {boat['id']}：離 {route['id']} corridor 不足 10 m")
        for p in boat['path']:
            q = [p[0], p[2]]
            if not C.in_bounds(*q):
                errors.append(f'帆船 {boat["id"]}：{q} 在 PLAY_BOUNDS 之外')
            elif C.in_poly(q, swim) or C.dist_point_poly(q, swim) < SAIL_MIN_GAP or C.in_poly(q, hazard):
                errors.append(f'帆船 {boat["id"]}：{q} 離游泳區或禁入區太近')
    return errors


def main():
    ap = C.cli(__doc__)
    ap.add_argument('--trace', help='sports-trace.json 的路徑（預設在 artifacts/v12/reference/）')
    args = ap.parse_args()
    warnings: list[str] = []
    terrain = C.load_terrain(warnings)
    trace, trace_path = C.load_trace(args.trace)
    print(f'描圖：{trace_path}；地形：{"已載入" if terrain else "未載入"}')
    data = build(terrain, trace, warnings)
    errors = self_check(data)
    if errors:
        C.die('幾何檢查沒過，未寫檔：\n  ' + '\n  '.join(errors[:30]))
    summary(data)
    probe(data, terrain, warnings)
    stale = [C.emit(C.SOURCES_FILE, C.dump(C.sources_registry()), args), C.emit(OUT, C.dump(data), args)]
    C.finish(args, stale, warnings)


if __name__ == '__main__':
    main()
