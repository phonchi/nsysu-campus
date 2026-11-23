#!/usr/bin/env python3
"""v12.1 WP-D2：公車資料 → public/data/bus-routes.json，並在 outdoor-graph.json 新增文學院支線與迴轉圈。

    python3 -B tools/apply_v12_bus.py            # 寫檔（冪等：先移除上次加進 graph 的節點再重加）
    python3 -B tools/apply_v12_bus.py --dry-run  # 只印摘要
    python3 -B tools/apply_v12_bus.py --check    # 與現有檔案比對
    選項：--analysis PATH（路網分析 routes.json）、--no-analysis（不用分析，直接在 graph 上算最短路）、
          --la-junction N（支線接點節點，預設 1008）、--la-side left|right（廣場在去程行進方向的哪一側，預設 left）

做法（docs/spec-v12.md 第 5 節「公車」「文學院」；型別見 round2-astra.md §4「公車」）：
  1. 節點序列取自 artifacts/v12/research/bus/routes.json 的 node_ids（分析產物只當輸入，逐邊對 graph 驗證）；
     找不到分析檔時，在可行車邊上用「禁止中途迴轉」的最短路自行計算。
  2. 文學院：從接點節點切出半徑 9.5 m 的圓角接上支線，再接半徑 10 m 的迴轉圈（反擺 60°、主轉 300°、反擺 60°）。
     這些點以 service 邊加進 outdoor-graph.json，graph 另記 v12.revision；bus-routes.json 的 graphRevision 與它相同。
  3. 急彎 1626：路徑在折點外側加一個半徑 9.5 m 的鑰匙孔（roadPatches），不改 graph。
  4. 路徑的 Y = graph 節點高度 + GROUND_Y（graph 是 bilinear 取樣）。最終高度由 runtime 以三角形地表加 60 m 平滑決定；
     本工具只把俯仰與急彎問題列在 routes[].issues，verify_v12_world.py 會再列一次。
邊的 id 是「小節點號-大節點號」，與行進方向無關。
"""
from __future__ import annotations

import hashlib
import heapq
import json
import math

import v12_world_common as C
from v12_world_common import P2, P3
from shapely.geometry import LineString, Point
from shapely.ops import substring
from apply_hamasen import SNAPSHOT, add_graph, district
from hamasen_bus_alignment import alignments, provenance

GRAPH = C.DATA / 'walkthrough/outdoor-graph.json'
OUT = C.DATA / 'bus-routes.json'
STRUCTURE = C.DATA / 'walkthrough/campus-structure.json'

WIDTH = {'tertiary': 8.0, 'residential': 6.5, 'unclassified': 6.0, 'living_street': 5.0, 'service': 4.5}
NARROW = 5.5
VEHICLE = {'lengthM': 10.5, 'widthM': 2.5, 'heightM': 3.1, 'minTurnRadiusM': 9.0}
CRUISE = 30 / 3.6                 # 30 km/h，以交通模擬秒計
SCHEDULE = {'kind': 'schematic', 'gameSecondsPerRealSecond': 5, 'terminalLayoverRealSeconds': 10, 'minDwellRealSeconds': 6}
SPAWN_NODE, GATE_NODE, LA_REVERSAL = 1726, 1740, 1008
LA_JUNCTION_DEFAULT = 1008
FILLET_R, LOOP_R, SPUR, PAVE_MARGIN = 9.5, 10.0, 0.0, 3.5
LOOP_SIGN = -1                    # 迴轉圈主弧左轉：右側車門朝圈外
HAIRPIN_NODES = (1626,)
HAIRPIN_R, HAIRPIN_MIN_DEG = 9.5, 120.0
ARC_STEP = 15.0

# id, 站群, 節點（文學院在廣場，沒有既有節點）
STOPS = [
    ('gate-in', 'gate', GATE_NODE), ('gate-out', 'gate', GATE_NODE),
    ('admin-up', 'admin', 3509), ('admin-down', 'admin', 840),
    ('dorm-h-up', 'dorm-h', 3063), ('dorm-h-down', 'dorm-h', 3466),
    ('activity-up', 'activity', 3502), ('activity-down', 'activity', 3030), ('activity-loop', 'activity', 3544),
    ('wuling-up', 'wuling', 1573), ('wuling-down', 'wuling', 1570),
    ('liberal-arts', 'liberal-arts', None), ('marine-sci', 'marine-sci', 2901), ('marine-eng', 'marine-eng', 255),
]
GROUPS = {
    'gate': ('校門站', ['西子灣校門站', '校門']),
    'hamasen-orange-stop': ('哈瑪星站 1 號出口', ['捷運哈瑪星站', '橘1延']),
    'hamasen-campus-stop': ('哈瑪星站 2 號出口', ['捷運哈瑪星站', '校園公車']),
    'admin': ('行政大樓站', ['行政大樓／國研大樓', '國研大樓']),
    'dorm-h': ('H棟宿舍站', ['H棟宿舍', '翠亨山莊H棟']),
    'activity': ('活動中心站', ['活動中心', '學生活動中心']),
    'wuling': ('武嶺路口站', ['武嶺路口']),
    'liberal-arts': ('文學院站', ['文學院']),
    'marine-sci': ('海科院站', ['海科院', '海洋科學學院']),
    'marine-eng': ('海工館站', ['海工館']),
}
ROUTES = {
    'campus-bus': {
        'name': '校園公車', 'vehicleId': 'bus_campus', 'driver': 'bus-driver-campus', 'initialPhaseGameSeconds': 0, 'sourceIds': ('S10', 'S11'),
        'stops': ['gate-in', 'admin-up', 'dorm-h-up', 'activity-up', 'wuling-up', 'liberal-arts', 'wuling-down', 'activity-down', 'dorm-h-down', 'gate-out'],
        'board': '歡迎上車，校園公車出示教職員工生證件就免費，請坐穩。',
        'note': '回程不停行政大樓站（S10 的校園公車欄位）',
    },
    'orange-1-ext': {
        'name': '橘1延', 'vehicleId': 'bus_orange1', 'driver': 'bus-driver-orange', 'initialPhaseGameSeconds': 600, 'sourceIds': ('S10',),
        'stops': ['gate-in', 'admin-up', 'dorm-h-up', 'activity-up', 'wuling-up', 'liberal-arts', 'marine-sci', 'marine-eng', 'dorm-h-down', 'activity-loop', 'admin-down', 'gate-out'],
        'board': '歡迎搭橘一延，這班下山會經海科院和海工館，請坐穩。',
        'note': '下山經海科院、海工館，再繞回 H 棟宿舍、活動中心、行政大樓',
    },
}
ARRIVE_TEMPLATE = '{station}到了，要下車的乘客請小心階梯，慢走喔。'
ARRIVE_LA = '文學院站到了！下車記得拿好東西，小心路邊的獼猴喔。'
LAST_BUS = '這班是今天末班車囉，沒搭到就得自己走路囉，快上車！'
NOTICE = '簡化遊戲班表，實際班次以學校公告為準。'
STOP_NODE = {sid: node for sid, _, node in STOPS}
STOP_GROUP = {sid: group for sid, group, _ in STOPS}
TERMINALS = {'campus-bus': 'hamasen-campus-stop', 'orange-1-ext': 'hamasen-orange-stop'}
STOP_GROUP.update((sid, sid) for sid in TERMINALS.values())


