"""v4 street props for the tour route (art-direction-v4 §6, spec-v4 §5).

Run: "$(cat tools/blender-path.txt)" --background --python tools/create_props_v4.py [-- out_dir] [--preview]

Every prop is authored here from primitives (original shapes, no brands), coloured with vertex colours
(COLOR_0, one material per file), ≤ ~400 triangles, origin at the foot centre, facing -Y in Blender
(+Z in glTF). Output: public/models/props/<name>.glb (meshopt) + README.json.
"""
from pathlib import Path
import json, math, subprocess, shutil, sys
import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = Path([a for a in argv if not a.startswith('--')][0]) if [a for a in argv if not a.startswith('--')] else ROOT / 'public/models/props'
RAW = ROOT / 'artifacts/v4/U2/raw'
PREVIEW = '--preview' in argv
OUT.mkdir(parents=True, exist_ok=True); RAW.mkdir(parents=True, exist_ok=True)

C = dict(metal='#3e4a50', lamp='#5a6a74', glow='#fff4dc', wood='#b07d4f', woodDark='#8a5a3a', green='#2f6e5a', blue='#2c7f91',
         yellow='#e9b949', red='#c75f4a', cream='#f3ebdb', ink='#2a2c4a', brick='#c0604b', leaf='#5fae48', leafDark='#3f8a4c',
         concrete='#b9b5ad', tetra='#8a8c8e', white='#fbf6ea', orange='#e8875a', grey='#9aa3a8', glass='#86b7c8', sand='#e8d5ad')

def srgb_lin(h):
    h = h.lstrip('#'); c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return [x / 12.92 if x <= .04045 else ((x + .055) / 1.055) ** 2.4 for x in c]

def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)

def paint(o, col):
    me = o.data
    if not me.color_attributes: me.color_attributes.new('Col', 'BYTE_COLOR', 'CORNER')
    a = me.color_attributes[0]; r, g, b = srgb_lin(col)
    for i in range(len(a.data)): a.data[i].color = (r, g, b, 1)
    return o

def finish(o, smooth=False):
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    for p in o.data.polygons: p.use_smooth = smooth
    return o

def box(c, s, col, rot=(0, 0, 0), bevel=0.0):
    bpy.ops.mesh.primitive_cube_add(size=1, location=c, rotation=rot); o = bpy.context.object; o.scale = s
    finish(o)
    if bevel:
        m = o.modifiers.new('b', 'BEVEL'); m.width = bevel; m.segments = 1; bpy.ops.object.modifier_apply(modifier=m.name)
    return paint(o, col)

def cyl(c, r, h, col, seg=8, rot=(0, 0, 0), r2=None):
    if r2 is None: bpy.ops.mesh.primitive_cylinder_add(vertices=seg, radius=r, depth=h, location=c, rotation=rot)
    else: bpy.ops.mesh.primitive_cone_add(vertices=seg, radius1=r, radius2=r2, depth=h, location=c, rotation=rot)
    return paint(finish(bpy.context.object, True), col)

def sph(c, r, col, seg=10, rings=6, scale=(1, 1, 1)):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=seg, ring_count=rings, radius=r, location=c); o = bpy.context.object; o.scale = scale
    return paint(finish(o, True), col)

def torus(c, R, r, col, rot=(0, 0, 0), seg=12):
    bpy.ops.mesh.primitive_torus_add(major_segments=seg, minor_segments=5, major_radius=R, minor_radius=r, location=c, rotation=rot)
    return paint(finish(bpy.context.object, True), col)

def join(parts, name):
    for o in bpy.context.view_layer.objects: o.select_set(False)
    for o in parts: o.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]; bpy.ops.object.join()
    o = bpy.context.object; o.name = name; o.data.name = name
    return o

# ---------------------------------------------------------------- props (metres, Z up, front = -Y)
def lamp():
    return [cyl((0, 0, 1.9), .07, 3.8, C['lamp']), cyl((0, 0, .15), .16, .3, C['metal']), box((0, -.25, 3.8), (.1, .55, .08), C['lamp']),
            box((0, -.5, 3.72), (.36, .36, .14), C['metal'], bevel=.03), box((0, -.5, 3.62), (.3, .3, .05), C['glow'])]

