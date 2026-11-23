import {describe,expect,it,vi} from 'vitest';
import fs from 'node:fs';
import {Euler,Quaternion,Vector3} from 'three';
import {BusService,pathPart,BUS_APPROACH_M,BUS_ARRIVE_SECONDS,BUS_RIDE_SECONDS,BUS_HOLD_SECONDS,BUS_LEAVE_SECONDS,BUS_WAIT_SECONDS,BUS_WAIT_RADIUS,BUS_SEAT} from '../src/walk/bus-call';
import type {BusData,BusStopSpec} from '../src/walk/bus-types';
import type {P3} from '../src/world/v12-types';
import {PathSampler,pathLength} from '../src/walk/v12-geometry';

const data=JSON.parse(fs.readFileSync('public/data/bus-routes.json','utf8')) as BusData;
const origin=data.stops.find(s=>s.id==='liberal-arts')!;
const marine=data.stops.find(s=>s.id==='marine-sci')!;
const safe=(stop:BusStopSpec):P3=>[...stop.alightingPoints[0]];
const make=()=>new BusService(data.routes,data.stops);
function advance(bus:BusService,seconds:number,alight:(stop:BusStopSpec)=>P3|undefined=safe,player:P3=bus.stop?.boardingPoint??origin.boardingPoint){
 let result:ReturnType<BusService['update']>;
 // Quarter-second frames are exact, and exercise the production frame cap.
 for(let left=seconds;left>0;left-=.25)result=bus.update(Math.min(.25,left),player,alight);
 return result;
}
function parked(){const bus=make();expect(bus.qaPark(origin.id)).toBe(true);return bus;}
function boarded(){const bus=parked();expect(bus.board()).toBe(true);return bus;}
function expectPoint(actual:number[],expected:number[]){expected.forEach((v,i)=>expect(actual[i]).toBeCloseTo(v,7));}

