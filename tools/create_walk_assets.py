"""Original CC0 campus assets. Run with Blender 4.5 LTS --background --python.
Author: local procedural generation for NSYSU campus guide, no external assets.
Blender coordinates: metres, Z up, +Y forward. glTF: Y up, -Z forward.
"""
from pathlib import Path
import math
import json
import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'public/models/walk'
OUT.mkdir(parents=True, exist_ok=True)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
for action in list(bpy.data.actions):
    bpy.data.actions.remove(action)
bpy.context.scene.render.fps = 24
bpy.context.scene.unit_settings.system = 'METRIC'
bpy.context.scene.unit_settings.scale_length = 1
bpy.context.scene.frame_start = 1
bpy.context.scene.frame_end = 49


def material(name, color, roughness=.75, metallic=0):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (*color, 1)
    bsdf.inputs['Roughness'].default_value = roughness
    bsdf.inputs['Metallic'].default_value = metallic
    return mat

M = {
    'shirt':material('Sea blue cotton',(.13,.37,.40)),
    'pants':material('Warm graphite trousers',(.15,.19,.18)),
    'skin':material('Warm skin',(.71,.47,.31)),
    'hair':material('Deep brown hair',(.065,.043,.031)),
    'shoe':material('Ivory canvas',(.81,.79,.69)),
    'sole':material('Natural rubber',(.34,.32,.26)),
    'bag':material('Mountain green backpack',(.20,.29,.20)),
    'strap':material('Backpack straps',(.12,.18,.13)),
    'gold':material('Muted brass details',(.65,.49,.23),.38,.45),
    'wood':material('Oiled timber',(.43,.28,.15)),
    'woodlight':material('Timber edges',(.54,.38,.22)),
    'metal':material('Deep green coated steel',(.10,.18,.15),.5,.3),
    'cream':material('Warm ivory laminate',(.78,.77,.66)),
    'glass':material('Frosted lamp diffuser',(.88,.85,.65),.4),
}


def empty(name, loc=(0,0,0), parent=None):
    obj = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(obj)
    obj.location = loc
    obj.parent = parent
    return obj


def cube(name, loc, size, mat, parent=None, bevel=.015):
    bpy.ops.mesh.primitive_cube_add(size=1)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel:
        mod = obj.modifiers.new('Soft manufactured edge','BEVEL')
        mod.width = bevel
        mod.segments = 1
        bpy.ops.object.modifier_apply(modifier=mod.name)
        mod = obj.modifiers.new('Weighted normals', 'WEIGHTED_NORMAL')
        bpy.ops.object.modifier_apply(modifier=mod.name)
    obj.data.materials.append(mat)
    obj.parent = parent
    obj.location = loc
    return obj


def sphere(name, loc, scale, mat, parent=None, segments=12, rings=6):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=rings)
    obj=bpy.context.object
    obj.name=name
    obj.scale=scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(mat)
    obj.parent=parent
    obj.location=loc
    return obj


def cylinder(name, loc, radius, depth, mat, parent=None, vertices=10):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth)
    obj=bpy.context.object
    obj.name=name
    obj.data.materials.append(mat)
    obj.parent=parent
    obj.location=loc
    return obj


def beam(name,a,b,radius,mat,parent):
    midpoint=(Vector(a)+Vector(b))/2
    direction=Vector(b)-Vector(a)
    obj=cylinder(name,midpoint,radius,direction.length,mat,parent)
    obj.rotation_euler=direction.to_track_quat('Z','Y').to_euler()
    return obj


def descendants(root):
    return [root]+list(root.children_recursive)


def export(root,filename):
    bpy.ops.object.select_all(action='DESELECT')
    for obj in descendants(root): obj.select_set(True)
    bpy.context.view_layer.objects.active=root
    bpy.context.scene.frame_set(1)
    available=bpy.ops.export_scene.gltf.get_rna_type().properties.keys()
    kwargs=dict(filepath=str(OUT/filename),export_format='GLB',use_selection=True,
        export_yup=True,export_animations=True,export_materials='EXPORT',
        export_apply=False,export_cameras=False,export_lights=False)
    if 'export_animation_mode' in available:
        kwargs['export_animation_mode']='NLA_TRACKS'
    if 'export_force_sampling' in available:
        kwargs['export_force_sampling']=True
    bpy.ops.export_scene.gltf(**kwargs)
    print('EXPORTED',filename,(OUT/filename).stat().st_size,flush=True)


