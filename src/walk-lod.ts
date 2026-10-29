/** Display-only campus LOD. Source meshes, door transforms and collision stay intact. */
import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { WalkWorld, WorldFloor } from './walk-world';
import type { CampusStructure, StairCore, Point2 } from './walk-types';
const rectOf=(c:StairCore):Point2[]=>{const ux=Math.cos(c.angle),uz=Math.sin(c.angle),vx=-uz,vz=ux,hl=c.length/2,hw=c.width/2,[cx,cz]=c.center;return [[cx-ux*hl-vx*hw,cz-uz*hl-vz*hw],[cx+ux*hl-vx*hw,cz+uz*hl-vz*hw],[cx+ux*hl+vx*hw,cz+uz*hl+vz*hw],[cx-ux*hl+vx*hw,cz-uz*hl+vz*hw]];};
import { PALETTE, FACULTY, BUILDING_FACULTY, surfaceOf, facadeTextures, patternTexture, boxUV, nightGlow, splitRoof, FACADE_TILE, type Surface } from './walk-materials';

interface LodOptions {
 overview: boolean;
 buildingId: string;
 floorId: string | 'all';
}
interface FloorView {
 floor: WorldFloor;
 shell: T.Group;
 detail?: boolean;
 originalVisible: boolean;
 revealMeshes: T.Object3D[];
}
interface MovedArt { object:T.Object3D; parent:T.Object3D; index:number; }
interface StairClipView {
 buildingId:string;
 plane:T.Plane;
 materials:T.Material[];
 bindings:{mesh:T.Mesh;original:T.Material|T.Material[]}[];
 clipped:boolean;
}
const cutawaySurfaces=new Set<Surface>(['cutawayCeiling','roof']);
function hasSurface(object:T.Object3D,surfaces:Set<Surface>):boolean {
 if(!(object instanceof T.Mesh))return false;
 const s=surfaceOf(object.material);return !!s&&surfaces.has(s);
}

export class CampusLod {
 private readonly views:FloorView[]=[];
 private readonly inverseFrames=new Map<string,T.Matrix4>();
 private readonly originalHidden=new Map<T.Object3D,boolean>();
 private readonly movedArt:MovedArt[]=[];
 private readonly groundMeshes:T.Object3D[]=[];
 private readonly stairClips:StairClipView[]=[];
 private readonly geometries=new Set<T.BufferGeometry>();
 private readonly instances=new Set<T.InstancedMesh>();
 private readonly materials=new Map<string,T.MeshStandardMaterial>();
 private readonly textures=new Set<T.Texture>();
 private readonly boxGeometry=new T.BoxGeometry(1,1,1);
 private readonly localFoot=new T.Vector3();
 private disposed=false;

 private readonly cores=new Map<string,StairCore[]>();
 /** One pre-merged exterior per building, shown while every storey of it is in shell mode (v4 draw budget). */
 private readonly merged=new Map<string,{group:T.Group;views:FloorView[]}>();
 constructor(private readonly world:WalkWorld,structure?:CampusStructure) {
  for(const [id,list] of Object.entries(structure?.stairCores??{}))this.cores.set(id,list);
  this.geometries.add(this.boxGeometry);
  for(const [id,frame] of world.frames)this.inverseFrames.set(id,frame.clone().invert());
  world.display.traverse(object=>{if(hasSurface(object,new Set<Surface>(['ground'])))this.groundMeshes.push(object);});
  // Shared stairs live outside individual floor groups. Give only those display
  // meshes private materials, so a cutaway never clips unrelated shared walls.
  const stairGroups:T.Object3D[]=[];
  world.display.traverse(object=>{
   if(object.userData.stairGroup||object.name.startsWith('Lift '))stairGroups.push(object);
  });
  for(const group of stairGroups){
   let parent:T.Object3D|null=group.parent;
   while(parent&&!world.frames.has(parent.name))parent=parent.parent;
   if(!parent)continue;
   const clones=new Map<T.Material,T.Material>();
   const view:StairClipView={buildingId:parent.name,plane:new T.Plane(new T.Vector3(0,-1,0),0),materials:[],bindings:[],clipped:false};
   const clone=(material:T.Material)=>{
    let own=clones.get(material);
    if(!own){own=material.clone();clones.set(material,own);view.materials.push(own);}
    return own;
   };
   group.traverse(object=>{
    if(!(object instanceof T.Mesh))return;
    view.bindings.push({mesh:object,original:object.material});
    object.material=Array.isArray(object.material)?object.material.map(clone):clone(object.material);
   });
   this.stairClips.push(view);
  }
  for(const floor of world.floors){
   const parent=floor.group.parent;
   if(!parent)throw new Error(`CampusLod requires an attached floor group: ${floor.data.id}`);
   const revealMeshes:T.Object3D[]=[];
   floor.group.traverse(object=>{if(hasSurface(object,cutawaySurfaces))revealMeshes.push(object);});
   // Ground-level landscaping survives distant-floor detail culling. Both art
   // and floor groups use building-local coordinates; add preserves local pose.
   if(floor.data.level===1){
    for(const child of [...floor.group.children]){
     if(!child.name.startsWith('Original campus detailing '))continue;
     this.movedArt.push({object:child,parent:floor.group,index:floor.group.children.indexOf(child)});
     parent.add(child);
    }
   }
   const shell=this.makeShell(floor);
   parent.add(shell);
   this.views.push({floor,shell,originalVisible:floor.group.visible,revealMeshes});
  }
  this.mergeBuildings();
 }

