"""v3 skinned characters (art-direction-v3.md §6, spec-v3.md §3.4/§7).

Run: "$(cat tools/blender-path.txt)" --background --python tools/create_characters_v3.py [-- id1 id2 ...]

Sources: Quaternius "Animated Men Pack" / "Animated Women Pack" (CC0 1.0), raw GLBs in
data/sources/characters/quaternius-animated-{men,women}/ (see provenance.json there).
The pack meshes have no UVs; every face is UV-mapped onto a procedurally painted 256 px
swatch atlas (one material per character). Face roles come from the source material slot
plus small geometric rules (open jacket stripe, skirt split, ...). The head front gets a
planar projection onto a painted face tile (mouth + blush). Head is enlarged (~4.5 heads),
clips are renamed / re-timed / authored, `_OUTLINENORMAL` (smoothed normals) is stored for
inverted-hull outlines, then each GLB is meshopt-compressed with @gltf-transform/cli.

Blender: Z up, character faces -Y (= glTF +Z after export).
"""
from pathlib import Path
import json, math, subprocess, sys, shutil
import bpy
import numpy as np
from mathutils import Vector, Matrix, Quaternion

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / 'data/sources/characters'
OUT = ROOT / 'public/models/characters'; OUT.mkdir(parents=True, exist_ok=True)
RAW = ROOT / 'artifacts/v3/T5/raw'; RAW.mkdir(parents=True, exist_ok=True)
FPS = 24
TARGET_H = 1.55
HEAD_SCALE = 1.75

# ---------------------------------------------------------------- palette helpers
def srgb(h):
    h = h.lstrip('#'); return [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]

SKIN = '#f2c9a5'; INK = '#2a2c4a'; BLUSH = '#ee9f95'
HAIR_POOL = ['#1f1a1a', '#2b2622', '#3b2a22', '#4a3326']

MEN = 'quaternius-animated-men'; WOMEN = 'quaternius-animated-women'

# Material slot -> role. Unknown slots fall back to 'top'.
BASE_ROLE = {'Skin': 'skin', 'Hair': 'hair', 'Hair2': 'hair', 'HairBase': 'hair', 'Eyebrows': 'brow',
             'Eyes': 'eye', 'Shirt': 'top', 'Shirt2': 'top', 'Jacket': 'top', 'LightJacket': 'top',
             'Dress': 'top', 'Pants': 'bottom', 'Shoes': 'shoes', 'Socks': 'shoes'}

# Geometric rules: f(role, centre, normal, h) -> new role or None.  h = z / body height (0 feet, 1 top).
def open_front(width=0.022, lo=0.60, hi=0.80, src=('top',), to='inner'):
    """Vertical stripe down the chest -> open jacket / coat showing the inner layer."""
    def r(role, c, n, h, H):
        if role in src and abs(c.x) < width * H and n.y < -0.35 and lo < h < hi: return to
    return r

def split_below(hcut, src='top', to='bottom'):
    def r(role, c, n, h, H):
        if role == src and h < hcut: return to
    return r

def remap(a, b):
    def r(role, c, n, h, H):
        if role == a: return b
    return r

SPECS = {
    # ---- playable
    'ahai': dict(src=f'{MEN}/HMnuH5geEG.glb', label='阿海', colors=dict(
        hair='#3b2a22', top='#2a8c99', inner='#fbf6ea', bottom='#efe6d1', shoes='#f27a2c', acc1=INK, acc2='#62c8d2'),
        acc=['snorkel']),
    'lan': dict(src=f'{WOMEN}/zMyPlQXBzq.glb', label='小嵐', colors=dict(
        hair='#1f1a1a', top='#d9a521', bottom='#173e49', shoes='#fbf6ea', acc1='#e04b3a', acc2=INK),
        rules=[split_below(0.50)], acc=['hairclip', 'sidebag']),
    'tuo': dict(src=f'{MEN}/fjHyMd5Wxw.glb', label='阿拓', colors=dict(
        hair='#2b2622', top='#f4f1ea', inner='#7b4a8f', bottom='#6b6f78', shoes='#26262c', acc1='#1d1d22', acc2='#3f8f4c'),
        matmap={'Shirt': 'top', 'Shirt2': 'inner'}, acc=['glasses', 'backpack']),
    'wan': dict(src=f'{WOMEN}/AQsd9ngvKU.glb', label='阿灣', colors=dict(
        hair='#4a3326', top='#62c8d2', inner='#fbf6ea', bottom='#2c4a6e', shoes='#f27a2c', acc1='#e9b949', acc2='#4a3326'),
        matmap={'Shirt': 'inner', 'Jacket': 'top', 'LightJacket': 'top'}, acc=['ponytail']),
    # ---- student NPCs (palette pools §6.2)
    'np1': dict(src=f'{MEN}/DLptRuewTn.glb', label='學生1', colors=dict(
        hair='#1f1a1a', top='#2f5fa8', bottom='#173e49', shoes='#fbf6ea', acc2='#e04b3a'), acc=['backpack']),
    'np2': dict(src=f'{WOMEN}/XqzeZGB7iU.glb', label='學生2', colors=dict(
        hair='#3b2a22', top='#e04b3a', bottom='#efe6d1', shoes=INK)),
    'np3': dict(src=f'{WOMEN}/jpKRgGDxhk.glb', label='學生3', colors=dict(
        hair='#1f1a1a', top='#3d7a4a', bottom='#173e49', shoes='#fbf6ea')),
    'np4': dict(src=f'{MEN}/HMnuH5geEG.glb', label='學生4', colors=dict(
        hair='#2b2622', top='#fbf6ea', bottom='#173e49', shoes=INK, acc2='#2a8c99'), acc=['backpack']),
    'np5': dict(src=f'{WOMEN}/zMyPlQXBzq.glb', label='學生5', colors=dict(
        hair='#4a3326', top='#7b4a8f', bottom='#efe6d1', shoes=INK), rules=[split_below(0.50)]),
    'np6': dict(src=f'{MEN}/fjHyMd5Wxw.glb', label='學生6', colors=dict(
        hair='#1f1a1a', top='#6b6f78', inner='#fbf6ea', bottom='#efe6d1', shoes='#fbf6ea'),
        matmap={'Shirt': 'top', 'Shirt2': 'inner'}),
}

