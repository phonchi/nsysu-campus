import { Matrix4, Vector3 } from 'three';
import type { LiftSpec, Point2 } from '../walk-types';
import type { LiftGeometryV12, LiftPhase, LiftSnapshot } from '../world/v12-types';
const elevation=(storey:number)=>(storey<0?storey:storey-1)*3.7+.08;
/** Legacy fallback is deliberately schematic; authored landingDoor always wins. */
export function normalizeLift(lift:LiftSpec,buildingId:string):LiftGeometryV12 {
 const c=Math.cos(lift.angle),s=Math.sin(lift.angle),h=lift.size/2;
 const point=(x:number,z:number):Point2=>[lift.center[0]+c*x-s*z,lift.center[1]+s*x+c*z];
 // Legacy data stores evidence as a free-text string; keep it as the note of a schematic Evidence.
 const raw=lift.evidence as unknown,evidence=raw&&typeof raw==='object'?lift.evidence!:{sourceId:'legacy-campus-structure',locator:lift.id,basis:'schematic' as const,note:typeof raw==='string'&&raw?raw:'由舊 center/angle/size 推導'};
 return {...lift,buildingId:lift.buildingId??buildingId,cabinSize:lift.cabinSize??[lift.size-.16,lift.size-.16],
  shaftPolygon:lift.shaftPolygon??[point(-h,-h),point(h,-h),point(h,h),point(-h,h)],
  replacesServiceIds:lift.replacesServiceIds??[],evidence,
  stops:lift.stops.map(stop=>({...stop,approach:stop.approach??point(-h-.8,0),
   landingDoor:stop.landingDoor?{...stop.landingDoor,clearWidth:stop.landingDoor.clearWidth??.9}:{center:point(-h,0),tangent:[-s,c] as Point2,clearWidth:.9},evidence:stop.evidence&&typeof stop.evidence==='object'?stop.evidence:evidence})).sort((a,b)=>a.storey-b.storey)};
}
/** doorway: someone in the door sensor zone; cabin: the player stands in the car. */
export interface LiftOccupancy { doorway:boolean; cabin?:boolean }
/** Real seconds, independent of world clocks. Requests use a LOOK queue: finish the current
 * direction before reversing; a new request ahead can insert an intermediate stop. */
export class LiftRuntime {
 private phase:LiftPhase='idle'; private at:string; private target:string|null=null;
 private requests=new Set<string>(); private direction=0; private door=0; private dwell=0; private held=false;
 private y:number; readonly stops: {floorId:string;y:number}[]; private center:Vector3;
 constructor(readonly geometry:LiftGeometryV12,frame=new Matrix4(),readonly speed=1.8) {
  if(!geometry.stops.length)throw new Error(`${geometry.id}: 電梯沒有停靠層`);
  this.stops=geometry.stops.map(s=>({floorId:s.floorId,y:elevation(s.storey)})).sort((a,b)=>a.y-b.y);
  this.at=this.stops[0].floorId;this.y=this.stops[0].y;
  this.center=new Vector3(...[geometry.center[0],0,geometry.center[1]]).applyMatrix4(frame);
 }
 get snapshot():LiftSnapshot {return {id:this.geometry.id,phase:this.phase,atFloorId:this.phase==='moving'?null:this.at,targetFloorId:this.target,
  requestedFloorIds:this.stops.filter(s=>this.requests.has(s.floorId)).map(s=>s.floorId),doorOpen01:this.door,carPositionWorld:[this.center.x,this.y,this.center.z]};}
 call(floorId:string){return this.request(floorId);}
 select(floorId:string){return this.request(floorId);}
 holdOpen(){if(this.phase!=='moving'){this.held=true;if(this.phase==='closing'||this.phase==='idle')this.phase='opening';}}
 private request(id:string){
  if(!this.stops.some(s=>s.floorId===id))return false;
  if(this.phase!=='moving'&&id===this.at){this.holdOpen();this.dwell=0;return true;}
  this.requests.add(id);return true;
 }
 private depart(){const next=this.next();if(!next)return false;this.target=next.floorId;this.direction=Math.sign(next.y-this.y);this.phase='moving';return true;}
 private next(){
  const pending=this.stops.filter(s=>this.requests.has(s.floorId));
  const ahead=pending.filter(s=>(s.y-this.y)*this.direction>1e-6);
  const candidates=ahead.length?ahead:pending;
  return candidates.sort((a,b)=>Math.abs(a.y-this.y)-Math.abs(b.y-this.y)||a.floorId.localeCompare(b.floorId))[0];
 }
 update(realDt:number,occupancy:LiftOccupancy={doorway:false}):LiftSnapshot {
  if(!Number.isFinite(realDt)||realDt<0)throw new Error('電梯 dt 必須是非負有限秒數');
  // Bounded integration steps retain obstruction semantics across slow frames.
  let remaining=realDt;
  do {const dt=Math.min(remaining,.05);remaining-=dt;const before=this.phase;
   // A rider without a request keeps the car open at this floor; it never closes on them to idle.
   const stay=!!occupancy.cabin&&!this.requests.size;
   if(occupancy.doorway&&this.phase==='closing')this.phase='opening';
   switch(this.phase){
    // Doors are already shut in idle: depart directly, so a doorway at this floor cannot hold a remote call.
    case 'idle': if(this.requests.delete(this.at))this.phase='opening';else if(!this.depart()&&stay)this.phase='opening';break;
    case 'opening': this.door=Math.min(1,this.door+dt/0.8);if(this.door===1){this.phase='open';this.dwell=0;}break;
    case 'open': this.dwell=occupancy.doorway||this.held||stay?0:this.dwell+dt;if(this.dwell>=2)this.phase='closing';break;
    case 'closing':
     if(occupancy.doorway||this.held||stay){this.phase='opening';break;}
     this.door=Math.max(0,this.door-dt/.8);
     if(!this.door&&!this.depart()){this.phase='idle';this.target=null;this.direction=0;}break;
    case 'moving': {
     const next=this.next();if(!next){throw new Error('電梯行駛中遺失目標');}this.target=next.floorId;
     const delta=next.y-this.y,step=this.speed*dt;
     if(Math.abs(delta)<=step){this.y=next.y;this.at=next.floorId;this.requests.delete(this.at);this.target=null;this.phase='arrived';}
     else this.y+=Math.sign(delta)*step;
     break;
    }
    case 'arrived':this.phase='opening';break;
   }
   // Departure ends this update: the rider is attached at the car's start pose before it moves.
   if(before!=='moving'&&this.phase==='moving')break;
  }while(remaining>1e-8);
  this.held=false;return this.snapshot;
 }
}
