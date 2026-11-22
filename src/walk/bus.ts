import {CarrierAnchor} from './lift-world';
import * as T from 'three';
import type {BusRouteSpec,BusStopSpec} from './bus-types';
import type {P3,MotionMode} from '../world/v12-types';
import {distance,pathLength,samplePath,PathSampler} from './v12-geometry';
export interface BusObstacle {id:string;position:P3;radius:number}
export class SectionOccupancy {
 private owners=new Map<string,string>();
 acquire(id:string,sections:string[]){if(sections.some(s=>this.owners.has(s)&&this.owners.get(s)!==id))return false;sections.forEach(s=>this.owners.set(s,id));return true;}
 owner(section:string){return this.owners.get(section);}
 release(id:string,keep:readonly string[]=[]){for(const [s,owner]of this.owners)if(owner===id&&!keep.includes(s))this.owners.delete(s);}
 releaseKeys(id:string,keys:string[]){for(const key of keys)if(this.owners.get(key)===id)this.owners.delete(key);}
}
export function sectionKey(edge:string){const m=edge.match(/^(\d+)\D+(\d+)$/);return m?[+m[1],+m[2]].sort((a,b)=>a-b).join('-'):edge;}
export class BusRuntime {
 readonly position=new T.Vector3();yaw=0;pitch=0;speed=0;phase:'dwell'|'moving'|'waiting'|'queued'='dwell';occurrence=0;progress=0;completedTrips=0;private elapsed=0;notice='';private departedBerth?:string;
 private samplers:PathSampler[];readonly lengths:number[];private legIndex=0;private delay:number;departureHold?:string;
 constructor(readonly route:BusRouteSpec,readonly stops:BusStopSpec[],private sections:SectionOccupancy,private ground?:(x:number,z:number)=>number){
  if(route.stopOccurrences.length<2||route.legs.length<2)throw Error(`${route.id}: 缺少循環路徑`);
  this.samplers=route.legs.map(l=>new PathSampler(l.path));this.lengths=this.samplers.map(p=>p.length);this.delay=0;
  const stop=this.stop;if(!stop)throw Error(`${route.id}: 缺少站點`);this.position.fromArray(stop.berth.position);this.yaw=stop.berth.yaw+Math.PI;
  if(!this.sections.acquire(this.id,[this.berthKey(this.stop.id)]))this.phase='queued';
  if(route.schedule.initialPhaseGameSeconds>0)this.update(route.schedule.initialPhaseGameSeconds/5);this.groundPose();
 }
 parkAt(occurrenceId:string){
  const i=this.route.stopOccurrences.findIndex(o=>o.occurrenceId===occurrenceId);if(i<0)return false;
  this.sections.release(this.id);this.occurrence=i;this.legIndex=this.route.legs.findIndex(l=>l.fromOccurrenceId===occurrenceId);this.phase='dwell';this.elapsed=0;this.progress=0;this.speed=0;this.departedBerth=undefined;this.delay=0;this.departureHold=occurrenceId;this.position.fromArray(this.stop.berth.position);this.yaw=this.stop.berth.yaw+Math.PI;this.groundPose();this.sections.acquire(this.id,[this.berthKey(this.stop.id)]);return true;
 }
 get stop(){return this.stops.find(s=>s.id===this.route.stopOccurrences[this.occurrence].stopId)!;}
 get leg(){return this.route.legs[this.legIndex];}
 get dwellSeconds(){return Math.max(6,this.route.schedule.minDwellRealSeconds,this.occurrence===0?this.route.schedule.terminalLayoverRealSeconds:0);}
 get id(){return this.route.vehicleId;}
 get active(){return this.phase!=='queued';}
 get atStop(){return this.phase==='dwell'||this.phase==='waiting'?this.stop.id:null;}
 private berthKey(id:string){return 'berth:'+id;}
 get nextStopId(){const leg=this.route.legs.find(l=>l.fromOccurrenceId===this.route.stopOccurrences[this.occurrence].occurrenceId)!;return this.route.stopOccurrences.find(s=>s.occurrenceId===leg.toOccurrenceId)!.stopId;}
 ready(dt=0){return !!this.atStop&&this.elapsed+dt>=this.dwellSeconds;}
 queue(){this.sections.release(this.id);this.phase='queued';this.progress=0;this.speed=0;this.elapsed=0;this.departedBerth=undefined;this.position.fromArray(this.stop.berth.position);this.notice='站位不足，暫在站外候發';}
 activate(){if(!this.sections.acquire(this.id,[this.berthKey(this.stop.id)]))return false;this.phase='dwell';this.elapsed=0;this.notice='';return true;}
 hold(){if(this.phase!=='moving')this.elapsed=0;}
 private resources(){return [...new Set([...this.leg.sourceEdgeIds.map(sectionKey),...this.leg.narrowSectionIds??[]])];}
 update(realDt:number,obstacles:readonly BusObstacle[]=[]){
  if(!this.active||!Number.isFinite(realDt))return;
  let remaining=Math.max(0,realDt);while(remaining>1e-8){const dt=Math.min(.05,remaining);remaining-=dt;
   if(this.delay>0){this.delay=Math.max(0,this.delay-dt);continue;}
   if(this.phase!=='moving'){
    const target=this.stop.berth.yaw+Math.PI;this.yaw+=T.MathUtils.clamp(Math.atan2(Math.sin(target-this.yaw),Math.cos(target-this.yaw))*(1-Math.exp(-6*dt)),-Math.PI/2*dt,Math.PI/2*dt);
    if(this.departureHold===this.route.stopOccurrences[this.occurrence].occurrenceId){this.elapsed=0;continue;}
    this.elapsed+=dt;if(this.elapsed<this.dwellSeconds)continue;
    const current=this.route.stopOccurrences[this.occurrence].occurrenceId;
    this.legIndex=this.route.legs.findIndex(l=>l.fromOccurrenceId===current);if(this.legIndex<0)throw Error(`${this.id}: 站序缺少 outgoing leg`);
    if(!this.sections.acquire(this.id,[...this.resources(),this.berthKey(this.nextStopId)])){this.phase='waiting';this.notice='等候前方路段／站位';continue;}
    this.departedBerth=this.berthKey(this.stop.id);this.notice='';this.phase='moving';this.progress=0;this.speed=0;
   }
   const length=this.lengths[this.legIndex],look=Math.max(10,this.speed*this.speed/16+this.route.vehicle.lengthM/2+3);
   let free=look;const nearby=obstacles.filter(o=>o.id!==this.id&&Math.hypot(o.position[0]-this.position.x,o.position[2]-this.position.z)<=look+o.radius+this.route.vehicle.widthM);
   for(let ahead=0;nearby.length&&ahead<=look;ahead+=.5){const p=this.samplers[this.legIndex].point(Math.min(length,this.progress+ahead));
    if(nearby.some(o=>o.id!==this.id&&Math.abs(o.position[1]-p[1])<3&&Math.hypot(o.position[0]-p[0],o.position[2]-p[2])<this.route.vehicle.widthM/2+o.radius+.35)){free=ahead-this.route.vehicle.lengthM/2-.5;break;}}
   const maxSpeed=Math.min(this.leg.cruiseMpsGame*5,Math.sqrt(Math.max(0,free)*16),Math.sqrt(Math.max(0,length-this.progress)*16));
   this.speed=Math.max(0,Math.min(maxSpeed,this.speed+8*dt));
   const step=Math.min(this.speed*dt,Math.max(0,free),length-this.progress);this.progress+=step;
   if(this.departedBerth&&this.progress>this.route.vehicle.lengthM/2+.5){this.sections.releaseKeys(this.id,[this.departedBerth]);this.departedBerth=undefined;}
   this.notice=free<=0?'前方有人或車輛，請退到候車區等候':'';
   const pose=this.samplers[this.legIndex].pose(this.progress);this.position.fromArray(pose.position);this.yaw+=T.MathUtils.clamp(Math.atan2(Math.sin(pose.yaw-this.yaw),Math.cos(pose.yaw-this.yaw))*(1-Math.exp(-6*dt)),-Math.PI/2*dt,Math.PI/2*dt);this.pitch=T.MathUtils.clamp(pose.pitch,-7*Math.PI/180,7*Math.PI/180);
   if(length-this.progress<.015){
    const index=this.route.stopOccurrences.findIndex(s=>s.occurrenceId===this.leg.toOccurrenceId);if(index<0)throw Error('公車路徑終點無對應站序');
    this.completedTrips++;this.occurrence=index;this.position.fromArray(this.stop.berth.position);this.pitch=0;this.phase='dwell';this.elapsed=0;this.speed=0;this.sections.release(this.id,[this.berthKey(this.stop.id)]);this.departedBerth=undefined;
   }
  }
  this.groundPose();
 }
 private groundPose(){if(!this.ground)return;const pose=busGroundPose(this.position,this.yaw,this.route.vehicle.lengthM,this.route.vehicle.widthM,this.ground);this.position.y=pose.y;this.pitch=pose.pitch;}
 eta(occurrenceId:string){
  if(!this.active)return Infinity;
  let seconds=this.delay,index=this.occurrence;
  if(this.phase==='moving'){seconds+=(this.lengths[this.legIndex]-this.progress)/(this.leg.cruiseMpsGame*5);index=this.route.stopOccurrences.findIndex(o=>o.occurrenceId===this.leg.toOccurrenceId);}
  else {if(this.route.stopOccurrences[index].occurrenceId===occurrenceId)return 0;seconds+=Math.max(0,this.dwellSeconds-this.elapsed);}
  for(let i=0;i<this.route.stopOccurrences.length;i++){
   const here=this.route.stopOccurrences[index];if(here.occurrenceId===occurrenceId)return seconds;
   const li=this.route.legs.findIndex(l=>l.fromOccurrenceId===here.occurrenceId);if(li<0)return Infinity;
   seconds+=this.lengths[li]/(this.route.legs[li].cruiseMpsGame*5)+6;index=this.route.stopOccurrences.findIndex(o=>o.occurrenceId===this.route.legs[li].toOccurrenceId);
  }return Infinity;
 }
 dispose(){this.sections.release(this.id);}
}
export class BusFleet {
 readonly sections=new SectionOccupancy();readonly buses:BusRuntime[];
 readonly issues:string[]=[];private tickets=new Map<string,number>();private serial=0;private activationTrips=new Map<string,number>();
 constructor(routes:BusRouteSpec[],stops:BusStopSpec[],ground?:(x:number,z:number)=>number){
  this.buses=reserveGeometricConflicts(routes.slice(0,2)).map(r=>new BusRuntime(r,stops,this.sections,ground));
  for(let i=0;i<this.buses.length;i++){const b=this.buses[i];if(!b.active||this.buses.slice(0,i).some(other=>other.active&&!this.separated(b,other)))this.enqueue(b);this.activationTrips.set(b.id,b.completedTrips);}
 }
 applyQa(params:URLSearchParams){
  if(params.get('qa')!=='1')return false;const [routeId,requested,...extra]=(params.get('qaBus')??'').split(':');const occurrenceId=requested==='la-down'?'05-liberal-arts':requested;
  const b=this.buses.find(b=>b.route.id===routeId);if(extra.length||!b?.route.stopOccurrences.some(o=>o.occurrenceId===occurrenceId))return false;
  for(const other of this.buses)if(other!==b)this.enqueue(other);return b.parkAt(occurrenceId);
 }
 private separated(a:BusRuntime,b:BusRuntime){return Math.abs(a.position.y-b.position.y)>Math.max(a.route.vehicle.heightM,b.route.vehicle.heightM)||a.position.distanceTo(b.position)>(a.route.vehicle.lengthM+b.route.vehicle.lengthM)/2+1;}
 private enqueue(b:BusRuntime){b.queue();this.tickets.set(b.id,++this.serial);const note=`${b.id}: 站位／初始相位互衝，空車暫在站外候發`;if(!this.issues.includes(note))this.issues.push(note);}
 update(dt:number,obstacles:readonly BusObstacle[],passengerBus?:string){
  if(!Number.isFinite(dt))return;let left=Math.max(0,dt);
  while(left>1e-8){const step=Math.min(.05,left);left-=step;
   // Invalid two-berth swaps cannot be solved by unlocking an occupied lane. Queue an EMPTY,
   // stopped vehicle off scene; never relocate a moving bus or its passenger.
   const queued=this.buses.filter(b=>!b.active).sort((a,b)=>(this.tickets.get(a.id)??0)-(this.tickets.get(b.id)??0));
   for(const b of this.buses)if(b.id!==passengerBus&&b.ready(step)&&b.completedTrips>(this.activationTrips.get(b.id)??0)&&queued.length&&this.buses.filter(o=>o.active).length===1){this.enqueue(b);break;}
   const waiting=this.buses.filter(b=>b.phase==='waiting');
   if(waiting.length===2&&waiting.every(b=>this.sections.owner('berth:'+b.nextStopId)===waiting.find(o=>o!==b)!.id)){
    const empty=waiting.filter(b=>b.id!==passengerBus).sort((a,b)=>(this.tickets.get(a.id)??0)-(this.tickets.get(b.id)??0));if(empty.length)this.enqueue(empty[0]);
   }
   for(const b of this.buses.filter(b=>!b.active).sort((a,b)=>(this.tickets.get(a.id)??0)-(this.tickets.get(b.id)??0))){
    if(this.sections.owner('berth:'+b.nextStopId)&&this.sections.owner('berth:'+b.nextStopId)!==b.id)continue;
    if(this.buses.every(o=>o===b||!o.active||this.separated(b,o))&&b.activate())this.activationTrips.set(b.id,b.completedTrips);
   }
   for(const b of this.buses.filter(b=>b.active).sort((a,b)=>a.id.localeCompare(b.id))){const others=this.buses.filter(o=>o!==b&&o.active).flatMap(o=>[-.4,0,.4].map(t=>({id:o.id,position:o.position.clone().add(new T.Vector3(Math.sin(o.yaw)*o.route.vehicle.lengthM*t,0,Math.cos(o.yaw)*o.route.vehicle.lengthM*t)).toArray() as P3,radius:o.route.vehicle.widthM/2})));
    b.update(step,[...obstacles.filter(o=>!(o.id==='player'&&b.id===passengerBus)),...others]);}
  }
 }
 dispose(){this.buses.forEach(b=>b.dispose());}
}
export class BusPassenger {
 private anchor=new CarrierAnchor();private carrier=new T.Object3D();
 bus?:BusRuntime;selected?:string;notice='';motion:MotionMode={kind:'walk'};
 board(bus:BusRuntime,foot:P3,resolve:(p:P3)=>P3|undefined=p=>p){const boarding=resolve(bus.stop.boardingPoint);if(this.bus||!bus.atStop||!boarding||distance(foot,boarding)>3.5)return false;this.bus=bus;bus.hold();this.anchor.local=[.55,.85,1];this.motion={kind:'carried',carrier:'bus',id:bus.id,localAnchor:[.55,.85,1]};return true;}
 select(occurrenceId:string){if(!this.bus?.route.stopOccurrences.some(o=>o.occurrenceId===occurrenceId))return false;this.selected=occurrenceId;this.bus.departureHold=occurrenceId;this.notice='';return true;}
 update(safe:(p:P3)=>boolean,dt=0,resolve:(p:P3)=>P3|undefined=p=>p):{foot:P3;exit:boolean}|undefined {
  if(!this.bus)return;const b=this.bus;
  if(b.atStop&&b.route.stopOccurrences[b.occurrence].occurrenceId===this.selected){const p=b.stop.alightingPoints.map(resolve).find((p):p is P3=>!!p&&outsideBus(b,p)&&safe(p));if(p){this.clear();return {foot:[...p],exit:true};}
   b.hold();this.notice='下車位置暫時不安全，公車停站等候；可改選其他站或由選單回到起點';
  }
  this.carrier.position.copy(b.position);this.carrier.rotation.set(-b.pitch,b.yaw,0,'YXZ');this.carrier.updateMatrixWorld(true);const foot=this.anchor.follow(this.carrier).toArray() as P3;return {foot,exit:false};
 }
 clear(){if(this.bus)this.bus.departureHold=undefined;this.bus=undefined;this.selected=undefined;this.notice='';this.anchor.clear();this.motion={kind:'walk'};}
}