# Atlas: 8x8 cells of 32 px; cells (6..7, 6..7) are the 64 px face tile.
ROLES = ['skin', 'hair', 'brow', 'eye', 'top', 'inner', 'bottom', 'shoes', 'acc1', 'acc2', 'mouth']
CELL = 32; N = 256

def cell_uv(role):
    i = ROLES.index(role); cx, cy = i % 8, i // 8
    return ((cx + .5) * CELL / N, (cy + .5) * CELL / N)

FACE_TILE = (6 * CELL, 6 * CELL, 2 * CELL)  # x0, y0, size in px

# ---------------------------------------------------------------- scene helpers
def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    s = bpy.context.scene; s.render.fps = FPS

def import_src(path):
    bpy.ops.import_scene.gltf(filepath=str(path))
    arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
    body = next(o for o in bpy.data.objects if o.type == 'MESH' and o.parent == arm)
    mw = arm.matrix_world.copy(); arm.parent = None; arm.matrix_world = mw
    for o in list(bpy.data.objects):
        if o not in (arm, body): bpy.data.objects.remove(o, do_unlink=True)
    for m in list(bpy.data.meshes):
        if m.users == 0: bpy.data.meshes.remove(m)
    arm.animation_data.action = None
    return arm, body

def world_verts(body):
    mw = body.matrix_world
    return [mw @ v.co for v in body.data.vertices]

def set_active(o):
    for x in bpy.context.view_layer.objects: x.select_set(False)
    o.select_set(True); bpy.context.view_layer.objects.active = o

# ---------------------------------------------------------------- roles + UVs
def assign_roles(body, spec):
    me = body.data; mw = body.matrix_world; nm = mw.to_3x3()
    H = max(v.z for v in world_verts(body))
    mats = [m.name.split('.')[0] if m else '' for m in me.materials]
    matmap = {**BASE_ROLE, **spec.get('matmap', {})}
    roles = []
    for p in me.polygons:
        role = matmap.get(mats[p.material_index], 'top')
        c = mw @ p.center; n = (nm @ p.normal).normalized(); h = c.z / H
        if role == 'eye':  # men's dark 'Eyes' slot is shared with shoe soles and other small parts
            if h < 0.6: role = 'shoes'
            elif abs(c.x) > 0.25 * H / 4.85: role = 'skin'
        for r in spec.get('rules', []):
            role = r(role, c, n, h, H) or role
        roles.append(role)
    return roles, H

def face_frame(body, roles, arm):
    """Head-front skin faces and the projection box for the face tile."""
    me = body.data; mw = body.matrix_world; nm = mw.to_3x3()
    neck_z = (arm.matrix_world @ arm.data.bones['Head'].head_local).z
    eyes = [mw @ p.center for p, r in zip(me.polygons, roles) if r == 'eye']
    front = [i for i, (p, r) in enumerate(zip(me.polygons, roles))
             if r == 'skin' and (mw @ p.center).z > neck_z - 0.1 and (nm @ p.normal).normalized().y < -0.2]
    pts = [mw @ me.vertices[v].co for i in front for v in me.polygons[i].vertices]
    x0, x1 = min(p.x for p in pts), max(p.x for p in pts)
    z0, z1 = min(p.z for p in pts), max(p.z for p in pts)
    ez = sum(e.z for e in eyes) / len(eyes); ex = sum(abs(e.x) for e in eyes) / len(eyes)
    return set(front), (x0, x1, z0, z1), dict(eye_z=ez, eye_x=ex, chin=z0)

def build_uvs(body, roles, front, box):
    me = body.data; mw = body.matrix_world
    while me.uv_layers: me.uv_layers.remove(me.uv_layers[0])  # some sources carry an unused UV set
    uv = me.uv_layers.new(name='UVMap')
    x0, x1, z0, z1 = box; tx, ty, ts = FACE_TILE; pad = 2
    for i, p in enumerate(me.polygons):
        for li in p.loop_indices:
            if i in front:
                v = mw @ me.vertices[me.loops[li].vertex_index].co
                u = (tx + pad + (v.x - x0) / (x1 - x0) * (ts - 2 * pad)) / N
                w = (ty + pad + (v.z - z0) / (z1 - z0) * (ts - 2 * pad)) / N
                uv.data[li].uv = (u, w)
            else:
                uv.data[li].uv = cell_uv(roles[i])

