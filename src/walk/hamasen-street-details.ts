import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { CampusStructure, Point2 } from '../walk-types';
import { type Terrain } from '../world/terrain';
import type { TunnelProfile } from '../world/tunnel-surface';
import { planHamasenStreetProps, streetPropKeepClear, type SightView, type StreetProp, type StreetPropKind } from './hamasen-street-props';
import { FOLIAGE, leafMaterial, treeGeometry, type Family } from '../render/foliage';
import { toonMaterial } from '../render/toon';

/** East lintel from the documented right-to-left inscription on the historic plaque. */
export function hamasenEastPortalDetails(profile:TunnelProfile,landmarks:T.Group){
 const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=166;
 const ink=canvas.getContext('2d')!;
 ink.fillStyle='#292c2a';ink.fillRect(0,0,canvas.width,canvas.height);
 ink.strokeStyle='#8d7654';ink.lineWidth=3;ink.strokeRect(8,8,1008,150);
 ink.fillStyle='#dfc184';ink.font='bold 112px serif';ink.textAlign='center';ink.textBaseline='middle';
 [...'道隧灣子西'].forEach((glyph,i)=>ink.fillText(glyph,192+i*160,84));
 const texture=new T.CanvasTexture(canvas);texture.colorSpace=T.SRGBColorSpace;
 const plaque=new T.Mesh(new T.PlaneGeometry(6.18,.89),new T.MeshBasicMaterial({map:texture}));
 const outward=new T.Vector3(Math.sin(profile.eastYaw),0,Math.cos(profile.eastYaw));
 plaque.name='西子灣隧道東口門額';plaque.rotation.y=profile.eastYaw;
 plaque.position.copy(profile.east).addScaledVector(outward,.205).add(new T.Vector3(0,7.74,0));
 landmarks.add(plaque);

 // The portal is shaded by the hill. Blend the lighting back to the existing
 // tunnel palette before the first bend. Geometry and collision stay shared.
 landmarks.getObjectByName('Full Sisihwan tunnel')?.traverse(object=>{
  if(!(object instanceof T.Mesh)||Array.isArray(object.material))return;
  const position=object.geometry.getAttribute('position'),color=new Float32Array(position.count*3);
  for(let i=0;i<position.count;i++){
   const depth=(profile.east.x-position.getX(i))*outward.x+(profile.east.z-position.getZ(i))*outward.z;
   const shadow=T.MathUtils.smoothstep(depth,-.25,7)*(1-T.MathUtils.smoothstep(depth,28,55));
   const light=1-.66*shadow;
   color.set([light,light,light],i*3);
  }
  object.geometry.setAttribute('color',new T.BufferAttribute(color,3));
  object.material.vertexColors=true;object.material.needsUpdate=true;
 });
 const lampDistances=[7,13,19,25];
 const lamps=new T.InstancedMesh(new T.CircleGeometry(.12,12),new T.MeshBasicMaterial({color:'#f1dfa9'}),lampDistances.length);
 const fixture=new T.Object3D();fixture.rotation.x=Math.PI/2;
 for(const [i,depth] of lampDistances.entries()){
  const section=profile.sections.reduce((a,b)=>Math.abs(b.distance-profile.length+depth)<Math.abs(a.distance-profile.length+depth)?b:a);
  fixture.position.copy(section.position);fixture.position.y+=profile.height-.045;
  fixture.updateMatrix();lamps.setMatrixAt(i,fixture.matrix);
 }
 lamps.name='Hamasen east vault lights';lamps.computeBoundingSphere();landmarks.add(lamps);
}

export function hamasenStationBoard(exit:number,width:number,height:number){
 const canvas=document.createElement('canvas');canvas.width=768;canvas.height=146;
 const context=canvas.getContext('2d')!;
 context.fillStyle='#deded4';context.fillRect(0,0,768,146);
 context.fillStyle='#49565a';context.fillRect(0,94,768,52);
 context.fillStyle='#c37735';context.beginPath();context.arc(56,61,29,0,Math.PI*2);context.fill();
 context.textAlign='center';context.textBaseline='middle';
 context.fillStyle='#fff4e4';context.font='bold 25px sans-serif';context.fillText('O1',56,62);
 context.fillStyle='#243539';context.font='bold 64px sans-serif';context.fillText('哈瑪星站',370,55);
 context.fillStyle='#f3f2ec';context.font='bold 31px sans-serif';context.fillText('Hamasen Station',370,121);
 context.fillStyle='#d8a62d';context.font='bold 109px sans-serif';context.fillText(String(exit),703,70);
 const texture=new T.CanvasTexture(canvas);texture.colorSpace=T.SRGBColorSpace;
 const material=new T.MeshBasicMaterial({map:texture});
 return new T.Mesh(new T.PlaneGeometry(width,height),material);
}

