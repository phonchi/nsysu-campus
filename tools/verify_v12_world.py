#!/usr/bin/env python3
"""v12.1 海域、公車、運動區資料的唯讀驗證（npm run build 會跑）。

    python3 -B tools/verify_v12_world.py        # 有錯誤時以代碼 1 結束；警告只列出

檢查：
  來源    sources 只能是 source-check.md 標 ✅ 的網址，sourceIds 只能是 S1–S14，sourceFiles 只能是存在的 data/sources/**
  幾何    多邊形合法（有限、不自交、有面積）且在 PLAY_BOUNDS 內；游泳區離沙灘 25–60 m、不碰防波堤禁入區
  帆船    兩隊各 4 艘，航線在游泳區外側
  公車    站序與 spec 一致；每段路徑連續；sourceEdgeIds 是 graph 上相連的可行車邊；graphRevision 與 graph 相符；
          文學院迴轉圈與 1626 拓寬的轉彎半徑 ≥ 9 m。未處理的急彎與俯仰問題列為警告
  運動    場地齊全、計時路線的 gate 與順序、體適能入口不在體育館實心盒內、器材在室內場景裡
  台詞    v12.1 的 NPC、事件、救生員、立牌、公車台詞：每句 ≤28 字、全形標點、沒有未核准的敘述
load() 與 verify() 分開，tests/verify_v12_world_test.py 用它們做反例測試。
"""
from __future__ import annotations

import hashlib
import json
import math
import sys
from functools import lru_cache
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import v12_world_common as C  # noqa: E402

DRIVABLE = {'tertiary', 'residential', 'unclassified', 'living_street', 'service'}
HAMASEN_OSM_URLS = {
    'https://www.openstreetmap.org/copyright',
    'https://api.openstreetmap.org/api/0.6/map?bbox=120.26815,22.62,120.27582,22.62555',
    'https://api.openstreetmap.org/api/0.6/map?bbox=120.2635,22.613,120.273,22.6214',
}
BASES = {'map-derived', 'schematic'}
EXPECTED_STOPS = {
    'campus-bus': ['gate', 'admin', 'dorm-h', 'activity', 'wuling', 'liberal-arts', 'wuling', 'activity', 'dorm-h', 'gate', 'hamasen-campus-stop'],
    'orange-1-ext': ['gate', 'admin', 'dorm-h', 'activity', 'wuling', 'liberal-arts', 'marine-sci', 'marine-eng', 'dorm-h', 'activity', 'admin', 'gate', 'hamasen-orange-stop'],
}
REQUIRED_VENUES = {'track': 0, 'infield': 0, 'basketball-w': 4, 'basketball-e': 3, 'volleyball-n': 2, 'volleyball-s': 2, 'tennis-outdoor': 2, 'tennis-covered': 0,
                   'baseball': 0, 'rink': 0, 'grandstand': 0, 'jump-runway': 0, 'pool-building': 0}
REQUIRED_NPCS = ['lifeguard-sea', 'marine-clerk', 'surf-coach', 'sail-student', 'bus-driver-campus', 'bus-driver-orange', 'runner-1', 'swimmer-1', 'swimmer-2', 'gym-1', 'gym-2']
REQUIRED_EVENTS = ['ev-surf-class', 'ev-sail-regatta']
MIN_TURN = 9.0
FILES = {'sea': 'sea.json', 'bus': 'bus-routes.json', 'sports': 'sports.json', 'fitness': 'interiors/fitness.json', 'registry': 'v12-sources.json',
         'npcs': 'npcs.json', 'zones': 'story-zones.json', 'graph': 'walkthrough/outdoor-graph.json'}


def load() -> dict:
    out = {}
    for key, name in FILES.items():
        path = C.DATA / name
        if not path.exists():
            raise FileNotFoundError(f'找不到 public/data/{name}；請依序執行 apply_v12_sea.py、apply_v12_bus.py、apply_v12_sports.py、apply_v12_sea_events.py')
        out[key] = json.loads(path.read_text(encoding='utf-8'))
    try:
        out['gymBoxes'] = C.solid_boxes('gym')
    except (OSError, ValueError, KeyError):
        out['gymBoxes'] = None
    return out


def xz(p) -> list:
    return [p[0], p[-1]]


def finite_point(p, n: int) -> bool:
    return isinstance(p, list) and len(p) == n and all(isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) for v in p)


# ---------------------------------------------------------------------------------------------------------------------
def check_sources(doc, label: str, errors: list[str], registry_ids: set[str]):
    def walk(node, where: str):
        if isinstance(node, dict):
            for url in node.get('sources', []) if isinstance(node.get('sources'), list) else []:
                if url not in C.APPROVED_URLS:
                    errors.append(f'{where}：來源 {url!r} 不是核准的網址')
            for sid in node.get('sourceIds', []) if isinstance(node.get('sourceIds'), list) else []:
                if sid not in C.SOURCE_BY_ID or sid not in registry_ids:
                    errors.append(f'{where}：來源代號 {sid!r} 不在 S1–S14 的登錄裡')
            for f in node.get('sourceFiles', []):
                if not (isinstance(f, str) and f.startswith('data/sources/') and '..' not in f and (C.ROOT / f).is_file()):
                    errors.append(f'{where}：本機來源 {f!r} 必須是存在的 data/sources/** 檔案')
            for k, v in node.items():
                walk(v, f'{where}.{k}')
        elif isinstance(node, list):
            for i, v in enumerate(node):
                walk(v, f'{where}[{i}]')
        elif isinstance(node, str) and node.startswith(('http://', 'https://')) and node not in C.APPROVED_URLS:
            if not (label == 'bus' and '.hamasenSource.' in where and node in HAMASEN_OSM_URLS):
                errors.append(f'{where}：網址 {node!r} 不是核准的來源')
    walk(doc, label)


def need_binding(rec, label: str, errors: list[str]):
    if not isinstance(rec, dict):
        errors.append(f'{label}：不是物件')
        return
    if not isinstance(rec.get('sources'), list) or not isinstance(rec.get('sourceIds'), list):
        errors.append(f'{label}：缺少 sources 或 sourceIds')
    if rec.get('basis') not in BASES:
        errors.append(f'{label}：basis 必須是 map-derived 或 schematic')
    if not rec.get('sourceIds') and not (rec.get('designNote') or rec.get('provenance')):
        errors.append(f'{label}：沒有來源代號時要有 designNote 或 provenance 說明依據')