def eid(a: int, b: int) -> str:
    return f'{min(a, b)}-{max(a, b)}'


# ---------------------------------------------------------------------------------------------------------------------
# graph
# ---------------------------------------------------------------------------------------------------------------------
def load_graph() -> dict:
    g = C.read_json(GRAPH, '需要先有 tools/build_outdoor_graph.py 的輸出。')
    for key in ('nodes', 'edges', 'edgeKind'):
        if not isinstance(g.get(key), list):
            C.die(f'outdoor-graph.json 缺少 {key}')
    if len(g['edges']) != len(g['edgeKind']):
        C.die('outdoor-graph.json 的 edges 與 edgeKind 長度不同')
    for i, n in enumerate(g['nodes']):
        if n.get('id') != i:
            C.die(f'outdoor-graph.json 第 {i} 個節點的 id 是 {n.get("id")}；本工具假設 id 等於索引')
    return g


def strip_v12(g: dict) -> bool:
    """移除上次加進去的節點與邊，回到 build_outdoor_graph.py 的輸出。"""
    meta = g.get('v12')
    if not meta:
        return False
    bn, be = meta['baseNodes'], meta['baseEdges']
    if bn > len(g['nodes']) or be > len(g['edges']):
        C.die('outdoor-graph.json 的 v12 記錄與內容不符（基底比現有資料還大），請重建 graph 後再跑')
    del g['nodes'][bn:]
    del g['edges'][be:]
    del g['edgeKind'][be:]
    if isinstance(g.get('stats'), dict):
        g['stats'].update(meta.get('baseStats', {}))
    del g['v12']
    return True


def graph_revision(g: dict) -> str:
    body = json.dumps([g['nodes'], g['edges'], g['edgeKind']], ensure_ascii=False, separators=(',', ':'))
    return 'outdoor-graph-v12.1:' + hashlib.sha256(body.encode('utf-8')).hexdigest()[:16]


def graph_text(g: dict) -> str:
    return json.dumps(g, ensure_ascii=False, separators=(',', ':')) + '\n'


class Network:
    """可行車邊的鄰接表。節點位置的 y 是 graph 的原值（不含 GROUND_Y）。"""

    def __init__(self, g: dict):
        self.nodes = g['nodes']
        self.kind: dict[tuple[int, int], str] = {}
        self.adj: list[list[tuple[int, float]]] = [[] for _ in self.nodes]
        reverse_only = {(edge['to'], edge['from']) for edge in g.get('hamasen', {}).get('edges', []) if edge.get('oneway')}
        for (a, b, w), k in zip(g['edges'], g['edgeKind']):
            if k not in WIDTH:
                continue
            key = (min(a, b), max(a, b))
            if key in self.kind:
                continue
            self.kind[key] = k
            if (a, b) not in reverse_only:
                self.adj[a].append((b, w))
            if (b, a) not in reverse_only:
                self.adj[b].append((a, w))

    def xz(self, n: int) -> tuple[float, float]:
        p = self.nodes[n]['p']
        return p[0], p[2]

    def world(self, n: int) -> tuple[float, float, float]:
        p = self.nodes[n]['p']
        return p[0], p[1] + C.GROUND_Y, p[2]

    def has(self, a: int, b: int) -> bool:
        return (min(a, b), max(a, b)) in self.kind

    def require_node(self, n: int, what: str):
        if not (isinstance(n, int) and 0 <= n < len(self.nodes)):
            C.die(f'{what}：節點 {n} 不在 graph 內（共 {len(self.nodes)} 個節點）')
        if not self.adj[n]:
            C.die(f'{what}：節點 {n} {self.nodes[n]["p"]} 沒有可行車的邊')


def shortest(net: Network, src: int, dst: int, came_from: int | None = None, arrive_from: set[int] | None = None) -> list[int] | None:
    """可行車邊上的最短路；狀態是（節點, 前一個節點），不准立刻折返。came_from 是抵達 src 時的前一個節點。"""
    start = (src, -1 if came_from is None else came_from)
    dist = {start: 0.0}
    prev: dict[tuple[int, int], tuple[int, int]] = {}
    heap = [(0.0, start[0], start[1])]
    end = None
    while heap:
        d, u, p = heapq.heappop(heap)
        if d > dist.get((u, p), math.inf):
            continue
        if u == dst and (u, p) != start and (arrive_from is None or p in arrive_from):
            end = (u, p)
            break
        for v, w in net.adj[u]:
            if v == p:
                continue
            key, nd = (v, u), d + w
            if nd < dist.get(key, math.inf):
                dist[key] = nd
                prev[key] = (u, p)
                heapq.heappush(heap, (nd, v, u))
    if end is None:
        return None
    out = [end[0]]
    state = end
    while state != start:
        state = prev[state]
        out.append(state[0])
    return out[::-1]


def street_preview(net, alignment, node, *, arriving, reach):
    """Match the visible end of a sourced alignment to directed edges in the game."""
    trace = LineString(alignment[::-1] if arriving else alignment)
    if Point(net.xz(node)).distance(Point(trace.coords[0])) > .15:
        C.die(f'站位節點 {node} 與 OSM 行車端點不符')
    neighbors = [[] for _ in net.nodes] if arriving else net.adj
    if arriving:
        for a, edges in enumerate(net.adj):
            for b, w in edges:
                neighbors[b].append((a, w))
    path, progress = [node], 0
    while progress < reach:
        choices = []
        for next_node, distance in neighbors[path[-1]]:
            point = Point(net.xz(next_node))
            along = trace.project(point)
            if along <= progress + .02 or along > progress + distance + 2:
                continue
            if trace.distance(point) <= .85 and C.in_bounds(point.x, point.y):
                choices.append((along, trace.distance(point), next_node))
        if not choices:
            C.die(f'站位節點 {node} 的街道預覽只能接續 {progress:.1f} m')
        progress, _, next_node = min(choices)
        path.append(next_node)
    return path[::-1] if arriving else path


