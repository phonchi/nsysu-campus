#!/usr/bin/env python3
"""Align the official NSYSU campus map (pictorial, oblique) to the world frame.

Control points are hand-read ground positions on the 7016x4961 source image
(checked on 1:1 crops with crosses, artifacts/v3/T3/sheet*.png) paired with
OSM / placement centroids in world metres (x east, z south).
Fits similarity and affine image->world, reports per-point and leave-one-out
residuals, then writes alignment.json, corrections.json and overlay.png.
The map is an illustration, not a survey: deltas below ~2x LOO RMS are noise.
"""
from __future__ import annotations
import argparse, hashlib, json, math, pathlib, sys
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from shapely.geometry import Polygon, LineString, Point
import build_campus_structure as B

ROOT = pathlib.Path(__file__).resolve().parents[1]
MAP = ROOT/'data/sources/campus-map/nsysu-campus-map-440826181.jpg'
STRUCT = ROOT/'public/data/walkthrough/campus-structure.json'
OSM = ROOT/'data/sources/osm/osm-nsysu.json'
OUT = ROOT/'artifacts/v3/T3'
FONT = pathlib.Path.home()/'.local/share/fonts/NotoSansCJKtc-Bold.otf'
Image.MAX_IMAGE_PIXELS = None

# (id, label, map px (full-res), world ref, role). role 'fit' enters the final
# transform; 'check' only gets a residual (oblique art makes them ambiguous).
CONTROL = [
    ('AD', '行政大樓', (4250, 2690), ('landmark', 'AD'), 'fit'),
    ('SQUARE', '中庭廣場 (國徽 pavilion)', (3946, 2062), ('osm', '中華民國國徽'), 'fit'),
    ('IL', '圖資大樓', (3835, 1790), ('landmark', 'IL'), 'fit'),
    ('ACTIVITY', '學生活動中心', (3400, 1590), ('landmark', 'ACTIVITY'), 'fit'),
    ('YH', '逸仙館', (4000, 3255), ('landmark', 'YH'), 'fit'),
    ('SPORT', '體育館', (4720, 3150), ('landmark', 'SPORT'), 'fit'),
    ('IR', '國際研究大樓', (4830, 3620), ('landmark', 'IR'), 'fit'),
    ('TRACK', '操場', (4082, 3758), ('sport', 'osm-269874284'), 'fit'),
    ('TENNIS', '網球場', (3646, 3586), ('sport', 'osm-269874288'), 'fit'),
    ('POOL', '游泳池', (3668, 3810), ('sport', 'osm-269874287'), 'fit'),
    ('TUNNEL_W', '西子灣隧道 校園端', (5000, 2850), ('tunnel', 1), 'fit'),
    ('BEACH', '西子灣沙灘會館', (3310, 3174), ('landmark', 'BEACH'), 'fit'),
    ('KINDER', '幼兒園', (3364, 2676), ('landmark', 'KINDER'), 'fit'),
    ('ME', '海工館', (2456, 1224), ('landmark', 'ME'), 'fit'),
    ('MB', '海資館', (2504, 1008), ('landmark', 'MB'), 'fit'),
    ('MA', '海洋科學學院', (2048, 792), ('osm', '海洋科學學院'), 'fit'),
    ('FA', '藝術大樓', (2888, 560), ('osm', '藝術大樓'), 'check'),
    ('TUNNEL_E', '西子灣隧道 哨船街端', (5620, 2830), ('tunnel', 0), 'check'),
    ('EN', '工學院', (4400, 2180), ('placement', 'EN'), 'check'),
    ('SC', '理學院', (4580, 2660), ('placement', 'SC'), 'check'),
    ('EV', '環工大樓', (4700, 1680), ('placement', 'EV'), 'check'),
    ('MS', '材料大樓', (4760, 1840), ('placement', 'MS'), 'check'),
    ('CH', '化學館', (4780, 2080), ('placement', 'CH'), 'check'),
    ('PH', '物理館', (4900, 2200), ('placement', 'PH'), 'check'),
    ('BI', '生科館', (5060, 2320), ('placement', 'BI'), 'check'),
    ('EC', '電資大樓', (4960, 1640), ('placement', 'EC'), 'check'),
]
# Map-only features (no usable OSM polygon); positions come from the transform.
MISSING = [
    ('LA', '文學院 College of Liberal Arts (壽山坡)', (2480, 420)),
    ('GATE', '校門 大門 (蓮海路)', (4500, 4505)),
    ('BEACH_SAND', '西子灣沙灘 (海水浴場)', (2960, 2560)),
    ('SEAWALL', '海堤 / 海堤停車場', (3330, 3430)),
]