def check_registry(reg, errors: list[str]) -> set[str]:
    rows = reg.get('sources', []) if isinstance(reg, dict) else []
    ids = {r.get('id') for r in rows}
    if ids != set(C.SOURCE_BY_ID):
        errors.append(f'v12-sources.json 的來源代號應為 S1–S14，實際是 {sorted(str(i) for i in ids)}')
    for r in rows:
        canonical = C.SOURCE_BY_ID.get(r.get('id'))
        if canonical and r.get('url') != canonical.get('url'):
            errors.append(f'v12-sources.json {r.get("id")}：URL 與核准來源代號不相符')
        if 'url' in r and r['url'] not in C.APPROVED_URLS:
            errors.append(f'v12-sources.json {r.get("id")}：網址 {r["url"]!r} 不是核准的來源')
        for f in ([r['file']] if 'file' in r else []) + r.get('files', []):
            if not (isinstance(f, str) and f.startswith('data/sources/') and (C.ROOT / f).is_file()):
                errors.append(f'v12-sources.json {r.get("id")}：{f!r} 必須是存在的 data/sources/** 檔案')
    return ids


def check_points(points, n: int, label: str, errors: list[str]):
    if not isinstance(points, list) or not points:
        errors.append(f'{label}：沒有點')
        return
    for p in points:
        if not finite_point(p, n):
            errors.append(f'{label}：點 {p!r} 不是有限的 {n} 維座標')
            return
        if not C.in_bounds(p[0], p[-1]):
            errors.append(f'{label}：點 {p} 在 PLAY_BOUNDS 之外')
            return


# ---------------------------------------------------------------------------------------------------------------------
def check_sea(sea, zones, errors: list[str]):
    before = len(errors)
    bodies = {b.get('id'): b for b in sea.get('waterBodies', [])}
    if sorted(bodies) != ['pool-main', 'pool-small', 'sea-swim'] or len(sea.get('waterBodies', [])) != 3:
        errors.append(f'sea：waterBodies 應為 sea-swim、pool-main、pool-small，實際是 {sorted(str(b) for b in bodies)}')
        return
    if sea.get('wave', {}).get('algorithm') != 'daily-wave-v1':
        errors.append('sea：wave.algorithm 必須是 daily-wave-v1')
    water_ids = set(bodies)
    for bid, b in bodies.items():
        need_binding(b, f'sea 水域 {bid}', errors)
        errors.extend(C.polygon_problems(b.get('polygon'), f'sea 水域 {bid}'))
        if b.get('kind') != ('sea' if bid == 'sea-swim' else 'pool'):
            errors.append(f'sea 水域 {bid}：kind 不對')
        if not isinstance(b.get('surfaceY'), (int, float)):
            errors.append(f'sea 水域 {bid}：缺少 surfaceY')
        for key in ('entryPoints', 'exitPoints', 'safeReturnPoints'):
            check_points(b.get(key), 3, f'sea 水域 {bid}.{key}', errors)
        for i, path in enumerate(b.get('rescuePaths', [])):
            check_points(path, 3, f'sea 水域 {bid}.rescuePaths[{i}]', errors)
        if isinstance(b.get('polygon'), list) and len(b['polygon']) >= 3:
            for p in b.get('entryPoints') or []:
                if finite_point(p, 3) and (C.in_poly(xz(p), b['polygon']) or C.dist_point_poly(xz(p), b['polygon']) > 3.0):
                    errors.append(f'sea 水域 {bid}：入水點 {p} 應在水域邊界外 3 m 內的岸上')
        if b.get('kind') == 'pool' and abs(b.get('surfaceY', 0) - (b.get('deckY', 99) - 0.15)) > 1e-6:
            errors.append(f'sea 水域 {bid}：水面必須是池邊地面 - 0.15 m')
    swim = bodies['sea-swim']['polygon']
    beach = sea.get('beachReference', {}).get('polygon') or C.BEACH_POLYGON
    hazards = sea.get('hazards', [])
    for h in hazards:
        need_binding(h, f'sea 禁入區 {h.get("id")}', errors)
        errors.extend(C.polygon_problems(h.get('polygon'), f'sea 禁入區 {h.get("id")}'))
    if len(errors) > before:
        return   # 基本形狀有錯時，後面的相對位置檢查沒有意義
    if C.polys_overlap(swim, beach):
        errors.append('sea：游泳區與沙灘多邊形重疊')
    far = max(C.dist_point_poly(p, beach) for p in swim)
    if not 25.0 <= far <= 60.0:
        errors.append(f'sea：游泳區最遠離沙灘 {far:.1f} m，應在 25–60 m 之間')
    if min(C.dist_point_poly(p, beach) for p in swim) > 3.0:
        errors.append('sea：游泳區沒有貼著沙灘')
    chair = sea.get('lifeguardChair', {})
    need_binding(chair, 'sea 救生員椅', errors)
    if not finite_point(chair.get('position'), 3) or not C.in_poly(xz(chair['position']), beach):
        errors.append('sea：救生員椅必須在沙灘上')
    # buoys 是 runtime 直接讀的 P3 陣列；來源與依據記在 buoyBoundary。
    buoys = sea.get('buoys')
    need_binding(sea.get('buoyBoundary', {}), 'sea 浮球（buoyBoundary）', errors)
    check_points(buoys, 3, 'sea 浮球', errors)
    if not isinstance(buoys, list) or len(buoys) < 8:
        errors.append('sea：浮球至少 8 顆')
        buoys = []
    if sea.get('buoyBoundary', {}).get('positions') != sea.get('buoys'):
        errors.append('sea：buoyBoundary.positions 必須與 buoys 相同')
    for p in buoys:
        if finite_point(p, 3) and C.dist_point_poly(xz(p), swim) > 0.6:
            errors.append(f'sea：浮球 {p} 不在游泳區邊界上')
            break
    surf = sea.get('surfZone', {})
    need_binding(surf, 'sea 衝浪區', errors)
    errors.extend(C.polygon_problems(surf.get('polygon'), 'sea 衝浪區'))
    centre = sea.get('seaCenter', {})
    need_binding(centre, 'sea 海域中心', errors)
    if centre.get('basis') != 'schematic' or '位置示意' not in str(centre.get('designNote')):
        errors.append('sea：海域中心必須標 schematic 且 designNote 寫「位置示意」')
    check_points([centre.get('position')], 3, 'sea 海域中心', errors)
    zones_at_sea = [('游泳區', swim)] + ([('衝浪區', surf['polygon'])] if isinstance(surf.get('polygon'), list) else [])
    routes = sea.get('waterRoutes', [])
    if sorted(r.get('craft') for r in routes) != ['kayak', 'sup']:
        errors.append('sea：waterRoutes 要有 SUP 與獨木舟各一條')
    for r in routes:
        rid = r.get('id')
        need_binding(r, f'sea 航線 {rid}', errors)
        problems = C.polygon_problems(r.get('corridor'), f'sea 航線 {rid} corridor')
        errors.extend(problems)
        check_points(r.get('waypoints'), 2, f'sea 航線 {rid} 航點', errors)
        check_points([r.get('launchPoint'), r.get('returnPoint')], 3, f'sea 航線 {rid} 下水點', errors)
        if r.get('waterId') not in water_ids:
            errors.append(f'sea 航線 {rid}：waterId {r.get("waterId")!r} 不存在')
        if problems or not isinstance(r.get('waypoints'), list):
            continue
        zones_at_sea.append((f'航線 {rid} corridor', r['corridor']))
        for p in r['waypoints']:
            if not C.in_poly(p, r['corridor']):
                errors.append(f'sea 航線 {rid}：航點 {p} 不在 corridor 內')
            if any(C.in_poly(p, ex) for ex in r.get('exclusions', [])) or C.in_poly(p, swim):
                errors.append(f'sea 航線 {rid}：航點 {p} 在禁入範圍或游泳區內')
        if finite_point(r.get('launchPoint'), 3):
            if not C.in_poly(xz(r['launchPoint']), beach):
                errors.append(f'sea 航線 {rid}：下水點必須在沙灘上')
            if math.dist(xz(r['launchPoint']), r['waypoints'][0]) > 30:
                errors.append(f'sea 航線 {rid}：下水點離第一個航點超過 30 m')
    for label, poly in zones_at_sea:
        for h in hazards:
            if C.polys_overlap(poly, h['polygon']):
                errors.append(f'sea：{label} 伸進禁入區 {h.get("id")}')
    # 帆船賽
    show = sea.get('sailingShow', {})
    need_binding(show, 'sea 帆船賽', errors)
    boats = show.get('boats') or []
    teams: dict = {}
    for b in boats:
        teams[b.get('team')] = teams.get(b.get('team'), 0) + 1
    if len(boats) != 8 or teams != {'nsysu': 4, 'osaka': 4}:
        errors.append(f'sea：帆船必須 8 艘、兩隊各 4 艘，實際是 {teams}')
    if len({b.get('id') for b in boats}) != len(boats):
        errors.append('sea：帆船 id 重複')
    if show.get('waterId') not in water_ids:
        errors.append(f'sea：帆船賽的 waterId {show.get("waterId")!r} 不存在')
    if '情境重現' not in str(show.get('title')) and '情境重現' not in str(show.get('label')):
        errors.append('sea：帆船賽必須標「情境重現」')
    if show.get('viewingAnchorId') not in zones.get('zones', {}):
        errors.append(f'sea：帆船賽觀賞點 {show.get("viewingAnchorId")!r} 不是 story-zones.json 的 zone')
    need_binding(sea.get('sailingViewPoint', {}), 'sea 帆船觀賞點', errors)
    for b in boats:
        check_points(b.get('path'), 3, f'sea 帆船 {b.get("id")} 航線', errors)
        if not (isinstance(b.get('startProgress'), (int, float)) and 0 <= b['startProgress'] < 1):
            errors.append(f'sea 帆船 {b.get("id")}：startProgress 必須在 [0, 1)')
        for p in b.get('path') or []:
            if not finite_point(p, 3):
                break
            q = xz(p)
            if C.in_poly(q, swim) or C.dist_point_poly(q, swim) < 15.0 or any(C.in_poly(q, h['polygon']) for h in hazards):
                errors.append(f'sea 帆船 {b.get("id")}：{q} 不在游泳區外側（至少 15 m）或落在禁入區')
                break


