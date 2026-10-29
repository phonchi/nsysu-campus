import {Box3,Ray,Vector3} from 'three';
export interface DoorBarrier {position:Vector3;outside:Vector3;inside:Vector3;closedBox:Box3;normal?:Vector3;}
export function occupiesDoor(door:DoorBarrier,foot:Vector3):boolean{return door.closedBox.clone().expandByScalar(.35).containsPoint(foot.clone().add(new Vector3(0,.8,0)));}
function entryFraction(door:DoorBarrier,foot:Vector3,direction:Vector3,dt:number,speed:number):number|undefined{
 const box=door.closedBox.clone().expandByScalar(.29),start=foot.clone().add(new Vector3(0,.8,0));if(box.containsPoint(start))return 0;
 const movement=direction.clone().multiplyScalar(dt*speed),length=movement.length();if(length<1e-8)return;
 const point=new Ray(start,movement.multiplyScalar(1/length)).intersectBox(box,new Vector3());if(!point)return;const d=point.distanceTo(start);if(d<=length+1e-8)return Math.max(0,(d-.001)/length);
}
export function wouldEnterDoor(door:DoorBarrier,foot:Vector3,direction:Vector3,dt:number,speed:number):boolean{return entryFraction(door,foot,direction,dt,speed)!==undefined;}
/** Sweep to contact, retain tangent movement and always permit retreat. */
export function slidePastClosedDoor(door:DoorBarrier,foot:Vector3,direction:Vector3,dt:number,speed:number):void{
 const fraction=entryFraction(door,foot,direction,dt,speed);if(fraction===undefined)return;
 const normal=door.normal?.clone()??door.outside.clone().sub(door.inside);normal.y=0;normal.normalize();const side=Math.sign(foot.clone().sub(door.position).dot(normal))||1,inward=direction.dot(normal);
 if(inward*side<0)direction.addScaledVector(normal,-inward*(1-fraction));
}
