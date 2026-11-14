import * as T from 'three';
import {soleSide,solveLimb} from '../walk/ride-rig';
import type {SupportAt} from '../walk/obstacles';
export interface SeatSpec {
 foot:[number,number];y?:number;yaw:number;pose:'chair';surfaceHeight:number;approachRadius:number;
 prop:{kind:'bench';offset:[number,number,number];yaw:number;scale?:number};
}
export interface Seat {id:string;spec:SeatSpec;foot:T.Vector3}
export interface SeatView {eyeHeight:number;pivotHeight:number;offsetX:number;offsetZ:number}
/** Shared occupancy for NPCs and player. A claim can only be released by its owner. */
export class SeatRegistry {
 enabled=true;
 private owners=new Map<string,string>();
 constructor(readonly specs:Record<string,SeatSpec>,private support:SupportAt,private terrain:(x:number,z:number)=>number){}
 get(id:string):Seat|undefined{const spec=this.specs[id];if(!spec)return;const [x,z]=spec.foot,reference=spec.y??this.terrain(x,z),y=spec.y??this.support(x,z,reference);return y===undefined?undefined:{id,spec,foot:new T.Vector3(x,y,z)};}
 claim(id:string,owner:string){if(!this.enabled)return false;const who=this.owners.get(id);if(who&&who!==owner)return false;if(!this.get(id))return false;this.owners.set(id,owner);return true;}
 release(id:string,owner:string){if(this.owners.get(id)===owner)this.owners.delete(id);}
 available(id:string,owner:string){return this.enabled&&(!this.owners.has(id)||this.owners.get(id)===owner);}
}
export function withinSeatApproach(seat:Seat,foot:T.Vector3){return Math.hypot(foot.x-seat.foot.x,foot.z-seat.foot.z)<=seat.spec.approachRadius&&Math.abs(foot.y-seat.foot.y)<.2;}
export function seatApproach(seat:Seat){return seat.foot.clone().add(new T.Vector3(-Math.sin(seat.spec.yaw)*.48,0,-Math.cos(seat.spec.yaw)*.48));}
// Fable's zero offsets are provisional. Once written into the data, the explicit offset wins.
export function calibratedBenchOffset(spec:SeatSpec):T.Vector3{return new T.Vector3(...(spec.prop.offset.every(v=>v===0)?[0,0,.22]:spec.prop.offset));}
const pos=(o:T.Object3D)=>o.getWorldPosition(new T.Vector3());
const setWorld=(o:T.Object3D,p:T.Vector3)=>{o.position.copy(o.parent?o.parent.worldToLocal(p.clone()):p);o.updateWorldMatrix(false,true);};
/** Contact correction applied after Sit sampling, restored before the next mixer tick.
 * Body/pelvis shifts; independent foot targets and leg IK keep the soles on support. */
