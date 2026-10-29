"""v4 stylized university students (art-direction-v4.md §8, spec-v4.md §6/§7.1).

Run: "$(cat tools/blender-path.txt)" --background --python tools/create_student_v4.py [-- id1 id2 ...] [--preview]

The body is authored here (no pack mesh): each part (head, neck, torso, sleeves, arms, hands, legs,
shoes, hair, backpack ...) is built from primitives around the joints of the Quaternius
"Animated Men/Women" skeleton (CC0), voxel-remeshed into one soft surface per part, UV-mapped onto
a painted swatch atlas (one material per character; the head front gets a painted anime face tile),
joined, and bound to that skeleton with automatic weights. Clips come from the pack through
create_characters_v3.build_clips (Idle, Walk, Run, Jump, Wave, Talk, Sit), so every v4 character
shares v3's animation set. Proportion ~5.7 heads, 1.55 m, facing -Y in Blender (= glTF +Z).
"""
from pathlib import Path
import json, math, sys
import bpy
import numpy as np
from mathutils import Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
import create_characters_v3 as v3  # noqa: E402  (reuses import_src, build_clips, export, outline normals)

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'public/models/characters'
PREVIEW = ROOT / 'artifacts/v4/U3'
INK = '#2a2c4a'

# ---------------------------------------------------------------- atlas (8x8 cells of 32 px + face tile)
N, CELL = 256, 32
ROLES = ['skin', 'hair', 'hair2', 'top', 'top2', 'bottom', 'shoes', 'sole', 'sock', 'bag', 'bag2', 'acc1', 'acc2', 'inner', 'mouth', 'eye']
FACE = (4 * CELL, 4 * CELL, 4 * CELL)  # x0, y0 (pixels from the image top), size: lower-right quarter

def srgb(h):
    h = h.lstrip('#'); return [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]

def cell_uv(role):
    i = ROLES.index(role); cx, cy = i % 4, i // 4
    return ((cx + .5) * CELL / N, 1 - (cy + .5) * CELL / N)

def face_uv(u, v):
    """u, v in 0..1 across the face tile (v up)."""
    x0, y0, s = FACE
    return ((x0 + u * s) / N, 1 - (y0 + (1 - v) * s) / N)

def paint_atlas(name, colors, eye='#3b2f5c'):
    img = np.ones((N, N, 4), dtype=np.float32)
    base = {'skin': '#f4d2b4', 'shoes': '#fbf6ea', 'bag': '#2a2c4a', 'top': '#2c7f91', 'bottom': '#3c4a5c', 'hair': '#2b2622', 'sole': '#f4efe6', 'sock': '#f4efe6', 'inner': '#fbf6ea', 'mouth': '#b55a5a',
            'eye': INK, 'acc1': INK, 'acc2': '#e9b949', 'hair2': colors.get('hair', '#2b2622'), 'top2': '#fbf6ea', 'bag2': INK}
    base.update(colors)
    for i, r in enumerate(ROLES):
        cx, cy = i % 4, i // 4
        img[cy * CELL:(cy + 1) * CELL, cx * CELL:(cx + 1) * CELL, :3] = srgb(base[r])
    # Face tile: skin, blush, big anime eyes (white, iris, pupil, highlight, upper lash), brows, small mouth.
    x0, y0, s = FACE
    yy, xx = np.mgrid[0:s, 0:s].astype(np.float32) + .5
    u, v = xx / s, 1 - yy / s
    tile = np.zeros((s, s, 3), dtype=np.float32); tile[:] = srgb(base['skin'])
    def paint(mask, col, a=1.0):
        nonlocal tile
        m = np.clip(mask, 0, 1)[..., None] * a
        tile = tile * (1 - m) + np.array(srgb(col)) * m
    for sx in (-1, 1):
        cx = .5 + sx * .17
        paint(np.clip(1.4 - (((u - cx) / .07) ** 2 + ((v - .37) / .04) ** 2), 0, 1), '#f19a8f', .45)       # blush
        e = ((u - cx) / .085) ** 2 + ((v - .47) / .105) ** 2
        paint((e < 1).astype(np.float32), '#ffffff')                                                    # sclera
        i_ = ((u - cx - sx * .008) / .062) ** 2 + ((v - .462) / .09) ** 2
        paint((i_ < 1).astype(np.float32), eye)                                                         # iris
        paint(((i_ < 1) & (v < .44)).astype(np.float32) * .55, '#8fd3d8')                               # iris lower glow
        paint(((((u - cx - sx * .008) / .028) ** 2 + ((v - .47) / .045) ** 2) < 1).astype(np.float32), '#1b1630')  # pupil
        paint(((((u - cx + .02) / .018) ** 2 + ((v - .505) / .022) ** 2) < 1).astype(np.float32), '#ffffff')       # highlight
        lash = (np.abs(v - (.55 + .02 * np.cos((u - cx) / .09 * math.pi / 2))) < .014) & (np.abs(u - cx) < .095)
        paint(lash.astype(np.float32), INK)                                                             # upper lash
        brow = (np.abs(v - (.64 + .015 * np.cos((u - cx) / .08 * math.pi / 2))) < .011) & (np.abs(u - cx) < .075)
        paint(brow.astype(np.float32), base['hair'])
    mouth = (np.abs(v - (.27 + ((u - .5) / .05) ** 2 * .012)) < .009) & (np.abs(u - .5) < .045)
    paint(mouth.astype(np.float32), base['mouth'])
    img[y0:y0 + s, x0:x0 + s, :3] = tile
    im = bpy.data.images.new(f'{name}_atlas', N, N, alpha=False)
    im.pixels.foreach_set(np.flipud(img).ravel()); im.pack()
    return im

