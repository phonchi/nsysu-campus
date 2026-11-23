#!/usr/bin/env python3
"""v12.1 資料工具的共用部分（海域、公車、運動區）。

只用標準函式庫（不需要 numpy／scipy／shapely），讓 apply_v12_*.py 與 verify_v12_world.py 在任何環境都能跑。
座標：世界公尺，x 向東、y 向上、z 向南。寫進資料檔的 Y 都已包含 runtime 的地面偏移 GROUND_Y。
"""
from __future__ import annotations

import argparse
import array
import hashlib
import json
import math
import re
import sys
from functools import lru_cache
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'public/data'
GROUND_Y = -0.055                                  # src/world/terrain.ts
PLAY_BOUNDS = (-700.0, -1060.0, 952.0, 700.0)      # src/world/terrain.ts（x0, z0, x1, z1）
CAMPUS_GROUND = (-330.0, -330.0, 260.0, 480.0)     # src/walk-world.ts
# src/walk-art.ts:153 目前的沙灘多邊形（Astra 之後會把南端從網球區退開）。
BEACH_POLYGON = [[-330.0, 40.0], [-262.0, 48.0], [-240.0, 120.0], [-232.0, 220.0], [-246.0, 330.0], [-330.0, 380.0]]
IMAGERY_PROVENANCE = '依內政部國土測繪中心 2024 正射影像描繪（本機參考，不隨資料包發布）'
OSM_PROVENANCE = 'OpenStreetMap contributors，ODbL 1.0'

# ---------------------------------------------------------------------------------------------------------------------
# 來源登錄：只收 artifacts/v12/research/source-check.md 標 ✅ 的 S1–S14。url 必須是該表的精確網址；只有本機 PDF 的來源不給 url。
# ---------------------------------------------------------------------------------------------------------------------
_SEA = 'data/sources/sea/'
SOURCES = [
    {'id': 'S1', 'title': '西子灣海域運動中心管理要點（浪高與天候）', 'locator': '第（五）款：浪高 1 米、2 米門檻，海上颱風警報與打雷', 'file': _SEA + 'sea-center-rules-20250901.pdf'},
    {'id': 'S2', 'title': '西子灣海域運動中心管理要點（開放時間與人數）', 'locator': '第二點、第六點', 'file': _SEA + 'sea-center-rules-20250901.pdf'},
    {'id': 'S3', 'title': '西子灣海域運動中心管理要點（器材收費表）', 'locator': '附表', 'file': _SEA + 'sea-center-rules-20250901.pdf'},
    {'id': 'S4', 'title': '水域救生員相關要點', 'locator': '第二、三條', 'file': _SEA + 'lifeguard-rules-20251002.pdf'},
    {'id': 'S5', 'title': '救生艇借用辦法', 'locator': '第二、五點', 'file': _SEA + 'rescue-boat-rules-20191017.pdf'},
    {'id': 'S6', 'title': '1111 產經新聞網：首開「初級衝浪」課程', 'locator': '2023-05-12', 'url': 'https://www.1111.com.tw/news/jobns/151338'},
    {'id': 'S7', 'title': '1111 產經新聞網：第四屆臺日風帆友誼賽', 'locator': '2025-03-19', 'url': 'https://www.1111.com.tw/news/160002/amp/'},
    {'id': 'S8', 'title': '運動場館管理要點（場館清單）', 'locator': '第二點', 'file': _SEA + 'sports-venue-rules-20231208.pdf'},
    {'id': 'S9', 'title': '運動場館管理要點（體育館含體適能中心）', 'locator': '第三點', 'file': _SEA + 'sports-venue-rules-20231208.pdf'},
    {'id': 'S10', 'title': '校園公車與橘1延時刻表（站序）', 'locator': '時刻表欄位', 'file': 'data/sources/bus/campus-bus-20250217.pdf',
     'files': ['data/sources/bus/campus-bus-20250217.pdf', 'data/sources/bus/orange1-ext-20250203.pdf']},
    {'id': 'S11', 'title': '管理學院公告：校園公車出示證件免費', 'locator': '公告內文', 'url': 'https://www.cm.nsysu.edu.tw/p/406-1024-361192,r159.php'},
    {'id': 'S12', 'title': '中山新聞：夕陽獨木舟', 'locator': '2020-11-16', 'url': 'https://news.nsysu.edu.tw/p/406-1120-247014.php'},
    {'id': 'S13', 'title': '中山新聞：水中救生課', 'locator': '2021-11-23', 'url': 'https://news.nsysu.edu.tw/p/406-1120-271505.php'},
    {'id': 'S14', 'title': '中山新聞：衝浪課教學內容', 'locator': '校方新聞', 'url': 'https://news.nsysu.edu.tw/p/406-1120-308729,r2910.php?Lang=zh-tw'},
]
SOURCE_BY_ID = {s['id']: s for s in SOURCES}
APPROVED_URLS = [s['url'] for s in SOURCES if 'url' in s]
SOURCES_FILE = DATA / 'v12-sources.json'


