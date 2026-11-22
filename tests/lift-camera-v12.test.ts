import {beforeAll,expect,it} from 'vitest';
import * as T from 'three';
import {buildRuntimeWorld} from './world-fixture';
import {LiftPassenger,setLiftCamera,syncLift} from '../src/walk/lift-world';
import type {WalkWorld} from '../src/walk-world';

let world:WalkWorld;
beforeAll(()=>{world=buildRuntimeWorld().world;},30000);
for(const building of ['SC','EV','BI'])it(`${building}: travelling camera faces the door, stays inside the roofed cabin and releases on opening`,()=>{
 const lift=world.lifts.find(l=>l.buildingId===building)!;
 const passenger=new LiftPassenger(),foot=lift.car.localToWorld(new T.Vector3(.1,0,.1));
 const camera=new T.PerspectiveCamera(58,16/9,.075,1100);
 // Entry heading and pitch must have no influence on the carried camera.
 camera.rotation.set(-.75,2.1,0);
 lift.runtime.select(lift.stops[1].floorId);
 let moving=0,opening=0,attached=false;
 for(let frame=0;frame<1200;frame++){
  passenger.update(world,foot);lift.runtime.update(1/30,{doorway:false});syncLift(lift);
  const carried=passenger.update(world,foot);if(carried)foot.copy(carried);
  if(passenger.carried){
   attached=true;passenger.updateCamera(camera);
   const local=lift.car.worldToLocal(camera.position.clone()),[w,d]=lift.geometry.cabinSize;
   expect(Math.abs(local.x)).toBeLessThan(w/2-.1);expect(Math.abs(local.z)).toBeLessThan(d/2-.1);expect(local.y).toBeCloseTo(1.55);
   if(lift.runtime.snapshot.phase==='moving'){
    moving++;
    const ray=new T.Raycaster(camera.position,camera.getWorldDirection(new T.Vector3()));
    expect(ray.intersectObject(lift.car,true)[0]?.object.name).toMatch(/:car-door:/);
   }
   if(lift.runtime.snapshot.phase==='opening')opening++;
  }
  if(attached&&!passenger.carried)break;
 }
 expect(moving).toBeGreaterThan(0);expect(opening).toBeGreaterThan(0);
 expect(lift.runtime.snapshot.phase).toBe('open');expect(passenger.carried).toBe(false);
 camera.position.set(100,200,300);passenger.updateCamera(camera);
 expect(camera.position.toArray()).toEqual([100,200,300]); // Normal rig owns the released camera.

 // Closed car: every sampled view ray hits the cabin, never the sky or an outer shaft wall.
 lift.runtime.select(lift.stops[0].floorId);
 for(let frame=0;frame<600&&lift.runtime.snapshot.phase!=='moving';frame++)lift.runtime.update(1/30,{doorway:false});
 syncLift(lift);
 for(const aspect of [16/9,412/915,915/412]){
  camera.aspect=aspect;camera.updateProjectionMatrix();setLiftCamera(lift,camera);
  const display=lift.car.getObjectByName(`Cabin floor display ${lift.id}`)!,bars:T.Mesh[]=[];
  display.traverse(o=>{if(o instanceof T.Mesh&&o.visible)bars.push(o);});expect(bars.length).toBeGreaterThan(0);
  for(const bar of bars){
   const point=bar.getWorldPosition(new T.Vector3()),screen=point.clone().project(camera);
   expect(Math.abs(screen.x)).toBeLessThan(1);expect(Math.abs(screen.y)).toBeLessThan(1);
   const sight=new T.Raycaster(camera.position,point.sub(camera.position).normalize());
   expect(sight.intersectObject(lift.car,true)[0]?.object).toBe(bar);
  }
  for(const x of [-1,-.5,0,.5,1])for(const y of [-1,-.5,0,.5,1]){
   const near=new T.Vector3(x,y,-1).unproject(camera),local=lift.car.worldToLocal(near.clone()),[w,d]=lift.geometry.cabinSize;
   expect(Math.abs(local.x)).toBeLessThan(w/2-.04);expect(Math.abs(local.z)).toBeLessThan(d/2-.04);
   expect(local.y).toBeGreaterThan(0);expect(local.y).toBeLessThan(2.5);
   const ray=new T.Raycaster();ray.setFromCamera(new T.Vector2(x,y),camera);
   expect(ray.intersectObject(lift.car,true).length,`${building} ${aspect} ray ${x},${y}`).toBeGreaterThan(0);
  }
  const up=new T.Raycaster(camera.position,new T.Vector3(0,1,0));
  expect(up.intersectObject(lift.car,true)[0]?.object.name).toBe(`${lift.id}:ceiling`);
 }
});