/** Resample the runtime triangle surface every 2 m, then average a 60 m profile.
 * Endpoints retain their berth height; diagnostics expose any remaining grade/road gap. */
export function prepareBusRoutes(routes:BusRouteSpec[],height:(x:number,z:number)=>number){
 const diagnostics:{route:string;maxGrade:number;maxSurfaceGap:number}[]=[];
 const prepared=routes.map(route=>{let maxGrade=0,maxSurfaceGap=0;
  const legs=route.legs.map(leg=>{const horizontal=leg.path.map(([x,,z]):P3=>[x,0,z]),len=pathLength(horizontal),count=Math.max(1,Math.ceil(len/2));
   const samples=Array.from({length:count+1},(_,i)=>{const p=samplePath(horizontal,len*i/count).position;return [p[0],height(p[0],p[2]),p[2]] as P3;});
   const step=len/count,window=Math.max(1,Math.round(30/(step||2))),smooth=samples.map((_,i)=>{const a=Math.max(0,i-window),b=Math.min(count,i+window);let sum=0;for(let k=a;k<=b;k++)sum+=samples[k][1];return sum/(b-a+1);});
   const path=samples.map((p,i)=>{const nearStart=Math.max(0,1-i*step/30),nearEnd=Math.max(0,1-(count-i)*step/30),y=smooth[i]+nearStart*(samples[0][1]-smooth[0])+nearEnd*(samples[count][1]-smooth[count]);maxSurfaceGap=Math.max(maxSurfaceGap,Math.abs(y-p[1]));return [p[0],y,p[2]] as P3;});
   path.forEach((p,i)=>{if(i)maxGrade=Math.max(maxGrade,Math.abs(p[1]-path[i-1][1])/Math.max(.01,Math.hypot(p[0]-path[i-1][0],p[2]-path[i-1][2])));});return {...leg,path};});
  diagnostics.push({route:route.id,maxGrade,maxSurfaceGap});return {...route,legs};});return {routes:prepared,diagnostics};
}

