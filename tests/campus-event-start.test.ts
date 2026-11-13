import { expect,it,vi } from 'vitest';
import { Vector3 } from 'three';
import fs from 'node:fs';
import { init,importNavMesh } from 'recast-navigation';
import { buildRuntimeWorld } from './world-fixture';
import { RapierController,initPhysics } from '../src/walk/controller';
import { WalkNavigation } from '../src/walk-nav';
import { OutdoorRoutes } from '../src/walk/route';
import { planRoute,validateRoutes } from '../src/walk/autopilot';
import { loadRideAsset } from '../tools/ride-assets';
import { ObstacleField } from '../src/walk/obstacles';
import { connectNpcPathStart } from '../src/walk/interaction-events';
import { NpcManager,type StoryZones } from '../src/world/npc';

it('event planning, borrowing and the first frame keep the macaque within 0.5 m of its live position',async()=>{
 const {world,terrain}=buildRuntimeWorld();await initPhysics();await init();
 const physics=new RapierController(world.collision);
 const nav=new WalkNavigation(importNavMesh(new Uint8Array(fs.readFileSync('public/data/walkthrough/navmesh.bin'))).navMesh);
 const routes=new OutdoorRoutes(JSON.parse(fs.readFileSync('public/data/walkthrough/outdoor-graph.json','utf8')));
 const zones=JSON.parse(fs.readFileSync('public/data/story-zones.json','utf8')) as StoryZones;
 const manager=new NpcManager(zones,routes,terrain,x=>x);
 const asset=await loadRideAsset('public/models/characters/monkey.glb');
 vi.spyOn(manager as unknown as {source():Promise<typeof asset>},'source').mockResolvedValue(asset);
 try {
   validateRoutes(routes,(a,b,r)=>physics.sweep(a,b,r),(x,z)=>terrain.heightAt(x,z));
   manager.setCollision((id,a,b,r,h)=>physics.sweepActor(id,a,b,r,h),(x,z,y)=>physics.supportAt(x,z,y));
   const monkey=await manager['spawn']('m3-thief','monkey',86,56);monkey.monkey=true;manager['npcs'].set(monkey.id,monkey);
   const host=await manager['spawn']('monkey-volunteer-man','student-f',82,62);manager['npcs'].set(host.id,host);
   const player=new Vector3(72,terrain.heightAt(72,70),70);physics.teleport(player);
   physics.setActors(manager.bodies(player));
   const before=monkey.position.clone(),goal=manager.anchorPoint('macaque-path')!,field=new ObstacleField();
   const clear=(a:Vector3,b:Vector3)=>{
     const from=a.clone().add(new Vector3(0,.35,0)),end=b.clone().add(new Vector3(0,.35,0));
     return physics.sweepActor(monkey.id,from,end,.24,.65)>=from.distanceTo(end)-.02;
   };
   const planned=planRoute(before.clone(),goal.clone(),nav,routes,clear);
   const path=field.route(connectNpcPathStart(before,planned,clear),.24,clear,(x,z,y)=>physics.supportAt(x,z,y));
   expect(monkey.position.distanceTo(before),'planning must not change the live position').toBeLessThan(1e-8);
   expect(path.length).toBeGreaterThan(1);
   expect(path[0].distanceTo(before),'path must start at the live position').toBeLessThan(1e-8);
   const disconnected=[before.clone().add(new Vector3(.2,0,0)),goal];
   expect(manager.borrowPath(monkey.id,disconnected)).toBe(false);
   expect(manager.borrowPath(monkey.id,path)).toBe(true);
   expect(monkey.position.distanceTo(before),'borrowing must not change the live position').toBe(0);
   // Test the shipped frame caps too: normal play 65 ms, coordinator QA 250 ms.
   for(const dt of [1/30,.065,.25]) {
     for(let frame=0;frame<4;frame++) {
       const previous=monkey.position.clone();manager.update(dt,player);
       expect(monkey.position.distanceTo(previous),`borrowed frame ${frame}, dt=${dt}`).toBeLessThan(.5);
       if(dt===1/30 && frame===0)expect(monkey.position.distanceTo(before),'first borrowed frame displacement').toBeLessThan(.5);
       physics.setActors(manager.bodies(player));
     }
   }
   expect(monkey.position.distanceTo(before),'the test must exercise actual walking').toBeGreaterThan(.1);
 } finally {manager.dispose();nav.dispose();physics.dispose();vi.restoreAllMocks();}
},30000);

it('joins a small projected start by walking and rejects a disconnected or blocked first segment',()=>{
 const start=new Vector3(86,0,56),projected=new Vector3(86,.13,56),goal=new Vector3(79,0,66),raw=[projected,goal];
 const clear=vi.fn(()=>true),path=connectNpcPathStart(start,raw,clear);
 expect(clear).toHaveBeenCalledOnce();expect(path.map(p=>p.toArray())).toEqual([start.toArray(),projected.toArray(),goal.toArray()]);
 expect(path[0]).not.toBe(start);expect(path[1]).not.toBe(projected);
 expect(raw.map(p=>p.toArray())).toEqual([[86,.13,56],[79,0,66]]);
 expect(connectNpcPathStart(start,raw,()=>false)).toEqual([]);
 expect(connectNpcPathStart(start,[new Vector3(82,0,61.15),goal],clear)).toEqual([]);
 expect(connectNpcPathStart(start,[],clear)).toEqual([]);
 expect(connectNpcPathStart(start,[start,new Vector3(NaN,0,0)],clear)).toEqual([]);
});