def add_clip(obj, clip, prop, values):
    # Matching NLA track names combine independent object channels into one glTF clip.
    for frame,value in values:
        setattr(obj,prop,value)
        obj.keyframe_insert(data_path=prop,frame=frame)
    action=obj.animation_data.action
    action.name=f'{clip}.{obj.name}'
    obj.animation_data.action=None
    track=obj.animation_data.nla_tracks.new()
    track.name=clip
    strip=track.strips.new(clip,1,action)
    strip.blend_type='REPLACE'
    strip.extrapolation='NOTHING'
    # Default scene rests at first frame; exporter reads each NLA track separately.
    setattr(obj,prop,values[0][1])


student=empty('Student')
student['asset_license']='CC0-1.0; original procedural geometry'
student['forward']='Blender +Y; glTF -Z'
student['height_m']=1.70
body=empty('body',(0,0,.90),student)
cube('shirt.torso',(0,0,.20),(.39,.23,.43),M['shirt'],body,.05)
cube('shirt.hem',(0,0,.005),(.37,.22,.045),M['shirt'],body,.012)
cylinder('neck',(0,0,.47),.061,.11,M['skin'],body)
sphere('face',(0,.014,.615),(.144,.128,.16),M['skin'],body)
sphere('hair.crown',(0,-.006,.71),(.154,.133,.09),M['hair'],body)
cube('hair.fringe',(0,.111,.677),(.244,.055,.07),M['hair'],body,.022)
for x,side in [(-1,'L'),(1,'R')]:
    sphere(f'ear.{side}',(x*.143,.01,.605),(.024,.033,.043),M['skin'],body,8,4)
    sphere(f'eye.{side}',(x*.052,.134,.62),(.011,.008,.015),M['hair'],body,8,4)
    arm=empty(f'upper_arm.{side}',(x*.236,0,.365),body)
    sleeve=cube(f'sleeve.{side}',(0,0,-.06),(.137,.197,.19),M['shirt'],arm,.025)
    sleeve.rotation_euler[1]=-x*.09
    forearm=empty(f'forearm.{side}',(x*.014,0,-.146),arm)
    cube(f'arm.skin.{side}',(0,.006,-.10),(.091,.092,.23),M['skin'],forearm,.025)
    sphere(f'hand.{side}',(0,.012,-.23),(.051,.047,.064),M['skin'],forearm,10,5)
    leg=empty(f'leg.{side}',(x*.106,0,-.005),body)
    cube(f'trouser.{side}',(0,-.005,-.375),(.175,.19,.76),M['pants'],leg,.025)
    cube(f'shoe.sole.{side}',(0,.055,-.869),(.18,.285,.052),M['sole'],leg,.018)
    cube(f'shoe.upper.{side}',(0,.065,-.818),(.176,.274,.09),M['shoe'],leg,.025)
    cube(f'backpack.strap.{side}',(x*.134,.127,.245),(.041,.023,.325),M['strap'],body,.012)
    add_clip(arm,'Walk','rotation_euler',[(1,(.36*x,0,0)),(13,(-.36*x,0,0)),(25,(.36*x,0,0))])
    add_clip(leg,'Walk','rotation_euler',[(1,(-.30*x,0,0)),(13,(.30*x,0,0)),(25,(-.30*x,0,0))])
    add_clip(arm,'Idle','rotation_euler',[(1,(0,0,.025*x)),(25,(.025,0,.045*x)),(49,(0,0,.025*x))])
    add_clip(leg,'Idle','rotation_euler',[(1,(0,0,0)),(49,(0,0,0))])
sphere('nose',(0,.139,.588),(.022,.019,.022),M['skin'],body,8,4)
cube('backpack',(0,-.184,.23),(.285,.16,.34),M['bag'],body,.045)
cube('backpack.front_pocket',(0,-.273,.17),(.214,.042,.14),M['bag'],body,.018)
cube('backpack.pull',(0,-.299,.235),(.018,.012,.036),M['gold'],body,.003)
cube('backpack.handle',(0,-.184,.42),(.10,.035,.04),M['strap'],body,.01)
add_clip(body,'Walk','location',[(1,(0,0,.90)),(7,(0,0,.918)),(13,(0,0,.90)),(19,(0,0,.918)),(25,(0,0,.90))])
add_clip(body,'Idle','location',[(1,(0,0,.90)),(25,(0,0,.907)),(49,(0,0,.90))])
export(student,'student.glb')
student.location.x=-3

bench=empty('CampusBench')
for i in range(5):
    cube(f'seat.slat.{i}',(0,(i-2)*.093,.465),(1.7,.083,.055),M['woodlight'] if i%2 else M['wood'],bench,.008)
for i in range(3):
    cube(f'back.slat.{i}',(0,-.215,.65+i*.095),(1.7,.052,.078),M['wood'],bench,.008)
