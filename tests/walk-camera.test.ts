import { beforeAll, describe, expect, it } from 'vitest';
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, PerspectiveCamera, Vector3 } from 'three';
import { CameraRig } from '../src/walk/camera-rig';
import { RapierController, initPhysics } from '../src/walk/controller';

const box=(w:number,h:number,d:number,x:number,y:number,z:number)=>{const m=new Mesh(new BoxGeometry(w,h,d),new MeshBasicMaterial());m.position.set(x,y,z);return m;};
const DT=1/60;
beforeAll(async()=>{await initPhysics();});

function scene(extra:(r:Group)=>void){const r=new Group();r.add(box(60,1,60,0,-.5,0));extra(r);const p=new RapierController(r);p.teleport(new Vector3(0,.1,0));for(let i=0;i<20;i++)p.step(new Vector3(),DT,false);return p;}

describe('camera rig',()=>{
 it('does not force the arm beyond a free distance shorter than 35 cm',()=>{
  const cam=new PerspectiveCamera(),rig=new CameraRig(cam,()=>.18);
  rig.snap(new Vector3());rig.update(DT,{foot:new Vector3(),running:false,moving:false});
  expect(rig.arm).toBeLessThanOrEqual(.18);
 });
 it('holds a steady arm on open ground and never rotates on its own while walking',()=>{
  const p=scene(()=>{});const cam=new PerspectiveCamera();const rig=new CameraRig(cam,(a,b,r)=>p.sweep(a,b,r));
  const yaw0=rig.yaw;const arms:number[]=[];
  for(let i=0;i<300;i++){const dir=rig.forward.clone().add(new Vector3(Math.cos(rig.yaw),0,-Math.sin(rig.yaw))).normalize();p.step(dir,DT,false,3.6);rig.update(DT,{foot:p.position,running:false,moving:true});arms.push(rig.arm);}
  expect(rig.yaw).toBe(yaw0);expect(Math.max(...arms)-Math.min(...arms)).toBeLessThan(1e-6);
  p.dispose();
 });
 it('walking along a wall with columns: the arm pulls in but never pops back and forth',()=>{
  // Columns every 4.2 m right behind the walking line force repeated occlusion.
  const p=scene(r=>{r.add(box(.3,4,60,2.2,2,0));for(let z=-28;z<=28;z+=4.2)r.add(box(.5,3,.5,1.5,1.5,z));});
  const cam=new PerspectiveCamera();const rig=new CameraRig(cam,(a,b,r)=>p.sweep(a,b,r));rig.yaw=-Math.PI/2+.9;rig.snap(p.position);
  p.teleport(new Vector3(0,.1,-25));rig.snap(p.position);
  const arms:number[]=[];let pos=0;const before=new Vector3();
  for(let i=0;i<300;i++){p.step(new Vector3(0,0,1),DT,false,3.6);rig.update(DT,{foot:p.position,running:false,moving:true});arms.push(rig.arm);
   // The camera itself must never sit inside the wall slab.
   expect(cam.position.x).toBeLessThan(2.2-.15+.001);before.copy(cam.position);}
  // Outward easing is slow: no frame grows the arm by more than 0.15 m.
  for(let i=1;i<arms.length;i++)if(arms[i]>arms[i-1])expect(arms[i]-arms[i-1]).toBeLessThan(.15);
  // Count direction reversals of the arm (pull-in/out cycles) — bounded, not frame-to-frame flicker.
  for(let i=2;i<arms.length;i++){const a=arms[i]-arms[i-1],b=arms[i-1]-arms[i-2];if(Math.abs(a)>1e-4&&Math.abs(b)>1e-4&&Math.sign(a)!==Math.sign(b))pos++;}
  expect(pos).toBeLessThan(30);
  p.dispose();
 });
 it('lock freezes yaw, pitch and distance against drags and wheel',()=>{
  const p=scene(()=>{});const rig=new CameraRig(new PerspectiveCamera(),(a,b,r)=>p.sweep(a,b,r));
  rig.toggleLock();const s=[rig.yaw,rig.pitch,rig.distance];rig.rotate(200,50);rig.zoom(500);
  rig.update(DT,{foot:p.position,running:false,moving:false,followHeading:1});
  expect([rig.yaw,rig.pitch,rig.distance]).toEqual(s);
  p.dispose();
 });
 it('fades the avatar when the arm collapses in a narrow corridor',()=>{
  const p=scene(r=>{r.add(box(.2,4,40,-.9,2,0));r.add(box(.2,4,40,.9,2,0));r.add(box(4,4,.2,0,2,1.2));});
  const rig=new CameraRig(new PerspectiveCamera(),(a,b,r)=>p.sweep(a,b,r));rig.yaw=0;rig.snap(p.position);
  for(let i=0;i<60;i++)rig.update(DT,{foot:p.position,running:false,moving:false});
  expect(rig.arm).toBeLessThan(1.2);expect(rig.avatarOpacity).toBeLessThan(1);
  p.dispose();
 });
});
