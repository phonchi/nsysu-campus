import * as T from 'three';
import type { WorldLift, WalkWorld } from '../walk-world';
import type { Obstacle } from './obstacles';
import type { LiftGeometryV12, LiftSnapshot, MotionMode, P3 } from '../world/v12-types';
import { LiftRuntime } from './lift';
const unit=new T.BoxGeometry(1,1,1),metal=new T.MeshStandardMaterial({color:'#8f9c98',roughness:.65}),segment=new T.MeshBasicMaterial({color:'#eedcad'});
/** World metres. The passenger zone is the cabin inset by the capsule radius; the door sensor reaches
 * from outside the landing to past the car door by more than that inset, so the two zones overlap. */
export const PASSENGER_MARGIN=.28,DOOR_SENSOR_OUTSIDE=.45,DOOR_SENSOR_INSIDE=PASSENGER_MARGIN+.04,DOOR_SENSOR_SIDE=.3;
/** Cabin-local vertical band of a rider: a jump or a slightly late frame stays in the car. */
const CABIN_LOW=-.2,CABIN_HIGH=2.2;
const tmp=new T.Vector3(),tmpScale=new T.Vector3();
const scaleOf=(lift:WorldLift)=>lift.car.getWorldScale(tmpScale).x||1;
const SEGMENTS:Record<string,string>={'0':'1111110','1':'0110000','2':'1101101','3':'1111001','4':'0110011','5':'1011011','6':'1011111','7':'1110000','8':'1111111','9':'1111011','-':'0000001','R':'0000101'};
function solid(g:T.Group,id:string,w:number,h:number,d:number,x:number,y:number,z:number){
 const mesh=new T.Mesh(unit,metal);mesh.name=id;mesh.scale.set(w,h,d);mesh.position.set(x,y,z);mesh.userData.liftSolid=true;g.add(mesh);return mesh;
}
function door(g:T.Group,width:number,id:string){
 return [-1,1].map((side,i)=>solid(g,`${id}:${i}`,width/2,2.25,.06,side*width/4,1.125,0));
}
/** Seven-segment display: no DOM/canvas needed in bake or node tests. */
function floorDisplay(parent:T.Group,height=2.55,size=1){
 const g=new T.Group();g.position.set(.2*size,height,0);g.scale.set(size,size,1);parent.add(g);
 const bars=[[0,.14,.16,.025],[.085,.07,.025,.12],[.085,-.07,.025,.12],[0,-.14,.16,.025],[-.085,-.07,.025,.12],[-.085,.07,.025,.12],[0,0,.16,.025]];
 const digits=Array.from({length:2},(_,n)=>bars.map(([x,y,w,h])=>{const m=new T.Mesh(unit,segment);m.scale.set(w,h,.035);m.position.set(x+(n-1)*.24,y,.06);g.add(m);return m;}));
 return (label:string)=>{const chars=label.replace(/F/g,'').replace('B','-').slice(-2).padStart(2,' '),masks=SEGMENTS;digits.forEach((bars,i)=>bars.forEach((m,j)=>m.visible=masks[chars[i]]?.[j]==='1'));};
}
export function makeWorldLift(geometry:LiftGeometryV12,frame:T.Matrix4,labels:Map<string,string>,parent:T.Group):WorldLift {
 const runtime=new LiftRuntime(geometry,frame),group=new T.Group();group.name=`Lift ${geometry.id}`;group.userData.dynamicDoor=true;parent.add(group);
 const car=new T.Group();car.name=`Car ${geometry.id}`;car.userData.liftCab=geometry.id;car.userData.dynamicDoor=true;group.add(car);
 car.position.set(geometry.center[0],runtime.snapshot.carPositionWorld[1],geometry.center[1]);car.rotation.y=-geometry.angle;
 const [w,d]=geometry.cabinSize;
 solid(car,`${geometry.id}:floor`,w,.1,d,0,-.05,0);
 solid(car,`${geometry.id}:ceiling`,w,.1,d,0,2.55,0);
 // The car opening is projected from the authoritative landing, never guessed from angle.
 const first=geometry.stops[0],inverseCar=new T.Matrix4().makeRotationY(geometry.angle);
 const p=new T.Vector3(first.landingDoor.center[0]-geometry.center[0],0,first.landingDoor.center[1]-geometry.center[1]).applyMatrix4(inverseCar);
 const tangent=new T.Vector3(first.landingDoor.tangent[0],0,first.landingDoor.tangent[1]).applyMatrix4(inverseCar).normalize();
 const width=first.landingDoor.clearWidth,edges=[[-w/2,-d/2,w/2,-d/2],[w/2,-d/2,w/2,d/2],[w/2,d/2,-w/2,d/2],[-w/2,d/2,-w/2,-d/2]];
 let nearest=0,best=Infinity;
 edges.forEach(([ax,az,bx,bz],i)=>{const t=T.MathUtils.clamp(((p.x-ax)*(bx-ax)+(p.z-az)*(bz-az))/((bx-ax)**2+(bz-az)**2),0,1),dist=Math.hypot(p.x-ax-(bx-ax)*t,p.z-az-(bz-az)*t);if(dist<best){best=dist;nearest=i;}});
 let carDoorPoint=new T.Vector3();
 edges.forEach(([ax,az,bx,bz],i)=>{
  const len=Math.hypot(bx-ax,bz-az),ux=(bx-ax)/len,uz=(bz-az)/len;
  const cut=T.MathUtils.clamp((p.x-ax)*ux+(p.z-az)*uz,width/2,len-width/2);
  const spans=i===nearest?[[0,cut-width/2],[cut+width/2,len]]:[[0,len]];
  spans.forEach(([a,b],j)=>{if(b-a<=0)return;const m=solid(car,`${geometry.id}:wall:${i}:${j}`,b-a,2.5,.08,ax+ux*(a+b)/2,1.25,az+uz*(a+b)/2);m.rotation.y=-Math.atan2(uz,ux);});
  if(i===nearest)carDoorPoint.set(ax+ux*cut,0,az+uz*cut);
 });
 car.userData.carDoor=[carDoorPoint.x,carDoorPoint.z];
 const carDoor=new T.Group();carDoor.position.copy(carDoorPoint);carDoor.rotation.y=-Math.atan2(tangent.z,tangent.x);car.add(carDoor);
 const carPanels=door(carDoor,width,`${geometry.id}:car-door`);
 solid(carDoor,`${geometry.id}:header`,width,.25,.08,0,2.375,0);
 // Face the cabin, irrespective of the authored landing tangent's sign.
 const displayMount=new T.Group();displayMount.name=`Cabin floor display ${geometry.id}`;
 displayMount.rotation.y=new T.Vector3(0,0,1).applyQuaternion(carDoor.quaternion).dot(carDoorPoint)>0?Math.PI:0;
 carDoor.add(displayMount);
 const carDisplay=floorDisplay(displayMount,2.32,.75);
 const panel=solid(car,`${geometry.id}:panel`,.04,.28,.16,w/2-.1,1.2,0);panel.userData.liftSolid=false;
 const stops:WorldLift['stops']=geometry.stops.map(s=>{
  const position=new T.Vector3(geometry.center[0],(s.storey<0?s.storey:s.storey-1)*3.7+.08,geometry.center[1]).applyMatrix4(frame);
  const landing=new T.Group();landing.position.set(...[s.landingDoor.center[0],position.y,s.landingDoor.center[1]]);landing.rotation.y=-Math.atan2(s.landingDoor.tangent[1],s.landingDoor.tangent[0]);group.add(landing);
  const panels=door(landing,s.landingDoor.clearWidth,`${geometry.id}:${s.floorId}:door`),display=floorDisplay(landing);
  const button=solid(landing,`${geometry.id}:${s.floorId}:call`,.10,.18,.08,s.landingDoor.clearWidth/2+.18,1.2,.08);button.userData.liftSolid=false;
  return {floorId:s.floorId,label:labels.get(s.floorId)??String(s.level),level:s.level,position,
   approach:new T.Vector3(s.approach[0],position.y,s.approach[1]).applyMatrix4(frame),landing,panels,display};
 });
 const result:WorldLift={id:geometry.id,buildingId:geometry.buildingId,center:new T.Vector3(geometry.center[0],0,geometry.center[1]).applyMatrix4(frame),geometry,runtime,car,carPanels,carDisplay,group,stops};
 syncLift(result);return result;
}
export function syncLift(lift:WorldLift){
 const s=lift.runtime.snapshot;lift.car.position.y=s.carPositionWorld[1];
 lift.carDisplay(lift.stops.find(t=>t.floorId===(s.atFloorId??s.targetFloorId))?.label??'');
 lift.carPanels.forEach((p,i)=>p.position.x=(i?1:-1)*lift.geometry.stops[0].landingDoor.clearWidth*(.25+.5*s.doorOpen01));
 for(const stop of lift.stops){const open=s.atFloorId===stop.floorId?s.doorOpen01:0,width=lift.geometry.stops.find(s=>s.floorId===stop.floorId)!.landingDoor.clearWidth;
  stop.panels.forEach((p,i)=>p.position.x=(i?1:-1)*width*(.25+.5*open));
  stop.display(lift.stops.find(t=>t.floorId===(s.atFloorId??s.targetFloorId))?.label??'');}
 lift.group.updateWorldMatrix(true,true);
}
/** Cabin-local view, independent of the rider's entry heading, pitch and foot anchor.
 * Stay near the centre with ample near-plane clearance, looking toward the actual door.
 * Building rotation and horizontal scale are applied by localToWorld, just like the car. */
