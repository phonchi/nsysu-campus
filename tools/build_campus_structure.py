#!/usr/bin/env python3
"""Campus-level structure shared by the walk world, access planner and baker.

Inputs never change: the eight registered building JSONs stay byte-identical.
This tool derives, from OpenStreetMap footprints (ODbL) and the official plans:
  * placements  - per-building world frame (rotation, uniform horizontal scale,
                  translation) fitted to OSM footprints instead of guessed widths;
  * stairCores  - interior switch-back stairs located on the plans' teal stair
                  symbols, grouped across storeys (schematic geometry);
  * lifts       - lift cars from mapped vertical services or a stair-adjacent
                  schematic position;
  * context     - OSM landmark footprints, roads, coast and sports surfaces.
World axes: x east, z south (north is -z), metres, origin at LAT0/LON0.
"""
from __future__ import annotations
import argparse, hashlib, json, math, pathlib, sys
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import numpy as np, cv2
from PIL import Image
from scipy.optimize import minimize
from shapely.geometry import Polygon, Point, LineString, box
from shapely.ops import unary_union
from shapely import affinity

ROOT = pathlib.Path(__file__).resolve().parents[1]
DATA = ROOT/'public/data/walkthrough'
OSM = ROOT/'data/sources/osm/osm-nsysu.json'
BIDS = ['SC','EN','BI','PH','CH','EC','MS','EV']
LAT0, LON0 = 22.6265, 120.2665
FLOOR_HEIGHT = 3.7
GALLERY = 1.4
APRON = 1.6
MAXLEVEL = lambda b: max(f['level'] for f in b['floors'] if f['level'] != 99)

# Joint groups: one OSM footprint (or union) is shared by several plan sets.
GROUPS = [
    (['EN','SC'], ['理工學院']),  # north -> south
    (['CH','PH','BI'], ['化學館','物理館','生科館']),
    (['EC'], ['電資大樓']),
    (['MS'], ['材料大樓']),
    (['EV'], ['理工大樓']),
]
# Intentional physical joins: these pairs may touch and share galleries.
JOINS = [('SC','EN'), ('CH','PH'), ('PH','BI')]

LANDMARKS = {  # OSM name -> (id, label, storeys, colour hint, interior?)
    '社會科學與管理學院': ('CMSS','管理學院・社會科學院',4,'brick'),
    '行政大樓': ('AD','行政大樓',7,'cream'),
    '圖資大樓': ('IL','圖資大樓',12,'cream'),
    '學生活動中心': ('ACTIVITY','學生活動中心',6,'brick'),
    '逸仙館': ('YH','逸仙館',3,'brick'),
    '中山大學體育館': ('SPORT','體育館',4,'cream'),
    '國際研究大樓': ('IR','國際研究大樓',6,'brick'),
    '西子灣沙灘會館': ('BEACH','西子灣沙灘會館',3,'white'),
    '蔣介石行館（蔣公行館）西灣藝廊': ('GALLERY','西灣藝廊',2,'white'),
    '國立中山大學附設高雄市私立幼兒園': ('KINDER','幼兒園',2,'cream'),
    '中山貨櫃創業基地': ('STARTUP','中山貨櫃創業基地',2,'container'),
    '海工館 & 通識中心': ('ME','海工館',5,'brick'),
    '海洋科學學院': ('MA','海洋科學學院',5,'brick'),
    '海洋資源館': ('MB','海資館',5,'brick'),
    '藝術大樓': ('FA','藝術大樓',4,'brick'),
    '電資大樓': None, '理工學院': None, '理工大樓': None, '材料大樓': None,
    '化學館': None, '物理館': None, '生科館': None, '中華民國國徽': None,
}


def project(lat, lon):
    return ((lon-LON0)*111320*math.cos(math.radians(LAT0)), -(lat-LAT0)*110574)


def load_osm():
    raw = OSM.read_bytes(); d = json.loads(raw)
    named, others, roads, coast, leisure = {}, [], [], [], []
    for e in d['elements']:
        if 'geometry' not in e: continue
        t = e.get('tags', {}); pts = [project(g['lat'], g['lon']) for g in e['geometry']]
        if 'building' in t and len(pts) >= 4:
            poly = Polygon(pts).buffer(0)
            if poly.is_empty or poly.area < 8: continue
            n = t.get('name')
            if n: named.setdefault(n, []).append((poly, t, e['id']))
            else: others.append((poly, t, e['id']))
        elif 'highway' in t and len(pts) >= 2:
            roads.append((pts, t, e['id']))
        elif t.get('natural') in ('coastline','beach','water'):
            coast.append((pts, t, e['id']))
        elif 'leisure' in t and len(pts) >= 4:
            leisure.append((pts, t, e['id']))
    return dict(named=named, others=others, roads=roads, coast=coast, leisure=leisure,
                sha=hashlib.sha256(raw).hexdigest(), base=d['osm3s']['timestamp_osm_base'])


def floor_outline(bid):
    b = json.loads((DATA/f'{bid}.json').read_text())
    f = next(f for f in b['floors'] if f['level'] == 1)
    return b, f, Polygon(f['outline']).buffer(0)


def frame_xy(points, r, s, tx, tz):
    """Same convention as three.js Matrix4 T*Ry(r)*S(s,1,s)."""
    c, n = math.cos(r), math.sin(r); out = []
    for x, z in points:
        x, z = x*s, z*s
        out.append((x*c + z*n + tx, -x*n + z*c + tz))
    return out


def frame_poly(poly, p):
    r, s, tx, tz = p
    return Polygon(frame_xy(list(poly.exterior.coords), r, s, tx, tz)).buffer(0)


def split_north_south(target, bids, outlines):
    """Assign a shared footprint north->south in the order given, by plan area."""
    minx, minz, maxx, maxz = target.bounds; areas = [p.area for p in outlines]; total = sum(areas)
    owns, start = {}, minz
    for i, bid in enumerate(bids):
        if i == len(bids)-1: end = maxz
        else:
            want = target.area*sum(areas[:i+1])/total; lo, hi = start, maxz
            for _ in range(50):
                mid = (lo+hi)/2
                if target.intersection(box(minx-1, minz-1, maxx+1, mid)).area < want: lo = mid
                else: hi = mid
            end = (lo+hi)/2
        owns[bid] = target.intersection(box(minx-1, start, maxx+1, end)); start = end
    return owns


