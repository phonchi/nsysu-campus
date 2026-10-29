"""Original CC0 characters and props for the campus walk (art-direction.md §5–6).
Run: <blender> --background --python tools/create_campus_assets.py
Blender: metres, Z up, +Y forward. glTF export: Y up, -Z forward. Rigid hierarchy animation (no skin).
"""
from pathlib import Path
import json, math
import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT/'public/models/campus'; OUT.mkdir(parents=True, exist_ok=True)
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
for a in list(bpy.data.actions): bpy.data.actions.remove(a)
scene = bpy.context.scene; scene.render.fps = 24; scene.frame_start = 1; scene.frame_end = 49

def hexrgb(h):
    h = h.lstrip('#'); c = [int(h[i:i+2], 16)/255 for i in (0, 2, 4)]
    return tuple(x/12.92 if x <= .04045 else ((x+.055)/1.055)**2.4 for x in c)  # sRGB -> linear

MATS = {}
def mat(hexcol, rough=.8, metal=0.):
    key = (hexcol, rough, metal)
    if key in MATS: return MATS[key]
    m = bpy.data.materials.new(f'mat {hexcol}'); m.use_nodes = True; c = hexrgb(hexcol)
    b = m.node_tree.nodes['Principled BSDF']; b.inputs['Base Color'].default_value = (*c, 1); b.inputs['Roughness'].default_value = rough; b.inputs['Metallic'].default_value = metal
    m.diffuse_color = (*c, 1); MATS[key] = m; return m

def empty(name, loc=(0, 0, 0), parent=None):
    o = bpy.data.objects.new(name, None); bpy.context.collection.objects.link(o); o.parent = parent; o.location = loc; return o

def finish(o, name, m, parent, loc, bevel=0.):
    o.name = name; bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel:
        mod = o.modifiers.new('bevel', 'BEVEL'); mod.width = bevel; mod.segments = 1; bpy.ops.object.modifier_apply(modifier=mod.name)
    o.data.materials.append(m); o.parent = parent; o.location = loc
    for p in o.data.polygons: p.use_smooth = False
    return o

def cube(name, loc, size, m, parent, bevel=.02):
    bpy.ops.mesh.primitive_cube_add(size=1); o = bpy.context.object; o.scale = size; return finish(o, name, m, parent, loc, bevel)

def ball(name, loc, scale, m, parent, seg=10, rings=6):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=seg, ring_count=rings); o = bpy.context.object; o.scale = scale; return finish(o, name, m, parent, loc)

def cyl(name, loc, r, depth, m, parent, verts=8, r2=None, rot=None):
    if r2 is None: bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=r, depth=depth)
    else: bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r, radius2=r2, depth=depth)
    o = bpy.context.object
    if rot: o.rotation_euler = rot
    return finish(o, name, m, parent, loc)

def clip(obj, name, prop, keys):
    for f, v in keys: setattr(obj, prop, v); obj.keyframe_insert(data_path=prop, frame=f)
    act = obj.animation_data.action; act.name = f'{name}.{obj.name}'; obj.animation_data.action = None
    tr = obj.animation_data.nla_tracks.new(); tr.name = name; st = tr.strips.new(name, 1, act); st.blend_type = 'REPLACE'; st.extrapolation = 'NOTHING'
    setattr(obj, prop, keys[0][1])

def export(root, filename):
    bpy.ops.object.select_all(action='DESELECT')
    for o in [root]+list(root.children_recursive): o.select_set(True)
    bpy.context.view_layer.objects.active = root; scene.frame_set(1)
    kw = dict(filepath=str(OUT/filename), export_format='GLB', use_selection=True, export_yup=True, export_animations=True, export_materials='EXPORT', export_apply=False, export_cameras=False, export_lights=False)
    av = bpy.ops.export_scene.gltf.get_rna_type().properties.keys()
    if 'export_animation_mode' in av: kw['export_animation_mode'] = 'NLA_TRACKS'
    if 'export_force_sampling' in av: kw['export_force_sampling'] = True
    bpy.ops.export_scene.gltf(**kw); print('EXPORTED', filename, (OUT/filename).stat().st_size, flush=True)