# ---------------------------------------------------------------------------------------------------------------------
def graph_revision(g) -> str:
    body = json.dumps([g['nodes'], g['edges'], g['edgeKind']], ensure_ascii=False, separators=(',', ':'))
    return 'outdoor-graph-v12.1:' + hashlib.sha256(body.encode('utf-8')).hexdigest()[:16]


def check_bus(bus, graph, errors: list[str], warnings: list[str]):
    nodes = graph['nodes']
    kinds = {}
    for (a, b, _), k in zip(graph['edges'], graph['edgeKind']):
        kinds.setdefault(f'{min(a, b)}-{max(a, b)}', k)
    forbidden = {(e['to'], e['from']) for e in graph.get('hamasen', {}).get('edges', []) if e.get('oneway')}
    # graph 連通（含新增的支線）
    adj = [[] for _ in nodes]
    for a, b, _ in graph['edges']:
        adj[a].append(b)
        adj[b].append(a)
    seen, stack = {0}, [0]
    while stack:
        for v in adj[stack.pop()]:
            if v not in seen:
                seen.add(v)
                stack.append(v)
    if len(seen) != len(nodes):
        errors.append(f'graph：有 {len(nodes) - len(seen)} 個節點與主網路不連通')
    meta = graph.get('v12') or {}
    revision = graph_revision(graph)
    if meta.get('revision') != revision:
        errors.append(f'graph：v12.revision 是 {meta.get("revision")!r}，依內容算出 {revision}；請重跑 apply_v12_bus.py')
    if bus.get('graphRevision') != revision:
        errors.append(f'bus：graphRevision {bus.get("graphRevision")!r} 與 graph（{revision}）不符')
    stops = {s.get('id'): s for s in bus.get('stops', [])}
    if len(stops) != len(bus.get('stops', [])):
        errors.append('bus：站 id 重複')
    for sid, s in stops.items():
        need_binding(s, f'bus 站 {sid}', errors)
        berth = s.get('berth') or {}
        check_points([s.get('sign'), berth.get('position'), s.get('boardingPoint')] + (s.get('alightingPoints') or [None]), 3, f'bus 站 {sid}', errors)
        if not isinstance(berth.get('yaw'), (int, float)):
            errors.append(f'bus 站 {sid}：berth.yaw 缺少')
        anchor = str(s.get('pedestrianAnchorId'))
        if not (anchor.startswith('node:') and anchor[5:].isdigit() and int(anchor[5:]) < len(nodes)):
            errors.append(f'bus 站 {sid}：pedestrianAnchorId {anchor!r} 必須是 node:<graph 節點號>')
        if not s.get('name') or not isinstance(s.get('aliases'), list):
            errors.append(f'bus 站 {sid}：缺少 name 或 aliases')
    routes = {r.get('id'): r for r in bus.get('routes', [])}
    if sorted(routes) != sorted(EXPECTED_STOPS):
        errors.append(f'bus：路線必須是 {sorted(EXPECTED_STOPS)}，實際是 {sorted(str(r) for r in routes)}')
        return
    for rid, r in routes.items():
        need_binding(r, f'bus 線 {rid}', errors)
        occ = r.get('stopOccurrences') or []
        groups = [stops.get(o.get('stopId'), {}).get('group') for o in occ]
        if groups != EXPECTED_STOPS[rid]:
            errors.append(f'bus 線 {rid}：站序 {groups} 與 spec 的 {EXPECTED_STOPS[rid]} 不同')
        if len({o.get('occurrenceId') for o in occ}) != len(occ):
            errors.append(f'bus 線 {rid}：occurrenceId 重複')
        if r.get('graphRevision') != revision:
            errors.append(f'bus 線 {rid}：graphRevision 與 graph 不符')
        sched, vehicle = r.get('schedule') or {}, r.get('vehicle') or {}
        if sched.get('kind') != 'schematic' or sched.get('gameSecondsPerRealSecond') != 5 or sched.get('minDwellRealSeconds') != 6:
            errors.append(f'bus 線 {rid}：schedule 必須是 schematic、5 倍、每站至少 6 秒')
        if not (isinstance(vehicle.get('minTurnRadiusM'), (int, float)) and vehicle['minTurnRadiusM'] >= MIN_TURN):
            errors.append(f'bus 線 {rid}：vehicle.minTurnRadiusM 必須 ≥ {MIN_TURN}')
        # 最後一段從哈瑪星接回校門。場景外的路段有獨立的進站與出站預覽。
        legs = r.get('legs') or []
        transfers = [l for l in legs if l.get('terminalTransfer')]
        if len(legs) - len(transfers) != len(occ) - 1 or len(transfers) > 1 or (transfers and legs[-1] is not transfers[0]):
            errors.append(f'bus 線 {rid}：{len(occ)} 個停靠應有 {len(occ) - 1} 段（另可在最後加一段終點接續段），實際 {len(legs)} 段')
            continue
        ring = occ + occ[:1]
        previous_end, previous_edge = None, None
        for k, leg in enumerate(legs):
            label = f'bus 線 {rid} 第 {k} 段'
            if leg.get('fromOccurrenceId') != ring[k].get('occurrenceId') or leg.get('toOccurrenceId') != ring[k + 1].get('occurrenceId'):
                errors.append(f'{label}：起訖停靠與 stopOccurrences 不符')
            path = leg.get('path') or []
            departure = leg.get('departurePath', path)
            split = 'departurePath' in leg
            expect_split = k >= len(occ) - 2
            if split != expect_split:
                errors.append(f'{label}：只有校門與哈瑪星之間的路段須分開進出站預覽')
            samples = [(departure, 'departure')] if split else []
            samples.append((path, 'arrival'))
            for sample, _ in samples:
                check_points(sample, 3, label, errors)
            if any(not isinstance(sample, list) or len(sample) < 2 or not all(finite_point(p, 3) for p in sample) for sample, _ in samples):
                errors.append(f'{label}：路徑至少 2 個點')
                continue
            for end, o in ((departure[0], ring[k]), (path[-1], ring[k + 1])):
                berth = (stops.get(o.get('stopId'), {}).get('berth') or {}).get('position')
                if not finite_point(berth, 3) or math.dist(xz(end), xz(berth)) > 0.5:
                    errors.append(f'{label}：端點 {end} 不在 {o.get("stopId")} 的 berth 上')
            if previous_end is not None and math.dist(xz(previous_end), xz(departure[0])) > 0.05:
                errors.append(f'{label}：起點與上一段的終點不連續')
            previous_end = path[-1]
            if not (isinstance(leg.get('cruiseMpsGame'), (int, float)) and leg['cruiseMpsGame'] > 0):
                errors.append(f'{label}：cruiseMpsGame 必須大於 0')
            if split:
                alignment = leg.get('osmAlignment') or {}
                whole = alignment.get('path') or []
                if (len(whole) < 2 or not all(finite_point(p, 2) for p in whole) or not alignment.get('osmWayIds')
                        or math.dist(whole[0], xz(departure[0])) > .15 or math.dist(whole[-1], xz(path[-1])) > .15
                        or not any(not C.in_bounds(*p) for p in whole)):
                    errors.append(f'{label}：缺少連接兩站且經場景外道路的 OSM 路徑')
            for sample, direction in samples:
                edge_key, node_key = ('departureSourceEdgeIds', 'departureNodeIds') if direction == 'departure' else ('sourceEdgeIds', 'nodeIds')
                edges = leg.get(edge_key) or []
                if split and direction == 'arrival':
                    previous_edge = None
                if not edges:
                    errors.append(f'{label}：沒有 {edge_key}')
                for e in edges:
                    if kinds.get(e) not in DRIVABLE:
                        errors.append(f'{label}：邊 {e!r} 不是 graph 上的可行車邊')
                        break
                    if previous_edge is not None and not set(previous_edge.split('-')) & set(e.split('-')):
                        errors.append(f'{label}：邊 {previous_edge} 與 {e} 不相連，路徑斷開')
                        break
                    previous_edge = e
                if split:
                    trace = leg.get(node_key) or []
                    if len(trace) != len(edges) + 1 or any(e != f'{min(a,b)}-{max(a,b)}' or (a,b) in forbidden
                                                         for (a,b), e in zip(zip(trace, trace[1:]), edges)):
                        errors.append(f'{label}：進出站預覽的節點與道路方向不符')
                gap = max(math.dist(xz(a), xz(b)) for a, b in zip(sample, sample[1:]))
                if gap > 25:
                    errors.append(f'{label}：路徑有 {gap:.1f} m 的跳躍')
        for key in ('spawn', 'despawn'):
            check_points((r.get(key) or {}).get('path'), 3, f'bus 線 {rid} {key}', errors)
        opened = [i for i in r.get('issues', []) if i.get('status') == 'open']
        for i in opened:
            detail = f'轉 {i.get("deflectionDeg")}°、估計半徑 {i.get("radiusEstM")} m' if i.get('kind') == 'sharp-turn' else f'{i.get("maxDeg")}°（{i.get("profile")}，s {i.get("fromS")}–{i.get("toS")}）'
            warnings.append(f'bus 線 {rid}：未處理的{"急彎" if i.get("kind") == "sharp-turn" else "俯仰"} {i.get("at")} {detail}')
        pitch = r.get('pitch')
        if pitch:
            warnings.append(f'bus 線 {rid}：原始剖面最大俯仰 {pitch.get("maxRawDeg")}°，60 m 平滑後 {pitch.get("maxSmoothedDeg")}°（上限 {pitch.get("limitDeg")}°）')
        else:
            warnings.append(f'bus 線 {rid}：沒有俯仰剖面（產生資料時沒有讀到地形）')
    patches = {p.get('id'): p for p in bus.get('roadPatches', [])}
    for pid in ('la-forecourt', 'hairpin-1626'):
        p = patches.get(pid)
        if not p:
            errors.append(f'bus：roadPatches 缺少 {pid}')
            continue
        check_points(p.get('centerline'), 3, f'bus 路面補丁 {pid}', errors)
        line = [xz(q) for q in p.get('centerline') or [] if finite_point(q, 3)]
        if len(line) < 3:
            continue
        radius = C.min_turn_radius(line)
        if radius < MIN_TURN - 0.3 or not (isinstance(p.get('turnRadiusM'), (int, float)) and p['turnRadiusM'] >= MIN_TURN):
            errors.append(f'bus 路面補丁 {pid}：轉彎半徑 {radius:.1f} m（標示 {p.get("turnRadiusM")}），必須 ≥ {MIN_TURN} m')
    fc = bus.get('forecourt') or {}
    if not (isinstance(fc.get('turnRadiusM'), (int, float)) and fc['turnRadiusM'] >= MIN_TURN):
        errors.append(f'bus：文學院迴轉圈半徑必須 ≥ {MIN_TURN} m')
    errors.extend(C.polygon_problems(fc.get('polygon'), 'bus 文學院廣場'))
    if fc.get('junctionNode') != (meta.get('laForecourt') or {}).get('junctionNode'):
        errors.append('bus：forecourt.junctionNode 與 graph 的 v12.laForecourt 不同')