export function setLiftCamera(lift:WorldLift,camera:T.PerspectiveCamera){
 const [x,z]=lift.car.userData.carDoor as [number,number];
 camera.position.copy(lift.car.localToWorld(new T.Vector3(-x*.35,1.55,-z*.35)));
 camera.lookAt(lift.car.localToWorld(new T.Vector3(x,1.9,z)));
 camera.updateMatrixWorld(true);
}
/** Rig yaw that looks from the car centre towards its door, so W walks out after arrival. */
export function liftDoorYaw(lift:WorldLift){
 const [x,z]=lift.car.userData.carDoor as [number,number];
 const c=lift.car.localToWorld(new T.Vector3(0,0,0)),d=lift.car.localToWorld(new T.Vector3(x,0,z)).sub(c);
 return Math.atan2(-d.x,-d.z);
}
export function liftObstacles(lifts:readonly WorldLift[]):Obstacle[]{
 const out:Obstacle[]=[],pos=new T.Vector3(),scale=new T.Vector3(),q=new T.Quaternion(),e=new T.Euler(0,0,0,'YXZ');
 for(const lift of lifts)lift.group.traverse(o=>{if(!(o instanceof T.Mesh)||!o.userData.liftSolid)return;o.matrixWorld.decompose(pos,q,scale);e.setFromQuaternion(q);out.push({id:o.name,shape:'box',center:pos.toArray(),half:[scale.x/2,scale.y/2,scale.z/2],yaw:e.y,navigation:false});});
 return out;
}
/** `margin` is an inset in world metres from the cabin walls. */
export function insideLift(lift:WorldLift,foot:T.Vector3,margin=0){
 const p=lift.car.worldToLocal(tmp.copy(foot)),[w,d]=lift.geometry.cabinSize,m=margin/scaleOf(lift);
 return p.y>CABIN_LOW&&p.y<CABIN_HIGH&&Math.abs(p.x)<w/2-m&&Math.abs(p.z)<d/2-m;
}
/** Door sensor at the current floor, measured in world metres from the landing door to past the
 * car door. Fully closed doors sense nothing, so a waiting person cannot hold a remote call. */