SKIN = '#e8b98f'; INK = '#2b2622'
def character(name, spec):
    root = empty(name); root['license'] = 'CC0-1.0 original'; root['height_m'] = 1.46
    hips = empty('hips', (0, 0, .56), root)
    upper = empty('upper', (0, 0, 0), hips)
    cube('torso', (0, 0, .2), (.38, .24, .4), mat(spec['top']), upper, .05)
    head = empty('head', (0, 0, .64), upper)
    ball('face', (0, 0, 0), (.27, .25, .26), mat(SKIN), head, 14, 8)
    for x in (-1, 1):
        ball(f'eye.{x}', (x*.085, .232, .03), (.032, .02, .042), mat(INK), head, 8, 4)
        ball(f'ear.{x}', (x*.265, 0, 0), (.04, .05, .06), mat(SKIN), head, 6, 4)
    cube('mouth', (0, .245, -.075), (.07, .02, .018), mat('#a8443a'), head, 0)
    for i, (loc, sc) in enumerate(spec['hair']): ball(f'hair.{i}', loc, sc, mat(spec['hairColor']), head, 10, 6)
    arms, legs = {}, {}
    for x in (-1, 1):
        sh = empty(f'shoulder.{x}', (x*.245, 0, .36), upper); arms[x] = sh
        cube(f'sleeve.{x}', (0, 0, -.1), (.12, .13, .22), mat(spec.get('sleeve', spec['top'])), sh, .03)
        cube(f'forearm.{x}', (0, 0, -.25), (.1, .11, .14), mat(SKIN if spec.get('shortSleeve') else spec.get('sleeve', spec['top'])), sh, .03)
        ball(f'hand.{x}', (0, .01, -.35), (.065, .06, .07), mat(SKIN), sh, 8, 5)
        hip = empty(f'hip.{x}', (x*.1, 0, 0), hips); legs[x] = hip
        cube(f'thigh.{x}', (0, 0, -.13), (.15, .16, .24), mat(spec['bottom']), hip, .03)
        cube(f'shin.{x}', (0, 0, -.36), (.13, .14, .22), mat(SKIN if spec.get('bareShins') else spec['bottom']), hip, .03)
        cube(f'shoe.{x}', (0, .05, -.51), (.17, .29, .1), mat(spec['shoe']), hip, .03)
    if spec.get('skirt'): cyl('skirt', (0, 0, -.05), .25, .28, mat(spec['bottom']), upper, 10, .2)
    if spec.get('coat'):
        cube('coat.back', (0, -.03, .02), (.42, .22, .58), mat(spec['coat']), upper, .03)
        cube('coat.l', (-.13, .11, .02), (.15, .04, .58), mat(spec['coat']), upper, .02); cube('coat.r', (.13, .11, .02), (.15, .04, .58), mat(spec['coat']), upper, .02)
    if spec.get('backpack'): cube('backpack', (0, -.2, .2), (.32, .18, .38), mat(spec['backpack']), upper, .05)
    if spec.get('glasses'):
        for x in (-1, 1): cube(f'lens.{x}', (x*.085, .245, .03), (.09, .015, .07), mat('#1d1d1f'), head, .008)
        cube('bridge', (0, .25, .035), (.06, .01, .012), mat('#1d1d1f'), head, 0)
    if spec.get('laptop'): cube('laptop', (0, .06, -.3), (.04, .26, .2), mat('#c9ccd1', .4, .5), arms[-1], .01)
    # Clips (24 fps): Idle 2 s, Walk ~0.9 s, Run ~0.6 s, Jump 0.75 s.
    for x in (-1, 1):
        clip(arms[x], 'Idle', 'rotation_euler', [(1, (0, 0, .04*x)), (25, (.04, 0, .07*x)), (49, (0, 0, .04*x))])
        clip(legs[x], 'Idle', 'rotation_euler', [(1, (0, 0, 0)), (49, (0, 0, 0))])
        clip(arms[x], 'Walk', 'rotation_euler', [(1, (.5*x, 0, .05*x)), (12, (-.5*x, 0, .05*x)), (23, (.5*x, 0, .05*x))])
        clip(legs[x], 'Walk', 'rotation_euler', [(1, (-.5*x, 0, 0)), (12, (.5*x, 0, 0)), (23, (-.5*x, 0, 0))])
        clip(arms[x], 'Run', 'rotation_euler', [(1, (1.0*x, 0, .1*x)), (8, (-1.0*x, 0, .1*x)), (15, (1.0*x, 0, .1*x))])
        clip(legs[x], 'Run', 'rotation_euler', [(1, (-.95*x, 0, 0)), (8, (.95*x, 0, 0)), (15, (-.95*x, 0, 0))])
        clip(arms[x], 'Jump', 'rotation_euler', [(1, (.3, 0, .1*x)), (5, (.5, 0, .2*x)), (9, (-2.6, 0, .35*x)), (15, (-1.2, 0, .2*x)), (18, (0, 0, .05*x))])
        clip(legs[x], 'Jump', 'rotation_euler', [(1, (-.4, 0, 0)), (5, (-.7, 0, 0)), (9, (.25*x, 0, 0)), (15, (-.3, 0, 0)), (18, (0, 0, 0))])
    clip(hips, 'Idle', 'location', [(1, (0, 0, .56)), (25, (0, 0, .565)), (49, (0, 0, .56))])
    clip(hips, 'Walk', 'location', [(1, (0, 0, .56)), (6, (0, 0, .585)), (12, (0, 0, .56)), (17, (0, 0, .585)), (23, (0, 0, .56))])
    clip(hips, 'Run', 'location', [(1, (0, 0, .55)), (4, (0, 0, .6)), (8, (0, 0, .55)), (11, (0, 0, .6)), (15, (0, 0, .55))])
    clip(hips, 'Jump', 'location', [(1, (0, 0, .56)), (5, (0, 0, .47)), (9, (0, 0, .6)), (15, (0, 0, .56)), (18, (0, 0, .56))])
    clip(upper, 'Idle', 'rotation_euler', [(1, (0, 0, 0)), (49, (0, 0, 0))])
    clip(upper, 'Walk', 'rotation_euler', [(1, (-.04, 0, .05)), (12, (-.04, 0, -.05)), (23, (-.04, 0, .05))])
    clip(upper, 'Run', 'rotation_euler', [(1, (-.21, 0, .08)), (8, (-.21, 0, -.08)), (15, (-.21, 0, .08))])
    clip(upper, 'Jump', 'rotation_euler', [(1, (-.15, 0, 0)), (5, (-.3, 0, 0)), (9, (.05, 0, 0)), (18, (0, 0, 0))])
    return root