def paint_atlas(name, colors, box, face):
    img = np.ones((N, N, 4), dtype=np.float32)
    cols = {'skin': SKIN, 'eye': INK, 'mouth': '#8c3b3b', 'brow': colors.get('hair', '#2b2622'),
            'acc1': INK, 'acc2': INK, 'inner': '#fbf6ea'}
    cols.update(colors)
    for i, r in enumerate(ROLES):
        cx, cy = i % 8, i // 8
        img[cy * CELL:(cy + 1) * CELL, cx * CELL:(cx + 1) * CELL, :3] = srgb(cols[r])
    if face is None:
        im = bpy.data.images.new(f'{name}_atlas', N, N, alpha=False)
        im.pixels.foreach_set(img.ravel()); im.pack(); return im
    # face tile: skin + mouth stroke + blush, in projected world coordinates
    x0, x1, z0, z1 = box; tx, ty, ts = FACE_TILE; pad = 2
    yy, xx = np.mgrid[0:ts, 0:ts].astype(np.float32) + .5
    wx = x0 + (xx - pad) / (ts - 2 * pad) * (x1 - x0)
    wz = z0 + (yy - pad) / (ts - 2 * pad) * (z1 - z0)
    tile = np.zeros((ts, ts, 3), dtype=np.float32); tile[:] = srgb(SKIN)
    ez, ex, chin = face['eye_z'], face['eye_x'], face['chin']
    span = ez - chin
    # blush: soft discs under the eyes
    for sx in (-1, 1):
        d = ((wx - sx * ex * 1.05) / (ex * .55)) ** 2 + ((wz - (ez - .30 * span)) / (span * .11)) ** 2
        a = np.clip(1.2 - d, 0, 1)[..., None] * .55
        tile = tile * (1 - a) + np.array(srgb(BLUSH)) * a
    # mouth: short smile arc
    mz = chin + .42 * span; mw_ = ex * .55
    arc = mz + (wx / mw_) ** 2 * span * .05
    m = (np.abs(wx) < mw_) & (np.abs(wz - arc) < span * .028)
    tile[m] = srgb('#7a3434')
    img[ty:ty + ts, tx:tx + ts, :3] = tile
    im = bpy.data.images.new(f'{name}_atlas', N, N, alpha=False)
    im.pixels.foreach_set(img.ravel()); im.pack()
    return im

def make_material(name, img):
    m = bpy.data.materials.new(f'{name}'); m.use_nodes = True
    nt = m.node_tree; b = nt.nodes['Principled BSDF']
    t = nt.nodes.new('ShaderNodeTexImage'); t.image = img; t.interpolation = 'Linear'
    nt.links.new(t.outputs['Color'], b.inputs['Base Color'])
    m.use_backface_culling = True
    b.inputs['Roughness'].default_value = 1.0; b.inputs['Metallic'].default_value = 0.0
    return m

# ---------------------------------------------------------------- accessories (joined, rigid-weighted)
def bone_head(arm, name):
    return arm.matrix_world @ arm.data.bones[name].head_local

def prim(kind, loc, scale, rot=(0, 0, 0), **kw):
    if kind == 'cube': bpy.ops.mesh.primitive_cube_add(size=1)
    elif kind == 'sphere': bpy.ops.mesh.primitive_uv_sphere_add(segments=kw.get('seg', 10), ring_count=kw.get('rings', 6))
    elif kind == 'cyl': bpy.ops.mesh.primitive_cylinder_add(vertices=kw.get('seg', 8), radius=.5, depth=1)
    elif kind == 'torus': bpy.ops.mesh.primitive_torus_add(major_segments=kw.get('seg', 10), minor_segments=4, major_radius=.5, minor_radius=kw.get('minor', .08))
    o = bpy.context.object; o.location = loc; o.scale = scale; o.rotation_euler = rot
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    if kw.get('bevel'):
        md = o.modifiers.new('b', 'BEVEL'); md.width = kw['bevel']; md.segments = 2
        bpy.ops.object.modifier_apply(modifier=md.name)
    for p in o.data.polygons: p.use_smooth = True
    return o

def attach(body, o, bone, role):
    while len(o.data.uv_layers) > 1: o.data.uv_layers.remove(o.data.uv_layers[-1])
    uv = o.data.uv_layers[0] if o.data.uv_layers else o.data.uv_layers.new(name='UVMap')
    uv.name = 'UVMap'
    for l in uv.data: l.uv = cell_uv(role)
    vg = o.vertex_groups.new(name=bone); vg.add(list(range(len(o.data.vertices))), 1.0, 'REPLACE')
    o.data.materials.clear()
    set_active(body); o.select_set(True); bpy.ops.object.join()

def add_accessories(arm, body, spec, H, face, box):
    s = H / 4.85  # sizes authored against the source scale (~4.85 units tall)
    head = bone_head(arm, 'Head'); x0, x1, z0, z1 = box
    front_y = min((body.matrix_world @ v.co).y for v in body.data.vertices if (body.matrix_world @ v.co).z > head.z)
    back_y = max((body.matrix_world @ v.co).y for v in body.data.vertices if (body.matrix_world @ v.co).z > head.z)
    torso = bone_head(arm, 'Torso')
    for a in spec.get('acc', []):
        if a == 'glasses':
            ez, ex = face['eye_z'], face['eye_x']
            for sx in (-1, 1):
                attach(body, prim('torus', (sx * ex, front_y - .03 * s, ez), (ex * 1.15, ex * 1.15, ex * .9), (math.pi / 2, 0, 0), seg=8, minor=.12), 'Head', 'acc1')
            attach(body, prim('cube', (0, front_y - .03 * s, ez + ex * .1), (ex * .7, .03 * s, .035 * s)), 'Head', 'acc1')
        elif a == 'ponytail':
            attach(body, prim('sphere', (0, back_y + .10 * s, head.z + .16 * s), (.14 * s, .13 * s, .36 * s), (.35, 0, 0), seg=10, rings=7), 'Head', 'hair')
            attach(body, prim('torus', (0, back_y + .01 * s, head.z + .42 * s), (.15 * s, .15 * s, .15 * s), (1.35, 0, 0), seg=8, minor=.25), 'Head', 'acc1')
        elif a == 'hairclip':
            attach(body, prim('cube', (.27 * s, front_y + .17 * s, head.z + .50 * s), (.05 * s, .16 * s, .045 * s), (0, -.5, 0), bevel=.01 * s), 'Head', 'acc1')
        elif a == 'backpack':
            attach(body, prim('cube', (0, .42 * s, torso.z + .22 * s), (.62 * s, .30 * s, .78 * s), bevel=.09 * s), 'Torso', 'acc2')
        elif a == 'sidebag':
            attach(body, prim('cube', (.48 * s, -.02 * s, 2.25 * s), (.12 * s, .62 * s, .48 * s), bevel=.04 * s), 'Hips', 'acc2')
        elif a == 'snorkel':
            nk = bone_head(arm, 'Neck')
            attach(body, prim('cube', (0, -.28 * s, nk.z - .12 * s), (.42 * s, .10 * s, .16 * s), bevel=.05 * s), 'Torso', 'acc2')
            attach(body, prim('torus', (0, -.02 * s, nk.z - .02 * s), (.62 * s, .5 * s, .3 * s), seg=10, minor=.07), 'Torso', 'acc1')