def fit_group(bids, target, owns):
    outlines = [floor_outline(b)[2] for b in bids]
    tarea = target.area

    def place(params):
        return [frame_poly(poly, (params[0], params[1+i*3], params[2+i*3], params[3+i*3])) for i, poly in enumerate(outlines)]

    def score(params):
        polys = place(params)
        u = unary_union(polys)
        iou = u.intersection(target).area/max(u.union(target).area, 1e-6)
        own = np.mean([p.intersection(owns[b]).area/max(p.union(owns[b]).area, 1e-6) for p, b in zip(polys, bids)])
        overlap = sum(polys[i].intersection(polys[j]).area for i in range(len(polys)) for j in range(i+1, len(polys)))
        return -(iou + .6*own - 1.5*overlap/tarea)

    best = None
    for deg in range(0, 360, 5):
        r = math.radians(deg); params = [r]
        for poly, bid in zip(outlines, bids):
            s0 = math.sqrt(owns[bid].area/max(poly.area, 1)); tmp = frame_poly(poly, (r, s0, 0, 0)); c = owns[bid].centroid
            params += [s0, c.x - tmp.centroid.x, c.y - tmp.centroid.y]
        v = score(params)
        if best is None or v < best[0]: best = (v, params)
    res = minimize(score, best[1], method='Nelder-Mead', options=dict(maxiter=6000, xatol=1e-4, fatol=1e-6, adaptive=True))
    params = list(res.x)
    return {bid: dict(rotation=params[0] % (2*math.pi), scale=params[1+i*3], x=params[2+i*3], z=params[3+i*3]) for i, bid in enumerate(bids)}, -res.fun


def fit_all(osm):
    placements = {}; fits = []
    for bids, names in GROUPS:
        target = unary_union([p for n in names for p, _, _ in osm['named'][n]])
        if len(names) == len(bids): owns = {b: unary_union([p for p, _, _ in osm['named'][n]]) for b, n in zip(bids, names)}
        else: owns = split_north_south(target, bids, [floor_outline(b)[2] for b in bids])
        placed, value = fit_group(bids, target, owns)
        polys = [frame_poly(floor_outline(b)[2], (placed[b]['rotation'], placed[b]['scale'], placed[b]['x'], placed[b]['z'])) for b in bids]
        u = unary_union(polys); iou = u.intersection(target).area/u.union(target).area
        for b in bids:
            # Plans were drawn for people: never shrink below 1:1 or narrow plan corridors stop
            # admitting the walking capsule. Keep the fitted centre when clamping.
            if placed[b]['scale'] < 1.0:
                p0 = frame_poly(floor_outline(b)[2], (placed[b]['rotation'], placed[b]['scale'], placed[b]['x'], placed[b]['z'])).centroid
                placed[b]['fittedScale'] = round(placed[b]['scale'], 4); placed[b]['scale'] = 1.0
                p1 = frame_poly(floor_outline(b)[2], (placed[b]['rotation'], 1.0, placed[b]['x'], placed[b]['z'])).centroid
                placed[b]['x'] += p0.x-p1.x; placed[b]['z'] += p0.y-p1.y
        polys = [frame_poly(floor_outline(b)[2], (placed[b]['rotation'], placed[b]['scale'], placed[b]['x'], placed[b]['z'])) for b in bids]
        u = unary_union(polys); iou = u.intersection(target).area/u.union(target).area
        for b, poly in zip(bids, polys):
            placed[b].update(basis='schematic', method='OSM footprint IoU fit of the registered 1F outline', group=bids, osm=names, groupIoU=round(iou, 4),
                             ownIoU=round(poly.intersection(owns[b]).area/poly.union(owns[b]).area, 4))
        placements.update(placed); fits.append(dict(buildings=bids, osm=names, iou=round(iou, 4), objective=round(float(value), 4)))
    return placements, fits


# ---------------------------------------------------------------- separation
SEP_GROUPS = [['EN', 'SC'], ['CH', 'PH', 'BI'], ['EC'], ['MS'], ['EV']]


def storey_shapes(bid):
    d = json.loads((DATA/f'{bid}.json').read_text()); m = MAXLEVEL(d); out = {}
    for f in d['floors']:
        if len(f['outline']) < 3: continue
        o = Polygon(f['outline']).buffer(0)
        out[storey_of(f, m)] = (list(o.exterior.coords)[:-1], list(Polygon(o.exterior).buffer(GALLERY, join_style=3).exterior.coords)[:-1])
    return out