/** Boarding/alighting belong to the actual collision support, not the DEM beneath a pavement. */
export function supportedStopPoint(p:P3,support:(x:number,z:number,y:number)=>number|undefined,ground?:(x:number,z:number)=>number):P3|undefined {
 const reference=ground?.(p[0],p[2])??p[1];
 const y=support(p[0],p[2],reference)??support(p[0],p[2],reference+2);return y===undefined||!Number.isFinite(y)?undefined:[p[0],y,p[2]];
}
export function boardingIssue(stops:BusStopSpec[],routes:BusRouteSpec[]):string|undefined {
 for(const route of routes)for(const stop of stops.filter(s=>route.stopOccurrences.some(o=>o.stopId===s.id)))for(const point of [stop.boardingPoint,stop.sign])for(const leg of route.legs){
  for(let i=1;i<leg.path.length;i++){const a=leg.path[i-1],b=leg.path[i],dx=b[0]-a[0],dz=b[2]-a[2],t=Math.max(0,Math.min(1,((point[0]-a[0])*dx+(point[2]-a[2])*dz)/(dx*dx+dz*dz||1))),gap=Math.hypot(point[0]-a[0]-dx*t,point[2]-a[2]-dz*t);
   if(Math.abs(point[1]-(a[1]+(b[1]-a[1])*t))<3&&gap<route.vehicle.widthM/2+1)return `${stop.id}: 上車點／站牌位於車道內，請保留車寬半幅加 1 m`;}
 }return undefined;
}