def city_leg(departure, arrival, nodes_out, nodes_in, alignment, source, occurrences, net, terrain, *, wrap=False):
    def positions(nodes, limit, *, arriving):
        line = LineString([net.xz(n) for n in nodes])
        if line.length > limit:
            line = substring(line, line.length - limit if arriving else 0, line.length if arriving else limit)
        return [P3(x, terrain.height_at(x, z), z) for x, z in line.coords]

    length = C.path_length(alignment)
    return {
        'fromOccurrenceId': occurrences[0], 'toOccurrenceId': occurrences[1],
        'departurePath': positions(nodes_out, departure, arriving=False),
        'path': positions(nodes_in, arrival, arriving=True),
        'departureNodeIds': nodes_out, 'nodeIds': nodes_in,
        'departureSourceEdgeIds': [eid(a, b) for a, b in zip(nodes_out, nodes_out[1:])],
        'sourceEdgeIds': [eid(a, b) for a, b in zip(nodes_in, nodes_in[1:])],
        'cruiseMpsGame': C.num(CRUISE, 3), 'lengthM': C.num(length, 1),
        'osmAlignment': {'path': alignment, **source},
        'designNote': '依 OSM 行車道路連接；超出遊玩範圍的路段以乘車淡出呈現。',
        **({'terminalTransfer': True} if wrap else {}),
    }


# ---------------------------------------------------------------------------------------------------------------------
# 節點序列
# ---------------------------------------------------------------------------------------------------------------------
def analysis_sequences(path, graph: dict, warnings: list[str]) -> dict[str, list[int]]:
    a = json.loads(path.read_text(encoding='utf-8'))
    theirs, ours = a.get('inputs', {}).get('osmSha256'), graph.get('source', {}).get('osmSha256')
    if theirs != ours:
        warnings.append(f'路網分析用的 OSM（{str(theirs)[:12]}…）與 graph（{str(ours)[:12]}…）不同；節點編號可能對不上')
    try:
        campus = a['lines']['campus_bus']
        out, back = campus['outbound']['node_ids'], campus['return']['node_ids']
        loop = a['lines']['orange1_ext']['loop']['node_ids']
    except (KeyError, TypeError) as e:
        C.die(f'{path} 的結構不是預期的 lines.campus_bus.outbound/return.node_ids 與 lines.orange1_ext.loop.node_ids：{e}')
    if out[-1] != back[0]:
        C.die(f'分析檔的去程終點 {out[-1]} 與回程起點 {back[0]} 不同')
    return {'campus-bus': list(out) + list(back[1:]), 'orange-1-ext': list(loop)}


def computed_sequences(net: Network) -> dict[str, list[int]]:
    out = {}
    for rid, spec in ROUTES.items():
        seq, came = [GATE_NODE], None
        for sid in spec['stops'][1:]:
            target = STOP_NODE[sid] if STOP_NODE[sid] is not None else LA_REVERSAL
            leg = shortest(net, seq[-1], target, came)
            if leg is None:
                C.die(f'{rid}：可行車邊上找不到 {seq[-1]} → {target}（{sid}）的路')
            seq += leg[1:]
            came = None if target == LA_REVERSAL else seq[-2]   # 只准在文學院迴轉
        out[rid] = seq
    return out


def stop_indices(rid: str, seq: list[int]) -> list[int]:
    """每個停靠在序列中的索引：依序找下一次出現的站節點。"""
    stops = ROUTES[rid]['stops']
    if seq[0] != GATE_NODE:
        C.die(f'{rid}：序列起點是 {seq[0]}，預期是校門節點 {GATE_NODE}')
    idx = [0]
    for sid in stops[1:]:
        node = STOP_NODE[sid] if STOP_NODE[sid] is not None else LA_REVERSAL
        try:
            idx.append(seq.index(node, idx[-1] + 1))
        except ValueError:
            C.die(f'{rid}：在第 {idx[-1]} 個節點之後找不到 {sid} 的節點 {node}；站序與路徑不符')
    if idx[-1] != len(seq) - 1:
        C.die(f'{rid}：最後一站 {stops[-1]} 在索引 {idx[-1]}，但序列長 {len(seq)}；終點後還有多餘節點')
    return idx


def la_trim(rid: str, seq: list[int], i: int, junction: int) -> int:
    """文學院折返點前後對稱；回傳接點離折返點的節點數 m（seq[i-m] == seq[i+m] == junction）。"""
    for m in range(0, 13):
        if i - m < 1 or i + m > len(seq) - 2:
            break
        if seq[i - m] != seq[i + m]:
            C.die(f'{rid}：文學院折返點前後不對稱（{seq[i - m]} ≠ {seq[i + m]}），無法切出支線')
        if seq[i - m] == junction:
            return m
    C.die(f'{rid}：文學院折返點附近找不到接點節點 {junction}；附近的節點是 {seq[max(0, i - 8):i + 1]}，可用 --la-junction 指定其中一個')


