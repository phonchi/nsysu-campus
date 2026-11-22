import {Vector3} from 'three';
import type {Point2} from '../walk-types';
import type {P3} from '../world/v12-types';
export function inside(p:Point2,poly:Point2[]){let yes=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const a=poly[i],b=poly[j];if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])yes=!yes;}return yes;}
export function nearestOnPolygon(p:Point2,poly:Point2[]):Point2 {let best:Point2=[...p],distance=Infinity;poly.forEach((a,i)=>{const b=poly[(i+1)%poly.length],dx=b[0]-a[0],dz=b[1]-a[1],t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dz)/(dx*dx+dz*dz||1))),q:Point2=[a[0]+dx*t,a[1]+dz*t],d=Math.hypot(q[0]-p[0],q[1]-p[1]);if(d<distance){best=q;distance=d;}});return best;}
export const distance=(a:P3,b:P3)=>Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]);
export function pathLength(path:P3[]){return path.reduce((n,p,i)=>n+(i?distance(p,path[i-1]):0),0);}
export function samplePath(path:P3[],at:number):{position:P3;yaw:number;pitch:number}{
 if(!path.length)throw Error('路徑為空');for(let i=1;i<path.length;i++){const a=path[i-1],b=path[i],len=distance(a,b);if(at<=len||i===path.length-1){const t=Math.max(0,Math.min(1,at/(len||1)));return {position:a.map((n,k)=>n+(b[k]-n)*t) as P3,yaw:Math.atan2(b[0]-a[0],b[2]-a[2]),pitch:Math.atan2(b[1]-a[1],Math.hypot(b[0]-a[0],b[2]-a[2]))};}at-=len;}return {position:[...path[0]],yaw:0,pitch:0};
}
export function followPoints(position:Vector3,path:P3[],budget:number){while(path.length&&budget>0){const goal=new Vector3(...path[0]),d=position.distanceTo(goal);if(d<=budget){position.copy(goal);path.shift();budget-=d;}else{position.lerp(goal,budget/d);budget=0;}}return !path.length;}
export function segmentInside(a:P3,b:P3,polygon:Point2[],step=.25){const n=Math.max(1,Math.ceil(distance(a,b)/step));for(let i=0;i<=n;i++){const t=i/n;if(!inside([a[0]+(b[0]-a[0])*t,a[2]+(b[2]-a[2])*t],polygon))return false;}return true;}

/** Cached arc lengths keep per-frame bus look-ahead logarithmic in route size. */
export class PathSampler {
 readonly cumulative:number[]=[0];readonly length:number;
 constructor(readonly path:P3[]){if(path.length<2)throw Error('路徑至少需要兩點');for(let i=1;i<path.length;i++)this.cumulative.push(this.cumulative[i-1]+distance(path[i-1],path[i]));this.length=this.cumulative.at(-1)!;}
 private segment(at:number){let lo=1,hi=this.path.length-1;while(lo<hi){const mid=(lo+hi)>>1;if(this.cumulative[mid]<at)lo=mid+1;else hi=mid;}return lo;}
 point(at:number):P3 {const i=this.segment(at),a=this.path[i-1],b=this.path[i],t=Math.max(0,Math.min(1,(at-this.cumulative[i-1])/(this.cumulative[i]-this.cumulative[i-1]||1)));return [a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,a[2]+(b[2]-a[2])*t];}
 pose(at:number){const i=this.segment(at),a=this.path[i-1],b=this.path[i];return {position:this.point(at),yaw:Math.atan2(b[0]-a[0],b[2]-a[2]),pitch:Math.atan2(b[1]-a[1],Math.hypot(b[0]-a[0],b[2]-a[2]))};}
}

export const SHORE_REACH=2.5,SHORE_CLEARANCE=.4;
/** Dry capsule clearance and bounded shore transfer; the polygon is the water exclusion. */
export function validLanding(point:P3,polygon:Point2[]){const p:Point2=[point[0],point[2]],edge=nearestOnPolygon(p,polygon),d=Math.hypot(p[0]-edge[0],p[1]-edge[1]);return !inside(p,polygon)&&d>=SHORE_CLEARANCE-1e-8&&d<=SHORE_REACH;}
export function landingReach(from:P3,to:P3,polygon:Point2[]){if(!validLanding(to,polygon))return false;const edge=nearestOnPolygon([to[0],to[2]],polygon);return Math.hypot(from[0]-edge[0],from[2]-edge[1])<SHORE_REACH;}
export const motionDt=(dt:number)=>Number.isFinite(dt)?Math.max(0,Math.min(.25,dt)):0;