describe('schematic bus with shipped routes and stops',()=>{
 it('calls, pulls in visibly for three seconds, then boards at the berth pose',()=>{
  const bus=make();expect(BUS_ARRIVE_SECONDS).toBe(3);expect(bus.phase).toBe('idle');expect(bus.visible).toBe(false);expect(bus.board()).toBe(false);
  expect(bus.call(origin.id)).toBe(true);expect(bus.phase).toBe('arriving');expect(bus.visible).toBe(true);expect(bus.parked).toBe(false);expect(bus.onBoard).toBe(false);expect(bus.arrivingIn).toBe(3);
  const route=data.routes[0],occurrence=route.stopOccurrences.find(o=>o.stopId===origin.id)!;
  const leg=route.legs.find(l=>l.toOccurrenceId===occurrence.occurrenceId)!,incoming=new PathSampler(leg.path);
  expectPoint(bus.position.toArray(),incoming.point(Math.max(0,incoming.length-BUS_APPROACH_M)));
  advance(bus,2.75);expect(bus.phase).toBe('arriving');expect(bus.arrivingIn).toBe(.25);expect(bus.board()).toBe(false);
  advance(bus,.25);expect(bus.phase).toBe('boardable');expect(bus.visible).toBe(true);expect(bus.parked).toBe(true);expect(bus.arrivingIn).toBe(0);
  expectPoint(bus.position.toArray(),origin.berth.position);expect(bus.yaw).toBeCloseTo(origin.berth.yaw+Math.PI);
  expect(bus.board()).toBe(true);expect(bus.phase).toBe('onboard');expect(bus.onBoard).toBe(true);expect(bus.parked).toBe(true);expect(bus.visible).toBe(true);
  expect(bus.motion).toEqual({kind:'carried',carrier:'bus',id:route.vehicleId,localAnchor:BUS_SEAT});
 });

 it.each(data.stops)('can call at $id and reach every other place',stop=>{
  const bus=make();expect(bus.call(stop.id)).toBe(true);advance(bus,3);expect(bus.phase).toBe('boardable');expect(bus.stop).toBe(stop);
  const campusServes=data.routes[0].stopOccurrences.some(o=>o.stopId===stop.id);
  expect(bus.route?.id).toBe(campusServes?'campus-bus':'orange-1-ext');expect(bus.vehicleModel).toBe(campusServes?'bus_campus':'bus_orange1');
  expect(bus.destinations().map(d=>d.name).sort()).toEqual([...new Set(data.stops.map(s=>s.name))].filter(name=>name!==stop.name).sort());
 });

 it('lists seven unique destinations from 文學院, including 海科院 via 橘1延',()=>{
  const bus=boarded(),destinations=bus.destinations(),names=[...new Set(data.stops.map(s=>s.name))];
  expect(names).toHaveLength(8);expect(destinations).toHaveLength(7);
  expect(destinations.map(d=>d.name).sort()).toEqual(names.filter(n=>n!==origin.name).sort());
  expect(destinations.find(d=>d.name===marine.name)).toMatchObject({stopId:marine.id,routeId:'orange-1-ext',via:[marine.name]});
  for(const d of destinations){expect(d.via.at(-1)).toBe(d.name);expect(d.via.every((name,i)=>i===0||name!==d.via[i-1])).toBe(true);}
 });

 it('uses the minimum-hop line from 文學院, with campus winning ties even when listed last',()=>{
  // Enumerate occurrence pairs independently of the service destination walk.
  const here=origin;let ties=0;
   const bus=new BusService([...data.routes].reverse(),data.stops);bus.qaPark(here.id);const destinations=bus.destinations();
   for(const d of destinations){
    const candidates=data.routes.flatMap(route=>route.stopOccurrences.flatMap((start,i)=>start.stopId!==here.id?[]:route.stopOccurrences.flatMap((end,j)=>{
     const stop=data.stops.find(s=>s.id===end.stopId)!,hops=(j-i+route.stopOccurrences.length)%route.stopOccurrences.length;
     return stop.name===d.name&&hops>0?[{routeId:route.id,hops}]:[];
    })));
    const shortest=Math.min(...candidates.map(c=>c.hops)),winners=candidates.filter(c=>c.hops===shortest);
    if(new Set(winners.map(c=>c.routeId)).size>1)ties++;
    const expected=winners.some(c=>c.routeId==='campus-bus')?'campus-bus':'orange-1-ext';
    expect(d.routeId,`${here.id} → ${d.name}`).toBe(expected);
    expect(d.via.at(-1)).toBe(d.name);expect(d.via.every((name,i)=>i===0||name!==d.via[i-1])).toBe(true);
   }
  expect(ties).toBeGreaterThan(0);
 });

 it('rides invisibly for three seconds, exits at resolved support, holds two seconds, then leaves along the outgoing leg',()=>{
  const bus=boarded(),resolved:P3=[marine.alightingPoints[0][0],marine.alightingPoints[0][1]+1.2,marine.alightingPoints[0][2]],alight=vi.fn(()=>resolved);
  expect(BUS_RIDE_SECONDS).toBe(3);expect(BUS_HOLD_SECONDS).toBe(2);expect(bus.choose(marine.name)).toBe(true);
  expect(bus.phase).toBe('riding');expect(bus.onBoard).toBe(true);expect(bus.visible).toBe(false);expect(bus.parked).toBe(false);expect(bus.rideProgress).toBe(0);
  expect(advance(bus,1,alight)?.exit).toBe(false);expect(bus.rideProgress).toBeCloseTo(1/3);
  advance(bus,1.75,alight);expect(bus.rideProgress).toBeCloseTo(2.75/3);expect(alight).not.toHaveBeenCalled();
  expect(advance(bus,.25,alight)).toEqual({foot:resolved,exit:true});expect(alight).toHaveBeenCalledExactlyOnceWith(marine);
  expect(bus.phase).toBe('leaving');expect(bus.onBoard).toBe(false);expect(bus.visible).toBe(true);expect(bus.parked).toBe(true);expect(bus.route?.id).toBe('orange-1-ext');expect(bus.trip).toBeUndefined();
  expectPoint(bus.position.toArray(),marine.berth.position);expect(bus.yaw).toBeCloseTo(marine.berth.yaw+Math.PI);
  advance(bus,1.75);expect(bus.parked).toBe(true);expectPoint(bus.position.toArray(),marine.berth.position);
  advance(bus,.25);expect(bus.parked).toBe(false);expect(bus.phase).toBe('leaving');
  const route=data.routes[1],occurrence=route.stopOccurrences.find(o=>o.stopId===marine.id)!;
  const leg=route.legs.find(l=>l.fromOccurrenceId===occurrence.occurrenceId)!,outgoing=new PathSampler(pathPart(leg.path,BUS_APPROACH_M,'head'));
  expectPoint(bus.position.toArray(),outgoing.point(0));advance(bus,1.5);
  expectPoint(bus.position.toArray(),outgoing.point(outgoing.length*.25));expect(bus.visible).toBe(true);
  advance(bus,1.25);expect(bus.phase).toBe('leaving');advance(bus,.25);expect(bus.phase).toBe('idle');expect(bus.visible).toBe(false);expect(bus.parked).toBe(false);
  expect(alight).toHaveBeenCalledTimes(1);
 });

 it('keeps a blocked passenger onboard with a notice and permits another destination',()=>{
  const bus=boarded();bus.choose(marine.name);const blocked=vi.fn(()=>undefined);
  expect(advance(bus,3,blocked)?.exit).toBe(false);expect(blocked).toHaveBeenCalledWith(marine);expect(bus.stop).toBe(marine);expect(bus.phase).toBe('onboard');expect(bus.onBoard).toBe(true);expect(bus.visible).toBe(true);expect(bus.parked).toBe(true);expect(bus.notice).toMatch(/下車.*受阻/);
  advance(bus,61,blocked);expect(bus.phase).toBe('onboard');expect(bus.choose(origin.name)).toBe(true);expect(bus.notice).toBe('');
  expect(advance(bus,3)).toEqual({foot:safe(origin),exit:true});expect(bus.phase).toBe('leaving');
 });

 it('alights at the origin only after boarding, and retains a blocked passenger',()=>{
  const bus=parked(),resolve=vi.fn(safe);expect(bus.alightHere(resolve)).toBeUndefined();expect(resolve).not.toHaveBeenCalled();bus.board();
  expect(bus.alightHere(()=>undefined)).toBeUndefined();expect(bus.onBoard).toBe(true);expect(bus.notice).toMatch(/受阻/);
  expect(bus.alightHere(resolve)).toEqual(safe(origin));expect(resolve).toHaveBeenCalledWith(origin);expect(bus.phase).toBe('leaving');expect(bus.onBoard).toBe(false);
 });

 it('leaves when a waiting player walks beyond 40 m, while the boundary remains callable',()=>{
  const bus=parked(),[x,y,z]=origin.boardingPoint;expect(BUS_WAIT_RADIUS).toBe(40);
  bus.update(.25,[x+40,y,z],safe);expect(bus.phase).toBe('boardable');
  bus.update(.25,[x+40.01,y,z],safe);expect(bus.phase).toBe('leaving');expect(bus.parked).toBe(false);
  advance(bus,BUS_LEAVE_SECONDS);expect(bus.phase).toBe('idle');expect(bus.call(origin.id)).toBe(true);
 });

 it('leaves after a 60-second unboarded wait and can be called again immediately',()=>{
  const bus=parked();expect(BUS_WAIT_SECONDS).toBe(60);advance(bus,59.75);expect(bus.phase).toBe('boardable');
  advance(bus,.5);expect(bus.phase).toBe('leaving');expect(bus.parked).toBe(false);expect(bus.call(origin.id)).toBe(true);expect(bus.phase).toBe('arriving');
 });

 it('refuses calls while onboard or riding without replacing the current trip',()=>{
  const bus=boarded();expect(bus.call(marine.id)).toBe(false);expect(bus.qaPark(marine.id)).toBe(false);expect(bus.stop).toBe(origin);
  bus.choose(marine.name);const trip=bus.trip;advance(bus,1);
  expect(bus.call(origin.id)).toBe(false);expect(bus.phase).toBe('riding');expect(bus.trip).toBe(trip);expect(bus.rideProgress).toBeCloseTo(1/3);
 });

 it('qaPark accepts a stop ID and places a boardable bus directly at its berth',()=>{
  const bus=make();expect(bus.qaPark('orange-1-ext:la-down')).toBe(false);expect(bus.qaPark('missing')).toBe(false);expect(bus.phase).toBe('idle');
  expect(bus.qaPark(marine.id)).toBe(true);expect(bus.phase).toBe('boardable');expect(bus.parked).toBe(true);expect(bus.visible).toBe(true);expect(bus.route?.id).toBe('orange-1-ext');expect(bus.t).toBe(0);
  expectPoint(bus.position.toArray(),marine.berth.position);expect(bus.yaw).toBeCloseTo(marine.berth.yaw+Math.PI);expect(bus.board()).toBe(true);
 });

 it('seat stays within the oriented vehicle footprint at every real berth and on a slope',()=>{
  for(const ground of [undefined,(x:number,z:number)=>x*.1+z*.05])for(const stop of data.stops){
   const bus=new BusService(data.routes,data.stops,ground);bus.qaPark(stop.id);bus.board();
   const seat=bus.seat(),inverse=new Quaternion().setFromEuler(new Euler(-bus.pitch,bus.yaw,0,'YXZ')).invert();
   const local=new Vector3(...seat).sub(bus.position).applyQuaternion(inverse),vehicle=bus.route!.vehicle;
   expectPoint(local.toArray(),BUS_SEAT);expect(Math.abs(local.x)).toBeLessThan(vehicle.widthM/2);expect(Math.abs(local.z)).toBeLessThan(vehicle.lengthM/2);
   expect(local.y).toBeGreaterThan(0);expect(local.y).toBeLessThan(vehicle.heightM);
   expect(bus.update(0,stop.boardingPoint,safe)).toEqual({foot:seat,exit:false});
  }
 });

 it.each([NaN,-1,-Infinity,Infinity,Number.MAX_VALUE])('clamps frame dt %s during arrival and riding',dt=>{
  const bus=make();bus.call(origin.id);const at=bus.position.clone(),expected=Number.isFinite(dt)&&dt>0?.25:0;
  bus.update(dt,origin.boardingPoint,safe);expect(bus.t).toBe(expected);expect(bus.phase).toBe('arriving');expect(bus.arrivingIn).toBe(3-expected);
  if(expected===0)expect(bus.position.equals(at)).toBe(true);
  bus.qaPark(origin.id);bus.board();bus.choose(marine.name);const alight=vi.fn(safe);bus.update(dt,origin.boardingPoint,alight);
  expect(bus.phase).toBe('riding');expect(bus.t).toBe(expected);expect(bus.rideProgress).toBe(expected/3);expect(alight).not.toHaveBeenCalled();
 });

 it('rejects invalid destinations and keeps repeated calls from restarting arrival',()=>{
  const bus=make();expect(bus.destinations()).toEqual([]);expect(bus.choose(marine.name)).toBe(false);expect(bus.call('missing')).toBe(false);
  bus.call(origin.id);advance(bus,1);const at=bus.position.clone();expect(bus.call(origin.id)).toBe(true);expect(bus.t).toBe(1);expect(bus.position.equals(at)).toBe(true);
  advance(bus,2);bus.board();expect(bus.choose(origin.name)).toBe(false);expect(bus.choose('missing')).toBe(false);expect(bus.phase).toBe('onboard');
 });
});

describe('approach/departure path excerpts',()=>{
 it.each(['tail','head'] as const)('%s retains the shipped leg endpoints and approximately 35 m',end=>{
  expect(BUS_APPROACH_M).toBe(35);
  for(const route of data.routes)for(const leg of route.legs){
   const whole=new PathSampler(leg.path),part=pathPart(leg.path,35,end),length=Math.min(35,whole.length);
   // Two-metre resampling can cut across a corner; keep the shortfall below one metre.
   expect(pathLength(part)).toBeLessThanOrEqual(length+1e-7);
   expect(length-pathLength(part),`${route.id}/${leg.fromOccurrenceId}/${end}`).toBeLessThan(1);
   expectPoint(part[0],end==='tail'?whole.point(whole.length-length):leg.path[0]);
   expectPoint(part.at(-1)!,end==='tail'?leg.path.at(-1)!:whole.point(length));
  }
 });
 it.each(['tail','head'] as const)('%s keeps the entire leg when it is shorter than 35 m',end=>{
  const leg:P3[]=[[2,3,4],[8,3,12]],part=pathPart(leg,35,end);
  expect(pathLength(part)).toBeCloseTo(10);expectPoint(part[0],leg[0]);expectPoint(part.at(-1)!,leg[1]);
 });
});