# ---------------------------------------------------------------- primitives
def ell(c, r, seg=20, rings=12):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=seg, ring_count=rings, location=c)
    o = bpy.context.object; o.scale = r; return o

def cap(a, b, r0, r1=None, seg=16):
    """Tapered capsule from a to b (cone + end spheres)."""
    a, b = Vector(a), Vector(b); d = b - a; r1 = r0 if r1 is None else r1
    bpy.ops.mesh.primitive_cone_add(vertices=seg, radius1=r0, radius2=r1, depth=d.length, location=(a + b) / 2)
    o = bpy.context.object; o.rotation_mode = 'QUATERNION'; o.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(d)
    parts = [o]
    for p, r in ((a, r0), (b, r1)):
        bpy.ops.mesh.primitive_uv_sphere_add(segments=seg, ring_count=8, radius=r, location=p); parts.append(bpy.context.object)
    return parts

def box(c, size, rot=(0, 0, 0), bevel=.05):
    bpy.ops.mesh.primitive_cube_add(size=1, location=c); o = bpy.context.object
    o.scale = size; o.rotation_euler = rot
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    if bevel:
        md = o.modifiers.new('b', 'BEVEL'); md.width = bevel; md.segments = 3; bpy.ops.object.modifier_apply(modifier=md.name)
    return o

def cone(c, r0, r1, depth, rot=(0, 0, 0), seg=16):
    bpy.ops.mesh.primitive_cone_add(vertices=seg, radius1=r0, radius2=r1, depth=depth, location=c, rotation=rot)
    return bpy.context.object

def fuse(parts, voxel=.035, smooth=3, target=None, remesh=True):
    """Join primitives into one soft surface (voxel remesh + smooth + decimate)."""
    parts = [p for p in parts if p]
    v3.set_active(parts[0])
    for o in parts: o.select_set(True)
    bpy.ops.object.join(); o = bpy.context.object
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    if remesh:
        md = o.modifiers.new('r', 'REMESH'); md.mode = 'VOXEL'; md.voxel_size = voxel; bpy.ops.object.modifier_apply(modifier=md.name)
        if smooth:
            md = o.modifiers.new('s', 'SMOOTH'); md.iterations = smooth; md.factor = .5; bpy.ops.object.modifier_apply(modifier=md.name)
        if target:
            while sum(len(p.vertices) - 2 for p in o.data.polygons) > target:
                md = o.modifiers.new('d', 'DECIMATE'); md.ratio = .75; bpy.ops.object.modifier_apply(modifier=md.name)
    for p in o.data.polygons: p.use_smooth = True
    return o

def paint_role(o, role):
    while len(o.data.uv_layers): o.data.uv_layers.remove(o.data.uv_layers[0])
    uv = o.data.uv_layers.new(name='UVMap'); c = cell_uv(role)
    for l in uv.data: l.uv = c
    o['role'] = role
    return o