# ---------------------------------------------------------------------------------------------------------------------
# 文學院支線與迴轉圈
# ---------------------------------------------------------------------------------------------------------------------
def build_forecourt(graph: dict, net: Network, before: int, junction: int, side: int, terrain, warnings: list[str]) -> dict:
    nodes = graph['nodes']
    pj, pp = net.xz(junction), net.xz(before)
    dx, dz = C.unit(pj[0] - pp[0], pj[1] - pp[1])
    heading = math.degrees(math.atan2(dz, dx))
    fillet, q, h2 = C.turtle_arc(pj, heading, side, FILLET_R, 45.0, ARC_STEP)
    t2 = math.radians(h2)
    base = (q[0] + math.cos(t2) * SPUR, q[1] + math.sin(t2) * SPUR)
    try:
        loop, apex, _ = C.keyhole(base, h2, 180.0, LOOP_SIGN, LOOP_R, ARC_STEP)
    except ValueError as e:
        C.die(f'文學院迴轉圈：{e}')
    centre = (base[0] + math.cos(t2) * math.sqrt(3) * LOOP_R, base[1] + math.sin(t2) * math.sqrt(3) * LOOP_R)
    fillet = fillet[:-1]
    new_xz = fillet + [base] + loop[:-1]
    outside = [p for p in new_xz if not C.in_bounds(*p)]
    if outside:
        C.die(f'文學院迴轉圈有 {len(outside)} 個點在 PLAY_BOUNDS 之外（例如 {outside[0]}）；請改 --la-junction 或 --la-side')
    junction_y = nodes[junction]['p'][1]
    heights = [terrain.height_at(x, z) - C.GROUND_Y for x, z in new_xz] if terrain else [junction_y] * len(new_xz)
    spread = max(heights) - min(heights)
    if spread > 1.5:
        warnings.append(f'文學院廣場的地表高差 {spread:.1f} m（{min(heights):.1f}..{max(heights):.1f}，接點 {junction_y:.1f}）；需要整平或換位置')
    first = len(nodes)
    for (x, z), y in zip(new_xz, heights):
        nodes.append({'id': len(nodes), 'p': [C.num(x), C.num(y), C.num(z)]})
    f_ids = list(range(first, first + len(fillet)))
    base_id = first + len(fillet)
    loop_ids = list(range(base_id + 1, base_id + len(loop)))
    chain = [junction] + f_ids + [base_id] + loop_ids + [base_id]
    first_edge, added = len(graph['edges']), 0.0
    for a, b in zip(chain, chain[1:]):
        w = C.num(math.dist(nodes[a]['p'], nodes[b]['p']))
        graph['edges'].append([a, b, w])
        graph['edgeKind'].append('service')
        added += w
    tangent = C.unit(loop[apex + 1][0] - loop[apex - 1][0], loop[apex + 1][1] - loop[apex - 1][1])
    ring = [P2(centre[0] + (LOOP_R + PAVE_MARGIN) * math.cos(2 * math.pi * k / 24), centre[1] + (LOOP_R + PAVE_MARGIN) * math.sin(2 * math.pi * k / 24)) for k in range(24)]
    # Balance cut/fill over the entire proposed paved footprint, not just the
    # road junction. This is a surface proposal; no terrain/bake is overwritten.
    x0,z0,x1,z1=C.bbox(ring)
    surface_samples=[terrain.height_at(x,z) for x,z in ring]
    surface_samples += [terrain.height_at(x,z) for x in range(math.ceil(x0),math.ceil(x1))
                        for z in range(math.ceil(z0),math.ceil(z1)) if C.in_poly((x,z),ring)]
    level=(min(surface_samples)+max(surface_samples))/2
    return {
        'junction': junction, 'before': before, 'heading': (dx, dz), 'side': 'left' if side < 0 else 'right',
        'in': f_ids + [base_id] + loop_ids[:apex + 1], 'out': loop_ids[apex:] + [base_id] + f_ids[::-1],
        'berth': loop_ids[apex], 'berthHeading': tangent, 'nodeRange': [first, len(nodes) - 1], 'edgeRange': [first_edge, len(graph['edges']) - 1],
        'edges': {eid(a, b) for a, b in zip(chain, chain[1:])}, 'addedLength': added, 'centre': centre, 'ring': ring,
        'centerline': [pj] + new_xz + [base], 'levelY': level, 'terrainSpread': spread,
    }


# ---------------------------------------------------------------------------------------------------------------------
# 路徑、站、區段
# ---------------------------------------------------------------------------------------------------------------------
def leg_nodes(rid: str, seq: list[int], idx: list[int], fc: dict, m: int) -> list[list[int]]:
    stops = ROUTES[rid]['stops']
    la = stops.index('liberal-arts')
    out = []
    for k in range(len(stops) - 1):
        if k + 1 == la:
            out.append(seq[idx[k]:idx[la] - m + 1] + fc['in'])
        elif k == la:
            out.append(fc['out'] + seq[idx[la] + m:idx[k + 1] + 1])
        else:
            out.append(seq[idx[k]:idx[k + 1] + 1])
    return out


def leg_path(net: Network, nodes: list[int], patches: dict) -> list[tuple[float, float, float]]:
    pts = []
    for i, n in enumerate(nodes):
        x, y, z = net.world(n)
        pts.append((x, y, z))
        if n in HAIRPIN_NODES and 0 < i < len(nodes) - 1:
            a, c = net.xz(nodes[i - 1]), net.xz(nodes[i + 1])
            h_in = math.degrees(math.atan2(z - a[1], x - a[0]))
            h_out = math.degrees(math.atan2(c[1] - z, c[0] - x))
            turn = (h_out - h_in + 180.0) % 360.0 - 180.0   # 正值右轉
            if abs(turn) >= HAIRPIN_MIN_DEG:
                try:
                    bulb, _, _ = C.keyhole((x, z), h_in, abs(turn), 1 if turn > 0 else -1, HAIRPIN_R, ARC_STEP)
                except ValueError as e:
                    C.die(f'急彎 {n}：{e}')
                bad = [p for p in bulb if not C.in_bounds(*p)]
                if bad:
                    C.die(f'急彎 {n} 的拓寬路徑超出 PLAY_BOUNDS：{bad[0]}')
                pts += [(px, y, pz) for px, pz in bulb]
                patches.setdefault(n, {'node': n, 'turnDeg': abs(turn), 'centerline': [(x, y, z)] + [(px, y, pz) for px, pz in bulb]})
    return pts


def stop_record(sid: str, node, anchor: str, pos, heading, extra: dict) -> dict:
    name, aliases = GROUPS[STOP_GROUP[sid]]
    (x, y, z), (fx, fz) = pos, heading
    rx, rz = -fz, fx                                    # 行進方向的右側（車門側）
    at = lambda ahead, side: P3(x + fx * ahead + rx * side, y, z + fz * ahead + rz * side)
    record = {
        'id': sid, 'group': STOP_GROUP[sid], 'name': name, 'aliases': aliases,
        'sign': at(6.5, 3.2), 'berth': {'position': P3(x, y, z), 'yaw': C.yaw_of(fx, fz), 'heading': [C.num(fx, 3), C.num(fz, 3)]},
        'boardingPoint': at(3.9, 2.7), 'alightingPoints': [at(-1.6, 2.7), at(3.9, 2.7)],
        'pedestrianAnchorId': anchor, 'graphNode': node, 'basis': 'schematic',
        'designNote': '站位依路網推定（最接近站名建物的可行車節點）；站牌與上下車點在行進方向右側',
    }
    if sid == 'dorm-h-up':
        # The right shoulder is a steep DEM bank: real capsule cannot stand there.
        record['boardingPoint'] = at(4, -3.2)
        record['alightingPoints'] = [at(4, -3.2), at(2, -3.2)]
        record['sign'] = at(6, -3.2)
        record['designNote'] = '右側陡坡無法站立；候車與上下車改到道路左側經實際碰撞驗證的平緩肩部（示意）'
    if sid == 'wuling-up':
        record['sign'] = at(-3.5, 3.2)
        record['designNote'] = '原 1577 上下車點受陡坡阻擋；沿同路移至 1573 的可站立肩部'
    if sid == 'dorm-h-down':
        # Original 3467/right-hand stop lands inside EC. Use the preceding
        # existing road node and rear boarding/alighting positions.
        record['boardingPoint'] = at(-1.6, 2.7)
        record['alightingPoints'] = [at(-1.6, 2.7), at(-3.5, 2.7)]
        record['sign'] = at(-4.5, 3.2)
        record['designNote'] = '原 3467 的上下車點在東綜建物內；移至同一路線前一節點 3466，使用後方候車點'
    record.update(extra)
    record.update(C.binding('S10'))
    return record


