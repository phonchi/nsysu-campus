import {afterEach,expect,it,vi} from 'vitest';
import * as T from 'three';
import {supportedStopPoint,outsideBus} from '../src/walk/bus';
import {SwimRuntime} from '../src/walk/swim';
import {WatercraftRuntime} from '../src/walk/watercraft';
import {FitnessRuntime,TimedSports} from '../src/walk/sports-activity';
import {V12Runtime} from '../src/walk/v12-runtime';
import {parseV12,loadV12Data} from '../src/walk/v12-data';
import {buildSportsField} from '../src/world/sports-field';
import {Avatar} from '../src/walk/avatar';
import {evaluateSea} from '../src/walk/water-policy';
import type {RapierController} from '../src/walk/controller';
import type {V12Data} from '../src/walk/v12-data';
import {bus,stops,water,craft,course,clear} from './v121-fixtures';
const clone=<T>(x:T):T=>structuredClone(x);
const dryWater=()=>({...clone(water),entryPoints:[[-.5,.15,1] as [number,number,number]],exitPoints:[[-.5,.15,1] as [number,number,number]]});
const allow=evaluateSea('swim',clear);
afterEach(()=>vi.unstubAllGlobals());
function adapter(data:V12Data,canStand=()=>true,params=''){
 const element=()=>Object.assign(new EventTarget(),{className:'',hidden:false,dataset:{},textContent:'',setAttribute(){},append(){},remove(){},querySelector(){return null;}});
 vi.stubGlobal('document',Object.assign(new EventTarget(),{createElement:element}));
 const avatar=new Avatar(),position=new T.Vector3(-.5,.15,1),physics={position,canStand,carry:(p:T.Vector3)=>position.copy(p),supportAt:(_x:number,_z:number,y:number)=>y} as unknown as RapierController,say=vi.fn();
 const r=new V12Runtime({host:element() as unknown as HTMLElement,scene:new T.Scene(),data,physics,avatar,asset:x=>x,say,cue:()=>{},modeChanged:()=>{},params:new URLSearchParams(params)});return {r,physics,say,avatar};
}
it('M1 rejects a boarding point inside the swept lane instead of silently stranding a waiting pedestrian',async()=>{
 const s=clone(stops);s[1].boardingPoint=[100,0,.5];
 const raw={stops:s,routes:[clone(bus),{...clone(bus),id:'orange-1-ext',vehicleId:'bus2'}]};
 const data=await loadV12Data(x=>x,(async url=>String(url).endsWith('bus-routes.json')?new Response(JSON.stringify(raw)):new Response('',{status:404})) as typeof fetch);
 expect(data.bus).toBeUndefined();expect(data.issues.join(' ')).toMatch(/上車|boarding/);
});
it('M2 blocked return points enter an announced rescue and retry clearance without releasing into an NPC',()=>{
 let free=true,whistles=0;const w=dryWater(),s=new SwimRuntime(()=>whistles++,()=>free);expect(s.enter(w,w.entryPoints[0],allow)).toBe(true);s.position.set(10,0,10);free=false;s.stamina=0;s.update(.1,new T.Vector3(),allow);expect(s.phase).toBe('rescue');expect(whistles).toBe(1);
 for(let i=0;i<300;i++)s.update(.1,new T.Vector3(),allow);expect(s.phase).toBe('rescue');free=true;let end;for(let i=0;i<300&&s.phase!=='dry';i++)end=s.update(.1,new T.Vector3(),allow);expect(end).toEqual(w.safeReturnPoints[0]);expect(whistles).toBe(1);
 const c=new SwimRuntime(()=>whistles++,()=>false);c.adoptForRescue(w,[15,0,15]);expect(c.phase).toBe('rescue');expect(whistles).toBe(2);
});
it('M3 UI and exit use the same shore-edge reach and reject wet or remote landing data',()=>{
 const w=dryWater(),a=adapter({sea:{waterBodies:[w],routes:[]},issues:[]});a.r.swim.enter(w,w.entryPoints[0],allow);a.r.swim.position.set(2.7,0,1);a.physics.position.copy(a.r.swim.foot);expect(a.r.actions(a.physics.position).some(x=>x.id==='v12:exit-water')).toBe(false);
 a.r.swim.position.set(2.3,0,1);a.physics.position.copy(a.r.swim.foot);expect(a.r.actions(a.physics.position).filter(x=>x.id==='v12:exit-water'),'exactly one shore action').toHaveLength(1);const exit=a.r.actions(a.physics.position).find(x=>x.id==='v12:exit-water');expect(exit).toBeDefined();exit!.run();expect(a.r.swim.phase).toBe('dry');
 for(const p of [[1,0,1],[-.1,0,1],[-30,0,1]] as [number,number,number][])expect(()=>parseV12('sea',{waterBodies:[{...w,exitPoints:[p]}],routes:[]})).toThrow();a.r.dispose();a.avatar.dispose();
});
it('M5 equipment exit falls back to approach/spawn and Esc remains usable if all are occupied',()=>{
 const portal={id:'f',exteriorTrigger:[0,0,0] as [number,number,number],exteriorReturnPoints:[[1,0,0]] as [number,number,number][],interiorSceneId:'i',interiorSpawn:[10,0,10] as [number,number,number]},e={id:'bike',kind:'stationary-bike' as const,position:[10,0,11] as [number,number,number],yaw:0,approach:[10,0,12] as [number,number,number],exitPoints:[[0,0,0]] as [number,number,number][]};
 const f=new FitnessRuntime(p=>p[0]===10);f.enter(portal,[0,0,0]);f.use(e,e.approach);expect(f.stop()).toEqual(e.approach);
 const a=adapter({issues:[]},()=>false);a.r.fitness.portal=portal;a.r.fitness.equipment=e;expect(a.r.key('escape')).toBe(false);expect(a.say).toHaveBeenCalled();a.r.dispose();a.avatar.dispose();
});
it('M6 malformed optional facility attributes cannot crash rendering or the legacy scene',()=>{
 const base={id:'field',kind:'baseball',polygon:[[0,0],[5,0],[5,5],[0,5]]};
 for(const bad of [{...base,kind:undefined},{...base,id:3},{...base,courts:'bad'},{...base,inner:{}},{...base,diamond:{home:[1,1]}},{...base,track:{kerbInnerRadius:NaN}}]){
  expect(()=>parseV12('sports',{facilities:[bad]})).toThrow();expect(()=>buildSportsField({facilities:[bad],courses:[],portals:[],equipment:[]} as never,[],undefined,()=>0)).not.toThrow();}
});
it('L2 long foreground stalls do not create one giant swim or lateral paddle displacement',()=>{
 const w=dryWater(),s=new SwimRuntime();s.enter(w,w.entryPoints[0],allow);s.position.set(10,0,10);const start=s.position.clone();s.update(5,new T.Vector3(1,0,0),allow);expect(s.position.distanceTo(start)).toBeLessThanOrEqual(.42);expect(s.phase).toBe('swim');
 const c=new WatercraftRuntime();c.rent(craft,w,craft.launchPoint,allow);c.position.set(10,0,2);const before=c.position.clone();c.update(5,new T.Vector3(1,0,0),allow);expect(c.position.distanceTo(before)).toBeLessThan(1);
});
it('L3 start rejects outside-corridor and forward-side positions without starting a doomed attempt',()=>{
 const t=new TimedSports();expect(t.start(course,[-1,0,3])).toBe(false);expect(t.start(course,[1,0,0])).toBe(false);expect(t.course).toBeUndefined();expect(t.start(course,[-1,0,0])).toBe(true);
});
it('L4 pools close at night but qaSea=closed does not close a daytime pool',()=>{
 const w={...dryWater(),kind:'pool' as const},a=adapter({sea:{waterBodies:[w],routes:[]},issues:[]},()=>true,'qa=1&qaSea=closed');a.r.policy.update('night');a.r.actions(a.physics.position).find(x=>x.id==='v12:sea')!.run();expect(a.r.swim.phase).toBe('dry');
 a.r.policy.update('day');a.r.actions(a.physics.position).find(x=>x.id==='v12:sea')!.run();expect(a.r.swim.phase).toBe('swim');a.r.update(.1,new T.Vector3(),[],'night',{kind:'walk'});expect(a.r.swim.phase).toBe('rescue');a.r.dispose();a.avatar.dispose();
});

