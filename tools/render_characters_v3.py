"""Contact sheet for the v3 characters (T5).
Run: "$(cat tools/blender-path.txt)" --background --python tools/render_characters_v3.py
Renders the uncompressed exports in artifacts/v3/T5/raw/ (Blender cannot import meshopt) with a
toon approximation (3-step ramp per art-direction §1.1 + inverted-hull outline #2a2c4a) to
artifacts/v3/T5/characters.png. Rows: Idle, Walk, and one other clip per character.
Args (after --): `clips <id...>` -> characters-clips.png (all clips per id); `closeup` -> head close-ups.
"""
from pathlib import Path
import math
import bpy
from mathutils import Vector, Matrix

import sys
ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / 'artifacts/v3/T5/raw'; OUT = ROOT / 'artifacts/v3/T5/characters.png'
ORDER = ['ahai', 'lan', 'tuo', 'wan', 'np1', 'np2', 'np3', 'np4', 'np5', 'np6', 'monkey']
IDS = [i for i in ORDER if (RAW / f'{i}.glb').exists()]
CLIPS = ['Idle', 'Walk', 'Run', 'Jump', 'Wave', 'Talk', 'Sit']
PHASE = {'Idle': .35, 'Walk': .25, 'Run': .3, 'Jump': .45, 'Wave': .5, 'Talk': .5, 'Sit': .5}
EXTRA = ['Wave', 'Talk', 'Jump', 'Sit', 'Run', 'Wave', 'Talk', 'Sit', 'Jump', 'Run', 'Sit']
# GRID: rows of (id, clip, label)
if ARGS[:1] == ['clips']:  # every clip for the given ids: one row per id
    OUT = OUT.with_name('characters-clips.png')
    GRID = [[(cid, c, f'{cid} {c}') for c in (['Idle', 'Walk', 'Sit'] if cid == 'monkey' else CLIPS)] for cid in ARGS[1:]]
else:
    GRID = [[(cid, 'Idle', cid) for cid in IDS], [(cid, 'Walk', 'Walk') for cid in IDS],
            [(cid, ('Sit' if cid == 'monkey' else EXTRA[i % len(EXTRA)]), None) for i, cid in enumerate(IDS)]]
    GRID[2] = [(c, k, k) for c, k, _ in GRID[2]]
CLOSEUP = 'closeup' in ARGS
if CLOSEUP: OUT = OUT.with_name('characters-closeup.png'); GRID = [[r for r in GRID[0] if r[0] != 'monkey'][:5]]

bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene

