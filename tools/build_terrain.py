#!/usr/bin/env python3
"""Terrain heightfield for the walk world from the MOI 20 m DTM (TWD97/TWVD2001).

Output grid: vertex-centred, `cell` metres, row-major z then x, Float32 LE.
Heights are relative to the science/engineering ground (median DTM under the
SC+EN footprints = 0 = floorY(1)). The walkable pad (convex hull of the 8 placement
footprints +6 m, spawn disc) is exactly 0 and blends to the DTM over
max(12 m, 2.5|h|) with smoothstep.
Below-zero lowland (beach, track, coast road) is compressed so true mean sea
level lands on SEA_LEVEL (-0.6, the existing sea plane); sea cells = SEABED.
Requires pyproj (TWD97 TM2, EPSG:3826).
"""
from __future__ import annotations
import argparse, hashlib, json, math, pathlib, sys
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import numpy as np
from PIL import Image, ImageDraw
from pyproj import Transformer
from scipy import ndimage
from shapely import contains_xy
from shapely.geometry import Polygon, Point, LineString
from shapely.ops import unary_union
import build_campus_structure as B

ROOT = pathlib.Path(__file__).resolve().parents[1]
DEM = ROOT/'data/sources/dem'
STRUCT = ROOT/'public/data/walkthrough/campus-structure.json'
OUT = ROOT/'public/data/terrain'
ART = ROOT/'artifacts/v3/T3'
X0, X1, Z0, Z1, CELL = -900, 900, -1100, 700, 4.0
PAD, BLEND, BLEND_MAX = 6.0, 12.0, 40.0
SPAWN, SPAWN_R = (-69.0, 119.0), 25.0
SEA_LEVEL, SEABED = -0.6, -2.0
DEM_STEP = 20


