import { expect,it } from 'vitest';
import { Vector3 } from 'three';
import { buildRuntimeWorld } from './world-fixture';
import { RapierController,initPhysics } from '../src/walk/controller';
import { planRoute } from '../src/walk/autopilot';
import { moveNpcSafely } from '../src/world/npc';
import zones from '../public/data/story-zones.json';

it('the shipped macaque preparation and return destinations can be walked without teleporting',async()=>{
 const {world,terrain}=buildRuntimeWorld();await initPhysics();const physics=new RapierController(world.collision);
 try {
   const at=(x:number,z:number)=>new Vector3(x,terrain.heightAt(x,z),z);
   const start=at(86,56),path=at(...zones.zones['macaque-path'].p as [number,number]),slope=at(...zones.zones['macaque-slope'].p as [number,number]);
   const clear=(a:Vector3,b:Vector3)=>{const from=a.clone().add(new Vector3(0,.35,0)),to=b.clone().add(new Vector3(0,.35,0));return physics.sweepActor('m3-thief',from,to,.24,.65)>=from.distanceTo(to)-.02;};
   let foot=start;
   for(const goal of [path,slope]) {
     const route=planRoute(foot,goal,undefined,undefined,clear);expect(route.length,`route to ${goal.toArray()}`).toBeGreaterThan(0);
     let i=0;
     for(let tick=0;tick<1800 && i<route.length;tick++) {
       const next=route[i],delta=next.clone().sub(foot);delta.y=0;
       if(delta.length()<.4){i++;continue;}
       const desired=foot.clone().addScaledVector(delta.normalize(),1.6/30);
       const moved=moveNpcSafely('m3-thief',foot,desired,new Vector3(-100,0,-100),1/30,.24,.65,(x,z,y)=>physics.supportAt(x,z,y),(id,a,b,r,h)=>physics.sweepActor(id,a,b,r,h));
       expect(moved.distanceTo(foot)).toBeLessThan(.4);foot=moved;
     }
     expect(foot.distanceTo(goal),`arrival at ${goal.toArray()}`).toBeLessThan(.6);
   }
 } finally {physics.dispose();}
},30000);