def binding(*ids: str) -> dict:
    """SourceBinding：sources 只放核准的網址；只有本機 PDF 的來源放在 sourceFiles（data/sources/**）。"""
    urls, files = [], []
    for i in ids:
        if i not in SOURCE_BY_ID:
            raise KeyError(f'未登錄的來源 {i}（只能用 S1–S14）')
        s = SOURCE_BY_ID[i]
        if 'url' in s and s['url'] not in urls:
            urls.append(s['url'])
        for f in s.get('files', [s['file']] if 'file' in s else []):
            if f not in files:
                files.append(f)
    out = {'sources': urls, 'sourceIds': list(ids)}
    if files:
        out['sourceFiles'] = files
    return out


def sources_registry() -> dict:
    return {
        'version': 1,
        'note': '只收 artifacts/v12/research/source-check.md 標 ✅ 的 S1–S14。url 是核准的精確網址；file 是 data/sources/ 下的本機來源，不當成網頁連結顯示。',
        'sources': [{k: v for k, v in s.items() if k != 'files'} | ({'files': s['files']} if 'files' in s else {}) for s in SOURCES],
    }


# ---------------------------------------------------------------------------------------------------------------------
# 指令列與輸出
# ---------------------------------------------------------------------------------------------------------------------
def die(message: str, code: int = 2):
    print(f'ERROR: {message}', file=sys.stderr)
    sys.exit(code)


def warn(message: str):
    print(f'WARN: {message}')