# ---------------------------------------------------------------- proportions
def enlarge_head(arm, body, s):
    """Scale the head in pose space, bake it into the mesh, then make that pose the rest pose."""
    set_active(arm); bpy.ops.object.mode_set(mode='POSE')
    for pb in arm.pose.bones: pb.matrix_basis = Matrix()
    arm.pose.bones['Head'].scale = (s, s, s)
    bpy.ops.object.mode_set(mode='OBJECT')
    set_active(body)
    mod = next(m for m in body.modifiers if m.type == 'ARMATURE')
    bpy.ops.object.modifier_copy(modifier=mod.name)
    bpy.ops.object.modifier_apply(modifier=mod.name)  # applies the first (original) copy
    set_active(arm); bpy.ops.object.mode_set(mode='POSE')
    bpy.ops.pose.armature_apply(selected=False)
    for pb in arm.pose.bones: pb.matrix_basis = Matrix()
    bpy.ops.object.mode_set(mode='OBJECT')

# ---------------------------------------------------------------- animation baking
BONES_KEY = ('location', 'rotation_quaternion', 'scale')

def find_action(suffix):
    return next(a for a in bpy.data.actions if a.name.endswith(suffix))

def sample(arm, action, frame):
    arm.animation_data.action = action
    for pb in arm.pose.bones: pb.matrix_basis = Matrix()  # unkeyed channels must not keep earlier edits
    f = int(math.floor(frame)); bpy.context.scene.frame_set(f, subframe=frame - f)
    bpy.context.view_layer.update()
    keyed = {fc.data_path.split('"')[1] for fc in action.fcurves if 'rotation' in fc.data_path}
    if 'UpperArm.R' not in keyed and 'UpperArm.L' in keyed:
        mirror_bone(arm, 'UpperArm.L', 'UpperArm.R')

def mirror_bone(arm, src, dst):
    """The women's Idle lost its UpperArm.R channel in the source GLB (arm would stay in T-pose):
    rebuild it as the X-mirror of the left arm's armature-space rotation delta from rest."""
    bl, br = arm.data.bones[src], arm.data.bones[dst]
    pl = arm.pose.bones[src]
    ql = (pl.matrix.to_quaternion() @ bl.matrix_local.to_quaternion().inverted())
    qr = Quaternion((ql.w, ql.x, -ql.y, -ql.z))
    pr = arm.pose.bones[dst]; t = pr.matrix.translation.copy()
    m = (qr @ br.matrix_local.to_quaternion()).to_matrix().to_4x4(); m.translation = t
    pr.matrix = m; bpy.context.view_layer.update()

def bake(arm, name, n_frames, src_fn, edit_fn=None, loop_blend=0):
    """Create action `name` with n_frames keys. src_fn(i) -> (action, frame) to sample;
    edit_fn(arm, i) may then modify pose bones (armature space via pb.matrix)."""
    poses = []
    for i in range(n_frames):
        act, fr = src_fn(i); sample(arm, act, fr)
        for pb in arm.pose.bones: pb.rotation_mode = 'QUATERNION'
        if edit_fn: edit_fn(arm, i)
        poses.append({pb.name: pb.matrix_basis.copy() for pb in arm.pose.bones})
    if loop_blend:
        for k in range(loop_blend):
            i = n_frames - loop_blend + k; t = (k + 1) / (loop_blend + 1)
            for b, m in poses[i].items():
                l0, r0, s0 = m.decompose(); l1, r1, s1 = poses[0][b].decompose()
                poses[i][b] = Matrix.LocRotScale(l0.lerp(l1, t), r0.slerp(r1, t), s0.lerp(s1, t))
    arm.animation_data.action = None
    act = bpy.data.actions.new(name); arm.animation_data.action = act
    for i, pose in enumerate(poses):
        for pb in arm.pose.bones:
            pb.matrix_basis = pose[pb.name]
            for dp in BONES_KEY: pb.keyframe_insert(dp, frame=i, group=pb.name)
    arm.animation_data.action = None
    return act

def w2a(arm, v):
    """World-space direction -> armature space (the imported armature carries a -90 deg X rotation)."""
    return (arm.matrix_world.to_3x3().normalized().inverted() @ Vector(v)).normalized()

def bone_dir(arm, bone):
    """World-space direction of a pose bone's Y axis (along the limb for arms)."""
    return (arm.matrix_world.to_3x3().normalized() @ arm.pose.bones[bone].matrix.col[1].xyz).normalized()

def rotate_bone_to(arm, bone, target_dir, twist=0.0):
    """Rotate pose bone so its Y axis points along target_dir (world space)."""
    pb = arm.pose.bones[bone]; m = pb.matrix.copy(); tgt = w2a(arm, target_dir)
    cur = m.col[1].xyz.normalized(); q = cur.rotation_difference(tgt)
    if twist: q = Quaternion(tgt, twist) @ q
    h = m.translation.copy()
    pb.matrix = Matrix.Translation(h) @ q.to_matrix().to_4x4() @ Matrix.Translation(-h) @ m
    bpy.context.view_layer.update()