# ---------------------------------------------------------------- weights
# The pack's bones are ~5 mm stubs at the joints, so Blender's heat weighting is unusable. Each bone is
# modelled as the segment from its joint to the next joint; a part is weighted by inverse distance to the
# segments of the bones it may follow (two strongest, smooth falloff), or rigidly to one bone.
SEGMENTS = {'Hips': ('Hips', 'Abdomen'), 'Abdomen': ('Abdomen', 'Torso'), 'Torso': ('Torso', 'Neck'), 'Neck': ('Neck', 'Head'),
            'Shoulder.L': ('Shoulder.L', 'UpperArm.L'), 'UpperArm.L': ('UpperArm.L', 'LowerArm.L'), 'LowerArm.L': ('LowerArm.L', 'Palm.L'),
            'Shoulder.R': ('Shoulder.R', 'UpperArm.R'), 'UpperArm.R': ('UpperArm.R', 'LowerArm.R'), 'LowerArm.R': ('LowerArm.R', 'Palm.R'),
            'UpperLeg.L': ('UpperLeg.L', 'LowerLeg.L'), 'LowerLeg.L': ('LowerLeg.L', 'Ankle.L'), 'UpperLeg.R': ('UpperLeg.R', 'LowerLeg.R'), 'LowerLeg.R': ('LowerLeg.R', 'Ankle.R')}
SIDE = lambda sd: ['Shoulder.' + sd, 'UpperArm.' + sd, 'LowerArm.' + sd]
GROUPS = {
    'top': ['Hips', 'Abdomen', 'Torso', 'Neck'] + SIDE('L') + SIDE('R'),
    'neck': ['Torso', 'Neck'],
    'bottom': ['Hips', 'Abdomen', 'UpperLeg.L', 'LowerLeg.L', 'UpperLeg.R', 'LowerLeg.R'],
    'skirt': ['Hips', 'Abdomen', 'UpperLeg.L', 'UpperLeg.R'],
}

def seg_dist(p, a, b):
    ab = b - a; t = max(0., min(1., (p - a).dot(ab) / max(ab.length_squared, 1e-9)))
    return (p - (a + ab * t)).length

def weight(o, J, bones=None, rigid=None):
    """Add vertex groups to a part: rigid to one bone, or blended over `bones` by segment distance."""
    if rigid:
        g = o.vertex_groups.new(name=rigid); g.add(list(range(len(o.data.vertices))), 1.0, 'REPLACE'); return o
    groups = {b: o.vertex_groups.new(name=b) for b in bones}
    for v in o.data.vertices:
        p = o.matrix_world @ v.co
        d = sorted((seg_dist(p, J[SEGMENTS[b][0]], J[SEGMENTS[b][1]]), b) for b in bones)[:2]
        w = [1 / (max(x, 1e-3) ** 4) for x, _ in d]
        if len(d) > 1 and d[1][0] > d[0][0] * 2.2: w[1] = 0  # far second bone: no blend
        t = sum(w)
        for (_, b), wi in zip(d, w):
            if wi > 0: groups[b].add([v.index], wi / t, 'REPLACE')
    return o

def limb(sd, kind):
    return {'arm': ['UpperArm.' + sd, 'LowerArm.' + sd], 'leg': ['UpperLeg.' + sd, 'LowerLeg.' + sd]}[kind]

# ---------------------------------------------------------------- the body, per joint
def joints(arm):
    j = lambda n: arm.matrix_world @ arm.data.bones[n].head_local
    J = {n: j(n) for n in ('Hips', 'Abdomen', 'Torso', 'Neck', 'Head', 'UpperArm.L', 'LowerArm.L', 'Palm.L',
                            'UpperArm.R', 'LowerArm.R', 'Palm.R', 'UpperLeg.L', 'LowerLeg.L', 'UpperLeg.R', 'LowerLeg.R', 'Foot.L', 'Foot.R',
                            'Shoulder.L', 'Shoulder.R')}
    for sd in 'LR':  # ankle: above the IK foot target, under the knee
        f = J['Foot.' + sd]; J['Ankle.' + sd] = Vector((f.x, f.y - .06, .3))
    return J