def separate(placements):
    """Upper plans differ from 1F: push buildings apart until no storey collides.
    Joined pairs may share galleries but never interiors; others keep 0.6 m between galleries."""
    shapes = {b: storey_shapes(b) for b in BIDS}; moves = {b: [0.0, 0.0] for b in BIDS}
    def poly(b, st, gallery, dx=0, dz=0):
        pl = dict(placements[b]); pl['x'] += dx; pl['z'] += dz
        return world_poly(shapes[b][st][1 if gallery else 0], pl)
    def clash(a, b, da=(0, 0), db=(0, 0)):
        joined = (a, b) in JOINS or (b, a) in JOINS; total = 0
        for st in set(shapes[a]) & set(shapes[b]):
            if joined: total += poly(a, st, False, *da).buffer(-.05).intersection(poly(b, st, False, *db)).area
            else: total += poly(a, st, True, *da).buffer(.6).intersection(poly(b, st, True, *db)).area
        return total
    def shift(members, dx, dz):
        for m in members: placements[m]['x'] += dx; placements[m]['z'] += dz; moves[m][0] += dx; moves[m][1] += dz
    # 1. inside joined groups: push later members along the chain direction.
    for group in SEP_GROUPS:
        for i in range(1, len(group)):
            a, b = group[i-1], group[i]
            ca = Polygon(frame_xy(shapes[a][1][0], **{k: placements[a][k] for k in ('rotation', 'scale')}, tx=placements[a]['x'], tz=placements[a]['z'])).centroid if False else world_poly(shapes[a][1][0], placements[a]).centroid
            cb = world_poly(shapes[b][1][0], placements[b]).centroid
            d = math.dist((ca.x, ca.y), (cb.x, cb.y)) or 1; ux, uz = (cb.x-ca.x)/d, (cb.y-ca.y)/d; step = 0
            while clash(a, b) > .5 and step < 80:
                shift(group[i:], ux*.25, uz*.25); step += 1
    # 2. between groups: move each non-fixed group by the smallest clear offset.
    dirs = [(math.cos(t), math.sin(t)) for t in np.radians(np.arange(0, 360, 22.5))]
    for _ in range(4):
        moved = False
        for gi, group in enumerate(SEP_GROUPS[1:], 1):
            others = [b for g in SEP_GROUPS if g is not group for b in g]
            def bad(dx, dz): return sum(clash(m, o, (dx, dz), (0, 0)) for m in group for o in others)
            if bad(0, 0) < .01: continue
            best = None
            for ux, uz in dirs:
                for k in range(1, 161):
                    if best is not None and k >= best[0]: break
                    if bad(ux*.25*k, uz*.25*k) < .01:
                        best = (k, ux, uz); break
            if best: shift(group, best[1]*.25*best[0], best[2]*.25*best[0]); moved = True
        if not moved: break
    for b in BIDS:
        placements[b]['separationShift'] = [round(v, 3) for v in moves[b]]
    remaining = {f'{a}-{b}': round(clash(a, b), 2) for a, b in __import__('itertools').combinations(BIDS, 2) if clash(a, b) > .01}
    return remaining


# ---------------------------------------------------------------- stair cores
def teal_components(f):
    im = Image.open(ROOT/'public'/f['imageUrl'].lstrip('/')).convert('RGB'); a = np.asarray(im).astype(float)
    r, g, b = a[:, :, 0], a[:, :, 1], a[:, :, 2]
    mask = ((g > r+16) & (b > r+10) & (g > b-14) & (g < 225)).astype('uint8')*255
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((7, 7), np.uint8))
    n, lab, st, _ = cv2.connectedComponentsWithStats(mask, 8)
    t = f['transform']; s = t['metresPerPixel']; ox, oy = t['imageOriginPixels']; out = []
    for i in range(1, n):
        if st[i, cv2.CC_STAT_AREA] < max(70, im.width*im.height*.0008): continue
        ys, xs = np.nonzero(lab == i)
        rect = cv2.minAreaRect(np.stack([xs, ys], 1).astype(np.float32))
        corners = [((x-ox)*s, (y-oy)*s) for x, y in cv2.boxPoints(rect)]
        poly = Polygon(corners)
        e = [math.dist(corners[0], corners[1]), math.dist(corners[1], corners[2])]
        long_i = 0 if e[0] >= e[1] else 1
        p0, p1 = corners[long_i], corners[long_i+1]
        angle = math.atan2(p1[1]-p0[1], p1[0]-p0[0])
        length, width = max(e), min(e)
        if length > 9.5 or width < 1.5 or length/width > 3.2: continue  # balconies, hatched strips
        out.append(dict(center=(poly.centroid.x, poly.centroid.y), angle=angle, length=length, width=width, poly=poly))
    return out


def room_union(f):
    polys = []
    for r in f.get('rooms', []):
        p = Polygon(r['polygon'])
        if p.is_valid and p.area > .5: polys.append(p)
    return unary_union(polys) if polys else Polygon()


def core_rect(c, length, width, angle):
    ux, uz = math.cos(angle), math.sin(angle); vx, vz = -uz, ux
    cx, cz = c; hl, hw = length/2, width/2
    return Polygon([(cx-ux*hl-vx*hw, cz-uz*hl-vz*hw), (cx+ux*hl-vx*hw, cz+uz*hl-vz*hw),
                    (cx+ux*hl+vx*hw, cz+uz*hl+vz*hw), (cx-ux*hl+vx*hw, cz-uz*hl+vz*hw)])


def storey_of(f, maxlevel):
    return f.get('storeyIndex') or (maxlevel+1 if f['level'] == 99 else f['level'])


def walk_outline(f):
    return Polygon(Polygon(f['outline']).exterior).buffer(GALLERY, join_style=3)


def candidate_cores(floors):
    found = {f['id']: (teal_components(f) if f.get('imageUrl') and f['level'] not in (-1, 99) else []) for f in floors}
    clusters = []
    for f in floors:
        for c in found[f['id']]:
            home = next((k for k in clusters if Point(c['center']).distance(Point(k['center'])) < 3.2), None)
            if home is None:
                home = dict(center=c['center'], hits=[]); clusters.append(home)
            home['hits'].append((f, c))
            home['center'] = (float(np.median([h[1]['center'][0] for h in home['hits']])), float(np.median([h[1]['center'][1] for h in home['hits']])))
    out = []
    for k in clusters:
        hits = [h[1] for h in k['hits']]
        out.append(dict(center=k['center'], detected=sorted({h[0]['level'] for h in k['hits']}),
                        length=max(4.6, float(np.median([h['length'] for h in hits]))),
                        width=max(2.5, float(np.median([h['width'] for h in hits]))),
                        angle=float(np.median([math.atan2(math.sin(2*h['angle']), math.cos(2*h['angle']))/2 for h in hits]))))
    return out


def apron_of(center, length, width, ang, depth=APRON):
    ux, uz = math.cos(ang), math.sin(ang)
    return core_rect((center[0]-ux*(length/2+depth/2), center[1]-uz*(length/2+depth/2)), depth, width, ang)