for x in [-.64,.64]:
    beam('frame.leg',(x,-.16,.03),(x,-.16,.49),.026,M['metal'],bench)
    beam('frame.leg',(x,.16,.03),(x,.16,.49),.026,M['metal'],bench)
    beam('frame.seat',(x,-.23,.425),(x,.23,.425),.025,M['metal'],bench)
    beam('frame.back',(x,-.235,.44),(x,-.235,.91),.024,M['metal'],bench)
export(bench,'bench.glb')

lamp=empty('CampusLamp')
cylinder('foot',(0,0,.045),.17,.09,M['metal'],lamp,12)
cylinder('pole',(0,0,1.6),.045,3.12,M['metal'],lamp,12)
cylinder('brass.collar',(0,0,2.97),.059,.07,M['gold'],lamp,12)
beam('arm',(0,0,3.13),(0,.42,3.13),.035,M['metal'],lamp)
cube('shade',(0,.46,3.14),(.32,.43,.07),M['metal'],lamp,.025)
cube('diffuser',(0,.46,3.095),(.245,.35,.025),M['glass'],lamp,.008)
export(lamp,'lamp.glb')
lamp.location.x=3

furniture=empty('ClassroomDeskChair')
cube('desk.top',(0,0,.735),(.70,.47,.035),M['cream'],furniture,.014)
cube('desk.edge',(0,0,.706),(.67,.44,.022),M['woodlight'],furniture,.006)
for x in [-.285,.285]:
    for y in [-.17,.17]:
        beam('desk.leg',(x,y,.025),(x,y,.70),.018,M['metal'],furniture)
    beam('desk.sidebrace',(x,-.17,.27),(x,.17,.27),.012,M['metal'],furniture)
beam('desk.frontbrace',(-.285,-.17,.50),(.285,-.17,.50),.012,M['metal'],furniture)
cube('chair.seat',(0,-.64,.447),(.39,.39,.035),M['wood'],furniture,.018)
for x in [-.15,.15]:
    for y in [-.78,-.50]:
        beam('chair.leg',(x,y,.025),(x,y,.43),.017,M['metal'],furniture)
    beam('chair.backpost',(x,-.79,.43),(x,-.81,.83),.017,M['metal'],furniture)
cube('chair.back',(0,-.81,.735),(.375,.035,.185),M['wood'],furniture,.02)
export(furniture,'desk-chair.glb')
furniture.location.x=6

# Editable native source lays assets out side by side; GLBs individually use origin (0,0,0).
bpy.context.scene.frame_set(1)
# Presentation scene provides a reproducible visual check of all four original assets.
bpy.ops.object.camera_add(location=(8,10,6))
camera=bpy.context.object
camera.name='Asset overview camera'
camera.rotation_euler=(Vector((1.2,0,1.2))-camera.location).to_track_quat('-Z','Y').to_euler()
camera.data.type='ORTHO'
camera.data.ortho_scale=11.5
bpy.context.scene.camera=camera
for loc,power,size in [((0,4,8),1300,7),((5,-3,5),700,5)]:
    bpy.ops.object.light_add(type='AREA',location=loc)
    light=bpy.context.object
    light.data.energy=power
    light.data.shape='DISK'
    light.data.size=size
    light.rotation_euler=(Vector((1,0,1))-light.location).to_track_quat('-Z','Y').to_euler()
bpy.context.scene.world.color=(.23,.27,.26)
bpy.context.scene.render.engine='CYCLES'
bpy.context.scene.cycles.samples=24
bpy.context.scene.render.resolution_x=1100
bpy.context.scene.render.resolution_y=640
bpy.context.scene.render.resolution_percentage=100
bpy.context.scene.render.image_settings.file_format='PNG'
bpy.context.scene.render.film_transparent=False
bpy.context.scene.render.filepath=str(OUT/'asset-overview.png')
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'walk-assets.blend'))
bpy.ops.render.render(write_still=True)
(OUT/'README.json').write_text(json.dumps({
    'license':'CC0-1.0','source':'tools/create_walk_assets.py',
    'generator':'Blender 4.5.14 LTS, local CPU, original procedural meshes',
    'units':'metres','gltf_up':'+Y','gltf_forward':'-Z',
    'student_height':1.70,'animation_clips':['Idle','Walk'],
    'animation_fps':24,'note':'Student uses object hierarchy, not a skinned skeleton. Foot level Y=0 at rest. Bench seat 0.465m; lamp top 3.175m; desk top 0.7525m.',
    'files':{p.name:p.stat().st_size for p in sorted(OUT.glob('*.glb'))}
},indent=2)+'\n')
print('ALL_ASSETS_COMPLETE',flush=True)