def cli(description: str) -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(description=description, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--dry-run', action='store_true', help='只計算並印出摘要，不寫任何檔案')
    ap.add_argument('--check', action='store_true', help='不寫檔；輸出與現有檔案不同時以代碼 1 結束（冪等檢查）')
    ap.add_argument('--strict', action='store_true', help='把地形探測等警告當成錯誤')
    return ap


def dump(data) -> str:
    return json.dumps(data, ensure_ascii=False, indent=1) + '\n'


def read_json(path: Path, hint: str = ''):
    if not path.exists():
        die(f'找不到 {rel(path)}。{hint}')
    try:
        return json.loads(path.read_text(encoding='utf-8'))
    except json.JSONDecodeError as e:
        die(f'{rel(path)} 不是合法的 JSON：{e}')


def rel(path: Path) -> str:
    try:
        return str(Path(path).resolve().relative_to(ROOT))
    except ValueError:
        return str(path)


def emit(path: Path, text: str, args) -> bool:
    """依模式寫出或比對。回傳「現有檔案與新內容不同」。"""
    old = path.read_text(encoding='utf-8') if path.exists() else None
    stale = old != text
    state = '新檔' if old is None else ('有變更' if stale else '無變更')
    if args.check:
        print(f'[check] {rel(path)}：{state}')
    elif args.dry_run:
        print(f'[dry-run] {rel(path)}：{state}（{len(text)} 字元，未寫入）')
    else:
        if stale:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(text, encoding='utf-8')
        print(f'[write] {rel(path)}：{state}')
    return stale


def finish(args, stale: list[bool], warnings: list[str]):
    for w in warnings:
        warn(w)
    if args.strict and warnings:
        die(f'--strict：有 {len(warnings)} 則警告', 1)
    if args.check and any(stale):
        die('--check：輸出與現有檔案不同，請重新執行工具（不加 --check）', 1)


def find_artifact(relative: str, override: str | None = None) -> Path:
    """研究產物可能在 worktree 內，也可能只在主 checkout。"""
    candidates = [Path(override)] if override else [ROOT / 'artifacts/v12' / relative, ROOT.parent / 'habbit/artifacts/v12' / relative,
                                                    Path('/home/phonchi/habbit/artifacts/v12') / relative]
    for c in candidates:
        if c.exists():
            return c
    die('找不到研究產物 ' + relative + '；試過：' + '、'.join(str(c) for c in candidates) + '。請用參數指定路徑。')


# ---------------------------------------------------------------------------------------------------------------------
# 數值與幾何
# ---------------------------------------------------------------------------------------------------------------------
def num(v, digits: int = 2) -> float:
    r = round(float(v), digits)
    if not math.isfinite(r):
        raise ValueError(f'非有限數值 {v!r}')
    return 0.0 if r == 0 else r


def P2(x, z) -> list:
    return [num(x), num(z)]


def P3(x, y, z) -> list:
    return [num(x), num(y, 3), num(z)]


def unit(dx: float, dz: float) -> tuple[float, float]:
    length = math.hypot(dx, dz)
    if length < 1e-9:
        raise ValueError('零長度方向向量')
    return dx / length, dz / length


def yaw_of(dx: float, dz: float) -> float:
    """與座位表、avatar.heading 相同的約定：yaw 繞 +Y，模型前方是區域 -Z，所以前進方向 = (-sin yaw, -cos yaw)。"""
    return num(math.atan2(-dx, -dz), 4)


def in_bounds(x: float, z: float, bounds=PLAY_BOUNDS) -> bool:
    return bounds[0] <= x <= bounds[2] and bounds[1] <= z <= bounds[3]


def in_poly(p, poly) -> bool:
    """偶奇規則，與 src/world/terrain.ts 的 inPolygon 相同。"""
    inside = False
    j = len(poly) - 1
    for i in range(len(poly)):
        a, b = poly[i], poly[j]
        if (a[1] > p[1]) != (b[1] > p[1]) and p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]:
            inside = not inside
        j = i
    return inside


def poly_area(poly) -> float:
    s = 0.0
    for i in range(len(poly)):
        a, b = poly[i], poly[(i + 1) % len(poly)]
        s += a[0] * b[1] - b[0] * a[1]
    return abs(s) / 2


def _orient(p, q, r) -> float:
    return (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])


def seg_cross(a, b, c, d, eps: float = 1e-9) -> bool:
    """兩線段在內部真正交叉（共用端點或只是碰到不算）。"""
    d1, d2, d3, d4 = _orient(c, d, a), _orient(c, d, b), _orient(a, b, c), _orient(a, b, d)
    return ((d1 > eps and d2 < -eps) or (d1 < -eps and d2 > eps)) and ((d3 > eps and d4 < -eps) or (d3 < -eps and d4 > eps))


def poly_simple(poly) -> bool:
    n = len(poly)
    for i in range(n):
        for j in range(i + 1, n):
            if j == i or (j + 1) % n == i or (i + 1) % n == j:
                continue
            if seg_cross(poly[i], poly[(i + 1) % n], poly[j], poly[(j + 1) % n]):
                return False
    return True


def dist_point_seg(p, a, b) -> float:
    dx, dz = b[0] - a[0], b[1] - a[1]
    L = dx * dx + dz * dz
    t = 0.0 if L == 0 else max(0.0, min(1.0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / L))
    return math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dz * t)


def dist_point_poly(p, poly) -> float:
    """到多邊形邊界的距離（不分內外）。"""
    return min(dist_point_seg(p, poly[i], poly[(i + 1) % len(poly)]) for i in range(len(poly)))