# ---------------------------------------------------------------------------------------------------------------------
def check_sports(sports, fitness, sea, gym_boxes, errors: list[str], warnings: list[str]):
    prov = sports.get('provenance') or {}
    if '內政部國土測繪中心' not in str(prov.get('imagery')) or '不隨資料包發布' not in str(prov.get('imagery')) or 'OpenStreetMap' not in str(prov.get('osm')):
        errors.append('sports：provenance 要寫明國土測繪中心正射影像（不隨資料包發布）與 OSM')
    venues = {v.get('id'): v for v in sports.get('facilities', [])}
    for vid, courts in REQUIRED_VENUES.items():
        v = venues.get(vid)
        if not v:
            errors.append(f'sports：缺少場地 {vid}')
        elif courts and len(v.get('courts') or []) != courts:
            errors.append(f'sports：場地 {vid} 應有 {courts} 面球場，實際 {len(v.get("courts") or [])}')
    for vid, v in venues.items():
        need_binding(v, f'sports 場地 {vid}', errors)
        errors.extend(C.polygon_problems(v.get('polygon'), f'sports 場地 {vid}'))
        for i, court in enumerate(v.get('courts') or []):
            errors.extend(C.polygon_problems(court, f'sports 場地 {vid} 球場 {i}'))
    courses = {c.get('id'): c for c in sports.get('courses', [])}
    if len(courses) != 2 or sorted(c.get('mode') for c in courses.values()) != ['run', 'swim']:
        errors.append('sports：timedCourses 要有跑步與游泳各一條')
    water_ids = {b.get('id') for b in sea.get('waterBodies', [])}
    for cid, c in courses.items():
        need_binding(c, f'sports 計時 {cid}', errors)
        gates = {g.get('id'): g for g in c.get('gates') or []}
        seq = c.get('requiredGateSequence') or []
        if any(g not in gates for g in seq) or len(seq) < 3:
            errors.append(f'sports 計時 {cid}：requiredGateSequence 有不存在的 gate 或太短')
        ring_out, ring_in = c.get('corridorOuter'), c.get('corridorInner')
        check_points(c.get('corridor'), 2, f'sports 計時 {cid} corridor', errors)
        if ring_out is not None:
            errors.extend(C.polygon_problems(ring_out, f'sports 計時 {cid} corridorOuter') + C.polygon_problems(ring_in, f'sports 計時 {cid} corridorInner'))
        else:
            errors.extend(C.polygon_problems(c.get('corridor'), f'sports 計時 {cid} corridor'))
        for gid, g in gates.items():
            check_points([g.get('a'), g.get('b')], 3, f'sports 計時 {cid} gate {gid}', errors)
            d = g.get('direction')
            if not (finite_point(d, 2) and abs(math.hypot(*d) - 1) < 1e-3):
                errors.append(f'sports 計時 {cid} gate {gid}：direction 必須是單位向量')
            if finite_point(g.get('a'), 3) and finite_point(g.get('b'), 3) and isinstance(c.get('corridor'), list) and len(c['corridor']) >= 3:
                if math.dist(xz(g['a']), xz(g['b'])) < 1.0:
                    errors.append(f'sports 計時 {cid} gate {gid}：gate 線太短')
                mid = [(g['a'][0] + g['b'][0]) / 2, (g['a'][2] + g['b'][2]) / 2]
                if not C.in_poly(mid, c['corridor']):
                    errors.append(f'sports 計時 {cid} gate {gid}：gate 中點不在 corridor 內')
        if c.get('mode') == 'run':
            if len(gates) != 4 or len(seq) != 5 or seq[0] != seq[-1] or len(set(seq)) != 4:
                errors.append(f'sports 計時 {cid}：跑圈要 4 個 gate，依序通過後回到起點 gate')
            if not (isinstance(c.get('lapLengthM'), (int, float)) and abs(c['lapLengthM'] - 399) <= 3):
                errors.append(f'sports 計時 {cid}：一圈應約 399 m，實際 {c.get("lapLengthM")}')
            line = c.get('centerline') or []
            if len(line) >= 3 and all(finite_point(p, 2) for p in line) and abs(C.path_length(line + line[:1]) - c.get('lapLengthM', 0)) > 0.5:
                errors.append(f'sports 計時 {cid}：centerline 長度與 lapLengthM 不符')
        if c.get('mode') == 'swim' and (c.get('waterId') != 'pool-main' or c.get('waterId') not in water_ids):
            errors.append(f'sports 計時 {cid}：waterId 必須是 sea.json 的 pool-main')
    portal = next(iter(sports.get('portals', [])), {})
    need_binding(portal, 'sports 體適能入口', errors)
    outside = [portal.get('exteriorTrigger')] + (portal.get('exteriorReturnPoints') or [None])
    check_points(outside, 3, 'sports 體適能入口', errors)
    if gym_boxes is None:
        warnings.append('sports：讀不到體育館碰撞盒，沒有檢查體適能入口是否在實心盒內')
    else:
        for p in outside:
            if finite_point(p, 3) and C.in_solid(p[0], p[2], gym_boxes, 0.5):
                errors.append(f'sports：體適能入口的點 {p} 在體育館實心碰撞盒內（含 0.5 m 邊距）')
        t = portal.get('exteriorTrigger')
        if finite_point(t, 3) and not C.in_solid(t[0], t[2], gym_boxes, 2.5):
            errors.append('sports：體適能入口觸發點離體育館外牆超過 2.5 m')
    if portal.get('interiorSceneId') != fitness.get('id'):
        errors.append('sports：fitnessPortal.interiorSceneId 與 interiors/fitness.json 的 id 不同')
    need_binding(fitness, 'fitness 室內', errors)
    room, origin = (fitness.get('room') or {}).get('polygon'), fitness.get('origin')
    room_problems = C.polygon_problems(room, 'fitness 房間', bounds=(-1e4, -1e4, 1e4, 1e4))
    errors.extend(room_problems)
    if not finite_point(origin, 3) or not C.in_bounds(origin[0], origin[2]):
        errors.append('fitness：origin 必須是 PLAY_BOUNDS 內的世界座標')
        return
    inside = lambda p: finite_point(p, 3) and not room_problems and C.in_poly([p[0] - origin[0], p[2] - origin[2]], room) and abs(p[1] - origin[1]) < 0.01
    if not inside(portal.get('interiorSpawn')):
        errors.append('sports：fitnessPortal.interiorSpawn 不在室內場景的房間裡')
    equipment = sports.get('equipment') or []
    kinds = [e.get('kind') for e in equipment]
    if set(kinds) != {'treadmill', 'stationary-bike'}:
        errors.append(f'sports：器材要有跑步機與健身車，實際是 {sorted(set(str(k) for k in kinds))}')
    if len({e.get('id') for e in equipment}) != len(equipment) or len(equipment) != len(fitness.get('equipment') or []):
        errors.append('sports：器材 id 重複，或數量與 fitness.json 不同')
    for e in equipment:
        if not isinstance(e.get('yaw'), (int, float)) or not all(inside(p) for p in [e.get('position'), e.get('approach')] + (e.get('exitPoints') or [None])):
            errors.append(f'sports：器材 {e.get("id")} 的位置、approach、exitPoints 必須在室內房間裡，且要有 yaw')
    if not any('示意' in str(c.get('name')) and c.get('id') == 'fitness-2' for c in sports.get('fitnessCenters', [])):
        errors.append('sports：第二體適能中心必須標「示意」')