 /** Bake each building's storey shells (side walls by material, roof caps, faculty cornices) into a few meshes
  * in building-local space. Far away a whole building is then 3–4 draw calls instead of 2–3 per storey. */
 private mergeBuildings():void {
  const byBuilding=new Map<string,FloorView[]>();
  for(const v of this.views){if(!byBuilding.has(v.floor.buildingId))byBuilding.set(v.floor.buildingId,[]);byBuilding.get(v.floor.buildingId)!.push(v);}
  const slice=(g:T.BufferGeometry,start:number,count:number)=>{const out=new T.BufferGeometry();for(const [k,a] of Object.entries(g.attributes)){const it=a.itemSize;out.setAttribute(k,new T.BufferAttribute((a.array as Float32Array).slice(start*it,(start+count)*it),it));}return out;};
  for(const [id,views] of byBuilding){
   const parent=views[0].shell.parent;if(!parent)continue;
   const parts=new Map<T.Material,T.BufferGeometry[]>(),bands:T.Matrix4[]=[];let bandMaterial:T.Material|undefined;
   for(const v of views){
    v.shell.updateMatrix();
    for(const child of v.shell.children){
     if(child instanceof T.InstancedMesh){bandMaterial=child.material as T.Material;const m=new T.Matrix4();for(let i=0;i<child.count;i++){child.getMatrixAt(i,m);bands.push(v.shell.matrix.clone().multiply(m));}continue;}
     if(!(child instanceof T.Mesh))continue;
     const g0=child.geometry.index?child.geometry.toNonIndexed():child.geometry.clone();g0.applyMatrix4(v.shell.matrix);
     const mats=Array.isArray(child.material)?child.material:[child.material];
     const groups=g0.groups.length?g0.groups:[{start:0,count:g0.attributes.position.count,materialIndex:0}];
     for(const gr of groups){const m=mats[gr.materialIndex??0];if(!parts.has(m))parts.set(m,[]);parts.get(m)!.push(slice(g0,gr.start,gr.count));}
     g0.dispose();
    }
   }
   const group=new T.Group();group.name=`Campus LOD ${id} (merged)`;group.userData.visualOnly=true;group.visible=false;
   for(const [m,list] of parts){const g=mergeGeometries(list,false);for(const x of list)x.dispose();if(!g)continue;g.computeBoundingSphere();this.geometries.add(g);const mesh=new T.Mesh(g,m);mesh.name='依源outline簡化量體（整棟合併）';mesh.castShadow=true;mesh.receiveShadow=true;group.add(mesh);}
   if(bands.length&&bandMaterial){const mesh=new T.InstancedMesh(this.boxGeometry,bandMaterial,bands.length);bands.forEach((m,i)=>mesh.setMatrixAt(i,m));mesh.name='學院色簷口（整棟合併）';mesh.computeBoundingSphere();this.instances.add(mesh);group.add(mesh);}
   parent.add(group);this.merged.set(id,{group,views});
  }
 }