class FloorState:
    """Rooms after vertical-circulation clipping plus everything blocking a floor."""
    def __init__(self, f):
        self.f = f; self.walk = walk_outline(f).difference(unary_union([Polygon(h).buffer(0) for h in f.get('holes', []) if len(h) >= 3] or [Polygon()]))
        self.rooms = {}
        for r in f.get('rooms', []):
            poly = Polygon(r['polygon']).buffer(0)
            if poly.is_valid and poly.area > .02: self.rooms[r['id']] = poly
        self.original = dict(self.rooms)
        self.verticals = [Polygon(v['polygon']).buffer(0) for v in f.get('verticalServices') or [] if len(v['polygon']) >= 3]
        self.bodies = []; self.aprons = []

    def conflict(self, geom):
        return sum(geom.intersection(p).area for p in [*(r for r in self.rooms.values() if r is not None), *self.verticals, *self.bodies, *self.aprons])

    def carve(self, geom):
        cut = geom.buffer(.12, join_style=2)
        for rid, poly in list(self.rooms.items()):
            if poly is None or not poly.intersects(cut): continue
            rest = poly.difference(cut)
            parts = sorted([g for g in getattr(rest, 'geoms', [rest]) if g.geom_type == 'Polygon'], key=lambda g: -g.area)
            self.rooms[rid] = parts[0] if parts and parts[0].area >= 1.6 else None

    def free_components(self, clearance=.42):
        blocked = unary_union([p for p in self.rooms.values() if p is not None] + self.verticals + self.bodies)
        free = self.walk.difference(blocked)
        core = free.buffer(-clearance)
        return sorted([g for g in getattr(core, 'geoms', [core]) if g.geom_type == 'Polygon' and g.area > .05], key=lambda g: -g.area)


def connected(state, geom, roots):
    probe = geom.buffer(-.05) if geom.area > .5 else geom
    return any(probe.intersects(r) for r in roots)


def overrides_of(st):
    return {rid: (None if poly is None else [[round(x, 4), round(z, 4)] for x, z in list(poly.exterior.coords)[:-1]])
            for rid, poly in st.rooms.items() if poly is not st.original[rid]}


BASELINE = {}
def planner_ok(bid, st, pieces, f, landing_core):
    """Run the real access planner: rooms must stay reachable and the landing must join the root."""
    import build_floor_access as A
    fid = f['id']
    if fid not in BASELINE:
        BASELINE[fid] = A.plan_floor_access(f, service_stair=None)['report']['reachableRoomCount']
    saved = dict(st.rooms); st.carve(core_rect(landing_core['center'], landing_core['length'], landing_core['width'], landing_core['angle']))
    st.carve(apron_of(landing_core['center'], landing_core['length'], landing_core['width'], landing_core['angle']))
    structure = dict(stairCores={bid: pieces}, lifts={}, roomOverrides={fid: overrides_of(st)}); st.rooms = saved
    floor, _ = A._apply_structure(f, bid, structure)
    entry = A._apron_center(landing_core, landing_core['length'], landing_core['width'])
    plan = A.plan_floor_access(floor, service_stair=None, vertical_entry=entry if f['level'] != 1 else None)
    rep = plan['report']
    return rep['reachableRoomCount'] >= BASELINE[fid] and (f['level'] == 1 or plan.get('entryKind') == 'interior-stair-landing')


