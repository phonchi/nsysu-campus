/** Offline only. Default: full eight-building campus. --prototype preserves SC 1F/2F. */
import { buildRuntimeWorld, RUNTIME_WORLD_INPUTS } from '../tests/world-fixture';
import { readFile, writeFile, rename, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { Box3, Vector3 } from 'three';
import { init, exportNavMesh, NavMeshQuery } from 'recast-navigation';
import { generateTiledNavMesh } from 'recast-navigation/generators';
import { buildWalkWorld, geometryArrays, effectiveRooms } from '../src/walk-world';
import { WalkNavigation, WALK_BUILDING_IDS } from '../src/walk-nav';
import type { WalkBuilding, FloorAccess, CampusStructure } from '../src/walk-types';
const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const dir=resolve(root,'public/data/walkthrough');
const prototype=process.argv.includes('--prototype');
const ids:readonly string[]=prototype?['SC']:WALK_BUILDING_IDS;
const scope=prototype?'prototype-SC-1F-2F':'campus-science-engineering-v2';
const inputs=[...ids.map(id=>`public/data/walkthrough/${id}.json`),...(prototype?[]:['public/data/walkthrough/index.json']),
 'public/data/walkthrough/access-plan.json','public/data/walkthrough/campus-structure.json','src/walk-world.ts','src/walk-types.ts','src/walk-nav.ts','tools/bake_walk_nav.ts',
 'public/data/terrain/terrain.json','public/data/terrain/terrain.bin','src/world/terrain.ts','src/world/road-surface.ts','public/data/story-zones.json',...RUNTIME_WORLD_INPUTS];
const sha=(b:Uint8Array|string)=>createHash('sha256').update(b).digest('hex');
const hashes:Record<string,string>={};
const config={cs:.07,ch:.08,tileSize:192,walkableSlopeAngle:45,walkableHeight:Math.ceil(1.7/.08),
 walkableRadius:Math.ceil(.28/.07),walkableClimb:2,maxEdgeLen:100,maxSimplificationError:.5,
 minRegionArea:2,mergeRegionArea:8,maxVertsPerPoly:6,detailSampleDist:1,detailSampleMaxError:.08};
let report:Record<string,unknown>={status:'building',scope,createdAt:new Date().toISOString(),agent:{radius:.28,height:1.7},config,inputs:hashes,
 notes:['Virtual walkthrough only; not verified real-world navigation.','Closed animated doors are excluded; runtime must open doors before traversing.']};
async function save(){
 const coverage=report.coverage as {total:number;reachable:number;allDestinationsReachable:boolean;insideSummary?:{total:number;reachable:number;returnReachable:number;allReachable:boolean};floors:{reachable:number}[];buildings:unknown[]}|undefined;
 // The browser only needs identity/readiness and counters. Full route evidence
 // remains exclusively in navmesh-meta.json, never copied into this manifest.
 const runtime={status:report.status,scope:report.scope,createdAt:report.createdAt,validationPassed:report.validationPassed,
  binaryBytes:report.binaryBytes,binarySha256:report.binarySha256,surfaceVersion:report.surfaceVersion,
  coverage:coverage?{total:coverage.total,reachable:coverage.reachable,allDestinationsReachable:coverage.allDestinationsReachable,
   insideTotal:coverage.insideSummary?.total,insideReachable:coverage.insideSummary?.reachable,insideReturnReachable:coverage.insideSummary?.returnReachable,
   allInteriorsReachable:coverage.insideSummary?.allReachable,buildings:coverage.buildings.length,floors:coverage.floors.length,
   reachableFloors:coverage.floors.filter(f=>f.reachable>0).length}:undefined,error:report.error};
 for(const [name,value] of [['navmesh-meta.json',report],['navmesh-runtime.json',runtime]] as const){
  await writeFile(resolve(dir,name+'.tmp'),JSON.stringify(value,null,2)+'\n');await rename(resolve(dir,name+'.tmp'),resolve(dir,name));
 }
}
try {
 const reviewMeta=JSON.parse(await readFile(resolve(dir,'access-plan.json'),'utf8'));
 for(const name of await readdir(dir))if(name.includes('source-review')&&name.endsWith('.json'))inputs.push(`public/data/walkthrough/${name}`);
 if(reviewMeta.sourceReviewFile){
  const name=String(reviewMeta.sourceReviewFile);
  if(!name.startsWith('public/data/walkthrough/')||name.includes('..')||!name.endsWith('.json'))throw new Error('Invalid source review reference');
  if(!inputs.includes(name))inputs.push(name);
 }
 for(const path of inputs)hashes[path]=sha(await readFile(resolve(root,path)));
 if(reviewMeta.sourceReviewFile&&reviewMeta.sourceReviewHash!==hashes[reviewMeta.sourceReviewFile])throw new Error('Stale access-plan source review hash');
 await save();
 if(!prototype){
  const index=JSON.parse(await readFile(resolve(dir,'index.json'),'utf8'));
  const entries=index.buildings as {id:string;url:string}[];
  if(!Array.isArray(entries)||entries.length!==ids.length||new Set(entries.map(e=>e.id)).size!==ids.length||ids.some(id=>!entries.some(e=>e.id===id)))throw new Error('Index must declare all eight buildings exactly once');
  for(const e of entries)if(e.url!==`/data/walkthrough/${e.id}.json`&&e.url!==`data/walkthrough/${e.id}.json`)throw new Error(`Unexpected asset URL: ${e.id}`);
 }
 const access=JSON.parse(await readFile(resolve(dir,'access-plan.json'),'utf8')) as {floors:Record<string,FloorAccess>;sourceSHA256:Record<string,string>};
 for(const id of ids)if(access.sourceSHA256?.[`${id}.json`]!==hashes[`public/data/walkthrough/${id}.json`])throw new Error(`Stale access-plan source: ${id}`);
 const structure=JSON.parse(await readFile(resolve(dir,'campus-structure.json'),'utf8')) as CampusStructure;
 if((access as {structureSHA256?:string}).structureSHA256!==hashes['public/data/walkthrough/campus-structure.json'])throw new Error('Stale access-plan: campus-structure.json changed');
 const data=await Promise.all(ids.map(async id=>{
  const b=JSON.parse(await readFile(resolve(dir,`${id}.json`),'utf8')) as WalkBuilding;
  if(b.id!==id||!Array.isArray(b.floors)||!b.floors.length)throw new Error(`Invalid building: ${id}`);
  if(prototype)b.floors=b.floors.filter(f=>f.level===1||f.level===2);
  for(const floor of b.floors){if(!access.floors[floor.id])throw new Error(`Missing floor access: ${floor.id}`);floor.access=access.floors[floor.id];}
  if(new Set(b.floors.map(f=>f.id)).size!==b.floors.length)throw new Error(`Duplicate floors: ${id}`);
  return b;
 }));
 const world=prototype?buildWalkWorld(data,structure):buildRuntimeWorld().world;
 report.surfaceVersion=world.collision.userData.surfaceVersion;
 const {positions,indices}=geometryArrays(world.collision);
 if(!positions.length||!indices.length)throw new Error('Empty collision geometry: inspect world merge errors');
 // Include all finite collision geometry (including service ramps/connectors),
 // never the decorative display/sea. Also verify declared floor world frames.
 // Bound the tiled mesh to the walkable buildings, destinations and spawn. The campus-wide
 // ground would multiply tiles and shrink Recast's per-tile polygon budget.
 const box=new Box3().expandByPoint(world.spawn);
 for(const floor of world.floors){
  const frame=world.frames.get(floor.buildingId);if(!frame)throw new Error(`Missing building frame: ${floor.buildingId}`);
  for(const [x,z] of floor.data.outline)box.expandByPoint(new Vector3(x,floor.y,z).applyMatrix4(frame));
 }
 for(const d of world.destinations)box.expandByPoint(new Vector3(...d.position));
 // Story places the auto-walk must reach on the navmesh (gate and seawall stay on the outdoor path network).
 const zones=JSON.parse(await readFile(resolve(root,'public/data/story-zones.json'),'utf8')) as {zones:Record<string,{p:[number,number]}>};
 for(const id of ['tunnel-west','tunnel-inside','admin','library','arcade'])if(zones.zones[id]){const [x,z]=zones.zones[id].p;box.expandByPoint(new Vector3(x-20,-1,z-20)).expandByPoint(new Vector3(x+20,4,z+20));}
 box.min.add(new Vector3(-12,-1,-12));box.max.add(new Vector3(12,5,12));
 const bounds:[[number,number,number],[number,number,number]]=[box.min.toArray(),box.max.toArray()];
 report={...report,geometry:{vertices:positions.length/3,triangles:indices.length/3,bounds},recastVersion:JSON.parse(await readFile(resolve(root,'node_modules/recast-navigation/package.json'),'utf8')).version};
 console.log(JSON.stringify({event:'bake-start',...report}));await init();
 const result=generateTiledNavMesh(positions,indices,{...config,bounds});
 report.logs=result.intermediates.buildContext.logs;if(!result.success)throw new Error(result.error);
 const bytes=exportNavMesh(result.navMesh);if(bytes.length<=40){result.navMesh.destroy();throw new Error('Recast produced no navigable tiles');}
 const navigation=new WalkNavigation(result.navMesh),q=new NavMeshQuery(result.navMesh,{maxNodes:65535});
 const halfExtents={x:.45,y:.32,z:.45},start=q.findClosestPoint(world.spawn,{halfExtents});
 const checks=world.destinations.map(d=>{
  const target=new Vector3(...d.position),path=navigation.findPath(world.spawn,target);
  const returnPath=path.length?navigation.findPath(target,world.spawn):[];
  let diagnostic:unknown;
  if(!path.length){
   const goal=q.findClosestPoint(target,{halfExtents});diagnostic={projectedGoal:goal.success?goal:{success:false,status:goal.status}};
   if(start.success&&start.polyRef&&goal.success&&goal.polyRef){
    const corridor=q.findPath(start.polyRef,goal.polyRef,start.point,goal.point,{maxPathPolys:4096});
    try{diagnostic={projectedGoal:goal,corridorStatus:corridor.status,lastReachablePoint:corridor.polys.size?q.closestPointOnPoly(corridor.polys.get(corridor.polys.size-1),goal.point).closestPoint:null};}
    finally{corridor.polys.destroy();}
   }
  }
  return {id:d.id,label:d.label,buildingId:d.buildingId,floorId:d.floorId,roomId:d.roomId,doorId:d.doorId,level:d.level,target:d.position,
   reachable:path.length>0,returnReachable:returnPath.length>0,points:path.length,path:path.map(p=>p.toArray()),diagnostic};
 });
 const floorCoverage=data.flatMap(b=>b.floors.map(f=>{
  const items=checks.filter(c=>c.buildingId===b.id&&c.floorId===f.id);
  return {buildingId:b.id,floorId:f.id,level:f.level,declaredRooms:f.rooms.length,rendered:world.floors.some(w=>w.buildingId===b.id&&w.data.id===f.id),
   total:items.length,reachable:items.filter(c=>c.reachable).length,returnReachable:items.filter(c=>c.returnReachable).length,
   unreachable:items.filter(c=>!c.reachable||!c.returnReachable).map(c=>c.id)};
 }));
 const buildingCoverage=data.map(b=>{
  const floors=floorCoverage.filter(f=>f.buildingId===b.id);return {buildingId:b.id,floors:floors.length,
   reachableFloors:floors.filter(f=>f.reachable>0).length,total:floors.reduce((n,f)=>n+f.total,0),reachable:floors.reduce((n,f)=>n+f.reachable,0)};
 });
 const errors:string[]=[];
 for(const f of floorCoverage){if(!f.rendered)errors.push(`Floor not rendered: ${f.floorId}`);if(!f.reachable)errors.push(`No reachable door or entrance: ${f.floorId}`);}
 for(const c of checks)if(!c.reachable||!c.returnReachable)errors.push(`Unreachable destination: ${c.id} at ${c.target.join(',')} (out=${c.reachable}, return=${c.returnReachable})`);
 const polygonArea=(p:number[][])=>Math.abs(p.reduce((sum,a,i)=>{const b=p[(i+1)%p.length];return sum+a[0]*b[1]-b[0]*a[1];},0)/2);
 const renderableRooms=data.flatMap(b=>b.floors.flatMap(f=>effectiveRooms(f,structure).filter(r=>['room','room-candidate'].includes(r.kind)&&r.polygon.length>=3&&polygonArea(r.polygon)>=1.6).map(r=>({buildingId:b.id,floorId:f.id,roomId:r.id}))));
 const builderOmissions=renderableRooms.filter(r=>!checks.some(c=>c.buildingId===r.buildingId&&c.floorId===r.floorId&&c.roomId===r.roomId));
 for(const r of builderOmissions)errors.push(`Builder omission: ${r.buildingId}/${r.floorId}/${r.roomId}`);
 const insideChecks=renderableRooms.map(r=>{
  const destination=world.destinations.find(d=>d.roomId===r.roomId&&d.floorId===r.floorId&&d.buildingId===r.buildingId);
  const floor=world.floors.find(f=>f.data.id===r.floorId&&f.buildingId===r.buildingId);
  const doorId=destination?.doorId,portal=floor?.data.access?.portals.find(p=>p.id===doorId);
  // A shared portal may serve two different rooms. Never use WorldDoor.inside,
  // which belongs to the first room that emitted the shared door visual.
  const localTarget=portal?.clearancePositions?.[r.roomId];
  if(!floor||!localTarget||localTarget.length!==2||!localTarget.every(Number.isFinite)){
   errors.push(`Missing own-room interior core: ${r.roomId} at portal ${doorId}`);
   return {...r,doorId,localTarget:localTarget??null,target:null,reachable:false,returnReachable:false,reason:'missing-own-core',path:[]};
  }
  const target=new Vector3(localTarget[0],floor.y,localTarget[1]).applyMatrix4(world.frames.get(r.buildingId)!);
  const path=navigation.findPath(world.spawn,target),returnPath=navigation.findPath(target,world.spawn);
  let diagnostic:unknown;
  if(!path.length||!returnPath.length){
   const goal=q.findClosestPoint(target,{halfExtents});diagnostic={projectedGoal:goal.success?goal:{success:false,status:goal.status}};
   if(start.success&&start.polyRef&&goal.success&&goal.polyRef){
    const corridor=q.findPath(start.polyRef,goal.polyRef,start.point,goal.point,{maxPathPolys:4096});
    try{diagnostic={projectedGoal:goal,corridorStatus:corridor.status,lastReachablePoint:corridor.polys.size?q.closestPointOnPoly(corridor.polys.get(corridor.polys.size-1),goal.point).closestPoint:null};}
    finally{corridor.polys.destroy();}
   }
   errors.push(`Unreachable room interior: ${r.roomId} at ${target.toArray().join(',')} (in=${!!path.length}, out=${!!returnPath.length})`);
  }
  return {...r,doorId,localTarget,target:target.toArray(),reachable:!!path.length,returnReachable:!!returnPath.length,path:path.map(p=>p.toArray()),diagnostic};
 });
 const insideSummary={total:insideChecks.length,reachable:insideChecks.filter(c=>c.reachable).length,returnReachable:insideChecks.filter(c=>c.returnReachable).length,
  allReachable:insideChecks.length>0&&insideChecks.every(c=>c.reachable&&c.returnReachable)};
 for(const f of floorCoverage){
  const interior=insideChecks.filter(c=>c.floorId===f.floorId&&c.buildingId===f.buildingId);
  Object.assign(f,{insideTotal:interior.length,insideReachable:interior.filter(c=>c.reachable).length,insideReturnReachable:interior.filter(c=>c.returnReachable).length});
 }
 for(const b of buildingCoverage){
  const interior=insideChecks.filter(c=>c.buildingId===b.buildingId);
  Object.assign(b,{insideTotal:interior.length,insideReachable:interior.filter(c=>c.reachable).length,insideReturnReachable:interior.filter(c=>c.returnReachable).length});
 }
 const renderedDoorIds=[...new Set(world.doors.map(d=>d.id))];
 for(const c of checks)if(c.roomId&&(!c.doorId||!renderedDoorIds.includes(c.doorId)))errors.push(`Destination door is missing: ${c.id} -> ${c.doorId}`);
 const secondaryPortalIds=renderedDoorIds.filter(id=>!checks.some(c=>c.doorId===id));
 if(new Set(checks.map(c=>c.id)).size!==checks.length)errors.push('Duplicate destination identifiers');
 const four=checks.filter(d=>['SC1001','SC1005','SC1015','SC2001'].includes(d.label));
 const first=world.destinations.find(d=>d.label==='SC1001'),upper=world.destinations.find(d=>d.label==='SC2001');
 const stairs=first&&upper?{up:navigation.findPath(new Vector3(...first.position),new Vector3(...upper.position)).length>0,
 down:navigation.findPath(new Vector3(...upper.position),new Vector3(...first.position)).length>0}:{up:false,down:false};
 q.destroy();navigation.dispose();
 for(const path of inputs)if(hashes[path]!==sha(await readFile(resolve(root,path))))throw new Error(`Input changed during bake: ${path}`);
 await writeFile(resolve(dir,'navmesh.bin.tmp'),bytes);await rename(resolve(dir,'navmesh.bin.tmp'),resolve(dir,'navmesh.bin'));
 report={...report,status:errors.length?'incomplete':'ready',validationPassed:errors.length===0,binaryBytes:bytes.length,binarySha256:sha(bytes),spawn:world.spawn.toArray(),
 coverage:{total:checks.length,reachable:checks.filter(c=>c.reachable).length,checks,buildings:buildingCoverage,floors:floorCoverage,renderedDoorIds,secondaryPortalIds,renderableRooms,builderOmissions,insideChecks,insideSummary,
 fourKnownDoors:four,stairs,allDestinationsReachable:checks.length>0&&checks.every(c=>c.reachable&&c.returnReachable),errors}};
 await save();console.log(JSON.stringify({event:'bake-complete',bytes:bytes.length,validationPassed:!errors.length,buildings:buildingCoverage,insideSummary,errors}));
 if(errors.length)process.exitCode=2;
} catch(error){report={...report,status:'failed',error:String(error)};await save();console.error(error);process.exitCode=1;}
