import * as T from 'three';
import type { FloorAccess, Point2, WalkRoom } from '../walk-types';
export interface RestroomFixture {id:string;kind:'partition'|'stall-door'|'toilet'|'urinal'|'sink'|'sign';position:Point2;size:Point2;y:number;height:number;yaw:number;label?:string}
export interface RestroomPlan {
 roomId:string;fixtures:RestroomFixture[];internalDoors:{id:string;position:Point2;clearWidth:number;yaw:number}[];
 collision:RestroomFixture[];walkTargets:Point2[];issues:string[];
}
const inside=(p:Point2,poly:Point2[])=>{let yes=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const a=poly[i],b=poly[j];if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])yes=!yes;}return yes;};
function segmentDistance(p:Point2,a:Point2,b:Point2){const x=b[0]-a[0],z=b[1]-a[1],t=Math.max(0,Math.min(1,((p[0]-a[0])*x+(p[1]-a[1])*z)/(x*x+z*z||1)));return Math.hypot(p[0]-a[0]-x*t,p[1]-a[1]-z*t);}
function local(p:Point2,f:RestroomFixture):Point2 {const x=p[0]-f.position[0],z=p[1]-f.position[1],c=Math.cos(f.yaw),s=Math.sin(f.yaw);return [x*c-z*s,x*s+z*c];}
function blocked(p:Point2,fixtures:RestroomFixture[],r=.32){return fixtures.some(f=>{const [x,z]=local(p,f);return Math.hypot(Math.max(Math.abs(x)-f.size[0]/2,0),Math.max(Math.abs(z)-f.size[1]/2,0))<r;});}
function overlap(a:RestroomFixture,b:RestroomFixture){
 const half=(f:RestroomFixture)=>[Math.abs(Math.cos(f.yaw))*f.size[0]/2+Math.abs(Math.sin(f.yaw))*f.size[1]/2,Math.abs(Math.sin(f.yaw))*f.size[0]/2+Math.abs(Math.cos(f.yaw))*f.size[1]/2];
 const ah=half(a),bh=half(b);return Math.abs(a.position[0]-b.position[0])<ah[0]+bh[0]+.03&&Math.abs(a.position[1]-b.position[1])<ah[1]+bh[1]+.03;
}
/** Room walls are 0.16 local units thick, centred on the polygon edge (walk-world pairWall). */
export const RESTROOM_WALL_HALF_LOCAL=.08;
/** Coordinates in metres along the building axes. Both renderer and bake divide by worldScale once.
 * Clearances are measured from the inner wall face, half a wall (0.08 × worldScale m) inside the edge. */