def garden_lamp():
    return [cyl((0, 0, .5), .06, 1.0, C['metal']), cyl((0, 0, 1.12), .17, .26, C['glow'], seg=8), cyl((0, 0, 1.3), .21, .1, C['metal'], seg=8, r2=.05)]

def bench():
    p = []
    for k in range(3): p.append(box((0, -.12 + k * .13, .45), (1.8, .11, .05), C['wood']))
    for k in range(2): p.append(box((0, .25, .66 + k * .16), (1.8, .05, .1), C['wood'], rot=(-.18, 0, 0)))
    for x in (-.78, .78): p += [box((x, .02, .22), (.07, .5, .44), C['metal']), box((x, .26, .55), (.06, .06, .6), C['metal'])]
    return p

def bins():
    p = []
    for x, col in ((-.3, C['blue']), (.3, C['green'])):
        p += [cyl((x, 0, .45), .24, .9, col, seg=10), cyl((x, 0, .93), .26, .08, C['ink'], seg=10), box((x, -.24, .8), (.16, .02, .06), C['ink'])]
    return p

def notice_board():
    return [box((0, 0, 1.25), (1.6, .1, 1.1), C['woodDark'], bevel=.02), box((0, -.06, 1.25), (1.42, .02, .92), C['cream']),
            box((-.4, -.08, 1.4), (.4, .01, .5), C['yellow']), box((.25, -.08, 1.1), (.5, .01, .35), C['blue']), box((.45, -.08, 1.5), (.3, .01, .3), C['red']),
            box((-.72, 0, .45), (.08, .08, .9), C['woodDark']), box((.72, 0, .45), (.08, .08, .9), C['woodDark']), box((0, 0, 1.86), (1.8, .3, .06), C['woodDark'])]

def a_board():
    return [box((0, -.14, .55), (.6, .04, 1.05), C['ink'], rot=(.16, 0, 0)), box((0, .14, .55), (.6, .04, 1.05), C['ink'], rot=(-.16, 0, 0)),
            box((0, -.17, .6), (.5, .01, .7), C['cream'], rot=(.16, 0, 0)), box((0, -.18, .78), (.4, .01, .12), C['yellow'], rot=(.16, 0, 0))]

def planter():
    p = [cyl((0, 0, .25), 1.1, .5, C['brick'], seg=14), cyl((0, 0, .52), 1.0, .06, C['concrete'], seg=14)]
    for k in range(5):
        a = k / 5 * math.tau; p.append(sph((math.cos(a) * .55, math.sin(a) * .55, .75), .38, C['leaf'] if k % 2 else C['leafDark'], seg=7, rings=5))
    p.append(sph((0, 0, .9), .42, C['leaf'], seg=8, rings=5))
    for k in range(6):
        a = k / 6 * math.tau + .3; p.append(sph((math.cos(a) * .7, math.sin(a) * .7, .95), .09, C['red'] if k % 2 else C['yellow'], seg=6, rings=4))
    return p