def polys_overlap(a, b, eps: float = 0.05) -> bool:
    """兩個多邊形的內部是否重疊（邊貼邊不算）。"""
    for i in range(len(a)):
        for j in range(len(b)):
            if seg_cross(a[i], a[(i + 1) % len(a)], b[j], b[(j + 1) % len(b)]):
                return True
    if any(in_poly(p, b) and dist_point_poly(p, b) > eps for p in a):
        return True
    return any(in_poly(p, a) and dist_point_poly(p, a) > eps for p in b)


def polygon_problems(poly, label: str, bounds=PLAY_BOUNDS, min_area: float = 0.5) -> list[str]:
    if not isinstance(poly, list) or len(poly) < 3:
        return [f'{label}：多邊形至少要 3 個點']
    for p in poly:
        if not (isinstance(p, list) and len(p) == 2 and all(isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) for v in p)):
            return [f'{label}：點 {p!r} 不是有限的 [x, z]']
    out = []
    if poly_area(poly) < min_area:
        out.append(f'{label}：面積太小（{poly_area(poly):.2f} m²）')
    if not poly_simple(poly):
        out.append(f'{label}：多邊形自我相交')
    bad = [p for p in poly if not in_bounds(p[0], p[1], bounds)]
    if bad:
        out.append(f'{label}：{len(bad)} 個點在 PLAY_BOUNDS 之外，例如 {bad[0]}')
    return out


def path_length(points) -> float:
    """points 可為 [x, z] 或 [x, y, z]；只算水平長度。"""
    xz = [(p[0], p[-1]) for p in points]
    return sum(math.hypot(b[0] - a[0], b[1] - a[1]) for a, b in zip(xz, xz[1:]))


def resample(points_xz, step: float) -> list[tuple[float, float, float]]:
    """沿折線每 step 公尺取樣，回傳 (x, z, s)，含起點與終點。"""
    out = [(points_xz[0][0], points_xz[0][1], 0.0)]
    s, need = 0.0, step
    for a, b in zip(points_xz, points_xz[1:]):
        L = math.hypot(b[0] - a[0], b[1] - a[1])
        if L == 0:
            continue
        while need <= s + L + 1e-9:
            t = (need - s) / L
            out.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, need))
            need += step
        s += L
    last = points_xz[-1]
    if math.hypot(out[-1][0] - last[0], out[-1][1] - last[1]) > 1e-6:
        out.append((last[0], last[1], s))
    return out


def turtle_arc(p, heading_deg: float, sign: int, radius: float, angle_deg: float, step_deg: float = 15.0):
    """從 p 以 heading 出發走一段圓弧。heading 由 +x（東）量向 +z（南），sign=+1 右轉、-1 左轉。
    回傳（不含起點的點列, 終點, 終點 heading）。點都精確落在圓上。"""
    n = max(1, math.ceil(angle_deg / step_deg - 1e-9))
    th = math.radians(heading_deg)
    right = (-math.sin(th), math.cos(th))
    cx, cz = p[0] + sign * radius * right[0], p[1] + sign * radius * right[1]
    pts = []
    for k in range(1, n + 1):
        t = th + sign * math.radians(angle_deg) * k / n
        r = (-math.sin(t), math.cos(t))
        pts.append((cx - sign * radius * r[0], cz - sign * radius * r[1]))
    return pts, pts[-1], heading_deg + sign * angle_deg