def resolve_vertical(bid, building):
    floors = sorted([f for f in building['floors'] if f.get('outline') and len(f['outline']) >= 3], key=lambda f: storey_of(f, MAXLEVEL(building)))
    maxlevel = MAXLEVEL(building); states = {f['id']: FloorState(f) for f in floors}
    cands = candidate_cores(floors)
    if bid == 'EV' or not cands:
        lifts = [s for st in states.values() for s in st.verticals]
        anchor = lifts[0].centroid if lifts else Polygon(floors[0]['outline']).centroid
        cands.append(dict(center=(anchor.x+4.2, anchor.y), length=5.2, width=2.8, angle=0.0, detected=[]))
    cores = []
    for i, c in enumerate(cands):
        best = None
        for flip in (0, 1):
            ang = c['angle']+math.pi*flip
            ap = apron_of(c['center'], c['length'], c['width'], ang)
            score = sum(ap.intersection(states[f['id']].walk).area/ap.area - states[f['id']].conflict(ap)/ap.area for f in floors)
            if best is None or score > best[0]: best = (score, ang)
        ang = best[1]; body = core_rect(c['center'], c['length'], c['width'], ang); ap = apron_of(c['center'], c['length'], c['width'], ang)
        levels = []
        for f in floors:
            st = states[f['id']]
            if not st.walk.buffer(.01).covers(body.buffer(-.2)) or not st.walk.buffer(.01).covers(ap.buffer(-.2)): continue
            detected = f['level'] in c['detected']; conflict = st.conflict(body)+st.conflict(ap)
            if detected and conflict < .55*(body.area+ap.area) or conflict <= 2.0:
                levels.append(dict(floorId=f['id'], level=f['level'], storey=storey_of(f, maxlevel), basis='map-derived' if detected else 'schematic', roomConflictArea=round(conflict, 3)))
        cores.append(dict(id=f'{bid}-stair-{i+1}', center=list(c['center']), angle=ang, length=c['length'], width=c['width'], levels=levels, detected=c['detected']))
    def runs(levels):
        out, run = [], []
        for l in levels:
            if run and l['storey'] != run[-1]['storey']+1: out.append(run); run = []
            run.append(l)
        if run: out.append(run)
        return [r for r in out if len(r) >= 2]
    # Split cores into contiguous runs, then carve rooms and test that every landing
    # reaches the floor's main circulation. Disconnected landings split the run again.
    pieces = []
    for c in cores:
        for n, run in enumerate(runs(c['levels'])):
            pieces.append({**c, 'id': c['id']+('' if n == 0 else chr(97+n)), 'levels': run})
    for _ in range(4):
        for st in states.values(): st.rooms = dict(st.original); st.bodies = []; st.aprons = []
        for c in pieces:
            body = core_rect(c['center'], c['length'], c['width'], c['angle']); ap = apron_of(c['center'], c['length'], c['width'], c['angle'])
            for l in c['levels']:
                st = states[l['floorId']]; st.carve(body); st.carve(ap); st.bodies.append(body); st.aprons.append(ap)
        changed = False; kept = []
        for c in pieces:
            ap = apron_of(c['center'], c['length'], c['width'], c['angle']); good = []
            for l in c['levels']:
                comps = states[l['floorId']].free_components()
                ok = bool(comps) and connected(states[l['floorId']], ap, comps[:1])
                l['landingConnected'] = ok
                if ok: good.append(l)
                else: changed = True
            for n, run in enumerate(runs(good)):
                kept.append({**c, 'id': c['id']+('' if n == 0 else '-'+str(n)), 'levels': run})
        pieces = kept
        if not changed: break
    # Every storey must chain to its neighbour; add schematic cores where a link is missing.
    order = [storey_of(f, maxlevel) for f in floors]; by_storey = {storey_of(f, maxlevel): f for f in floors}
    def linked(a, b): return any({a, b} <= {l['storey'] for l in c['levels']} for c in pieces)
    added = []
    for a, b in zip(order, order[1:]):
        if linked(a, b): continue
        fa, fb = by_storey[a], by_storey[b]; sa, sb = states[fa['id']], states[fb['id']]
        ref = pieces[0]['center'] if pieces else list(Polygon(fa['outline']).centroid.coords)[0]
        minx, minz, maxx, maxz = sa.walk.intersection(sb.walk).bounds; cands = []
        for x in np.arange(minx+2, maxx-2, .8):
            for z in np.arange(minz+2, maxz-2, .8):
                for ang in (0, math.pi/2, math.pi, 3*math.pi/2):
                  for L, W in ((5.2, 2.8), (4.6, 2.5)):
                    body = core_rect((x, z), L, W, ang); ap = apron_of((x, z), L, W, ang); both = body.union(ap)
                    if any(not st.walk.covers(both) for st in (sa, sb)): continue
                    conflict = max(st.conflict(both) for st in (sa, sb))
                    if conflict > .45*both.area: continue
                    cands.append((conflict*4+math.dist((x, z), ref)*.15+(L < 5), x, z, ang, L, W))
        best = None
        for score, x, z, ang, L, W in sorted(cands)[:220]:
            body = core_rect((x, z), L, W, ang); ap = apron_of((x, z), L, W, ang); ok = True
            for st in (sa, sb):
                saved = dict(st.rooms); st.carve(body); st.carve(ap); st.bodies.append(body)
                good = connected(st, ap, st.free_components()[:1])
                st.bodies.pop(); st.rooms = saved
                ok = ok and good
            if not ok: continue
            trial = dict(id='trial', center=[x, z], angle=ang, length=L, width=W, apron=APRON,
                         levels=[dict(floorId=f['id'], storey=storey_of(f, maxlevel)) for f in (fa, fb)])
            if all(planner_ok(bid, states[f['id']], pieces+[trial], f, trial) for f in (fa, fb)):
                best = (score, x, z, ang, L, W); break
        if best is None:
            added.append(dict(missingLink=[fa['id'], fb['id']])); continue
        _, x, z, ang, L, W = best
        pieces.append(dict(id=f'{bid}-stair-link-{a}-{b}', center=[x, z], angle=ang, length=L, width=W, detected=[],
                           levels=[dict(floorId=f['id'], level=f['level'], storey=storey_of(f, maxlevel), basis='schematic', roomConflictArea=0, landingConnected=True) for f in (fa, fb)]))
        for f in (fa, fb):
            st = states[f['id']]; st.carve(core_rect((x, z), L, W, ang)); st.carve(apron_of((x, z), L, W, ang)); st.bodies.append(core_rect((x, z), L, W, ang)); st.aprons.append(apron_of((x, z), L, W, ang))
    overrides = {}
    for fid, st in states.items():
        for rid, poly in st.rooms.items():
            if poly is st.original[rid]: continue
            overrides.setdefault(fid, {})[rid] = None if poly is None else [[round(x, 4), round(z, 4)] for x, z in list(poly.exterior.coords)[:-1]]
    out = []
    for c in pieces:
        out.append(dict(id=c['id'], center=[round(c['center'][0], 3), round(c['center'][1], 3)], angle=round(c['angle'], 5), length=round(c['length'], 3), width=round(c['width'], 3),
                        apron=APRON, levels=c['levels'], basis='schematic',
                        evidence=('官方平面圖青綠色樓梯符號跨層聚合；' if c['detected'] else '平面圖無對應符號，為補足上下樓動線的示意梯；') + '梯段為示意折返梯，平台朝向可通行走廊。'))
    return out, overrides, added, states


