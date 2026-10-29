/** Manual-style acceptance: the walking capsule, real door blocking and explicit E presses.
 * Navigation only steers (as a person would); physics decides whether the route is walkable. */
import {buildRuntimeWorld} from './world-fixture';
import {beforeAll,afterAll,it,expect} from 'vitest';
import fs from 'node:fs';
import * as T from 'three';
import {init,importNavMesh} from 'recast-navigation';
import {buildWalkWorld,floorY,type WalkWorld,type WorldDoor} from '../src/walk-world';
import {WalkNavigation,WALK_BUILDING_IDS} from '../src/walk-nav';
import {RapierController,initPhysics} from '../src/walk/controller';
import {doorConstraint,animateDoors} from '../src/walk/doors';
import {wouldEnterDoor} from '../src/walk-door';
import type {WalkBuilding,FloorAccess,CampusStructure,StairCore} from '../src/walk-types';

let data:WalkBuilding[],structure:CampusStructure,world:WalkWorld,navigation:WalkNavigation,physics:RapierController;
const zero=new T.Vector3(),SPEED=3.6,DT=1/30;
const report:Record<string,unknown>={createdAt:new Date().toISOString(),method:'Rapier KCC capsule + runtime per-substep door blocking; E pressed only within 1.5 m of a closed door the path enters'};
let ePresses=0;

beforeAll(async()=>{
 const access=JSON.parse(fs.readFileSync('public/data/walkthrough/access-plan.json','utf8')) as {floors:Record<string,FloorAccess>};
 structure=JSON.parse(fs.readFileSync('public/data/walkthrough/campus-structure.json','utf8'));
 data=WALK_BUILDING_IDS.map(id=>{const b=JSON.parse(fs.readFileSync(`public/data/walkthrough/${id}.json`,'utf8')) as WalkBuilding;for(const f of b.floors)f.access=access.floors[f.id];return b;});
 world=buildRuntimeWorld().world;await init();
 navigation=new WalkNavigation(importNavMesh(new Uint8Array(fs.readFileSync('public/data/walkthrough/navmesh.bin'))).navMesh);
 await initPhysics();physics=new RapierController(world.collision);physics.constrain=doorConstraint(world.doors);report.physicsStats=physics.stats;
},60000);
afterAll(()=>{
 navigation?.dispose();physics?.dispose();
 fs.mkdirSync('artifacts/p1',{recursive:true});fs.writeFileSync('artifacts/p1/manual-walk.json',JSON.stringify({...report,ePresses,wrongDoorSelections:wrongDoor},null,1)+'\n');
});

function settle(){for(let i=0;i<120;i++){physics.step(zero,DT,false);if(physics.onGround)return true;}return false;}
function start(p:T.Vector3){for(const d of world.doors){d.open=0;d.target=0;d.panel.rotation.y=0;}physics.teleport(p.clone().add(new T.Vector3(0,.15,0)));return settle();}
// Same selection as the runtime E key: a lift cab wins, otherwise the nearest door within 2.15 m.
function nearLift(){for(const lift of world.lifts){const reach=(world.scales.get(lift.buildingId)??1)*1.9+.35;for(const stop of lift.stops)if(Math.abs(stop.position.y-physics.position.y)<.6&&Math.hypot(stop.position.x-physics.position.x,stop.position.z-physics.position.z)<reach)return {lift,stop};}return undefined;}
function nearestDoor(){let door:WorldDoor|undefined,dist=2.15;for(const d of world.doors){const dd=d.position.distanceTo(physics.position);if(dd<dist){door=d;dist=dd;}}return door;}
let wrongDoor=0;
function doors(direction:T.Vector3){
 for(const d of world.doors as WorldDoor[]){
  if(Math.abs(d.position.y-physics.position.y)>2.3||d.position.distanceToSquared(physics.position)>13)continue;
  if(d.open<.7&&d.target===0&&d.position.distanceTo(physics.position)<1.5&&wouldEnterDoor(d,physics.position,direction,DT,SPEED)){
   const lift=nearLift(),lp=lift?.stop.position,toLift=lp?Math.hypot(lp.x-physics.position.x,lp.z-physics.position.z):Infinity,nd=nearestDoor();
   if(lift&&(toLift<(world.scales.get(lift.lift.buildingId)??1)+.2||!nd||toLift<nd.position.distanceTo(physics.position)))throw new Error(`E would open the lift panel instead of ${d.id}`);
   const chosen=nd;ePresses++;
   if(chosen!==d){wrongDoor++;if(chosen)chosen.target=chosen.target?0:1;}else d.target=1;
  }
 }
 // Runtime animation and the same per-substep door blocking as the runtime (physics.constrain).
 animateDoors(world.doors,physics.position,DT);
}
/** Steer along a navmesh path with real physics; optionally forbid leaving a storey. */
function walk(goal:T.Vector3,opts:{tolerance?:number;keepY?:number;maxLength?:number}={}):string|undefined{
 const path=navigation.findPath(physics.position,goal);if(!path.length)return 'no path';
 if(opts.maxLength){let L=0;for(let i=1;i<path.length;i++)L+=Math.hypot(path[i].x-path[i-1].x,path[i].z-path[i-1].z);if(L>opts.maxLength)return `path detours ${L.toFixed(1)}m > ${opts.maxLength.toFixed(1)}m`;}
 let index=0;const progress=physics.position.clone(),tol=opts.tolerance??.34;
 for(let tick=0;tick<24000;tick++){
  let target=path[index];
  while(index<path.length-1&&Math.hypot(target.x-physics.position.x,target.z-physics.position.z)<.34&&Math.abs(target.y-physics.position.y)<.7)target=path[++index];
  const direction=target.clone().sub(physics.position);direction.y=0;
  if(index===path.length-1&&direction.length()<tol&&Math.abs(target.y-physics.position.y)<.45)
   return Math.hypot(physics.position.x-goal.x,physics.position.z-goal.z)<.5&&Math.abs(physics.position.y-goal.y)<.45?undefined:`stopped short at ${physics.position.toArray().map(v=>v.toFixed(2))}`;
  if(direction.lengthSq()>0)direction.normalize();doors(direction);
  physics.step(direction,DT,false,SPEED);
  if(opts.keepY!==undefined&&physics.onGround&&Math.abs(physics.position.y-opts.keepY)>.45)return `left storey: y=${physics.position.y.toFixed(2)}`;
  if(tick>0&&tick%150===0){if(physics.position.distanceTo(progress)<.1)return `stalled at ${physics.position.toArray().map(v=>v.toFixed(2))}`;progress.copy(physics.position);}
  if(physics.position.y<-12)return 'fell';
 }
 return 'step budget exhausted';
}
const dest=(id:string)=>world.destinations.find(d=>d.id===id)!;
const v=(p:[number,number,number])=>new T.Vector3(...p);
function apronWorld(bid:string,core:StairCore,storey:number){
 const ux=Math.cos(core.angle),uz=Math.sin(core.angle),d=core.length/2+core.apron/2;
 return new T.Vector3(core.center[0]-ux*d,floorY(storey),core.center[1]-uz*d).applyMatrix4(world.frames.get(bid)!);
}