def world_refs(struct, osm):
    ctx = struct['context']; refs = {}
    lm = {l['id']: Polygon(l['polygon']).centroid for l in ctx['landmarks']}
    sp = {s['id']: Polygon(s['polygon']).centroid for s in ctx['sport']}
    named, tunnel = {}, None
    for e in osm['elements']:
        t = e.get('tags', {}); g = e.get('geometry')
        if not g: continue
        pts = [B.project(p['lat'], p['lon']) for p in g]
        if 'building' in t and t.get('name') and len(pts) >= 4: named[t['name']] = Polygon(pts).buffer(0)
        if t.get('name') == '西子灣隧道': tunnel = pts
    pl = {b: Polygon(footprint(b, p)) for b, p in struct['placements'].items()}
    def ref(kind, key):
        if kind == 'landmark': c = lm[key]
        elif kind == 'sport': c = sp[key]
        elif kind == 'osm': c = named[key].centroid
        elif kind == 'placement': c = pl[key].centroid
        elif kind == 'tunnel': return tunnel[0] if key == 0 else tunnel[-1]
        return (c.x, c.y)
    return ref, pl, named, tunnel


def footprint(b, p):
    _, _, poly = B.floor_outline(b)
    return B.frame_xy(list(poly.exterior.coords), p['rotation'], p['scale'], p['x'], p['z'])


def fit(src, dst, kind):
    src, dst = np.asarray(src, float), np.asarray(dst, float)
    if kind == 'affine':
        A = np.c_[src, np.ones(len(src))]
        M, *_ = np.linalg.lstsq(A, dst, rcond=None)
        return M.T  # 2x3
    # Similarity via complex least squares: w = a*z + b
    z = src[:, 0]+1j*src[:, 1]; w = dst[:, 0]+1j*dst[:, 1]
    A = np.c_[z, np.ones(len(z))]; (a, b), *_ = np.linalg.lstsq(A, w, rcond=None)
    return np.array([[a.real, -a.imag, b.real], [a.imag, a.real, b.imag]])


def mls(src, dst, q, sigma, skip=None):
    """Moving-least-squares affine: Gaussian-weighted fit around query q."""
    src, dst = np.asarray(src, float), np.asarray(dst, float); q = np.asarray(q, float)
    keep = [i for i in range(len(src)) if i != skip]; s, d = src[keep], dst[keep]
    w = np.exp(-np.sum((s-q)**2, 1)/(2*sigma**2))+1e-4; sw = np.sqrt(w)[:, None]
    A = np.c_[s, np.ones(len(s))]; M, *_ = np.linalg.lstsq(A*sw, d*sw, rcond=None)
    return np.r_[q, 1] @ M


def apply(M, pts):
    pts = np.asarray(pts, float).reshape(-1, 2)
    return pts @ M[:, :2].T + M[:, 2]


def inverse(M):
    L = np.linalg.inv(M[:, :2]); return np.c_[L, -L @ M[:, 2]]


def describe(M):
    L = M[:, :2]; U, s, Vt = np.linalg.svd(L)
    # Image north = -y; world north = -z. Rotation of image up-vector in world.
    up = L @ np.array([0, -1.0]); east = L @ np.array([1.0, 0])
    return dict(metresPerPixel=[round(float(v), 5) for v in s],
                anisotropy=round(float(s[0]/s[1]), 3),
                imageUpBearingDeg=round(math.degrees(math.atan2(up[0], -up[1])), 1),
                imageRightBearingDeg=round(math.degrees(math.atan2(east[0], -east[1])), 1),
                skewDeg=round(90-math.degrees(math.acos(np.dot(up, east)/np.linalg.norm(up)/np.linalg.norm(east))), 1))


def evaluate(rows, kind):  # global fits, reported for reference
    fitrows = [r for r in rows if r['role'] == 'fit']
    M = fit([r['px'] for r in fitrows], [r['world'] for r in fitrows], kind)
    for r in rows:
        if r['role'] == 'fit':
            others = [o for o in fitrows if o is not r]
            Ml = fit([o['px'] for o in others], [o['world'] for o in others], kind)
        else: Ml = M
        p, pl = apply(M, r['px'])[0], apply(Ml, r['px'])[0]
        r[kind] = dict(pred=[round(float(v), 1) for v in p], resid=round(float(np.hypot(*(p-r['world']))), 1),
                       loo=[round(float(v), 1) for v in pl], looResid=round(float(np.hypot(*(pl-r['world']))), 1))
    rms = lambda key: round(float(np.sqrt(np.mean([r[kind][key]**2 for r in fitrows]))), 1)
    return M, dict(rms=rms('resid'), looRms=rms('looResid'),
                   checkRms=round(float(np.sqrt(np.mean([r[kind]['resid']**2 for r in rows if r['role'] == 'check']))), 1))