SPECS = {
 'ahai': dict(label='阿海', top='#2a8c99', bottom='#efe4cf', bareShins=True, shoe='#f27a2c', hairColor='#4a3021', shortSleeve=False,
              hair=[((0, -.02, .14), (.27, .26, .16)), ((-.12, .08, .19), (.1, .1, .1)), ((.1, .1, .2), (.11, .09, .1)), ((0, .14, .16), (.15, .08, .07))]),
 'lan': dict(label='小嵐', top='#d9a521', bottom='#173e49', skirt=True, bareShins=True, shoe='#ffffff', hairColor='#1b1918', laptop=True,
             hair=[((0, -.03, .1), (.29, .28, .2)), ((-.21, .02, -.06), (.09, .14, .17)), ((.21, .02, -.06), (.09, .14, .17)), ((.16, .13, .16), (.045, .03, .045))]),
 'tuo': dict(label='阿拓', top='#7b4a8f', bottom='#8a8f96', shoe='#3a3f45', hairColor='#26201c', coat='#f6f4ee', sleeve='#f6f4ee', glasses=True, backpack='#3f8f4c',
             hair=[((0, -.02, .15), (.27, .25, .13)), ((0, .12, .17), (.2, .07, .06))]),
}
# Red hair clip for 小嵐 is the last hair entry: recolour it.
chars = {}
for i, (key, spec) in enumerate(SPECS.items()):
    root = character(f'Character {key}', spec); chars[key] = root
    parts = list(root.children_recursive)
    if key == 'lan':
        clipobj = next((o for o in parts if o.name == 'hair.3'), None)
        if clipobj: clipobj.data.materials.clear(); clipobj.data.materials.append(mat('#e04b3a'))
    export(root, f'char-{key}.glb'); root.location.x = i*1.2-1.2
    for o in parts: o.name = f'{key}.{o.name}'  # free the generic names for the next character

# --- Props ---------------------------------------------------------------------------
def monkey():
    r = empty('Macaque'); fur = mat('#8a6a4a'); face = mat('#e8b0a0')
    ball('body', (0, 0, .3), (.2, .17, .25), fur, r, 8, 6); ball('head', (0, .1, .62), (.14, .13, .13), fur, r, 8, 6)
    ball('face', (0, .2, .6), (.085, .05, .08), face, r, 8, 5)
    for x in (-1, 1):
        ball(f'ear{x}', (x*.13, .08, .65), (.035, .02, .04), face, r, 6, 4); cube(f'arm{x}', (x*.17, .08, .3), (.07, .07, .26), fur, r, .02)
        cube(f'leg{x}', (x*.11, .14, .1), (.09, .2, .08), fur, r, .02)
    cyl('tail', (0, -.2, .12), .03, .3, fur, r, 6, rot=(1.2, 0, 0)); return r