it('walks from outdoors to every one of the 60 floor entrances and back down from every roof',()=>{
 const results:Record<string,string>={};const failures:string[]=[];
 for(const f of world.floors){
  const id=f.data.id+'-entrance';if(!start(world.spawn)){failures.push(id+': spawn not grounded');continue;}
  const error=walk(v(dest(id).position));results[id]=error??'ok';if(error)failures.push(`${id}: ${error}`);
 }
 for(const bid of WALK_BUILDING_IDS){
  const top=world.floors.filter(f=>f.buildingId===bid).sort((a,b)=>b.y-a.y)[0],id=top.data.id+'-entrance';
  start(v(dest(id).position));const error=walk(world.spawn.clone());results['down:'+id]=error??'ok';if(error)failures.push(`down ${id}: ${error}`);
 }
 report.entrances=results;expect(failures).toEqual([]);
},1800000);

it('climbs and descends every stair flight of every stair core',()=>{
 const results:Record<string,string>={};const failures:string[]=[];
 for(const bid of WALK_BUILDING_IDS)for(const core of structure.stairCores[bid]??[]){
  const levels=[...core.levels].sort((a,b)=>a.storey-b.storey),s=structure.placements[bid].scale;
  for(let i=1;i<levels.length;i++){
   const lo=apronWorld(bid,core,levels[i-1].storey),hi=apronWorld(bid,core,levels[i].storey),key=`${core.id}:${levels[i-1].floorId}->${levels[i].floorId}`;
   const max=(core.length*2+core.apron*2)*s+6;
   let error=start(lo)?walk(hi,{maxLength:max}):'landing not grounded';
   if(!error)error=walk(lo,{maxLength:max})?.replace(/^/,'down: ');
   results[key]=error??'ok';if(error)failures.push(`${key}: ${error}`);
  }
 }
 report.stairs=results;expect(failures).toEqual([]);
},1800000);

it('crosses between joined buildings on every shared storey without changing level',()=>{
 const results:Record<string,string>={};const failures:string[]=[];
 for(const c of structure.connectors){
  const [fa,fb]=c.floors,a=dest(fa+'-entrance'),b=dest(fb+'-entrance');
  // Use points on the walkway itself so the crossing cannot use stairs.
  const ya=floorY(c.storey),mid=new T.Vector3((c.a[0]+c.b[0])/2,ya,(c.a[1]+c.b[1])/2);
  for(const [from,to,label] of [[a,mid,'A->walkway->B'],[b,mid,'B->walkway->A']] as const){
   const key=`${c.id} ${label}`;let error=start(v(from.position))?walk(to,{keepY:ya}):'not grounded';
   const far=label.startsWith('A')?b:a;if(!error)error=walk(v(far.position),{keepY:ya});
   results[key]=error??'ok';if(error)failures.push(`${key}: ${error}`);
  }
 }
 report.joins=results;expect(failures).toEqual([]);
},1800000);