/**
 * Linhai 2nd Road has narrow concrete frontage strips and a curbside signal
 * at Shoushan Street in the ground photograph used for the district survey.
 * Sidewalk offsets use the OSM centreline and modelled road width.
 */
export function hamasenStreetDetails(context:CampusStructure['context'],terrain:Terrain){
 const group=new T.Group();group.name='Hamasen Linhai curb details';group.userData.terrainSeated=true;
 const district=context.hamasen?.polygon;
 if(!district)return group;
 // Sidewalk, bevelled curb, drainage grates and markings are unified in hamasenStreetGround
 // so they never coplanar-overlap or cut out recessed arcade floors.
 if(streetPropsEnabled())return group;
 const corner:Point2=[417.85,306.68];
 const ground=terrain.heightAt(...corner);
 const metal=new T.MeshStandardMaterial({color:'#7a898a',roughness:.82});
 const dark=new T.MeshStandardMaterial({color:'#3a494b',roughness:.81});
 const steel=(a:T.Vector3,b:T.Vector3,width:number)=>{
  const axis=b.clone().sub(a),beam=new T.Mesh(new T.CylinderGeometry(width,width,axis.length(),6),metal);
  beam.position.copy(a).lerp(b,.5);beam.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),axis.normalize());
  group.add(beam);
 };
 const at=(x:number,y:number,z:number)=>new T.Vector3(corner[0]+x,ground+y,corner[1]+z);
 steel(at(0,0,0),at(0,6.2,0),.105);
 steel(at(0,4.72,0),at(2.1,4.77,-3.42),.048);
 steel(at(0,5.8,0),at(1.34,6.21,-2.18),.035);
 const lamp=new T.Mesh(new T.BoxGeometry(.26,.105,.61),metal);
 lamp.position.copy(at(1.37,6.19,-2.25));lamp.rotation.y=-.54;group.add(lamp);
 const signal=new T.Mesh(new T.BoxGeometry(.23,.27,1.07),dark);
 signal.position.copy(at(2.08,4.65,-3.37));signal.rotation.y=-.54;group.add(signal);
 for(let i=-1;i<=1;i++){
  const lens=new T.Mesh(new T.CylinderGeometry(.075,.078,.10,9),dark);
  lens.rotation.z=Math.PI/2;lens.rotation.y=-.54;
  lens.position.copy(at(2.19+.14*i,4.65,-3.36-.22*i));group.add(lens);
 }
 return group;
}

type Tier='A'|'B'|'C';
/** Per kind: drawing radius (m) and the share of instances kept, per quality tier. */
export const PROP_TIERS:Record<Tier,Record<StreetPropKind,[number,number]>>={
 A:{scooter:[70,1],car:[85,1],pole:[90,1],lamp:[90,1],signal:[90,1],tree:[90,1],planter:[55,1],parasol:[65,1],box:[65,1]},
 B:{scooter:[60,.85],car:[80,1],pole:[85,1],lamp:[85,1],signal:[85,1],tree:[85,1],planter:[45,.8],parasol:[60,1],box:[55,1]},
 C:{scooter:[50,.7],car:[70,1],pole:[80,1],lamp:[80,1],signal:[80,1],tree:[80,1],planter:[40,.6],parasol:[55,1],box:[50,1]},
};
const PALETTES:Record<StreetPropKind,string[]>={
 scooter:['#efede6','#b8322c','#2b2d30','#2f4a78','#a9adb1','#6fa9c4','#d9b237','#8fc2a6','#c9566a','#5a6b3e'],
 car:['#eeeeea','#a7abb0','#2e3033','#7b2a26','#3c5d7e','#cbc2a8'],
 pole:['#ffffff','#ffffff'],lamp:['#ffffff'],signal:['#ffffff'],
 tree:['#ffffff','#e6f0d8','#f3f6e6','#dfe9d4'],planter:['#ffffff','#e9d8c8','#d8e4ef','#f0ead0'],
 parasol:['#c8372f','#2f5f9e','#e0b43c','#3f8a5a','#e07a32'],
 box:['#b9bcbc','#4f6b55','#b8433a','#3f6aa5','#8a6a4a','#6c7172','#8c8475','#f1efe8','#e6c34c'],
};