def overlay(img, toI, struct, named, pl, rows, missing, path, how):
    im = img.convert('RGB'); scale = 0.5
    im = im.resize((int(im.width*scale), int(im.height*scale))); dr = ImageDraw.Draw(im, 'RGBA')
    F = ImageFont.truetype(str(FONT), 22) if FONT.exists() else None
    P = lambda pts: [tuple(float(c)*scale for c in toI(q)) for q in pts]
    ctx = struct['context']
    for r in ctx['roads']:
        dr.line(P(r['points']), fill=(255, 140, 0, 230) if r['tunnel'] else (40, 40, 40, 150), width=9 if r['tunnel'] else 4)
    for w in ctx['water']:
        dr.line(P(w['points']), fill=(0, 90, 255, 230), width=6)
    for b in ctx['background']:
        dr.polygon(P(b['polygon']), outline=(0, 0, 180, 230), width=3)
    for n, poly in named.items():
        dr.polygon(P(list(poly.exterior.coords)), outline=(0, 0, 255, 255), width=4)
    for l in ctx['landmarks']:
        dr.polygon(P(l['polygon']), outline=(0, 0, 255, 255), fill=(0, 0, 255, 60), width=5)
    for b, poly in pl.items():
        dr.polygon(P(list(poly.exterior.coords)), outline=(230, 0, 0, 255), fill=(230, 0, 0, 70), width=5)
    for r in rows:  # cross = map pick, circle = world truth projected
        x, y = r['px'][0]*scale, r['px'][1]*scale; (wx, wy), = P([r['world']])
        col = (255, 0, 255, 255) if r['role'] == 'fit' else (0, 160, 160, 255)
        dr.line([(x-10, y), (x+10, y)], fill=col, width=3); dr.line([(x, y-10), (x, y+10)], fill=col, width=3)
        dr.ellipse([wx-7, wy-7, wx+7, wy+7], outline=col, width=3); dr.line([(x, y), (wx, wy)], fill=col, width=2)
        if F: dr.text((x+8, y+4), r['id'], fill=col, font=F)
    for m in missing:
        x, y = m['px'][0]*scale, m['px'][1]*scale
        dr.rectangle([x-9, y-9, x+9, y+9], outline=(255, 220, 0, 255), width=4)
        if F: dr.text((x+12, y-10), m['id'], fill=(120, 60, 0, 255), font=F)
    if F:
        dr.rectangle([20, 20, 1180, 150], fill=(255, 255, 255, 220))
        dr.text((30, 28), 'Blue: OSM buildings/landmarks  Red: walkable placements  Grey: OSM roads  Orange: tunnel  Blue line: coast', fill=(0, 0, 0), font=F)
        dr.text((30, 62), 'Magenta +: fit control pick, o: its world position; teal: check points; yellow box: map-only landmark', fill=(0, 0, 0), font=F)
        dr.text((30, 96), f'World drawn onto the map via {how}. Map is pictorial/oblique.', fill=(0, 0, 0), font=F)
    im.save(path)


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--out', type=pathlib.Path, default=OUT); a = ap.parse_args()
    a.out.mkdir(parents=True, exist_ok=True)
    raw = MAP.read_bytes(); img = Image.open(MAP); img.load()
    struct = json.loads(STRUCT.read_text()); osm = json.loads(OSM.read_text())
    ref, pl, named, tunnel = world_refs(struct, osm)
    rows = [dict(id=i, label=l, px=list(px), world=[round(v, 2) for v in ref(*w)], ref=list(w), role=role) for i, l, px, w, role in CONTROL]
    fits = {}
    for kind in ('similarity', 'affine'):
        M, stats = evaluate(rows, kind); fits[kind] = dict(matrix=M.round(6).tolist(), **stats, **describe(M))
        print(f'{kind:10s} RMS {stats["rms"]:6.1f} m  LOO-RMS {stats["looRms"]:6.1f} m  check-RMS {stats["checkRms"]:6.1f} m  {describe(M)}')
    # Local (MLS) fit absorbs the map's non-uniform drawing scale; sigma by LOO.
    fr = [r for r in rows if r['role'] == 'fit']; S, D = [r['px'] for r in fr], [r['world'] for r in fr]
    best = None
    for sig in (250, 350, 500, 700, 1000, 1500, 2500):
        e = [np.hypot(*(mls(S, D, r['px'], sig, skip=i)-r['world'])) for i, r in enumerate(fr)]
        rm = float(np.sqrt(np.mean(np.square(e)))); print(f'mls sigma {sig:5d}px LOO-RMS {rm:6.1f} m')
        if best is None or rm < best[1]: best = (sig, rm)
    sig = best[0]
    for i, r in enumerate(rows):
        j = fr.index(r) if r in fr else None
        p = mls(S, D, r['px'], sig, skip=j); r['mls'] = dict(loo=[round(float(v), 1) for v in p], looResid=round(float(np.hypot(*(p-r['world']))), 1))
    fits['mls'] = dict(sigmaPx=sig, looRms=round(best[1], 1),
                       checkRms=round(float(np.sqrt(np.mean([r['mls']['looResid']**2 for r in rows if r['role'] == 'check']))), 1))
    print(f"mls chosen sigma {sig}px  LOO-RMS {best[1]:.1f} m  check-RMS {fits['mls']['checkRms']} m")
    toW = lambda px: mls(S, D, px, sig); toI = lambda w: mls(D, S, w, sig*0.24)
    # Affine is adopted only when it materially beats similarity out-of-sample.
    chosen = 'affine' if fits['affine']['looRms'] < 0.85*fits['similarity']['looRms'] else 'similarity'
    M = np.array(fits[chosen]['matrix']); Minv = inverse(M); thr = max(8.0, 2*fits['mls']['looRms'])
    print(f'{"id":10s} {"role":5s} {"sim":>6s} {"aff":>6s} {"affLOO":>7s} {"mlsLOO":>7s}')
    for r in rows: print(f'{r["id"]:10s} {r["role"]:5s} {r["similarity"]["resid"]:6.1f} {r["affine"]["resid"]:6.1f} {r["affine"]["looResid"]:7.1f} {r["mls"]["looResid"]:7.1f}')
    align = dict(source=dict(file=str(MAP.relative_to(ROOT)), sha256=hashlib.sha256(raw).hexdigest(), pixels=list(img.size)),
                 frame='world metres, x east, z south; pixel (u right, v down) of the full-res image',
                 used='mls (local, see fits.mls; corrections/missing use it)', globalChosen=chosen, imageToWorld=fits[chosen]['matrix'], worldToImage=Minv.round(8).tolist(), fits=fits,
                 controlPoints=rows,
                 note='Official map is a pictorial oblique illustration with non-uniform local scale (peripheral areas compressed, tunnel drawn ~1/3 length). '
                      'Treat residuals as map distortion, not OSM error, unless they exceed the significance threshold.')
    (a.out/'alignment.json').write_text(json.dumps(align, ensure_ascii=False, indent=1)+'\n')
    corr = []
    for r in rows:
        if r['ref'][0] not in ('landmark', 'placement', 'osm'): continue
        c = r['mls']['loo']; dx, dz = c[0]-r['world'][0], c[1]-r['world'][1]; dm = math.hypot(dx, dz)
        corr.append(dict(id=r['id'], label=r['label'], kind=r['ref'][0], role=r['role'], current_centroid_world=r['world'], map_centroid_world=c,
                         delta=[round(dx, 1), round(dz, 1)], delta_m=round(dm, 1), over8m=dm > 8, significant=dm > thr))
    corr.sort(key=lambda c: -c['delta_m'])
    lianhai = [LineString(r['points']) for r in struct['context']['roads'] if r.get('name') == '蓮海路']
    missing = []
    for i, l, px in MISSING:
        w = toW(px); m = dict(id=i, label=l, px=list(px), map_world=[round(float(v), 1) for v in w], source=f'official map via local MLS affine (sigma {sig}px)')
        missing.append(m)
    # Prefer OSM geometry where OSM has the feature; the map position only locates it.
    fa = named['藝術大樓'].centroid
    for m in missing:
        if m['id'] == 'LA':
            fpx = np.array(next(r['px'] for r in rows if r['id'] == 'FA'), float); h = 50.0
            J = np.c_[(toW(fpx+[h, 0])-toW(fpx-[h, 0]))/(2*h), (toW(fpx+[0, h])-toW(fpx-[0, h]))/(2*h)]
            w = np.array([fa.x, fa.y])+J @ (np.array(m['px'], float)-fpx)
            m['world'] = [round(float(v), 1) for v in w]; m['uncertainty_m'] = 60
            m['note'] = ('Not in the OSM extract (bbox ends z≈-829). world = OSM 藝術大樓 centroid + local map Jacobian x (LA-FA pixel offset); the raw map_world extrapolation is off by the FA check residual. '
                         f'Offset-from-FA estimate: FA OSM ({fa.x:.0f},{fa.y:.0f}).')
        elif m['id'] == 'GATE':
            p = Point(m['map_world']); best = min(lianhai, key=lambda s: s.distance(p)); q = best.interpolate(best.project(p))
            m['world'] = [round(q.x, 1), round(q.y, 1)]; m['uncertainty_m'] = 40
            m['note'] = '大門 on 蓮海路 where it meets the harbour shore; map pick snapped to nearest OSM 蓮海路 vertex line.'
        elif m['id'] == 'BEACH_SAND':
            m['world'] = m['map_world']; m['uncertainty_m'] = 30
            m['note'] = 'Only OSM natural=beach in the extract lies at z>1140 (not 西子灣); position from map, between OSM coastline and 蓮海路.'
        elif m['id'] == 'SEAWALL':
            dike = [LineString(r['points']) for r in struct['context']['roads'] if r.get('name') == '中山大學海堤道路']
            p = Point(m['map_world']); best = min(dike, key=lambda s: s.distance(p)) if dike else None
            if best:
                q = best.interpolate(best.project(p)); m['world'] = [round(q.x, 1), round(q.y, 1)]
                m['line'] = [[round(x, 1), round(z, 1)] for x, z in best.coords]
                m['note'] = 'Snapped to OSM 中山大學海堤道路 (service road on the seawall); sunset view spot along this line.'
            else: m['world'] = m['map_world']
            m['uncertainty_m'] = 25
    t0, t1 = tunnel[-1], tunnel[0]
    missing.append(dict(id='TUNNEL_W', label='西子灣隧道 校園端口', world=[round(t0[0], 1), round(t0[1], 1)], source='OSM way 25822227 end', uncertainty_m=5))
    missing.append(dict(id='TUNNEL_E', label='西子灣隧道 哨船街端口', world=[round(t1[0], 1), round(t1[1], 1)], source='OSM way 25822227 start', uncertainty_m=5))
    for n, key in (('海洋科學學院', 'MA'), ('藝術大樓', 'FA')):
        c = named[n].centroid
        missing.append(dict(id=key, label=n, world=[round(c.x, 1), round(c.y, 1)], polygon=[[round(x, 1), round(z, 1)] for x, z in named[n].exterior.coords][:-1],
                            source='OSM named building, absent from context.landmarks', uncertainty_m=3))
    mapOnly = ['醫學院 / 西灣學院 (share 圖資 block on map)', '綜合大樓 General Building', '學生宿舍 武嶺 / 翠亨 / H/L 棟', '教職員工宿舍',
               '360藝文空間', '西子灣海域中心', '半導體及重點科技研究學院', '中山社會實踐基地', '溜冰場', '西子樓校友會館']
    (a.out/'corrections.json').write_text(json.dumps(dict(
        transform=f'local MLS affine, sigma {sig}px', looRms=fits['mls']['looRms'], significanceThreshold_m=round(thr, 1),
        note='map_centroid_world = leave-one-out transform of the map pick (fit points) or the full fit (check points). '
             'delta_m below significanceThreshold_m is within the map\'s own drawing distortion; OSM is the better position source there.',
        corrections=corr, missing=missing, mapLabelledWithoutNamedOSM=mapOnly), ensure_ascii=False, indent=1)+'\n')
    print('\ncorrections (> 8 m):')
    for c in corr:
        if c['over8m']: print(f"  {c['id']:8s} {c['delta_m']:6.1f} m  d={c['delta']}  {'SIGNIFICANT' if c['significant'] else 'within map noise'}")
    print('missing:'); [print('  ', m['id'], m['world'], m.get('map_world')) for m in missing]
    overlay(img, toI, struct, named, pl, rows, missing[:4], a.out/'overlay.png', f'local MLS affine world->image (sigma {sig*0.24:.0f} m)')
    overlay(img, lambda q: apply(Minv, q)[0], struct, named, pl, rows, missing[:4], a.out/'overlay-global.png', f'global {chosen} inverse')
    print('wrote', a.out/'alignment.json', a.out/'corrections.json', a.out/'overlay.png', a.out/'overlay-global.png')


if __name__ == '__main__':
    main()