it('walks straight along every join walkway centreline without navmesh steering',()=>{
 const results:Record<string,string>={};const failures:string[]=[];
 for(const c of structure.connectors){
  const y=floorY(c.storey),dx=c.b[0]-c.a[0],dz=c.b[1]-c.a[1],L=Math.hypot(dx,dz),ux=dx/L,uz=dz/L;
  if(L<.6){results[`${c.id}`]='ok';continue;} // galleries overlap: covered by the storey-locked crossing test
  const A=new T.Vector3(c.a[0]+ux*.25,y,c.a[1]+uz*.25),B=new T.Vector3(c.b[0]-ux*.25,y,c.b[1]-uz*.25);
  for(const [p,q,label] of [[A,B,'a->b'],[B,A,'b->a']] as const){
   let error=start(p)?undefined:'start not grounded';
   for(let tick=0;!error&&tick<1200;tick++){const dir=q.clone().sub(physics.position);dir.y=0;if(dir.length()<.35)break;dir.normalize();doors(dir);physics.step(dir,DT,false,SPEED);
    if(physics.onGround&&Math.abs(physics.position.y-y)>.45)error=`left storey y=${physics.position.y.toFixed(2)}`;if(tick>0&&tick%60===0&&physics.position.distanceTo(p)<.1*tick/60)error=`blocked at ${physics.position.toArray().map(v=>v.toFixed(2))}`;if(tick===1199)error='did not arrive';}
   results[`${c.id} ${label}`]=error??'ok';if(error)failures.push(`${c.id} ${label}: ${error}`);
  }
 }
 report.centreline=results;expect(failures).toEqual([]);
},600000);

it('enters every room on every floor through closed doors (E only at the door)',()=>{
 const results:Record<string,string>={};const failures:string[]=[];
 for(const f of world.floors){
  const picks=world.destinations.filter(d=>d.floorId===f.data.id&&d.roomId);if(!picks.length)continue;
  if(!start(v(dest(f.data.id+'-entrance').position))){failures.push(f.data.id+': entrance not grounded');continue;}
  for(const d of picks){
   const portal=f.data.access?.portals.find(p=>p.id===d.doorId),core=portal?.clearancePositions?.[d.roomId!];
   let error=walk(v(d.position));
   if(!error&&core)error=walk(new T.Vector3(core[0],f.y,core[1]).applyMatrix4(world.frames.get(d.buildingId)!),{tolerance:.2});
   if(!error&&core)error=walk(v(d.position))?.replace(/^/,'exit: ');
   results[d.roomId!]=error??'ok';if(error)failures.push(`${d.roomId}: ${error}`);
  }
 }
 report.rooms=results;expect(failures).toEqual([]);expect(wrongDoor).toBe(0);
},7200000);

it('rides every lift: walk into the car, E selects a floor, walk out to that storey',()=>{
 const failures:string[]=[];let rides=0;
 for(const lift of world.lifts)for(let i=0;i<lift.stops.length;i++){
  const from=lift.stops[i],to=lift.stops[(i+1)%lift.stops.length],key=`${lift.id} ${from.floorId}->${to.floorId}`;
  const spec=structure.lifts[lift.buildingId].find(l=>l.id===lift.id)!,ux=Math.cos(spec.angle),uz=Math.sin(spec.angle),d=spec.size/2+.8;
  const doorway=new T.Vector3(spec.center[0]-ux*d,from.position.y,spec.center[1]-uz*d).applyMatrix4(world.frames.get(lift.buildingId)!);doorway.y=from.position.y;
  let error=start(v(dest(from.floorId+'-entrance').position))?walk(doorway,{tolerance:.3}):'entrance not grounded';
  const liftChosen=()=>{const nd=nearestDoor(),lp=from.position,toLift=Math.hypot(lp.x-physics.position.x,lp.z-physics.position.z);return nearLift()?.stop===from&&(!nd||toLift<(world.scales.get(lift.buildingId)??1)+.2||toLift<nd.position.distanceTo(physics.position));};
  // A neighbouring room door may win at the doorway; a player then steps into the car and presses E again.
  if(!error&&!liftChosen()){error=walk(from.position.clone(),{tolerance:.3});if(!error&&!liftChosen())error='E inside the car does not select this stop';}
  if(!error){physics.teleport(to.position.clone().add(new T.Vector3(0,.15,0)));error=settle()?undefined:'arrival not grounded';}
  if(!error)error=walk(v(dest(to.floorId+'-entrance').position),{keepY:to.position.y});
  rides++;if(error)failures.push(`${key}: ${error}`);
 }
 report.lifts={rides,failures};expect(failures).toEqual([]);
},900000);