def rotate_bone_axis(arm, bone, axis, angle):
    """Rotate pose bone about a world-space axis through its head."""
    pb = arm.pose.bones[bone]; m = pb.matrix.copy(); h = m.translation.copy()
    q = Quaternion(w2a(arm, axis), angle)
    pb.matrix = Matrix.Translation(h) @ q.to_matrix().to_4x4() @ Matrix.Translation(-h) @ m
    bpy.context.view_layer.update()

def ease(t): t = max(0., min(1., t)); return t * t * (3 - 2 * t)

def build_clips(arm, prefix):
    idle, walk, run = find_action(f'{prefix}_Idle'), find_action(f'{prefix}_Walk'), find_action(f'{prefix}_Run')
    jump, sit = find_action(f'{prefix}_Jump'), find_action(f'{prefix}_Sitting')
    clips = {}
    # Pack loops are in place (hips XY drift < 2 cm, measured). Re-bake so every bone is keyed in
    # every clip (unkeyed bones would keep the previous clip's pose in three.js).
    for nm, a in (('Idle', idle), ('Walk', walk), ('Run', run)):
        n0 = int(a.frame_range[1] - a.frame_range[0]) + 1; f0 = a.frame_range[0]
        clips[nm] = bake(arm, nm, n0, lambda i, a=a, f0=f0: (a, f0 + i))
    # Jump: 1.04 s -> 0.75 s one-shot; remove the baked vertical lift (physics moves the root),
    # keeping crouch and leg tuck by shifting Body and both foot IK bones down by the same amount.
    sample(arm, jump, 0); base_z = (arm.matrix_world @ arm.pose.bones['Hips'].head).z
    inv = arm.matrix_world.inverted()
    def jump_edit(a, i):
        z = (a.matrix_world @ a.pose.bones['Hips'].head).z; d = max(0., z - base_z)
        if d <= 0: return
        dl = (inv.to_3x3() @ Vector((0, 0, d)))
        for b in ('Body', 'Foot.L', 'Foot.R'):
            pb = a.pose.bones[b]; m = pb.matrix.copy(); m.translation -= dl; pb.matrix = m
        bpy.context.view_layer.update()
    n = 18; clips['Jump'] = bake(arm, 'Jump', n, lambda i: (jump, i * 24 / (n - 1)), jump_edit)
    # Sit: seated section of the pack's 8.3 s sit-down clip, 2 s loop.
    clips['Sit'] = bake(arm, 'Sit', 48, lambda i: (sit, 60 + i), loop_blend=8)
    # Wave (authored): idle base, right arm up, forearm waves, back down. 1.6 s.
    nW = 39
    def wave_edit(a, i):
        t = i / (nW - 1); up = ease(t / .22) * (1 - ease((t - .80) / .20))
        if up <= 0: return
        idle_dir = bone_dir(a, 'UpperArm.R')
        tgt = idle_dir.lerp(Vector((-.70, -.20, .62)).normalized(), up)
        rotate_bone_to(a, 'UpperArm.R', tgt)
        fa = bone_dir(a, 'LowerArm.R')
        sw = math.sin((t - .2) / .6 * 2 * math.pi * 2) * .45 if .2 < t < .8 else 0
        rotate_bone_to(a, 'LowerArm.R', fa.lerp(Vector((-.15 + sw, -.25, 1)).normalized(), up))
        rotate_bone_axis(a, 'Head', (0, 1, 0), -.10 * up)
    clips['Wave'] = bake(arm, 'Wave', nW, lambda i: (idle, i * 100 / (nW - 1) * .4), wave_edit)
    # Talk (authored): idle base + head nods + right-hand gesture, 1.6 s loop.
    nT = 39
    def talk_edit(a, i):
        ph = i / (nT - 1) * 2 * math.pi
        rotate_bone_axis(a, 'Head', (1, 0, 0), .10 * math.sin(2 * ph) + .03)
        rotate_bone_axis(a, 'Neck', (0, 0, 1), .06 * math.sin(ph))
        ua = bone_dir(a, 'UpperArm.R')
        rotate_bone_to(a, 'UpperArm.R', ua.lerp(Vector((-.35, -.45, -.75)).normalized(), .7))
        g = .5 + .5 * math.sin(ph)
        rotate_bone_to(a, 'LowerArm.R', Vector((-.10 - .25 * g, -1, .15 + .35 * g)).normalized(), twist=-.6)
        rotate_bone_axis(a, 'Torso', (0, 0, 1), .05 * math.sin(ph))
    # Talk samples a fixed idle frame so the loop closes exactly.
    clips['Talk'] = bake(arm, 'Talk', nT, lambda i: (idle, 0), talk_edit)
    # Clean up: drop every other pack action.
    keep = set(clips.values())
    for a in list(bpy.data.actions):
        if a not in keep: bpy.data.actions.remove(a)
    ad = arm.animation_data
    for tr in list(ad.nla_tracks): ad.nla_tracks.remove(tr)
    for nm in ('Idle', 'Walk', 'Run', 'Jump', 'Wave', 'Talk', 'Sit'):
        tr = ad.nla_tracks.new(); tr.name = nm
        a = clips[nm]; st = tr.strips.new(nm, int(a.frame_range[0]), a)
        st.extrapolation = 'NOTHING'; tr.mute = False
    ad.action = None
    return clips

