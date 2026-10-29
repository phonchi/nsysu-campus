import {beforeAll,describe,it,expect} from 'vitest';
import {Vector3} from 'three';
import {shoreConstraint,type ShoreSurface} from '../src/walk/shore-constraint';
import {initPhysics,RapierController} from '../src/walk/controller';
import {buildRuntimeWorld} from './world-fixture';
const coast={seaLevel:0,heightAt:(x:number)=>-x};
const noDeck=()=>undefined;
function move(p:Vector3,v:Vector3,h=.1,terrain:ShoreSurface=coast,support:(x:number,z:number,referenceY:number)=>number|undefined=noDeck){shoreConstraint(terrain,support)(p,v,h);p.addScaledVector(v,h);return p;}
describe('shoreline movement',()=>{
 it.each([3.6,7.2,9])('keeps walk/run/ride speed %s on the dry side',speed=>{
  const p=new Vector3(-1,1,0);for(let i=0;i<100;i++)move(p,new Vector3(speed,0,0),1/120);
  expect(coast.heightAt(p.x)-coast.seaLevel).toBeGreaterThan(.28);
 });
 it('slides along the shore instead of locking diagonal movement',()=>{
  const p=new Vector3(-.4,.4,0);for(let i=0;i<30;i++)move(p,new Vector3(2,0,2),1/60);
  expect(p.x).toBeLessThan(-.3);expect(p.z).toBeGreaterThan(.9);
 });
 it('also blocks an airborne player from crossing into the water',()=>{
  const p=new Vector3(-.4,1.5,0);move(p,new Vector3(9,0,0),.1);expect(p.x).toBeLessThan(-.3);
 });
 it('lets an existing wet player move uphill to shore',()=>{
  const p=new Vector3(1,-1,0);move(p,new Vector3(-2,0,0),.1);expect(p.x).toBeCloseTo(.8);
 });
 it('prevents an existing wet player moving into deeper water',()=>{
  const p=new Vector3(1,-1,0);move(p,new Vector3(2,0,0),.1);expect(p.x).toBeCloseTo(1);
 });
 it('allows an actual above-water bridge over submerged terrain',()=>{
  const p=new Vector3(0,1,0),v=new Vector3(2,0,0);const constraint=shoreConstraint({seaLevel:0,heightAt:()=>-4},()=>1);constraint(p,v,.1);expect(v.x).toBe(2);
 });
 it('does not classify a basement below sea level as an ocean when its DEM is dry',()=>{
  const p=new Vector3(0,-4,0),v=new Vector3(2,0,0);shoreConstraint({seaLevel:0,heightAt:()=>8},()=>-4)(p,v,.1);expect(v.x).toBe(2);
 });
 it('handles a diagonal coastline without deleting tangent travel',()=>{
  const terrain={seaLevel:0,heightAt:(x:number,z:number)=>-(x+z)/Math.SQRT2},p=new Vector3(-.3,2,-.3);
  move(p,new Vector3(4,0,1),.1,terrain);expect(terrain.heightAt(p.x,p.z)).toBeGreaterThan(.28);expect(p.x+p.z).toBeLessThan(-.4);expect(Math.abs(p.x-p.z)).toBeGreaterThan(.05);
 });
});
beforeAll(async()=>{await initPhysics();});
it.each([
 {name:'walk',speed:3.6,dir:new Vector3(-1,0,0),jump:false},
 {name:'run',speed:7.2,dir:new Vector3(-1,0,0),jump:false},
 {name:'ride speed',speed:9,dir:new Vector3(-1,0,0),jump:false},
 {name:'diagonal coast',speed:7.2,dir:new Vector3(-1,0,1).normalize(),jump:false},
 {name:'jump toward sea',speed:7.2,dir:new Vector3(-1,0,0),jump:true},
])('the actual public route stays above water during $name and after releasing input',({speed,dir,jump})=>{
 const {world,terrain}=buildRuntimeWorld(),p=new RapierController(world.collision);p.teleport(new Vector3(-90.1994,-.1635,569.48065));
 p.constrain=shoreConstraint(terrain,(x,z,y)=>p.supportAt(x,z,y));
 for(let i=0;i<20;i++)p.step(new Vector3(),1/60,false);
 if(speed===9)expect(p.setRiding(true,Math.PI/2),'rental-bike collider can mount at the actual start').toBe(true);
 for(let i=0;i<200;i++)p.step(dir,1/60,jump&&i%40===0,speed);
 expect(p.position.y,`body entered the sea at ${p.position.toArray()}`).toBeGreaterThan(terrain.seaLevel+.02);
 for(let i=0;i<600;i++){p.step(new Vector3(),1/60,false);expect(p.position.y,`gravity slid body into sea at ${p.position.toArray()}`).toBeGreaterThan(terrain.seaLevel+.02);}
 expect(p.onGround).toBe(true);p.dispose();
},30000);
it('can return to shore from the actual already-submerged public failure position',()=>{
 const {world,terrain}=buildRuntimeWorld(),p=new RapierController(world.collision);p.teleport(new Vector3(-97.405,-2.055,569.48065));
 p.constrain=shoreConstraint(terrain,(x,z,y)=>p.supportAt(x,z,y));
 for(let i=0;i<200;i++)p.step(new Vector3(1,0,0),1/60,false,3.6);
 expect(p.position.x).toBeGreaterThan(-94);expect(p.position.y).toBeGreaterThan(terrain.seaLevel+.02);p.dispose();
},30000);
