import {buildRuntimeWorld} from './world-fixture';
import {beforeAll,afterAll,it,expect} from 'vitest';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import * as T from 'three';
import {init,importNavMesh} from 'recast-navigation';
import {buildWalkWorld,effectiveRooms,type WalkWorld} from '../src/walk-world';
import {WalkNavigation,WALK_BUILDING_IDS} from '../src/walk-nav';
import {RapierController,initPhysics} from '../src/walk/controller';
import type {WalkBuilding,WalkDestination,FloorAccess,CampusStructure} from '../src/walk-types';
let data:WalkBuilding[],structure:CampusStructure,world:WalkWorld,navigation:WalkNavigation,physics:RapierController;
const zero=new T.Vector3();
beforeAll(async()=>{
 const meta=JSON.parse(fs.readFileSync('public/data/walkthrough/navmesh-meta.json','utf8'));
 expect(meta.scope).toBe('campus-science-engineering-v2');expect(meta.status).toBe('ready');
 for(const [path,digest]of Object.entries(meta.inputs))expect(createHash('sha256').update(fs.readFileSync(path)).digest('hex'),`stale bake input: ${path}`).toBe(digest);
 const bytes=new Uint8Array(fs.readFileSync('public/data/walkthrough/navmesh.bin'));
 expect(createHash('sha256').update(bytes).digest('hex')).toBe(meta.binarySha256);
 const access=JSON.parse(fs.readFileSync('public/data/walkthrough/access-plan.json','utf8')) as {floors:Record<string,FloorAccess>};
 data=WALK_BUILDING_IDS.map(id=>{const b=JSON.parse(fs.readFileSync(`public/data/walkthrough/${id}.json`,'utf8'))as WalkBuilding;for(const f of b.floors)f.access=access.floors[f.id];return b;});
 structure=JSON.parse(fs.readFileSync('public/data/walkthrough/campus-structure.json','utf8'));world=buildRuntimeWorld().world;await init();navigation=new WalkNavigation(importNavMesh(bytes).navMesh);
 await initPhysics();physics=new RapierController(world.collision);
},30000);
afterAll(()=>{navigation?.dispose();physics?.dispose();});
it('has a complete bidirectional path to every declared room and floor entrance',()=>{
 expect(world.frames.size).toBe(8);expect(world.floors.length).toBe(60);
 const polygonArea=(p:[number,number][])=>Math.abs(p.reduce((n,a,i)=>{const b=p[(i+1)%p.length];return n+a[0]*b[1]-b[0]*a[1];},0)/2);
 const sourceRooms=data.flatMap(b=>b.floors.flatMap(f=>effectiveRooms(f,structure).filter(r=>['room','room-candidate'].includes(r.kind)&&r.polygon.length>=3&&polygonArea(r.polygon)>=1.6).map(r=>r.id)));
 expect(new Set(world.destinations.filter(d=>d.roomId).map(d=>d.roomId))).toEqual(new Set(sourceRooms));
 expect(world.destinations.length).toBe(sourceRooms.length+60);
 const failures:string[]=[];
 for(const d of world.destinations){
  const goal=new T.Vector3(...d.position),path=navigation.findPath(world.spawn,goal),back=navigation.findPath(goal,world.spawn);
  if(!path.length||!back.length){failures.push(`${d.id}: incomplete ${!path.length?'outbound':'return'}`);continue;}
  // Query already rejects partial end polygons; additionally compare against
  // authored target within the documented projection bounds. findPath already
  // checks the final projected endpoint to .025 and the exact goal polygon.
  const end=path.at(-1)!;
  if(Math.hypot(end.x-goal.x,end.z-goal.z)>.45||Math.abs(end.y-goal.y)>.32)failures.push(`${d.id}: target projection offset ${end.distanceTo(goal).toFixed(3)}`);
 }
 console.info(`Campus strict navigation: ${world.destinations.length-failures.length}/${world.destinations.length}; ${sourceRooms.length} rooms, 60 floor entrances`);
 expect(failures).toEqual([]);
},30000);
function settle():boolean{
 for(let i=0;i<90;i++){physics.step(zero,1/30,false);if(physics.onGround)return true;}
 return false;
}
function follow(goal:T.Vector3, preciseInterior=false):string|undefined{
 const path=navigation.findPath(physics.position,goal);if(!path.length)return 'no complete path';
 let index=0,progress=physics.position.clone();
 for(let tick=0;tick<18000;tick++){
  let target=path[index];
  while(index<path.length-1&&Math.hypot(target.x-physics.position.x,target.z-physics.position.z)<.34&&Math.abs(target.y-physics.position.y)<.7)target=path[++index];
  const direction=target.clone().sub(physics.position);direction.y=0;
  if(index===path.length-1&&direction.length()<(preciseInterior?.05:.34)&&Math.abs(target.y-physics.position.y)<.4){
   return Math.hypot(physics.position.x-goal.x,physics.position.z-goal.z)<.36&&Math.abs(physics.position.y-goal.y)<.4?undefined:`stopped short: position=${JSON.stringify(physics.position.toArray())}, authored=${JSON.stringify(goal.toArray())}, projected=${JSON.stringify(target.toArray())}, horizontal=${Math.hypot(physics.position.x-goal.x,physics.position.z-goal.z).toFixed(6)}`;
  }
  if(direction.lengthSq()>0)direction.normalize();const before=physics.position.clone();
  physics.step(direction,preciseInterior?1/60:1/30,false,3.6);
  if(physics.position.distanceTo(before)>1)return 'discontinuous movement';
  if(tick>0&&tick%120===0){if(physics.position.distanceTo(progress)<.08)return `stalled at ${physics.position.toArray().map(v=>v.toFixed(3))}`;progress.copy(physics.position);}
  if(physics.position.y< -10)return 'fell below basement';
 }
 return 'step budget exhausted';
}
it('physically traverses eight buildings, basements, roofs and both stair directions with local collision',()=>{
 const representatives:WalkDestination[]=[];
 for(const bid of WALK_BUILDING_IDS){
  const roof=world.destinations.filter(d=>d.buildingId===bid&&d.level===99);
  const chosen=roof.find(d=>d.roomId)??roof.find(d=>!d.roomId);expect(chosen,`${bid} roof representative`).toBeDefined();representatives.push(chosen!);
  const basement=world.destinations.find(d=>d.buildingId===bid&&d.level===-1&&d.roomId);if(basement)representatives.push(basement);
 }
 for(const label of ['SC2001','BI2001']){const d=world.destinations.find(d=>d.label===label);expect(d,label).toBeDefined();if(d&&!representatives.some(r=>r.id===d.id))representatives.push(d);}
 const failures:string[]=[],results:{id:string;passed:boolean;error?:string}[]=[];
 for(const d of representatives){
  // Explicit case initialization only. No teleport occurs while following paths.
  physics.teleport(world.spawn);let error=settle()?follow(new T.Vector3(...d.position)):'spawn has no ground';
  if(error)error='approach: '+error;
  if(!error&&d.roomId){
   const f=world.floors.find(f=>f.buildingId===d.buildingId&&f.data.id===d.floorId)!;
   const portal=f.data.access?.portals.find(p=>p.id===d.doorId),core=portal?.clearancePositions?.[d.roomId];
   const door=world.doors.find(door=>door.id===d.doorId);
   if(!door||!core)error='missing shared portal or room-specific interior clearance point';
   else{
    // Open the selected dynamic panel; the static aperture is then checked by
    // real capsule movement, targeting this room's core (not the shared door's first room).
    // Interior clearance is verified to .05 of the projected endpoint, avoiding
    // compound projection + arrival tolerances; approach still matches runtime .34.
    door.target=1;door.open=1;door.panel.rotation.y=-Math.PI*.52;
    error=follow(new T.Vector3(core[0],f.y,core[1]).applyMatrix4(world.frames.get(d.buildingId)!),true);if(error)error='inside: '+error;
   }
  }
  if(!error&&d.label==='SC2001'){
   const lower=world.destinations.find(t=>t.buildingId==='SC'&&t.level===1&&!t.roomId)!;
   error=follow(new T.Vector3(...lower.position));
  }
  results.push({id:d.id,passed:!error,error});if(error)failures.push(`${d.id}: ${error}`);
 }
 console.info('Campus representative physical paths:',JSON.stringify(results));expect(failures).toEqual([]);
},180000);