def keyhole(p, heading_deg: float, delta_deg: float, sign: int, radius: float, step_deg: float = 15.0):
    """在原地完成 delta 度轉向的「鑰匙孔」路徑：反向擺 β、主轉 (delta+2β)、再反向擺 β，三段同半徑，起訖都在 p。
    封閉條件的解析解：sin(β + delta/2) = sin(delta/2) / 2（delta=180° 時 β=60°，就是迴轉圈）。
    回傳（不含起點的點列，最後一點回到 p；主弧中點在點列中的索引；終點 heading）。"""
    half = math.radians(delta_deg) / 2
    beta = math.degrees(math.pi - math.asin(math.sin(half) / 2) - half)
    if not 5 <= beta <= 88:
        raise ValueError(f'鑰匙孔無解：delta={delta_deg:.1f}° 得到 β={beta:.1f}°')
    pts, cur, th = turtle_arc(p, heading_deg, -sign, radius, beta, step_deg)
    main, cur, th = turtle_arc(cur, th, sign, radius, delta_deg + 2 * beta, step_deg)
    apex = len(pts) + len(main) // 2 - 1
    pts += main
    tail, cur, th = turtle_arc(cur, th, -sign, radius, beta, step_deg)
    pts += tail
    gap = math.hypot(cur[0] - p[0], cur[1] - p[1])
    if gap > 0.05:
        raise ValueError(f'鑰匙孔沒有閉合：差 {gap:.3f} m（delta={delta_deg:.1f}°，β={beta:.2f}°）')
    pts[-1] = (p[0], p[1])
    return pts, apex, th


def min_turn_radius(points_xz, min_deflection_deg: float = 1.0) -> float:
    """折線上相鄰三點外接圓半徑的最小值（轉向小於門檻的幾乎直線段不計）。"""
    best = math.inf
    for a, b, c in zip(points_xz, points_xz[1:], points_xz[2:]):
        ab, bc, ac = math.dist(a, b), math.dist(b, c), math.dist(a, c)
        if ab < 1e-6 or bc < 1e-6:
            continue
        cross = abs((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]))
        dot = (b[0] - a[0]) * (c[0] - b[0]) + (b[1] - a[1]) * (c[1] - b[1])
        if math.degrees(math.atan2(cross, dot)) < min_deflection_deg:
            continue
        best = min(best, ab * bc * ac / (2 * cross))
    return best


def corner_report(points_xz, min_radius: float, min_deflection_deg: float = 45.0) -> list[dict]:
    """列出轉向 ≥ 門檻、且以相鄰線段長度估計的可用半徑小於 min_radius 的折點。"""
    out = []
    for i in range(1, len(points_xz) - 1):
        a, b, c = points_xz[i - 1], points_xz[i], points_xz[i + 1]
        l1, l2 = math.dist(a, b), math.dist(b, c)
        if l1 < 1e-6 or l2 < 1e-6:
            continue
        cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0])
        dot = (b[0] - a[0]) * (c[0] - b[0]) + (b[1] - a[1]) * (c[1] - b[1])
        deflection = math.degrees(math.atan2(abs(cross), dot))
        if deflection < min_deflection_deg:
            continue
        estimate = min(l1, l2) / math.tan(math.radians(deflection) / 2) if deflection < 179.9 else 0.0
        if estimate < min_radius:
            out.append({'index': i, 'at': P2(*b), 'deflectionDeg': num(deflection, 1), 'radiusEstM': num(estimate, 1)})
    return out


def pitch_report(points_xz, height_at, window: float = 60.0, step: float = 2.0, base: float = 10.0, limit_deg: float = 7.0) -> dict:
    """沿路徑取樣地表高度，回報原始剖面與 window 公尺移動平均剖面中，俯仰角超過 limit 的區段。"""
    samples = resample(points_xz, step)
    raw = [height_at(x, z) for x, z, _ in samples]
    half = max(1, int(round(window / 2 / step)))
    prefix = [0.0]
    for h in raw:
        prefix.append(prefix[-1] + h)
    smooth = []
    for i in range(len(raw)):
        lo, hi = max(0, i - half), min(len(raw), i + half + 1)
        smooth.append((prefix[hi] - prefix[lo]) / (hi - lo))
    k = max(1, int(round(base / step)))

    def runs(heights):
        found, current, peak = [], None, 0.0
        for i in range(len(heights) - k):
            ds = samples[i + k][2] - samples[i][2]
            if ds < 1e-6:
                continue
            deg = math.degrees(math.atan2(heights[i + k] - heights[i], ds))
            peak = max(peak, abs(deg))
            if abs(deg) > limit_deg:
                if current is None:
                    current = {'fromS': num(samples[i][2], 1), 'toS': num(samples[i + k][2], 1), 'at': P2(samples[i][0], samples[i][1]), 'maxDeg': num(deg, 1)}
                else:
                    current['toS'] = num(samples[i + k][2], 1)
                    if abs(deg) > abs(current['maxDeg']):
                        current['maxDeg'], current['at'] = num(deg, 1), P2(samples[i][0], samples[i][1])
            elif current is not None:
                found.append(current)
                current = None
        if current is not None:
            found.append(current)
        return found, num(peak, 1)

    raw_runs, raw_peak = runs(raw)
    smooth_runs, smooth_peak = runs(smooth)
    return {'windowM': window, 'limitDeg': limit_deg, 'maxRawDeg': raw_peak, 'maxSmoothedDeg': smooth_peak, 'raw': raw_runs, 'smoothed': smooth_runs}


