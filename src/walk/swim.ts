import {Vector3} from 'three';
import type {WaterBodySpec,WaterDecision,WaterAvatarFrame,P3} from '../world/v12-types';
import {inside,nearestOnPolygon,followPoints,distance,validLanding,landingReach,motionDt} from './v12-geometry';
export class SwimRuntime {
 water?:WaterBodySpec;phase:'dry'|'swim'|'rescue'='dry';readonly position=new Vector3();stamina=1;heading=0;
 private wallSeconds=0;private moving=false;private destination?:P3;waitingForReturn=false;
 constructor(private whistle:()=>void=()=>{},private safe:(p:P3)=>boolean=()=>true,private resolve:(p:P3)=>P3|undefined=p=>p){}
 private landing(p:P3){const q=this.resolve(p);return q&&this.water&&validLanding(q,this.water.polygon)&&this.safe(q)?q:undefined;}
 enter(water:WaterBodySpec,from:P3,decision:WaterDecision){
  if(this.phase!=='dry'||!decision.allowed||!water.entryPoints.some(p=>validLanding(p,water.polygon)&&distance(p,from)<3)||!water.safeReturnPoints.some(p=>{const q=this.resolve(p);return q&&validLanding(q,water.polygon)&&this.safe(q);}))return false;
  let p:[number,number]=[from[0],from[2]];
  if(!inside(p,water.polygon)){p=nearestOnPolygon(p,water.polygon);let found=false;for(let r=.15;r<=1&&!found;r+=.15)for(let k=0;k<16;k++){const q:[number,number]=[p[0]+Math.cos(k*Math.PI/8)*r,p[1]+Math.sin(k*Math.PI/8)*r];if(inside(q,water.polygon)){p=q;found=true;break;}}if(!found)return false;}
  this.water=water;this.phase='swim';this.position.set(p[0],water.surfaceY,p[1]);this.stamina=1;return true;
 }
 adoptForRescue(water:WaterBodySpec,position:P3){if(this.phase==='rescue')return;this.water=water;this.phase='swim';this.position.fromArray(position);this.recall();}
 recall(){
  if(!this.water||this.phase==='rescue')return;
  this.phase='rescue';this.moving=false;this.whistle();
  this.destination=this.nearestReturn();this.waitingForReturn=!this.destination;
 }
 private nearestReturn(){return this.water?.safeReturnPoints.map(p=>this.landing(p)).filter((p):p is P3=>!!p).sort((a,b)=>distance(a,this.position.toArray())-distance(b,this.position.toArray()))[0];}
 /** Any clear pool coping can be climbed; authored exits remain available too. */
 exitPoint():P3|undefined {
  if(!this.water||this.phase!=='swim')return;
  const w=this.water;
  if(w.kind==='pool'){
   const edge=nearestOnPolygon([this.position.x,this.position.z],w.polygon);
   if(Math.hypot(edge[0]-this.position.x,edge[1]-this.position.z)<1.5){
    for(let k=0;k<16;k++){const a=k*Math.PI/8,p:P3=[edge[0]+Math.cos(a)*.8,w.surfaceY+.15,edge[1]+Math.sin(a)*.8],q=this.landing(p);if(q)return q;}
   }
  }
  return w.exitPoints.filter(p=>this.canExitTo(p)).map(p=>this.landing(p)).find((p):p is P3=>!!p);
 }
 update(dt:number,direction:Vector3,decision:WaterDecision,timing=false):P3|undefined {
  if(!this.water)return;const rescueDt=Number.isFinite(dt)?Math.max(0,dt):0;dt=motionDt(dt);
  if(this.phase==='swim'){
   if(!decision.allowed||this.stamina<=0)this.recall();
   else {
    const d=direction.clone().setY(0).clampLength(0,1);this.moving=d.lengthSq()>.01;if(this.moving)this.heading=Math.atan2(-d.x,-d.z);
    const next=this.position.clone().addScaledVector(d,dt*1.65);
    if(!inside([next.x,next.z],this.water.polygon)){
     if(this.water.kind==='pool'){
      // Stop just inside the wall. Timing always keeps the swimmer in the pool.
      let lo=0,hi=1;for(let i=0;i<20;i++){const t=(lo+hi)/2,q=this.position.clone().lerp(next,t);if(inside([q.x,q.z],this.water.polygon))lo=t;else hi=t;}
      this.position.lerp(next,Math.max(0,lo-1e-4));this.moving=false;this.wallSeconds=timing?0:this.wallSeconds+dt;
      if(this.wallSeconds>=1){const p=this.exitPoint();if(p){this.clear();return p;}}return;
     }
     this.recall();
    }else{this.wallSeconds=0;this.position.copy(next);this.position.y=this.water.surfaceY;this.stamina=Math.max(0,this.stamina-dt*(this.moving?1/90:1/240));if(this.stamina<=0)this.recall();}
   }
  }
  if(this.phase==='rescue'){
   // Recheck occupancy, but never restart at an offshore authored waypoint.
   if(!this.destination||!this.landing(this.destination))this.destination=this.nearestReturn();
   const target=this.destination;this.waitingForReturn=!target;if(!target)return;
   // Use a single budget: no double movement at the water/shore transition.
   if(followPoints(this.position,[[...target]],rescueDt*2.5)&&this.landing(target)){const p=[...target] as P3;this.clear();return p;}
  }
 }
 canExitTo(p:P3){return this.phase==='swim'&&!!this.water&&landingReach(this.position.toArray(),p,this.water.polygon);}
 exit():P3|undefined {const p=this.exitPoint();if(p){this.clear();return [...p];}}
 get frame():WaterAvatarFrame|undefined {return this.water?{renderRootWorld:this.position.toArray(),heading:this.heading,clip:this.phase==='swim'&&this.moving?'Swim':'Tread'}:undefined;}
 /** Capsule floats above the surface, while the animated root stays on it. */
 get foot(){return this.position.clone().add(new Vector3(0,.8,0));}
 clear(){this.wallSeconds=0;this.phase='dry';this.water=undefined;this.destination=undefined;this.moving=false;this.waitingForReturn=false;}
}