def sailboat():
    r = empty('Sailboat'); white = mat('#ffffff', .5); red = mat('#e04b3a')
    cube('hull', (0, 0, .35), (1.6, 5.2, .7), white, r, .15); cube('bow', (0, 2.9, .45), (.9, .9, .5), white, r, .2)
    cyl('mast', (0, .3, 3.6), .07, 6.2, mat('#3e4a50'), r, 6)
    import bmesh
    for name, pts, m in [('main', [(0, .45, 1.0), (0, .45, 6.4), (0, -2.1, 1.1)], white), ('jib', [(0, .6, 1.0), (0, .6, 5.6), (0, 2.6, .9)], red)]:
        me = bpy.data.meshes.new(name); bm = bmesh.new(); vs = [bm.verts.new(p) for p in pts]; bm.faces.new(vs); bm.to_mesh(me); bm.free()
        o = bpy.data.objects.new(name, me); bpy.context.collection.objects.link(o); o.data.materials.append(m); o.parent = r
    return r

def bicycle(col):
    r = empty('Bicycle'); frame = mat(col, .45, .2); tyre = mat('#1d1d1f')
    for y in (-.52, .52):
        bpy.ops.mesh.primitive_torus_add(major_radius=.33, minor_radius=.035, major_segments=14, minor_segments=4, rotation=(0, math.pi/2, 0)); finish(bpy.context.object, f'wheel{y}', tyre, r, (0, y, .35))
    for a, b in [((0, -.52, .35), (0, 0, .62)), ((0, 0, .62), (0, .5, .62)), ((0, .5, .62), (0, .52, .35)), ((0, 0, .62), (0, -.08, .35)), ((0, -.08, .35), (0, -.52, .35))]:
        d = Vector(b)-Vector(a); o = cyl('tube', (Vector(a)+Vector(b))/2, .025, d.length, frame, r, 6); o.rotation_euler = d.to_track_quat('Z', 'Y').to_euler()
    cube('seat', (0, -.02, .82), (.12, .24, .05), mat('#2b2622'), r, .02); cube('bar', (0, .5, .9), (.5, .04, .04), mat('#3e4a50'), r, 0)
    cyl('post', (0, .5, .76), .02, .28, mat('#3e4a50'), r, 6); return r

def cone():
    r = empty('TrafficCone'); cyl('cone', (0, 0, .36), .18, .7, mat('#f27a2c', .6), r, 10, .03); cyl('ring', (0, 0, .42), .12, .1, mat('#ffffff'), r, 10, .1)
    cube('base', (0, 0, .025), (.42, .42, .05), mat('#f27a2c'), r, .01); return r

props = [(monkey(), 'monkey.glb'), (sailboat(), 'sailboat.glb'), (bicycle('#2f5fa8'), 'bicycle.glb'), (cone(), 'cone.glb')]
for i, (o, f) in enumerate(props):
    export(o, f); o.location = (4+i*3, 0, 0)

# Overview render for review (Cycles CPU, small).
bpy.ops.object.camera_add(location=(10, 13, 5)); cam = bpy.context.object; cam.rotation_euler = (Vector((5.5, 0, 1.2)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
cam.data.type = 'ORTHO'; cam.data.ortho_scale = 17; scene.camera = cam
for loc, power in [((2, -6, 8), 1500), ((-5, 4, 6), 600)]:
    bpy.ops.object.light_add(type='AREA', location=loc); l = bpy.context.object; l.data.energy = power; l.data.size = 6; l.rotation_euler = (Vector((2, 0, 0)) - l.location).to_track_quat('-Z', 'Y').to_euler()
scene.world.color = (.75, .85, .9); scene.render.engine = 'CYCLES'; scene.cycles.samples = 24; scene.render.resolution_x = 1400; scene.render.resolution_y = 520
scene.render.filepath = str(OUT/'assets-overview.png'); bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'campus-assets.blend')); bpy.ops.render.render(write_still=True)
(OUT/'README.json').write_text(json.dumps({'license': 'CC0-1.0', 'source': 'tools/create_campus_assets.py', 'generator': 'Blender 4.5 LTS, original procedural meshes',
    'characters': {k: v['label'] for k, v in SPECS.items()}, 'clips': ['Idle', 'Walk', 'Run', 'Jump'], 'fps': 24, 'height_m': 1.46,
    'files': {p.name: p.stat().st_size for p in sorted(OUT.glob('*.glb'))}}, ensure_ascii=False, indent=2)+'\n')
print('CAMPUS_ASSETS_COMPLETE', flush=True)