def lifts_for(bid, cores, states):
    floors = sorted(states.values(), key=lambda st: storey_of(st.f, 99))
    ground = next((st for st in floors if st.f['level'] == 1), floors[0]); order = [storey_of(st.f, MAXLEVEL_CACHE[bid]) for st in floors]
    def run_from(centre, ang, levels):
        body = core_rect(centre, 2.0, 2.0, ang); ap = apron_of(centre, 2.0, 2.0, ang); stops = []
        for st in levels:
            if st.walk.covers(body.union(ap)) and st.conflict(body) < .05 and st.conflict(ap) < .05 and connected(st, ap, st.free_components()[:1]):
                stops.append(dict(floorId=st.f['id'], level=st.f['level'], storey=storey_of(st.f, MAXLEVEL_CACHE[bid])))
            elif stops: break
            elif st.f['level'] >= 1: return []
        return stops
    above = [st for st in floors if st.f['level'] >= 1]
    def score(stops): return (any(s['level'] == 1 for s in stops), len(stops))
    best = None
    for core in cores:
        ang = core['angle']; ux, uz = math.cos(ang), math.sin(ang); vx, vz = -uz, ux
        for side in (1, -1):
            for along in (0, -1.2, 1.2):
                off = core['width']/2+1.15
                centre = (core['center'][0]+vx*off*side+ux*along, core['center'][1]+vz*off*side+uz*along)
                stops = run_from(centre, ang, above)
                if len(stops) >= 2 and (best is None or score(stops) > score(best[0])): best = (stops, centre, ang)
    if best is None or len(best[0]) < len(above):
        # Grid search for a car that serves 1F to the top floor (cheap conflict filter first).
        minx, minz, maxx, maxz = ground.walk.bounds; ref = cores[0]['center'] if cores else ((minx+maxx)/2, (minz+maxz)/2); cands = []
        for x in np.arange(minx+1.5, maxx-1.5, 1.0):
            for z in np.arange(minz+1.5, maxz-1.5, 1.0):
                for ang in (0, math.pi/2, math.pi, 3*math.pi/2):
                    both = core_rect((x, z), 2.0, 2.0, ang).union(apron_of((x, z), 2.0, 2.0, ang))
                    if all(st.walk.covers(both) and st.conflict(both) < .05 for st in above): cands.append((math.dist((x, z), ref), x, z, ang))
        for _, x, z, ang in sorted(cands)[:25]:
            stops = run_from((x, z), ang, above)
            if len(stops) >= 2 and (best is None or score(stops) > score(best[0])): best = (stops, (x, z), ang)
            if best and len(best[0]) == len(above): break
    if best is None or len(best[0]) < len(above):
        # Last resort: let the car clip room candidates, verified by the real planner on every floor.
        minx, minz, maxx, maxz = ground.walk.bounds; cands = []
        for x in np.arange(minx+1.5, maxx-1.5, 1.0):
            for z in np.arange(minz+1.5, maxz-1.5, 1.0):
                for ang in (0, math.pi/2, math.pi, 3*math.pi/2):
                    both = core_rect((x, z), 2.0, 2.0, ang).union(apron_of((x, z), 2.0, 2.0, ang))
                    if not all(st.walk.covers(both) for st in above): continue
                    if any(b.intersects(both) for st in above for b in st.bodies+st.aprons): continue
                    worst = max(st.conflict(both) for st in above)
                    if worst <= .35*both.area: cands.append((worst*3+math.dist((x, z), ref)*.1, x, z, ang))
        for _, x, z, ang in sorted(cands)[:60]:
            body = core_rect((x, z), 2.0, 2.0, ang); ap = apron_of((x, z), 2.0, 2.0, ang); ok = True; saved = {}
            for st in above:
                saved[st.f['id']] = dict(st.rooms); st.carve(body); st.carve(ap); st.bodies.append(body)
                good = connected(st, ap, st.free_components()[:1]) and lift_planner_ok(bid, st, cores, body)
                st.bodies.pop(); ok = ok and good
                if not ok: break
            if ok:
                best = ([dict(floorId=st.f['id'], level=st.f['level'], storey=storey_of(st.f, MAXLEVEL_CACHE[bid])) for st in above], (x, z), ang); break
            for st in above:
                if st.f['id'] in saved: st.rooms = saved[st.f['id']]
    if not best: return []
    stops, centre, ang = best
    for st in floors:
        if any(s['floorId'] == st.f['id'] for s in stops): st.bodies.append(core_rect(centre, 2.0, 2.0, ang)); st.aprons.append(apron_of(centre, 2.0, 2.0, ang))
    return [dict(id=f'{bid}-lift-1', center=[round(centre[0], 3), round(centre[1], 3)], angle=round(ang, 5), size=2.0, stops=stops, basis='schematic',
                 evidence='示意電梯車廂；不代表實際電梯位置。')]


MAXLEVEL_CACHE = {}
def lift_planner_ok(bid, st, cores, body):
    import build_floor_access as A
    f = st.f; fid = f['id']
    if fid not in BASELINE: BASELINE[fid] = A.plan_floor_access(f, service_stair=None)['report']['reachableRoomCount']
    lift = dict(id='trial-lift', center=list(body.centroid.coords)[0], angle=0, size=2.0, stops=[dict(floorId=fid)])
    floor, entry = A._apply_structure(f, bid, dict(stairCores={bid: cores}, lifts={bid: []}, roomOverrides={fid: overrides_of(st)}))
    floor['verticalServices'] = floor['verticalServices']+[dict(id='trial-lift', kind='lift-car', polygon=[list(c) for c in list(body.exterior.coords)[:-1]])]
    plan = A.plan_floor_access(floor, service_stair=None, vertical_entry=entry)
    return plan['report']['reachableRoomCount'] >= BASELINE[fid] and (f['level'] == 1 or plan.get('entry') is not None)

# ---------------------------------------------------------------- joins
def to_local(p, pl):
    r, s = pl['rotation'], pl['scale']; c, n = math.cos(r), math.sin(r)
    dx, dz = (p[0]-pl['x'])/s, (p[1]-pl['z'])/s
    return (dx*c-dz*n, dx*n+dz*c)


def world_poly(points, pl):
    return Polygon(frame_xy(points, pl['rotation'], pl['scale'], pl['x'], pl['z'])).buffer(0)


