"""v3 hand-modelled landmarks (art-direction-v3 §5, spec-v3 §6, ticket T4).

Run:  <blender> --background --python tools/create_landmarks.py -- [--only admin,gate] [--no-render]
Out:  public/models/landmarks/<id>.glb (meshopt) + <id>.collision.json, artifacts/v3/T4/renders/*.png

Conventions
- Blender: metres, Z up, +Y = NORTH, +X = east. glTF export (+Y up) turns Blender +Y into three −Z, which is north in
  world coords (campus-structure.json: x east, z south). So a GLB is placed with a translation to its OSM centroid
  (+ the yaw in placements.json, radians about three +Y, same sense as campus-structure `rotation`).
- Origin = footprint centroid on the ground (z = 0 at the main entrance grade).
- One material per landmark: 512 px albedo atlas + 512 px emissive atlas painted by tools/landmark_atlas.py (procedural
  colour blocks only, no photos). Faces are UV-mapped to atlas tiles; patterned tiles (window bays, brick) repeat by
  subdividing walls into bay × storey cells (bay 3.0 m, storey 3.7 m, art-direction §5).
- `_OUTLINENORMAL` (POINT, FLOAT_VECTOR): area-weighted normal averaged over all faces sharing a welded position, for
  inverted-hull outlines (art-direction §3 `aOutlineNormal`). three's GLTFLoader exposes it as `_outlinenormal`.
- Collision: <id>.collision.json lists oriented boxes in LOCAL three coords (x east, y up, z south), size = full extents,
  yaw = radians about +Y; `walkable` marks floors/steps/tops the player may stand on.
- Reference photos per landmark: docs/reference/landmarks/<id>.md (URL noted above each landmark function).
"""
from pathlib import Path
from contextlib import contextmanager
import json, math, subprocess, sys
import bpy
from mathutils import Vector, Matrix

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'public/models/landmarks'; ART = ROOT / 'artifacts/v3/T4'; TMP = ART / 'build'; RENDERS = ART / 'renders'
for d in (OUT, TMP, RENDERS): d.mkdir(parents=True, exist_ok=True)
GLTF_TRANSFORM = ROOT / 'node_modules/.bin/gltf-transform'
ATLAS, CELL = 512, 32          # atlas px, allocation cell px (tiles span whole cells)
BAY, STOREY = 3.0, 3.7

# art-direction-v3 §1.2 tokens (sRGB hex)
P = dict(
    brick='#c75f4a', brick_shade='#a8493a', mortar='#e6d2c2', trim='#f3ebdb', wall='#efe6d1', stone='#cfcbbe', keystone='#8d8677',
    roof='#d6cfbe', roof_dark='#8d5a4c', equip='#b8bdb9', glass='#86b7c8', frame='#3b3a36', bronze='#435249', bronze_hi='#6f8070',
    gold='#d4af37', grass='#86c45c', hill='#4f9a46', foliage='#4d9a44', pave='#e9e1cf', plaza='#dccfb6', sand='#e8d5ad',
    asphalt='#6e7686', tetrapod='#5c5e60', white='#f5f1e6', wood='#7a5230', rail='#8c9296',
)


def argv():
    a = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    only = None; render = True
    for i, x in enumerate(a):
        if x == '--only': only = set(a[i + 1].split(','))
        if x == '--no-render': render = False
    return only, render