def build_parts(J, spec):
    """Returns [(mesh, weights)] where weights is a bone name (rigid) or a list of bones to blend."""
    """Returns (mesh, role) list. Units are the source armature's world units (~4.85 tall)."""
    fem = spec['body'] == 'f'
    out = []
    hx, hy = J['Head'].x, J['Head'].y
    head_c = Vector((hx, hy - .02, J['Head'].z + .25)); hr = Vector((.46, .44, .49)) * (0.97 if fem else 1)
    # head + ears as skin; face tile projected later on the front
    head = fuse([ell(head_c, hr, 28, 16)] + [ell((hx + sx * hr.x * .95, hy + .03, head_c.z - .02), (.06, .05, .1)) for sx in (-1, 1)], voxel=.022, smooth=2, target=1600)
    out.append((paint_role(head, 'skin'), 'Head'))
    neck = fuse(cap((hx, hy + .04, J['Neck'].z - .12), (hx, hy + .04, head_c.z - .3), .145 if not fem else .125), voxel=.03, target=200)
    out.append((paint_role(neck, 'skin'), GROUPS['neck']))
    # torso garment (tee / hoodie / blouse); slimmer at the waist, a little flare at the hem
    ch = J['Torso']; ab = J['Abdomen']; hp = J['Hips']
    sw = (.56 if not fem else .48) * spec.get('girth', 1)
    torso = [ell((0, ch.y + .04, ch.z + .25), (sw, .31, .52)), ell((0, ab.y + .02, ab.z + .55), (sw * .86, .28, .5)),
             ell((0, ab.y + .0, ab.z + .15), (sw * (.92 if not fem else .8), .28, .28))]
    if spec['top'] == 'hoodie':
        torso += [ell((0, ch.y + .30, ch.z + .78), (.30, .16, .12))]  # hood roll at the back of the neck
    for sd, sx in (('L', 1), ('R', -1)):
        ua, la = J[f'UpperArm.{sd}'], J[f'LowerArm.{sd}']
        sleeve_end = la if spec['top'] in ('hoodie', 'jacket', 'shirt-long') else ua.lerp(la, .45)
        torso += cap((ua.x - sx * .08, ua.y + .02, ua.z - .04), sleeve_end, .21 if not fem else .19, .17)
    top = fuse(torso, voxel=.04, smooth=6, target=2600)
    out.append((paint_role(top, 'top'), GROUPS['top']))
    # arms (skin where the sleeve ends) and mitten hands
    for sd, sx in (('L', 1), ('R', -1)):
        ua, la, pa = J[f'UpperArm.{sd}'], J[f'LowerArm.{sd}'], J[f'Palm.{sd}']
        start = la if spec['top'] in ('hoodie', 'jacket', 'shirt-long') else ua.lerp(la, .35)
        arm_parts = cap(start, pa, .14 if not fem else .12, .11)
        if spec['top'] in ('hoodie', 'jacket', 'shirt-long'):  # sleeve continues to the wrist; only the hand is skin
            arm_parts = []
        hand = [ell((pa.x + sx * .17, pa.y, pa.z - .01), (.2, .1, .14))] + cap((pa.x + sx * .1, pa.y - .1, pa.z), (pa.x + sx * .22, pa.y - .17, pa.z + .02), .045)
        if spec['top'] in ('hoodie', 'jacket', 'shirt-long'):
            cuff = fuse(cap(la, (pa.x - sx * .02, pa.y, pa.z), .14, .13), voxel=.03, target=500)
            out.append((paint_role(cuff, 'top'), 'LowerArm.'+sd))
        o = fuse(arm_parts + hand, voxel=.028, target=700)
        out.append((paint_role(o, 'skin'), limb(sd,'arm')))
    # legs: trousers / shorts / skirt (+ skin legs and socks)
    for sd, sx in (('L', 1), ('R', -1)):
        ul, ll, ft = J[f'UpperLeg.{sd}'], J[f'LowerLeg.{sd}'], J[f'Foot.{sd}']
        ankle = Vector((ft.x, ft.y - .06, .34))
        if spec['bottom'] in ('trousers', 'jeans'):
            o = fuse(cap((ul.x * .9, ul.y, ul.z + .05), ll, .26 if not fem else .23, .19) + cap(ll, ankle, .19, .16), voxel=.035, target=900)
            out.append((paint_role(o, 'bottom'), ['Hips']+limb(sd,'leg')))
        else:
            hem = ul.lerp(ll, .55 if spec['bottom'] == 'shorts' else .2)
            if spec['bottom'] == 'shorts':
                o = fuse(cap((ul.x * .9, ul.y, ul.z + .05), hem, .24, .21), voxel=.035, target=600)
                out.append((paint_role(o, 'bottom'), ['Hips','UpperLeg.'+sd]))
            skin_from = hem if spec['bottom'] == 'shorts' else ul.lerp(ll, .25)
            sock_z = .78 if spec.get('socks') == 'knee' else .52
            o = fuse(cap(skin_from, ll, .15, .12) + cap(ll, (ankle.x, ankle.y, sock_z), .12, .095), voxel=.03, target=600)
            out.append((paint_role(o, 'skin'), limb(sd,'leg')))
            o = fuse(cap((ankle.x, ankle.y, sock_z), ankle, .105, .1), voxel=.03, target=300)
            out.append((paint_role(o, 'sock'), 'LowerLeg.'+sd))
        # sneakers: upper + white sole
        shoe = fuse([box((ft.x, ft.y - .14, .17), (.27, .56, .24), bevel=.09), ell((ft.x, ft.y - .36, .15), (.14, .14, .11))], voxel=.03, target=500)
        out.append((paint_role(shoe, 'shoes'), 'Foot.'+sd))
        sole = box((ft.x, ft.y - .15, .045), (.29, .6, .09), bevel=.035)
        out.append((paint_role(sole, 'sole'), 'Foot.'+sd))
    if spec['bottom'] == 'skirt':
        sk = fuse([cone((0, hp.y - .02, (hp.z + J['LowerLeg.L'].z) / 2 + .28), .64, .45, (hp.z - J['LowerLeg.L'].z) * .75 + .1, seg=24)], voxel=.035, target=900)
        out.append((paint_role(sk, 'bottom'), 'Hips'))
    # hair: a cap shell over the skull, bangs, and style pieces
    hc = head_c
    hair = [ell((hc.x, hc.y + .05, hc.z + .06), hr * 1.08)]
    bang_z = hc.z + .2
    for k in range(-3, 4):
        x = k * .12
        hair += cap((x * .9, hc.y - hr.y * .7, bang_z + .14), (x * 1.05 + (.03 if k > 0 else -.03), hc.y - hr.y * 1.02, bang_z - .12 - .04 * (k % 2)), .07, .03, seg=10)
    if spec['hair'] == 'short':
        for k in range(-2, 3):  # nape clumps
            hair += cap((k * .13, hc.y + hr.y * .8, hc.z - .05), (k * .15, hc.y + hr.y * .95, hc.z - .38), .1, .04, seg=10)
        for k in range(5):  # small tufts on the crown / back
            a = k / 5 * math.pi * 2
            hair += cap((hc.x + .25 * math.cos(a), hc.y + .1 + .25 * math.sin(a), hc.z + .42), (hc.x + .32 * math.cos(a), hc.y + .18 + .32 * math.sin(a), hc.z + .52), .07, .02, seg=8)
    elif spec['hair'] in ('bob', 'ponytail', 'long'):
        drop = {'bob': .55, 'ponytail': .35, 'long': .95}[spec['hair']]
        for sx in (-1, 1):
            hair += cap((sx * hr.x * .92, hc.y - .02, hc.z + .1), (sx * hr.x * .95, hc.y + .02, hc.z - drop), .13, .09, seg=12)
        hair += [ell((hc.x, hc.y + hr.y * .55, hc.z - drop * .45), (hr.x * .95, .2, drop * .55 + .1))]
        if spec['hair'] == 'ponytail':
            hair += cap((hc.x, hc.y + hr.y * 1.05, hc.z + .12), (hc.x, hc.y + hr.y * 1.35, hc.z - .7), .17, .07, seg=12) + [ell((hc.x, hc.y + hr.y * 1.18, hc.z - .1), (.16, .14, .3))]
    hair_o = fuse(hair, voxel=.026, smooth=2, target=2600)
    out.append((paint_role(hair_o, 'hair'), 'Head'))
    if spec['hair'] == 'ponytail':
        tie = fuse([ell((hc.x, hc.y + hr.y * 1.05, hc.z + .16), (.09, .09, .07))], voxel=.02, target=150)
        out.append((paint_role(tie, 'acc2'), 'Head'))
    # backpack + straps (rigid on the torso)
    if spec.get('bag', 'backpack') == 'backpack':
        bag = fuse([box((0, ch.y + .48, ch.z + .02), (.72, .34, .9), bevel=.14), box((0, ch.y + .68, ch.z - .18), (.5, .12, .36), bevel=.06)], voxel=.03, target=900)
        out.append((paint_role(bag, 'bag'), 'Torso'))
        straps = []
        for sx in (-1, 1):
            straps += cap((sx * .2, ch.y - .26, ch.z + .62), (sx * .23, ch.y - .3, ch.z - .3), .055, .05, seg=8)
            straps += cap((sx * .2, ch.y - .26, ch.z + .62), (sx * .22, ch.y + .3, ch.z + .5), .055, .05, seg=8)
        o = fuse(straps, voxel=.025, target=600)
        out.append((paint_role(o, 'bag2'), 'Torso'))
    if spec.get('glasses'):
        g = []
        for sx in (-1, 1):
            bpy.ops.mesh.primitive_torus_add(major_segments=16, minor_segments=4, major_radius=.085, minor_radius=.012,
                                             location=(sx * .14, hc.y - hr.y * .98, hc.z - .02), rotation=(math.pi / 2, 0, 0)); g.append(bpy.context.object)
        g.append(box((0, hc.y - hr.y * .99, hc.z), (.1, .02, .02), bevel=0))
        o = fuse(g, remesh=False)
        out.append((paint_role(o, 'acc1'), 'Head'))
    if spec.get('vest'):  # reflective / service vest over the top
        o = fuse([ell((0, ch.y + .02, ch.z + .2), (sw * 1.06, .35, .56)), ell((0, ab.y + .0, ab.z + .5), (sw * .95, .32, .5))], voxel=.04, smooth=4, target=1200)
        out.append((paint_role(o, 'acc2'), GROUPS['top'][:4]))
    if spec.get('apron'):
        o = fuse([box((0, ch.y - .34, ab.z + .2), (.72, .04, 1.3), bevel=.02)], remesh=False)
        out.append((paint_role(o, 'acc2'), ['Hips','Abdomen','Torso']))
    if spec.get('cap'):
        o = fuse([ell((hc.x, hc.y + .02, hc.z + .25), (hr.x * 1.1, hr.y * 1.1, .3)), box((hc.x, hc.y - hr.y * 1.1, hc.z + .16), (.5, .35, .05), rot=(-.15, 0, 0), bevel=.02)], voxel=.03, target=600)
        out.append((paint_role(o, 'acc1'), 'Head'))
    # collar / tee print accent
    if spec['top'] == 'tee':
        collar = fuse(cap((-.17, ch.y - .1, ch.z + .72), (.17, ch.y - .1, ch.z + .72), .045, seg=8), voxel=.02, target=200)
        out.append((paint_role(collar, 'top2'), 'Torso'))
        mark = box((0, ch.y - .33, ch.z + .25), (.36, .04, .22), bevel=.02)
        out.append((paint_role(mark, 'acc2'), 'Torso'))
    if spec['top'] == 'hoodie':
        for sx in (-1, 1):
            out.append((paint_role(fuse(cap((sx * .1, ch.y - .3, ch.z + .62), (sx * .12, ch.y - .34, ch.z + .25), .025, seg=6), voxel=.015, target=120), 'top2'), 'Torso'))
    return out, head_c, hr

