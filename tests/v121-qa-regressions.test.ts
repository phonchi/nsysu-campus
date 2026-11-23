import {expect,it} from 'vitest';
import fs from 'node:fs';
import {Vector3} from 'three';
import {loadTerrain} from './terrain-fixture';
import {landmarkCarves} from '../src/world/landmarks';
import {SwimRuntime} from '../src/walk/swim';
import {TimedSports} from '../src/walk/sports-activity';
import {clear,water} from './v121-fixtures';
import {evaluateSea} from '../src/walk/water-policy';
import {prepareV12Terrain} from '../src/world/v12-surfaces';
import {buildRuntimeWorld} from './world-fixture';
import {parseV12,loadV12Data} from '../src/walk/v12-data';
import type {SeaData,SportsData} from '../src/world/v12-types';
const read=(p:string)=>JSON.parse(fs.readFileSync('public/'+p,'utf8'));
const sea=parseV12('sea',read('data/sea.json')) as SeaData;
const sports=parseV12('sports',read('data/sports.json')) as SportsData;
const allowed=evaluateSea('swim',clear);
let cached:ReturnType<typeof buildRuntimeWorld>;const world=()=>cached??=buildRuntimeWorld();
it('BUG-A actual v12 runtime pool cuts match the shipped navmesh version',async()=>{
 const t=loadTerrain();t.carves=landmarkCarves(read('models/landmarks/placements.json'),(x,z)=>t.heightAt(x,z));
 const data=await loadV12Data(x=>x,(async url=>new Response(JSON.stringify(read(String(url))))) as typeof fetch);expect(data.issues).toEqual([]);prepareV12Terrain(t,data);
 const baked=world();expect(baked.world.collision.userData.surfaceVersion).toBe(t.surfaceVersion);
 expect(t.surfaceVersion).toBe(read('data/walkthrough/navmesh-meta.json').surfaceVersion);
});
it('OBS-1 rescue immediately reduces distance to the nearest shore and stays latched',()=>{
 const w=sea.waterBodies[0],s=new SwimRuntime();s.adoptForRescue(w,[-331,w.surfaceY,116]);const before=s.position.clone();
 s.update(.1,new Vector3(),allowed);expect(s.position.x).toBeGreaterThan(before.x);expect(s.phase).toBe('rescue');
 s.adoptForRescue(w,[-380,w.surfaceY,170]);expect(s.position.distanceTo(before)).toBeLessThan(1);
});
it('OBS-3 the generated main-pool entrance can arm the actual course',()=>{
 const w=sea.waterBodies.find(w=>w.id==='pool-main')!,s=new SwimRuntime(),timer=new TimedSports();expect(s.enter(w,w.entryPoints[0],allowed)).toBe(true);
 expect(timer.start(sports.courses.find(c=>c.mode==='swim')!,s.position.toArray())).toBe(true);
});
it('OBS-3 holding a safe pool edge for one second climbs out without a rescue whistle',()=>{
 let whistles=0;const s=new SwimRuntime(()=>whistles++),w={...structuredClone(water),kind:'pool' as const};s.enter(w,w.entryPoints[0],allowed);s.position.set(.05,0,10);
 expect(s.update(.1,new Vector3(-1,0,0),allowed)).toBeUndefined();let exit;for(let i=0;i<12&&!exit;i++)exit=s.update(.1,new Vector3(-1,0,0),allowed);expect(exit).toBeDefined();expect(s.phase).toBe('dry');expect(whistles).toBe(0);
});