/** Merged, vertex-coloured kit geometry built from simple parts. Local +X is the prop's forward axis. */
function kit(parts:{geometry:T.BufferGeometry;at?:[number,number,number];rotate?:[number,number,number];scale?:[number,number,number];color:string;top?:string}[]){
 const out:T.BufferGeometry[]=[];
 const m=new T.Matrix4(),q=new T.Quaternion(),e=new T.Euler();
 for(const p of parts){
  let g=p.geometry;
  const colors=new Float32Array(g.getAttribute('position').count*3),c=new T.Color(p.color),t=new T.Color(p.top??p.color);
  const normal=g.getAttribute('normal');
  for(let i=0;i<colors.length/3;i++)(normal.getY(i)>.9&&p.top?t:c).toArray(colors,i*3);
  g.setAttribute('color',new T.BufferAttribute(colors,3));g.deleteAttribute('uv');
  e.set(...(p.rotate??[0,0,0]));q.setFromEuler(e);
  m.compose(new T.Vector3(...(p.at??[0,0,0])),q,new T.Vector3(...(p.scale??[1,1,1])));
  g.applyMatrix4(m);
  if(g.index){const flat=g.toNonIndexed();g.dispose();g=flat;}
  out.push(g);
 }
 const merged=mergeGeometries(out,false)!;out.forEach(g=>g.dispose());
 merged.computeBoundingSphere();
 return merged;
}
const boxG=(w:number,h:number,d:number)=>new T.BoxGeometry(w,h,d);
const cylG=(top:number,bottom:number,h:number,sides:number,open=false)=>new T.CylinderGeometry(top,bottom,h,sides,1,open);
function crownG(){const g=new T.IcosahedronGeometry(1,0);g.computeVertexNormals();return g;}

export function streetKits():Record<StreetPropKind,T.BufferGeometry>{
 const dark='#26282a',wheel={rotate:[Math.PI/2,0,0] as [number,number,number]};
 return {
  // ≈100 triangles, 1.8 m step-through scooter; the body colour comes from the instance colour.
  scooter:kit([
   {geometry:cylG(.22,.22,.1,6),...wheel,at:[.64,.22,0],color:dark},
   {geometry:cylG(.22,.22,.1,6),...wheel,at:[-.6,.22,0],color:dark},
   {geometry:boxG(.6,.1,.3),at:[.04,.32,0],color:'#3a3b3d'},
   {geometry:boxG(.84,.38,.36),at:[-.42,.55,0],rotate:[0,0,.08],color:'#ffffff'},
   {geometry:boxG(.66,.09,.3),at:[-.4,.79,0],color:'#24211f'},
   {geometry:boxG(.14,.72,.36),at:[.46,.66,0],rotate:[0,0,-.32],color:'#ffffff'},
   {geometry:boxG(.36,.08,.14),at:[.66,.47,0],color:'#ffffff'},
   {geometry:boxG(.1,.07,.64),at:[.56,1.04,0],color:'#2e3033'},
  ]),
  // ≈104 triangles, 4.2 m sedan.
  car:kit([
   ...[[1.35,.78],[1.35,-.78],[-1.3,.78],[-1.3,-.78]].map(([x,z])=>({geometry:cylG(.31,.31,.2,6),...wheel,at:[x,.31,z] as [number,number,number],color:dark})),
   {geometry:boxG(4.2,.62,1.72),at:[0,.66,0],color:'#ffffff'},
   {geometry:boxG(2.25,.52,1.58),at:[-.25,1.23,0],color:'#3d4a55',top:'#ffffff'},
  ]),
  // ≈36 triangles, 9 m concrete pole with its crossarm and the yellow base sleeve.
  pole:kit([
   {geometry:cylG(.12,.19,9,6,true),at:[0,4.5,0],color:'#b9b8b1'},
   {geometry:cylG(.205,.205,1.6,6,true),at:[0,.8,0],color:'#d9b53c'},
   {geometry:boxG(1.6,.12,.12),at:[0,8.3,0],color:'#6e6f6c'},
  ]),
  // ≈36 triangles, 7.4 m lamp with the arm over the carriageway.
  lamp:kit([
   {geometry:cylG(.07,.11,7.4,6,true),at:[0,3.7,0],color:'#5b6466'},
   {geometry:boxG(1.7,.08,.08),at:[.82,7.32,0],rotate:[0,0,.06],color:'#5b6466'},
   {geometry:boxG(.62,.12,.3),at:[1.66,7.34,0],color:'#5b6466'},
  ]),
  // ≈96 triangles: cantilever mast, three-lens head, green street-name plate, pedestrian head.
  signal:kit([
   {geometry:cylG(.11,.14,6.2,6,true),at:[0,3.1,0],color:'#7a898a'},
   {geometry:boxG(4.3,.13,.13),at:[2.15,5.62,0],color:'#7a898a'},
   {geometry:boxG(1.05,.32,.26),at:[3.55,5.36,0],color:'#2f3a3c'},
   {geometry:boxG(.22,.2,.32),at:[3.2,5.36,0],color:'#c8302a'},
   {geometry:boxG(.22,.2,.32),at:[3.55,5.36,0],color:'#e2a531'},
   {geometry:boxG(.22,.2,.32),at:[3.9,5.36,0],color:'#3aa15a'},
   {geometry:boxG(1.4,.36,.05),at:[1.35,5.95,0],color:'#1f7a4a'},
   {geometry:boxG(.3,.46,.3),at:[0,2.85,.24],color:'#2f3a3c'},
  ]),
  // ≈50 triangles, about 5 m tall at scale 1.
  tree:kit([
   {geometry:cylG(.12,.18,3.3,5,true),at:[0,1.65,0],color:'#6b5544'},
   {geometry:crownG(),at:[0,3.75,0],scale:[1.95,1.45,1.95],color:'#5f7f4c'},
   {geometry:crownG(),at:[.55,4.55,.3],scale:[1.3,1.05,1.3],color:'#6f8d55'},
  ]),
  // ≈40 triangles: glazed pot and shrub.
  planter:kit([
   {geometry:cylG(.3,.23,.46,6),at:[0,.23,0],color:'#9a5a3e'},
   {geometry:crownG(),at:[0,.76,0],scale:[.44,.44,.44],color:'#4f7a45'},
  ]),
  // ≈32 triangles: pole and a two-sided eight-panel canopy.
  parasol:kit([
   {geometry:cylG(.03,.03,2.3,4,true),at:[0,1.15,0],color:'#d8d8d8'},
   {geometry:new T.ConeGeometry(1.3,.48,8,1,true),at:[0,2.42,0],color:'#ffffff'},
   {geometry:new T.ConeGeometry(1.3,.48,8,1,true),at:[0,2.42,0],rotate:[Math.PI,0,0],scale:[1,-1,1],color:'#e4e4e4'},
  ]),
  box:kit([{geometry:boxG(1,1,1),at:[0,.5,0],color:'#ffffff'}]),
 };
}