# ---------------------------------------------------------------------------------------------------------------------
# 地形：與 src/world/terrain.ts 的 heightAt（三角形插值、平台接縫規則）一致
# ---------------------------------------------------------------------------------------------------------------------
class Terrain:
    def __init__(self, directory: Path = DATA / 'terrain'):
        meta = json.loads((directory / 'terrain.json').read_text(encoding='utf-8'))
        blob = (directory / 'terrain.bin').read_bytes()
        cols, rows = int(meta['cols']), int(meta['rows'])
        if len(blob) != cols * rows * 4:
            raise ValueError(f'terrain.bin 有 {len(blob)} bytes，預期 {cols * rows * 4}')
        if meta.get('sha256') and hashlib.sha256(blob).hexdigest() != meta['sha256']:
            raise ValueError('terrain.bin 的 sha256 與 terrain.json 不符')
        h = array.array('f')
        h.frombytes(blob)
        if sys.byteorder != 'little':
            h.byteswap()
        self.meta, self.h, self.blob = meta, h, blob
        self.cols, self.rows, self.cell = cols, rows, float(meta['cell'])
        self.ox, self.oz = float(meta['origin'][0]), float(meta['origin'][1])
        x0 = z0 = math.inf
        x1 = z1 = -math.inf
        for j in range(rows):
            row = j * cols
            for i in range(cols):
                if h[row + i] == 0.0:
                    x, z = self.ox + i * self.cell, self.oz + j * self.cell
                    x0, x1, z0, z1 = min(x0, x), max(x1, x), min(z0, z), max(z1, z)
        self.pad = (x0, z0, x1, z1)

    @property
    def sea_level(self) -> float:
        return float(self.meta['seaLevel'])

    def vertex(self, i: int, j: int) -> float:
        x, z = self.ox + i * self.cell, self.oz + j * self.cell
        h = self.h[j * self.cols + i]
        if self.pad[0] <= x <= self.pad[2] and self.pad[1] <= z <= self.pad[3]:
            h = max(0.0, h)
        return h + GROUND_Y

    def height_at(self, x: float, z: float) -> float:
        fx = min(max((x - self.ox) / self.cell, 0.0), self.cols - 1.000001)
        fz = min(max((z - self.oz) / self.cell, 0.0), self.rows - 1.000001)
        i, j = int(math.floor(fx)), int(math.floor(fz))
        u, v = fx - i, fz - j
        a, b, c, d = self.vertex(i, j), self.vertex(i + 1, j), self.vertex(i, j + 1), self.vertex(i + 1, j + 1)
        return a * (1 - u - v) + b * u + c * v if u + v <= 1 else b * (1 - v) + c * (1 - u) + d * (u + v - 1)

    def height_digest(self) -> str:
        """runtime Terrain.surfaceVersion 的第一段（高度位元組的 FNV-1a）。"""
        h = 2166136261
        for byte in self.blob:
            h = ((h ^ byte) * 16777619) & 0xFFFFFFFF
        return format(h, 'x')


def load_terrain(warnings: list[str] | None = None):
    try:
        return Terrain()
    except (OSError, ValueError, KeyError) as e:
        message = f'無法載入 public/data/terrain（{e}）；高度改用預設值，請之後重跑'
        if warnings is not None:
            warnings.append(message)
        else:
            warn(message)
        return None