class LM:
    """Geometry + atlas + collision accumulator for one landmark (one material, ≥1 mesh parts)."""

    def __init__(self, lid, title, tri_limit):
        self.id, self.title, self.tri_limit = lid, title, tri_limit
        self.parts = {}; self.tiles = {}; self.free = [[True] * (ATLAS // CELL) for _ in range(ATLAS // CELL)]
        self.boxes = []; self.M = Matrix.Identity(4); self.views = {}; self.meta = {}
        self.part(lid)
        self.tile('_solid_fallback', 'solid', color=P['wall'])

    # ---- atlas --------------------------------------------------------------------------------------------------
    def tile(self, name, kind, span=(1, 1), **params):
        if name in self.tiles: return name
        w, h = span; n = ATLAS // CELL
        for r in range(n - h + 1):
            for c in range(n - w + 1):
                if all(self.free[r + j][c + i] for j in range(h) for i in range(w)):
                    for j in range(h):
                        for i in range(w): self.free[r + j][c + i] = False
                    x, y, pw, ph = c * CELL, r * CELL, w * CELL, h * CELL
                    inset = 1.0
                    self.tiles[name] = dict(kind=kind, rect=[x, y, pw, ph], params=params,
                                            uv=((x + inset) / ATLAS, 1 - (y + ph - inset) / ATLAS, (x + pw - inset) / ATLAS, 1 - (y + inset) / ATLAS))
                    return name
        raise RuntimeError(f'{self.id}: atlas full when adding {name}')

    def solid(self, hexcol, em=None):
        name = f'solid{hexcol}{em or ""}'
        return self.tile(name, 'solid', span=(1, 1), color=hexcol, **({'em': em} if em else {}))

    # ---- transforms ---------------------------------------------------------------------------------------------
    @contextmanager
    def at(self, x=0., y=0., z=0., rot=0.):
        old = self.M; self.M = old @ Matrix.Translation((x, y, z)) @ Matrix.Rotation(rot, 4, 'Z')
        try: yield
        finally: self.M = old

    def part(self, name):
        self.parts.setdefault(name, dict(v=[], f=[], uv=[])); self.cur = self.parts[name]

    # ---- faces --------------------------------------------------------------------------------------------------
    def face(self, pts, tile, uvs=None):
        """Append one polygon (CCW seen from outside). uvs: per-corner (s,t) in 0..1 of the tile."""
        t = self.tiles[tile]; u0, v0, u1, v1 = t['uv']
        if uvs is None:
            if len(pts) == 4: uvs = [(0, 0), (1, 0), (1, 1), (0, 1)]
            else:  # planar fit into the tile (fine for solid tiles)
                n = (Vector(pts[1]) - Vector(pts[0])).cross(Vector(pts[2]) - Vector(pts[0]))
                ax = max(range(3), key=lambda k: abs(n[k])); ij = [k for k in range(3) if k != ax]
                xs = [p[ij[0]] for p in pts]; ys = [p[ij[1]] for p in pts]
                sx = (max(xs) - min(xs)) or 1; sy = (max(ys) - min(ys)) or 1
                uvs = [((p[ij[0]] - min(xs)) / sx, (p[ij[1]] - min(ys)) / sy) for p in pts]
        base = len(self.cur['v'])
        for p in pts: self.cur['v'].append(tuple(self.M @ Vector(p)))
        self.cur['f'].append(tuple(range(base, base + len(pts))))
        self.cur['uv'].append([(u0 + (u1 - u0) * s, v0 + (v1 - v0) * tt) for s, tt in uvs])

    def quad(self, p0, p1, p2, p3, tile, nx=1, ny=1, stretch=False):
        """Bilinear quad p0 BL, p1 BR, p2 TR, p3 TL. tile = name | f(i, j, nx, ny) -> name.
        stretch: one tile spans the whole quad (subdivisions take fractions of it)."""
        P0, P1, P2, P3 = map(Vector, (p0, p1, p2, p3))
        lerp = lambda s, t: (P0 * (1 - s) + P1 * s) * (1 - t) + (P3 * (1 - s) + P2 * s) * t
        for j in range(ny):
            for i in range(nx):
                s0, s1, t0, t1 = i / nx, (i + 1) / nx, j / ny, (j + 1) / ny
                tl = tile(i, j, nx, ny) if callable(tile) else tile
                uv = [(s0, t0), (s1, t0), (s1, t1), (s0, t1)] if stretch else None
                self.face([lerp(s0, t0), lerp(s1, t0), lerp(s1, t1), lerp(s0, t1)], tl, uv)

    def wall(self, a, b, z0, z1, tile, cell=None, stretch=False):
        """Vertical wall from 2D a→b (outside on the right of a→b, i.e. CCW footprint)."""
        L = math.dist(a, b); nx = ny = 1
        if cell: nx = max(1, round(L / cell[0])); ny = max(1, round((z1 - z0) / cell[1]))
        self.quad((a[0], a[1], z0), (b[0], b[1], z0), (b[0], b[1], z1), (a[0], a[1], z1), tile, nx, ny, stretch)

    @staticmethod
    def ccw(poly):
        area = sum(poly[i][0] * poly[(i + 1) % len(poly)][1] - poly[(i + 1) % len(poly)][0] * poly[i][1] for i in range(len(poly)))
        return poly if area > 0 else poly[::-1]

    def prism(self, poly, z0, z1, side, top=None, cell=None, bottom=False, stretch=False, sides=None):
        """Extrude a 2D footprint. side may be a tile, callable, or list per edge. sides: set of edge indices to emit."""
        poly = self.ccw([tuple(p) for p in poly]); n = len(poly)
        for k in range(n):
            if sides is not None and k not in sides: continue
            sd = side[k] if isinstance(side, list) else side
            if sd: self.wall(poly[k], poly[(k + 1) % n], z0, z1, sd, cell, stretch)
        if top: self.face([(x, y, z1) for x, y in poly], top)
        if bottom: self.face([(x, y, z0) for x, y in poly[::-1]], bottom)

    def box(self, cx, cy, z0, sx, sy, h, side, top=None, cell=None, rot=0., bottom=False, stretch=False, col=False, walk=False):
        with self.at(cx, cy, 0, rot):
            pts = [(-sx / 2, -sy / 2), (sx / 2, -sy / 2), (sx / 2, sy / 2), (-sx / 2, sy / 2)]
            self.prism(pts, z0, z0 + h, side, top if top is not None else (side if isinstance(side, str) else None), cell, bottom, stretch)
            if col: self.col(0, 0, z0, sx, sy, h, walk=walk)

    def cyl(self, cx, cy, z0, r, h, n, side, top=None, r2=None, cell=None):
        r2 = r if r2 is None else r2
        a = [(cx + r * math.cos(2 * math.pi * k / n), cy + r * math.sin(2 * math.pi * k / n)) for k in range(n)]
        b = [(cx + r2 * math.cos(2 * math.pi * k / n), cy + r2 * math.sin(2 * math.pi * k / n)) for k in range(n)]
        for k in range(n):
            k1 = (k + 1) % n
            self.quad((*a[k], z0), (*a[k1], z0), (*b[k1], z0 + h), (*b[k], z0 + h), side, 1, max(1, round(h / cell)) if cell else 1)
        if top and r2 > 1e-4: self.face([(x, y, z0 + h) for x, y in b], top)

    def stairs(self, cx, cy, z0, width, depth, rise_total, steps, tile, top_tile=None, rot=0., col=True):
        """Straight flight climbing toward +Y (local), centred on (cx, cy) at its foot."""
        with self.at(cx, cy, 0, rot):
            sd = depth / steps; sh = rise_total / steps
            for k in range(steps):  # each step is a slab from the ground so the flight reads solid from the side
                y0 = k * sd
                self.box(0, y0 + sd / 2, z0, width, sd, sh * (k + 1), tile, top_tile or tile)
                if col: self.col(0, y0 + sd / 2, z0, width, sd, sh * (k + 1), walk=True)

    def gable(self, cx, cy, z, sx, sy, rise, roof_tile, gable_tile, rot=0., over=0.6, along_x=True):
        """Pitched roof, ridge along local X (along_x) with eaves overhang `over`."""
        with self.at(cx, cy, z, rot):
            if not along_x: sx, sy = sy, sx
            ex, ey = sx / 2 + over, sy / 2 + over; hx = sx / 2
            with self.at(0, 0, 0, 0 if along_x else math.pi / 2):
                self.quad((-ex, -ey, 0), (ex, -ey, 0), (ex, 0, rise), (-ex, 0, rise), roof_tile)
                self.quad((ex, ey, 0), (-ex, ey, 0), (-ex, 0, rise), (ex, 0, rise), roof_tile)
                self.face([(-hx, sy / 2, 0), (-hx, -sy / 2, 0), (-hx, 0, rise * (sy / 2) / ey)], gable_tile)
                self.face([(hx, -sy / 2, 0), (hx, sy / 2, 0), (hx, 0, rise * (sy / 2) / ey)], gable_tile)
                self.face([(-ex, -ey, 0), (-ex, ey, 0), (ex, ey, 0), (ex, -ey, 0)], roof_tile)  # soffit

    @staticmethod
    def offset(poly, d):
        """Miter-offset a CCW polygon outward by d (negative = inset)."""
        poly = LM.ccw(poly); n = len(poly); out = []
        for k in range(n):
            a, b, c = Vector(poly[k - 1]), Vector(poly[k]), Vector(poly[(k + 1) % n])
            e1 = (b - a).normalized(); e2 = (c - b).normalized()
            n1 = Vector((e1.y, -e1.x)); n2 = Vector((e2.y, -e2.x)); m = (n1 + n2)
            m = m.normalized() if m.length > 1e-6 else n1
            out.append(tuple(b + m * (d / max(.3, m.dot(n1)))))
        return out

    def parapet(self, poly, z, h, t, side, top, inner=None):
        """Ring wall on a roof edge: outer face (side), inner face, cap (top)."""
        o = self.ccw(poly); i = self.offset(o, -t); n = len(o)
        for k in range(n):
            a, b = o[k], o[(k + 1) % n]; ia, ib = i[k], i[(k + 1) % n]
            self.wall(a, b, z, z + h, side)
            self.quad((ib[0], ib[1], z), (ia[0], ia[1], z), (ia[0], ia[1], z + h), (ib[0], ib[1], z + h), inner or side)
            self.face([(a[0], a[1], z + h), (b[0], b[1], z + h), (ib[0], ib[1], z + h), (ia[0], ia[1], z + h)], top)

    def band(self, poly, z, h, out, tile, cap=None):
        """Projecting horizontal band (cornice / floor slab edge) around a footprint, `out` metres proud."""
        o = self.offset(poly, out); self.prism(o, z, z + h, tile, cap or tile, bottom=cap or tile)

    def barrel(self, cx, cy, z, sx, sy, rise, segs, tile, end_tile=None, over=.5, rot=0.):
        """Shallow barrel roof spanning local Y (arc in YZ), ridge along X."""
        with self.at(cx, cy, z, rot):
            hx, hy = sx / 2 + over, sy / 2 + over
            R = (hy * hy + rise * rise) / (2 * rise); zc = rise - R
            pts = [(-hy + 2 * hy * k / segs) for k in range(segs + 1)]
            prof = [(y, zc + math.sqrt(max(0, R * R - y * y))) for y in pts]
            for k in range(segs):
                (y0, z0), (y1, z1) = prof[k], prof[k + 1]
                self.quad((hx, y0, z0), (hx, y1, z1), (-hx, y1, z1), (-hx, y0, z0), tile)
                self.quad((-hx, y0, z0 - .25), (-hx, y1, z1 - .25), (hx, y1, z1 - .25), (hx, y0, z0 - .25), tile)  # underside
            for sgn in (-1, 1):  # end fascia
                ring = [(sgn * hx, y, zz) for y, zz in prof]; under = [(sgn * hx, y, zz - .25) for y, zz in prof]
                for k in range(segs):
                    q = [under[k], under[k + 1], ring[k + 1], ring[k]]
                    self.face(q if sgn > 0 else q[::-1], end_tile or tile)
            return prof

    def arch_face(self, w_in, spring, w_out, h_out, y, segs, tile, back=False):
        """Flat wall face (in local XZ plane at Y=y) with a round-arch opening of width w_in, spring height `spring`.
        Outer rectangle w_out × h_out. Normal −Y (front) or +Y (back=True)."""
        r = w_in / 2; ang = [math.pi - math.pi * k / segs for k in range(segs + 1)]
        inner = [(r * math.cos(a), spring + r * math.sin(a)) for a in ang]
        W, H = w_out / 2, h_out
        def hit(a):  # ray from arch centre to outer rectangle
            dx, dz = math.cos(a), math.sin(a); ts = []
            if abs(dx) > 1e-6: ts.append(W / abs(dx))
            if dz > 1e-6: ts.append((H - spring) / dz)
            t = min(ts); return (dx * t, spring + dz * t)
        outer = [hit(a) for a in ang]
        def emit(q):
            pts = [(x, y, z) for x, z in q]
            self.face(pts[::-1] if back else pts, tile)
        emit([(-W, 0), (-r, 0), (-r, spring), (-W, spring)])
        emit([(r, 0), (W, 0), (W, spring), (r, spring)])
        for k in range(segs):  # wedge between arch and outer frame (corner points added when the ray crosses a corner)
            a0, a1 = inner[k], inner[k + 1]; b0, b1 = outer[k], outer[k + 1]
            side0 = abs(abs(b0[0]) - W) < 1e-6 and b0[1] < H - 1e-6; side1 = abs(abs(b1[0]) - W) < 1e-6 and b1[1] < H - 1e-6
            q = [a0, a1, b1, b0]
            if side0 != side1:  # ray pair straddles a top corner of the frame
                sx = b0[0] if side0 else b1[0]; q = [a0, a1, b1, (math.copysign(W, sx), H), b0]
            emit(q)  # CCW in (x right, z up) seen from −Y → front normal −Y
        return inner

    def arch_soffit(self, w_in, spring, y0, y1, segs, tile, jamb_tile=None):
        r = w_in / 2; ang = [math.pi - math.pi * k / segs for k in range(segs + 1)]
        pts = [(r * math.cos(a), spring + r * math.sin(a)) for a in ang]
        for k in range(segs):
            (x0, z0), (x1, z1) = pts[k], pts[k + 1]
            self.quad((x0, y0, z0), (x0, y1, z0), (x1, y1, z1), (x1, y0, z1), tile(k, segs) if callable(tile) else tile)
        jt = jamb_tile or tile
        self.quad((-r, y0, 0), (-r, y1, 0), (-r, y1, spring), (-r, y0, spring), jt)
        self.quad((r, y1, 0), (r, y0, 0), (r, y0, spring), (r, y1, spring), jt)

    def lion(self, cx, cy, z0, rot, s, tile, hi_tile):
        """Stylised seated guardian lion (≤ ~300 tris), facing local −Y (front), scale s ≈ shoulder height."""
        with self.at(cx, cy, z0, rot):
            self.box(0, .05 * s, 0, .55 * s, 1.0 * s, .35 * s, tile)                     # haunch base
            self.box(0, -.12 * s, .3 * s, .5 * s, .45 * s, .7 * s, tile)                  # chest
            self.cyl(0, -.2 * s, .85 * s, .36 * s, .55 * s, 8, tile, hi_tile, r2=.3 * s)  # mane
            self.box(0, -.42 * s, .98 * s, .26 * s, .26 * s, .28 * s, hi_tile)            # muzzle
            for x in (-.17, .17): self.box(x * s, -.38 * s, 0, .14 * s, .16 * s, .45 * s, tile)  # forelegs
            self.box(.22 * s, .15 * s, .3 * s, .1 * s, .5 * s, .18 * s, tile)            # tail curl / ball paw

    # ---- collision / views --------------------------------------------------------------------------------------
    def col(self, cx, cy, z0, sx, sy, h, rot=0., walk=False, tag=None):
        c = self.M @ Vector((cx, cy, z0 + h / 2)); yaw = math.atan2(self.M[1][0], self.M[0][0]) + rot
        b = dict(center=[round(c.x, 3), round(c.z, 3), round(-c.y, 3)], size=[round(sx, 3), round(h, 3), round(sy, 3)], yaw=round(yaw, 4), walkable=walk)
        if tag: b['tag'] = tag
        self.boxes.append(b)

    def view(self, name, az, el, dist, target=(0, 0, 10), lens=35, ortho=None):
        """Camera from compass azimuth `az` (deg, 0 = from north, 90 = from east), elevation `el` (deg)."""
        self.views[name] = dict(az=az, el=el, dist=dist, target=target, lens=lens, ortho=ortho)

    def tris(self):
        return sum(len(f) - 2 for p in self.parts.values() for f in p['f'])


# ---- Blender materialisation ------------------------------------------------------------------------------------
def hexrgb(h):
    h = h.lstrip('#'); c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(x / 12.92 if x <= .04045 else ((x + .055) / 1.055) ** 2.4 for x in c)


def paint_atlas(lm):
    spec = dict(size=ATLAS, seed=sum(map(ord, lm.id)), fill=P['wall'], albedo=str(TMP / f'{lm.id}_albedo.png'), emissive=str(TMP / f'{lm.id}_emissive.png'),
                tiles=[dict(name=k, kind=v['kind'], rect=v['rect'], params=v['params']) for k, v in lm.tiles.items()])
    sp = TMP / f'{lm.id}_atlas.json'; sp.write_text(json.dumps(spec, ensure_ascii=False, indent=1), encoding='utf-8')
    r = subprocess.run(['python3', '-I', str(ROOT / 'tools/landmark_atlas.py'), str(sp)], capture_output=True, text=True)
    print(r.stdout.strip(), r.stderr.strip()[-2000:], flush=True)
    if r.returncode: raise RuntimeError('atlas painter failed for ' + lm.id)
    return spec['albedo'], spec['emissive']


def make_material(lm, albedo, emissive):
    m = bpy.data.materials.new(f'{lm.id}'); m.use_nodes = True; nt = m.node_tree; b = nt.nodes['Principled BSDF']
    ta = nt.nodes.new('ShaderNodeTexImage'); ta.image = bpy.data.images.load(albedo); ta.image.pack(); ta.interpolation = 'Linear'
    te = nt.nodes.new('ShaderNodeTexImage'); te.image = bpy.data.images.load(emissive); te.image.pack()
    nt.links.new(ta.outputs['Color'], b.inputs['Base Color']); nt.links.new(te.outputs['Color'], b.inputs['Emission Color'])
    b.inputs['Emission Strength'].default_value = 1.0; b.inputs['Roughness'].default_value = .85
    b.inputs['Specular IOR Level'].default_value = .2
    m['surface'] = 'landmark'; m.use_backface_culling = True  # GLB is single-sided: renders expose flipped faces
    return m


def outline_normals(verts, faces):
    acc = {}; key = lambda p: (round(p[0], 3), round(p[1], 3), round(p[2], 3))
    for f in faces:
        pts = [Vector(verts[i]) for i in f]; n = Vector()
        for k in range(1, len(pts) - 1): n += (pts[k] - pts[0]).cross(pts[k + 1] - pts[0])  # area-weighted
        for i in f: acc[key(verts[i])] = acc.get(key(verts[i]), Vector()) + n
    out = []
    for v in verts:
        n = acc[key(v)]; out.append(n.normalized() if n.length > 1e-9 else Vector((0, 0, 1)))
    return out


def materialise(lm, coll):
    albedo, emissive = paint_atlas(lm); mat = make_material(lm, albedo, emissive)
    root = bpy.data.objects.new(lm.id, None); coll.objects.link(root); root['landmark'] = lm.id; root['title'] = lm.title
    for k, v in lm.meta.items():
        if k != 'preview': root[k] = v
    objs = []
    for name, d in lm.parts.items():
        if not d['f']: continue
        me = bpy.data.meshes.new(name); me.from_pydata(d['v'], [], d['f']); me.update()
        uvl = me.uv_layers.new(name='UVMap'); li = 0
        for poly, uvs in zip(me.polygons, d['uv']):
            for k, loop in enumerate(poly.loop_indices): uvl.data[loop].uv = uvs[k]
        for poly in me.polygons: poly.use_smooth = False
        on = outline_normals(d['v'], d['f'])
        at = me.attributes.new('_OUTLINENORMAL', 'FLOAT_VECTOR', 'POINT')
        for i, n in enumerate(on): at.data[i].vector = n
        me.materials.append(mat)
        o = bpy.data.objects.new(name, me); coll.objects.link(o); o.parent = root; objs.append(o)
    return root, objs


def export(lm, root):
    bpy.ops.object.select_all(action='DESELECT')
    for o in [root] + list(root.children_recursive): o.select_set(True)
    bpy.context.view_layer.objects.active = root
    raw = TMP / f'{lm.id}.raw.glb'
    bpy.ops.export_scene.gltf(filepath=str(raw), export_format='GLB', use_selection=True, export_yup=True, export_apply=True, export_attributes=True,
                              export_materials='EXPORT', export_cameras=False, export_lights=False, export_animations=False, export_extras=True)
    dst = OUT / f'{lm.id}.glb'
    r = subprocess.run([str(GLTF_TRANSFORM), 'meshopt', str(raw), str(dst)], capture_output=True, text=True, cwd=str(ROOT))
    if r.returncode: print(r.stdout, r.stderr); raise RuntimeError('meshopt failed ' + lm.id)
    col = dict(id=lm.id, title=lm.title, units='m', frame='local three.js: x east, y up, z south; origin = footprint centroid at grade',
               boxSchema='center [x,y,z], size [sx,sy,sz] full extents, yaw radians about +Y; walkable = may stand on top',
               boxes=lm.boxes)
    (OUT / f'{lm.id}.collision.json').write_text(json.dumps(col, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    print('EXPORTED', lm.id, 'tris', lm.tris(), 'limit', lm.tri_limit, 'bytes', dst.stat().st_size, 'boxes', len(lm.boxes), flush=True)


# ---- render ------------------------------------------------------------------------------------------------------
def setup_render():
    sc = bpy.context.scene; sc.render.engine = 'BLENDER_WORKBENCH'
    sh = sc.display.shading; sh.light = 'STUDIO'; sh.color_type = 'TEXTURE'; sh.show_shadows = True; sh.shadow_intensity = .35
    sh.show_cavity = True; sh.cavity_type = 'WORLD'; sh.show_object_outline = True; sh.object_outline_color = hexrgb('#3a2f3b')
    sh.show_backface_culling = True
    sc.display.light_direction = (-.45, -.35, .82)
    sc.world = sc.world or bpy.data.worlds.new('w'); sc.world.color = hexrgb('#cfe3ee')
    sc.render.resolution_x, sc.render.resolution_y = 960, 720; sc.render.film_transparent = False
    sc.view_settings.view_transform = 'Standard'
    return sc


def ground(coll, size=3000):
    me = bpy.data.meshes.new('ground'); s = size / 2
    me.from_pydata([(-s, -s, -.02), (s, -s, -.02), (s, s, -.02), (-s, s, -.02)], [], [(0, 1, 2, 3)])
    m = bpy.data.materials.new('ground'); m.diffuse_color = (*hexrgb('#a7c98a'), 1); me.materials.append(m)
    o = bpy.data.objects.new('ground', me); coll.objects.link(o); return o


def render_view(lm, vname, path, res=(960, 720)):
    v = lm.views[vname]; sc = bpy.context.scene
    tgt = Vector(v['target']); az, el = math.radians(v['az']), math.radians(v['el'])
    d = Vector((math.sin(az) * math.cos(el), math.cos(az) * math.cos(el), math.sin(el)))
    cam = bpy.data.objects.get('LMcam')
    if not cam:
        cam = bpy.data.objects.new('LMcam', bpy.data.cameras.new('LMcam')); sc.collection.objects.link(cam)
    cam.location = tgt + d * v['dist']; cam.rotation_euler = (tgt - cam.location).to_track_quat('-Z', 'Y').to_euler()
    cam.data.lens = v['lens']; cam.data.clip_end = 5000
    if v.get('ortho'): cam.data.type = 'ORTHO'; cam.data.ortho_scale = v['ortho']
    else: cam.data.type = 'PERSP'
    sc.camera = cam; sc.render.resolution_x, sc.render.resolution_y = res
    sc.render.filepath = str(path); bpy.ops.render.render(write_still=True)


# =================================================================================================================
# Placement helpers (world: x east, z south; local Blender: x east, y north)
# =================================================================================================================
STRUCT = json.loads((ROOT / 'public/data/walkthrough/campus-structure.json').read_text(encoding='utf-8'))
OSM_LM = {l['id']: l for l in STRUCT['context']['landmarks']}
PLACEMENTS = {}


def centroid(poly):
    A = cx = cz = 0.
    for i in range(len(poly)):
        x0, z0 = poly[i]; x1, z1 = poly[(i + 1) % len(poly)]; c = x0 * z1 - x1 * z0; A += c; cx += (x0 + x1) * c; cz += (z0 + z1) * c
    A /= 2; return (cx / (6 * A), cz / (6 * A))


def osm_local(world_poly):
    """World polygon [[x,z]] → (local Blender polygon [(x, y_north)], centroid [x, z])."""
    cx, cz = centroid(world_poly)
    return [(x - cx, -(z - cz)) for x, z in world_poly], [round(cx, 2), round(cz, 2)]


def place(lid, osm_id, cxz, yaw=0., note='', **extra):
    PLACEMENTS[lid] = dict(osmId=osm_id, centroid=[round(cxz[0], 2), round(cxz[1], 2)], yaw=round(yaw, 4), note=note, **extra)


# =================================================================================================================
# Landmarks
# =================================================================================================================
LANDMARKS = {}


def landmark(fn):
    LANDMARKS[fn.__name__.replace('lm_', '').replace('_', '-')] = fn; return fn


@landmark
def lm_smoke():
    lm = LM('smoke', 'pipeline smoke test', 500)
    lm.tile('win', 'window', wall=P['brick'], lit='lit'); lm.tile('win_off', 'window', wall=P['brick'], lit='off')
    roof = lm.solid(P['roof'])
    lm.box(0, 0, 0, 12, 9, 7.4, lambda i, j, nx, ny: 'win' if (i + j) % 4 else 'win_off', roof, cell=(BAY, STOREY), col=True)
    lm.view('main', 200, 15, 30, (0, 0, 4))
    return lm


def mound(lm, cx, cy, rx, ry, h, rings, segs, tile, cut=None, z0=-.3):
    """Low-poly hill dome (ellipsoid cap) with optional rectangular notch (x0, x1, y_max) cut out in front."""
    pts = []
    for r in range(rings + 1):
        t = r / rings; rad = math.cos(t * math.pi / 2); z = z0 + (h - z0) * math.sin(t * math.pi / 2)
        pts.append([(cx + rx * rad * math.cos(2 * math.pi * k / segs), cy + ry * rad * math.sin(2 * math.pi * k / segs), z) for k in range(segs)])
    for r in range(rings):
        for k in range(segs):
            k1 = (k + 1) % segs; q = [pts[r][k], pts[r][k1], pts[r + 1][k1], pts[r + 1][k]]
            if cut and cut(sum((Vector(p) for p in q), Vector()) / 4): continue
            if r == rings - 1: lm.face([q[0], q[1], q[2]], tile)
            else: lm.face(q, tile)


# ---- shared kit helpers -------------------------------------------------------------------------------------------
def fn(t):
    return t if callable(t) else (lambda i, j, nx, ny: t)


def rows(*spec):
    """rows((j_end, tile|fn), ...): pick per storey row j; last entry is the default."""
    def pick(i, j, nx, ny):
        for jend, t in spec:
            if j < jend: return fn(t)(i, j, nx, ny)
        return fn(spec[-1][1])(i, j, nx, ny)
    return pick


def cols(default, special):
    """special: f(i, nx) -> tile|None overriding the default for some bay columns."""
    def pick(i, j, nx, ny):
        t = special(i, j, nx, ny); return fn(t)(i, j, nx, ny) if t else fn(default)(i, j, nx, ny)
    return pick


def wintiles(lm, name, kind='window', span=(2, 2), **params):
    """Register lit / warm / off variants of one window tile; returns a picker with the art-direction §2
    night rhythm (2×2 block: 3 lit, 1 dark) plus a few warm windows."""
    for lit in ('lit', 'warm', 'off'): lm.tile(f'{name}~{lit}', kind, span=span, lit=lit, **params)
    salt = sum(map(ord, name))
    def pick(i, j, nx, ny):
        h = (i * 73 + j * 151 + salt) % 11
        return f'{name}~' + ('off' if (i % 2 and j % 2) else ('warm' if h < 2 else 'lit'))
    return pick


def col_poly(lm, poly, z0, h, step=2.0, walk=False):
    """Approximate a footprint polygon by merged axis-aligned boxes (raster runs) for collision."""
    xs = [p[0] for p in poly]; ys = [p[1] for p in poly]
    def inside(x, y):
        c = False; n = len(poly)
        for k in range(n):
            (x0, y0), (x1, y1) = poly[k], poly[(k + 1) % n]
            if (y0 > y) != (y1 > y) and x < x0 + (y - y0) * (x1 - x0) / (y1 - y0): c = not c
        return c
    runs = []
    y = min(ys) + step / 2
    while y < max(ys):
        x = min(xs) + step / 2; start = None
        while x < max(xs) + step:
            ins = x < max(xs) and inside(x, y)
            if ins and start is None: start = x
            if not ins and start is not None: runs.append([start - step / 2, x - step / 2, y - step / 2, y + step / 2]); start = None
            x += step
        y += step
    merged = []
    for r in runs:  # merge vertically when x-span identical
        for m in merged:
            if abs(m[0] - r[0]) < 1e-6 and abs(m[1] - r[1]) < 1e-6 and abs(m[3] - r[2]) < 1e-6: m[3] = r[3]; break
        else: merged.append(r[:])
    for x0, x1, y0, y1 in merged: lm.col((x0 + x1) / 2, (y0 + y1) / 2, z0, x1 - x0, y1 - y0, h, walk=walk)


def hip(lm, cx, cy, z, sx, sy, rise, inset, tile, top_tile, rot=0., over=.4):
    with lm.at(cx, cy, z, rot):
        o = [(-sx / 2 - over, -sy / 2 - over), (sx / 2 + over, -sy / 2 - over), (sx / 2 + over, sy / 2 + over), (-sx / 2 - over, sy / 2 + over)]
        i = [(-sx / 2 + inset, -sy / 2 + inset), (sx / 2 - inset, -sy / 2 + inset), (sx / 2 - inset, sy / 2 - inset), (-sx / 2 + inset, sy / 2 - inset)]
        for k in range(4):
            a, b = o[k], o[(k + 1) % 4]; c, d = i[(k + 1) % 4], i[k]
            lm.quad((*a, 0), (*b, 0), (*c, rise), (*d, rise), tile)
        lm.face([(x, y, rise) for x, y in i], top_tile)
        lm.face([(x, y, 0) for x, y in o[::-1]], tile)


def ring(lm, cx, cy, z0, ro, ri, h, n, tile, top=None):
    """Annulus (doughnut slab): outer wall, inner wall (facing the centre), top and bottom rings."""
    P2 = lambda r, k: (cx + r * math.cos(2 * math.pi * k / n), cy + r * math.sin(2 * math.pi * k / n))
    for k in range(n):
        a, b, c, d = P2(ro, k), P2(ro, k + 1), P2(ri, k), P2(ri, k + 1)
        lm.quad((*a, z0), (*b, z0), (*b, z0 + h), (*a, z0 + h), tile)
        lm.quad((*d, z0), (*c, z0), (*c, z0 + h), (*d, z0 + h), tile)
        lm.face([(*a, z0 + h), (*b, z0 + h), (*d, z0 + h), (*c, z0 + h)], top or tile)
        lm.face([(*c, z0), (*d, z0), (*b, z0), (*a, z0)], tile)


def curved(lm, cx, cy, z0, r, h, a0, a1, segs, tile, cap=None):
    """Curved wall (cylinder sector a0→a1 radians, CCW) with ONE tile stretched along it (curved signage)."""
    for k in range(segs):
        t0, t1 = a0 + (a1 - a0) * k / segs, a0 + (a1 - a0) * (k + 1) / segs
        p0 = (cx + r * math.cos(t0), cy + r * math.sin(t0)); p1 = (cx + r * math.cos(t1), cy + r * math.sin(t1))
        lm.face([(*p0, z0), (*p1, z0), (*p1, z0 + h), (*p0, z0 + h)], tile, [(k / segs, 0), ((k + 1) / segs, 0), ((k + 1) / segs, 1), (k / segs, 1)])
    if cap:
        pts = [(cx + r * math.cos(a0 + (a1 - a0) * k / segs), cy + r * math.sin(a0 + (a1 - a0) * k / segs)) for k in range(segs + 1)]
        lm.face([(x, y, z0 + h) for x, y in pts], cap); lm.face([(x, y, z0) for x, y in pts[::-1]], cap)


def plate(lm, x0, x1, y, z0, z1, tile, out=.06, normal=-1):
    """Thin proud plate on a wall plane y (normal −Y if normal = −1, else +Y), x0 < x1 seen from outside."""
    if normal < 0:
        lm.box((x0 + x1) / 2, y - out / 2, z0, x1 - x0, out, z1 - z0, lm.solid('#8a8478'), lm.solid('#8a8478'))
        lm.quad((x0, y - out - .005, z0), (x1, y - out - .005, z0), (x1, y - out - .005, z1), (x0, y - out - .005, z1), tile)
    else:
        lm.box((x0 + x1) / 2, y + out / 2, z0, x1 - x0, out, z1 - z0, lm.solid('#8a8478'), lm.solid('#8a8478'))
        lm.quad((x1, y + out + .005, z0), (x0, y + out + .005, z0), (x0, y + out + .005, z1), (x1, y + out + .005, z1), tile)


def tetrapod(lm, x, y, z, s, tile, rot=0.):
    with lm.at(x, y, z, rot):
        lm.cyl(0, 0, 0, .55 * s, .6 * s, 4, tile, tile, r2=.35 * s)
        lm.cyl(0, 0, .6 * s, .35 * s, .55 * s, 4, tile, None, r2=.05 * s)
        lm.box(0, 0, .05 * s, 1.5 * s, .35 * s, .35 * s, tile, tile, rot=.6)


def crenel_wall(lm, length, color, cap, ball, pitch=1.6, seat_col=None, col=True):
    """Seawall parapet with 蘿蔔坑 niches along local X (−length/2..+length/2) at y ∈ [0, .6]:
    merlons 0.65 m wide × 1.1 m with cap + ball finial, crenel seats 0.5 m high between them."""
    n = max(1, round(length / pitch)); p = length / n
    for k in range(n):
        x = -length / 2 + p * (k + .5) - p / 2 + .325  # merlon at the start of each pitch
        lm.box(x, .3, 0, .65, .6, 1.0, color, color)
        lm.box(x, .3, 1.0, .78, .72, .1, cap, cap)
        lm.cyl(x, .3, 1.1, .14, .16, 6, ball, None, r2=.16); lm.cyl(x, .3, 1.26, .16, .14, 6, ball, ball, r2=.09)
        lm.box(x + .325 + (p - .65) / 2, .3, 0, p - .65, .6, .5, seat_col or color, cap)
        if col: lm.col(x, .3, 0, .65, .6, 1.1)
    if col: lm.col(0, .3, 0, length, .6, .5, walk=True, tag='niche-seats')


# =================================================================================================================
# 1 行政大樓 admin — refs: docs/reference/landmarks/admin.md (Commons File:NSYSU_Admin_building_20260207.jpg et al.)
#   Front (portico, lions) faces SOUTH. Top two storeys = brick box cantilevered on diagonal struts; 4 full-height
#   round concrete columns; recessed 3–4F concrete grid; semicircular 3F balcony "行政大樓"; segmental arch loggia.
# =================================================================================================================
@landmark
def lm_admin():
    lm = LM('admin', '行政大樓', 4000)
    wp = OSM_LM['AD']['polygon']; _, c = osm_local(wp)
    yaw = -math.atan2(wp[2][1] - wp[3][1], wp[2][0] - wp[3][0])  # south edge (-92.4,51.1)->(-47.0,51.8)
    place('admin', OSM_LM['AD']['osmId'], c, yaw, '軸對齊模型 45.4×38.6 m（OSM 矩形，偏 0.9°）；正面（門廊、銅獅）朝南 +z。')
    brick, conc, dark = '#a9503f', '#c4c0b6', '#3b3a36'
    B = lm.tile('brick', 'brick', span=(2, 2), color=brick); C = lm.solid(conc); R = lm.solid(P['roof'])
    base = wintiles(lm, 'base', wall=brick, win=(.1, .32, .9, .74), mull=3, sill=conc)
    door = wintiles(lm, 'door', wall=conc, wall_kind='solid', win=(.04, .04, .96, 1), mull=2, transom=.3, sill=None)
    grid = wintiles(lm, 'grid', wall=conc, wall_kind='solid', win=(.1, .14, .9, .86), mull=2, transom=.5, sill=None)
    ribbon = wintiles(lm, 'ribbon', kind='band', stripes=[[0, .16, conc], [.16, .84, 'glass'], [.84, 1, conc]], mull=2)
    arch = lm.tile('arch', 'arch', span=(4, 2), wall=brick, box=(.06, .18, .94, 1), shape='segment', rail=dark)
    fan = lm.tile('fan', 'arch', span=(2, 2), wall=brick, box=(.22, .35, .78, .9), shape='semi', lit='warm')
    txt = lm.tile('name', 'text', span=(8, 1), text='學 大 山 中 立 國', bg=brick, fg=P['gold'], vertical=False, em='#c9a048')
    balc = lm.tile('balc', 'text', span=(6, 1), text='樓 大 政 行', bg=brick, fg=P['gold'], vertical=False, em='#c9a048')
    BR, BRZ = lm.solid(P['bronze']), lm.solid(P['bronze_hi'])
    HX, HY = 22.7, 19.3; mx, my0, my1 = 17.0, -15.0, 17.0
    # 1–2F brick base with full-height entrance glass in the middle bays
    front = cols(base, lambda i, j, nx, ny: door if abs(i - (nx - 1) / 2) < 2.1 else None)
    lm.prism([(-mx, my0), (mx, my0), (mx, my1), (-mx, my1)], 0, 7.4, [front, base, base, base], R, cell=(3.4, 3.7))
    # 3–4F concrete grid, slab edges + fins
    lm.prism([(-mx, my0), (mx, my0), (mx, my1), (-mx, my1)], 7.4, 15.6, grid, None, cell=(3.4, 4.1))
    for z in (7.1, 11.3): lm.band([(-mx, my0), (mx, my0), (mx, my1), (-mx, my1)], z, .45, .55, C)
    for k in range(-5, 6):
        lm.box(k * 3.4, my0 - .3, 7.4, .35, .6, 8.2, C, C)
    # cantilevered top box: ribbon storey + brick attic with arch loggia, fanlights and the name
    top = [(-HX, -HY), (HX, -HY), (HX, HY), (-HX, HY)]
    lm.prism(top, 15.6, 19.4, ribbon, None, cell=(3.6, 3.8), bottom=C)
    lm.prism(top, 19.4, 25.6, B, R, cell=(4, 3.1), sides={1, 2, 3})
    y = -HY
    lm.quad((-HX, y, 19.4), (-HX + 3.4, y, 19.4), (-HX + 3.4, y, 22.4), (-HX, y, 22.4), fan)
    lm.quad((HX - 3.4, y, 19.4), (HX, y, 19.4), (HX, y, 22.4), (HX - 3.4, y, 22.4), fan)
    lm.quad((-HX, y, 22.4), (-6.5, y, 22.4), (-6.5, y, 25.6), (-HX, y, 25.6), B, 4, 1)
    lm.quad((6.5, y, 22.4), (HX, y, 22.4), (HX, y, 25.6), (6.5, y, 25.6), B, 4, 1)
    lm.quad((-HX + 3.4, y, 19.4), (-6.5, y, 19.4), (-6.5, y, 22.4), (-HX + 3.4, y, 22.4), B, 3, 1)
    lm.quad((6.5, y, 19.4), (HX - 3.4, y, 19.4), (HX - 3.4, y, 22.4), (6.5, y, 22.4), B, 3, 1)
    lm.quad((-6.5, y, 19.4), (6.5, y, 19.4), (6.5, y, 23.6), (-6.5, y, 23.6), arch)
    lm.quad((-6.5, y, 23.6), (6.5, y, 23.6), (6.5, y, 25.6), (-6.5, y, 25.6), B, 3, 1)
    plate(lm, -13, 13, y, 24.1, 25.3, txt, out=.05)
    lm.band(top, 25.6, .35, .15, C)
    lm.box(0, 2, 25.95, 9, 6, 3.0, B, R)                                    # lift machine room
    lm.cyl(0, -HY + 1, 25.95, .07, 6, 4, C, None)                            # flagpole
    for sx in (-1, 1):  # diagonal struts under the cantilever (front, middle, back)
        for yy in (-HY + .4, 0, HY - .4):
            lm.face([(sx * mx, yy - .3, 11.6), (sx * HX, yy - .3, 15.6), (sx * mx, yy - .3, 15.6)][::sx], C)
            lm.face([(sx * mx, yy + .3, 11.6), (sx * mx, yy + .3, 15.6), (sx * HX, yy + .3, 15.6)][::sx], C)
            lm.quad(*([(sx * mx, yy - .3, 11.6), (sx * mx, yy + .3, 11.6), (sx * HX, yy + .3, 15.6), (sx * HX, yy - .3, 15.6)][::sx]), C)
    # four full-height round columns
    for x in (-15.2, -4.8, 4.8, 15.2):
        lm.cyl(x, -17.6, 0, .8, 15.6, 10, C, None); lm.col(x, -17.6, 0, 1.6, 1.6, 15.6)
    # semicircular balcony (3F) + canopy over the door
    curved(lm, 0, my0, 8.0, 4.4, 2.8, math.pi, 2 * math.pi, 10, balc, cap=C)
    lm.box(0, my0 - 2.0, 6.7, 12.5, 4.0, .5, C, C)
    # entrance steps, lion pedestals, lions
    lm.stairs(0, -21.3, 0, 18, 2.4, .45, 3, lm.solid('#cfc9bb'))
    for x in (-3.4, 3.4):
        lm.box(x, -20.2, 0, 1.6, 2.4, 1.2, lm.solid(P['stone']), lm.solid(P['stone']), col=True)
        lm.lion(x, -20.2, 1.2, 0, 1.3, BR, BRZ)
    lm.col(0, 1, 0, 2 * mx, my1 - my0, 15.6); lm.col(0, 0, 15.6, 2 * HX, 2 * HY, 10)
    lm.col(0, my0 - 2, 6.7, 12.5, 4, .5, walk=True)
    lm.view('front', 180, 6, 78, (0, -10, 12), lens=30)
    lm.view('oblique', 215, 28, 110, (0, 0, 10), lens=35)
    return lm


# =================================================================================================================
# 2 圖資大樓 library — refs: docs/reference/landmarks/library.md (Commons, 01/02/05). Brick slab tower ~12F, 4 half-round
#   pilasters → 3 bays on the south face; flat-topped cantilevered "crown" box with chamfered corners and 3 segmental
#   arch recesses per bay; white circular rotunda (ring roof on ~10 columns) + fan stairs in front (south).
# =================================================================================================================
@landmark
def lm_library():
    lm = LM('library', '圖資大樓', 6000)
    poly, c = osm_local(OSM_LM['IL']['polygon'])
    place('library', OSM_LM['IL']['osmId'], c, 0., '多邊形直接用 OSM 輪廓；塔樓與正前方白色圓亭朝南（中庭）。圓亭超出 OSM 輪廓約 12 m。')
    brick, white = '#a9503f', '#efece4'
    R = lm.solid(P['roof']); W = lm.solid(white); B = lm.tile('brick', 'brick', span=(2, 2), color=brick)
    pod = wintiles(lm, 'pod', wall=brick, win=(.12, .3, .88, .72), mull=2)
    tw = wintiles(lm, 'tw', wall=brick, win=(.06, .3, .94, .74), mull=4, frame='#e9e4dc', sill=None)
    crown = lm.tile('crown', 'arch', span=(4, 2), wall=brick, box=(.08, .3, .92, .9), shape='segment')
    name = lm.tile('name', 'text', span=(8, 1), text='樓大訊資書圖', bg=brick, fg=P['gold'], vertical=False, em='#c9a048')
    ys = [p[1] for p in poly]; south = min(ys)
    lm.prism(poly, 0, 8.2, pod, R, cell=(3.4, 4.1))
    lm.parapet(poly, 8.2, .9, .3, B, lm.solid(P['trim']))
    col_poly(lm, poly, 0, 9.1)
    tx, ty0, ty1, top = 15.0, south + 4, south + 44, 36.6
    lm.prism([(-tx, ty0), (tx, ty0), (tx, ty1), (-tx, ty1)], 8.2, top, tw, None, cell=(3.33, 3.55))
    lm.col(0, (ty0 + ty1) / 2, 0, 2 * tx, ty1 - ty0, 45)
    for x in (-tx, -tx / 3, tx / 3, tx): lm.cyl(x, ty0, 8.2, .8, top - 8.2, 8, B, None)
    for yy in (ty0 + 10, ty0 + 20, ty0 + 30):
        for x in (-tx, tx): lm.cyl(x, yy, 8.2, .7, top - 8.2, 8, B, None)
    # crown: chamfered cantilevered box, splayed underside, 3 arch recesses per front bay group
    o, ch = 1.6, 2.6; X0, X1, Y0, Y1 = -tx - o, tx + o, ty0 - o, ty1 + o
    cr = [(X0 + ch, Y0), (X1 - ch, Y0), (X1, Y0 + ch), (X1, Y1 - ch), (X1 - ch, Y1), (X0 + ch, Y1), (X0, Y1 - ch), (X0, Y0 + ch)]
    edge_tiles = [crown if k in (0, 2, 4, 6) else B for k in range(8)]
    lm.prism(cr, top + 1.2, top + 8.4, edge_tiles, R, cell=(9.0, 7.2))
    inner = [(-tx, ty0), (tx, ty0), (tx, ty1), (-tx, ty1)]
    lm.prism(inner, top, top + 1.2, B, None)
    lm.band(inner, top + .4, .8, o * .6, lm.solid('#94463a'))
    plate(lm, -9, 9, Y0, top + 6.9, top + 8.1, name, out=.05)
    lm.parapet(cr, top + 8.4, .6, .3, B, lm.solid(P['trim']))
    lm.box(0, (ty0 + ty1) / 2 + 6, top + 8.4, 10, 8, 3.2, B, R)
    # rotunda + fan stairs + seated statue
    rc = south - 11.5
    lm.cyl(0, rc, 0, 11.0, 1.2, 20, lm.solid('#d9d2c2'), lm.solid(P['plaza']))
    for r, h in ((13.2, .8), (15.2, .4)): lm.cyl(0, rc - 2.2 + 2.2, 0, r, h, 20, lm.solid('#d9d2c2'), lm.solid('#d9d2c2'))
    ring(lm, 0, rc, 7.6, 10.6, 6.8, 2.8, 20, W, W)
    for k in range(10):
        a = 2 * math.pi * (k + .5) / 10; lm.cyl(8.4 * math.cos(a), rc + 8.4 * math.sin(a), 1.2, .65, 6.4, 8, W, None)
        lm.col(8.4 * math.cos(a), rc + 8.4 * math.sin(a), 1.2, 1.1, 1.1, 6.8)
    lm.box(0, rc + 1.5, 1.2, 1.6, 1.6, 1.2, lm.solid(P['stone']), lm.solid(P['stone']))
    lm.box(0, rc + 1.5, 2.4, 1.0, 1.1, 1.6, lm.solid(P['bronze']), lm.solid(P['bronze_hi']))
    for s, h in ((15.2, .4), (13.2, .8), (11.0, 1.2)):
        lm.col(0, rc, 0, s * 1.414, s * 1.414, h, walk=True); lm.col(0, rc, 0, s * 1.414, s * 1.414, h, rot=math.pi / 4, walk=True)
    lm.view('front', 180, 8, 140, (0, south - 10, 20), lens=35)
    lm.view('corner', 135, 18, 150, (0, 0, 22), lens=35)
    return lm


# =================================================================================================================
# 3 文學院 liberal-arts — refs: docs/reference/landmarks/liberal-arts.md (Commons 01 far view; blog 03 arcade, ref only).
#   Hillside orange-red tile blocks 5F, two-storey semicircular brick arcade on the entrance terrace, an octagonal
#   stair tower and a wedge-topped tower; footprint NOT in OSM → generic replaceable block (【待查證】).
# =================================================================================================================
@landmark
def lm_liberal_arts():
    lm = LM('liberal-arts', '文學院', 3000)
    la = next(m for m in json.loads((ROOT / 'artifacts/v3/T3/corrections.json').read_text(encoding='utf-8'))['missing'] if m['id'] == 'LA')
    place('liberal-arts', None, la['world'], 0., '待 T3 對位：OSM 無文學院輪廓；T3 以藝術大樓偏移推估 ±60 m，山坡地形約 +52 m（elevation 取 Terrain.heightAt）。量體為可替換的通用院館。',
          elevation=None, uncertainty_m=la.get('uncertainty_m'))
    brick = '#b85a45'; B = lm.tile('brick', 'brick', span=(2, 2), color=brick); R = lm.solid(P['roof']); T = lm.solid(P['trim'])
    win = wintiles(lm, 'win', wall=brick, win=(.18, .26, .82, .76), mull=1)
    arch = lm.tile('arch', 'arch', span=(2, 3), wall=brick, box=(.12, .06, .88, 1), shape='semi', lit='warm')
    roof = lm.tile('rooftile', 'grid', span=(2, 2), color='#c9573c', line='#9c3f2c', n=6)
    main = [(-32, -9), (32, -9), (32, 9), (-32, 9)]; wing = [(14, 9), (32, 9), (32, 46), (14, 46)]
    lm.prism(main, 0, 18.5, win, R, cell=(3.0, 3.7)); lm.parapet(main, 18.5, .9, .3, B, T)
    lm.prism(wing, 0, 14.8, win, None, cell=(3.0, 3.7), sides={1, 2, 3})
    lm.gable(23, 27.5, 14.8, 18, 37, 4.0, roof, B, along_x=False)
    for p in (main,): col_poly(lm, p, 0, 19.4)
    lm.col(23, 27.5, 0, 18, 37, 18.8)
    # two-storey semicircular arcade in front (south) on a terrace
    lm.box(0, -13.5, 0, 66, 9, .9, lm.solid('#c98d7a'), lm.solid(P['plaza']), col=True, walk=True)
    n, bw = 12, 4.6; y = -15.5
    for k in range(n):
        x = -n * bw / 2 + bw * (k + .5)
        with lm.at(x, y, .9):
            lm.arch_face(3.6, 5.2, bw, 8.2, 0, 6, B)
            lm.arch_soffit(3.6, 5.2, 0, 1.0, 6, lm.solid('#94463a'))
        lm.col(x - bw / 2 + .5, y + .5, .9, 1.0, 1.0, 7.3)
    lm.box(0, y + 2.2, 9.1, n * bw, 4.4, .6, B, T)
    lm.prism([(-n * bw / 2, y + 1), (n * bw / 2, y + 1), (n * bw / 2, y + 4.4), (-n * bw / 2, y + 4.4)], .9, 9.1, B, None, sides={1, 3})
    lm.quad((-n * bw / 2, y + .02, 9.1), (n * bw / 2, y + .02, 9.1), (n * bw / 2, y + .02, 9.7), (-n * bw / 2, y + .02, 9.7), T)
    lm.stairs(0, -24, 0, 20, 2.8, .9, 4, lm.solid('#c98d7a'))
    # towers: octagonal stair tower (west) with pyramid cap, wedge-topped tower at the junction
    lm.cyl(-34, 4, 0, 4.0, 23, 8, B, None); lm.cyl(-34, 4, 23, 4.6, 4.2, 8, roof, None, r2=.2)
    lm.col(-34, 4, 0, 7, 7, 23)
    lm.box(14, 11, 0, 7, 7, 22, B, None)
    lm.quad((10.5, 7.5, 22), (17.5, 7.5, 22), (17.5, 14.5, 26.5), (10.5, 14.5, 26.5), roof)
    lm.face([(17.5, 7.5, 22), (17.5, 14.5, 22), (17.5, 14.5, 26.5)], B); lm.face([(10.5, 14.5, 22), (10.5, 7.5, 22), (10.5, 14.5, 26.5)], B)
    lm.face([(10.5, 14.5, 22), (10.5, 14.5, 26.5), (17.5, 14.5, 26.5), (17.5, 14.5, 22)], B)
    lm.view('arcade', 200, 6, 42, (4, -14, 6), lens=28)
    lm.view('far', 250, 6, 220, (0, 10, 10), lens=50)
    return lm


# =================================================================================================================
# 4 理工長廊 sci-eng-arcade (modular kit) — refs: docs/reference/landmarks/sci-eng-arcade.md (Commons 01–03).
#   EVIDENCE: flat-soffit post-and-beam colonnade = the open ground storey of the 4F brick wings; square brick piers,
#   no arches (art-direction §8.6 agrees). Module 4.5 m along local X; lawn side = local −Y (Blender) = three +Z;
#   building side +Y. Parts: arcade-bay, arcade-bay-poster, arcade-end (closing wall at +X).
# =================================================================================================================
@landmark
def lm_sci_eng_arcade():
    lm = LM('sci-eng-arcade', '理工長廊', 1600)
    place('sci-eng-arcade', 269874273, (-45.0, -7.0), 0., '模組套件：沿 path 每 4.5 m 放一個 arcade-bay（每 4 個換一個 poster 版），'
          '模組本地 −Y(Blender)/+Z(three) 朝中庭草坪；東側理工翼沿 OSM 理工學院西緣 x≈−42.5。門洞需對齊 access-plan 入口（待 T4 整合／T3 對位）。',
          path=[[-45.0, -140.0], [-45.0, 126.0]], moduleLength=4.5, lawnSide='west', parts=['arcade-bay', 'arcade-bay-poster', 'arcade-end'])
    brick = '#a9503f'; B = lm.tile('brick', 'brick', span=(2, 2), color=brick); T = lm.solid(P['trim'])
    up = wintiles(lm, 'up', wall=brick, win=(.08, .24, .92, .74), mull=2)
    back = wintiles(lm, 'back', wall=brick, win=(.12, .1, .88, .8), mull=2, transom=.6)
    floor_t = lm.tile('floor', 'grid', span=(2, 2), color=P['plaza'], line='#bfb29a', n=4); ceil = lm.solid('#efe6d1')
    poster = lm.tile('poster', 'poster', span=(4, 2)); wood = lm.solid(P['wood'])

    def bay(name, posters=False):
        lm.part(name); L, D = 4.5, 4.6; x0, x1 = -L / 2, L / 2; yo, yb = -D / 2, D / 2
        lm.quad((x0, yo, 0), (x1, yo, 0), (x1, yb, 0), (x0, yb, 0), floor_t)
        lm.col(0, 0, -.3, L, D, .3, walk=True)
        lm.box(x0, yo + .1, 0, .9, 1.3, 4.0, B, None); lm.col(x0, yo + .1, 0, .9, 1.3, 4.0)  # square brick pier
        lm.wall((x0, yb), (x1, yb), 0, 4.0, back)  # faces the corridor (−Y)
        lm.col(0, yb + .15, 0, L, .3, 4.0)
        lm.quad((x0, yb, 4.0), (x1, yb, 4.0), (x1, yo, 4.0), (x0, yo, 4.0), ceil)  # soffit (faces down)
        lm.box(0, yo - .1, 4.0, L, .6, .8, B, T)                                     # flat beam band
        lm.wall((x0, yo + .3), (x1, yo + .3), 4.8, 15.9, up, cell=(4.5, 3.7))         # upper storeys
        lm.box(x0, yo, 4.8, .9, .7, 11.1, B, None)                                    # pier continues as pilaster
        lm.box(0, yo + .6, 15.9, L, 1.6, .6, T, T)                                    # coping
        lm.quad((x0, yo + 1.4, 16.5), (x1, yo + 1.4, 16.5), (x1, yb, 16.5), (x0, yb, 16.5), lm.solid(P['roof']))
        if posters:
            lm.box(0, yb - .08, .9, 1.9, .12, 1.3, lm.solid('#3b3a36'), None); lm.quad((-.9, yb - .145, .95), (.9, yb - .145, .95), (.9, yb - .145, 2.15), (-.9, yb - .145, 2.15), poster)
            lm.box(0, yb - 1.0, 0, 1.8, .45, .45, wood, wood); lm.col(0, yb - 1.0, 0, 1.8, .45, .45, walk=True)
    bay('arcade-bay'); bay('arcade-bay-poster', True)
    lm.part('arcade-end'); lm.box(2.4, 0, 0, .3, 4.6, 16.5, B, T); lm.col(2.4, 0, 0, .3, 4.6, 16.5)
    lm.meta['kit'] = 'parts at the same origin; preview render lays them out'
    lm.meta['preview'] = {'arcade-bay': [(-4.5 * k, 0) for k in range(1, 8) if k != 4], 'arcade-bay-poster': [(-18.0, 0)], 'arcade-end': [(-36.3, 0)]}
    lm.view('along', 240, 6, 34, (-14, -2, 6), lens=28)
    lm.view('lawn', 180, 4, 45, (-14, 0, 8), lens=30)
    return lm


# =================================================================================================================
# 5 西子灣隧道 tunnel (campus west portal + 20 m walkable stub) — refs: docs/reference/landmarks/tunnel.md (Commons).
#   Cream rendered portal (not grey stone), semicircular arch ringed by projecting voussoirs + keystone, pilasters,
#   cornice; plaque blank (west-portal inscription 【待查證】; the east portal reads 西子灣隧道). Smooth rendered barrel
#   vault inside, low kerb seats both sides, grey paving with red bands. Origin = portal centre at grade; the tunnel
#   runs along local +Y (Blender) into the hill; yaw aligns it with OSM way 25822227.
# =================================================================================================================
@landmark
def lm_tunnel():
    lm = LM('tunnel', '西子灣隧道口', 2500)
    w, e = (19.9, 148.5), (282.1, 223.1)
    # second point of the way, 260.39,214.71 → use the last segment direction (into the hill = toward east)
    dx, dz = 260.39 - w[0], 214.71 - w[1]; L = math.hypot(dx, dz); dx, dz = dx / L, dz / L
    place('tunnel', 25822227, w, math.atan2(-dx, -dz), '原點 = 校園側西洞口中心（OSM way 25822227 端點，T3 TUNNEL_W）；本地 −Z(three) 指向隧道內（東）。'
          '只做洞口＋20 m 可走段，東口 (282.1,223.1) 不在範圍。', eastPortal=list(e), walkableLength=20)
    cream, trim, dark = '#e7e1d2', '#d6cdb8', '#2f3537'
    Cr = lm.tile('cream', 'stone', span=(2, 2), color=cream, dark='#ddd6c5', rows=2, cols=1); Tr = lm.solid(trim)
    V = lm.solid('#f1ece0'); K = lm.solid('#cfc6b0'); panels = lm.tile('panels', 'window', span=(2, 1), wall=cream, wall_kind='solid', win=(.2, .2, .8, .8), lit='off', mull=0, sill=None, frame='#c9c0aa')
    lining = lm.tile('lining', 'lamp', span=(2, 2), color='#c9c6bd'); plain = lm.solid('#bdb9ae')
    floor_t = lm.tile('pave', 'stripes', span=(2, 2), colors=['#8f8a84', '#9c968f', '#a8433a', '#9c968f', '#8f8a84', '#9c968f', '#a8433a', '#9c968f'])
    fog = lm.tile('fog', 'band', span=(2, 2), stripes=[[0, 1, '#1d2730']]); leaf = lm.tile('leaf', 'foliage', span=(2, 2))
    plaque = lm.tile('plaque', 'solid', color='#d2c9b4')  # west-portal inscription 【待查證】: blank recessed panel
    W, H, D = 16.0, 9.6, 1.6; wi, sp = 6.6, 2.5; r = wi / 2; depth = 20.0
    lm.arch_face(wi, sp, W, H, 0, 12, Cr)                                    # portal face (normal −Y)
    lm.arch_soffit(wi, sp, 0, D, 12, plain)
    lm.quad((W / 2, 0, 0), (W / 2, D, 0), (W / 2, D, H), (W / 2, 0, H), Cr); lm.quad((-W / 2, D, 0), (-W / 2, 0, 0), (-W / 2, 0, H), (-W / 2, D, H), Cr)
    # voussoirs + keystone (geometry: outlines catch them)
    nv = 13
    for k in range(nv):
        a0 = math.pi - math.pi * k / nv; a1 = math.pi - math.pi * (k + 1) / nv; am = (a0 + a1) / 2; g = .02
        ri, ro = r, r + (1.25 if k == nv // 2 else .95)
        pts = [(ri * math.cos(a0 - g), sp + ri * math.sin(a0 - g)), (ri * math.cos(a1 + g), sp + ri * math.sin(a1 + g)),
               (ro * math.cos(a1 + g), sp + ro * math.sin(a1 + g)), (ro * math.cos(a0 - g), sp + ro * math.sin(a0 - g))]
        y0 = -.18 if k != nv // 2 else -.3; t = K if k == nv // 2 else V
        lm.face([(x, y0, z) for x, z in pts], t)
        for q in range(4):
            (xa, za), (xb, zb) = pts[q], pts[(q + 1) % 4]
            lm.face([(xa, y0, za), (xa, 0, za), (xb, 0, zb), (xb, y0, zb)][::-1] if q in (0,) else [(xa, y0, za), (xa, 0, za), (xb, 0, zb), (xb, y0, zb)][::-1], t)
    for x in (-5.4, 5.4): lm.box(x, -.12, 0, 1.0, .24, H - 1.2, Tr, Tr)       # pilasters
    lm.box(0, -.2, H - 1.2, W + .6, .4, .5, Tr, Tr); lm.box(0, .4, H - .7, W + .2, 1.6, .7, Cr, Tr)  # cornice + parapet
    plate(lm, -3.2, 3.2, -.12, 7.25, 8.25, plaque, out=.06)
    lm.quad((-7.6, -.02, 6.4), (-6.0, -.02, 6.4), (-6.0, -.02, 7.6), (-7.6, -.02, 7.6), panels)
    lm.quad((6.0, -.02, 6.4), (7.6, -.02, 6.4), (7.6, -.02, 7.6), (6.0, -.02, 7.6), panels)
    for sx in (-1, 1):  # stepped wing walls
        lm.box(sx * (W / 2 + 2.5), .8, 0, 5.0, 1.6, 6.5, Cr, Tr); lm.box(sx * (W / 2 + 7), 1.4, 0, 4.0, 1.4, 4.0, Cr, Tr)
        lm.col(sx * (W / 2 + 2.5), .8, 0, 5, 1.6, 6.5); lm.col(sx * (W / 2 + 7), 1.4, 0, 4, 1.4, 4.0)
    # tunnel body: barrel lining (faces inward), kerb seats, floor, fog cap at the end
    y0, y1 = D, D + depth
    lm.arch_soffit(wi, sp, y0, y1, 12, lambda k, n: lining if k in (5, 6) else plain, plain)
    lm.quad((-r, y0, 0), (r, y0, 0), (r, y1, 0), (-r, y1, 0), floor_t, 1, 4)
    for sx in (-1, 1):
        lm.box(sx * (r - .45), (y0 + y1) / 2 - .8 + .8, 0, .9, depth + D, .45, lm.solid('#b9b3a6'), lm.solid('#cfc9bb'))
        lm.col(sx * (r - .45), (y0 + y1) / 2, 0, .9, depth + D, .45, walk=True, tag='kerb-seat')
        lm.col(sx * (r + .3), (0 + y1) / 2, 0, .6, y1, sp + r)
    lm.quad((-r, y1, 0), (r, y1, 0), (r, y1, sp), (-r, y1, sp), fog)
    nf = 8
    for k in range(nf):
        a0 = math.pi * k / nf; a1 = math.pi * (k + 1) / nf
        # Same winding as the fog quad below it (faces the portal); the reversed order was back-face culled.
        lm.face([(r * math.cos(a0), y1, sp + r * math.sin(a0)), (0, y1, sp), (r * math.cos(a1), y1, sp + r * math.sin(a1))], fog)
    lm.col(0, y1 / 2, -.3, wi, y1 + 1, .3, walk=True, tag='tunnel-floor'); lm.col(0, y1 + .2, 0, wi, .4, sp + r, tag='fog-end')
    lm.col(0, y1 / 2, sp + r, wi + 1, y1, 1.0, tag='vault')
    lm.col(-(W / 2 + r) / 2, D / 2, 0, W / 2 - r, D, H); lm.col((W / 2 + r) / 2, D / 2, 0, W / 2 - r, D, H); lm.col(0, D / 2, sp + r, wi, D, H - sp - r)
    # hill mound over the tunnel (holes behind the portal), banyan aerial-root curtains
    hill = lm.tile('hill', 'foliage', span=(2, 2), base='#4f9a46')
    mound(lm, 0, 18, 30, 17.5, 15, 5, 18, hill, cut=lambda c: abs(c.x) < 9.0 and c.y < 4.5 and c.z < 9.4)
    lm.box(0, 4.6, H - .2, 18.5, 6.0, 3.0, hill, hill)  # back-fill the mound notch behind the cornice
    for sx in (-1, 1): lm.col(sx * 17, 15, 0, 18, 30, 11)
    lm.col(0, 17, H, 16, 26, 5)
    for k, x in enumerate((-7.6, -6.9, 7.3)):
        ln = 2.2 + (k % 3) * .9; lm.quad((x - .35, -.35, H - ln), (x + .35, -.35, H - ln), (x + .35, -.35, H + .4), (x - .35, -.35, H + .4), leaf)
    lm.view('front', 200, 6, 30, (0, 0, 4.5), lens=30)
    lm.view('inside', 180, 2, 6, (0, 14, 2.6), lens=24)
    return lm


# =================================================================================================================
# 6 校門＋校碑 gate — refs: docs/reference/landmarks/gate.md (Commons 2017_NSYSU_maingate, Main_gate_of_NSYSU…).
#   ONE slender square shaft (~3.8 m, 21.2 m), dark maroon glazed square tiles with light grout, six gold characters
#   國立中山大學 top-to-bottom, gold lattice screen near the top, roundel (original pattern, not the real emblem);
#   roadside guard booth with cantilever canopy on the hill side; crenellated seawall parapet on the sea side.
#   Road = local Y (north–south), sea = local −X (west).
# =================================================================================================================
@landmark
def lm_gate():
    lm = LM('gate', '校門＋校碑', 2000)
    gate = next(m for m in json.loads((ROOT / 'artifacts/v3/T3/corrections.json').read_text(encoding='utf-8'))['missing'] if m['id'] == 'GATE')
    place('gate', None, gate['world'], 0., '待 T3 對位：T3 GATE（官方地圖→蓮海路）。OSM node 276322982「國立中山大學校門」在 (−28, 726)，兩者差約 140 m，需確認。'
          '本地 Y=道路方向（南北），校碑在西（海側），警衛亭在東（山側）；通道 x∈[−5,5] 淨空可通行。', uncertainty_m=gate.get('uncertainty_m'), osmGateNode=[-28, 726])
    tile = lm.tile('gtile', 'tiles', span=(2, 2), color='#5e2a28', line='#a8756b', n=4, m=4)
    txt = lm.tile('name', 'text', span=(2, 8), text='國立中山大學', bg='#5e2a28', fg=P['gold'], em='#d4af37')
    lat = lm.tile('lattice', 'lattice', span=(2, 2), bg='#d4af37', bar='#5e2a28', n=5)
    emb = lm.tile('emblem', 'emblem', span=(2, 2), bg='#5e2a28', ring=P['gold'])
    stone = lm.solid('#cfc9bb'); booth_w = wintiles(lm, 'booth', wall='#efe6d1', wall_kind='solid', win=(.1, .25, .9, .8), mull=1)
    mx, s, Hh = -7.5, 3.8, 21.2
    lm.box(mx, 0, 0, s + 1.4, s + 1.4, .6, stone, stone, col=True, walk=True)
    lm.box(mx, 0, .6, s, s, Hh - .6, tile, lm.solid('#4d2321'), cell=(s / 4, s / 4 * 1.0)); lm.col(mx, 0, .6, s, s, Hh - .6)
    strip = wintiles(lm, 'strip', wall='#5e2a28', wall_kind='solid', win=(.15, .03, .85, .97), mull=0, sill=None, span=(1, 4))
    for rot, text in ((0., True), (-math.pi / 2, True), (math.pi, False), (math.pi / 2, False)):
        with lm.at(mx, 0, 0, rot):  # face normal = local −Y after rotation: S, W carry the name; N, E a window strip
            if text:
                plate(lm, -.9, .9, -s / 2, 4.5, 15.5, txt, out=.08); plate(lm, -1.0, 1.0, -s / 2, 19.3, 21.0, emb, out=.04)
            else:
                lm.quad((-.45, -s / 2 - .01, 3.0), (.45, -s / 2 - .01, 3.0), (.45, -s / 2 - .01, 15.0), (-.45, -s / 2 - .01, 15.0), strip, 1, 4)
            lm.quad((-1.2, -s / 2 - .01, 16.6), (1.2, -s / 2 - .01, 16.6), (1.2, -s / 2 - .01, 18.8), (-1.2, -s / 2 - .01, 18.8), lat)
    lm.box(mx, 0, Hh, s + .3, s + .3, .3, lm.solid('#4d2321'), lm.solid('#4d2321'))
    # guard booth + canopy + boom barriers (hill side, east)
    bx = 7.5
    lm.box(bx, 0, 0, 3.4, 4.2, 3.0, booth_w, None, cell=(1.7, 3.0)); lm.col(bx, 0, 0, 3.4, 4.2, 3.0)
    lm.box(bx, 0, 3.0, 6.5, 7.0, .35, lm.solid('#efe6d1'), lm.solid(P['roof']))
    for yy in (-3, 3): lm.box(bx + 2.8, yy, 0, .25, .25, 3.0, lm.solid('#8c9296'), None); lm.col(bx + 2.8, yy, 0, .25, .25, 3)
    for yy, sx in ((-2.5, -1), (2.5, 1)):
        lm.box(bx - 2.2, yy, 0, .5, .5, 1.0, lm.solid('#f3c33c'), lm.solid('#f3c33c'))
        lm.box(bx - 2.2 - 2.4, yy, .9, 4.6, .12, .12, lm.solid('#e04b3a'), lm.solid('#ffffff'))
    # seawall parapet with 蘿蔔坑 niches on the sea side (along the road)
    with lm.at(-11.2, 0, 0, math.pi / 2):
        lm.box(0, -1.4, -.3, 30, 2.8, .3, lm.solid('#b0563f'), lm.solid('#b0563f'))
        crenel_wall(lm, 30, lm.solid('#a8493a'), lm.solid('#d9d2c2'), lm.solid('#cfc9bb'))
    lm.view('aerial', 250, 30, 60, (-2, 0, 8), lens=35)
    lm.view('road', 175, 5, 40, (-4, 0, 9), lens=35)
    return lm


# =================================================================================================================
# 11b 海堤 seawall (modular kit) — refs: docs/reference/landmarks/seawall.md (Commons). Alternating merlons and seat
#   niches (蘿蔔坑) ~1.6 m pitch, merlon ~0.65 m × 1.1 m with cap + ball finial, seat ~0.5 m; red-brick paved walk;
#   sloped concrete apron and tetrapods on the sea side. Module 6 m along local X; SEA = local +Y (Blender) = three −Z.
#   Parts: seawall-6m (2014 red-brick merlons), seawall-6m-white (2017 white repaint).
# =================================================================================================================
@landmark
def lm_seawall():
    lm = LM('seawall', '海堤（蘿蔔坑）', 1200)
    sw = next(m for m in json.loads((ROOT / 'artifacts/v3/T3/corrections.json').read_text(encoding='utf-8'))['missing'] if m['id'] == 'SEAWALL')
    place('seawall', 25360179, sw['world'], 0., '模組套件：沿 path（T3 SEAWALL = OSM 中山大學海堤道路）每 6 m 放 seawall-6m，模組本地 −Z(three) 朝海；'
          '照片中蘿蔔坑垛口也延伸到校門兩側（gate.glb 已含 30 m）。', path=sw['line'], moduleLength=6.0, seaSide='south/west of the line',
          parts=['seawall-6m', 'seawall-6m-white'])
    walk = lm.tile('walk', 'brick', span=(2, 2), color='#b0563f', course=6, brick=10)
    apron = lm.solid('#9a9a94'); tp = lm.solid(P['tetrapod'])
    for name, mer, cap in (('seawall-6m', '#a8493a', '#d9d2c2'), ('seawall-6m-white', '#f1eee6', '#9fa3a3')):
        lm.part(name)
        lm.quad((-3, -2.8, 0), (3, -2.8, 0), (3, 0, 0), (-3, 0, 0), walk); lm.col(0, -1.4, -.4, 6, 2.8, .4, walk=True, tag='seawall-walk')
        crenel_wall(lm, 6.0, lm.solid(mer), lm.solid(cap), lm.solid(cap), pitch=1.5)
        lm.quad((-3, .6, 0), (3, .6, 0), (3, 3.6, -3.2), (-3, 3.6, -3.2), apron)
        for k, (x, y) in enumerate(((-1.8, 3.4), (.4, 4.2), (2.3, 3.2))): tetrapod(lm, x, y, -3.0, 1.4, tp, rot=k * 1.1)
    lm.meta['preview'] = {'seawall-6m': [(6.0 * k, 0) for k in range(1, 4)], 'seawall-6m-white': [(-6.0 * k, 0) for k in range(1, 3)]}
    lm.view('module', 210, 22, 26, (0, 0, .5), lens=35)
    lm.view('walk', 265, 6, 14, (2, -1.4, 1.0), lens=30)
    return lm


# =================================================================================================================
# 7 逸仙館 yatsen-hall — refs: docs/reference/landmarks/yatsen-hall.md (Commons NSYSU_Hall01, 2017 drone 02/03).
#   Near-square brick mass (~53 m), NOT octagonal; flat GREEN-coated roofs, raised central auditorium strip running
#   N–S; north (road) front: two-storey cream square-column colonnade with coffered canopy, gridded glass lobby,
#   5–6 front steps. Fly tower not visible in photos (south end kept modestly higher, 【待查證】).
# =================================================================================================================
@landmark
def lm_yatsen_hall():
    lm = LM('yatsen-hall', '逸仙館', 4000)
    poly, c = osm_local(OSM_LM['YH']['polygon'])
    place('yatsen-hall', OSM_LM['YH']['osmId'], c, 0., '多邊形為 OSM 近正方形 52.7×52.6 m；正面外迴廊朝北（校園道路）。')
    brick = '#8f4033'; B = lm.tile('brick', 'brick', span=(2, 2), color=brick); G = lm.solid('#5f9e6a'); T = lm.solid('#d9d4c8')
    slot = wintiles(lm, 'slot', wall=brick, win=(.38, .12, .62, .88), mull=0, sill=None)
    lobby = wintiles(lm, 'lobby', wall='#d9d4c8', wall_kind='solid', win=(.04, .04, .96, .96), mull=3, transom=.5, frame='#6b4a2e', sill=None)
    side = cols(B, lambda i, j, nx, ny: slot if i % 3 == 1 and j < 2 else None)
    hx = 26.0
    lm.prism([(-hx, -26), (hx, -26), (hx, 22), (-hx, 22)], 0, 11.0, side, G, cell=(3.6, 3.7))
    lm.parapet([(-hx, -26), (hx, -26), (hx, 22), (-hx, 22)], 11.0, .9, .3, B, T)
    lm.prism([(-18, -24), (18, -24), (18, 18), (-18, 18)], 11.0, 15.2, B, G, cell=(4, 4.2))
    lm.prism([(-11, -26), (11, -26), (11, 16), (-11, 16)], 15.2, 20.5, B, G, cell=(4, 5.3))
    lm.prism([(-11, -26), (11, -26), (11, -12), (-11, -12)], 20.5, 23.5, B, G, cell=(4, 3))   # stage end 【待查證】
    # north lobby + colonnade
    lm.quad((14, 22.02, 0), (-14, 22.02, 0), (-14, 22.02, 7.6), (14, 22.02, 7.6), lobby, 8, 2)
    cz = 8.0
    lm.box(0, 25.0, cz, 46, 6.4, .9, T, T); lm.col(0, 25, cz, 46, 6.4, .9, walk=True)
    for k in range(11):
        x = -21.5 + 4.3 * k
        lm.box(x, 27.4, 0, .9, .9, cz, T, None); lm.col(x, 27.4, 0, .9, .9, cz)
    with lm.at(0, 30.6, 0, math.pi):
        lm.stairs(0, 0, 0, 30, 2.4, .9, 5, lm.solid('#cfc9bb'))
    lm.box(0, 25.0, 0, 46, 6.0, .9, lm.solid('#cfc9bb'), lm.solid(P['plaza'])); lm.col(0, 25, 0, 46, 6, .9, walk=True)
    lm.col(0, -2, 0, 2 * hx, 48, 11.9); lm.col(0, -5, 11, 36, 42, 12.5)
    lm.view('aerial', 0, 35, 120, (0, 0, 6), lens=35)
    lm.view('front', 20, 4, 45, (0, 22, 5), lens=28)
    return lm


# =================================================================================================================
# 8 體育館 gym — refs: docs/reference/landmarks/gym.md (Commons 2017 drone, aerial only). Red-brick box, dark-grey
#   low hipped roof (NOT a barrel) with a raised cream clerestory strip along the long axis + 2 vent hoods; lower
#   annex on the north with a pink-lattice pergola over the entrance steps.
# =================================================================================================================
@landmark
def lm_gym():
    lm = LM('gym', '體育館', 3000)
    poly, c = osm_local(OSM_LM['SPORT']['polygon'])
    place('gym', OSM_LM['SPORT']['osmId'], c, 0., 'OSM 54×54 m；主館東西向長，北側較低附屬棟＋入口棚架（地面照缺，入口方位【待查證】）。')
    brick = '#9a4636'; B = lm.tile('brick', 'brick', span=(2, 2), color=brick); R = lm.solid('#5d6166'); T = lm.solid(P['trim'])
    tall = wintiles(lm, 'tall', wall=brick, win=(.36, .08, .64, .92), mull=0, sill=None)
    low = wintiles(lm, 'low', wall=brick, win=(.12, .3, .88, .72), mull=2)
    lou = lm.tile('louvre', 'louvre', span=(2, 1), color=P['trim'], line='#9fa3a3', n=5)
    pink = lm.solid('#e6a7a0')
    hall = cols(B, lambda i, j, nx, ny: tall if i % 2 == 1 and 0 < i < nx - 1 else None)
    lm.prism([(-26, -26), (26, -26), (26, 13), (-26, 13)], 0, 15.0, hall, None, cell=(4.0, 15.0))
    lm.band([(-26, -26), (26, -26), (26, 13), (-26, 13)], 15.0, .6, .3, T)
    hip(lm, 0, -6.5, 15.6, 52, 39, 2.8, 8.0, R, R)
    lm.box(0, -6.5, 18.4, 36, 5, 1.6, lou, lm.solid('#d9d4c8'), cell=(4, 1.6))
    for x in (-12, 12): lm.box(x, -16, 17.0, 2.2, 2.2, 1.4, lm.solid(P['equip']), lm.solid(P['equip']))
    lm.prism([(-26, 13), (26, 13), (26, 27), (-26, 27)], 0, 7.4, low, lm.solid(P['roof']), cell=(3.4, 3.7), sides={0, 1, 2, 3})
    lm.parapet([(-26, 13), (26, 13), (26, 27), (-26, 27)], 7.4, .8, .3, B, T)
    # entrance pergola (north-west) with steps
    for k in range(8): lm.box(-22 + k * 1.2, 31, 4.0, .25, 8, .3, pink, pink)
    for x in (-22.5, -13.5):
        for y in (27.6, 34.4): lm.box(x, y, 0, .5, .5, 4.0, T, None); lm.col(x, y, 0, .5, .5, 4.0)
    with lm.at(-18, 35.5, 0, math.pi): lm.stairs(0, 0, 0, 9, 2.0, .6, 4, lm.solid('#cfc9bb'))
    lm.col(0, -6.5, 0, 52, 39, 18); lm.col(0, 20, 0, 52, 14, 8.2)
    lm.view('aerial', 315, 32, 120, (0, 0, 6), lens=35)
    lm.view('ground', 340, 4, 75, (0, 10, 8), lens=30)
    return lm


# =================================================================================================================
# 9 海科院 marine = OSM 269874271「海工館 & 通識中心」 — refs: docs/reference/landmarks/marine.md (Commons NSYSU MS03 =
#   02.jpg, high confidence). 7–8F light-grey tower with punched square windows, a roundel and a blue-green glass
#   strip, flanked by 4–6F red-brick wings.
# =================================================================================================================
@landmark
def lm_marine():
    lm = LM('marine', '海科院（海工館）', 3000)
    poly, c = osm_local(OSM_LM['ME']['polygon'])
    place('marine', OSM_LM['ME']['osmId'], c, 0., '採 OSM「海工館 & 通識中心」（照片 MS03 對得上）。海資館 MB（269874277）與海洋科學學院 MA（269874274）'
          '仍為程式化量體；若要以海資館為代表需重做。')
    brick = '#b0563f'; B = lm.tile('brick', 'brick', span=(2, 2), color=brick); R = lm.solid(P['roof']); T = lm.solid(P['trim'])
    win = wintiles(lm, 'win', wall=brick, win=(.14, .26, .86, .74), mull=2, sill='#f3ebdb')
    grey = '#d3d3cf'; Gt = lm.solid(grey)
    punch = wintiles(lm, 'punch', wall=grey, wall_kind='solid', win=(.36, .34, .64, .66), mull=0, sill=None)
    strip = wintiles(lm, 'strip', wall='#5aa0a6', wall_kind='solid', win=(.06, .04, .94, .96), mull=1, transom=.5, sill=None, frame='#2f6f74')
    emb = lm.tile('emblem', 'emblem', span=(2, 2), bg=grey, ring='#2c7f91')
    lm.prism(poly, 0, 18.5, win, R, cell=(3.2, 3.7)); lm.parapet(poly, 18.5, .9, .25, B, T)
    col_poly(lm, poly, 0, 19.4)
    # grey tower at the south end, aligned with the south-west façade edge
    w0, w1 = OSM_LM['ME']['polygon'][16], OSM_LM['ME']['polygon'][17]
    ang = math.atan2(-(w1[1] - w0[1]), w1[0] - w0[0]); mid = ((w0[0] + w1[0]) / 2 - c[0], -((w0[1] + w1[1]) / 2 - c[1]))
    nrm = (math.sin(ang), -math.cos(ang))
    cx, cy = mid[0] - nrm[0] * 8, mid[1] - nrm[1] * 8
    with lm.at(cx, cy, 0, ang):
        lm.prism([(-11, -8), (11, -8), (11, 8), (-11, 8)], 0, 29.6, [punch, strip, punch, strip], R, cell=(3.0, 3.7))
        lm.box(0, -8.06, 24.5, 4.0, .12, 4.0, Gt, Gt)
        lm.quad((-2, -8.13, 24.5), (2, -8.13, 24.5), (2, -8.13, 28.5), (-2, -8.13, 28.5), emb)
        lm.parapet([(-11, -8), (11, -8), (11, 8), (-11, 8)], 29.6, .9, .25, Gt, T)
        lm.col(0, 0, 0, 22, 16, 30.5)
    lm.view('aerial', 250, 25, 150, (0, 0, 10), lens=35)
    lm.view('tower', 225, 6, 70, (cx, cy, 14), lens=30)
    return lm


# =================================================================================================================
# 10 學生活動中心 activity-center — refs: docs/reference/landmarks/activity-center.md (Commons drone, aerial only).
#   Salmon-pink tile (#c9706b, pinker than the rest), two wings + link, terraces stepping down toward the road,
#   dark plum long-span auditorium roof on the east wing, semicircular stepped sunken plaza between the wings.
#   Shop signs are ORIGINAL colour blocks (no real brands).
# =================================================================================================================
@landmark
def lm_activity_center():
    lm = LM('activity-center', '學生活動中心', 5000)
    wp = OSM_LM['ACTIVITY']['polygon']; poly, c = osm_local(wp)
    place('activity-center', OSM_LM['ACTIVITY']['osmId'], c, 0., 'OSM 23 點輪廓（layer −1，依坡地）；東翼演藝廳深色大屋面、西翼退台、兩翼間半圓階梯廣場。')
    pink = '#c9706b'; Bp = lm.tile('brick', 'brick', span=(2, 2), color=pink); R = lm.solid(P['roof']); T = lm.solid(P['trim'])
    win = wintiles(lm, 'win', wall=pink, win=(.12, .24, .88, .78), mull=2, sill='#f3ebdb')
    shop = wintiles(lm, 'shop', wall=pink, win=(.04, .3, .96, .96), mull=3, sill=None)
    sign = lm.tile('sign', 'sign', span=(4, 1), bg='#2a8c99'); sign2 = lm.tile('sign2', 'sign', span=(4, 1), bg='#e9b949', fg='#1d2a3a')
    plum = lm.solid('#5b4048')
    L = lambda x, z: (x - c[0], -(z - c[1]))
    ground = rows((1, win), (2, shop), (9, win))
    lm.prism(poly, 0, 11.1, ground, R, cell=(3.3, 3.7)); lm.parapet(poly, 11.1, .9, .3, Bp, T)
    col_poly(lm, poly, 0, 12, step=3.0)
    # east block steps up (4–6F) with the auditorium roof
    e = [L(-136, -215), L(-90, -215), L(-90, -171), L(-136, -171)]
    lm.prism(e, 11.1, 18.5, win, R, cell=(3.3, 3.7)); lm.parapet(e, 18.5, .9, .3, Bp, T)
    ex = sum(p[0] for p in e) / 4; ey = sum(p[1] for p in e) / 4
    lm.box(ex + 4, ey, 18.5, 26, 30, 3.2, Bp, None); lm.gable(ex + 4, ey, 21.7, 26, 30, 3.0, plum, Bp, along_x=False)
    e2 = [L(-128, -213), L(-112, -213), L(-112, -199), L(-128, -199)]
    lm.prism(e2, 18.5, 22.2, win, R, cell=(3.3, 3.7))
    lm.col(ex, ey, 11, 46, 44, 14)
    # west wing terraces (rotated block)
    wx, wy = L(-193, -219)
    with lm.at(wx, wy, 11.1, math.radians(45)):
        lm.prism([(-13, -8), (13, -8), (13, 8), (-13, 8)], 0, 7.4, win, R, cell=(3.3, 3.7)); lm.parapet([(-13, -8), (13, -8), (13, 8), (-13, 8)], 7.4, 1.0, .3, Bp, T)
        lm.prism([(-6, -5), (13, -5), (13, 8), (-6, 8)], 7.4, 11.1, win, R, cell=(3.3, 3.7))
        lm.box(-9.5, -1, 7.4, 6, 10, .2, lm.solid('#e9b949'), lm.solid('#e9b949'))
        lm.col(0, 0, 0, 26, 16, 11.1)
    # 2F shop signage on the south face strip of the link (original colour blocks)
    s0 = L(-157.5, -206.3); s1 = L(-139.4, -205.9)
    lm.quad((s0[0], s0[1] - .1, 4.0), (s1[0], s1[1] - .1, 4.0), (s1[0], s1[1] - .1, 5.0), (s0[0], s0[1] - .1, 5.0), sign)
    t0 = L(-125.3, -219.2); t1 = L(-87.7, -218.8)
    lm.quad((t0[0], t0[1] - .1, 4.0), (t1[0], t1[1] - .1, 4.0), (t1[0], t1[1] - .1, 5.0), (t0[0], t0[1] - .1, 5.0), sign2)
    # semicircular stepped plaza (between the wings, south of the link)
    px, py = L(-148, -212)
    for k, (r, h) in enumerate(((13, .45), (10, .9), (7, 1.35))):
        pts = [(px + r * math.cos(math.pi + math.pi * q / 10), py + r * math.sin(math.pi + math.pi * q / 10)) for q in range(11)]
        lm.prism(pts, 0, h, lm.solid('#dccfb6'), lm.solid(P['plaza']))
        lm.col(px, py - r * .32, 0, 2 * r * .9, r * .64, h, walk=True)
    lm.view('aerial', 230, 35, 190, (0, 0, 8), lens=35)
    lm.view('plaza', 180, 10, 70, (px, py, 6), lens=30)
    return lm


# =================================================================================================================
# 11 西子灣沙灘會館 beach-house — refs: docs/reference/landmarks/beach-house.md (Commons Seas Bay Beach Resort 01–04).
#   White flat-roofed ship-like 2F + roof deck, a projecting "gunwale" sunshade band, ribbon windows, two-tier round
#   "bridge" drum on the roof topped by the 西子灣 sign, entrance canopy on wood-colour posts (east face), small
#   terracotta hip-roof chapel annex at the rear.
# =================================================================================================================
@landmark
def lm_beach_house():
    lm = LM('beach-house', '西子灣沙灘會館', 3000)
    wp = OSM_LM['BEACH']['polygon']; poly, c = osm_local(wp)
    place('beach-house', OSM_LM['BEACH']['osmId'], c, 0., 'OSM 11 點輪廓；入口立面推定朝東；海堤另見 seawall 套件。')
    white = P['white']; Wt = lm.solid(white); T = lm.solid('#dcd8cc')
    rib = wintiles(lm, 'rib', kind='band', stripes=[[0, .22, white], [.22, .86, 'glass'], [.86, 1, white]], mull=3)
    up = wintiles(lm, 'up', wall=white, wall_kind='solid', win=(.08, .3, .92, .7), mull=2, sill=None)
    drum = wintiles(lm, 'drum', kind='band', stripes=[[0, .3, white], [.3, .75, 'glass'], [.75, 1, white]], mull=1)
    sign = lm.tile('sign', 'text', span=(4, 1), text='西子灣', bg=white, fg='#8d3b2c', vertical=False)
    lm.prism(poly, 0, 4.2, rib, None, cell=(3.0, 4.2))
    lm.band(poly, 4.2, .5, 1.3, Wt)
    inner = LM.offset(poly, -1.5)
    lm.prism(inner, 4.7, 8.2, up, Wt, cell=(3.0, 3.5)); lm.parapet(inner, 8.2, 1.0, .25, Wt, T)
    col_poly(lm, poly, 0, 9.2)
    tx, ty = (-180 - c[0], -(195 - c[1]))
    lm.cyl(tx, ty, 8.2, 5.2, 3.0, 16, drum, Wt); lm.cyl(tx, ty, 11.2, 5.6, .35, 16, Wt, Wt)
    lm.cyl(tx, ty, 11.55, 3.3, 2.4, 14, drum, Wt); lm.cyl(tx, ty, 13.95, 3.6, .3, 14, Wt, Wt)
    lm.box(tx, ty, 14.25, 4.4, .25, 1.2, Wt, Wt); lm.quad((tx - 2.2, ty - .13, 14.25), (tx + 2.2, ty - .13, 14.25), (tx + 2.2, ty - .13, 15.45), (tx - 2.2, ty - .13, 15.45), sign)
    lm.col(tx, ty, 8.2, 10, 10, 7)
    # entrance canopy on the east face
    ex, ey = (-173.7 - c[0] + 3.5, -(172 - c[1]))
    lm.box(ex, ey, 3.6, 7, 9, .4, Wt, Wt)
    for dy in (-3.8, 3.8): lm.box(ex + 2.8, ey + dy, 0, .5, .5, 3.6, lm.solid('#b0844f'), None); lm.col(ex + 2.8, ey + dy, 0, .5, .5, 3.6)
    # chapel annex (rear, west)
    ax, ay = (-224 - c[0], -(180 - c[1]))
    lm.box(ax, ay, 0, 7, 7, 3.6, Wt, None); hip(lm, ax, ay, 3.6, 7, 7, 2.4, 3.3, lm.solid('#c0603e'), lm.solid('#c0603e'), over=.5)
    lm.col(ax, ay, 0, 7, 7, 6)
    lm.view('front', 95, 5, 70, (0, 0, 5), lens=30)
    lm.view('aerial', 200, 35, 110, (0, 0, 4), lens=35)
    return lm


def main():
    only, render = argv()
    for o in list(bpy.data.objects): bpy.data.objects.remove(o, do_unlink=True)
    sc = setup_render(); gcoll = bpy.data.collections.new('ground'); sc.collection.children.link(gcoll); ground(gcoll)
    built = {}
    for lid, fn in LANDMARKS.items():
        if only and lid not in only: continue
        if not only and lid == 'smoke': continue
        lm = fn(); coll = bpy.data.collections.new(lid); sc.collection.children.link(coll)
        root, objs = materialise(lm, coll); export(lm, root); built[lid] = (lm, coll)
    if render:
        for lid, (lm, coll) in built.items():  # kits: lay modules out in a row for the review render only
            for pname, offsets in lm.meta.get('preview', {}).items():
                src = bpy.data.objects.get(pname)
                for k, (dx, dy) in enumerate(offsets):
                    o = bpy.data.objects.new(f'{pname}.preview{k}', src.data); coll.objects.link(o); o.location = (dx, dy, 0)
        for lid, (lm, coll) in built.items():
            for other_id, (_, c2) in built.items(): c2.hide_render = other_id != lid
            for vname in lm.views: render_view(lm, vname, RENDERS / f'{lid}__{vname}.png')
    if not only:
        doc = dict(_doc='Expected world placement of public/models/landmarks/<id>.glb. centroid = [x, z] world metres (x east, z south) '
                        'where the GLB origin goes (y = terrain height there); yaw = radians about three +Y (same sense as '
                        'campus-structure placements.rotation), applied after the translation-free local model. GLB local frame: '
                        'three −Z = north. Kits (path) are instanced along the polyline every `moduleLength` m. '
                        'Generated by tools/create_landmarks.py from campus-structure.json context.landmarks + OSM.',
                   **PLACEMENTS)
        (OUT / 'placements.json').write_text(json.dumps(doc, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    (TMP / 'summary.json').write_text(json.dumps({k: dict(tris=v[0].tris(), limit=v[0].tri_limit, views=list(v[0].views), meta=v[0].meta) for k, v in built.items()}, ensure_ascii=False, indent=1))
    bpy.ops.wm.save_as_mainfile(filepath=str(TMP / 'landmarks.blend'))
    print('LANDMARKS_COMPLETE', list(built), flush=True)


main()