def load_dem():
    prov = json.loads((DEM/'provenance.json').read_text()); pts = []
    for f in sorted((DEM/'moi-dtm20').glob('*dem.grd')):
        a = np.loadtxt(f); pts.append(a)
        assert hashlib.sha256(f.read_bytes()).hexdigest() == prov['files'][f'moi-dtm20/{f.name}'], f
    a = np.concatenate(pts); e0, n0 = a[:, 0].min(), a[:, 1].min()
    nx, ny = int((a[:, 0].max()-e0)//DEM_STEP)+1, int((a[:, 1].max()-n0)//DEM_STEP)+1
    g = np.full((ny, nx), np.nan); i = ((a[:, 1]-n0)//DEM_STEP).astype(int); j = ((a[:, 0]-e0)//DEM_STEP).astype(int)
    v = a[:, 2]; known = np.isnan(g[i, j]) | (v > -999)  # overlapping sheet edges: keep valid value
    g[i[known], j[known]] = np.where(v[known] > -999, v[known], np.nan)
    return g, e0, n0, prov


def bilinear(g, gi, gj):
    i0 = np.clip(np.floor(gi).astype(int), 0, g.shape[0]-2); j0 = np.clip(np.floor(gj).astype(int), 0, g.shape[1]-2)
    fi, fj = gi-i0, gj-j0
    return (g[i0, j0]*(1-fi)*(1-fj)+g[i0, j0+1]*(1-fi)*fj+g[i0+1, j0]*fi*(1-fj)+g[i0+1, j0+1]*fi*fj)


def footprints(struct):
    return {b: Polygon(B.frame_xy(list(B.floor_outline(b)[2].exterior.coords), p['rotation'], p['scale'], p['x'], p['z'])).buffer(0)
            for b, p in struct['placements'].items()}


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--out', type=pathlib.Path, default=OUT); a = ap.parse_args()
    struct = json.loads(STRUCT.read_text()); fp = footprints(struct)
    g, e0, n0, prov = load_dem(); nodata = np.isnan(g)
    idx = ndimage.distance_transform_edt(nodata, return_distances=False, return_indices=True)
    filled = g[tuple(idx)]
    cols, rows = int((X1-X0)/CELL)+1, int((Z1-Z0)/CELL)+1
    xs, zs = X0+np.arange(cols)*CELL, Z0+np.arange(rows)*CELL; X, Z = np.meshgrid(xs, zs)
    k = 111320*math.cos(math.radians(B.LAT0))
    E, N = Transformer.from_crs(4326, 3826, always_xy=True).transform(B.LON0+X/k, B.LAT0-Z/110574)
    gi, gj = (N-n0)/DEM_STEP, (E-e0)/DEM_STEP
    raw = bilinear(filled, gi, gj); seafrac = bilinear(nodata.astype(float), gi, gj)
    # Datum: median DTM under the SC and EN footprints.
    under = contains_xy(unary_union([fp['SC'], fp['EN']]), X, Z)
    zero = float(np.median(raw[under])); h = raw-zero
    # Sea: DTM no-data (sea/harbour), minus anything on OSM roads or buildings.
    ctx = struct['context']
    landish = unary_union([LineString(pts).buffer(4) for pts, _, _ in B.load_osm()['roads'] if len(pts) > 1]
                          + [Polygon(l['polygon']).buffer(2) for l in ctx['landmarks']+ctx['background']] + list(fp.values()))
    sea = (seafrac > 0.5) & ~contains_xy(landish, X, Z)
    lab, _ = ndimage.label(sea); big = np.bincount(lab.ravel()); keep = np.where(big >= 25)[0]; keep = keep[keep > 0]
    sea = np.isin(lab, keep)  # drop specks
    # Lowland: true MSL (-zero) -> SEA_LEVEL; land never below SEA_LEVEL+0.1.
    low = h < 0; h[low] = h[low]*(-SEA_LEVEL/zero)
    h[~sea] = np.maximum(h[~sea], SEA_LEVEL+0.1); h[sea] = SEABED
    # Pad: exact 0 inside, smoothstep to DTM over BLEND metres.
    # The eight share floorY 0 and the yards between them are walkable, so the
    # pad is their convex hull (+PAD) plus the spawn disc, not eight islands.
    pad = unary_union([unary_union(list(fp.values())).convex_hull.buffer(PAD, join_style=2), Point(SPAWN).buffer(SPAWN_R)])
    inpad = contains_xy(pad, X, Z)
    d = ndimage.distance_transform_edt(~inpad, sampling=CELL)
    # Blend over >= BLEND m, longer where the DTM is far from 0 (EC sits ~24 m up
    # the slope): smoothstep peak gradient 1.5*|h|/L stays <= tan(~31 deg).
    L = ndimage.uniform_filter(np.clip(2.5*ndimage.maximum_filter(np.abs(h), 21), BLEND, BLEND_MAX), 21)
    t = np.clip(d/L, 0, 1); t = t*t*(3-2*t)
    before = h.copy(); h = np.where(inpad, 0.0, h*t).astype(np.float32)
    a.out.mkdir(parents=True, exist_ok=True); blob = h.astype('<f4').tobytes(); (a.out/'terrain.bin').write_bytes(blob)
    meta = dict(origin=[X0, Z0], cell=CELL, cols=cols, rows=rows, layout='Float32 LE, row-major: index = row*cols+col, x = origin[0]+col*cell, z = origin[1]+row*cell (vertex grid)',
                minY=round(float(h.min()), 3), maxY=round(float(h.max()), 3), seaLevel=SEA_LEVEL, seabed=SEABED,
                zeroDatum=dict(twvd2001_m=round(zero, 3), method='median DTM under SC+EN placement footprints'),
                pad=dict(shape='convex hull of the 8 placement footprints + buffer, plus spawn disc', buffer_m=PAD, blend_m=f'clamp(2.5*|h|, {BLEND}, {BLEND_MAX})', spawn=list(SPAWN), spawnRadius=SPAWN_R, height=0.0),
                source=dict(name=prov['title'], dataset=prov['dataset'], url=prov['url'], archiveSha256=prov['archiveSha256'], retrievedAt=prov['retrievedAt'], crs=prov['crs']),
                license=prov['license'], sha256=hashlib.sha256(blob).hexdigest(), bytes=len(blob),
                note=('Relative heights (science/engineering ground = 0). Sea = DTM no-data minus OSM roads/buildings, set to seabed. '
                      f'Lowland below 0 is vertically compressed by {-SEA_LEVEL/zero:.3f} so real sea level sits at seaLevel (true MSL is {-zero:.2f} relative). '
                      'Hills unchanged; the 4 m grid resamples a 20 m DTM (bare earth). Road flattening not applied.'))
    (a.out/'terrain.json').write_text(json.dumps(meta, ensure_ascii=False, indent=1)+'\n')
    # Stats / sanity.
    S = lambda x, z: float(h[int(round((z-Z0)/CELL)), int(round((x-X0)/CELL))])
    R = lambda x, z: float(before[int(round((z-Z0)/CELL)), int(round((x-X0)/CELL))])
    print(f'grid {cols}x{rows} cell {CELL} m, zero = {zero:.2f} m TWVD2001, h [{h.min():.2f}, {h.max():.2f}], sea cells {sea.sum()} ({sea.mean()*100:.1f}%)')
    print('pad cells', int(inpad.sum()), 'max |h| in pad', float(np.abs(h[inpad]).max()))
    yard = inpad & ~contains_xy(unary_union([p.buffer(PAD, join_style=2) for p in fp.values()]+[Point(SPAWN).buffer(SPAWN_R)]), X, Z)
    yb = before[yard]; print(f'hull yard (pad minus footprints+6 m/spawn): {yard.sum()} cells, DTM-rel min {yb.min():.1f} median {np.median(yb):.1f} p90 {np.percentile(yb, 90):.1f} max {yb.max():.1f}')
    ring = (d > L) & (d < L+8); print('ring 12-20 m outside pad: max |h-dtm|', float(np.abs(h[ring]-before[ring]).max()))
    for n, (x, z) in dict(spawn=SPAWN, tunnelW=(19.9, 148.5), tunnelMid=(151, 186), tunnelE=(282.1, 223.1), AD=(-70, 71), IL=(-70, -95),
                           ACTIVITY=(-165, -205), YH=(-121, 187), ME=(-395, -299), MB=(-412, -441), LA=(-570, -916), gate=(-84, 596),
                           beach=(-280, 0), track=(-160, 392), hill=(150, -400)).items():
        print(f'  {n:9s} h={S(x, z):7.2f}  (dtm-rel {R(x, z):7.2f})')
    for b, p in fp.items():
        dem_in = before[contains_xy(p, X, Z)]
        print(f'  pad {b}: DTM under footprint {dem_in.min():6.1f}..{dem_in.max():6.1f} (median {np.median(dem_in):5.1f}) -> forced 0')
    gz, gx = np.gradient(h, CELL); slope = np.degrees(np.arctan(np.hypot(gx, gz)))
    core = contains_xy(pad.buffer(BLEND+20), X, Z) & ~inpad & (d <= L)
    print(f'slope: max {slope.max():.1f} deg overall, {slope[core].max():.1f} deg in the blend band, cells >35 deg {(slope > 35).sum()}')
    # Preview: hillshade + outlines.
    az, alt = math.radians(315), math.radians(45); asp = np.arctan2(-gx, gz); sl = np.arctan(np.hypot(gx, gz))
    hs = np.clip(np.sin(alt)*np.cos(sl)+np.cos(alt)*np.sin(sl)*np.cos(az-asp), 0, 1)
    tint = np.clip((h-h.min())/(h.max()-h.min()+1e-6), 0, 1)
    rgb = np.dstack([0.35+0.5*tint, 0.55+0.3*tint, 0.35+0.2*tint])*hs[..., None]*255
    rgb[sea] = (60, 120, 170)
    im = Image.fromarray(rgb.astype(np.uint8)).resize((cols*2, rows*2)); dr = ImageDraw.Draw(im)
    P = lambda pts: [((x-X0)/CELL*2, (z-Z0)/CELL*2) for x, z in pts]
    for r in ctx['roads']: dr.line(P(r['points']), fill=(255, 150, 0) if r['tunnel'] else (230, 230, 230), width=2 if r['tunnel'] else 1)
    for l in ctx['landmarks']+ctx['background']: dr.polygon(P(l['polygon']), outline=(30, 30, 160))
    for p in fp.values(): dr.polygon(P(list(p.exterior.coords)), outline=(220, 0, 0), width=2)
    for geom in getattr(pad, 'geoms', [pad]): dr.line(P(list(geom.exterior.coords)), fill=(255, 255, 0), width=1)
    for w in ctx['water']: dr.line(P(w['points']), fill=(0, 255, 255), width=1)
    dr.rectangle([0, 0, 640, 18], fill=(0, 0, 0)); dr.text((4, 3), f'terrain {cols}x{rows} @ {CELL} m  h {h.min():.1f}..{h.max():.1f} m  yellow=pad  cyan=OSM coast  red=placements', fill=(255, 255, 255))
    ART.mkdir(parents=True, exist_ok=True); im.save(ART/'terrain-preview.png')
    print('wrote', a.out/'terrain.bin', a.out/'terrain.json', ART/'terrain-preview.png', 'sha256', meta['sha256'])


if __name__ == '__main__':
    main()