def join_connectors(placements, overrides):
    """Explicit per-storey walkways between physically joined buildings (world metres)."""
    data = {b: json.loads((DATA/f'{b}.json').read_text()) for b in BIDS}
    out, missing = [], []
    for a, b in JOINS:
        ma, mb = MAXLEVEL(data[a]), MAXLEVEL(data[b])
        fa = {storey_of(f, ma): f for f in data[a]['floors'] if f['level'] not in (-1, 99)}
        fb = {storey_of(f, mb): f for f in data[b]['floors'] if f['level'] not in (-1, 99)}
        for st in sorted(set(fa) & set(fb)):
            A, B = fa[st], fb[st]
            oa, ob = world_poly(A['outline'], placements[a]), world_poly(B['outline'], placements[b])
            rooms = []
            for f, bid in ((A, a), (B, b)):
                ov = overrides.get(f['id'], {})
                for r in f['rooms']:
                    pts = ov.get(r['id'], r['polygon'])
                    if pts and len(pts) >= 3: rooms.append(world_poly(pts, placements[bid]))
            blocked = unary_union(rooms) if rooms else Polygon()
            best = None; ring = oa.exterior
            for t in np.arange(0, ring.length, .6):
                pa = ring.interpolate(t); pb = ob.exterior.interpolate(ob.exterior.project(pa))
                d = pa.distance(pb)
                if d > 14: continue
                if d < .05:
                    # Overlapping footprints: walk along the shared edge direction instead.
                    continue
                ux, uz = (pb.x-pa.x)/d, (pb.y-pa.y)/d
                # The walkway lies between the two outlines (over both galleries), never inside a plan.
                pad = max(0, (2.0-d)/2)
                start = (pa.x-ux*pad, pa.y-uz*pad); end = (pb.x+ux*pad, pb.y+uz*pad)
                line = LineString([start, end]); body = line.buffer(1.5, cap_style=2)
                if body.intersection(blocked).area > .05: continue
                score = d
                if best is None or score < best[0]: best = (score, start, end, d)
            if best is None:
                # Footprints overlap or touch: a short connector straddling the closest boundary.
                inter = oa.buffer(GALLERY).intersection(ob.buffer(GALLERY))
                ok = inter.buffer(-.6)
                if not ok.is_empty and ok.difference(blocked).area > 2:
                    c = ok.difference(blocked).representative_point()
                    out.append(dict(id=f'{a}-{b}-{st}', buildings=[a, b], floors=[A['id'], B['id']], storey=st, overlap=True, center=[round(c.x, 3), round(c.y, 3)], basis='schematic'))
                else:
                    missing.append(dict(buildings=[a, b], storey=st, floors=[A['id'], B['id']]))
                continue
            _, s0, s1, d = best
            ux, uz = (s1[0]-s0[0])/max(math.dist(s0, s1), 1e-6), (s1[1]-s0[1])/max(math.dist(s0, s1), 1e-6)
            body = LineString([s0, s1]).buffer(1.5, cap_style=2)
            ext = LineString([(s0[0]-ux*(GALLERY+.6), s0[1]-uz*(GALLERY+.6)), (s1[0]+ux*(GALLERY+.6), s1[1]+uz*(GALLERY+.6))]).buffer(1.5, cap_style=2)
            galleries = {f['id']: world_poly(list(Polygon(Polygon(f['outline']).exterior).buffer(GALLERY, join_style=3).exterior.coords)[:-1], placements[bid]) for f, bid in ((A, a), (B, b))}
            openings = {}
            for f, bid in ((A, a), (B, b)):
                pl = placements[bid]
                for o in edge_openings(galleries[f['id']], ext, pl): openings.setdefault(f['id'], []).append(o)
            rails = []
            if st > 1:
                around = unary_union(list(galleries.values()))
                for sign in (-1, 1):
                    side = LineString([(s0[0]-uz*1.5*sign, s0[1]+ux*1.5*sign), (s1[0]-uz*1.5*sign, s1[1]+ux*1.5*sign)]).difference(around)
                    for g in getattr(side, 'geoms', [side]):
                        if not g.is_empty and g.length > .15: rails.append([[round(x, 3), round(z, 3)] for x, z in g.coords])
            out.append(dict(id=f'{a}-{b}-{st}', buildings=[a, b], floors=[A['id'], B['id']], storey=st, a=[round(s0[0], 3), round(s0[1], 3)], b=[round(s1[0], 3), round(s1[1], 3)],
                            width=3.0, gap=round(d, 3), openings=openings, rails=rails, basis='schematic', evidence='示意跨棟連接走廊：兩棟同層外廊最近處，避開所有房間候選。'))
    return out, missing


def edge_openings(gallery, region, pl, pad=.4):
    """Openings per straight gallery edge (cutWall cuts one edge at a time)."""
    ring = list(gallery.exterior.coords); out = []
    for p0, p1 in zip(ring, ring[1:]):
        seg = LineString([p0, p1]).intersection(region)
        for g in getattr(seg, 'geoms', [seg]):
            if g.is_empty or g.geom_type != 'LineString' or g.length < .2: continue
            m = g.interpolate(.5, normalized=True)
            out.append(dict(p=[round(v, 4) for v in to_local((m.x, m.y), pl)], width=round(g.length/pl['scale']+pad, 3)))
    return out


def rail_gaps(placements):
    """Where a gallery edge runs inside another building's same-storey gallery, its rail must open."""
    shapes = {b: storey_shapes(b) for b in BIDS}; ids = {}
    for b in BIDS:
        d = json.loads((DATA/f'{b}.json').read_text()); m = MAXLEVEL(d)
        ids[b] = {storey_of(f, m): f['id'] for f in d['floors'] if len(f['outline']) >= 3}
    gaps = {}
    for a in BIDS:
        for st, (_, gal) in shapes[a].items():
            if st == 1: continue  # ground floor has no guard rails; basements and upper floors do
            others = [world_poly(shapes[b][st][1], placements[b]).buffer(.08) for b in BIDS if b != a and st in shapes[b]]
            if not others: continue
            for o in edge_openings(world_poly(gal, placements[a]), unary_union(others), placements[a], pad=.2):
                gaps.setdefault(ids[a][st], []).append(o)
    return gaps


def validate_all(structure):
    import build_floor_access as A
    rows = []
    for b in BIDS:
        data = json.loads((DATA/f'{b}.json').read_text())
        for f in data['floors']:
            base = A.plan_floor_access(f, service_stair=None)['report']['reachableRoomCount']
            floor, entry = A._apply_structure(f, b, structure)
            plan = A.plan_floor_access(floor, service_stair=None, vertical_entry=entry)
            rep = plan['report']
            ok = plan.get('entry') is not None and rep['reachableRoomCount'] >= base
            rows.append(dict(floorId=f['id'], ok=ok, entry=plan.get('entry'), reachable=rep['reachableRoomCount'], baseline=base, rooms=rep['roomCount']))
    return rows