# ---------------------------------------------------------------------------------------------------------------------
def check_story(npcs, zones, sea, bus, errors: list[str]):
    people = {n.get('id'): n for n in npcs.get('npcs', [])}
    residents = [pid for pid, person in people.items() if person.get('district') == 'hamasen']
    lines: list[tuple[str, str, list | None]] = []
    for pid in [*REQUIRED_NPCS, *residents]:
        if pid not in people:
            errors.append(f'npcs：缺少 NPC {pid}')
            continue
        tree = npcs.get('trees', {}).get(people[pid].get('talk'))
        if not tree:
            errors.append(f'npcs：{pid} 沒有對話樹')
            continue
        for nid, node in tree.get('nodes', {}).items():
            lines += [(f'npcs {pid}/{nid}', l.get('text'), None) for l in node.get('lines', [])]
            if pid in residents:
                lines += [(f'npcs {pid}/{nid} 選項', c.get('text'), None) for c in node.get('choices', [])]
        for t, spot in (people[pid].get('schedule') or {}).items():
            if spot and isinstance(spot.get('at'), str) and spot['at'] not in zones.get('zones', {}):
                errors.append(f'npcs：{pid} 的 {t} 站位 {spot["at"]} 不是 zone')
    events = {e.get('id'): e for e in npcs.get('events', [])}
    for eid in REQUIRED_EVENTS:
        e = events.get(eid)
        if not e:
            errors.append(f'npcs：缺少事件 {eid}')
            continue
        activity = e.get('activity') or {}
        lines += [(f'npcs {eid}', l.get('text'), None) for l in e.get('lines', [])]
        lines += [(f'npcs {eid} onDone', r.get('text'), None) for r in activity.get('onDone', []) if r.get('kind') == 'say']
        if not e.get('sourceIds'):
            errors.append(f'npcs：事件 {eid} 沒有 sourceIds')
        if str(e.get('anchor', ''))[5:] not in zones.get('zones', {}):
            errors.append(f'npcs：事件 {eid} 的 anchor {e.get("anchor")!r} 不是 zone')
    surf = (events.get('ev-surf-class') or {}).get('activity') or {}
    rhythm = [s for s in surf.get('steps', []) if s.get('kind') == 'rhythm']
    if not rhythm or any(s.get('presentation') != 'surf' for s in rhythm):
        errors.append('npcs：ev-surf-class 要有 rhythm 步驟，且每個都帶 presentation:\'surf\'')
    regatta = events.get('ev-sail-regatta') or {}
    if regatta and regatta.get('show') != (sea.get('sailingShow') or {}).get('id'):
        errors.append('npcs：ev-sail-regatta.show 必須指到 sea.json 的 sailingShow.id')
    if regatta and '情境重現' not in str(regatta.get('banner')) + str(regatta.get('title')):
        errors.append('npcs：ev-sail-regatta 必須標「情境重現」')
    for key, v in (sea.get('lines') or {}).items():
        if isinstance(v, dict):
            lines.append((f'sea.lines.{key}', v.get('text'), None))
    for key, text in (sea.get('signboard') or {}).items():
        if key in ('open', 'surfOnly', 'closed', 'night', 'weatherNote'):
            lines.append((f'sea.signboard.{key}', text, [text.replace('{h}', h) for h in ('0.4', '1.5', '2.3')] if isinstance(text, str) else None))
    names = sorted({s.get('name') for s in bus.get('stops', []) if s.get('name')})
    for r in bus.get('routes', []):
        a = r.get('announcements') or {}
        if a.get('speaker') not in people:
            errors.append(f'bus 線 {r.get("id")}：司機 {a.get("speaker")!r} 不在 npcs.json')
        template = a.get('arrive')
        lines.append((f'bus {r.get("id")} arrive', template, [template.replace('{station}', n) for n in names] if isinstance(template, str) else None))
        lines += [(f'bus {r.get("id")} {k}', a.get(k), None) for k in ('board', 'lastBus')]
        lines += [(f'bus {r.get("id")} arriveAt.{k}', v, None) for k, v in (a.get('arriveAt') or {}).items()]
    lines.append(('bus notice', bus.get('notice'), None))
    for label, text, expansions in lines:
        errors.extend(f'{label}：{m}' for m in C.lint_line(text, expansions))


