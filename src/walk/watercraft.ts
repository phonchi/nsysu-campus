import * as T from 'three';
import type {WaterRouteSpec,WaterBodySpec,WaterDecision,P3,WaterAvatarFrame} from '../world/v12-types';
import {inside,nearestOnPolygon,distance,motionDt} from './v12-geometry';
export class WatercraftRuntime {
 route?:WaterRouteSpec;water?:WaterBodySpec;readonly position=new T.Vector3();heading=0;
 rent(route:WaterRouteSpec,water:WaterBodySpec,from:P3,decision:WaterDecision){if(this.route||!decision.allowed||distance(from,route.launchPoint)>4||!route.waypoints.length)return false;this.route=route;this.water=water;this.position.set(route.waypoints[0][0],water.surfaceY,route.waypoints[0][1]);return true;}
 update(dt:number,direction:T.Vector3,decision:WaterDecision):'recall'|undefined {
  if(!this.route||!this.water)return;if(!decision.allowed)return 'recall';dt=motionDt(dt);
  const route=this.route,dir=direction.clone().setY(0).clampLength(0,1),speed=route.craft==='sup'?2.1:2.8;
  const next=this.position.clone().addScaledVector(dir,speed*dt);
  if(inside([next.x,next.z],route.corridor))this.position.copy(next);
  else{const q=nearestOnPolygon([next.x,next.z],route.corridor);this.position.set(q[0],this.water.surfaceY,q[1]);}
  for(const polygon of route.exclusions)if(inside([this.position.x,this.position.z],polygon))return 'recall';
  if(dir.lengthSq()>.01)this.heading=Math.atan2(-dir.x,-dir.z);
 }
 returnToShore():P3|undefined {if(!this.route)return;const p=this.route.returnPoint;if(Math.hypot(this.position.x-p[0],this.position.z-p[2])>15)return;this.clear();return [...p];}
 get frame():WaterAvatarFrame|undefined {if(!this.route)return;return {renderRootWorld:[this.position.x,this.position.y+(this.route.craft==='sup'?.13:.22),this.position.z],heading:this.heading,clip:this.route.craft==='sup'?'PaddleStand':'PaddleSit'};}
 clear(){this.route=undefined;this.water=undefined;}
}
/** Apply after the mixer; asset axes and grip segment come from README-v12.json. */
export function attachPaddle(paddle:T.Object3D,left:T.Object3D,right:T.Object3D,parent:T.Object3D,craft:'sup'|'kayak'){
 parent.updateWorldMatrix(true,false);left.updateWorldMatrix(true,false);right.updateWorldMatrix(true,false);
 const l=parent.worldToLocal(left.getWorldPosition(new T.Vector3())),r=parent.worldToLocal(right.getWorldPosition(new T.Vector3())),axis=l.clone().sub(r).normalize();
 paddle.quaternion.setFromUnitVectors(craft==='sup'?new T.Vector3(0,1,0):new T.Vector3(1,0,0),axis);
 if(craft==='sup')paddle.position.copy(r).addScaledVector(axis,-1.05);else paddle.position.copy(l).add(r).multiplyScalar(.5);
}
