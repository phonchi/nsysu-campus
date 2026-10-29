import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { WalkBuilding,WalkFloor,WalkRoom,Point2,WalkDestination,CampusStructure,StairCore,LiftSpec } from './walk-types';
import { GROUND_Y, PLAY_BOUNDS, type Terrain } from './world/terrain';
import { projectRoadGeometry } from './world/road-surface';
export const FLOOR_HEIGHT=3.7;
export const floorY=(level:number)=>(level<0?level:level-1)*FLOOR_HEIGHT+.08;
export interface WorldDoor {id:string;position:T.Vector3;outside:T.Vector3;inside:T.Vector3;group:T.Group;panel:T.Object3D;closedBox:T.Box3;normal?:T.Vector3;open:number;target:number;label:string;buildingId:string;floorId:string;}
export interface WorldFloor {data:WalkFloor;buildingId:string;group:T.Group;y:number;}
export interface WorldLift {id:string;buildingId:string;center:T.Vector3;stops:{floorId:string;label:string;level:number;position:T.Vector3}[];}
export interface WalkWorld {display:T.Group;collision:T.Group;doors:WorldDoor[];floors:WorldFloor[];destinations:WalkDestination[];spawn:T.Vector3;frames:Map<string,T.Matrix4>;scales:Map<string,number>;lifts:WorldLift[];bounds:T.Box3;}
const palette={wall:'#ddd4c0',trim:'#bca98c',wood:'#9d7352',floor:'#d7d1c2',glass:'#6c8e91',roof:'#a3937c'};
const mats=new Map<string,T.MeshStandardMaterial>();
const mat=(c:string)=>{if(!mats.has(c))mats.set(c,new T.MeshStandardMaterial({color:c,roughness:.84}));return mats.get(c)!;};
function box(parent:T.Object3D,w:number,h:number,d:number,x:number,y:number,z:number,c:string){const m=new T.Mesh(unitBox,mat(c));m.scale.set(w,h,d);m.position.set(x,y,z);m.castShadow=true;m.receiveShadow=true;parent.add(m);return m;}
function shapeOf(points:Point2[],holes:Point2[][]=[]){const s=new T.Shape(points.map(([x,z])=>new T.Vector2(x,-z)));for(const p of holes)s.holes.push(new T.Path(p.map(([x,z])=>new T.Vector2(x,-z))));return s;}
function plane(parent:T.Object3D,poly:Point2[],holes:Point2[][],y:number,c:string){const m=new T.Mesh(new T.ShapeGeometry(shapeOf(poly,holes)),mat(c));m.rotation.x=-Math.PI/2;m.material.side=T.DoubleSide;m.position.y=y;m.receiveShadow=true;parent.add(m);return m;}
function rect(x1:number,z1:number,x2:number,z2:number):Point2[]{return [[x1,z1],[x2,z1],[x2,z2],[x1,z2]];}
function wall(parent:T.Object3D,a:Point2,b:Point2,y:number,height:number,color:string,thick=.16){const dx=b[0]-a[0],dz=b[1]-a[1],len=Math.hypot(dx,dz);if(len<.07)return;const m=box(parent,len,height,thick,(a[0]+b[0])/2,y+height/2,(a[1]+b[1])/2,color);m.rotation.y=-Math.atan2(dz,dx);return m;}
function projectToEdge(p:Point2,a:Point2,b:Point2){const dx=b[0]-a[0],dz=b[1]-a[1],den=dx*dx+dz*dz,t=den?T.MathUtils.clamp(((p[0]-a[0])*dx+(p[1]-a[1])*dz)/den,0,1):0;return {t,p:[a[0]+dx*t,a[1]+dz*t] as Point2,d:Math.hypot(p[0]-a[0]-dx*t,p[1]-a[1]-dz*t)};}
function addRamp(parent:T.Object3D,from:T.Vector3,to:T.Vector3,width:number){const dx=to.x-from.x,dz=to.z-from.z,L=Math.hypot(dx,dz),ux=-dz/L*width/2,uz=dx/L*width/2;const pts=[from.x+ux,from.y,from.z+uz,from.x-ux,from.y,from.z-uz,to.x-ux,to.y,to.z-uz,to.x+ux,to.y,to.z+uz];const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(pts,3));g.setIndex([0,2,1,0,3,2]);g.computeVertexNormals();if(g.attributes.normal.getY(0)<0){g.setIndex([0,1,2,0,2,3]);g.computeVertexNormals();}const m=new T.Mesh(g,mat('#d3c9b6'));parent.add(m);return m;}
function mergeStatic(group:T.Group){group.updateMatrixWorld(true);const geometries:T.BufferGeometry[]=[];group.traverse(o=>{if(o instanceof T.Mesh){const g=o.geometry.clone().applyMatrix4(o.matrixWorld);const flat=g.index?g.toNonIndexed():g;for(const key of Object.keys(flat.attributes))if(key!=="position")flat.deleteAttribute(key);geometries.push(flat);}});if(!geometries.length)return;const g=mergeGeometries(geometries,false);if(g){g.computeVertexNormals();group.clear();group.add(new T.Mesh(g,mat('#dfd8c8')));}else throw new Error("Collision merge failed; source world retained");for(const p of geometries)p.dispose();}
function batchVisual(group:T.Group){
 group.updateWorldMatrix(true,true);const inverse=group.matrixWorld.clone().invert();const batches=new Map<T.Material,T.BufferGeometry[]>();const originals:T.Mesh[]=[];
 group.traverse(o=>{
  if(!(o instanceof T.Mesh)||Array.isArray(o.material))return;
  for(let parent:T.Object3D|null=o;parent&&parent!==group;parent=parent.parent)if(parent.userData.dynamicDoor)return;
  let g=o.geometry.clone().applyMatrix4(new T.Matrix4().multiplyMatrices(inverse,o.matrixWorld));if(g.index)g=g.toNonIndexed();
  if(!g.attributes.normal)g.computeVertexNormals();if(!g.attributes.uv)g.setAttribute('uv',new T.Float32BufferAttribute(new Float32Array(g.attributes.position.count*2),2));
  if(!batches.has(o.material))batches.set(o.material,[]);batches.get(o.material)!.push(g);originals.push(o);
 });
 for(const [material,geometries] of batches){const merged=mergeGeometries(geometries,false);if(!merged)throw new Error('Visual batching failed');const mesh=new T.Mesh(merged,material);mesh.castShadow=true;mesh.receiveShadow=true;group.add(mesh);for(const g of geometries)g.dispose();}
 for(const mesh of originals)mesh.removeFromParent();
}
const unitBox=new T.BoxGeometry(1,1,1);
const area=(p:Point2[])=>Math.abs(p.reduce((s,a,i)=>{const b=p[(i+1)%p.length];return s+a[0]*b[1]-b[0]*a[1];},0)/2);
export const storey=(f:WalkFloor,maxLevel=4)=>f.storeyIndex??(f.level===99?maxLevel+1:f.level);
function pairWall(display:T.Object3D,collision:T.Object3D,a:Point2,b:Point2,y:number,h:number,c:string,t=.16){const mesh=wall(display,a,b,y,h,c,t);if(mesh)collision.add(mesh.clone());}
function cutWall(display:T.Object3D,collision:T.Object3D,a:Point2,b:Point2,y:number,height:number,color:string,openings:{p:Point2;width:number;depth?:number}[],lintel=true){
 const L=Math.hypot(b[0]-a[0],b[1]-a[1]);if(L<.06)return;const dx=(b[0]-a[0])/L,dz=(b[1]-a[1])/L;
 const cuts=openings.map(o=>{const along=(o.p[0]-a[0])*dx+(o.p[1]-a[1])*dz,perpendicular=Math.abs((o.p[0]-a[0])*(-dz)+(o.p[1]-a[1])*dx);return {lo:Math.max(0,along-o.width/2),hi:Math.min(L,along+o.width/2),d:perpendicular,depth:o.depth??.18};}).filter(o=>o.d<o.depth&&o.hi-o.lo>.015).sort((a,b)=>a.lo-b.lo);
 let at=0;for(const c of cuts){if(c.lo>at)pairWall(display,collision,[a[0]+dx*at,a[1]+dz*at],[a[0]+dx*c.lo,a[1]+dz*c.lo],y,height,color);if(lintel&&height>2.3)pairWall(display,collision,[a[0]+dx*c.lo,a[1]+dz*c.lo],[a[0]+dx*c.hi,a[1]+dz*c.hi],y+2.3,height-2.3,color);at=Math.max(at,c.hi);}
 if(at<L)pairWall(display,collision,[a[0]+dx*at,a[1]+dz*at],b,y,height,color);
}
function bridge(display:T.Object3D,collision:T.Object3D,a:Point2,b:Point2,y:number,width=2.1,rails=true){const dx=b[0]-a[0],dz=b[1]-a[1],L=Math.hypot(dx,dz);if(L<.01)return;const nx=-dz/L*width/2,nz=dx/L*width/2;const poly:Point2[]=[[a[0]+nx,a[1]+nz],[a[0]-nx,a[1]-nz],[b[0]-nx,b[1]-nz],[b[0]+nx,b[1]+nz]];const mesh=plane(display,poly,[],y,'#bcb7a6');collision.add(mesh.clone());if(y>1&&rails){for(const sign of [-1,1])pairWall(display,collision,[a[0]+nx*sign,a[1]+nz*sign],[b[0]+nx*sign,b[1]+nz*sign],y,1.0,'#6e7e74',.1);}}
interface BridgeSegment {a:Point2;b:Point2;width:number;}
function exteriorBridgeRails(display:T.Object3D,collision:T.Object3D,segments:BridgeSegment[],y:number,landing:BridgeSegment){
 if(y<1)return;
 const insideInterval=(a:Point2,b:Point2,s:BridgeSegment):[number,number]|undefined=>{
  const dx=s.b[0]-s.a[0],dz=s.b[1]-s.a[1],L=Math.hypot(dx,dz);if(L<.001)return;
  const ux=dx/L,uz=dz/L,nx=-uz,nz=ux;
  const u0=(a[0]-s.a[0])*ux+(a[1]-s.a[1])*uz,v0=(a[0]-s.a[0])*nx+(a[1]-s.a[1])*nz;
  const du=(b[0]-a[0])*ux+(b[1]-a[1])*uz,dv=(b[0]-a[0])*nx+(b[1]-a[1])*nz;let lo=0,hi=1;
  for(const [start,delta,min,max] of [[u0,du,-.04,L+.04],[v0,dv,-s.width/2-.04,s.width/2+.04]]){if(Math.abs(delta)<1e-8){if(start<min||start>max)return;}else{let x=(min-start)/delta,z=(max-start)/delta;if(x>z)[x,z]=[z,x];lo=Math.max(lo,x);hi=Math.min(hi,z);if(lo>=hi)return;}}
  return [lo,hi];
 };
 segments.forEach((s,index)=>{const dx=s.b[0]-s.a[0],dz=s.b[1]-s.a[1],L=Math.hypot(dx,dz);if(L<.02)return;
  for(const sign of [-1,1]){const nx=-dz/L*s.width/2*sign,nz=dx/L*s.width/2*sign,a:Point2=[s.a[0]+nx,s.a[1]+nz],b:Point2=[s.b[0]+nx,s.b[1]+nz];let intervals:[number,number][]=[[0,1]];
   for(const other of [...segments.filter((_,i)=>i!==index),landing]){const cut=insideInterval(a,b,other);if(!cut)continue;intervals=intervals.flatMap(([lo,hi])=>cut[1]<=lo||cut[0]>=hi?[[lo,hi] as [number,number]]:[...(cut[0]>lo?[[lo,cut[0]] as [number,number]]:[]),...(cut[1]<hi?[[cut[1],hi] as [number,number]]:[])]);}
   for(const [lo,hi] of intervals)if((hi-lo)*L>.08)pairWall(display,collision,[a[0]+(b[0]-a[0])*lo,a[1]+(b[1]-a[1])*lo],[a[0]+(b[0]-a[0])*hi,a[1]+(b[1]-a[1])*hi],y,1.0,'#6e7e74',.10);
  }
 });
}
/** Room polygons after campus-structure clipping (stairwells, landings); null rooms are dropped. */
export function effectiveRooms(f:WalkFloor,structure:CampusStructure):WalkRoom[]{
 const o=structure.roomOverrides?.[f.id];if(!o)return f.rooms;
 return f.rooms.flatMap(r=>!(r.id in o)?[r]:o[r.id]===null?[]:[{...r,polygon:o[r.id] as Point2[]}]);
}
export function buildingFrame(structure:CampusStructure,id:string){const p=structure.placements[id];return new T.Matrix4().compose(new T.Vector3(p.x,0,p.z),new T.Quaternion().setFromEuler(new T.Euler(0,p.rotation,0)),new T.Vector3(p.scale,1,p.scale));}
const coreRect=(c:{center:Point2;angle:number},length:number,width:number,shift=0):Point2[]=>{const ux=Math.cos(c.angle),uz=Math.sin(c.angle),vx=-uz,vz=ux,cx=c.center[0]+ux*shift,cz=c.center[1]+uz*shift,hl=length/2,hw=width/2;return [[cx-ux*hl-vx*hw,cz-uz*hl-vz*hw],[cx+ux*hl-vx*hw,cz+uz*hl-vz*hw],[cx+ux*hl+vx*hw,cz+uz*hl+vz*hw],[cx-ux*hl+vx*hw,cz-uz*hl+vz*hw]];};
/** Interior switch-back stair: flight A on -v half climbs away from the apron, flight B returns. */
function stairCore(display:T.Group,collision:T.Group,core:StairCore,ys:number[]){
 const g=new T.Group(),c=new T.Group();g.position.set(core.center[0],0,core.center[1]);g.rotation.y=-core.angle;c.position.copy(g.position);c.rotation.copy(g.rotation);display.add(g);collision.add(c);
 const L=core.length,W=core.width,mid=1.2,x0=-L/2,x1=L/2-mid,wall='#cfc6b2',rail='#6f7f75';
 const lo=ys[0],hi=ys[ys.length-1];
 // Stairwell enclosure: both long sides and the far end, full height across the run.
 for(const [a,b] of [[[x0,-W/2],[L/2,-W/2]],[[x0,W/2],[L/2,W/2]],[[L/2,-W/2],[L/2,W/2]]] as [Point2,Point2][])pairWall(g,c,a,b,lo,hi-lo+3.3,wall,.14);
 for(let i=1;i<ys.length;i++){
  const a=ys[i-1],b=ys[i],half=(a+b)/2,w=W/2-.16;
  const fa=addRamp(c,new T.Vector3(x0,a,-W/4-.03),new T.Vector3(x1,half,-W/4-.03),w),fb=addRamp(c,new T.Vector3(x1,half,W/4+.03),new T.Vector3(x0,b,W/4+.03),w);for(const r of [fa,fb]){const v=r.clone();v.material=mat('#d3c9b6').clone();(v.material as T.Material).side=T.DoubleSide;g.add(v);}
  const land=plane(c,rect(x1,-W/2,L/2,W/2),[],half,'#c7bba3');g.add(land.clone());box(g,mid,.16,W,x1+mid/2,half-.09,0,'#b8a68c');
  for(let k=0;k<12;k++){const t=(k+.5)/12;box(g,(x1-x0)/12,.07,w,x0+(x1-x0)*t,a+(half-a)*(k+1)/12-.035,-W/4-.03,'#c5b8a0');box(g,(x1-x0)/12,.07,w,x1-(x1-x0)*t,half+(b-half)*(k+1)/12-.035,W/4+.03,'#c5b8a0');}
  // Divider keeps the two flights apart; it rises one storey plus a handrail.
  pairWall(g,c,[x0,0],[x1,0],a,b-a+1.0,rail,.1);
 }
 // Bottom: seal the space under the returning flight and the mid-landing (no crawl-under, no pop-through).
 pairWall(g,c,[x0,0],[x0,W/2],lo,2.4,wall,.14);pairWall(g,c,[x1,0],[L/2,0],lo,(ys[1]??lo+3.7)/2-lo/2-.1,wall,.1);
 pairWall(g,c,[x0,-W/2],[x0,0],hi,1.05,rail,.09);
 g.userData.stairCore=core.id;batchVisual(g);
}
function liftCab(display:T.Group,collision:T.Group,lift:LiftSpec,y:number){
 const g=new T.Group(),c=new T.Group();g.position.set(lift.center[0],0,lift.center[1]);g.rotation.y=-lift.angle;c.position.copy(g.position);c.rotation.copy(g.rotation);display.add(g);collision.add(c);
 const h=lift.size/2;for(const [a,b] of [[[-h,-h],[h,-h]],[[-h,h],[h,h]],[[h,-h],[h,h]],[[-h,-h],[-h,-h+.35]],[[-h,h-.35],[-h,h]]] as [Point2,Point2][])pairWall(g,c,a,b,y,3.3,'#8f9c98',.12);
 plane(g,rect(-h,-h,h,h),[],y+.012,'#5d6d69');box(g,.05,.32,.2,-h+.12,y+1.2,h-.18,'#e9c46a');
 g.userData.liftCab=lift.id;batchVisual(g);
}
/** Lift every vertex by the terrain at its x,z (flat decals follow the DEM). */
export function drape(g:T.BufferGeometry,lift:(x:number,z:number)=>number){const p=g.attributes.position;for(let i=0;i<p.count;i++)p.setY(i,p.getY(i)+lift(p.getX(i),p.getZ(i)));p.needsUpdate=true;g.computeBoundingSphere();g.computeBoundingBox();return g;}
function ribbon(points:Point2[],width:number,y:number){
 const pos:number[]=[],idx:number[]=[];
 for(let i=0;i<points.length;i++){const p=points[i],a=points[Math.max(0,i-1)],b=points[Math.min(points.length-1,i+1)];let dx=b[0]-a[0],dz=b[1]-a[1];const l=Math.hypot(dx,dz)||1;dx/=l;dz/=l;pos.push(p[0]-dz*width/2,y,p[1]+dx*width/2,p[0]+dz*width/2,y,p[1]-dx*width/2);if(i){const k=i*2;idx.push(k-2,k-1,k,k-1,k+1,k);}}
 const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(pos,3));g.setIndex(idx);g.computeVertexNormals();if(g.attributes.normal.getY(0)<0){const ix=g.index!;for(let n=0;n<ix.count;n+=3){const t=ix.getX(n);ix.setX(n,ix.getX(n+2));ix.setX(n+2,t);}g.computeVertexNormals();}return g;
}
export const CAMPUS_GROUND:[number,number,number,number]=[-330,-330,260,480];
/** With `terrain`, ground outside the flat pad follows the DEM (display + collision) and exterior context extends to PLAY_BOUNDS. */
export function buildWalkWorld(data:WalkBuilding[],structure:CampusStructure,terrain?:Terrain):WalkWorld{
 const out:WalkWorld={display:new T.Group(),collision:new T.Group(),doors:[],floors:[],destinations:[],spawn:new T.Vector3(),frames:new Map(),scales:new Map(),lifts:[],bounds:new T.Box3()};
 for(const b of data){if(!structure.placements[b.id])throw new Error('Missing placement for '+b.id);out.frames.set(b.id,buildingFrame(structure,b.id));out.scales.set(b.id,structure.placements[b.id].scale);}
 out.display.userData.surfaceVersion=out.collision.userData.surfaceVersion=terrain?.surfaceVersion??'flat-ground-v1';
 const scFrame=out.frames.get('SC')??new T.Matrix4();out.spawn.set(6,.2,44).applyMatrix4(scFrame);out.spawn.y=.2;
 const toWorld=(id:string,p:Point2)=>{const v=new T.Vector3(p[0],0,p[1]).applyMatrix4(out.frames.get(id)!);return [v.x,v.z] as Point2;};
 const maxLevelOf=(b:WalkBuilding)=>Math.max(...b.floors.filter(f=>f.level!==99).map(f=>f.level));
 const storeyOf=(b:WalkBuilding,floorId:string)=>{const f=b.floors.find(f=>f.id===floorId)!;return storey(f,maxLevelOf(b));};
 // Ground opens over stairs that descend to basements.
 const groundHoles:Point2[][]=[];
 for(const b of data)for(const core of structure.stairCores[b.id]??[])if(core.levels.some(l=>l.level<0))groundHoles.push(coreRect(core,core.length,core.width).map(p=>toWorld(b.id,p)));
 const [gx0,gz0,gx1,gz1]=terrain?PLAY_BOUNDS:CAMPUS_GROUND;
 // lift(x,z): metres the DEM raises the ground above the flat pad at this point (0 without terrain).
 const lift=(x:number,z:number)=>terrain?terrain.heightAt(x,z)-GROUND_Y:0;
 if(terrain){
  // Flat pad keeps its precise ground with basement stair openings; the DEM grid skips pad cells and covers the rest.
  const pad=(x:number,z:number)=>Math.abs(terrain.heightAt(x,z)-GROUND_Y)<1e-6,[px0,pz0,px1,pz1]=terrain.padBounds();
  const ground:T.Mesh<T.BufferGeometry,T.MeshStandardMaterial>=plane(out.display,rect(px0,pz0,px1,pz1),groundHoles,GROUND_Y,'#8b9d79');
  // Keep the exact authored basement holes, but retain this plane ONLY in fully-flat cells.
  // A bounding rectangle beneath a hillside is a second invisible walkable storey.
  ground.updateMatrix();const planar=ground.geometry.clone().applyMatrix4(ground.matrix),old=ground.geometry;
  ground.geometry=projectRoadGeometry(planar,terrain,{offset:0,cellFilter:(i,j)=>Math.abs(terrain.vertexHeight(i,j)-GROUND_Y)<1e-7&&Math.abs(terrain.vertexHeight(i+1,j)-GROUND_Y)<1e-7&&Math.abs(terrain.vertexHeight(i,j+1)-GROUND_Y)<1e-7&&Math.abs(terrain.vertexHeight(i+1,j+1)-GROUND_Y)<1e-7});
  planar.dispose();old.dispose();ground.position.set(0,0,0);ground.rotation.set(0,0,0);ground.castShadow=false;ground.name='Campus pad ground';out.collision.add(ground.clone());
  // The playable display and collision use identical 4 m triangles. Only unreachable far terrain is coarser.
  const fine=new T.Mesh(terrain.mesh(PLAY_BOUNDS,pad),mat('#8b9d79'));
  const coarse=new T.Mesh(terrain.mesh([-1e4,-1e4,1e4,1e4],(x,z)=>pad(x,z)||(x>=PLAY_BOUNDS[0]&&x<=PLAY_BOUNDS[2]&&z>=PLAY_BOUNDS[1]&&z<=PLAY_BOUNDS[3]),2),fine.material);
  for(const [m,n] of [[fine,'DEM terrain'],[coarse,'DEM terrain (far)']] as const){m.name=n;m.receiveShadow=true;out.display.add(m);}
  const solid=new T.Mesh(terrain.mesh(PLAY_BOUNDS,pad),mat('#8b9d79'));solid.name='DEM terrain collision';out.collision.add(solid);
 }else{
  const ground=plane(out.display,rect(gx0,gz0,gx1,gz1),groundHoles,-.055,'#8b9d79');ground.castShadow=false;out.collision.add(ground.clone());
  const sea=box(out.display,900,.4,1400,gx0-450,-.6,75,'#629caa');sea.castShadow=false;
 }
 const inGround=(p:Point2[])=>p.every(([x,z])=>x>gx0+1&&x<gx1-1&&z>gz0+1&&z<gz1-1);
 // OSM roads are display-only pavement ribbons over the shared ground.
 const roadGroup=new T.Group();roadGroup.name='Campus roads (OSM)';out.display.add(roadGroup);
 // Road overlays are built by decorateCampus from the exact terrain surface.
 batchVisual(roadGroup);
 // Landmarks and background blocks come from OSM footprints; they are solid exterior context.
 const inPoly=(p:Point2,poly:Point2[])=>{let c=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const a=poly[i],b=poly[j];if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])c=!c;}return c;};
 // Walkable footprints (with galleries) of every storey; context blocks are dropped only if they truly overlap one.
 const walkPolys=data.flatMap(b=>b.floors.filter(f=>f.level!==99).map(f=>(f.access?.walkOutline??f.outline).map(p=>toWorld(b.id,p))));
 const overlapsWalkable=(poly:Point2[])=>walkPolys.some(w=>poly.some(p=>inPoly(p,w))||w.some(p=>inPoly(p,poly)));
 for(const [kind,list] of [['landmark',structure.context.landmarks],['background',structure.context.background]] as const){
  for(const lm of list){
   if(lm.polygon.length<3||!inGround(lm.polygon)||overlapsWalkable(lm.polygon))continue;const bb=new T.Box2().setFromPoints(lm.polygon.map(([x,z])=>new T.Vector2(x,z)));
   // On slopes the block is seated on its lowest corner and extended down into the hill.
   const base=terrain?Math.min(...lm.polygon.map(([x,z])=>lift(x,z))):0,rise=terrain?Math.max(...lm.polygon.map(([x,z])=>lift(x,z)))-base:0;
   const h=Math.max(4,lm.storeys*3.6),group=new T.Group();group.name='Campus exterior '+lm.id;group.userData.lift=base;out.display.add(group);
   const geo=new T.ExtrudeGeometry(shapeOf(lm.polygon),{depth:h+rise+.4,bevelEnabled:false});geo.translate(0,0,base-.4); /* local z becomes world y after the mesh's -90° x rotation */const color=kind==='background'?'#c9bfae':lm.tone==='cream'?'#d9ccb2':lm.tone==='white'?'#e4e0d6':'#b4806b';
   const mesh=new T.Mesh(geo,mat(color));mesh.rotation.x=-Math.PI/2;mesh.castShadow=true;mesh.receiveShadow=true;group.add(mesh);out.collision.add(mesh.clone());
   if(kind==='landmark'){const c=bb.getCenter(new T.Vector2());group.userData.landmark={id:lm.id,name:lm.name,position:[c.x,base+h+3,c.y]};}
   batchVisual(group);
  }
 }
 for(const b of data){
  const frame=out.frames.get(b.id)!,scale=out.scales.get(b.id)!,building=new T.Group(),collision=new T.Group();building.name=b.id;building.applyMatrix4(frame);collision.applyMatrix4(frame);out.display.add(building);out.collision.add(collision);
  const maxLevel=maxLevelOf(b);const floors=b.floors.filter(f=>f.outline?.length>=3).sort((a,b)=>storey(a,maxLevel)-storey(b,maxLevel));
  const cores=structure.stairCores[b.id]??[],lifts=structure.lifts[b.id]??[];
  const stairs=new T.Group();stairs.name='Stair cores '+b.id;stairs.userData.stairGroup=true;building.add(stairs);
  for(const core of cores){const ys=core.levels.map(l=>floorY(l.storey)).sort((a,b)=>a-b);stairCore(stairs,collision,core,ys);}
  for(const lift of lifts){
   const cabs=new T.Group();cabs.name='Lift '+lift.id;building.add(cabs);const stops:WorldLift['stops']=[];
   for(const s of lift.stops){const y=floorY(s.storey);liftCab(cabs,collision,lift,y);const f=floors.find(f=>f.id===s.floorId);stops.push({floorId:s.floorId,label:f?.label??String(s.level),level:s.level,position:new T.Vector3(lift.center[0],y,lift.center[1]).applyMatrix4(frame)});}
   out.lifts.push({id:lift.id,buildingId:b.id,center:new T.Vector3(lift.center[0],0,lift.center[1]).applyMatrix4(frame),stops});
  }
  for(const f of floors){
   const ordinal=storey(f,maxLevel),y=floorY(ordinal),fg=new T.Group(),fc=new T.Group();fg.name=f.id;building.add(fg);collision.add(fc);out.floors.push({data:f,buildingId:b.id,group:fg,y});
   const entry=f.access?.entry??f.stairs?.[0]?.position??[f.bounds[2],0] as Point2;
   const holes=(f.holes??[]).map(h=>h.slice());
   for(const core of cores){const own=core.levels.find(l=>l.floorId===f.id);if(own&&own.storey>Math.min(...core.levels.map(l=>l.storey)))holes.push(coreRect(core,core.length,core.width));}
   const walkOutline=f.access?.walkOutline??f.outline;const slab=plane(fg,walkOutline,holes,y+data.indexOf(b)*.002,palette.floor);fc.add(slab.clone());
   const entryPortal=f.access?.portals.find(p=>p.id===f.access?.entryPortalId),entryNode=entryPortal?.nodeIds?.find(id=>id!=='@outside'),entryStand=(entryNode?entryPortal?.clearancePositions?.[entryNode]:undefined)??f.access?.entryClearancePosition;
   const floorEntry=new T.Vector3(entryStand?.[0]??entry[0],y,entryStand?.[1]??entry[1]).applyMatrix4(frame);out.destinations.push({id:f.id+'-entrance',label:`${b.name} ${f.label} · ${f.level===1?'樓層入口':'樓梯口'}`,buildingId:b.id,floorId:f.id,position:floorEntry.toArray(),level:f.level});
   let perimeterEntry=entry,entryDistance=Infinity;for(let i=0;i<walkOutline.length;i++){const projection=projectToEdge(entry,walkOutline[i],walkOutline[(i+1)%walkOutline.length]);if(projection.d<entryDistance){entryDistance=projection.d;perimeterEntry=projection.p;}}
   const joins=[...structure.connectors.filter(c=>c.floors.includes(f.id)).flatMap(c=>c.openings[f.id]??[]),...(structure.railGaps?.[f.id]??[])];
   const keepClear=[...joins.map(o=>({p:o.p,r:o.width/2+.6})),...(f.level===1?[{p:perimeterEntry,r:1.7}]:[])];
   for(let i=0;i<walkOutline.length;i++){const a=walkOutline[i],bb=walkOutline[(i+1)%walkOutline.length],L=Math.hypot(bb[0]-a[0],bb[1]-a[1]);
    // Guards first: every edge, however short, is protected on upper floors and walled below ground.
    if(ordinal>1)cutWall(fg,fc,a,bb,y,1.0,'#7c8b7b',joins,false);
    else if(f.level<0)cutWall(fg,fc,a,bb,y,3.4,'#a99f8c',joins,false);
    if(L<2)continue;wall(fg,a,bb,y-.2,.2,palette.trim,.27);wall(fg,a,bb,y+3.23,.25,palette.trim,.28);
    for(let t=0;t<L;t+=4.2){const u=t/L,x=a[0]+(bb[0]-a[0])*u,z=a[1]+(bb[1]-a[1])*u;if(keepClear.some(k=>Math.hypot(x-k.p[0],z-k.p[1])<k.r))continue;const col=box(fg,.22,3.4,.22,x,y+1.7,z,palette.trim);fc.add(col.clone());}}
   // Source atria/voids get a 1.0 m guard on every storey above ground.
   if(ordinal>1)for(const h of f.holes??[])for(let i=0;i<h.length;i++)pairWall(fg,fc,h[i],h[(i+1)%h.length],y,1.0,'#7c8b7b',.1);
   for(const service of f.verticalServices??[]){if(service.polygon.length<3)continue;const shaft=new T.Mesh(new T.ExtrudeGeometry(shapeOf(service.polygon),{depth:3.2,bevelEnabled:false}),mat('#7c8e85'));shaft.rotation.x=-Math.PI/2;shaft.position.y=y;shaft.castShadow=true;shaft.receiveShadow=true;fg.add(shaft);fc.add(shaft.clone());}
   const portalVisuals=new Map<string,WorldDoor>();
   const rooms=effectiveRooms(f,structure);
   for(const room of rooms){
    const p=room.polygon;if(!['room','room-candidate'].includes(room.kind)||p.length<3||area(p)<1.6)continue;
    const bounds=new T.Box2().setFromPoints(p.map(v=>new T.Vector2(...v))),size=bounds.getSize(new T.Vector2());
    const portals=f.access?.portals.filter(p=>p.roomIds.includes(room.id))??[];
    const openings=portals.length?portals.map(p=>({id:p.id,p:p.perRoomPosition?.[room.id]??p.position,width:p.width,depth:p.cutDepth})): [{id:room.id,p:room.door.position,width:Math.max(1.15,room.door.width)}];
    const rg=new T.Group();fg.add(rg);
    for(let i=0;i<p.length;i++){const a=p[i],bb=p[(i+1)%p.length];cutWall(rg,fc,a,bb,y,3.2,palette.wall,openings);}
    const ceiling=plane(rg,p,[],y+3.2,'#e6e1d4');const ceil=ceiling.clone();ceil.geometry=ceil.geometry.clone();const ci=ceil.geometry.index;if(ci)for(let n=0;n<ci.count;n+=3){const a=ci.getX(n);ci.setX(n,ci.getX(n+2));ci.setX(n+2,a);}fc.add(ceil);
    plane(rg,p,[],y+.008,room.kind.includes('lab')?'#c3cfc9':'#d1c7b5');
    const primary=f.access?.primaryPortalByRoom[room.id]??openings[0].id;let primaryDoor:WorldDoor|undefined;
    for(const o of openings){
     let di=0,dist=Infinity,dp=o.p;for(let i=0;i<p.length;i++){const pr=projectToEdge(o.p,p[i],p[(i+1)%p.length]);if(pr.d<dist){dist=pr.d;di=i;dp=pr.p;}}
     const a=p[di],bb=p[(di+1)%p.length],L=Math.hypot(bb[0]-a[0],bb[1]-a[1]),portalSpec=portals.find(portal=>portal.id===o.id),tangent=portalSpec?.tangent;if(!tangent&&L<.65)continue;const tangentLength=tangent?Math.hypot(...tangent):L;const ux=tangent?tangent[0]/tangentLength:(bb[0]-a[0])/L,uz=tangent?tangent[1]/tangentLength:(bb[1]-a[1])/L,w=tangent?o.width:Math.min(o.width,L-.06);if(tangent)dp=o.p;
     const signed=p.reduce((sum,a,i)=>{const q=p[(i+1)%p.length];return sum+a[0]*q[1]-q[0]*a[1];},0);const n=new T.Vector2(-uz,ux);if(signed<0)n.negate();
     const spec=portals.find(p=>p.id===o.id),otherNode=spec?.nodeIds?.find(id=>id!==room.id);const coreIn=spec?.clearancePositions?.[room.id],coreOut=otherNode?spec?.clearancePositions?.[otherNode]:undefined;
     const outsidePoint=new T.Vector3(coreOut?.[0]??dp[0]-n.x*.55,y,coreOut?.[1]??dp[1]-n.y*.55).applyMatrix4(frame),insidePoint=new T.Vector3(coreIn?.[0]??dp[0]+n.x*.55,y,coreIn?.[1]??dp[1]+n.y*.55).applyMatrix4(frame);
     let door=portalVisuals.get(o.id);
     if(!door){const dg=new T.Group();dg.userData.dynamicDoor=true;dg.position.set(dp[0],y,dp[1]);dg.rotation.y=-Math.atan2(uz,ux);fg.add(dg);const hinge=new T.Group();hinge.position.x=-w/2;dg.add(hinge);box(hinge,w-.06,2.22,.065,w/2,1.11,0,palette.wood);box(hinge,.28,.55,.07,w*.52,1.5,0,palette.glass);box(hinge,.09,.05,.14,w-.13,1.0,-.07,'#d8cb9b');const position=new T.Vector3(dp[0],y,dp[1]).applyMatrix4(frame);const worldTangent=new T.Vector3(ux,0,uz).transformDirection(frame);const worldWidth=w*scale;const closedBox=new T.Box3().setFromCenterAndSize(position.clone().add(new T.Vector3(0,1.1,0)),new T.Vector3(Math.abs(worldTangent.x)*worldWidth+.15,2.2,Math.abs(worldTangent.z)*worldWidth+.15));door={id:o.id,position,outside:outsidePoint,inside:insidePoint,group:dg,panel:hinge,closedBox,normal:new T.Vector3(-n.x,0,-n.y).transformDirection(frame),open:0,target:0,label:portals.find(p=>p.id===o.id)?.roomIds.map(id=>rooms.find(r=>r.id===id)?.code).filter(Boolean).join('／')||room.code||(room.name&&!room.name.includes('候選')?room.name:'未編號空間'),buildingId:b.id,floorId:f.id};portalVisuals.set(o.id,door);out.doors.push(door);}
     if(o.id===primary){primaryDoor={...door,outside:outsidePoint,inside:insidePoint};}
    }
    if(primaryDoor)out.destinations.push({id:room.id,label:room.code??`${b.id} ${f.label} · 未編號空間 ${f.rooms.indexOf(room)+1}`,buildingId:b.id,floorId:f.id,roomId:room.id,doorId:primaryDoor.id,position:primaryDoor.outside.toArray(),level:f.level});
    const cols=Math.min(3,Math.max(1,Math.floor((size.x-2)/2))),rows=Math.min(3,Math.max(1,Math.floor((size.y-2)/2)));
    for(let r=0;r<rows;r++)for(let c=0;c<cols;c++){const x=bounds.min.x+1.2+c*2.1,z=bounds.min.y+1.5+r*2;let inside=false;for(let i=0,j=p.length-1;i<p.length;j=i++){if((p[i][1]>z)!==(p[j][1]>z)&&x<(p[j][0]-p[i][0])*(z-p[i][1])/(p[j][1]-p[i][1])+p[i][0])inside=!inside;}if(!inside||openings.some(o=>Math.hypot(x-o.p[0],z-o.p[1])<2.0)||x>bounds.max.x-.7||z>bounds.max.y-.7)continue;box(rg,1.25,.09,.65,x,y+.77,z,'#ac9675');for(const sign of [-1,1])box(rg,.07,.7,.07,x+sign*.48,y+.35,z,'#69756c');box(rg,.45,.08,.45,x,y+.45,z+.75,'#6e877a');box(rg,.45,.5,.06,x,y+.68,z+.96,'#6e877a');}
    if(size.x>3&&size.y>3)box(rg,Math.min(3,size.x-1),1.15,.06,(bounds.min.x+bounds.max.x)/2,y+1.6,bounds.min.y+.15,'#355b52');
   }
   const highest=f===floors.at(-1);if(highest){const roof=plane(fg,f.outline,holes,y+3.55,'#a27e68');roof.material.side=T.DoubleSide;}
  }
 }
 // Explicit walkways join physically connected buildings on every shared storey.
 for(const c of structure.connectors){
  const g=new T.Group(),k=new T.Group();g.name='Join '+c.id;out.display.add(g);out.collision.add(k);const y=floorY(c.storey);
  bridge(g,k,c.a,c.b,y+.006,c.width,false);for(const r of c.rails)for(let i=1;i<r.length;i++)pairWall(g,k,r[i-1],r[i],y,1.0,'#6e7e74',.1);
  if(c.storey===1){const dx=c.b[0]-c.a[0],dz=c.b[1]-c.a[1],L=Math.hypot(dx,dz)||1,nx=-dz/L*(c.width/2+.3),nz=dx/L*(c.width/2+.3);const roof=plane(g,[[c.a[0]+nx,c.a[1]+nz],[c.a[0]-nx,c.a[1]-nz],[c.b[0]-nx,c.b[1]-nz],[c.b[0]+nx,c.b[1]+nz]],[],3.48,'#a58d74');roof.material.side=T.DoubleSide;}
  batchVisual(g);
 }
 for(const f of out.floors)batchVisual(f.group);
 const context=new T.Group();for(const child of [...out.display.children])if(child instanceof T.Mesh)context.add(child);out.display.add(context);batchVisual(context);
 out.display.updateMatrixWorld(true);out.collision.updateMatrixWorld(true);out.bounds.setFromObject(out.display);mergeStatic(out.collision);out.collision.updateMatrixWorld(true);return out;
}
export function geometryArrays(root:T.Object3D){const positions:number[]=[],indices:number[]=[];root.updateWorldMatrix(true,true);root.traverse(o=>{if(!(o instanceof T.Mesh))return;const g=o.geometry,a=g.attributes.position,offset=positions.length/3,v=new T.Vector3();for(let i=0;i<a.count;i++){v.fromBufferAttribute(a,i).applyMatrix4(o.matrixWorld);positions.push(v.x,v.y,v.z);}if(g.index){for(let i=0;i<g.index.count;i++)indices.push(offset+g.index.getX(i));}else for(let i=0;i<a.count;i++)indices.push(offset+i);});return {positions,indices};}
