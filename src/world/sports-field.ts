import {validFacility} from '../walk/v12-data';
import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type {SportsData,WaterBodySpec,FitnessData,SportFacility} from './v12-types';
import type {Point2} from '../walk-types';
const mat=(color:string)=>new T.MeshStandardMaterial({color,roughness:.8});
function slab(poly:Point2[],y:number,color:string,holes:Point2[][]=[]){const shape=new T.Shape(poly.map(([x,z])=>new T.Vector2(x,-z)));for(const hole of holes)shape.holes.push(new T.Path(hole.map(([x,z])=>new T.Vector2(x,-z))));const m=new T.Mesh(new T.ShapeGeometry(shape),mat(color));m.rotation.x=-Math.PI/2;m.position.y=y;m.material.side=T.DoubleSide;m.receiveShadow=true;return m;}
function box(g:T.Group,c:T.Group,w:number,h:number,d:number,x:number,y:number,z:number,color:string,solid=true){const m=new T.Mesh(new T.BoxGeometry(w,h,d),mat(color));m.position.set(x,y,z);g.add(m);if(solid)c.add(m.clone());return m;}
function line(g:T.Group,points:Point2[],y:number,color='#eee9d8'){const geometry=new T.BufferGeometry().setFromPoints(points.map(([x,z])=>new T.Vector3(x,y,z)));const m=new T.Line(geometry,new T.LineBasicMaterial({color}));g.add(m);return m;}
function bounds(poly:Point2[]){return new T.Box2().setFromPoints(poly.map(p=>new T.Vector2(...p)));}

type Fitting = T.Mesh<T.BufferGeometry,T.MeshStandardMaterial>;

function mergeFittings(meshes: Fitting[], vertexColors: boolean) {
 const parts = meshes.map(mesh => {
  mesh.updateMatrix();
  const geometry = mesh.geometry.clone().applyMatrix4(mesh.matrix);
  if (vertexColors) {
   const { r, g, b } = mesh.material.color;
   const colors = new Float32Array(geometry.getAttribute('position').count * 3);
   for (let i = 0; i < colors.length; i += 3) colors.set([r, g, b], i);
   geometry.setAttribute('color', new T.BufferAttribute(colors, 3));
  }
  return geometry;
 });
 const merged = mergeGeometries(parts);
 for (const part of parts) part.dispose();
 return merged;
}

function batchMarkings(display: T.Group, markings: T.Line<T.BufferGeometry,T.LineBasicMaterial>[]) {
 const positionsByColor = new Map<number, number[]>();
 for (const line of markings) {
  const color = line.material.color.getHex();
  if (!positionsByColor.has(color)) positionsByColor.set(color, []);
  const positions = positionsByColor.get(color)!;
  const source = line.geometry.getAttribute('position');
  for (let i = 1; i < source.count; i++) {
   positions.push(source.getX(i-1),source.getY(i-1),source.getZ(i-1),source.getX(i),source.getY(i),source.getZ(i));
  }
  line.geometry.dispose();
  line.material.dispose();
 }
 display.remove(...markings);
 for (const [color, positions] of positionsByColor) {
  const geometry = new T.BufferGeometry().setAttribute('position', new T.Float32BufferAttribute(positions,3));
  const batch = new T.LineSegments(geometry,new T.LineBasicMaterial({color}));
  batch.name = 'Sports markings';
  display.add(batch);
 }
}

function addFence(display:T.Group,collision:T.Group,polygon:Point2[],y:number) {
 polygon.forEach((a,i)=>{
  const b=polygon[(i+1)%polygon.length],len=Math.hypot(b[0]-a[0],b[1]-a[1]);
  const panels:Fitting[]=[];
  for(let d=0;d<len;d+=3){
   if(i===0&&Math.abs(d-len/2)<2)continue;
   const x=a[0]+(b[0]-a[0])*d/len,z=a[1]+(b[1]-a[1])*d/len;
   box(display,collision,.08,2.5,.08,x,y+1.25,z,'#7c8e85');
   const next=Math.min(len,d+3),m=box(display,collision,next-d,1.8,.025,a[0]+(b[0]-a[0])*(d+next)/2/len,y+1.1,a[1]+(b[1]-a[1])*(d+next)/2/len,'#809b92');
   m.rotation.y=-Math.atan2(b[1]-a[1],b[0]-a[0]);
   collision.children.at(-1)!.rotation.copy(m.rotation);
   m.material.transparent=true;
   m.material.opacity=.23;
   panels.push(m);
  }
  if(panels.length<2)return;
  // Keep transparent sides as separate render items for depth sorting.
  const geometry=mergeFittings(panels,false);
  if(!geometry)return;
  const batch=new T.Mesh(geometry,panels[0].material);
  batch.name='Sports fence panels';
  display.remove(...panels);
  display.add(batch);
 });
}