def project_face(head, head_c, hr):
    """Front of the head (normal facing -Y) gets the painted face tile by planar projection."""
    me = head.data; uv = me.uv_layers[0]
    for p in me.polygons:
        if p.normal.y > -.35 or p.center.z < head_c.z - hr.z * .95: continue
        for li in p.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            u = (co.x - head_c.x) / (hr.x * 2) + .5
            v = (co.z - (head_c.z - hr.z)) / (hr.z * 2)
            uv.data[li].uv = face_uv(min(max(u, 0), 1), min(max(v, 0), 1))

def make_material(name, img):
    m = v3.make_material(name, img)
    return m

def build(cid, spec, preview=False):
    v3.reset()
    src = v3.SRC / ('quaternius-animated-women/AQsd9ngvKU.glb' if spec['body'] == 'f' else 'quaternius-animated-men/HMnuH5geEG.glb')
    arm, pack = v3.import_src(src)
    prefix = 'Female' if spec['body'] == 'f' else 'Man'
    bpy.data.objects.remove(pack, do_unlink=True)
    J = joints(arm)
    parts, head_c, hr = build_parts(J, spec)
    head = parts[0][0]
    project_face(head, head_c, hr)
    img = paint_atlas(cid, spec['colors'], spec.get('eye', '#3b2f5c'))
    mat = make_material(f'{cid}_toon', img)
    meshes = []
    for o, w in parts:
        weight(o, J, rigid=w) if isinstance(w, str) else weight(o, J, bones=w)
        meshes.append(o)
    for o in meshes:
        o.data.materials.clear(); o.data.materials.append(mat)
    v3.set_active(meshes[0])
    for o in meshes: o.select_set(True)
    bpy.ops.object.join(); body = bpy.context.object
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    for p in body.data.polygons: p.use_smooth = True
    # skin to the pack skeleton
    v3.set_active(body); arm.select_set(True); bpy.context.view_layer.objects.active = arm
    bpy.ops.object.parent_set(type='ARMATURE_NAME')  # keep our vertex groups; add the armature modifier
    for g in [g for g in body.vertex_groups if not g.name in arm.data.bones]: body.vertex_groups.remove(g)
    v3.build_clips(arm, prefix)
    h = max(v.z for v in v3.world_verts(body)) - min(v.z for v in v3.world_verts(body))
    arm.scale = arm.scale * (v3.TARGET_H * spec.get('height', 1) / h); bpy.context.view_layer.update()
    v3.store_outline_normals(body, conv=lambda n: (n.x, n.z, -n.y))
    body.name = f'{cid}_mesh'; arm.name = cid; body.data.name = f'{cid}_mesh'
    arm['license'] = 'Mesh, atlas and face: authored in tools/create_student_v4.py (this repo). Skeleton and base clips: Quaternius Animated Men/Women Pack (CC0-1.0).'
    tris = sum(len(p.vertices) - 2 for p in body.data.polygons)
    print('BUILT', cid, 'tris', tris, flush=True)
    if preview: render_preview(arm, body, cid)
    v3.export(arm, body, cid)
    return dict(id=cid, label=spec['label'], tris=tris, body=spec['body'])