export class ChairPose {
 private bones=new Map<string,T.Object3D>();
 private ankles=new Map<string,T.Object3D>();
 private samples:{mesh:T.SkinnedMesh;hips:number[];feet:{L:number[];R:number[]}}[]=[];
 private restore?:Map<T.Object3D,{p:T.Vector3;q:T.Quaternion}>;
 view?:SeatView;
 diagnostics?:{lift:number;contact:number;surface:number;feet:number[];legErrors:number[];eyeHeight:number;contactPoint:number[]};
 constructor(private model:T.Object3D,private root:T.Object3D){
  model.updateWorldMatrix(true,true);model.traverse(o=>{if(o instanceof T.Bone)this.bones.set(o.name.replace(/\./g,''),o);});
  for(const side of ['L','R']){const lower=this.bones.get('LowerLeg'+side),foot=this.bones.get('Foot'+side);if(lower&&foot){const ankle=new T.Object3D();ankle.position.copy(lower.worldToLocal(pos(foot)));lower.add(ankle);this.ankles.set(side,ankle);}}
  model.traverse(o=>{
   if(!(o instanceof T.SkinnedMesh)||o.userData.outlineHull)return;
   const hips:number[]=[],feet:{L:number[];R:number[]}={L:[],R:[]},a=o.geometry.attributes;
   if(!a.skinIndex||!a.skinWeight)return;
   for(let i=0;i<a.position.count;i++){
    const ids=[a.skinIndex.getX(i),a.skinIndex.getY(i),a.skinIndex.getZ(i),a.skinIndex.getW(i)],weights=[a.skinWeight.getX(i),a.skinWeight.getY(i),a.skinWeight.getZ(i),a.skinWeight.getW(i)];
    if(o.skeleton.bones[ids[weights.indexOf(Math.max(...weights))]]?.name==='Hips')hips.push(i);
    const side=soleSide(o,i);if(side)feet[side].push(i);
   }
   this.samples.push({mesh:o,hips,feet});
  });
 }
 release(){if(this.restore){for(const[o,v]of this.restore){o.position.copy(v.p);o.quaternion.copy(v.q);}this.restore=undefined;this.model.updateWorldMatrix(true,true);}this.view=undefined;}
 private points(kind:'hips'|'L'|'R'){
  this.root.updateMatrixWorld(true); // SkinnedMesh updates bindMatrixInverse here (updateWorldMatrix alone does not).
  const points:T.Vector3[]=[];
  for(const s of this.samples){s.mesh.skeleton.update();for(const i of kind==='hips'?s.hips:s.feet[kind])points.push(s.mesh.getVertexPosition(i,new T.Vector3()).applyMatrix4(s.mesh.matrixWorld));}
  return points;
 }
 apply(seat:Seat,physicalFoot:T.Vector3,support:SupportAt){
  const body=this.bones.get('Body'),head=this.bones.get('Head');if(!body||!head)return;
  this.restore=new Map();this.model.traverse(o=>this.restore!.set(o,{p:o.position.clone(),q:o.quaternion.clone()}));
  const delta=seat.foot.clone().sub(this.root.position);delta.y=0;
  setWorld(this.model,pos(this.model).add(delta));this.model.updateWorldMatrix(true,true);
  const hips=this.points('hips');if(!hips.length){this.release();return;}
  const surface=seat.foot.y+seat.spec.surfaceHeight;let lift=surface-Math.min(...hips.map(p=>p.y));
  const targets=['L','R'].map(side=>{const foot=this.bones.get('Foot'+side)!,points=this.points(side as 'L'|'R'),p=pos(foot);const y=support(p.x,p.z,seat.foot.y)??seat.foot.y;return {side,foot,target:p.add(new T.Vector3(0,y-Math.min(...points.map(p=>p.y)),0))};});
  setWorld(body,pos(body).add(new T.Vector3(0,lift,0)));
  let errors:number[]=[];
  for(let iteration=0;iteration<4;iteration++){
   if(iteration){const correction=surface-Math.min(...this.points('hips').map(p=>p.y));lift+=correction;setWorld(body,pos(body).add(new T.Vector3(0,correction,0)));}
   errors=[];
  for(const {side,foot,target}of targets){const upper=this.bones.get('UpperLeg'+side),lower=this.bones.get('LowerLeg'+side),end=this.ankles.get(side);if(!upper||!lower||!end)continue;
   const pole=seat.foot.clone().add(new T.Vector3(side==='L'?-.2:.2,.35,-1).applyAxisAngle(new T.Vector3(0,1,0),seat.spec.yaw));
   solveLimb(upper,lower,end,target,pole);errors.push(pos(end).distanceTo(target));setWorld(foot,target);
  }
  this.model.updateWorldMatrix(true,true);
  }
  const eye=pos(head);eye.y+=.14;
  this.view={eyeHeight:eye.y-physicalFoot.y,pivotHeight:eye.y-physicalFoot.y-.1,offsetX:eye.x-physicalFoot.x,offsetZ:eye.z-physicalFoot.z};
  const contactPoint=this.points('hips').sort((a,b)=>a.y-b.y)[0];
  this.diagnostics={contactPoint:contactPoint.clone().sub(seat.foot).applyAxisAngle(new T.Vector3(0,1,0),-seat.spec.yaw).toArray(),lift,contact:Math.min(...this.points('hips').map(p=>p.y)),surface,feet:['L','R'].map(side=>Math.min(...this.points(side as 'L'|'R').map(p=>p.y))),legErrors:errors,eyeHeight:this.view.eyeHeight};
 }
 dispose(){this.release();for(const a of this.ankles.values())a.removeFromParent();}
}