import {RapierController,initPhysics} from '../src/walk/controller';
import {busGroundPose,supportedStopPoint,outsideBus} from '../src/walk/bus';
import {planProps} from '../src/world/props';
import {inside} from '../src/walk/v12-geometry';
import {SailingShow} from '../src/world/sailing-show';
import {Group,Object3D,PerspectiveCamera} from 'three';
import type {BusData} from '../src/walk/bus-types';
it('BUG-B actual forecourt collision supports both alighting positions outside the bus',async()=>{
 await initPhysics();const w=world(),p=new RapierController(w.world.collision),data=parseV12('bus',read('data/bus-routes.json')) as BusData;
 const r=data.routes[0],stop=data.stops.find(s=>s.id==='liberal-arts')!;
 const b={position:new Vector3(...stop.berth.position),yaw:stop.berth.yaw+Math.PI,route:r};
 const resolve=(q:[number,number,number])=>supportedStopPoint([q[0],w.terrain.heightAt(q[0],q[2]),q[2]],(x,z,y)=>p.supportAt(x,z,y));
 for(const q of [stop.boardingPoint,...stop.alightingPoints]){const at=resolve(q)!;expect(at).toBeDefined();expect(p.canStand(new Vector3(...at)),JSON.stringify(at)).toBe(true);expect(outsideBus(b,at)).toBe(true);}
 p.dispose();
},20000);
it('OBS-1 actual sea rescue lands on runtime support and never returns to swim',async()=>{
 await initPhysics();const w=world(),p=new RapierController(w.world.collision),water=sea.waterBodies[0];
 const swim=new SwimRuntime(()=>{},q=>p.canStand(new Vector3(...q)),q=>supportedStopPoint(q,(x,z,y)=>p.supportAt(x,z,y)));
 swim.adoptForRescue(water,[-331,water.surfaceY,116]);let landing;for(let i=0;i<100&&swim.phase!=='dry';i++){landing=swim.update(.1,new Vector3(),allowed);expect(swim.phase).not.toBe('swim');}
 expect(landing).toBeDefined();expect(p.canStand(new Vector3(...landing!))).toBe(true);p.dispose();
},20000);
it('OBS-4 front/rear and cross-slope contacts keep the rigid bus above the ground',()=>{
 for(const yaw of [0,.6,1.57,2.8]){const at=new Vector3(3,0,5),height=(x:number,z:number)=>.2*x+.3*z,pose=busGroundPose(at,yaw,9.5,2.5,height);
  for(const z of [-4.75,0,4.75])for(const x of [-1.25,1.25])expect(pose.y+Math.tan(pose.pitch)*z).toBeGreaterThanOrEqual(height(at.x+Math.sin(yaw)*z+Math.cos(yaw)*x,at.z+Math.cos(yaw)*z-Math.sin(yaw)*x));}
});
it('OBS-6 tetrapods stay in the authored revetment and out of swimming/craft corridors',()=>{
 const t=world().terrain,zones=sea.hazards!.map(h=>h.polygon),props=planProps({zone:id=>id==='seawall'?{x:-316,z:296,r:10}:undefined,open:()=>true,pathDistance:()=>100,ground:()=>t.seaLevel-1,seaLevel:t.seaLevel,keepClear:[],tetrapodZones:zones});
 const pods=props.filter(p=>p.kind==='tetrapod');expect(pods.length).toBeGreaterThan(0);for(const p of pods){expect(zones.some(z=>inside([p.x,p.z],z))).toBe(true);for(const poly of [...sea.waterBodies.map(w=>w.polygon),...sea.routes.map(r=>r.corridor)])expect(inside([p.x,p.z],poly)).toBe(false);}
});
it('sailing has eight labelled boats within 260 m of the clear viewing point',()=>{
 const show=new SailingShow(sea.sailingShow!,new Group(),()=>new Object3D()),view=new Vector3(...sea.viewingPoint!),camera=new PerspectiveCamera(60,16/9,.1,600);camera.position.copy(view).y+=1.6;camera.lookAt(-493,3,235);camera.updateMatrixWorld(true);
 for(let i=0;i<120;i++){show.update(1);for(const boat of show.group.children){expect(boat.position.distanceTo(view)).toBeLessThan(260);expect(['中山','日本隊']).toContain(boat.userData.teamLabel);expect(boat.getObjectByName('team-label')).toBeDefined();const screen=boat.position.clone().add(new Vector3(0,3,0)).project(camera);expect(Math.abs(screen.x)).toBeLessThan(1);expect(Math.abs(screen.y)).toBeLessThan(1);expect(screen.z).toBeLessThan(1);}}
 expect(show.group.children).toHaveLength(8);show.dispose();
 const npc=read('data/npcs.json').npcs.find((n:{id:string})=>n.id==='sail-student');for(const schedule of Object.values(npc.schedule) as {offset:number[];at:string}[]){if(schedule)expect(Math.hypot(...schedule.offset)).toBeGreaterThan(5);}
});
it('OBS-1 autonomous rescue travels at 2.5 m per real second even on slow frames',()=>{
 const w=sea.waterBodies[0],s=new SwimRuntime();s.adoptForRescue(w,[-380,w.surfaceY,160]);const before=s.position.clone();s.update(2,new Vector3(),allowed);expect(s.position.distanceTo(before)).toBeCloseTo(5);expect(s.phase).toBe('rescue');
});
it('OBS-3 the generated pool course completes in order from the aligned entrance',()=>{
 const w=sea.waterBodies.find(w=>w.id==='pool-main')!,c=sports.courses.find(c=>c.mode==='swim')!,s=new SwimRuntime(),timer=new TimedSports();s.enter(w,w.entryPoints[0],allowed);expect(timer.start(c,s.position.toArray())).toBe(true);
 let returning=false;for(let i=0;i<1000&&timer.course;i++){returning ||= timer.next>=2;s.update(.1,new Vector3(returning?1:-1,0,0),allowed);timer.update(.1,s.position.toArray(),{kind:'swim',waterId:w.id});}
 expect(timer.result?.valid).toBe(true);expect(timer.result!.seconds).toBeGreaterThan(50);expect(s.phase).toBe('swim');
});
it('OBS-3 real pool coping supports exits on all four edges',async()=>{
 await initPhysics();const built=world(),p=new RapierController(built.world.collision),w=sea.waterBodies.find(w=>w.id==='pool-main')!;
 const xs=w.polygon.map(v=>v[0]),zs=w.polygon.map(v=>v[1]),x0=Math.min(...xs),x1=Math.max(...xs),z0=Math.min(...zs),z1=Math.max(...zs);
 for(const [x,z,dx,dz] of [[x0+.05,(z0+z1)/2,-1,0],[x1-.05,(z0+z1)/2,1,0],[(x0+x1)/2,z0+.05,0,-1],[(x0+x1)/2,z1-.05,0,1]]){
  const s=new SwimRuntime(()=>{},q=>p.canStand(new Vector3(...q)),q=>supportedStopPoint(q,(x,z,y)=>p.supportAt(x,z,y)));expect(s.enter(w,w.entryPoints[0],allowed)).toBe(true);s.position.set(x,w.surfaceY,z);expect(s.update(.1,new Vector3(dx,0,dz),allowed)).toBeUndefined();let at;for(let i=0;i<12&&!at;i++)at=s.update(.1,new Vector3(dx,0,dz),allowed);expect(at).toBeDefined();expect(s.phase).toBe('dry');expect(p.canStand(new Vector3(...at!))).toBe(true);
 }p.dispose();
},20000);