def sea_level_y() -> float:
    """海面是絕對世界高度 terrain.json seaLevel（-0.6），不再加地面偏移。"""
    try:
        return float(json.loads((DATA / 'terrain/terrain.json').read_text(encoding='utf-8'))['seaLevel'])
    except (OSError, ValueError, KeyError):
        return -0.6


# ---------------------------------------------------------------------------------------------------------------------
# 描圖
# ---------------------------------------------------------------------------------------------------------------------
def load_trace(override: str | None = None) -> tuple[dict, Path]:
    path = find_artifact('reference/sports-trace.json', override)
    data = json.loads(path.read_text(encoding='utf-8'))
    if not isinstance(data.get('facilities'), list):
        die(f'{path} 沒有 facilities 陣列')
    return data, path


def facility(trace: dict, fid: str) -> dict:
    for f in trace['facilities']:
        if f.get('id') == fid:
            return f
    die(f'sports-trace.json 沒有設施 {fid}')


def bbox(poly) -> tuple[float, float, float, float]:
    xs, zs = [p[0] for p in poly], [p[1] for p in poly]
    return min(xs), min(zs), max(xs), max(zs)


def pool_levels(poly, terrain) -> tuple[float, float, list]:
    """泳池水面 = 池邊地面 - 0.15 m。池邊地面取池角地表高度的最小值（沒有地形時用 GROUND_Y）。"""
    if terrain is None:
        return GROUND_Y, GROUND_Y - 0.15, []
    samples = [num(terrain.height_at(x, z), 3) for x, z in poly]
    deck = min(samples)
    return num(deck, 3), num(deck - 0.15, 3), samples


# ---------------------------------------------------------------------------------------------------------------------
# 地標的實心碰撞盒（與 tools/v7_npc_solid_audit.py 相同的轉換）
# ---------------------------------------------------------------------------------------------------------------------
def landmark_frame(lid: str) -> tuple[float, float, float]:
    p = json.loads((ROOT / 'public/models/landmarks/placements.json').read_text(encoding='utf-8'))[lid]
    return float(p['centroid'][0]), float(p['centroid'][1]), float(p.get('yaw', 0))


def landmark_to_world(lid: str, x: float, z: float) -> tuple[float, float]:
    cx, cz, yaw = landmark_frame(lid)
    c, s = math.cos(yaw), math.sin(yaw)
    return cx + x * c + z * s, cz - x * s + z * c


def solid_boxes(lid: str) -> list[tuple[float, float, float, float, float]]:
    """(中心 x, 中心 z, 半寬, 半深, yaw)；略過可站上去的、矮於 1.2 m 的、懸空的盒子。"""
    cx, cz, yaw = landmark_frame(lid)
    c, s = math.cos(yaw), math.sin(yaw)
    out = []
    for b in json.loads((ROOT / f'public/models/landmarks/{lid}.collision.json').read_text(encoding='utf-8'))['boxes']:
        if b.get('walkable') or b['size'][1] < 1.2 or b['center'][1] - b['size'][1] / 2 > 1.5:
            continue
        x, _, z = b['center']
        out.append((cx + x * c + z * s, cz - x * s + z * c, b['size'][0] / 2, b['size'][2] / 2, yaw + b.get('yaw', 0)))
    return out


def in_solid(x: float, z: float, boxes, margin: float = 0.5) -> bool:
    for bx, bz, hx, hz, yaw in boxes:
        c, s = math.cos(yaw), math.sin(yaw)
        dx, dz = x - bx, z - bz
        if abs(dx * c - dz * s) < hx + margin and abs(dx * s + dz * c) < hz + margin:
            return True
    return False