def render_preview(arm, body, cid):
    """Front / side / back workbench renders of the rest pose and a walk frame (proportion and seam check)."""
    PREVIEW.mkdir(parents=True, exist_ok=True)
    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_WORKBENCH'; sc.display.shading.light = 'STUDIO'; sc.display.shading.color_type = 'TEXTURE'
    sc.display.shading.show_object_outline = True
    sc.render.resolution_x, sc.render.resolution_y = 480, 640; sc.render.film_transparent = False
    sc.world = sc.world or bpy.data.worlds.new('w')
    cam_d = bpy.data.cameras.new('c'); cam_d.type = 'ORTHO'; cam_d.ortho_scale = 2.0
    cam = bpy.data.objects.new('c', cam_d); sc.collection.objects.link(cam); sc.camera = cam
    for view, loc, rot in (('front', (0, -6, .8), (math.pi / 2, 0, 0)), ('side', (6, 0, .8), (math.pi / 2, 0, math.pi / 2)), ('back', (0, 6, .8), (math.pi / 2, 0, math.pi))):
        cam.location = loc; cam.rotation_euler = rot
        sc.frame_set(0); arm.animation_data.action = None; arm.data.pose_position = 'REST'
        sc.render.filepath = str(PREVIEW / f'{cid}-{view}.png'); bpy.ops.render.render(write_still=True)
    arm.data.pose_position = 'POSE'
    walk = bpy.data.actions.get('Walk')
    if walk:
        arm.animation_data.action = walk; sc.frame_set(5); cam.location = (4.2, -4.2, .8); cam.rotation_euler = (math.pi / 2, 0, math.pi / 4)
        sc.render.filepath = str(PREVIEW / f'{cid}-walk.png'); bpy.ops.render.render(write_still=True)
        arm.animation_data.action = None