it('M4 resolves support above the DEM for boarding/alighting and never selects the bus roof',()=>{
 const support=vi.fn((_x:number,_z:number,y:number)=>y>3?3.1:1.2),ground=()=>0;
 for(const q of [stops[0].boardingPoint,...stops[0].alightingPoints]){
  const at=supportedStopPoint([q[0],100,q[2]],support,ground);
  expect(at).toEqual([q[0],1.2,q[2]]);
 }
 expect(support.mock.calls.every(([, ,y])=>y===0)).toBe(true);
 const pose={position:new T.Vector3(...stops[0].berth.position),yaw:stops[0].berth.yaw+Math.PI,route:bus};
 expect(outsideBus(pose,[0,3.1,0])).toBe(false);
});

import fs from 'node:fs';
import type {SeaData,SportsData} from '../src/world/v12-types';
const shippedSea=()=>parseV12('sea',JSON.parse(fs.readFileSync('public/data/sea.json','utf8'))) as SeaData;
it('OBS-2 rents at the generated rental desk, not the centre of the sea-centre building',()=>{
 const sea=shippedSea(),a=adapter({sea,issues:[]},()=>true,'qa=1&qaWave=.8'),desk=sea.center!.rentalDesk!;
 expect(a.r.actions(new T.Vector3(...desk)).filter(a=>a.id.startsWith('v12:rent-'))).toHaveLength(2);
 expect(a.r.actions(new T.Vector3(...sea.center!.position)).some(a=>a.id.startsWith('v12:rent-'))).toBe(false);a.r.dispose();a.avatar.dispose();
});
it('OBS-7 low-frame-rate pool motion and stopwatch consume the same simulation interval',()=>{
 const sea=shippedSea(),sports=parseV12('sports',JSON.parse(fs.readFileSync('public/data/sports.json','utf8'))) as SportsData,a=adapter({sea,sports,issues:[]});
 const w=sea.waterBodies.find(w=>w.id==='pool-main')!,course=sports.courses.find(c=>c.mode==='swim')!;
 a.r.swim.enter(w,w.entryPoints[0],allow);a.physics.position.copy(a.r.swim.foot);expect(a.r.timer.start(course,a.r.swim.position.toArray())).toBe(true);
 const before=a.r.swim.position.clone();a.r.update(3,new T.Vector3(-1,0,0),[],'day',{kind:'walk'},false,.05);a.r.afterMovement(.05,{kind:'walk'});
 expect(a.r.swim.position.distanceTo(before)).toBeCloseTo(1.65*.05);expect(a.r.timer.elapsed).toBeCloseTo(.05);
 a.r.update(3,new T.Vector3(-1,0,0),[],'day',{kind:'walk'},true,.05);a.r.afterMovement(0,{kind:'walk'});expect(a.r.timer.elapsed).toBeCloseTo(.05);a.r.dispose();a.avatar.dispose();
});