@lru_cache(maxsize=1)
def standing_context():
    """Conservative outdoor data check; does not claim Rapier/navmesh acceptance."""
    terrain = Terrain()
    placements = read_json(ROOT / 'public/models/landmarks/placements.json')
    boxes = []
    for lid, p in placements.items():
        if isinstance(p, dict) and 'centroid' in p and not p.get('path') and lid != 'tunnel':
            if (ROOT / f'public/models/landmarks/{lid}.collision.json').exists():
                boxes.extend(solid_boxes(lid))
    structure = read_json(DATA / 'walkthrough/campus-structure.json')
    footprints = []
    for bid, p in structure['placements'].items():
        building = read_json(DATA / f'walkthrough/{bid}.json')
        floor = next((f for f in building['floors'] if f.get('level') == 1), None)
        if not floor:
            continue
        c, s, scale = math.cos(p['rotation']), math.sin(p['rotation']), p['scale']
        footprints.append([[p['x'] + scale*(x*c+z*s), p['z'] + scale*(-x*s+z*c)] for x,z in floor['outline']])
    return terrain, boxes, footprints


def standing_problem(p, margin=0.32):
    terrain, boxes, footprints = standing_context()
    x, y, z = p
    if not in_bounds(x,z):
        return 'PLAY_BOUNDS 外'
    if in_solid(x,z,boxes,margin):
        return '實心碰撞盒內'
    if any(in_poly((x,z), poly) or dist_point_poly((x,z),poly)<margin for poly in footprints):
        return '八館建物輪廓內或過於貼近外牆'
    heights = [terrain.height_at(x+dx,z+dz) for dx,dz in [(0,0),(margin,0),(-margin,0),(0,margin),(0,-margin)]]
    if min(heights) <= terrain.sea_level:
        return '地面低於海平面'
    if abs(y-heights[0]) > 0.2:
        return f'離地 {y-heights[0]:.3f} m'
    if max(heights)-min(heights)>0.5:
        return '站立範圍地表高差超過 0.5 m'
    return None


def distance_to_paths(p, paths):
    return min(dist_point_seg(p, (a[0],a[2]), (b[0],b[2])) for path in paths for a,b in zip(path,path[1:]))


# ---------------------------------------------------------------------------------------------------------------------
# 台詞檢查：每句 ≤28 字、全形標點、不用未核准的敘述
# ---------------------------------------------------------------------------------------------------------------------
HALF_WIDTH_PUNCTUATION = set(',.!?:;()')
BANNED_PHRASES = ['刷卡', '一卡通', '泳帽', '長泳', '第一二道', '第一、二道', '中午健身', '免費時段', '每層都有男女']
_PLACEHOLDER = re.compile(r'\{[A-Za-z]+\}')


def lint_line(text: str, expansions: list[str] | None = None, limit: int = 28) -> list[str]:
    """expansions：把佔位符換成實際字串後的所有版本（沒有佔位符時不用給）。"""
    if not isinstance(text, str) or not text:
        return ['空字串']
    out = []
    for version in expansions or [text]:
        count = len(''.join(version.split()))
        if count > limit:
            out.append(f'超過 {limit} 字（{count}）：{version}')
    plain = _PLACEHOLDER.sub('', text)
    half = sorted({c for c in plain if c in HALF_WIDTH_PUNCTUATION})
    if half:
        out.append(f'含半形標點 {"".join(half)}：{text}')
    for phrase in BANNED_PHRASES:
        if phrase in text:
            out.append(f'含未核准的敘述「{phrase}」：{text}')
    return out


def path_polygon_gap(path, polygon):
    if any(in_poly(p, polygon) for p in path): return 0.0
    gap = float('inf')
    for a, b in zip(path, path[1:]):
        for c, d in zip(polygon, polygon[1:] + polygon[:1]):
            def cross(p, q, r): return (q[0]-p[0])*(r[1]-p[1])-(q[1]-p[1])*(r[0]-p[0])
            if (cross(a,b,c)*cross(a,b,d)<=0 and cross(c,d,a)*cross(c,d,b)<=0
                    and max(min(a[0],b[0]),min(c[0],d[0]))<=min(max(a[0],b[0]),max(c[0],d[0]))
                    and max(min(a[1],b[1]),min(c[1],d[1]))<=min(max(a[1],b[1]),max(c[1],d[1]))): return 0.0
            gap=min(gap,dist_point_seg(a,c,d),dist_point_seg(b,c,d),dist_point_seg(c,a,b),dist_point_seg(d,a,b))
    return gap
