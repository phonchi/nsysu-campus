import * as T from 'three';

const find = (root:T.Object3D,name:string) => root.getObjectByName(name) ?? root.getObjectByName(T.PropertyBinding.sanitizeNodeName(name));
export function soleSide(mesh:T.SkinnedMesh,i:number):'L'|'R'|undefined {const indices=mesh.geometry.attributes.skinIndex,weights=mesh.geometry.attributes.skinWeight;if(!indices||!weights)return undefined;const ids=[indices.getX(i),indices.getY(i),indices.getZ(i),indices.getW(i)],ws=[weights.getX(i),weights.getY(i),weights.getZ(i),weights.getW(i)];const name=mesh.skeleton.bones[ids[ws.indexOf(Math.max(...ws))]]?.name.replace(/\./g,'');return name==='FootL'?'L':name==='FootR'?'R':undefined;}
const pos = (o: T.Object3D) => o.getWorldPosition(new T.Vector3());
function worldPosition(o: T.Object3D, p: T.Vector3) { o.position.copy(o.parent ? o.parent.worldToLocal(p.clone()) : p); o.updateWorldMatrix(false,true); }
function worldRotation(o: T.Object3D, q: T.Quaternion) { const parent = o.parent?.getWorldQuaternion(new T.Quaternion()) ?? new T.Quaternion(); o.quaternion.copy(parent.invert().multiply(q)); o.updateWorldMatrix(false,true); }
function aim(o: T.Object3D, from: T.Vector3, to: T.Vector3) { const at = o.getWorldQuaternion(new T.Quaternion());worldRotation(o,new T.Quaternion().setFromUnitVectors(from.clone().normalize(),to.clone().normalize()).multiply(at)); }

/** Analytic two-bone IK. The pole is explicit, so elbows/knees cannot flip across the limb axis. */
export function solveLimb(upper:T.Object3D, lower:T.Object3D, end:T.Object3D, target:T.Vector3, pole:T.Vector3, independentEnd=false) {
  const a=pos(upper),b=pos(lower),c=pos(end), l1=a.distanceTo(b),l2=b.distanceTo(c),v=target.clone().sub(a),distance=v.length();
  if(l1<1e-5||l2<1e-5||distance<1e-5)return false;
  const d=Math.max(Math.abs(l1-l2)+1e-5,Math.min(distance,l1+l2-1e-5)),axis=v.divideScalar(distance),normal=pole.clone().sub(a).addScaledVector(axis,-pole.clone().sub(a).dot(axis));
  if(normal.lengthSq()<1e-8)normal.set(0,0,1).addScaledVector(axis,-axis.z);normal.normalize();
  const along=(l1*l1+d*d-l2*l2)/(2*d),height=Math.sqrt(Math.max(0,l1*l1-along*along)),joint=a.clone().addScaledVector(axis,along).addScaledVector(normal,height);
  const ankleLocal=lower.worldToLocal(c.clone());aim(upper,b.clone().sub(a),joint.clone().sub(a));
  const nowB=pos(lower),nowEnd=independentEnd?lower.localToWorld(ankleLocal.clone()):pos(end);
  aim(lower,nowEnd.sub(nowB),target.clone().sub(nowB));
  if(independentEnd)worldPosition(end,lower.localToWorld(ankleLocal));
  return pos(end).distanceTo(target)<.02;
}
export interface RideContact { name:string;actual:number[];target:number[];error:number }
export interface RideDiagnostics { ready:boolean;phase:number;pitch:number;grips:RideContact[];pedals:RideContact[];saddleError:number;wheels:RideContact[] }