# ---------------------------------------------------------------- outline normals
def store_outline_normals(body, conv=lambda n: (n.x, -n.y, -n.z)):
    """Per-vertex area-weighted normal averaged across all vertices sharing a position.
    Custom attributes are exported verbatim (no axis conversion). For the imported pack meshes the
    right mapping is (x, -y, -z) (found empirically); for meshes authored Z-up here it is the
    standard (x, z, -y). tools/verify_characters.mjs checks the mean dot with NORMAL."""
    me = body.data; me.calc_loop_triangles()
    acc = {}
    key = lambda co: (round(co.x, 4), round(co.y, 4), round(co.z, 4))
    for p in me.polygons:
        for vi in p.vertices:
            k = key(me.vertices[vi].co); acc[k] = acc.get(k, Vector()) + p.normal * p.area
    data = []
    for v in me.vertices:
        n = acc[key(v.co)]; n = n.normalized() if n.length > 1e-12 else v.normal
        data.extend(conv(n))
    at = me.attributes.new('_OUTLINENORMAL', 'FLOAT_VECTOR', 'POINT')
    at.data.foreach_set('vector', data)

# ---------------------------------------------------------------- export
def export(arm, body, cid):
    set_active(arm); body.select_set(True); bpy.context.scene.frame_set(0)
    raw = RAW / f'{cid}.glb'
    kw = dict(filepath=str(raw), export_format='GLB', use_selection=True, export_yup=True, export_animations=True,
              export_animation_mode='NLA_TRACKS', export_force_sampling=True, export_optimize_animation_size=True,
              export_attributes=True, export_image_format='AUTO', export_materials='EXPORT', export_skins=True,
              export_def_bones=False, export_reset_pose_bones=True, export_cameras=False, export_lights=False,
              export_apply=False, export_anim_slide_to_zero=True)
    bpy.ops.export_scene.gltf(**kw)
    out = OUT / f'{cid}.glb'
    npx = shutil.which('npx') or 'npx'
    subprocess.run([npx, 'gltf-transform', 'meshopt', str(raw), str(out)], cwd=ROOT, check=True)
    print('EXPORTED', cid, raw.stat().st_size, '->', out.stat().st_size, flush=True)


# ---------------------------------------------------------------- monkey (authored here, CC0 by this repo)
MONKEY_COLORS = dict(top='#7d6b5d', bottom='#a89686', skin='#d97f76', eye=INK, hair='#6a5a4e', shoes='#d97f76')
MONKEY_BONES = [  # name, head, tail, parent   (metres, Z up, facing -Y)
    ('Root', (0, 0, 0), (0, 0, .08), None),
    ('Hips', (0, .14, .30), (0, .02, .31), 'Root'),
    ('Spine', (0, .02, .31), (0, -.12, .33), 'Hips'),
    ('Neck', (0, -.12, .33), (0, -.19, .38), 'Spine'),
    ('Head', (0, -.19, .38), (0, -.30, .41), 'Neck'),
    ('Tail1', (0, .17, .31), (0, .26, .30), 'Hips'),
    ('Tail2', (0, .26, .30), (0, .33, .26), 'Tail1'),
    ('Tail3', (0, .33, .26), (0, .38, .19), 'Tail2'),
] + [b for sx, sd in ((1, 'L'), (-1, 'R')) for b in (
    (f'Arm.{sd}', (sx * .075, -.10, .29), (sx * .08, -.11, .155), 'Spine'),
    (f'Forearm.{sd}', (sx * .08, -.11, .155), (sx * .08, -.10, .02), f'Arm.{sd}'),
    (f'Thigh.{sd}', (sx * .075, .13, .28), (sx * .08, .07, .15), 'Hips'),
    (f'Shin.{sd}', (sx * .08, .07, .15), (sx * .08, .12, .02), f'Thigh.{sd}'))]

def capsule(a, b, r, seg=10):
    a, b = Vector(a), Vector(b); d = b - a
    bpy.ops.mesh.primitive_cylinder_add(vertices=seg, radius=r, depth=d.length, location=(a + b) / 2)
    o = bpy.context.object; o.rotation_mode = 'QUATERNION'; o.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(d)
    parts = [o]
    for p in (a, b):
        bpy.ops.mesh.primitive_uv_sphere_add(segments=seg, ring_count=6, radius=r, location=p); parts.append(bpy.context.object)
    return parts