export function liftDoorOccupied(lift:WorldLift,feet:readonly T.Vector3[]){
 const s=lift.runtime.snapshot;if(s.doorOpen01<=0)return false;
 const stop=lift.stops.find(t=>t.floorId===s.atFloorId);if(!stop)return false;
 const width=lift.geometry.stops.find(t=>t.floorId===stop.floorId)!.landingDoor.clearWidth,scale=scaleOf(lift);
 const [cx,cz]=(lift.car.userData.carDoor as [number,number]|undefined)??[0,0];
 const inner=stop.landing.worldToLocal(lift.car.localToWorld(tmp.set(cx,0,cz))).z,sign=Math.sign(inner)||1;
 const outside=-DOOR_SENSOR_OUTSIDE/scale,inside=Math.abs(inner)+DOOR_SENSOR_INSIDE/scale,side=width/2+DOOR_SENSOR_SIDE/scale;
 return feet.some(foot=>{const p=stop.landing.worldToLocal(tmp.copy(foot)),z=p.z*sign;return Math.abs(p.y)<.6&&Math.abs(p.x)<side&&z>outside&&z<inside;});
}
/** Shared by lifts and buses: a single carrier-local foot anchor, independent of gravity. */
export class CarrierAnchor {
 local:P3=[0,0,0];
 capture(carrier:T.Object3D,foot:T.Vector3){this.local=carrier.worldToLocal(foot.clone()).toArray();return this.local;}
 follow(carrier:T.Object3D){return carrier.localToWorld(new T.Vector3(...this.local));}
 clear(){this.local=[0,0,0];}
}
/** About to leave or travelling: doors shut and a destination is pending. */
export function liftDeparting(s:LiftSnapshot){
 return s.doorOpen01<=0&&(s.phase==='moving'||s.phase==='arrived'||((s.phase==='idle'||s.phase==='closing')&&s.requestedFloorIds.length>0));
}
/** Carries the foot anchor only from departure until the doors are open again. Standing in an idle
 * or open car never locks the rider. On release, normal physics resumes on the same car floor.
 * No floor-selection teleport is involved. */
export class LiftPassenger {
 motion:MotionMode={kind:'walk'};
 private lift?:WorldLift;
 private anchor=new CarrierAnchor();
 get carried(){return this.motion.kind==='carried';}
 updateCamera(camera:T.PerspectiveCamera){if(this.lift&&this.carried)setLiftCamera(this.lift,camera);}
 /** World yaw (camera-rig convention, forward = (-sin, 0, -cos)) that faces the car door, while carried. */
 doorYaw(){if(!this.lift||!this.carried)return undefined;return liftDoorYaw(this.lift);}
 update(world:Pick<WalkWorld,'lifts'>,foot:T.Vector3,enabled=true):T.Vector3|undefined {
  if(this.lift&&this.motion.kind==='carried'){
   const p=this.anchor.follow(this.lift.car),s=this.lift.runtime.snapshot;
   if(s.phase==='open'||(s.phase==='idle'&&!s.requestedFloorIds.length))this.clear();return p;
  }
  if(enabled)for(const lift of world.lifts){
   if(liftDeparting(lift.runtime.snapshot)&&insideLift(lift,foot,PASSENGER_MARGIN)){
    this.anchor.capture(lift.car,foot);this.anchor.local[1]=0;
    this.lift=lift;this.motion={kind:'carried',carrier:'lift',id:lift.id,localAnchor:this.anchor.local};return this.anchor.follow(lift.car);
   }
  }
 }
 clear(){this.lift=undefined;this.anchor.clear();this.motion={kind:'walk'};}
}