export function outsideBus(bus:BusRuntime,p:P3){const x=p[0]-bus.position.x,z=p[2]-bus.position.z,c=Math.cos(bus.yaw),s=Math.sin(bus.yaw);return Math.abs(c*x-s*z)>bus.route.vehicle.widthM/2+.4||Math.abs(s*x+c*z)>bus.route.vehicle.lengthM/2+.4;}
/** Edge IDs and narrow-section annotations are provenance, not proof of separated lanes.
 * Conservatively reserve intersecting/sufficiently close opposing geometry as one resource. */
function reserveGeometricConflicts(routes:BusRouteSpec[]):BusRouteSpec[]{
 const out=routes.map(r=>({...r,legs:r.legs.map(l=>({...l,narrowSectionIds:[...l.narrowSectionIds??[]]}))}));
 const dist=(p:P3,a:P3,b:P3)=>{const x=b[0]-a[0],z=b[2]-a[2],t=Math.max(0,Math.min(1,((p[0]-a[0])*x+(p[2]-a[2])*z)/(x*x+z*z||1)));return Math.hypot(p[0]-a[0]-x*t,p[2]-a[2]-z*t);};
 const cross=(a:P3,b:P3,p:P3)=>(b[0]-a[0])*(p[2]-a[2])-(b[2]-a[2])*(p[0]-a[0]);
 for(let i=0;i<out.length;i++)for(let j=i+1;j<out.length;j++)out[i].legs.forEach((a,ai)=>out[j].legs.forEach((b,bi)=>{
  const pad=(out[i].vehicle.widthM+out[j].vehicle.widthM)/2+.6;let conflict=false;
  for(let x=1;x<a.path.length&&!conflict;x++)for(let z=1;z<b.path.length;z++){
   const p=a.path[x-1],q=a.path[x],r=b.path[z-1],s=b.path[z];
   if(Math.abs((p[1]+q[1]-r[1]-s[1])/2)>3||Math.min(p[0],q[0])>Math.max(r[0],s[0])+pad||Math.min(r[0],s[0])>Math.max(p[0],q[0])+pad||Math.min(p[2],q[2])>Math.max(r[2],s[2])+pad||Math.min(r[2],s[2])>Math.max(p[2],q[2])+pad)continue;
   const intersects=cross(p,q,r)*cross(p,q,s)<=0&&cross(r,s,p)*cross(r,s,q)<=0&&Math.min(p[0],q[0])<=Math.max(r[0],s[0])&&Math.min(r[0],s[0])<=Math.max(p[0],q[0])&&Math.min(p[2],q[2])<=Math.max(r[2],s[2])&&Math.min(r[2],s[2])<=Math.max(p[2],q[2]);
   if(intersects||Math.min(dist(p,r,s),dist(q,r,s),dist(r,p,q),dist(s,p,q))<pad){conflict=true;break;}
  }
  if(conflict){const key=`lane:${out[i].id}:${ai}:${out[j].id}:${bi}`;a.narrowSectionIds.push(key);b.narrowSectionIds.push(key);}
 }));return out;
}

/** Front/rear terrain contacts define pitch. Side and mid-body samples prevent a crest
 * or cross-slope from piercing the rigid chassis, including while parked. */
export function busGroundPose(position:T.Vector3,yaw:number,length:number,width:number,height:(x:number,z:number)=>number){
 const s=Math.sin(yaw),c=Math.cos(yaw),half=length/2;
 const sample=(z:number,x=0)=>height(position.x+s*z+c*x,position.z+c*z-s*x);
 const front=sample(half),rear=sample(-half),pitch=T.MathUtils.clamp(Math.atan2(front-rear,length),-Math.PI/15,Math.PI/15),slope=Math.tan(pitch);
 let y=(front+rear)/2;
 for(const z of [-half,0,half])for(const x of [-width/2,0,width/2])y=Math.max(y,sample(z,x)-slope*z);
 return {y:y+.04,pitch};
}