def build_monkey():
    reset()
    ad = bpy.data.armatures.new('monkey'); arm = bpy.data.objects.new('monkey', ad); bpy.context.collection.objects.link(arm)
    set_active(arm); bpy.ops.object.mode_set(mode='EDIT')
    for nm, h, t, par in MONKEY_BONES:
        eb = ad.edit_bones.new(nm); eb.head = h; eb.tail = t
        if par: eb.parent = ad.edit_bones[par]; eb.use_connect = False
    bpy.ops.object.mode_set(mode='OBJECT')
    # body volume from primitives -> voxel remesh -> decimate (soft, single surface)
    parts = []
    def ell(c, r):
        bpy.ops.mesh.primitive_uv_sphere_add(segments=16, ring_count=10, location=c); o = bpy.context.object; o.scale = r; parts.append(o)
    ell((0, .03, .31), (.095, .16, .095)); ell((0, -.09, .33), (.088, .08, .09)); ell((0, .13, .29), (.085, .07, .08))
    ell((0, -.165, .375), (.055, .06, .058)); ell((0, -.245, .425), (.072, .07, .075)); ell((0, -.305, .405), (.042, .035, .035))  # head, muzzle
    for sx in (1, -1):
        ell((sx * .068, -.235, .445), (.022, .012, .026))  # ears
        parts += capsule((sx * .075, -.10, .29), (sx * .08, -.11, .155), .03)
        parts += capsule((sx * .08, -.11, .155), (sx * .08, -.115, .025), .025)
        ell((sx * .08, -.125, .018), (.028, .04, .018))  # hands
        parts += capsule((sx * .075, .13, .27), (sx * .08, .07, .15), .038)
        parts += capsule((sx * .08, .07, .15), (sx * .08, .12, .025), .028)
        ell((sx * .08, .10, .018), (.03, .05, .018))  # feet
    parts += capsule((0, .17, .31), (0, .26, .30), .02, 8) + capsule((0, .26, .30), (0, .33, .26), .017, 8) + capsule((0, .33, .26), (0, .38, .19), .014, 8)
    set_active(parts[0])
    for o in parts: o.select_set(True)
    bpy.ops.object.join(); body = bpy.context.object; body.name = 'monkey_mesh'; body.data.name = 'monkey_mesh'
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    md = body.modifiers.new('r', 'REMESH'); md.mode = 'VOXEL'; md.voxel_size = .011; bpy.ops.object.modifier_apply(modifier=md.name)
    md = body.modifiers.new('s', 'SMOOTH'); md.iterations = 4; md.factor = .6; bpy.ops.object.modifier_apply(modifier=md.name)
    md = body.modifiers.new('d', 'DECIMATE'); md.ratio = .5; bpy.ops.object.modifier_apply(modifier=md.name)
    while sum(len(p.vertices) - 2 for p in body.data.polygons) > 3000:
        md = body.modifiers.new('d', 'DECIMATE'); md.ratio = .7; bpy.ops.object.modifier_apply(modifier=md.name)
    bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT'); bpy.ops.mesh.quads_convert_to_tris(); bpy.ops.object.mode_set(mode='OBJECT')
    # eyes (ink beads), added after remesh so they stay crisp
    n_body = len(body.data.polygons)
    for sx in (1, -1):
        bpy.ops.mesh.primitive_uv_sphere_add(segments=8, ring_count=5, radius=.0095, location=(sx * .026, -.312, .438))
        e = bpy.context.object; e.scale = (1, .5, 1.2)
        set_active(body); e.select_set(True); bpy.ops.object.join()
    # roles by position
    me = body.data; roles = []
    nz = lambda p: p.normal
    for p in me.polygons:
        c, n = p.center, p.normal; role = 'top'
        if c.y < -.27 and .37 < c.z < .458 and n.y < -.45 and abs(c.x) < .052: role = 'skin'  # face
        elif abs(c.x) > .05 and c.y < -.21 and c.z > .41: role = 'skin' if n.y < -.2 else 'top'  # ear fronts
        elif c.y > .17 and c.z < .31 and c.z > .2 and n.y > .3 and abs(c.x) < .06: role = 'skin'  # rump
        elif c.z > .2 and n.z < -.45 and -.15 < c.y < .16 and abs(c.x) < .08: role = 'bottom'  # belly
        elif c.z < .035 and (n.z < -.2): role = 'skin'  # palms / soles
        roles.append(role)
    # eye beads were joined last: their faces are the tail of the polygon list
    for i in range(n_body, len(me.polygons)): roles[i] = 'eye'
    while me.uv_layers: me.uv_layers.remove(me.uv_layers[0])
    uv = me.uv_layers.new(name='UVMap')
    for i, p in enumerate(me.polygons):
        for li in p.loop_indices: uv.data[li].uv = cell_uv(roles[i])
    img = paint_atlas('monkey', MONKEY_COLORS, None, None)
    me.materials.clear(); me.materials.append(make_material('monkey_toon', img))
    for p in me.polygons: p.use_smooth = True
    me.validate(); me.update()
    # skin
    set_active(body); arm.select_set(True); bpy.context.view_layer.objects.active = arm
    bpy.ops.object.parent_set(type='ARMATURE_AUTO')
    for nm in ('Root',):
        if nm in body.vertex_groups: body.vertex_groups.remove(body.vertex_groups[nm])
    # clips
    arm.animation_data_create(); rest = bpy.data.actions.new('rest')
    for pb in arm.pose.bones: pb.rotation_mode = 'QUATERNION'
    X, Y, Z = (1, 0, 0), (0, 1, 0), (0, 0, 1)
    def stand_walk(a, t, amp):
        ph = 2 * math.pi * t
        for sd, off in (('L', 0), ('R', math.pi)):
            # diagonal gait: front-left with hind-right
            fa = math.sin(ph + off) * amp; ha = math.sin(ph + off + math.pi) * amp
            rotate_bone_axis(a, f'Arm.{sd}', X, fa); rotate_bone_axis(a, f'Forearm.{sd}', X, max(0, -math.cos(ph + off)) * amp * 1.2)
            rotate_bone_axis(a, f'Thigh.{sd}', X, ha); rotate_bone_axis(a, f'Shin.{sd}', X, -max(0, -math.cos(ph + off + math.pi)) * amp * 1.4)
    def loc(a, bone, d):
        pb = a.pose.bones[bone]; m = pb.matrix.copy(); m.translation += Vector(d); pb.matrix = m; bpy.context.view_layer.update()
    def walk_edit(a, i):
        t = i / 22; ph = 2 * math.pi * t
        loc(a, 'Root', (0, 0, .008 * math.sin(2 * ph)))
        stand_walk(a, t, .42)
        rotate_bone_axis(a, 'Head', X, .05 * math.sin(2 * ph))
        rotate_bone_axis(a, 'Tail1', Z, .25 * math.sin(ph)); rotate_bone_axis(a, 'Tail2', Z, .25 * math.sin(ph - .8))
    def idle_edit(a, i):
        t = i / 58; ph = 2 * math.pi * t
        loc(a, 'Root', (0, 0, .004 * math.sin(2 * ph)))
        rotate_bone_axis(a, 'Neck', Z, .35 * math.sin(ph)); rotate_bone_axis(a, 'Head', X, -.08 + .06 * math.sin(2 * ph))
        rotate_bone_axis(a, 'Tail1', Z, .15 * math.sin(ph)); rotate_bone_axis(a, 'Tail2', X, .2 + .1 * math.sin(2 * ph))
    def sit_edit(a, i):
        t = i / 48; ph = 2 * math.pi * t
        loc(a, 'Root', (0, .02, -.17))
        rotate_bone_axis(a, 'Hips', X, -1.05)                     # torso up
        rotate_bone_axis(a, 'Spine', X, -.15 + .02 * math.sin(ph))
        rotate_bone_axis(a, 'Neck', X, .7); rotate_bone_axis(a, 'Head', X, .2); rotate_bone_axis(a, 'Neck', Z, .2 * math.sin(ph))
        for sd, sx in (('L', 1), ('R', -1)):
            rotate_bone_to(a, f'Thigh.{sd}', (sx * .35, -.9, .25)); rotate_bone_to(a, f'Shin.{sd}', (0, .1, -1))
            rotate_bone_to(a, f'Arm.{sd}', (sx * .15, -.35, -1)); rotate_bone_to(a, f'Forearm.{sd}', (sx * .05, -.6, -.8))
        # scratch the head with the right hand in the middle of the loop (art-direction §6.2)
        k = ease((t - .3) / .12) * (1 - ease((t - .7) / .12))
        if k > 0:
            rotate_bone_to(a, 'Arm.R', Vector((-.15, -.35, -1)).normalized().lerp(Vector((-.6, -.1, .8)).normalized(), k))
            rotate_bone_to(a, 'Forearm.R', Vector((-.05, -.6, -.8)).normalized().lerp(Vector((.6, 0, .45 + .25 * math.sin(ph * 6))).normalized(), k))
        rotate_bone_to(a, 'Tail1', (0, .8, -.6)); rotate_bone_to(a, 'Tail2', (0, 1, -.05)); rotate_bone_to(a, 'Tail3', (.4, .9, 0))
    clips = {'Idle': bake(arm, 'Idle', 58, lambda i: (rest, 0), idle_edit),
             'Walk': bake(arm, 'Walk', 22, lambda i: (rest, 0), walk_edit),
             'Sit': bake(arm, 'Sit', 48, lambda i: (rest, 0), sit_edit)}
    bpy.data.actions.remove(rest)
    adt = arm.animation_data
    for nm, a in clips.items():
        tr = adt.nla_tracks.new(); tr.name = nm; st = tr.strips.new(nm, 0, a); st.extrapolation = 'NOTHING'
    adt.action = None
    for pb in arm.pose.bones: pb.matrix_basis = Matrix()
    store_outline_normals(body, conv=lambda n: (n.x, n.z, -n.y))
    arm['license'] = 'CC0-1.0, authored in tools/create_characters_v3.py'
    tris = len(body.data.polygons)
    print('BUILT monkey tris', tris, 'bones', len(ad.bones), flush=True)
    export(arm, body, 'monkey')
    return dict(id='monkey', label='獼猴', source='authored', tris=tris, bones=len(ad.bones))