@lru_cache(maxsize=256)
def water_probe(points, polygon):
    """One metre boundary/path samples, two metre polygon interior grid."""
    terrain = C.standing_context()[0]
    probes = [(x,z) for x,z,_ in C.resample(list(points)+([points[0]] if polygon else []),1)]
    if polygon:
        x0,z0,x1,z1=C.bbox(points)
        for x in range(math.ceil(x0), math.ceil(x1),2):
            for z in range(math.ceil(z0), math.ceil(z1),2):
                if C.in_poly((x,z),points): probes.append((x,z))
    return max(((terrain.height_at(x,z),x,z) for x,z in probes),default=(-math.inf,0,0))


def check_spatial(d, errors, warnings):
    sea,bus,sports,fitness=d['sea'],d['bus'],d['sports'],d['fitness']
    terrain=C.standing_context()[0]
    def stand(p,label):
        if finite_point(p,3):
            problem=C.standing_problem(p)
            if problem: errors.append(f'{label}：不可站立：{problem}，{p}')
    def shore(p,poly,label):
        if not finite_point(p,3) or C.polygon_problems(poly,label): return
        gap=C.dist_point_poly(xz(p),poly)
        if C.in_poly(xz(p),poly) or not 0.4-1e-6<=gap<=2.5+1e-6:
            errors.append(f'{label}：須在水域多邊形外 0.4–2.5 m，實際 {gap:.3f} m')
        stand(p,label)
    wet=[]
    for w in sea.get('waterBodies',[]):
        poly=w.get('polygon')
        for key in ('entryPoints','exitPoints','safeReturnPoints'):
            for p in w.get(key,[]): shore(p,poly,f'{w["id"]}.{key}')
        if w.get('kind')=='sea':
            if w.get('surfaceY') != -0.6: errors.append('sea：海平面必須是 -0.6')
            wet.append((w['id'],poly,True))
    for r in sea.get('waterRoutes',[]):
        for key in ('launchPoint','returnPoint'): shore(r.get(key),r.get('corridor'),f'{r["id"]}.{key}')
        wet.extend([(r['id']+' corridor',r.get('corridor'),True),(r['id']+' path',r.get('waypoints'),False)])
    wet.append(('surf',sea.get('surfZone',{}).get('polygon'),True))
    for b in sea.get('sailingShow',{}).get('boats',[]):
        pts=[xz(p) for p in b.get('path',[]) if finite_point(p,3)]
        wet.append((b['id'],pts+pts[:1],False))
        for route in sea.get('waterRoutes',[]):
            if pts and C.path_polygon_gap(pts+pts[:1],route['corridor'])<10:
                errors.append(f"{b['id']}：離 {route['id']} corridor 不足 10 m")
    wall=C.read_json(C.ROOT/'public/models/landmarks/placements.json')['seawall']['path']
    for label,pts,polygon in wet:
        if not pts or not all(finite_point(p,2) for p in pts): continue
        if polygon and C.polygon_problems(pts,label): continue
        h,x,z=water_probe(tuple(tuple(p) for p in pts),polygon)
        if h>=-0.6: errors.append(f'{label}：水面探測失敗，({x:.2f},{z:.2f}) 地形 {h:.3f} >= -0.6')
        for x,z,_ in C.resample(pts+pts[:1],1):
            if any(C.in_poly((x,z),h['polygon']) for h in sea.get('hazards',[])):
                errors.append(f'{label}：路段碰到防波堤禁入區');break
            if min(C.dist_point_seg((x,z),a,b) for a,b in zip(wall,wall[1:]))<8:
                errors.append(f'{label}：路段碰到海堤／消波塊 8 m 保留帶');break
    paths=[p for r in bus.get('routes',[]) for l in r.get('legs',[]) for p in (l.get('path',[]),l.get('departurePath',[])) if len(p)>=2]
    clearance=max((r['vehicle']['widthM']/2+1 for r in bus['routes']),default=2.25)
    for s in bus.get('stops',[]):
        p=s.get('boardingPoint')
        if finite_point(p,3) and paths and C.distance_to_paths(xz(p),paths)<clearance-0.01:
            errors.append(f'bus {s["id"]} boardingPoint：離路徑中心線不足 {clearance} m')
        for p in [s.get('boardingPoint'),*s.get('alightingPoints',[])]: stand(p,f'bus {s["id"]}')
    for n in d['npcs'].get('npcs',[]):
        if not n.get('id','').startswith('bus-driver-'):continue
        # Absent drivers have no world position. If integrated as outdoor NPCs,
        # every active schedule spot must satisfy the same clearance as boarding.
        active=[v for v in n.get('schedule',{}).values() if v]
        if not active: warnings.append(f'{n["id"]}：schedule 全 null，未生成世界司機；車內掛點需 runtime 驗收')
        for v in active:
            at=v['at']; q=d['zones']['zones'].get(at,{}).get('p') if isinstance(at,str) else at
            if not finite_point(q,2):errors.append(f'{n["id"]}：司機位置不存在');continue
            off=v.get('offset',[0,0]);p=[q[0]+off[0],q[1]+off[1]]
            if paths and C.distance_to_paths(p,paths)<clearance-0.01:errors.append(f'{n["id"]}：司機離路徑中心線不足 {clearance} m')
            stand([p[0],terrain.height_at(*p),p[1]],n['id'])
    fc=bus.get('forecourt',{});center=fc.get('center')
    if not finite_point(center,2) or math.dist(center,[-564.5,-889.5])>65:
        errors.append('文學院廣場：離新中心超過 65 m（建物外側含迴轉圈）')
    patch=next((p for p in bus.get('roadPatches',[]) if p['id']=='la-forecourt'),{})
    line=patch.get('centerline',[])
    if line:
        heights=[terrain.height_at(p[0],p[2]) for p in line]
        spread=max(heights)-min(heights)
        if spread>2:errors.append(f'文學院廣場：支線地表高差 {spread:.2f} m 超過 2 m')
        if abs(spread-fc.get('terrainSpreadM',-999))>0.15:errors.append('文學院廣場：地表高差記錄不符')
        if not fc.get('runtimeSurface'): warnings.append(f'文學院廣場：支線地表高差 {spread:.2f} m，建議鋪面尚未建入碰撞世界')
    polygon=fc.get('polygon')
    if polygon and not C.polygon_problems(polygon,'文學院廣場'):
        x0,z0,x1,z1=C.bbox(polygon)
        heights=[terrain.height_at(x,z) for x,z in polygon]
        heights += [terrain.height_at(x,z) for x in range(math.ceil(x0),math.ceil(x1))
                    for z in range(math.ceil(z0),math.ceil(z1)) if C.in_poly((x,z),polygon)]
        cutfill=max(abs(h-fc['levelY']) for h in heights)
        if cutfill>1.5:errors.append(f'文學院廣場：鋪面整平切填高度 {cutfill:.2f} m 超過 1.5 m')
        warnings.append(f'文學院廣場：全鋪面地表 {min(heights):.2f}..{max(heights):.2f} m，最大切填 {cutfill:.2f} m')
    for v in sports.get('facilities',[]):
        if not isinstance(v.get('id'),str) or not v['id'] or not isinstance(v.get('kind'),str) or not v['kind']:
            errors.append('sports：場地必須有 kind、id')
        for k in ('center','size'):
            if k in v and not finite_point(v[k],2):errors.append(f'sports {v.get("id")}：無效 {k}')
    scenes={s['id']:s for s in fitness.get('scenes',[])}
    for p in sports.get('portals',[]):
        for q in [p.get('exteriorTrigger'),*p.get('exteriorReturnPoints',[])]:stand(q,'FitnessPortal')
        scene=scenes.get(p.get('interiorSceneId'))
        if not scene:errors.append('fitness：loader scenes 缺少 interiorSceneId');continue
        errors.extend(C.polygon_problems(scene.get('polygon'),'fitness scene'))
        for q in [p.get('interiorSpawn'),scene.get('exitPoint')]:
            if not finite_point(q,3) or not C.in_poly(xz(q),scene['polygon']) or abs(q[1]-scene['floorY'])>0.01:
                errors.append('FitnessPortal：室內落點不在場景支撐面')
    for e in sports.get('equipment',[]):
        scene=scenes.get(e.get('sceneId'))
        if not scene:errors.append(f'{e.get("id")}：sceneId 不存在');continue
        for q in [e.get('approach'),*e.get('exitPoints',[])]:
            if not finite_point(q,3):continue
            if not C.in_poly(xz(q),scene['polygon']) or C.dist_point_poly(xz(q),scene['polygon'])<0.32 or abs(q[1]-scene['floorY'])>0.01:
                errors.append(f'{e["id"]}：exitPoints／approach 不在室內可站立地面')
            for other in sports.get('equipment',[]):
                # Conservative model bounding footprints (authored props).
                hx,hz=(0.55,1.05) if other['kind']=='treadmill' else (0.86,0.85)
                # Runtime currently displays fitness_station for a bike:
                # its bench extends to local +Z=1.65 (create_props_v12.py).
                offset=0 if other['kind']=='treadmill' else 0.8
                yaw=other['yaw']; bx=other['position'][0]+math.sin(yaw)*offset; bz=other['position'][2]+math.cos(yaw)*offset
                box=(bx,bz,hx,hz,yaw)
                if C.in_solid(q[0],q[2],[box],0.32):errors.append(f'{e["id"]}：退出點在器材實心盒內 {other["id"]}')