def chain_of(net: Network, a: int, b: int) -> tuple[list[str], int, int]:
    """把邊 a-b 沿著度數 2 的節點往兩端延伸到路口，回傳（邊 id 列、兩端節點）。"""
    def walk(prev: int, cur: int):
        steps = []
        for _ in range(5000):
            if len(net.adj[cur]) != 2:
                break
            nxt = [v for v, _ in net.adj[cur] if v != prev]
            if len(nxt) != 1:
                break
            steps.append(eid(cur, nxt[0]))
            prev, cur = cur, nxt[0]
            if cur in (a, b):
                break
        return steps, cur
    forward, end_b = walk(a, b)
    backward, end_a = walk(b, a)
    edges = list(dict.fromkeys(backward[::-1] + [eid(a, b)] + forward))
    return edges, end_a, end_b


def lane_blocks(net: Network, route_legs: dict[str, list[list[int]]], forecourt_edges: set[str]) -> list[dict]:
    use: dict[str, set[tuple[str, int]]] = {}
    for rid, legs in route_legs.items():
        for nodes in legs:
            for a, b in zip(nodes, nodes[1:]):
                use.setdefault(eid(a, b), set()).add((rid, 1 if a < b else -1))
    blocks, seen, ids = [], set(), set()
    for e in use:
        a, b = (int(v) for v in e.split('-'))
        if e in forecourt_edges or WIDTH[net.kind[(a, b)]] >= NARROW:
            continue
        edges, end_a, end_b = chain_of(net, a, b)
        key = tuple(sorted(edges))
        if key in seen:
            continue
        seen.add(key)
        length, users, head_on = 0.0, set(), False
        for x in edges:
            u, v = (int(n) for n in x.split('-'))
            length += math.dist(net.xz(u), net.xz(v))
            traversals = use.get(x, set())
            users |= {r for r, _ in traversals}
            head_on = head_on or any(r1 != r2 and d1 != d2 for r1, d1 in traversals for r2, d2 in traversals)
        bid = f'blk-{min(end_a, end_b)}-{max(end_a, end_b)}'
        while bid in ids:
            bid += 'b'
        ids.add(bid)
        blocks.append({'id': bid, 'endNodes': [end_a, end_b], 'edgeIds': edges, 'lengthM': C.num(length, 1), 'usedBy': sorted(users), 'headOnPossible': head_on})
    return blocks


def landmark_polygons() -> list[tuple[str, list]]:
    try:
        ctx = json.loads(STRUCTURE.read_text(encoding='utf-8'))['context']
        return [(l.get('id', '?'), l['polygon']) for l in ctx.get('landmarks', []) + ctx.get('background', []) if l.get('polygon')]
    except (OSError, ValueError, KeyError, TypeError):
        return []


