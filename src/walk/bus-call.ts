import * as T from 'three';
import type {BusRouteSpec,BusStopSpec} from './bus-types';
import type {P3,MotionMode} from '../world/v12-types';
import {PathSampler} from './v12-geometry';
import {busGroundPose} from './bus';

/** Schematic campus bus, like the lifts: call at any stop at any time, the bus pulls in over a few
 * seconds, the player boards and picks a destination, and the ride itself is a short fade with the
 * route progress (the full drive is not simulated). */
export const BUS_ARRIVE_SECONDS=3,BUS_RIDE_SECONDS=3,BUS_HOLD_SECONDS=2,BUS_LEAVE_SECONDS=3,BUS_WAIT_SECONDS=60,BUS_WAIT_RADIUS=40,BUS_APPROACH_M=35;
export const BUS_SEAT:P3=[.55,.85,1];
export type BusPhase='idle'|'arriving'|'boardable'|'onboard'|'riding'|'leaving';
export interface BusDestination {name:string;stopId:string;routeId:BusRouteSpec['id'];via:string[];transferAt?:string}
export const busLineName=(id:BusRouteSpec['id'])=>id==='campus-bus'?'校園公車':'橘1延';

/** The last (or first) `metres` of a path, resampled every 2 m. */
export function pathPart(path:P3[],metres:number,end:'tail'|'head'):P3[]{
 const s=new PathSampler(path),from=end==='tail'?Math.max(0,s.length-metres):0,to=end==='tail'?s.length:Math.min(s.length,metres);
 const out:P3[]=[];for(let d=from;d<to;d+=2)out.push(s.point(d));out.push(s.point(to));
 return out.length>1?out:[s.point(from),s.point(to)];
}