interface KindBuffers {kind:StreetPropKind;mesh:T.InstancedMesh;matrices:Float32Array;colors:Float32Array;x:Float32Array;z:Float32Array;rank:Float32Array;
 /** Per-instance extra attribute compacted with the matrices (street-name plates: the atlas row). */
 extra?:{attribute:T.InstancedBufferAttribute;data:Float32Array;size:number}}
/** Street trees share the campus leaf-card families (render/foliage): almond rows with a banyan now and then.
 * Base scale brings them to about 4.5–6 m, the size of the planted street trees. */
export const STREET_TREE_FAMILIES:readonly [Family,number][]=[['almond',.7],['almond',.7],['banyan',.62],['almond',.7]];
export const STREET_TREE_DENSITY=1;
/** Street-name plate on the signal mast arm (signal kit: 1.4 × 0.36 m plate centred at x 1.35, y 5.95). */
const PLATE={x:1.35,y:5.95,width:1.36,height:.33,face:.031};
/** One shared canvas atlas, one row per street name. */
export function streetNameAtlas(names:readonly string[]){
 const width=512,row=128,canvas=document.createElement('canvas');
 canvas.width=width;canvas.height=row*Math.max(1,names.length);
 const ink=canvas.getContext('2d')!;
 names.forEach((name,i)=>{
  const y=i*row;
  ink.fillStyle='#1f7a4a';ink.fillRect(0,y,width,row);
  ink.strokeStyle='#f4f6f0';ink.lineWidth=5;ink.strokeRect(9,y+9,width-18,row-18);
  ink.fillStyle='#f7f8f2';ink.textAlign='center';ink.textBaseline='middle';
  let size=76;ink.font=`bold ${size}px sans-serif`;
  const fit=width-64,measured=ink.measureText(name).width;
  if(measured>fit){size=Math.floor(size*fit/measured);ink.font=`bold ${size}px sans-serif`;}
  ink.fillText(name,width/2,y+row/2+3);
 });
 const texture=new T.CanvasTexture(canvas);texture.colorSpace=T.SRGBColorSpace;texture.anisotropy=4;
 return texture;
}
function plateGeometry(){
 const front=new T.PlaneGeometry(PLATE.width,PLATE.height);front.translate(PLATE.x,PLATE.y,PLATE.face);
 const back=new T.PlaneGeometry(PLATE.width,PLATE.height);back.rotateY(Math.PI);back.translate(PLATE.x,PLATE.y,-PLATE.face);
 const merged=mergeGeometries([front,back],false)!;front.dispose();back.dispose();merged.computeBoundingSphere();return merged;
}
/** Lamp lens: a downward face under the lamp head, unlit grey by day and warm at night. */
function lampLensGeometry(){const g=new T.PlaneGeometry(.56,.24);g.rotateX(Math.PI/2);g.translate(1.66,7.275,0);return g;}
/** Soft radial-gradient light pool texture so streetlamps cast a smooth warm wash instead of a hard disc. */
let cachedPoolTex:T.CanvasTexture|undefined;
function lampPoolTexture(){
 if(cachedPoolTex)return cachedPoolTex;
 if(typeof document==='undefined')return undefined;
 const c=document.createElement('canvas');c.width=c.height=128;
 const ctx=c.getContext('2d');if(!ctx)return undefined;
 const g=ctx.createRadialGradient(64,64,4,64,64,62);
 g.addColorStop(0,'rgba(255,232,175,1)');
 g.addColorStop(.38,'rgba(255,212,136,.52)');
 g.addColorStop(.74,'rgba(255,190,104,.16)');
 g.addColorStop(1,'rgba(255,180,90,0)');
 ctx.fillStyle=g;ctx.fillRect(0,0,128,128);
 cachedPoolTex=new T.CanvasTexture(c);cachedPoolTex.colorSpace=T.SRGBColorSpace;
 return cachedPoolTex;
}
/** Light pool on the road under the lamp head (additive radial glow, shown only at night). */
function lampPoolGeometry(){const g=new T.PlaneGeometry(8.8,8.8);g.rotateX(-Math.PI/2);g.translate(1.66,.06,0);return g;}
const LAMP_ON=new T.Color('#ffe5a8');
/** 0 by day, 1 at night: read from the sky's leaf tint (day white, night #8090c0), so no new hook is needed. */
const nightness=()=>T.MathUtils.clamp((1-FOLIAGE.uLeafTint.value.r)*2.1,0,1);
interface NightLightRig {
 lens:T.MeshBasicMaterial;pool:T.InstancedMesh;poolMaterial:T.MeshBasicMaterial;level:number;
 /** Pooled roving warm PointLights snapped to the nearest lamps/plazas around the camera at night. */
 lights:T.PointLight[];
 anchors:[number,number,number][];
}
/**
 * Root of the street furniture. The renderer calls `update(camera)` on LOD objects
 * before projecting their children, so this compacts the instances near the camera
 * into each InstancedMesh once the camera has moved a few metres. Nothing is
 * allocated per frame; one draw call per kind regardless of how many are in range.
 */