export function planRestroom(room:WalkRoom,floorAccess:FloorAccess|undefined,worldScale:number):RestroomPlan {
 if(!Number.isFinite(worldScale)||worldScale<=0)throw new Error(`${room.id}: 無效比例`);
 const poly=room.polygon.map(([x,z]):Point2=>[x*worldScale,z*worldScale]),xs=poly.map(p=>p[0]),zs=poly.map(p=>p[1]);
 const x0=Math.min(...xs),x1=Math.max(...xs),z0=Math.min(...zs),z1=Math.max(...zs),w=x1-x0,d=z1-z0;
 if(poly.length<3||Math.min(w,d)<1.99||Math.max(w,d)<2.39)throw new Error(`${room.id}: 廁所至少需要 2.0 × 2.4 m`);
 const portal=floorAccess?.portals.find(p=>p.id===floorAccess.primaryPortalByRoom[room.id])??floorAccess?.portals.find(p=>p.roomIds.includes(room.id));
 const rawDoor=portal?.perRoomPosition?.[room.id]??portal?.position??room.door.position,entry:Point2=[rawDoor[0]*worldScale,rawDoor[1]*worldScale];
 const rawCore=portal?.clearancePositions?.[room.id];
 const plan:RestroomPlan={roomId:room.id,fixtures:[],internalDoors:[],collision:[],walkTargets:[],issues:[]};
 const wallHalf=RESTROOM_WALL_HALF_LOCAL*worldScale,wallDistance=(p:Point2)=>Math.min(...poly.map((a,i)=>segmentDistance(p,a,poly[(i+1)%poly.length])));
 const clearRoom=(p:Point2,r=.32)=>inside(p,poly)&&wallDistance(p)>=r+wallHalf;
 const gridStep=.12,nx=Math.ceil(w/gridStep),nz=Math.ceil(d/gridStep),grid:Point2[]=[],gridIds=new Map<string,number>();
 for(let i=0;i<=nx;i++)for(let j=0;j<=nz;j++){const p:Point2=[x0+i*gridStep,z0+j*gridStep];if(clearRoom(p)){gridIds.set(`${i},${j}`,grid.length);grid.push(p);}}
 const start=grid.reduce((best,p,i)=>Math.hypot(p[0]-entry[0],p[1]-entry[1])<Math.hypot(grid[best]?.[0]-entry[0],grid[best]?.[1]-entry[1])?i:best,0);
 if(!grid.length||Math.hypot(grid[start][0]-entry[0],grid[start][1]-entry[1])>.8)throw new Error(`${room.id}: 廁所入口無淨空`);
 const core:Point2=rawCore?[rawCore[0]*worldScale,rawCore[1]*worldScale]:grid[start];
 if(!clearRoom(core,.25))throw new Error(`${room.id}: 廁所室內目標不在可達淨空內`);
 plan.walkTargets.push(core);
 const fits=(f:RestroomFixture)=>{
  const c=Math.cos(f.yaw),s=Math.sin(f.yaw);
  for(let i=0;i<=4;i++)for(let j=0;j<=4;j++){const x=(i/4-.5)*f.size[0],z=(j/4-.5)*f.size[1],p:Point2=[f.position[0]+c*x+s*z,f.position[1]-s*x+c*z];if(!inside(p,poly)||wallDistance(p)<wallHalf-1e-6||segmentDistance(p,entry,grid[start])<.42)return false;}
  return true;
 };
 const reachable=(fixtures:RestroomFixture[],targets:Point2[])=>{
  if(blocked(grid[start],fixtures))return false;
  const seen=new Set<number>([start]),queue=[start];
  for(let at=0;at<queue.length;at++){const p=grid[queue[at]],i=Math.round((p[0]-x0)/gridStep),j=Math.round((p[1]-z0)/gridStep);
   for(const [a,b]of [[i+1,j],[i-1,j],[i,j+1],[i,j-1]]){const id=gridIds.get(`${a},${b}`);if(id!==undefined&&!seen.has(id)&&!blocked(grid[id],fixtures)){seen.add(id);queue.push(id);}}}
  return targets.every(t=>clearRoom(t,.25)&&!blocked(t,fixtures)&&queue.some(id=>Math.hypot(grid[id][0]-t[0],grid[id][1]-t[1])<.17));
 };
 const place=(kind:'stall'|'sink'|'urinal')=>{
  const placementGrid:Point2[]=[];
  for(let x=x0+.16;x<x1-.12;x+=.12)for(let z=z0+.16;z<z1-.12;z+=.12)if(inside([x,z],poly))placementGrid.push([x,z]);
  const candidates=placementGrid.filter(p=>poly.some((a,i)=>segmentDistance(p,a,poly[(i+1)%poly.length])<(kind==='stall'?.95:.65))).sort((a,b)=>Math.hypot(b[0]-entry[0],b[1]-entry[1])-Math.hypot(a[0]-entry[0],a[1]-entry[1])||a[0]-b[0]||a[1]-b[1]);
  // Fixture centres may be near a wall; only pedestrian samples need capsule clearance.
  for(let index=0;index<candidates.length;index++)for(let turn=0;turn<4;turn++){
   const center=candidates[index],yaw=turn*Math.PI/2,c=Math.cos(yaw),s=Math.sin(yaw),point=(x:number,z:number):Point2=>[center[0]+c*x+s*z,center[1]-s*x+c*z];
   const id=`${room.id}:${kind}`,make=(k:RestroomFixture['kind'],x:number,z:number,w:number,d:number,h:number,y=0):RestroomFixture=>({id:`${id}:${k}:${x}:${z}`,kind:k,position:point(x,z),size:[w,d],height:h,y,yaw});
   const fixtures=kind==='stall'?[make('partition',-.50,0,.06,1.2,1.85),make('partition',.50,0,.06,1.2,1.85),make('partition',0,.58,1.06,.06,1.85),make('stall-door',-.455,-.13,.03,.94,1.75,.08),make('toilet',0,.30,.40,.45,.46)]:[make(kind,0,0,.48,.28,kind==='sink'?.85:.65,kind==='urinal'?.35:0)];
   const target=point(0,kind==='stall'?-.27:-.50);
   if(!fixtures.every(fits)||fixtures.some(f=>plan.collision.some(other=>overlap(f,other))))continue;
   if(!reachable([...plan.collision,...fixtures],[...plan.walkTargets,target]))continue;
   plan.fixtures.push(...fixtures);plan.collision.push(...fixtures);plan.walkTargets.push(target);
   if(kind==='stall')plan.internalDoors.push({id,position:point(0,-.60),clearWidth:.94,yaw});return true;
  }
  return false;
 };
 for(const kind of ['stall','sink',...(room.gender==='male'?['urinal']:[])] as const)if(!place(kind as 'stall'|'sink'|'urinal'))throw new Error(`${room.id}: 無法配置保留入口與隔間通路的廁所內裝 (${kind})`);
 plan.fixtures.push({id:`${room.id}:sign`,kind:'sign',position:entry,size:[.65,.035],height:.25,y:2.35,yaw:0,label:room.displayName??'廁所'});
 return plan;
}
/** Render every solid exactly as planned; door openings remain open and traversable. */
export function addRestroomInterior(plan:RestroomPlan,display:T.Group,collision:T.Group,y:number,scale:number){
 for(const f of plan.fixtures){if(f.kind==='sign')continue;const mesh=new T.Mesh(new T.BoxGeometry(f.size[0]/scale,f.height,f.size[1]/scale),new T.MeshStandardMaterial({color:f.kind==='partition'?'#b6c7bf':f.kind==='stall-door'?'#9d7352':'#eeeae0',roughness:.65}));mesh.name=f.id;mesh.position.set(f.position[0]/scale,y+f.y+f.height/2,f.position[1]/scale);mesh.rotation.y=f.yaw;display.add(mesh);collision.add(mesh.clone());
  if(f.kind==='sink'||f.kind==='toilet'){const bowl=new T.Mesh(new T.CylinderGeometry(.14,.11,.06,12),new T.MeshStandardMaterial({color:'#a9c2c6'}));bowl.position.set(mesh.position.x,y+f.y+f.height+.01,mesh.position.z);bowl.scale.set(1/scale,1,1/scale);display.add(bowl);}}
}