/** All surfaces/colliders use the same world coordinates; pools are carved before terrain builds. */
export function buildSportsField(data:SportsData|undefined,waters:WaterBodySpec[],fitness:FitnessData|undefined,height:(x:number,z:number)=>number){
 const display=new T.Group(),collision=new T.Group();display.name='v12 運動區';
 for(const f of data?.facilities??[]){
  if(!validFacility(f)){(display.userData.issues??=[]).push('略過不完整場地 '+String(f?.id??''));continue;}
  if(f.kind.includes('pool')||f.kind==='site'||f.id.includes('candidate'))continue;const b=bounds(f.polygon),size=b.getSize(new T.Vector2()),center=b.getCenter(new T.Vector2()),y=f.surfaceY??height(center.x,center.y)+.025;
  const holes=(f as SportFacility&{inner?:Point2[]}).inner;
  const surface=slab(f.polygon,y,['track','runway'].includes(f.kind)?'#b3664e':f.kind==='tennis'?'#668a76':f.kind==='basketball'?'#658da3':'#789366',holes?[holes]:[]);surface.name=f.id;display.add(surface);collision.add(surface.clone());
  // The orthophoto trace favours open hard courts for the grey area (no roof evidence), so no canopy is built.
  const courts=f.courts?.length?f.courts:[f.polygon];
  for(const court of courts){const cb=bounds(court),cc=cb.getCenter(new T.Vector2()),sz=cb.getSize(new T.Vector2());line(display,[...court,court[0]],y+.025);
   if(['tennis','volleyball','basketball','pitch','football'].includes(f.kind)&&!(f.kind==='tennis'&&!f.courts?.length)){
    line(display,[[cb.min.x,cc.y],[cb.max.x,cc.y]],y+.025);
    if(f.kind==='tennis'||f.kind==='volleyball'){const net=box(display,collision,sz.x,.9,.035,cc.x,y+.45,cc.y,'#d6dbcf',false);net.material.transparent=true;net.material.opacity=.55;for(const x of [cb.min.x,cb.max.x])box(display,collision,.09,1.25,.09,x,y+.625,cc.y,'#ddd4c0');}
    if(f.kind==='basketball')for(const z of [cb.min.y+.3,cb.max.y-.3]){box(display,collision,.12,3.3,.12,cc.x,y+1.65,z,'#686f70');box(display,collision,1.8,1.05,.06,cc.x,y+3,z,'#eee9d8',false);const hoop=new T.Mesh(new T.TorusGeometry(.23,.025,6,16),mat('#b66b38'));hoop.rotation.x=Math.PI/2;hoop.position.set(cc.x,y+2.6,z+(z<cc.y?.4:-.4));display.add(hoop);}
    if(['pitch','football'].includes(f.kind)){const circle=Array.from({length:49},(_,i):Point2=>[cc.x+9*Math.cos(i/48*Math.PI*2),cc.y+9*Math.sin(i/48*Math.PI*2)]);line(display,circle,y+.025);for(const z of [cb.min.y,cb.max.y]){for(const x of [cc.x-3.6,cc.x+3.6])box(display,collision,.1,2.4,.1,x,y+1.2,z,'#eee9d8');box(display,collision,7.3,.1,.1,cc.x,y+2.4,z,'#eee9d8');}}
   }
  }
  if(f.kind==='baseball'){
   const authored=f as SportFacility&{infieldClay?:Point2[];diamond?:{home:Point2;first:Point2;second:Point2;third:Point2;mound:Point2}};
   if(authored.infieldClay)display.add(slab(authored.infieldClay,y+.012,'#b67c52'));
   const d=authored.diamond;if(d){line(display,[d.home,d.first,d.second,d.third,d.home],y+.03);for(const p of [d.home,d.first,d.second,d.third])box(display,collision,.4,.025,.4,p[0],y+.025,p[1],'#eee9d8',false);}
  }
  if(f.kind==='track'){
   const t=(f as SportFacility&{track?:{kerbInnerRadius:number;straightLength:number;laneCountEstimate:number}}).track,r=t?.kerbInnerRadius??36.38,straight=t?.straightLength??84.2,c=f.center??[center.x,center.y];
   for(let lane=0;lane<=(t?.laneCountEstimate??8);lane++){const radius=r+lane*1.16,pts:Point2[]=[];for(let j=0;j<=32;j++){const a=Math.PI+j*Math.PI/32;pts.push([c[0]+Math.cos(a)*radius,c[1]-straight/2+Math.sin(a)*radius]);}for(let j=0;j<=32;j++){const a=j*Math.PI/32;pts.push([c[0]+Math.cos(a)*radius,c[1]+straight/2+Math.sin(a)*radius]);}line(display,[...pts,pts[0]],y+.03);}
  }
  if(f.id.includes('stand'))for(let i=0;i<8;i++)box(display,collision,Math.max(1,size.x/8),.28*(i+1),size.y, b.min.x+(i+.5)*size.x/8,y+.14*(i+1),center.y,'#b6b9b1');
  if(f.fence!==false&&['tennis','baseball','softball','skating','skating_rink'].includes(f.kind))addFence(display,collision,f.polygon,y);
  if(['track','tennis','basketball'].includes(f.kind))for(const x of [b.min.x-1,b.max.x+1]){box(display,collision,.16,6,.16,x,y+3,b.min.y,'#6d7774');box(display,collision,.9,.15,.4,x,y+6,b.min.y,'#e9d8a4',false);}
 }
 for(const w of waters.filter(w=>w.kind==='pool')){
  const bottom=slab(w.polygon,w.surfaceY-1.4,'#81afb7');display.add(bottom);collision.add(bottom.clone());const water=slab(w.polygon,w.surfaceY,'#5babb9');water.material.transparent=true;water.material.opacity=.78;display.add(water);
  w.polygon.forEach((a,i)=>{const b=w.polygon[(i+1)%w.polygon.length],len=Math.hypot(b[0]-a[0],b[1]-a[1]),m=box(display,collision,len,1.55,.14,(a[0]+b[0])/2,w.surfaceY-.625,(a[1]+b[1])/2,'#b6d2cd');m.rotation.y=-Math.atan2(b[1]-a[1],b[0]-a[0]);collision.children.at(-1)!.rotation.copy(m.rotation);});
  const b=bounds(w.polygon);const lanes=b.max.x-b.min.x>=45?8:0;for(let lane=1;lane<lanes;lane++){const z=b.min.y+(b.max.y-b.min.y)*lane/lanes;line(display,[[b.min.x,z],[b.max.x,z]],w.surfaceY+.025,lane%2?'#efd89b':'#e4eeee');}
  const cc=b.getCenter(new T.Vector2()),width=b.max.x-b.min.x,depth=b.max.y-b.min.y,shade=width<40?width:16;
  box(display,collision,shade,.14,depth,cc.x,w.surfaceY+3.4,cc.y,'#658da3',false);
  for(const x of [cc.x-shade/2,cc.x+shade/2])for(const z of [b.min.y-.25,b.max.y+.25])box(display,collision,.12,3.5,.12,x,w.surfaceY+1.7,z,'#c0c7bd');
 }
 for(const f of fitness?.scenes??[]){const floor=slab(f.polygon,f.floorY,'#c9b697');display.add(floor);collision.add(floor.clone());f.polygon.forEach((a,i)=>{const b=f.polygon[(i+1)%f.polygon.length],len=Math.hypot(b[0]-a[0],b[1]-a[1]),m=box(display,collision,len,3,.12,(a[0]+b[0])/2,f.floorY+1.5,(a[1]+b[1])/2,'#d8d0c0');m.rotation.y=-Math.atan2(b[1]-a[1],b[0]-a[0]);collision.children.at(-1)!.rotation.copy(m.rotation);});}
 const opaqueFittings=display.children.filter((object):object is Fitting=>
  object instanceof T.Mesh && (object.geometry instanceof T.BoxGeometry || object.geometry instanceof T.TorusGeometry)
  && object.material instanceof T.MeshStandardMaterial && !object.material.transparent);
 if(opaqueFittings.length>1){
  const geometry=mergeFittings(opaqueFittings,true);
  if(geometry){
   const batch=new T.Mesh(geometry,new T.MeshStandardMaterial({vertexColors:true,roughness:.8}));
   batch.name='Sports fittings';
   display.remove(...opaqueFittings);
   display.add(batch);
  }
 }
 batchMarkings(display,display.children.filter((object):object is T.Line<T.BufferGeometry,T.LineBasicMaterial>=>object instanceof T.Line));
 display.updateMatrixWorld(true);collision.updateMatrixWorld(true);return {display,collision};
}