class StreetPropRoot extends T.LOD {
 private lastX=Infinity;private lastZ=Infinity;private lastTier:Tier|undefined;
 private lastLightX=Infinity;private lastLightZ=Infinity;private lastLightLevel=-1;
 /** Overhead wires: one line batch, shown only while some pole is in range. */
 wires?:T.LineSegments;
 /** Lamp lenses, road light pools, and pooled warm PointLights follow the sky. */
 night?:NightLightRig;
 constructor(private kinds:Map<string,KindBuffers>,private tier:()=>Tier){super();this.autoUpdate=true;}
 override update(camera:T.Camera){
  if(!(camera as T.PerspectiveCamera).isPerspectiveCamera)return;
  const e=camera.matrixWorld.elements,x=e[12],z=e[14],tier=this.tier();
  if(this.night){
   const level=Math.round(nightness()*20)/20,n=this.night;
   if(level!==n.level){n.level=level;n.lens.color.set('#70777a').lerp(LAMP_ON,level);n.poolMaterial.opacity=.44*level;}
   n.pool.visible=level>.05;
   const moved=(x-this.lastLightX)**2+(z-this.lastLightZ)**2>9;
   if(level!==this.lastLightLevel||moved){
    this.lastLightX=x;this.lastLightZ=z;this.lastLightLevel=level;
    const budget=level>.05&&x>210?(tier==='C'?2:n.lights.length):0;
    const picked:{d2:number;p:[number,number,number]}[]=[];
    if(budget>0){
     for(const p of n.anchors){
      const d2=(p[0]-x)**2+(p[2]-z)**2;
      if(d2>46*46)continue;
      if(picked.length<budget){picked.push({d2,p});picked.sort((a,b)=>a.d2-b.d2);}
      else if(d2<picked[budget-1].d2){picked[budget-1]={d2,p};picked.sort((a,b)=>a.d2-b.d2);}
     }
    }
    const power=(tier==='C'?16:22)*level;
    for(let i=0;i<n.lights.length;i++){
     const L=n.lights[i],slot=picked[i];
     if(slot){L.position.set(slot.p[0],slot.p[1],slot.p[2]);L.intensity=power;L.visible=true;}
     else {L.intensity=0;L.visible=false;}
    }
   }
  }
  if(tier===this.lastTier&&(x-this.lastX)**2+(z-this.lastZ)**2<9)return;
  this.lastX=x;this.lastZ=z;this.lastTier=tier;
  this.refresh(x,z,tier);
 }
 refresh(x:number,z:number,tier:Tier){
  for(const k of this.kinds.values()){
   const [radius,share]=PROP_TIERS[tier][k.kind],r2=radius*radius;
   const matrix=k.mesh.instanceMatrix.array as Float32Array,color=k.mesh.instanceColor!.array as Float32Array;
   let n=0;
   for(let i=0;i<k.x.length;i++){
    if(k.rank[i]>=share)continue;
    const dx=k.x[i]-x,dz=k.z[i]-z;
    if(dx*dx+dz*dz>r2)continue;
    matrix.set(k.matrices.subarray(i*16,i*16+16),n*16);
    color[n*3]=k.colors[i*3];color[n*3+1]=k.colors[i*3+1];color[n*3+2]=k.colors[i*3+2];
    if(k.extra){const e=k.extra,out=e.attribute.array as Float32Array;for(let j=0;j<e.size;j++)out[n*e.size+j]=e.data[i*e.size+j];}
    n++;
   }
   k.mesh.count=n;
   if(k.extra){k.extra.attribute.clearUpdateRanges();k.extra.attribute.addUpdateRange(0,Math.max(1,n)*k.extra.size);k.extra.attribute.needsUpdate=true;}
   k.mesh.instanceMatrix.clearUpdateRanges();k.mesh.instanceMatrix.addUpdateRange(0,Math.max(1,n)*16);k.mesh.instanceMatrix.needsUpdate=true;
   k.mesh.instanceColor!.clearUpdateRanges();k.mesh.instanceColor!.addUpdateRange(0,Math.max(1,n)*3);k.mesh.instanceColor!.needsUpdate=true;
   k.mesh.computeBoundingSphere();
  }
  if(this.wires)this.wires.visible=(this.kinds.get('pole')?.mesh.count??0)>0;
 }
 /** Active instances and triangles per kind, for QA. */
 activeStats(){
  const out:Record<string,{instances:number;triangles:number}>={};
  for(const [key,k] of this.kinds){const g=k.mesh.geometry,tris=(g.index?g.index.count:g.getAttribute('position').count)/3;out[key]={instances:k.mesh.count,triangles:k.mesh.count*tris};}
  return out;
 }
}