NPC = lambda **k: dict(label=k.pop('label'), **k)
SPECS = {
    'student-m': dict(label='男學生', body='m', top='tee', bottom='trousers', hair='short',
                      colors=dict(hair='#2b2622', top='#2a8c99', bottom='#3d4a63', shoes='#f2f2f2', bag='#e9b949', acc2='#fbf6ea')),
    'student-f': dict(label='女學生', body='f', top='hoodie', bottom='skirt', hair='ponytail', socks='knee',
                      colors=dict(hair='#4a3326', top='#f2c94c', bottom='#2f4f6f', shoes='#f2f2f2', bag='#2a8c99', acc2='#e45b4a')),
    # NPC archetypes (art-direction-v4 §8.4); colours are defaults, npcs.json recolours per NPC.
    'npc-guide': NPC(label='阿灣', body='f', top='hoodie', bottom='trousers', hair='ponytail', height=1.03,
                     colors=dict(hair='#4a3326', top='#62c8d2', bottom='#2c4a6e', shoes='#fbf6ea', bag='#e9b949', acc2='#e04b3a')),
    'npc-student-1': NPC(label='學生（高瘦）', body='m', top='tee', bottom='trousers', hair='short', height=1.06, girth=.92,
                         colors=dict(hair='#1f1a1a', top='#c75f4a', bottom='#3c4a5c', bag='#2a2c4a')),
    'npc-student-2': NPC(label='學生（短髮女）', body='f', top='tee', bottom='trousers', hair='bob', bag='none',
                         colors=dict(hair='#2b2622', top='#efe6d1', bottom='#5c6e8a')),
    'npc-student-3': NPC(label='學生（長髮）', body='f', top='shirt-long', bottom='skirt', hair='long', socks='ankle', height=.98,
                         colors=dict(hair='#3b2a22', top='#a99be0', bottom='#2a2c4a', bag='#efe6d1')),
    'npc-student-4': NPC(label='學生（運動）', body='m', top='tee', bottom='shorts', hair='short', girth=1.06, bag='none',
                         colors=dict(hair='#2b2622', top='#4d9a44', bottom='#2a2c4a', shoes='#e04b3a')),
    'npc-student-5': NPC(label='學生（矮壯、眼鏡）', body='m', top='hoodie', bottom='trousers', hair='short', glasses=True, height=.95, girth=1.12,
                         colors=dict(hair='#1f1a1a', top='#3c4a5c', bottom='#6b6f78', bag='#e9b949')),
    'npc-student-6': NPC(label='學生（馬尾、外套）', body='f', top='jacket', bottom='trousers', hair='ponytail',
                         colors=dict(hair='#8a5a3a', top='#e8875a', bottom='#2f3a48', bag='#2a2c4a', acc2='#62c8d2')),
    'npc-teacher': NPC(label='教職員', body='m', top='shirt-long', bottom='trousers', hair='short', glasses=True, bag='none', height=1.04,
                       colors=dict(hair='#6b6f78', top='#f4f1ea', bottom='#6b6f78', shoes='#3b2a22')),
    'npc-desk': NPC(label='服務台', body='m', top='shirt-long', bottom='trousers', hair='short', vest=True, bag='none',
                    colors=dict(hair='#2b2622', top='#fbf6ea', bottom='#2f3a48', acc2='#2c7f91', shoes='#2a2c4a')),
    'npc-clerk': NPC(label='店員', body='f', top='tee', bottom='trousers', hair='ponytail', apron=True, cap=True, bag='none',
                     colors=dict(hair='#2b2622', top='#efe6d1', bottom='#3c4a5c', acc1='#e8b84a', acc2='#e8b84a')),
    'npc-guard': NPC(label='警衛', body='m', top='shirt-long', bottom='trousers', hair='short', cap=True, bag='none', girth=1.18, height=1.02,
                     colors=dict(hair='#6b6f78', top='#2a3a5c', bottom='#2a3a5c', acc1='#2a3a5c', shoes='#1f1a1a')),
    'npc-volunteer': NPC(label='志工', body='f', top='shirt-long', bottom='trousers', hair='bob', vest=True, bag='none', girth=1.08, height=.97,
                         colors=dict(hair='#5a4a40', top='#efe6d1', bottom='#5c4a3a', acc2='#b7e04a')),
}

if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    preview = '--preview' in argv
    ids = [a for a in argv if not a.startswith('--')] or list(SPECS)
    meta = [build(c, SPECS[c], preview) for c in ids]
    print(json.dumps(meta, ensure_ascii=False))