 private material(color:string,glass=false):T.MeshStandardMaterial {
  const key=`${color}/${glass}`;
  let material=this.materials.get(key);
  if(!material){material=new T.MeshStandardMaterial({color,roughness:glass?.38:.9,metalness:glass?.08:0});this.materials.set(key,material);}
  return material;
 }

 private facade?:{brick:T.MeshStandardMaterial;roof:T.MeshStandardMaterial;arcade:T.MeshStandardMaterial};
 private shellMaterials(){
  if(!this.facade){const f=facadeTextures('brick'),r=patternTexture('roof');const brick=nightGlow(new T.MeshStandardMaterial({map:f.map,roughness:.88}),f.emissive),roof=new T.MeshStandardMaterial({map:r,roughness:.9});
   const a=facadeTextures('arcade');const arcade=nightGlow(new T.MeshStandardMaterial({map:a.map,roughness:.88}),a.emissive);for(const t of [f.map,f.emissive,r,a.map,a.emissive])this.textures.add(t);this.materials.set('facade',brick);this.materials.set('roofdeck',roof);this.materials.set('arcade',arcade);this.facade={brick,roof,arcade};}
  return this.facade;
 }
 private makeShell(floor:WorldFloor):T.Group {
  const group=new T.Group();
  group.name=`Campus LOD ${floor.data.id} · 源圖輪廓外觀示意`;
  group.userData.visualOnly=true;group.userData.campusLod=true;
  group.position.y=floor.y;group.visible=false;
  const points=floor.data.outline;
  const shape=new T.Shape(points.map(([x,z])=>new T.Vector2(x,-z)));
  for(const hole of floor.data.holes??[])shape.holes.push(new T.Path(hole.map(([x,z])=>new T.Vector2(x,-z))));
  for(const core of this.cores.get(floor.buildingId)??[])if(core.levels.some(l=>l.floorId===floor.data.id))shape.holes.push(new T.Path(rectOf(core).map(([x,z])=>new T.Vector2(x,-z))));
  let geometry:T.BufferGeometry=new T.ExtrudeGeometry(shape,{depth:3.7,bevelEnabled:false,steps:1,curveSegments:1});
  geometry.rotateX(-Math.PI/2);
  // Facade UVs in world metres so storey bands and windows line up across scaled, joined buildings.
  const frame=this.world.frames.get(floor.buildingId)??new T.Matrix4();
  boxUV(geometry,frame.clone().multiply(new T.Matrix4().makeTranslation(0,floor.y,0)),FACADE_TILE.w,FACADE_TILE.h,.08);
  const split=splitRoof(geometry);geometry.dispose();geometry=split;
  // Only the top storey keeps its caps; intermediate caps would seal stairwells seen from inside.
  const top=Math.max(...this.world.floors.filter(f=>f.buildingId===floor.buildingId).map(f=>f.y));
  if(floor.y<top-.01){const side=geometry.groups[0];geometry.groups.length=0;geometry.addGroup(side.start,side.count,0);}
  geometry.computeBoundingSphere();this.geometries.add(geometry);
  const {brick,roof,arcade}=this.shellMaterials();
  const body=new T.Mesh(geometry,[floor.data.level===1?arcade:brick,roof]);
  body.name='依源outline簡化量體 · 紅磚立面示意';body.castShadow=true;body.receiveShadow=true;group.add(body);
  const fac=FACULTY[BUILDING_FACULTY[floor.buildingId]??'science'];
  const bands:T.Matrix4[]=[];const piece=new T.Object3D();
  const matrix=(x:number,y:number,z:number,w:number,h:number,d:number,rotation:number)=>{piece.position.set(x,y,z);piece.rotation.set(0,rotation,0);piece.scale.set(w,h,d);piece.updateMatrix();return piece.matrix.clone();};
  for(let i=0;i<points.length;i++){
   const a=points[i],b=points[(i+1)%points.length],dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz);
   if(length<.6)continue;
   bands.push(matrix((a[0]+b[0])/2,3.36,(a[1]+b[1])/2,length,.2,.12,-Math.atan2(dz,dx)));
  }
  if(bands.length){const mesh=new T.InstancedMesh(this.boxGeometry,this.material(fac.band),bands.length);mesh.name='學院色簷口 · 外觀示意';this.instances.add(mesh);bands.forEach((m,i)=>mesh.setMatrixAt(i,m));mesh.computeBoundingSphere();group.add(mesh);}
  return group;
 }

 private restoreTemporaryVisibility():void {
  for(const [object,visible] of this.originalHidden)object.visible=visible;
  this.originalHidden.clear();
 }
 private hideTemporarily(object:T.Object3D):void {
  if(!this.originalHidden.has(object))this.originalHidden.set(object,object.visible);
  object.visible=false;
 }

 update(foot:T.Vector3,options:LodOptions):void {
  if(this.disposed)return;
  this.restoreTemporaryVisibility();
  const selected=options.overview&&options.floorId!=='all'
   ?this.views.find(view=>view.floor.buildingId===options.buildingId&&view.floor.data.id===options.floorId)
   :undefined;
  for(const stair of this.stairClips){
   const clipped=!!selected&&stair.buildingId===options.buildingId;
   if(selected&&clipped)stair.plane.constant=selected.floor.y+3.4;
   for(const material of stair.materials){
    material.clippingPlanes=clipped?[stair.plane]:null;
    material.clipShadows=clipped;
    if(clipped!==stair.clipped)material.needsUpdate=true;
   }
   stair.clipped=clipped;
  }
  if(selected?.floor.data.level===-1)for(const mesh of this.groundMeshes)this.hideTemporarily(mesh);
  for(const view of this.views){
   const {floor,shell}=view;
   let detail=false,shellVisible=true;
   if(options.overview){
    if(selected&&floor.buildingId===options.buildingId){
     detail=view===selected;shellVisible=!detail&&floor.y<=selected.floor.y+.01;
    }
   }else{
    const inverse=this.inverseFrames.get(floor.buildingId);
    this.localFoot.copy(foot);if(inverse)this.localFoot.applyMatrix4(inverse);
    const [minX,minZ,maxX,maxZ]=floor.data.bounds;
    const dx=Math.max(minX-this.localFoot.x,0,this.localFoot.x-maxX),dz=Math.max(minZ-this.localFoot.z,0,this.localFoot.z-maxZ);
    // Hysteresis: enter detail at 18 m / 5.2 m, leave only beyond 22 m / 7 m, so nothing pops back and forth.
    const reach=Math.hypot(dx,dz)*(this.world.scales.get(floor.buildingId)??1),rise=Math.abs(this.localFoot.y-floor.y);
    detail=view.detail?reach<22&&rise<7:reach<18&&rise<5.2;view.detail=detail;
    shellVisible=!detail;
   }
   floor.group.visible=view.originalVisible&&detail;
   shell.visible=view.originalVisible&&shellVisible;
   if(selected&&detail)for(const mesh of view.revealMeshes)this.hideTemporarily(mesh);
  }
  // A building entirely in shell mode draws its merged exterior instead of one shell per storey.
  for(const {group,views} of this.merged.values()){
   const all=views.every(v=>v.shell.visible||!v.originalVisible)&&views.some(v=>v.shell.visible);
   group.visible=all;
   if(all)for(const v of views)v.shell.visible=false;
  }
 }

 dispose():void {
  if(this.disposed)return;
  this.disposed=true;this.restoreTemporaryVisibility();
  // Original material references (including any original planes/clipShadows)
  // were never mutated, and are restored before our private copies are freed.
  for(const stair of this.stairClips){
   for(const binding of stair.bindings)binding.mesh.material=binding.original;
   for(const material of stair.materials)material.dispose();
  }
  this.stairClips.length=0;
  for(const view of this.views){view.floor.group.visible=view.originalVisible;view.shell.removeFromParent();}
  for(const saved of this.movedArt){
   saved.parent.add(saved.object);
   const children=saved.parent.children,index=children.indexOf(saved.object);
   children.splice(index,1);children.splice(Math.min(saved.index,children.length),0,saved.object);
  }
  for(const mesh of this.instances)mesh.dispose();
  this.instances.clear();
  for(const geometry of this.geometries)geometry.dispose();
  for(const material of this.materials.values())material.dispose();
  for(const texture of this.textures)texture.dispose();
  this.views.length=0;this.movedArt.length=0;this.groundMeshes.length=0;this.inverseFrames.clear();this.geometries.clear();this.materials.clear();
 }
}