export interface StreetPropOptions {
 npcData?:Parameters<typeof streetPropKeepClear>[0];
 stops?:Parameters<typeof streetPropKeepClear>[1];
 tier:()=>Tier;
 portal?:TunnelProfile;
 isLandmark?:(id:string)=>boolean;
 /** Distance to the outdoor walking graph, so nothing stands on a walking route (shop and landmark approaches included). */
 pathDistance?:(x:number,z:number)=>number;
 /** Card subjects and landings (campus-info 哈瑪星 POIs): their sightlines stay free of tall props. */
 views?:SightView[];
}
/** QA switch: `?streetProps=0` leaves the district as it was before the furniture pass. */
export const streetPropsEnabled=()=>typeof location==='undefined'||new URLSearchParams(location.search).get('streetProps')!=='0';

/** Non-colliding street furniture for 哈瑪星, planned from the current district data. */
export function hamasenStreetProps(context:CampusStructure['context'],terrain:Terrain,options:StreetPropOptions){
 const started=performance.now();
 const {keep,paths}=streetPropKeepClear(options.npcData,options.stops);
 const profile=options.portal;
 const plan=planHamasenStreetProps({context,keep,paths,isLandmark:options.isLandmark,pathDistance:options.pathDistance,views:options.views,
  solid:(x,z)=>terrain.heightAt(x,z)>terrain.seaLevel+.04,
  portal:profile?{x:profile.east.x,z:profile.east.z,dirX:Math.sin(profile.eastYaw),dirZ:Math.cos(profile.eastYaw)}:undefined});
 const kits=streetKits();
 const material=new T.MeshStandardMaterial({name:'Hamasen street furniture',vertexColors:true,roughness:.84});
 const groups=new Map<StreetPropKind,StreetProp[]>();
 for(const p of plan.props){let list=groups.get(p.kind);if(!list){list=[];groups.set(p.kind,list);}list.push(p);}
 const kinds=new Map<string,KindBuffers>();
 const m=new T.Matrix4(),q=new T.Quaternion(),pos=new T.Vector3(),scale=new T.Vector3(),up=new T.Vector3(0,1,0),c=new T.Color();
 const instanced=(key:string,kind:StreetPropKind,geometry:T.BufferGeometry,mat:T.Material,list:StreetProp[],base=1)=>{
  const mesh=new T.InstancedMesh(geometry,mat,list.length);
  mesh.name=`Hamasen street ${key}`;mesh.count=0;mesh.castShadow=false;mesh.receiveShadow=true;
  mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
  mesh.instanceColor=new T.InstancedBufferAttribute(new Float32Array(list.length*3),3);mesh.instanceColor.setUsage(T.DynamicDrawUsage);
  const buffers:KindBuffers={kind,mesh,matrices:new Float32Array(list.length*16),colors:new Float32Array(list.length*3),
   x:new Float32Array(list.length),z:new Float32Array(list.length),rank:new Float32Array(list.length)};
  const palette=PALETTES[kind];
  list.forEach((p,i)=>{
   pos.set(p.x,terrain.heightAt(p.x,p.z)+(p.lift??0)-.01,p.z);
   q.setFromAxisAngle(up,p.yaw);scale.set((p.sx??1)*base,(p.sy??1)*base,(p.sz??1)*base);
   m.compose(pos,q,scale).toArray(buffers.matrices,i*16);
   c.set(palette[p.color%palette.length]).toArray(buffers.colors,i*3);
   buffers.x[i]=p.x;buffers.z[i]=p.z;buffers.rank[i]=p.rank;
  });
  kinds.set(key,buffers);
  return buffers;
 };
 for(const [kind,list] of groups){
  if(kind==='tree'){
   // Leaf-card crowns as on campus: one instanced mesh per family.
   const families=new Map<Family,{scale:number;list:StreetProp[]}>();
   for(const t of list){const [f,s]=STREET_TREE_FAMILIES[t.color%STREET_TREE_FAMILIES.length];let g=families.get(f);if(!g){g={scale:s,list:[]};families.set(f,g);}g.list.push(t);}
   for(const [f,g] of families)instanced(`tree ${f}`,'tree',treeGeometry(f,STREET_TREE_DENSITY),leafMaterial(f),g.list,g.scale);
   continue;
  }
  instanced(kind,kind,kits[kind],material,list);
 }
 // Street-name plates: a shared canvas atlas; each plate picks its row through one instanced float.
 const named=(groups.get('signal')??[]).filter(p=>p.label);
 if(named.length){
  const names=[...new Set(named.map(p=>p.label!))].sort();
  const atlas=streetNameAtlas(names),rows=names.length;
  // Toon from the start (toonify() would swap a standard material and drop the row patch).
  const plateMaterial=toonMaterial({name:'Hamasen street-name plates',map:atlas},false);
  const toonPatch=plateMaterial.onBeforeCompile;
  plateMaterial.onBeforeCompile=(shader,renderer)=>{
   toonPatch.call(plateMaterial,shader,renderer);
   shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nattribute float plateRow;')
    .replace('#include <uv_vertex>',`#include <uv_vertex>\nvMapUv.y=(plateRow+vMapUv.y)/${rows.toFixed(1)};`);
  };
  plateMaterial.customProgramCacheKey=()=>`hamasen-plates-${rows}`;
  const plates=instanced('name plate','signal',plateGeometry(),plateMaterial,named);
  const data=new Float32Array(named.length);
  // Canvas row i (from the top) spans v from 1-(i+1)/rows to 1-i/rows with the default flipY.
  named.forEach((p,i)=>{data[i]=rows-1-names.indexOf(p.label!);});
  const attribute=new T.InstancedBufferAttribute(new Float32Array(named.length),1);attribute.setUsage(T.DynamicDrawUsage);
  plates.mesh.geometry.setAttribute('plateRow',attribute);
  plates.extra={attribute,data,size:1};
  plates.mesh.userData.names=names;
 }
 // Night: lamp lenses glow, soft radial light pools wash the road, and 2-4 pooled PointLights illuminate nearby streets.
 const lamps=groups.get('lamp');
 let night:StreetPropRoot['night'];
 const anchors:[number,number,number][]=[];
 for(const p of lamps??[]){
  const lx=p.x+Math.cos(p.yaw)*1.66,lz=p.z-Math.sin(p.yaw)*1.66;
  anchors.push([lx,terrain.heightAt(lx,lz)+6.4,lz]);
 }
 // Add fixed plaza & canal waterfront lighting anchors (Daitian Temple forecourt & Gushan 1st Canal promenade).
 for(const [ax,az,h] of [
  [474,448,5.6],[492,442,5.6],[466,464,5.6],[484,462,5.6],[502,456,5.6],
  [355,732,5.2],[352,704,5.2],[351,668,5.2],[350,624,5.2],[350,580,5.2],
  [349,536,5.2],[347,492,5.2],[344,448,5.2],[341,404,5.2],[338,360,5.2],[336,326,5.2],
  [316,242,5.4],[328,256,5.4],
 ] as const){
  anchors.push([ax,terrain.heightAt(ax,az)+h,az]);
 }
 const lights:T.PointLight[]=Array.from({length:4},(_,i)=>{
  const L=new T.PointLight('#ffd08a',0,28,1.45);
  L.name=`Hamasen night pool light ${i}`;L.visible=false;
  return L;
 });
 if(lamps?.length){
  const lens=new T.MeshBasicMaterial({name:'Hamasen lamp lens',color:'#70777a',side:T.DoubleSide});
  const poolTex=lampPoolTexture();
  const poolMaterial=new T.MeshBasicMaterial({name:'Hamasen lamp light pool',color:'#ffd894',map:poolTex,transparent:true,opacity:0,depthWrite:false,blending:T.AdditiveBlending,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2});
  instanced('lamp lens','lamp',lampLensGeometry(),lens,lamps);
  const pool=instanced('lamp pool','lamp',lampPoolGeometry(),poolMaterial,lamps);
  pool.mesh.receiveShadow=false;pool.mesh.renderOrder=1;pool.mesh.visible=false;
  // Pools tint by their own colour, not the street-furniture palette.
  pool.colors.fill(1);
  night={lens,pool:pool.mesh,poolMaterial,level:-1,lights,anchors};
 }
 for(const [kind,g] of Object.entries(kits))if(!groups.has(kind as StreetPropKind)||kind==='tree')g.dispose();
 const root=new StreetPropRoot(kinds,options.tier);root.night=night;
 for(const L of lights)root.add(L);
 root.name='Hamasen street furniture';root.userData.visualOnly=true;root.userData.terrainSeated=true;
 for(const k of kinds.values())root.add(k.mesh);
 // Overhead wires: three power conductors from the crossarm and a sagging telecom cable below.
 if(plan.wires.length){
  const points:number[]=[];
  const strands:[number,number,number][]=[[-.7,8.3,.32],[0,8.3,.28],[.7,8.3,.32],[.12,6.5,.55],[.2,6.3,.62],[-.1,5.9,.7]];
  for(const w of plan.wires){
   const [ax,az]=w.a,[bx,bz]=w.b,len=Math.hypot(bx-ax,bz-az)||1,px=-(bz-az)/len,pz=(bx-ax)/len;
   const ya=terrain.heightAt(ax,az),yb=terrain.heightAt(bx,bz);
   for(const [across,height,sag] of strands){
    for(let s=0;s<6;s++){
     for(const t of [s/6,(s+1)/6]){
      points.push(ax+(bx-ax)*t+px*across,ya+(yb-ya)*t+height-sag*4*t*(1-t),az+(bz-az)*t+pz*across);
     }
    }
   }
  }
  const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute(points,3));
  const lines=new T.LineSegments(geometry,new T.LineBasicMaterial({color:'#2a2d2f'}));
  lines.name='Hamasen overhead wires';lines.visible=false;root.wires=lines;root.add(lines);
 }
 root.userData.plan=plan.stats;
 root.userData.planMs=performance.now()-started;
 root.userData.activeStats=()=>root.activeStats();
 return root;
}