/** A real procedural Ride cycle, never a Sit/Idle animation fallback. Uses the authored student skeleton. */
export class RideRig {
  private base=new Map<T.Object3D,{position:T.Vector3;quaternion:T.Quaternion;scale:T.Vector3}>();
  private bones=new Map<string,T.Object3D>();
  private markers=new Map<string,T.Object3D>();
  private ankles=new Map<string,T.Object3D>();
  private soleOffsets=new Map<string,T.Vector3>();
  private soleNormals=new Map<string,T.Vector3>();
  private handEnds=new Map<string,T.Object3D>();
  private signs=new Map<string,number>();
  private handSamples=new Map<string,{mesh:T.SkinnedMesh;indices:number[]}[]>();
  private previous?:T.Vector3;
  private distance=0;
  private valid=false;
  private groundRestore?: Map<T.Object3D,{position:T.Vector3;quaternion:T.Quaternion;scale:T.Vector3}>;
  private groundBodyOffset=0;
  private baseWheel=new Map<T.Object3D,T.Quaternion>();
  diagnostics:RideDiagnostics={ready:false,phase:0,pitch:0,grips:[],pedals:[],saddleError:0,wheels:[]};
  constructor(private model:T.Object3D,private bike:T.Object3D,private root:T.Object3D){
    for(const name of ['Body','Hips',...['L','R'].flatMap(s=>['UpperArm.','LowerArm.','Palm.','UpperLeg.','LowerLeg.','Foot.'].map(n=>n+s))]){const o=find(model,name);if(o)this.bones.set(name,o);}
    for(const name of ['grip.L','grip.R','saddle','crank','pedal.L','pedal.R','wheel.front.contact','wheel.rear.contact']){const o=find(bike,name);if(o)this.markers.set(name,o);}
    root.updateMatrixWorld(true);model.updateMatrixWorld(true);
    for(const side of ['L','R']){const lower=this.bones.get('LowerLeg.'+side),foot=this.bones.get('Foot.'+side);if(lower&&foot){const end=new T.Object3D();end.name='ride.ankle.'+side;end.position.copy(lower.worldToLocal(pos(foot)));lower.add(end);this.ankles.set(side,end);}}
    const left=this.bones.get('Foot.L'),right=this.bones.get('Foot.R');const leftSign=left&&right?Math.sign(root.worldToLocal(pos(left)).x-root.worldToLocal(pos(right)).x)||1:1;this.signs.set('L',leftSign);this.signs.set('R',-leftSign);
    const soles:{L:T.Vector3[];R:T.Vector3[]}={L:[],R:[]};
    model.traverse(o=>{if(!(o instanceof T.SkinnedMesh))return;o.skeleton.update();const uv=o.geometry.attributes.uv;if(!uv)return;for(let i=0;i<uv.count;i++){if(Math.abs(uv.getX(i)-.4375)>.004||Math.min(Math.abs(uv.getY(i)-.1875),Math.abs(uv.getY(i)-.8125))>.004)continue;const p=root.worldToLocal(o.getVertexPosition(i,new T.Vector3()).applyMatrix4(o.matrixWorld));const side=soleSide(o,i);if(side)soles[side].push(p);}});
    for(const side of ['L','R']as const){const footBone=this.bones.get('Foot.'+side);if(footBone)this.soleNormals.set(side,new T.Vector3(0,1,0).applyQuaternion(footBone.getWorldQuaternion(new T.Quaternion()).invert()));const points=soles[side];if(points.length){const centre=points.reduce((a,b)=>a.add(b),new T.Vector3()).divideScalar(points.length);centre.y=Math.min(...points.map(p=>p.y));this.soleOffsets.set(side,centre.sub(root.worldToLocal(pos(this.bones.get('Foot.'+side)!))));}else this.soleOffsets.set(side,new T.Vector3(0,-.017,.052));}
    for(const side of ['L','R']as const){const sign=this.signs.get(side)!;const palm=this.bones.get('Palm.'+side),lower=this.bones.get('LowerArm.'+side);if(!palm||!lower)continue;const p=root.worldToLocal(pos(palm)),samples:{mesh:T.SkinnedMesh;indices:number[]}[]=[],centre=new T.Vector3();let count=0;
      model.traverse(o=>{if(!(o instanceof T.SkinnedMesh))return;o.skeleton.update();const uv=o.geometry.attributes.uv;if(!uv)return;const indices:number[]=[];for(let i=0;i<uv.count;i++){if(Math.abs(uv.getX(i)-.0625)>.004||Math.abs(uv.getY(i)-.0625)>.004)continue;const v=root.worldToLocal(o.getVertexPosition(i,new T.Vector3()).applyMatrix4(o.matrixWorld));if(v.distanceTo(p)<.12&&(v.x-p.x)*sign>.015){indices.push(i);centre.add(v);count++;}}if(indices.length)samples.push({mesh:o,indices});});
      if(count){centre.divideScalar(count);const end=new T.Object3D();end.name='ride.hand.'+side;end.position.copy(lower.worldToLocal(root.localToWorld(centre)));lower.add(end);this.handEnds.set(side,end);this.handSamples.set(side,samples);}}
    model.traverse(o=>this.base.set(o,{position:o.position.clone(),quaternion:o.quaternion.clone(),scale:o.scale.clone()}));
    bike.traverse(o=>{if(/^wheel[-0-9]/.test(o.name))this.baseWheel.set(o,o.quaternion.clone());});
    this.valid=this.bones.size===14&&this.markers.size===8&&this.handEnds.size===2;this.diagnostics.ready=this.valid;
  }
  releaseGround(){if(!this.groundRestore)return;for(const[o,b]of this.groundRestore){o.position.copy(b.position);o.quaternion.copy(b.quaternion);o.scale.copy(b.scale);}this.groundRestore=undefined;}
  groundFeet(surface:(x:number,z:number,referenceY:number)=>number|undefined,referenceY:number,idle:boolean,dt:number){
    if(!this.valid)return;
    this.root.updateMatrixWorld(true);
    const solePoints=new Map<string,T.Vector3[]>();
    this.model.traverse(o=>{
      if(!(o instanceof T.SkinnedMesh)||o.userData.outlineHull)return;
      o.skeleton.update();const uv=o.geometry.attributes.uv;if(!uv)return;
      for(let i=0;i<uv.count;i++){
        if(Math.abs(uv.getX(i)-.4375)>.004||Math.abs(uv.getY(i)-.1875)>.004)continue;
        const side=soleSide(o,i);if(!side)continue;
        const list=solePoints.get(side)??[];list.push(o.getVertexPosition(i,new T.Vector3()).applyMatrix4(o.matrixWorld));solePoints.set(side,list);
      }
    });
    const patches=[...solePoints].flatMap(([side,points])=>{
      const centre=points.reduce((a,b)=>a.add(b),new T.Vector3()).divideScalar(points.length);
      centre.y=Math.min(...points.map(p=>p.y));
      const h=surface(centre.x,centre.z,referenceY),hx=surface(centre.x+.06,centre.z,referenceY),hz=surface(centre.x,centre.z+.06,referenceY);
      if(h===undefined||hx===undefined||hz===undefined||Math.abs(h-centre.y)>.3)return [];
      const dx=(hx-h)/.06,dz=(hz-h)/.06,normal=new T.Vector3(-dx,1,-dz).normalize();
      if(normal.y<.64)return [];
      const plane=(p:T.Vector3)=>h+dx*(p.x-centre.x)+dz*(p.z-centre.z);
      return [{side,points,centre,normal,plane,gap:Math.min(...points.map(p=>p.y-plane(p)))}];
    });
    // A raised swing foot is part of the walk clip, not a missing support contact.
    // Pulling the torso down to it makes the entire character snap between strides.
    const active=patches.filter(p=>idle||p.gap+this.groundBodyOffset<.002);
    if(!active.length&&Math.abs(this.groundBodyOffset)<1e-5){this.groundBodyOffset=0;return;}
    this.groundRestore=new Map();this.model.traverse(o=>this.groundRestore!.set(o,{position:o.position.clone(),quaternion:o.quaternion.clone(),scale:o.scale.clone()}));
    const targets=active.map(p=>{
      const foot=this.bones.get('Foot.'+p.side)!,footAt=pos(foot),rotation=foot.getWorldQuaternion(new T.Quaternion());
      const currentNormal=this.soleNormals.get(p.side)!.clone().applyQuaternion(rotation).normalize();
      const delta=new T.Quaternion().setFromUnitVectors(currentNormal,p.normal);
      worldRotation(foot,delta.clone().multiply(rotation));
      // Rigid Foot-weighted sole vertices rotate with the ankle. Fit the whole sole patch,
      // rather than testing its lowest Y against an unrelated centre-XZ sample.
      const rotated=p.points.map(point=>point.clone().sub(footAt).applyQuaternion(delta).add(footAt));
      const dy=Math.max(...rotated.map(point=>p.plane(point)-point.y))+.002;
      return {side:p.side,foot,goal:footAt.clone().add(new T.Vector3(0,dy,0)),dy};
    });
    // Idle can settle onto an inclined stance; walking keeps the authored torso motion
    // and only corrects feet that would penetrate the ground.
    const down=idle?Math.min(0,...targets.map(t=>t.dy))-.001:0;
    // Releasing movement starts the Idle crossfade while a foot may still be raised.
    // Limit the stance adjustment in both directions instead of snapping the body
    // down on stop or snapping it back up on the next step.
    this.groundBodyOffset+=T.MathUtils.clamp(down-this.groundBodyOffset,-.6*dt,.6*dt);
    const body=this.bones.get('Body')!;
    worldPosition(body,pos(body).add(new T.Vector3(0,this.groundBodyOffset,0)));
    for(const t of targets){
      const end=this.ankles.get(t.side)!,pole=this.root.localToWorld(new T.Vector3(this.signs.get(t.side)!*.20,.35,-.7));
      solveLimb(this.bones.get('UpperLeg.'+t.side)!,this.bones.get('LowerLeg.'+t.side)!,end,t.goal,pole);
      worldPosition(t.foot,pos(end));
    }
    this.root.updateMatrixWorld(true);
  }
  get ready(){return this.valid;}
  reset(){this.releaseGround();this.groundBodyOffset=0;for(const [o,b]of this.base){o.position.copy(b.position);o.quaternion.copy(b.quaternion);o.scale.copy(b.scale);}this.previous=undefined;this.root.rotation.x=0;this.model.updateWorldMatrix(true,true);}
  apply(foot:T.Vector3,contacts?:{front:number;rear:number}){
    if(!this.valid)return false;
    if(this.previous)this.distance+=Math.hypot(foot.x-this.previous.x,foot.z-this.previous.z);this.previous=foot.clone();
    const phase=this.distance/(.365*2*Math.PI)*2*Math.PI/2.4;
    const pitch=contacts?Math.atan2(contacts.front-contacts.rear,1.04):0;
    this.root.rotation.x=pitch;this.root.scale.set(1,1,1);this.model.position.y=0;
    for(const [o,b]of this.base){o.position.copy(b.position);o.quaternion.copy(b.quaternion);o.scale.copy(b.scale);}this.model.position.y=0;
    this.root.updateWorldMatrix(true,true);
    const body=this.bones.get('Body')!, hips=this.bones.get('Hips')!;
    const leanAxis=new T.Vector3(1,0,0).applyQuaternion(this.root.getWorldQuaternion(new T.Quaternion()));
    worldRotation(body,new T.Quaternion().setFromAxisAngle(leanAxis,-.32).multiply(body.getWorldQuaternion(new T.Quaternion())));
    const saddle=pos(this.markers.get('saddle')!),up=new T.Vector3(0,.07,0).applyQuaternion(this.root.getWorldQuaternion(new T.Quaternion()));
    worldPosition(body,pos(body).add(saddle.clone().add(up).sub(pos(hips))));
    const crank=this.markers.get('crank')!;crank.rotation.x=phase;for(const s of ['L','R'])this.markers.get('pedal.'+s)!.rotation.x=-phase;this.bike.updateWorldMatrix(true,true);
    const grips:RideContact[]=[],pedals:RideContact[]=[];
    const local=(x:number,y:number,z:number)=>this.root.localToWorld(new T.Vector3(x,y,z));
    for(const s of ['L','R']as const){const sign=this.signs.get(s)!,vehicleSide=sign>0?'L':'R';
      const hand=this.handEnds.get(s)!,grip=pos(this.markers.get('grip.'+vehicleSide)!);
      solveLimb(this.bones.get('UpperArm.'+s)!,this.bones.get('LowerArm.'+s)!,hand,grip,local(sign*.6,.9,.12));
      grips.push({name:s,actual:pos(hand).toArray(),target:grip.toArray(),error:pos(hand).distanceTo(grip)});
      const pedal=pos(this.markers.get('pedal.'+vehicleSide)!),soleOffset=this.soleOffsets.get(s)!.clone().applyQuaternion(this.root.getWorldQuaternion(new T.Quaternion())),ankle=pedal.clone().sub(soleOffset),footBone=this.bones.get('Foot.'+s)!;
      solveLimb(this.bones.get('UpperLeg.'+s)!,this.bones.get('LowerLeg.'+s)!,this.ankles.get(s)!,ankle,local(sign*.22,.5,-.7));
      worldPosition(footBone,pos(this.ankles.get(s)!));
      // The exported foot IK bone is independent of the shin hierarchy. Its local shoe offset is calibrated here.
      const sole=pos(footBone).add(soleOffset);
      pedals.push({name:s,actual:sole.toArray(),target:pedal.toArray(),error:sole.distanceTo(pedal)});
    }
    this.root.updateMatrixWorld(true);
    for(const grip of grips){const point=new T.Vector3();let count=0;for(const sample of this.handSamples.get(grip.name)!){sample.mesh.skeleton.update();for(const i of sample.indices){point.add(sample.mesh.getVertexPosition(i,new T.Vector3()).applyMatrix4(sample.mesh.matrixWorld));count++;}}point.divideScalar(count);grip.actual=point.toArray();grip.error=point.distanceTo(new T.Vector3(...grip.target));}
    for(const[o,q]of this.baseWheel)o.quaternion.copy(q).premultiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(1,0,0),-this.distance/.365));
    this.root.updateWorldMatrix(true,true);
    const wheels=[['front',contacts?.front],['rear',contacts?.rear]].map(([name,height])=>{const marker=this.markers.get(`wheel.${name}.contact`)!;const p=marker.parent!.localToWorld(new T.Vector3(0,.35,name==='front'?-.52:.52)).sub(new T.Vector3(0,.365,0));marker.position.copy(marker.parent!.worldToLocal(p.clone()));const target=p.clone();if(typeof height==='number')target.y=height;return{name:String(name),actual:p.toArray(),target:target.toArray(),error:p.distanceTo(target)};});
    this.diagnostics={ready:true,phase,pitch,grips,pedals,saddleError:pos(hips).distanceTo(saddle.clone().add(up)),wheels};return Math.max(...grips.map(g=>g.error))<.02&&Math.max(...pedals.map(g=>g.error))<.03;
  }
}