export class BusService {
 phase:BusPhase='idle';stop?:BusStopSpec;route?:BusRouteSpec;trip?:BusDestination;t=0;notice='';
 readonly position=new T.Vector3();yaw=0;pitch=0;
 private path?:PathSampler;
 constructor(readonly routes:BusRouteSpec[],readonly stops:BusStopSpec[],private ground?:(x:number,z:number)=>number){}
 /** The bus model is drawn while it pulls in, waits, or leaves; the ride itself is behind the fade. */
 get visible(){return this.phase==='arriving'||this.phase==='boardable'||this.phase==='onboard'||this.phase==='leaving';}
 /** Collider only while standing still, so a moving schematic bus never shoves the player. */
 get parked(){return this.phase==='boardable'||this.phase==='onboard'||(this.phase==='leaving'&&this.t<BUS_HOLD_SECONDS);}
 get onBoard(){return this.phase==='onboard'||this.phase==='riding';}
 get vehicleModel(){return this.route?.id==='orange-1-ext'?'bus_orange1':'bus_campus';}
 get rideProgress(){return this.phase==='riding'?Math.min(1,this.t/BUS_RIDE_SECONDS):0;}
 get arrivingIn(){return this.phase==='arriving'?Math.max(0,BUS_ARRIVE_SECONDS-this.t):0;}
 get motion():MotionMode{return {kind:'carried',carrier:'bus',id:this.route?.vehicleId??'bus',localAnchor:[...BUS_SEAT]};}
 /** Campus bus by default; the orange line only for stops it alone serves (海科院、海工館…). */
 servingRoute(stopId:string){return this.routes.find(r=>r.id==='campus-bus'&&r.stopOccurrences.some(o=>o.stopId===stopId))??this.routes.find(r=>r.stopOccurrences.some(o=>o.stopId===stopId));}
 call(stopId:string){
  if(this.onBoard)return false;const stop=this.stops.find(s=>s.id===stopId),route=this.servingRoute(stopId);if(!stop||!route)return false;
  if(this.stop?.id===stopId&&(this.phase==='arriving'||this.phase==='boardable'))return true;
  this.stop=stop;this.route=route;this.trip=undefined;this.notice='';this.t=0;
  const occurrence=route.stopOccurrences.find(o=>o.stopId===stopId)!,leg=route.legs.find(l=>l.toOccurrenceId===occurrence.occurrenceId);
  this.path=leg&&leg.path.length>1?new PathSampler(pathPart(leg.path,BUS_APPROACH_M,'tail')):undefined;
  if(this.path){this.phase='arriving';this.follow(0);}else{this.phase='boardable';this.park();}
  return true;
 }
 /** QA: the bus already waits at this stop. */
 qaPark(stopId:string){if(!this.call(stopId))return false;this.phase='boardable';this.t=0;this.park();return true;}
 board(){if(this.phase!=='boardable')return false;this.phase='onboard';this.notice='';return true;}
 /** Every reachable place (unique stop name) except here, by the line with the fewest stops. A place's
  * stops on the other line count as the origin too, so any place reaches any place. */
 destinations():BusDestination[]{
  const here=this.stop;if(!here)return [];const best=new Map<string,{hops:number;d:BusDestination}>();
  for(const r of this.routes){const occ=r.stopOccurrences;occ.forEach((o,i)=>{if(this.stops.find(s=>s.id===o.stopId)?.name!==here.name)return;/* same-named stop on either line: schematic transfer */const via:string[]=[];
   for(let k=1;k<occ.length;k++){const s=this.stops.find(s=>s.id===occ[(i+k)%occ.length].stopId);if(!s||s.name===here.name)continue;if(via.at(-1)!==s.name)via.push(s.name);
    const prev=best.get(s.name);if(!prev||k<prev.hops||(k===prev.hops&&r.id==='campus-bus'&&prev.d.routeId!=='campus-bus'))best.set(s.name,{hops:k,d:{name:s.name,stopId:s.id,routeId:r.id,via:[...via]}});}});}
  // An exclusive stop (such as a metro exit) may require changing lines at a shared stop.
  const direct=[...best.values()];
  const directNames=new Set(best.keys());
  for(const {hops,d} of direct)for(const route of this.routes){
   if(route.id===d.routeId)continue;
   const stops=route.stopOccurrences.map(o=>this.stops.find(s=>s.id===o.stopId)!);
   stops.forEach((stop,index)=>{
    if(stop.name!==d.name)return;
    const via=[...d.via];
    for(let k=1;k<stops.length;k++){
     const next=stops[(index+k)%stops.length];
     if(next.name===stop.name||next.name===here.name)continue;
     if(via.at(-1)!==next.name)via.push(next.name);
     if(!directNames.has(next.name)&&hops+k<(best.get(next.name)?.hops??Infinity))
      best.set(next.name,{hops:hops+k,d:{name:next.name,stopId:next.id,routeId:route.id,via:[...via],transferAt:stop.name}});
    }
   });
  }
  const order=[...new Set(this.routes.flatMap(r=>r.stopOccurrences.map(o=>this.stops.find(s=>s.id===o.stopId)?.name??'')))];
  return [...best.values()].map(v=>v.d).sort((a,b)=>order.indexOf(a.name)-order.indexOf(b.name));
 }
 choose(name:string){if(this.phase!=='onboard')return false;const d=this.destinations().find(d=>d.name===name);if(!d)return false;this.trip=d;this.phase='riding';this.t=0;this.notice='';return true;}
 /** Seat position in the world for the carried player. */
 seat():P3{const v=new T.Vector3(...BUS_SEAT).applyEuler(new T.Euler(-this.pitch,this.yaw,0,'YXZ')).add(this.position);return v.toArray() as P3;}
 /** Get off at the current stop (onboard only). `alight` resolves a safe standing point or undefined. */
 alightHere(alight:(stop:BusStopSpec)=>P3|undefined):P3|undefined{
  if(this.phase!=='onboard'||!this.stop)return;const p=alight(this.stop);if(!p){this.notice='下車位置暫時受阻，請改選其他站';return;}
  this.depart();return p;
 }
 update(dt:number,player:P3,alight:(stop:BusStopSpec)=>P3|undefined):{foot:P3;exit:boolean}|undefined{
  const step=Number.isFinite(dt)?Math.max(0,Math.min(.25,dt)):0;this.t+=step;
  if(this.phase==='arriving'){if(this.t>=BUS_ARRIVE_SECONDS){this.phase='boardable';this.t=0;this.park();}else this.follow(1-(1-this.t/BUS_ARRIVE_SECONDS)**2);}
  else if(this.phase==='boardable'){const s=this.stop!;if(this.t>BUS_WAIT_SECONDS||Math.hypot(player[0]-s.boardingPoint[0],player[2]-s.boardingPoint[2])>BUS_WAIT_RADIUS){this.depart();this.t=BUS_HOLD_SECONDS;}}
  else if(this.phase==='riding'&&this.t>=BUS_RIDE_SECONDS){
   const d=this.trip!,stop=this.stops.find(s=>s.id===d.stopId)!;this.route=this.routes.find(r=>r.id===d.routeId)??this.route;this.stop=stop;this.trip=undefined;this.park();
   const p=alight(stop);if(p){this.depart();return {foot:p,exit:true};}
   this.phase='onboard';this.t=0;this.notice='下車位置暫時受阻，請改選其他站';
  }
  else if(this.phase==='leaving'&&this.t>=BUS_HOLD_SECONDS){const u=(this.t-BUS_HOLD_SECONDS)/BUS_LEAVE_SECONDS;if(u>=1||!this.path){this.phase='idle';this.path=undefined;}else this.follow(u*u);}
  return this.onBoard?{foot:this.seat(),exit:false}:undefined;
 }
 reset(){this.phase='idle';this.trip=undefined;this.notice='';this.path=undefined;this.t=0;}
 private depart(){
  const route=this.route,stop=this.stop;this.phase='leaving';this.t=0;this.path=undefined;if(!route||!stop)return;
  const occurrence=route.stopOccurrences.find(o=>o.stopId===stop.id),leg=occurrence&&route.legs.find(l=>l.fromOccurrenceId===occurrence.occurrenceId);
  const departure=leg?.departurePath??leg?.path;
  if(departure&&departure.length>1)this.path=new PathSampler(pathPart(departure,BUS_APPROACH_M,'head'));
 }
 private park(){const s=this.stop!;this.position.fromArray(s.berth.position);this.yaw=s.berth.yaw+Math.PI;this.pitch=0;this.settle();}
 private follow(u:number){const p=this.path!,pose=p.pose(p.length*Math.max(0,Math.min(1,u)));this.position.fromArray(pose.position);this.yaw=pose.yaw;this.pitch=T.MathUtils.clamp(pose.pitch,-Math.PI/15,Math.PI/15);this.settle();}
 private settle(){if(!this.ground||!this.route)return;const v=this.route.vehicle,pose=busGroundPose(this.position,this.yaw,v.lengthM,v.widthM,this.ground);this.position.y=pose.y;this.pitch=pose.pitch;}
}