# ---------------------------------------------------------------- context
def context(osm):
    landmarks, background = [], []
    for name, rows in osm['named'].items():
        spec = LANDMARKS.get(name, 'bg')
        if spec is None: continue
        for poly, tags, oid in rows:
            if poly.centroid.distance(Point(0, 0)) > 650: continue
            coords = [[round(x, 2), round(z, 2)] for x, z in list(poly.exterior.coords)[:-1]]
            if spec == 'bg':
                lv = int(tags.get('building:levels') or 3)
                background.append(dict(id=f'osm-{oid}', name=name, polygon=coords, storeys=lv))
            else:
                lid, label, lv, tone = spec
                lv = int(tags.get('building:levels') or lv)
                landmarks.append(dict(id=lid, name=label, polygon=coords, storeys=lv, tone=tone, osmId=oid))
    for poly, tags, oid in osm['others']:
        if poly.centroid.distance(Point(0, 0)) > 650: continue
        background.append(dict(id=f'osm-{oid}', name=None, polygon=[[round(x, 2), round(z, 2)] for x, z in list(poly.exterior.coords)[:-1]],
                               storeys=int(tags.get('building:levels') or 3)))
    widths = dict(primary=11, secondary=9, tertiary=8, residential=6.5, service=4.5, unclassified=6, footway=2.4, path=2.0, pedestrian=4, steps=2.4, cycleway=2.4, living_street=5)
    roads = []
    for pts, tags, oid in osm['roads']:
        kind = tags.get('highway')
        if kind not in widths: continue
        line = LineString(pts)
        if line.distance(Point(0, 0)) > 600: continue
        roads.append(dict(id=f'osm-{oid}', kind=kind, name=tags.get('name'), width=widths[kind], tunnel=tags.get('tunnel') == 'yes',
                          bridge=tags.get('bridge') == 'yes', points=[[round(x, 2), round(z, 2)] for x, z in pts]))
    water = [dict(id=f'osm-{oid}', kind=tags.get('natural'), points=[[round(x, 2), round(z, 2)] for x, z in pts]) for pts, tags, oid in osm['coast']]
    sport = [dict(id=f'osm-{oid}', kind=tags.get('leisure'), sport=tags.get('sport'), polygon=[[round(x, 2), round(z, 2)] for x, z in pts[:-1]]) for pts, tags, oid in osm['leisure']]
    return dict(landmarks=landmarks, background=background, roads=roads, water=water, sport=sport)


def overlay(placements, structure, osm, path):
    S = 1.6; W, H = 1100, 1300; ox, oz = 520, 600
    im = Image.new('RGB', (W, H), 'white'); from PIL import ImageDraw; dr = ImageDraw.Draw(im)
    P = lambda x, z: (ox+x*S, oz+z*S)
    for r in structure['context']['roads']: dr.line([P(*p) for p in r['points']], fill=(170, 170, 170), width=max(1, int(r['width']*S*.5)))
    for n, rows in osm['named'].items():
        for poly, _, _ in rows: dr.polygon([P(*p) for p in poly.exterior.coords], outline=(40, 40, 200))
    for b in BIDS:
        p = placements[b]; bd, f, poly = floor_outline(b)
        dr.polygon([P(*q) for q in frame_xy(list(poly.exterior.coords), p['rotation'], p['scale'], p['x'], p['z'])], outline=(220, 40, 40), width=2)
        for c in structure['stairCores'][b]:
            body = core_rect(c['center'], c['length'], c['width'], c['angle'])
            dr.polygon([P(*q) for q in frame_xy(list(body.exterior.coords), p['rotation'], p['scale'], p['x'], p['z'])], fill=(20, 170, 150))
        c = Polygon(frame_xy(list(poly.exterior.coords), p['rotation'], p['scale'], p['x'], p['z'])).centroid
        dr.text(P(c.x, c.y), f"{b} s={p['scale']:.2f}", fill=(180, 0, 0))
    im.save(path)


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--out', type=pathlib.Path, default=DATA/'campus-structure.json')
    ap.add_argument('--overlay', type=pathlib.Path, default=ROOT/'artifacts/p1/footprint-fit.png'); a = ap.parse_args()
    osm = load_osm()
    placements, fits = fit_all(osm)
    remaining = separate(placements)
    print('separation', {b: placements[b]['separationShift'] for b in BIDS}, 'remaining clashes', remaining)
    cores, lifts, overrides, missing = {}, {}, {}, {}
    for b in BIDS:
        building = json.loads((DATA/f'{b}.json').read_text())
        MAXLEVEL_CACHE[b] = MAXLEVEL(building)
        cores[b], ov, missing[b], states = resolve_vertical(b, building); overrides.update(ov); lifts[b] = lifts_for(b, cores[b], states)
    connectors, missing_joins = join_connectors(placements, overrides)
    gaps = rail_gaps(placements)
    structure = dict(version=2, separationRemaining=remaining, units='metres', axes='x east, z south; world = T*Ry(rotation)*S(scale,1,scale)*local',
                     origin=dict(lat=LAT0, lon=LON0), floorHeight=FLOOR_HEIGHT,
                     sources=dict(osm=dict(file=str(OSM.relative_to(ROOT)), sha256=osm['sha'], base=osm['base'], license='ODbL 1.0 © OpenStreetMap contributors'),
                                  buildings={b: hashlib.sha256((DATA/f'{b}.json').read_bytes()).hexdigest() for b in BIDS}),
                     placements=placements, fits=fits, joins=[list(j) for j in JOINS], stairCores=cores, lifts=lifts, roomOverrides=overrides, missingLinks=missing, connectors=connectors, railGaps=gaps, missingJoins=missing_joins, context=context(osm),
                     note='擺放依OSM社群輪廓擬合，非測量；樓梯梯段、電梯車廂與跨棟連接為示意。')
    rows = validate_all(structure); structure['validation'] = dict(floors=len(rows), ok=sum(r['ok'] for r in rows), failures=[r for r in rows if not r['ok']])
    a.out.write_text(json.dumps(structure, ensure_ascii=False, indent=1)+'\n')
    print('connectors', [(c['id'], c.get('gap'), c.get('overlap')) for c in connectors]); print('missing joins', missing_joins)
    print('validation', structure['validation']['ok'], '/', len(rows)); [print('  FAIL', r) for r in structure['validation']['failures']]
    a.overlay.parent.mkdir(parents=True, exist_ok=True); overlay(placements, structure, osm, a.overlay)
    for f in fits: print('fit', f)
    for b in BIDS:
        p = placements[b]
        print(b, 'lift stops', [s['storey'] for s in (lifts[b][0]['stops'] if lifts[b] else [])])
        print(b, 'rot', round(math.degrees(p['rotation']), 1), 'scale', round(p['scale'], 3), 'xz', round(p['x'], 1), round(p['z'], 1), 'lift', [l['storey'] for l in (lifts[b][0]['stops'] if lifts[b] else [])], 'missing', missing[b])
        for c in cores[b]: print('   ', c['id'], [l['storey'] for l in c['levels']])
    print('room overrides', sum(len(v) for v in overrides.values()), 'suppressed', sum(x is None for v in overrides.values() for x in v.values()))


if __name__ == '__main__':
    main()