def verify(d: dict) -> tuple[list[str], list[str]]:
    errors: list[str] = []
    warnings: list[str] = []
    registry_ids = check_registry(d['registry'], errors)
    for key in ('sea', 'bus', 'sports', 'fitness'):
        check_sources(d[key], key, errors, registry_ids)
    for e in d['npcs'].get('events', []):
        if e.get('id') in REQUIRED_EVENTS:
            check_sources(e, f'npcs 事件 {e["id"]}', errors, registry_ids)
    for n in d['npcs'].get('npcs', []):
        if n.get('id') in REQUIRED_NPCS:
            check_sources(n, f'npc {n["id"]}', errors, registry_ids)
            if not n.get('sourceIds'):errors.append(f'npc {n["id"]}：缺少 sourceIds')
    npc_ids={n['id'] for n in d['npcs']['npcs']}
    zones=d['zones']['zones']
    def target(value):
        if not isinstance(value,str) or ':' not in value:return False
        kind,key=value.split(':',1)
        return key in (npc_ids if kind=='npc' else zones if kind=='zone' else {})
    for e in d['npcs']['events']:
        if e.get('id') not in REQUIRED_EVENTS:continue
        a=e.get('activity',{})
        for who in [*e.get('npcs',[]),a.get('host')]:
            if who not in npc_ids:errors.append(f'{e["id"]}：引用 NPC {who} 不存在')
        for s in a.get('steps',[]):
            if 'target' in s and not target(s['target']):errors.append(f'{e["id"]}：步驟 target 不存在')
        for line in e.get('lines',[])+a.get('onDone',[]):
            if 'who' in line and line['who'] not in npc_ids:errors.append(f'{e["id"]}：說話 NPC 不存在')
    blocks={b['id'] for b in d['bus'].get('singleLaneBlocks',[])}
    for r in d['bus']['routes']:
        for l in r['legs']:
            if any(i not in blocks for i in l.get('narrowSectionIds',[])):errors.append('bus：narrowSectionIds 引用不存在')
    check_sea(d['sea'], d['zones'], errors)
    check_bus(d['bus'], d['graph'], errors, warnings)
    check_sports(d['sports'], d['fitness'], d['sea'], d.get('gymBoxes'), errors, warnings)
    check_story(d['npcs'], d['zones'], d['sea'], d['bus'], errors)
    check_spatial(d, errors, warnings)
    return errors, warnings


def main():
    try:
        d = load()
    except (FileNotFoundError, json.JSONDecodeError) as e:
        print(f'ERROR: {e}', file=sys.stderr)
        sys.exit(1)
    errors, warnings = verify(d)
    for w in warnings:
        print(f'WARN: {w}')
    if errors:
        for e in errors:
            print(f'ERROR: {e}', file=sys.stderr)
        print(f'\nv12 世界資料：{len(errors)} 個錯誤、{len(warnings)} 則警告', file=sys.stderr)
        sys.exit(1)
    sea, bus, sports = d['sea'], d['bus'], d['sports']
    print(f'v12 世界資料 OK：水域 {len(sea["waterBodies"])}、航線 {len(sea["waterRoutes"])}、帆船 {len(sea["sailingShow"]["boats"])}；'
          f'站 {len(bus["stops"])}、路線 {len(bus["routes"])}；場地 {len(sports["facilities"])}、計時 {len(sports["courses"])}、器材 {len(sports["equipment"])}；警告 {len(warnings)} 則')


if __name__ == '__main__':
    main()