def main():
    ap = C.cli(__doc__)
    ap.add_argument('--analysis', help='路網分析 routes.json 的路徑（預設在 artifacts/v12/research/bus/）')
    ap.add_argument('--no-analysis', action='store_true', help='不讀分析檔，直接在 graph 上算最短路')
    ap.add_argument('--la-junction', type=int, default=LA_JUNCTION_DEFAULT, help='文學院支線的接點節點')
    ap.add_argument('--la-side', choices=['left', 'right'], default='left', help='廣場在去程行進方向的哪一側')
    args = ap.parse_args()
    warnings: list[str] = []

    graph = load_graph()
    stripped = strip_v12(graph)
    osm = json.loads(SNAPSHOT.read_text())
    graph = add_graph(graph, osm, *district(osm))
    base_nodes, base_edges = len(graph['nodes']), len(graph['edges'])
    base_stats = {k: graph.get('stats', {}).get(k) for k in ('nodes', 'edges', 'totalLength') if k in graph.get('stats', {})}
    print(f'graph：{base_nodes} 個節點、{base_edges} 條邊' + ('（已先移除上次的 v12 節點）' if stripped else ''))
    net = Network(graph)
    for n, what in [(SPAWN_NODE, '生成點'), (GATE_NODE, '校門'), (LA_REVERSAL, '文學院折返點')] + [(n, sid) for sid, _, n in STOPS if n is not None]:
        net.require_node(n, what)
    terrain = C.load_terrain(warnings)

    if args.no_analysis:
        seqs, path_source = computed_sequences(net), 'graph 上的最短路（禁止中途迴轉）'
    else:
        analysis = C.find_artifact('research/bus/routes.json', args.analysis)
        seqs, path_source = analysis_sequences(analysis, graph, warnings), 'artifacts/v12/research/bus/routes.json 的 node_ids（逐邊對 graph 驗證）'
    print(f'節點序列來源：{path_source}')
    for rid, seq in seqs.items():
        for a, b in zip(seq, seq[1:]):
            if not (isinstance(a, int) and isinstance(b, int) and 0 <= a < base_nodes and 0 <= b < base_nodes and net.has(a, b)):
                C.die(f'{rid}：{a} → {b} 不是 graph 上的可行車邊；分析檔與 graph 不同步，可改用 --no-analysis')

    indices = {rid: stop_indices(rid, seq) for rid, seq in seqs.items()}
    trims = {}
    for rid, seq in seqs.items():
        i = indices[rid][ROUTES[rid]['stops'].index('liberal-arts')]
        trims[rid] = la_trim(rid, seq, i, args.la_junction)
    campus, ci = seqs['campus-bus'], indices['campus-bus'][ROUTES['campus-bus']['stops'].index('liberal-arts')]
    before = campus[ci - trims['campus-bus'] - 1]
    for rid, seq in seqs.items():
        i = indices[rid][ROUTES[rid]['stops'].index('liberal-arts')]
        if seq[i - trims[rid] - 1] != before:
            C.die(f'{rid}：進入接點 {args.la_junction} 的方向與校園公車不同（{seq[i - trims[rid] - 1]} ≠ {before}）')
    fc = build_forecourt(graph, net, before, args.la_junction, -1 if args.la_side == 'left' else 1, terrain, warnings)
    try:
        la_poly = C.load_trace()[0]['hill']['liberal-arts']['polygon']
        near = [n for n in range(fc['nodeRange'][0], fc['nodeRange'][1] + 1)
                if C.in_poly((graph['nodes'][n]['p'][0], graph['nodes'][n]['p'][2]), la_poly) or C.dist_point_poly((graph['nodes'][n]['p'][0], graph['nodes'][n]['p'][2]), la_poly) < 3.0]
        if near:
            warnings.append(f'文學院迴轉圈有 {len(near)} 個節點在文學院量體內或 3 m 內（例如節點 {near[0]}）；請改 --la-side 或 --la-junction')
    except (KeyError, TypeError, SystemExit):
        warnings.append('讀不到描圖的文學院量體，沒有檢查迴轉圈是否撞到建物')

    if isinstance(graph.get('stats'), dict):
        graph['stats']['nodes'], graph['stats']['edges'] = len(graph['nodes']), len(graph['edges'])
        if 'totalLength' in graph['stats']:
            graph['stats']['totalLength'] = C.num(graph['stats']['totalLength'] + fc['addedLength'], 1)
    graph['v12'] = {
        'tool': 'tools/apply_v12_bus.py', 'baseNodes': base_nodes, 'baseEdges': base_edges, 'baseStats': base_stats,
        'laForecourt': {'junctionNode': fc['junction'], 'nodeRange': fc['nodeRange'], 'edgeRange': fc['edgeRange'], 'berthNode': fc['berth'], 'edgeKind': 'service',
                        'basis': 'schematic', 'note': '文學院站前廣場的支線與迴轉圈（示意）；節點高度取地表，廣場整平後請重跑'},
    }
    revision = graph_revision(graph)
    graph['v12']['revision'] = revision
    net = Network(graph)

    # ---- 生成／消失路徑 ----
    spawn_nodes = shortest(net, SPAWN_NODE, GATE_NODE)
    if spawn_nodes is None:
        C.die(f'生成點 {SPAWN_NODE} 到校門 {GATE_NODE} 沒有可行車的路')
    for rid, seq in seqs.items():
        if len(spawn_nodes) >= 2 and seq[1] == spawn_nodes[-2]:
            C.die(f'{rid}：從校門出發的第一段往生成點方向走（{seq[1]}），端點設定有誤')

    # ---- 各線的段落 ----
    route_legs = {rid: leg_nodes(rid, seq, indices[rid], fc, trims[rid]) for rid, seq in seqs.items()}
    patches: dict[int, dict] = {}
    stop_data: dict[str, dict] = {}
    routes_out = []
    landmarks = landmark_polygons()
    stop_names = [GROUPS[g][0] for g in GROUPS]
    digest = terrain.height_digest() if terrain else None
    surface_version = f'terrain-triangle+GROUND_Y:{str(graph.get("source", {}).get("terrainSha256", "unknown"))[:16]}'
    for rid, spec in ROUTES.items():
        terminal = TERMINALS[rid]
        legs_n, stops = route_legs[rid], [*spec['stops'], terminal]
        terminal_anchor = graph['anchors'][terminal]
        terminal_node = terminal_anchor['roadNode']
        align_out, align_in = alignments(terminal)
        alignment_source = provenance(terminal)
        directions = alignment_source.pop('directions')
        arrival_limit = 33 if terminal == 'hamasen-orange-stop' else 35
        gate_departure = street_preview(net, align_out, GATE_NODE, arriving=False, reach=35)
        terminal_arrival = street_preview(net, align_out, terminal_node, arriving=True, reach=arrival_limit)
        terminal_departure = street_preview(net, align_in, terminal_node, arriving=False, reach=35)
        gate_arrival = street_preview(net, align_in, GATE_NODE, arriving=True, reach=35)
        occurrences = [{'occurrenceId': f'{i:02d}-{sid}', 'stopId': sid} for i, sid in enumerate(stops)]
        legs, full = [], []
        for k, nodes in enumerate(legs_n):
            for a, b in zip(nodes, nodes[1:]):
                if not net.has(a, b):
                    C.die(f'{rid} 第 {k} 段：{a} → {b} 不是可行車邊')
            pts = leg_path(net, nodes, patches)
            pts = [(x, terrain.height_at(x, z), z) for x, _, z in pts]
            bad = [p for p in pts if not C.in_bounds(p[0], p[2])]
            if bad:
                C.die(f'{rid} 第 {k} 段有 {len(bad)} 個點在 PLAY_BOUNDS 之外，例如 {bad[0]}')
            legs.append({
                'fromOccurrenceId': occurrences[k]['occurrenceId'], 'toOccurrenceId': occurrences[k + 1]['occurrenceId'],
                'path': [P3(*p) for p in pts], 'sourceEdgeIds': [eid(a, b) for a, b in zip(nodes, nodes[1:])],
                'cruiseMpsGame': C.num(CRUISE, 3), 'lengthM': C.num(C.path_length([(p[0], p[2]) for p in pts]), 1), 'nodeIds': nodes,
            })
            full += [(p[0], p[2]) for p in (pts if not full else pts[1:])]
        # 站：每個站 id 只定義一次，方向取所在路線的行進方向
        for k, sid in enumerate(spec['stops']):
            if sid == 'liberal-arts':
                node, heading = fc['berth'], fc['berthHeading']
            else:
                node = legs_n[k][0] if k < len(legs_n) else legs_n[-1][-1]
                prev_n = legs_n[k - 1][-2] if k > 0 else spawn_nodes[-2]
                next_n = legs_n[k][1] if k < len(legs_n) else spawn_nodes[-2]
                a, c = net.xz(prev_n), net.xz(next_n)
                heading = C.unit(c[0] - a[0], c[1] - a[1])
            if node != (STOP_NODE[sid] if sid != 'liberal-arts' else fc['berth']):
                C.die(f'{rid}：{sid} 應在節點 {STOP_NODE[sid]}，但段落端點是 {node}')
            if sid in stop_data:
                old = stop_data[sid]['berth']['heading']
                if old[0] * heading[0] + old[1] * heading[1] < 0.5:
                    warnings.append(f'{sid}：{rid} 經過這一站的方向與先前定義差很多（{old} 與 {[round(v, 2) for v in heading]}）')
                continue
            extra = {}
            if sid == 'liberal-arts':
                extra = {'designNote': '站位在文學院站前廣場的迴轉圈上（示意）；車門朝圈外', 'forecourtId': 'la-forecourt'}
            if STOP_GROUP[sid] == 'gate':
                extra = {'designNote': '蓮海路校門站位，依遊戲路網推定。'}
            record = stop_record(sid, node, f'node:{node}', net.world(node), heading, extra)
            for p in [record['berth']['position'], record['sign'], record['boardingPoint'], *record['alightingPoints']]:
                p[1] = C.num(terrain.height_at(p[0], p[2]), 3)
            for label, p in [('上車點', record['boardingPoint']), ('站牌', record['sign'])] + [('下車點', q) for q in record['alightingPoints']]:
                hit = next((lid for lid, poly in landmarks if C.in_poly((p[0], p[2]), poly)), None)
                if hit:
                    warnings.append(f'{sid}：{label} {p} 落在地標 {hit} 的輪廓內，需要換到路的另一側或調整')
            stop_data[sid] = record
        # The bus follows the same direction through the metro stop on both local previews.
        tx, tz = net.xz(terminal_node)
        bx, bz = net.xz(terminal_arrival[-2])
        ax, az = net.xz(terminal_departure[1])
        approach = C.unit(tx - bx, tz - bz)
        heading = C.unit(ax - tx, az - tz)
        cx, cz = net.xz(terminal_anchor['node'])
        if approach[0]*heading[0] + approach[1]*heading[1] < .9 or (cx-tx)*(-heading[1])+(cz-tz)*heading[0] < 2.25:
            C.die(f'{terminal}：車道方向與候車側不符')
        source_note = ('橘1延往校側站牌，採 OSM 候車節點。' if terminal == 'hamasen-orange-stop'
                       else '校園公車候車點位置示意，鄰近哈瑪星站 2 號出口。')
        curb = P3(cx, terrain.height_at(cx, cz), cz)
        record = stop_record(terminal, terminal_node, f'node:{terminal_anchor["node"]}', net.world(terminal_node), heading,
                             {'designNote': source_note, 'sign': curb, 'boardingPoint': list(curb)})
        for p in [record['berth']['position'], record['boardingPoint'], *record['alightingPoints']]:
            p[1] = C.num(terrain.height_at(p[0], p[2]), 3)
        for p in [record['sign'], record['boardingPoint'], *record['alightingPoints']]:
            if any(C.in_poly((p[0], p[2]), polygon) for _, polygon in landmarks):
                C.die(f'{terminal}：站牌或上下車點 {p} 位於建物輪廓內')
        stop_data[terminal] = record
        gate_out, metro, gate_in = (occurrences[i]['occurrenceId'] for i in (-2, -1, 0))
        legs.append(city_leg(35, arrival_limit, gate_departure, terminal_arrival, align_out,
                             directions['gateToTerminal'], (gate_out, metro), net, terrain))
        legs.append(city_leg(35, 35, terminal_departure, gate_arrival, align_in,
                             directions['terminalToGate'], (metro, gate_in), net, terrain, wrap=True))
        length = sum(leg['lengthM'] for leg in legs)
        issues = []
        for corner in C.corner_report(full, VEHICLE['minTurnRadiusM']):
            issues.append({'kind': 'sharp-turn', 'status': 'open', **{k: v for k, v in corner.items() if k != 'index'},
                           'note': '未處理的路口轉彎：runtime 需要減速並容許擺出車道，或之後拓寬'})
        pitch = C.pitch_report(full, terrain.height_at) if terrain else None
        if pitch:
            for run in pitch['smoothed']:
                issues.append({'kind': 'pitch', 'status': 'open', 'profile': 'smoothed-60m', **run, 'note': '60 m 平滑後仍超過 7°，需要整平路面或限制俯仰'})
            for run in pitch['raw']:
                issues.append({'kind': 'pitch', 'status': 'runtime-smoothing', 'profile': 'raw', **run, 'note': '原始地表剖面超過 7°（多半是平台邊緣的地形假象），靠 60 m 平滑處理'})
        to_la = sum(leg['lengthM'] for leg in legs[:stops.index('liberal-arts')])
        routes_out.append({
            'id': rid, 'name': spec['name'], 'vehicleId': spec['vehicleId'], 'driverNpcId': spec['driver'],
            'stopOccurrences': occurrences, 'legs': legs,
            'hamasenSource': alignment_source,
            'schedule': {**SCHEDULE, 'initialPhaseGameSeconds': spec['initialPhaseGameSeconds']},
            'vehicle': dict(VEHICLE), 'surfaceVersion': surface_version, 'graphRevision': revision,
            'spawn': {'nodeId': SPAWN_NODE, 'nodeIds': spawn_nodes, 'path': [P3(*net.world(n)) for n in spawn_nodes], 'sourceEdgeIds': [eid(a, b) for a, b in zip(spawn_nodes, spawn_nodes[1:])]},
            'despawn': {'nodeId': SPAWN_NODE, 'nodeIds': spawn_nodes[::-1], 'path': [P3(*net.world(n)) for n in spawn_nodes[::-1]], 'sourceEdgeIds': [eid(a, b) for a, b in zip(spawn_nodes[::-1], spawn_nodes[-2::-1])]},
            'estimate': {
                'lengthM': C.num(length, 1), 'gateToLiberalArtsM': C.num(to_la, 1),
                'gateToLiberalArtsRealSeconds': C.num(to_la / CRUISE / SCHEDULE['gameSecondsPerRealSecond'] + (stops.index('liberal-arts') - 1) * SCHEDULE['minDwellRealSeconds'], 0),
                'fullRealSeconds': C.num(length / CRUISE / SCHEDULE['gameSecondsPerRealSecond'] + (len(stops) - 2) * SCHEDULE['minDwellRealSeconds'], 0),
                'note': '只依路長與停站估算，不含減速、讓車與障礙',
            },
            'pitch': {k: pitch[k] for k in ('windowM', 'limitDeg', 'maxRawDeg', 'maxSmoothedDeg')} if pitch else None,
            'issues': issues,
            'announcements': {'speaker': spec['driver'], 'board': spec['board'], 'arrive': ARRIVE_TEMPLATE, 'arriveAt': {'liberal-arts': ARRIVE_LA}, 'lastBus': LAST_BUS,
                              'stationNames': stop_names},
            'basis': 'map-derived', 'designNote': spec['note'] + '；班表是簡化的遊戲班表，路徑依 OSM 路網', **C.binding(*spec['sourceIds']),
        })

    visible_nodes = {route['id']: [nodes for leg in route['legs'] for nodes in
                                  [leg['nodeIds'], *([leg['departureNodeIds']] if 'departureNodeIds' in leg else [])]]
                     for route in routes_out}
    blocks = lane_blocks(net, visible_nodes, fc['edges'])
    for route in routes_out:
        for leg in route['legs']:
            edges = set(leg['sourceEdgeIds'] + leg.get('departureSourceEdgeIds', []))
            leg['narrowSectionIds'] = [b['id'] for b in blocks if set(b['edgeIds']) & edges]
    road_patches = [{
        'id': 'la-forecourt', 'kind': 'forecourt', 'centerline': [P3(x, fc['levelY'], z) for x, z in fc['centerline']], 'widthM': 7.0,
        'turnRadiusM': LOOP_R, 'filletRadiusM': FILLET_R, 'basis': 'schematic', 'designNote': '文學院站前廣場的支線與迴轉圈，位置示意；路面需要新增並整平',
    }]
    for n, patch in patches.items():
        road_patches.append({
            'id': f'hairpin-{n}', 'kind': 'widening', 'node': n, 'turnDeg': C.num(patch['turnDeg'], 1), 'centerline': [P3(*p) for p in patch['centerline']],
            'widthM': 4.5, 'turnRadiusM': HAIRPIN_R, 'basis': 'schematic', 'designNote': '髮夾彎外側拓寬成半徑 9.5 m 的迴車弧，路面需要新增；高度暫用折點高度',
        })
    for n in HAIRPIN_NODES:
        if n not in patches:
            warnings.append(f'急彎節點 {n} 不在路徑上，或轉向小於 {HAIRPIN_MIN_DEG:.0f}°，沒有產生拓寬路徑')
    for route in routes_out:
        route['issues'] = [{'kind': 'turnaround', 'status': 'widened', 'patchId': 'la-forecourt', 'radiusM': LOOP_R}] + \
                          [{'kind': 'sharp-turn', 'status': 'widened', 'patchId': f'hairpin-{n}', 'node': n, 'radiusM': HAIRPIN_R} for n in patches
                           if any(n in leg['nodeIds'] for leg in route['legs'])] + route['issues']

    data = {
        'version': 1,
        'generatedBy': 'tools/apply_v12_bus.py',
        'units': '世界公尺：x 向東、y 向上、z 向南；P3 = [x, y, z]，Y 已含 runtime 地面偏移 GROUND_Y',
        'conventions': {
            'yaw': '繞 +Y；前進方向 = (-sin yaw, -cos yaw)。berth.heading 另給 [dx, dz] 單位向量',
            'edgeId': '「小節點號-大節點號」，節點號是 outdoor-graph.json 的 nodes[].id，與行進方向無關',
            'heights': '路徑的 Y = runtime 三角形插值地表（含 GROUND_Y）；60 m 平滑後仍超過 7° 的坡段列在 issues，待路面整平',
            'pedestrianAnchorId': '「node:<節點號>」，是 outdoor-graph.json 上可步行抵達的節點',
            'stops': '同一個站在不同行進方向是不同的 stop（例如 admin-up／admin-down），用 group 與 name 歸成同一站',
            'cycle': 'legs 依序循環；帶 departurePath 的路段分開儲存進出站畫面，完整 OSM 路徑保存在 osmAlignment。',
        },
        'graphRevision': revision, 'surfaceVersion': surface_version, 'terrainHeightDigest': digest, 'pathSource': path_source,
        'timeCompression': {'gameSecondsPerRealSecond': SCHEDULE['gameSecondsPerRealSecond'], 'cruiseKmh': 30, 'note': '路徑前進 ds = cruiseMpsGame × 5 × realDt；停站、開關門用真實秒'},
        'notice': NOTICE,
        'stops': list(stop_data.values()),
        'routes': routes_out,
        'forecourt': {
            'id': 'la-forecourt', 'junctionNode': fc['junction'], 'side': fc['side'], 'center': P2(*fc['centre']), 'turnRadiusM': LOOP_R,
            'polygon': fc['ring'], 'levelY': C.num(fc['levelY'], 3), 'runtimeSurface': True, 'terrainSpreadM': C.num(fc['terrainSpread'], 2), 'berthNode': fc['berth'],
            'graphNodeRange': fc['nodeRange'], 'basis': 'schematic', 'designNote': '文學院站前廣場（示意）：polygon 是 runtime 與 bake 共用鋪面範圍，levelY 是整平高度',
        },
        'roadPatches': road_patches,
        'singleLaneBlocks': blocks,
        'singleLaneNote': '寬度小於 5.5 m 的路段依路口切成區段；一個區段同時只讓一台車進入，路口與站位是讓車點。headOnPossible 表示兩線會以相反方向經過',
    }
    missing = [sid for sid, _, _ in STOPS if sid not in stop_data]
    if missing:
        C.die(f'這些站沒有被任何路線用到：{missing}')

    print('\nbus-routes.json 摘要')
    print(f'  graphRevision {revision}；graph 新增節點 {fc["nodeRange"]}、邊 {fc["edgeRange"]}（文學院接點 {fc["junction"]}，廣場在{"左" if fc["side"] == "left" else "右"}側）')
    print(f'  文學院迴轉圈中心 {P2(*fc["centre"])}，半徑 {LOOP_R} m，站位節點 {fc["berth"]} {graph["nodes"][fc["berth"]]["p"]}，地表高差 {fc["terrainSpread"]:.2f} m')
    for s in data['stops']:
        print(f'  站 {s["id"]:14s} {s["name"]}  節點 {s["graphNode"]}  berth {s["berth"]["position"]}  heading {s["berth"]["heading"]}')
    for r in routes_out:
        e, opened = r['estimate'], [i for i in r['issues'] if i['status'] == 'open']
        print(f'  線 {r["id"]:13s} {len(r["stopOccurrences"])} 個停靠、{len(r["legs"])} 段、全長 {e["lengthM"]} m；校門→文學院 {e["gateToLiberalArtsM"]} m 約 {e["gateToLiberalArtsRealSeconds"]:.0f} 秒；整圈約 {e["fullRealSeconds"]:.0f} 秒')
        print(f'      俯仰 {r["pitch"]}；未處理問題 {len(opened)} 項（急彎 {sum(i["kind"] == "sharp-turn" for i in opened)}、俯仰 {sum(i["kind"] == "pitch" for i in opened)}）')
        for i in opened[:12]:
            print(f'      - {i["kind"]} {i.get("at")} ' + (f'轉 {i["deflectionDeg"]}°、估計半徑 {i["radiusEstM"]} m' if i['kind'] == 'sharp-turn' else f'{i["maxDeg"]}°（s {i["fromS"]}–{i["toS"]}）'))
    for p in road_patches:
        print(f'  路面補丁 {p["id"]}：{len(p["centerline"])} 點，最小轉彎半徑約 {C.min_turn_radius([(q[0], q[2]) for q in p["centerline"]]):.1f} m')
    print(f'  單線區段 {len(blocks)} 個，其中可能對向相遇 {sum(b["headOnPossible"] for b in blocks)} 個')

    stale = [C.emit(GRAPH, graph_text(graph), args), C.emit(OUT, C.dump(data), args)]
    C.finish(args, stale, warnings)


if __name__ == '__main__':
    main()
