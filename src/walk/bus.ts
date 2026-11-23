import * as T from 'three';
import type {BusRouteSpec,BusStopSpec} from './bus-types';
import type {P3} from '../world/v12-types';
import {pathLength,samplePath} from './v12-geometry';

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

export function outsideBus(bus:{position:T.Vector3;yaw:number;route:BusRouteSpec},p:P3){const x=p[0]-bus.position.x,z=p[2]-bus.position.z,c=Math.cos(bus.yaw),s=Math.sin(bus.yaw);return Math.abs(c*x-s*z)>bus.route.vehicle.widthM/2+.4||Math.abs(s*x+c*z)>bus.route.vehicle.lengthM/2+.4;}
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
