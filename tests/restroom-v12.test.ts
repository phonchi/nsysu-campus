import {expect,it} from 'vitest';
import * as T from 'three';
import {planRestroom,addRestroomInterior} from '../src/world/restroom-interiors';
import {RapierController,initPhysics} from '../src/walk/controller';
import {buildWalkWorld} from '../src/walk-world';
import type {CampusStructure,WalkFloor,WalkRoom} from '../src/walk-types';
const room=(gender:'male'|'female'|'unisex',w=3,d=4):WalkRoom=>({id:`fixture-${gender}`,kind:'restroom',gender,accessible:false,displayName:'測試廁所',polygon:[[0,0],[w,0],[w,d],[0,d]],door:{position:[w/2,0],width:1,basis:'schematic'},basis:'schematic'});
it('is deterministic, preserves inputs and puts urinals only in male restrooms',()=>{
 for(const gender of ['male','female','unisex'] as const){const r=room(gender),before=JSON.stringify(r),plan=planRestroom(r,undefined,1);expect(planRestroom(r,undefined,1)).toEqual(plan);expect(JSON.stringify(r)).toBe(before);expect(plan.fixtures.some(f=>f.kind==='urinal')).toBe(gender==='male');expect(plan.fixtures.some(f=>f.kind==='sink')).toBe(true);expect(plan.fixtures.find(f=>f.kind==='sign')?.label).toBe('測試廁所');expect(plan.internalDoors).toHaveLength(1);expect(plan.walkTargets.length).toBeGreaterThanOrEqual(3);}
});
it('supports the minimum rectangular footprint and rejects inadequate geometry with room ID',()=>{
 for(const gender of ['male','female','unisex'] as const)expect(()=>planRestroom(room(gender,2,2.4),undefined,1)).not.toThrow();
 expect(()=>planRestroom(room('female',1.8,2.4),undefined,1)).toThrow('fixture-female');
});
it('has capsule-reachable fixture and stall targets using actual rendered collision',async()=>{
 await initPhysics();for(const [w,d] of [[3,4],[2,2.4]]){const r=room('male',w,d),plan=planRestroom(r,undefined,1),display=new T.Group(),collision=new T.Group();
 addRestroomInterior(plan,display,collision,0,1);const floor=new T.Mesh(new T.BoxGeometry(w,.1,d));floor.position.set(w/2,-.05,d/2);collision.add(floor);
 const physics=new RapierController(collision);
 try{
  // Independent grid flood using real Rapier sweeps rather than planner internals.
  const step=.1,points:T.Vector3[]=[],ids=new Map<string,number>();for(let x=3;x<=Math.round((w-.3)/step);x++)for(let z=3;z<=Math.round((d-.3)/step);z++){ids.set(`${x},${z}`,points.length);points.push(new T.Vector3(x*step,0,z*step));}
  const start=new T.Vector3(w/2,0,.4),seed=points.findIndex(p=>p.distanceTo(start)<.01),queue=[seed],seen=new Set([seed]);
  for(let at=0;at<queue.length;at++){const a=points[queue[at]],ix=Math.round(a.x/step),iz=Math.round(a.z/step);for(const [x,z]of [[ix-1,iz],[ix+1,iz],[ix,iz-1],[ix,iz+1]]){const id=ids.get(`${x},${z}`);if(id===undefined||seen.has(id))continue;const b=points[id],from=a.clone().setY(.9),to=b.clone().setY(.9);if([.31,.6,1,1.4].every(y=>physics.sweep(from.clone().setY(y),to.clone().setY(y),.30)>=from.distanceTo(to)-1e-4)){seen.add(id);queue.push(id);}}}
  for(const target of plan.walkTargets)expect(queue.some(i=>Math.hypot(points[i].x-target[0],points[i].z-target[1])<.2),`unreachable ${target}`).toBe(true);
 }finally{physics.dispose();}}
});

it('keeps capsule clearance from real room walls at SC scale 1.4, for the minimum 2.0 × 2.4 m room',async()=>{
 await initPhysics();
 for(const scale of [1,1.3991411380801804])for(const gender of ['male','female'] as const){
  const w=2/scale,d=2.4/scale,r:WalkRoom={...room(gender),id:`walled-${gender}-${scale}`,polygon:[[-3,-3],[-3+w,-3],[-3+w,-3+d],[-3,-3+d]],door:{position:[-3+w/2,-3],width:1/scale,basis:'schematic'}};
  const f:WalkFloor={id:'SC-1F',level:1,label:'1F',sourceId:'fixture',page:1,crop:null,bounds:[-5,-5,5,5],outline:[[-5,-5],[5,-5],[5,5],[-5,5]],rooms:[r],stairs:[]};
  const s:CampusStructure={version:12,placements:{SC:{x:0,z:0,scale,rotation:0,basis:'schematic'}},lifts:{},stairCores:{},roomOverrides:{},connectors:[],context:{landmarks:[],background:[],roads:[],water:[],sport:[]}};
  const world=buildWalkWorld([{id:'SC',name:'理學院',floors:[f]}],s),plan=world.floors[0].group.userData.restrooms[0];
  const physics=new RapierController(world.collision);
  try{
   // Flood in world metres from the corridor side of the door, sweeping the real capsule radius.
   const step=.1,x0=-3*scale,z0=-3*scale-.6,ids=new Map<string,number>(),points:T.Vector3[]=[];
   for(let i=0;i<=Math.round(2/step);i++)for(let j=0;j<=Math.round(3/step);j++){ids.set(`${i},${j}`,points.length);points.push(new T.Vector3(x0+i*step,.08,z0+j*step));}
   const seed=ids.get(`${Math.round(1/step)},0`)!,queue=[seed],seen=new Set([seed]);
   for(let at=0;at<queue.length;at++){const a=points[queue[at]],i=Math.round((a.x-x0)/step),j=Math.round((a.z-z0)/step);for(const [x,z] of [[i-1,j],[i+1,j],[i,j-1],[i,j+1]]){const id=ids.get(`${x},${z}`);if(id===undefined||seen.has(id))continue;const b=points[id];if([.39,.7,1.1,1.5].every(y=>physics.sweep(a.clone().setY(y),b.clone().setY(y),.30)>=a.distanceTo(b)-1e-4)){seen.add(id);queue.push(id);}}}
   for(const t of plan.walkTargets as [number,number][])expect(queue.some(i=>Math.hypot(points[i].x-t[0],points[i].z-t[1])<.2),`${r.id} unreachable ${t}`).toBe(true);
   // Fixtures stay on the room side of the inner wall face.
   const half=.08*scale,inner=[x0+half,-3*scale+half,x0+2-half,-3*scale+2.4-half];
   for(const fx of plan.fixtures.filter((f:{kind:string})=>f.kind!=='sign'))expect(fx.position[0]>inner[0]&&fx.position[0]<inner[2]&&fx.position[1]>inner[1]&&fx.position[1]<inner[3]).toBe(true);
  }finally{physics.dispose();}
 }
});