def vending():
    return [box((0, 0, .95), (1.0, .8, 1.9), C['red'], bevel=.04), box((0, -.41, 1.25), (.8, .02, .9), C['glass']), box((0, -.41, .45), (.5, .02, .2), C['ink']),
            *[box((-.25 + (k % 3) * .25, -.43, 1.5 - (k // 3) * .3), (.12, .02, .2), [C['yellow'], C['blue'], C['white']][k % 3]) for k in range(9)], box((.38, -.41, .9), (.1, .02, .3), C['grey'])]

def booth():
    return [box((0, 0, 1.2), (2.2, 2.0, 2.4), C['cream'], bevel=.04), box((0, -1.01, 1.45), (1.7, .02, .9), C['glass']), box((-1.11, 0, 1.45), (.02, 1.4, .9), C['glass']),
            box((0, 0, 2.5), (2.6, 2.4, .2), C['blue'], bevel=.05), box((0, -1.2, 2.3), (1.3, .03, .3), C['ink']), box((0, -1.22, 2.3), (1.1, .01, .2), C['cream']),
            cyl((.8, -1.3, .25), .18, .5, C['brick']), sph((.8, -1.3, .6), .25, C['leaf'])]

def barrier():
    return [box((0, 0, .55), (.4, .4, 1.1), C['yellow'], bevel=.03), box((2.0, 0, 1.0), (3.8, .08, .1), C['white']),
            *[box((.6 + k * .7, -.001, 1.0), (.32, .085, .105), C['red']) for k in range(5)], cyl((-.6, 0, .6), .08, 1.2, C['metal']), box((-.6, -.06, 1.1), (.2, .1, .25), C['ink'])]

def bus_stop():
    return [cyl((0, 0, 1.3), .05, 2.6, C['metal']), box((0, 0, 2.45), (.55, .05, .55), C['blue'], bevel=.02), box((0, -.03, 2.45), (.45, .01, .12), C['cream']),
            box((0, -.03, 2.25), (.4, .01, .14), C['yellow'])]

def coffee_cart():
    return [box((0, 0, .8), (2.0, 1.0, 1.0), C['cream'], bevel=.06), box((0, 0, .3), (2.1, 1.05, .06), C['woodDark']),
            box((0, -.51, .85), (1.7, .02, .5), C['yellow']), box((0, 0, 2.15), (2.4, 1.4, .06), C['red']), box((0, -.7, 2.0), (2.4, .02, .26), C['white']),
            cyl((-.9, 0, 1.6), .04, 1.2, C['metal']), cyl((.9, 0, 1.6), .04, 1.2, C['metal']),
            torus((-.7, -.3, .25), .22, .05, C['ink'], rot=(0, math.pi / 2, 0)), torus((.7, -.3, .25), .22, .05, C['ink'], rot=(0, math.pi / 2, 0)),
            cyl((-.4, 0, 1.38), .08, .18, C['white']), cyl((-.2, 0, 1.38), .08, .18, C['white'])]

def stall():
    return [box((0, 0, .74), (1.8, .8, .04), C['white']), box((0, -.41, .55), (1.8, .02, .42), C['blue']), box((0, -.42, .55), (.8, .01, .14), C['yellow']),
            *[box((x, y, .36), (.05, .05, .72), C['metal']) for x in (-.85, .85) for y in (-.35, .35)],
            box((.6, .1, 1.1), (.4, .04, .6), C['cream'], rot=(-.2, 0, 0)), box((-.5, 0, .82), (.3, .2, .12), C['orange'])]

def monkey_sign():
    p = [cyl((0, 0, .75), .04, 1.5, C['metal']), box((0, 0, 1.5), (.7, .04, .7), C['yellow'], bevel=.02), box((0, -.025, 1.5), (.6, .01, .6), C['white'])]
    p += [sph((0, -.04, 1.55), .12, '#7d6b5d', scale=(1, .3, 1)), sph((0, -.05, 1.42), .14, '#7d6b5d', scale=(1, .3, .8)), box((0, -.05, 1.5), (.55, .01, .05), C['red'], rot=(0, .7, 0))]
    return p

def tetrapod():
    p = [sph((0, 0, .55), .3, C['tetra'], seg=8, rings=5)]
    for d in ((0, 0, 1), (.94, 0, -.33), (-.47, .82, -.33), (-.47, -.82, -.33)):
        v = Vector(d).normalized(), 
        v = v[0]; c = v * .45 + Vector((0, 0, .55))
        p.append(cyl(tuple(c), .28, .9, C['tetra'], seg=6, r2=.16, rot=tuple(Vector((0, 0, 1)).rotation_difference(v).to_euler())))
    return p

def railing():
    return [*[cyl((x, 0, .55), .04, 1.1, C['white']) for x in (-1.5, -.5, .5, 1.5)], cyl((0, 0, 1.08), .045, 3.1, C['white'], rot=(0, math.pi / 2, 0)),
            cyl((0, 0, .6), .03, 3.1, C['white'], rot=(0, math.pi / 2, 0))]

def lifebuoy():
    return [cyl((0, 0, .7), .05, 1.4, C['metal']), box((0, -.05, 1.15), (.8, .08, .7), C['white']), torus((0, -.12, 1.15), .26, .07, C['orange'], rot=(math.pi / 2, 0, 0))]

def umbrella_set():
    p = [cyl((0, 0, 1.2), .03, 2.4, C['white']), cyl((0, 0, 2.3), 1.3, .4, C['red'], seg=8, r2=.05)]
    for x in (-.9, .9): p += [box((x, .2, .3), (.6, 1.7, .08), C['white'], rot=(0, 0, 0)), box((x, .95, .5), (.6, .5, .08), C['white'], rot=(.7, 0, 0))]
    return p

def parasol_table():
    p = [cyl((0, 0, .72), .55, .05, C['white'], seg=12), cyl((0, 0, .36), .05, .72, C['metal']), cyl((0, 0, 1.3), .03, 2.0, C['metal']), cyl((0, 0, 2.2), 1.2, .35, C['blue'], seg=8, r2=.04)]
    for k in range(4):
        a = k / 4 * math.tau; x, y = math.cos(a) * .9, math.sin(a) * .9
        p += [box((x, y, .44), (.42, .42, .04), C['white']), box((x * 1.22, y * 1.22, .7), (.42 if abs(y) < .1 else .05, .42 if abs(x) < .1 else .05, .5), C['white'])]
    return p

def return_box():
    return [box((0, 0, .6), (.8, .7, 1.2), C['blue'], bevel=.04), box((0, -.36, .95), (.5, .02, .1), C['ink']), box((0, -.36, .6), (.6, .01, .25), C['cream']), cyl((0, 0, 1.26), .4, .12, C['blue'], seg=12, rot=(math.pi / 2, 0, 0))]

def flagpole():
    return [cyl((0, 0, 4.5), .06, 9, C['white'], r2=.04), sph((0, 0, 9.05), .1, C['yellow']), cyl((0, 0, .15), .35, .3, C['concrete'], seg=8)]

def bollard():
    return [cyl((0, 0, .45), .05, .9, C['red']), sph((0, 0, .93), .07, C['yellow']), cyl((0, 0, .04), .17, .08, C['ink'])]

def wall_lamp():
    return [box((0, 0, 0), (.25, .12, .3), C['metal'], bevel=.02), box((0, -.07, 0), (.18, .03, .2), C['glow'])]

def motorbike():
    return [torus((0, -.55, .3), .26, .06, C['ink'], rot=(0, math.pi / 2, 0)), torus((0, .55, .3), .26, .06, C['ink'], rot=(0, math.pi / 2, 0)),
            box((0, 0, .5), (.32, 1.1, .25), C['white'], bevel=.06), box((0, .2, .72), (.34, .6, .14), C['ink'], bevel=.05), box((0, -.6, .75), (.3, .12, .5), C['red'], bevel=.04),
            cyl((0, -.62, 1.05), .02, .62, C['metal'], rot=(0, math.pi / 2, 0))]

PROPS = dict(lamp=lamp, garden_lamp=garden_lamp, bench=bench, bins=bins, notice_board=notice_board, a_board=a_board, planter=planter,
             vending=vending, booth=booth, barrier=barrier, bus_stop=bus_stop, coffee_cart=coffee_cart, stall=stall, monkey_sign=monkey_sign,
             tetrapod=tetrapod, railing=railing, lifebuoy=lifebuoy, umbrella_set=umbrella_set, parasol_table=parasol_table, return_box=return_box,
             flagpole=flagpole, bollard=bollard, wall_lamp=wall_lamp, motorbike=motorbike)

def material():
    m = bpy.data.materials.new('prop'); m.use_nodes = True
    nt = m.node_tree; b = nt.nodes['Principled BSDF']; a = nt.nodes.new('ShaderNodeVertexColor'); a.layer_name = 'Col'
    nt.links.new(a.outputs['Color'], b.inputs['Base Color']); b.inputs['Roughness'].default_value = .85
    return m

def build(name):
    reset()
    o = join(PROPS[name](), name)
    o.data.materials.clear(); o.data.materials.append(material())
    tris = sum(len(p.vertices) - 2 for p in o.data.polygons)
    raw = RAW / f'{name}.glb'
    bpy.ops.export_scene.gltf(filepath=str(raw), export_format='GLB', use_selection=False, export_yup=True, export_attributes=True,
                              export_vertex_color='ACTIVE', export_materials='EXPORT', export_apply=True)
    out = OUT / f'{name}.glb'
    subprocess.run([shutil.which('npx') or 'npx', 'gltf-transform', 'meshopt', str(raw), str(out)], cwd=ROOT, check=True, capture_output=True)
    print('PROP', name, 'tris', tris, flush=True)
    return dict(name=name, tris=tris)

if __name__ == '__main__':
    meta = [build(n) for n in PROPS]
    (OUT / 'README.json').write_text(json.dumps(dict(generator='tools/create_props_v4.py', license='authored in this repo (see docs/licenses.md)', props=meta), indent=1) + '\n')