def hexlin(h):
    c = [int(h.lstrip('#')[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(x / 12.92 if x <= .04045 else ((x + .055) / 1.055) ** 2.4 for x in c) + (1,)

def toonify(mat):
    nt = mat.node_tree; img = next(n for n in nt.nodes if n.type == 'TEX_IMAGE').image
    nt.nodes.clear()  # (removing nodes one by one invalidates held node references)
    tex = nt.nodes.new('ShaderNodeTexImage'); tex.image = img
    out = nt.nodes.new('ShaderNodeOutputMaterial'); dif = nt.nodes.new('ShaderNodeBsdfDiffuse')
    s2r = nt.nodes.new('ShaderNodeShaderToRGB'); ramp = nt.nodes.new('ShaderNodeValToRGB')
    mul = nt.nodes.new('ShaderNodeMixRGB'); mul.blend_type = 'MULTIPLY'; mul.inputs[0].default_value = 1
    em = nt.nodes.new('ShaderNodeEmission')
    cr = ramp.color_ramp; cr.interpolation = 'EASE'
    cr.elements[0].position = .30; cr.elements[0].color = (.46 * .92, .46 * .95, .46 * 1.08, 1)
    cr.elements[1].position = .72; cr.elements[1].color = (1, 1, 1, 1)
    e = cr.elements.new(.38); e.color = (.8, .8, .8, 1); e2 = cr.elements.new(.64); e2.color = (.8, .8, .8, 1)
    L = nt.links
    L.new(dif.outputs[0], s2r.inputs[0]); L.new(s2r.outputs[0], ramp.inputs[0])
    L.new(tex.outputs[0], mul.inputs[1]); L.new(ramp.outputs[0], mul.inputs[2])
    L.new(mul.outputs[0], em.inputs[0]); L.new(em.outputs[0], out.inputs[0])

outline = bpy.data.materials.new('outline'); outline.use_nodes = True
ont = outline.node_tree; [ont.nodes.remove(n) for n in list(ont.nodes)]
oo = ont.nodes.new('ShaderNodeOutputMaterial'); oe = ont.nodes.new('ShaderNodeEmission'); oe.inputs[0].default_value = hexlin('#2a2c4a')
ont.links.new(oe.outputs[0], oo.inputs[0]); outline.use_backface_culling = True


shadow = bpy.data.materials.new('shadow'); shadow.use_nodes = True
snt = shadow.node_tree; snt.nodes.clear()
so = snt.nodes.new('ShaderNodeOutputMaterial'); se = snt.nodes.new('ShaderNodeEmission'); se.inputs[0].default_value = hexlin('#c9c3b4')
snt.links.new(se.outputs[0], so.inputs[0])

SPACING = 1.0; ROWH = 2.0
for ri, row in enumerate(GRID):
    for ci, (cid, clip, label) in enumerate(row):
        before_o, before_a = set(bpy.data.objects), set(bpy.data.actions)
        bpy.ops.import_scene.gltf(filepath=str(RAW / f'{cid}.glb'))
        new = [o for o in bpy.data.objects if o not in before_o]; acts = [a for a in bpy.data.actions if a not in before_a]
        arm = next(o for o in new if o.type == 'ARMATURE')
        body = next(o for o in new if o.type == 'MESH' and any(m.type == 'ARMATURE' for m in o.modifiers))
        root = arm
        while root.parent: root = root.parent
        root.location = (ci * SPACING, 0, -ri * ROWH); bpy.context.view_layer.update()
        ang = math.radians(0 if CLOSEUP else (-60 if cid == 'monkey' else -25)); P = Matrix.Translation(root.location)
        root.matrix_world = P @ Matrix.Rotation(ang, 4, 'Z') @ P.inverted() @ root.matrix_world
        ad = arm.animation_data or arm.animation_data_create()
        for tr in list(ad.nla_tracks): ad.nla_tracks.remove(tr)
        act = next((a for a in acts if a.name.split('.')[0] == clip or a.name.endswith(clip)), None)
        if act:
            ad.action = act; fr = act.frame_range; arm['frame'] = fr[0] + (fr[1] - fr[0]) * PHASE.get(clip, .5)
        if body.data.materials and body.data.materials[0].node_tree.get('done') is None:
            toonify(body.data.materials[0]); body.data.materials[0].node_tree['done'] = 1
        body.data.materials.append(outline)
        if cid == 'monkey': root.scale = root.scale * 2.0; bpy.context.view_layer.update()  # shown at 2x for legibility
        md = body.modifiers.new('hull', 'SOLIDIFY'); bpy.context.view_layer.update()
        md.thickness = -(.004 if CLOSEUP else .008) / body.matrix_world.to_scale().x; md.use_flip_normals = True
        md.use_rim = False; md.material_offset = 1; md.offset = 1
        for o in new:
            if o.type == 'MESH' and o is not body: o.hide_render = True
        if label and not CLOSEUP:
            bpy.ops.object.text_add(location=(ci * SPACING - .3, -.3, -ri * ROWH - .16))
            t = bpy.context.object; t.data.body = label; t.data.size = .11
            t.rotation_euler = (math.pi / 2, 0, 0); t.data.materials.append(outline)
        bpy.ops.mesh.primitive_circle_add(vertices=24, radius=.32, fill_type='NGON', location=(ci * SPACING, 0, -ri * ROWH + .001))
        d = bpy.context.object; d.data.materials.append(shadow)

# One scene frame for many armatures: bake each pose into its mesh at its own frame.
for o in list(bpy.data.objects):
    if o.type == 'ARMATURE' and 'frame' in o:
        sc.frame_set(int(o['frame'])); bpy.context.view_layer.update()
        body = next(c for c in o.children if c.type == 'MESH')
        bpy.context.view_layer.objects.active = body
        for x in bpy.context.view_layer.objects: x.select_set(x is body)
        mod = next(m for m in body.modifiers if m.type == 'ARMATURE'); bpy.ops.object.modifier_apply(modifier=mod.name)
        o.animation_data.action = None

sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN')); sc.collection.objects.link(sun)
sun.rotation_euler = (math.radians(50), math.radians(-25), math.radians(-30)); sun.data.energy = 4
w = bpy.data.worlds.new('w'); sc.world = w; w.use_nodes = True; w.node_tree.nodes['Background'].inputs[0].default_value = hexlin('#efe9dc')
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); sc.collection.objects.link(cam); sc.camera = cam
cols = max(len(r) for r in GRID); W = cols * SPACING + .2; Hh = len(GRID) * ROWH + .1
cam.data.type = 'ORTHO'; cam.rotation_euler = (math.radians(84), 0, 0)
cx = (cols - 1) * SPACING / 2; cz = -(len(GRID) - 1) * ROWH / 2 + .78
if CLOSEUP:
    Hh = .55; cz = 1.32
cam.data.ortho_scale = max(W, Hh)
cam.location = (cx, -20, cz + 20 * math.tan(math.radians(6)))
sc.render.engine = 'BLENDER_EEVEE_NEXT'; px = 800 if CLOSEUP else 220
sc.render.resolution_x = int(px * W); sc.render.resolution_y = int(px * Hh)
sc.view_settings.view_transform = 'Standard'; sc.render.film_transparent = False
sc.render.filepath = str(OUT); bpy.ops.render.render(write_still=True)
print('RENDERED', OUT)
