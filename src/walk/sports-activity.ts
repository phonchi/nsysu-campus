import type {TimedCourse,FitnessPortal,EquipmentSpec,P3,MotionMode} from '../world/v12-types';
import {distance,segmentInside,inside} from './v12-geometry';
export interface BestStorage {getItem(key:string):string|null;setItem(key:string,value:string):void}
export class TimedSports {
 course?:TimedCourse;elapsed=0;next=0;result?:{seconds:number;valid:boolean;reason?:string};best:Record<string,number>={};private previous?:P3;
 constructor(private storage?:BestStorage){try{const v=JSON.parse(storage?.getItem('habbit-sports-v12')??'{}');for(const [id,t]of Object.entries(v))if(typeof t==='number'&&Number.isFinite(t)&&t>0)this.best[id]=t;}catch{/* session records still work */}}
 start(course:TimedCourse,position:P3){const first=course.gates.find(g=>g.id===course.requiredGateSequence[0]);if(!first||!inside([position[0],position[2]],course.corridor)||((position[0]-(first.a[0]+first.b[0])/2)*first.direction[0]+(position[2]-(first.a[2]+first.b[2])/2)*first.direction[1])>=-1e-5)return false;this.course=course;this.elapsed=0;this.next=0;this.result=undefined;this.previous=[...position];return true;}
 invalidate(reason:string){if(!this.course)return;this.result={seconds:this.elapsed,valid:false,reason};this.course=undefined;this.previous=undefined;}
 update(dt:number,position:P3,motion:MotionMode){
  const c=this.course,prev=this.previous;if(!c||!prev)return;
  if(motion.kind!==(c.mode==='run'?'walk':'swim')||c.waterId&&motion.kind==='swim'&&motion.waterId!==c.waterId){this.invalidate('本次移動模式不符');return;}
  if(distance(prev,position)>Math.max(1,dt*(c.mode==='run'?9:3))){this.invalidate('位置跳接');return;}
  if(!segmentInside(prev,position,c.corridor)){this.invalidate('離開賽道');return;}
  this.elapsed+=dt;
  const crossings:{gate:TimedCourse['gates'][number];t:number;forward:boolean}[]=[];
  for(const gate of c.gates){
   const dx=gate.b[0]-gate.a[0],dz=gate.b[2]-gate.a[2],moveX=position[0]-prev[0],moveZ=position[2]-prev[2],den=moveX*dz-moveZ*dx;
   if(Math.abs(den)<1e-9)continue;
   const ax=gate.a[0]-prev[0],az=gate.a[2]-prev[2],t=(ax*dz-az*dx)/den,u=(ax*moveZ-az*moveX)/den;
   if(t<=1e-8||t>1||u<0||u>1||Math.abs(position[1]-gate.a[1])>2)continue;
   crossings.push({gate,t,forward:moveX*gate.direction[0]+moveZ*gate.direction[1]>0});
  }
  for(const {gate,t,forward} of crossings.sort((a,b)=>a.t-b.t)){
   if(!forward){if(gate.id===c.requiredGateSequence[this.next]){this.invalidate('逆向通過 gate');return;}continue;}
   if(gate.id!==c.requiredGateSequence[this.next]){this.invalidate('gate 順序錯誤');return;}
   this.next++;
   if(this.next===c.requiredGateSequence.length){this.elapsed-=dt*(1-t);this.result={seconds:this.elapsed,valid:true};this.best[c.id]=Math.min(this.best[c.id]??Infinity,this.elapsed);try{this.storage?.setItem('habbit-sports-v12',JSON.stringify(this.best));}catch{/* retain in memory */}this.course=undefined;return;}
  }
  this.previous=[...position];
 }
}
export class FitnessRuntime {
 portal?:FitnessPortal;equipment?:EquipmentSpec;
 constructor(private safe:(p:P3)=>boolean){}
 enter(portal:FitnessPortal,foot:P3):P3|undefined {if(this.portal||distance(foot,portal.exteriorTrigger)>3||!this.safe(portal.interiorSpawn))return;this.portal=portal;return [...portal.interiorSpawn];}
 exit():P3|undefined {if(!this.portal)return;const p=this.portal.exteriorReturnPoints.find(this.safe);if(p){this.equipment=undefined;this.portal=undefined;return [...p];}}
 use(equipment:EquipmentSpec,foot:P3){if(!this.portal||distance(foot,equipment.approach)>2.5)return false;this.equipment=equipment;return true;}
 stop():P3|undefined {const e=this.equipment;const p=e?[...e.exitPoints,e.approach,...this.portal?[this.portal.interiorSpawn]:[]].find(this.safe):undefined;if(p){this.equipment=undefined;return [...p];}}
 clear(){this.portal=undefined;this.equipment=undefined;}
}