# ---------------------------------------------------------------- main
def build(cid, spec):
    reset()
    arm, body = import_src(SRC / spec['src'])
    prefix = 'Female' if 'women' in spec['src'] else 'Man'
    roles, H = assign_roles(body, spec)
    front, box, face = face_frame(body, roles, arm)
    build_uvs(body, roles, front, box)
    img = paint_atlas(cid, spec['colors'], box, face)
    body.data.materials.clear(); body.data.materials.append(make_material(f'{cid}_toon', img))
    for p in body.data.polygons: p.material_index = 0; p.use_smooth = True
    add_accessories(arm, body, spec, H, face, box)
    for p in body.data.polygons: p.use_smooth = True; p.material_index = 0
    while len(body.data.materials) > 1: body.data.materials.pop()
    enlarge_head(arm, body, HEAD_SCALE)
    build_clips(arm, prefix)
    # Uniform scale so rest height = 1.55 m (scale stays on the armature node).
    h = max(v.z for v in world_verts(body)) - min(v.z for v in world_verts(body))
    arm.scale = arm.scale * (TARGET_H / h); bpy.context.view_layer.update()
    store_outline_normals(body)
    body.name = f'{cid}_mesh'; arm.name = cid; body.data.name = f'{cid}_mesh'
    arm['license'] = 'CC0-1.0 (Quaternius Animated Men/Women Pack); recolour, atlas, accessories, Wave/Talk: this repo'
    arm['source'] = spec['src']
    tris = sum(len(p.vertices) - 2 for p in body.data.polygons)
    print('BUILT', cid, 'tris', tris, 'bones', len(arm.data.bones), flush=True)
    export(arm, body, cid)
    return dict(id=cid, label=spec['label'], source=spec['src'], tris=tris, bones=len(arm.data.bones))

if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    ids = argv or list(SPECS) + ['monkey']
    meta = [build_monkey() if c == 'monkey' else build(c, SPECS[c]) for c in ids]
    if not argv:
        (OUT / 'README.json').write_text(json.dumps(dict(
            generator='tools/create_characters_v3.py', height_m=TARGET_H, head_scale=HEAD_SCALE, facing='+Z',
            clips=['Idle', 'Walk', 'Run', 'Jump', 'Wave', 'Talk', 'Sit'], outline_attribute='_OUTLINENORMAL (three: _outlinenormal)',
            characters=meta, license='see docs/licenses.md'), ensure_ascii=False, indent=2) + '\n')
