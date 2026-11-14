import { readFileSync } from 'node:fs';
import { moveAxes, isForwardMove } from '../src/walk/input';
import { hudTemplate } from '../src/walk/hud';
import { beforeAll, describe, expect, it } from 'vitest';
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, PerspectiveCamera, Vector3 } from 'three';
import { CAMERA_MODE_KEY, CameraRig, cameraFollowTarget, readCameraMode, type CameraMode, type CameraStorage } from '../src/walk/camera-rig';
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
 it('pressed against a door the arm still finds its way back through a thinner ball',()=>{
  const cam=new PerspectiveCamera(),rig=new CameraRig(cam,(_a,_b,r)=>r>=.2?0:3);
  rig.snap(new Vector3());rig.update(DT,{foot:new Vector3(),running:false,moving:false});
  expect(rig.arm).toBeCloseTo(2.95,5);
 });
 it('holds a steady arm on open ground and free mode never rotates on its own while walking',()=>{
  const p=scene(()=>{});const cam=new PerspectiveCamera();const rig=new CameraRig(cam,(a,b,r)=>p.sweep(a,b,r));
  rig.setMode('free');const yaw0=rig.yaw;const arms:number[]=[];
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


const memory=(value:string|null=null):CameraStorage=>({getItem:()=>value,setItem:(_k,v)=>{value=v;}});
function cameraHarness(){
 let now=0;const rig=new CameraRig(new PerspectiveCamera(),()=>100,memory(),()=>now);
 const frame={foot:new Vector3(),running:false,moving:true};
 const tick=(seconds:number,target=0,source:'manual'|'route'='manual')=>{
  for(let i=0;i<Math.round(seconds/DT);i++){now+=DT*1000;rig.update(DT,{...frame,follow:{yaw:target,source}});}
 };
 return {rig,frame,tick,setNow:(n:number)=>{now=n;}};
}
describe('v11 camera mode and intent contract',()=>{
 it('cycles follow → free → firstPerson, persists plain strings, restores without a pointer-lock API',()=>{
  const store=memory(),rig=new CameraRig(new PerspectiveCamera(),()=>100,store);
  expect(rig.mode).toBe('follow');
  for(const mode of ['free','firstPerson','follow'] as const){expect(rig.cycleMode()).toBe(mode);expect(store.getItem(CAMERA_MODE_KEY)).toBe(mode);expect(rig.firstPerson).toBe(mode==='firstPerson');}
  store.setItem(CAMERA_MODE_KEY,'firstPerson');expect(new CameraRig(new PerspectiveCamera(),()=>100,store).firstPerson).toBe(true);
  for(const bad of [null,'thirdPerson','"free"','broken'])expect(readCameraMode(memory(bad))).toBe('follow');
  const broken={getItem:()=>{throw Error('read');},setItem:()=>{throw Error('write');}};
  const denied=new CameraRig(new PerspectiveCamera(),()=>100,broken);expect(denied.mode).toBe('follow');expect(denied.cycleMode()).toBe('follow');
 });
 it.each([
  [['w'],0,0,true],[['w','a'],0,0,true],[['w','d'],0,0,true],
  [['a'],0,0,false],[['d'],0,0,false],[['s'],0,0,false],[['s','a'],0,0,false],[['s','d'],0,0,false],
  [[],0,0,false],[[],.5,-.7,true],[[],.95,-.15,false],[[],0,-.05,false],
 ] as [string[],number,number,boolean][])('raw keys %j stick %s,%s gate runtime follow: %s',(keys,x,y,yes)=>{
  const axes=moveAxes(new Set(keys),{x,y});
  expect(isForwardMove(axes,3.6)).toBe(yes);
  const h=cameraHarness();h.rig.yaw=.9;
  for(let i=0;i<300;i++)h.rig.update(DT,{...h.frame,follow:cameraFollowTarget({mode:h.rig.mode,axes,speed:3.6,heading:0,route:false,blocked:false})});
  expect(h.rig.yaw===.9).toBe(!yes);
 });
 it('stopping, a wall or a modal blocks manual following, while a route needs no W',()=>{
  const base={mode:'follow' as CameraMode,axes:moveAxes(new Set(['w']),{x:0,y:0}),speed:0,heading:1,route:false,blocked:false};
  for(const speed of [0,.1,.25])expect(cameraFollowTarget({...base,speed})).toBeUndefined();
  expect(cameraFollowTarget({...base,speed:3,blocked:true})).toBeUndefined();
  expect(cameraFollowTarget({...base,axes:{forward:0,right:0},route:true})).toEqual({yaw:1,source:'route'});
  expect(cameraFollowTarget({...base,route:true,blocked:true})).toBeUndefined();
 });
 it('converges at the specified walk rate and crosses ±pi the short way',()=>{
  const h=cameraHarness();h.rig.yaw=Math.PI/2;h.tick(1.5);
  // The 90 deg/s cap takes ~.6s to reach 36 degrees; exponential decay then leaves ~3.79 degrees.
  expect(h.rig.yaw*180/Math.PI).toBeGreaterThan(3.7);expect(h.rig.yaw*180/Math.PI).toBeLessThan(3.9);
  h.tick(.2);expect(Math.abs(h.rig.yaw)).toBeLessThanOrEqual(3*Math.PI/180);
  h.rig.yaw=Math.PI-.03;h.tick(DT,-Math.PI+.06);
  expect(Math.abs(Math.atan2(Math.sin(h.rig.yaw-Math.PI),Math.cos(h.rig.yaw-Math.PI)))).toBeLessThan(.03);
 });
 it.each([['walk',2.5,90],['run',3.5,110],['ride',4,150]] as const)('%s follows the exponential rate and angular speed cap',(gait,k,limit)=>{
  const h=cameraHarness();h.rig.yaw=0;
  h.rig.update(DT,{...h.frame,gait,follow:{yaw:Math.PI,source:'manual'}});
  expect(h.rig.yaw).toBeCloseTo(limit*Math.PI/180*DT,8);
  h.rig.yaw=0;h.rig.update(DT,{...h.frame,gait,follow:{yaw:.2,source:'manual'}});
  expect(h.rig.yaw).toBeCloseTo(.2*(1-Math.exp(-k*DT)),8);
 });
 it('routes retain k=2, free never turns, first person follows only a route',()=>{
  const h=cameraHarness();h.rig.yaw=0;h.tick(DT,1,'route');expect(h.rig.yaw).toBeCloseTo(1-Math.exp(-2*DT),8);
  h.rig.setMode('free');const yaw=h.rig.yaw;h.tick(5,2,'route');h.rig.setSeated(true,2);h.tick(1);expect(h.rig.yaw).toBe(yaw);expect(h.rig.faceRoute(2)).toBe(false);
  h.rig.setSeated(false);h.tick(2);h.rig.setMode('firstPerson');h.tick(1,2);expect(h.rig.yaw).toBe(yaw);h.tick(1,2,'route');expect(h.rig.yaw).not.toBe(yaw);
 });
 it('protects 1.5 seconds after a drag and extends protection after the next drag',()=>{
  const h=cameraHarness();h.rig.rotate(30,5);const first=h.rig.yaw;
  h.tick(1);expect(h.rig.yaw).toBe(first);h.rig.rotate(20,0);const second=h.rig.yaw;
  h.tick(1.4);expect(h.rig.yaw).toBe(second);expect(h.rig.faceRoute(0)).toBe(false);
  h.tick(.2);expect(h.rig.yaw).not.toBe(second);
 });
 it('zero drags do not delay following, and a snap never writes yaw',()=>{
  const h=cameraHarness();h.rig.rotate(0,0);expect(h.rig.canAutoTurn('manual')).toBe(true);
  const yaw=h.rig.yaw;h.rig.snap(new Vector3(50,4,20));expect(h.rig.yaw).toBe(yaw);
 });
 it('lock, sitting and modal protection cover route arrivals as well as regular following',()=>{
  const h=cameraHarness();h.rig.toggleLock();const yaw=h.rig.yaw;
  h.rig.setSeated(true,1);h.tick(1,1,'route');expect(h.rig.yaw).toBe(yaw);expect(h.rig.faceRoute(1)).toBe(false);
  h.rig.toggleLock();h.tick(1.4);expect(h.rig.yaw).toBe(yaw);h.tick(.2);expect(h.rig.yaw).not.toBe(yaw);
  h.rig.setSeated(false);const standing=h.rig.yaw;h.tick(1.4);expect(h.rig.yaw).toBe(standing);h.tick(.2);expect(h.rig.yaw).not.toBe(standing);
  h.rig.protect();expect(h.rig.faceRoute(2)).toBe(false);h.tick(1.6);expect(h.rig.faceRoute(2)).toBe(true);
  const arrival=h.rig.yaw;h.rig.update(1,{...h.frame,blocked:true,follow:{yaw:0,source:'route'}});expect(h.rig.yaw).toBe(arrival);
 });
 it('wires V and both visible buttons to the same cycle and protects dismount/dialogue close',()=>{
  const runtime=readFileSync('src/walk/runtime.ts','utf8');
  expect(runtime).toContain("if (k === 'v') { cycleCameraMode();");
  expect(runtime).toContain("case 'camera': cycleCameraMode();");
  expect(runtime).toContain("querySelectorAll<HTMLElement>('[data-action=camera]')");
  expect(runtime).toContain('if(wasBlocking&&!director?.blocking)rig.protect()');
  expect(runtime).toContain('if(wasRiding&&!bike.riding)rig.protect()');
  expect(runtime).toContain('if(bike.riding)rig.protect();bike.riding=false');
  expect(runtime).toContain('if(!cameraBlocked())rig.faceRoute(yaw)');
  expect(runtime).toContain("if(!cameraBlocked()&&rig.faceRoute(arrivalId==='tunnel-east'");
  expect(hudTemplate(x=>x,'/').match(/data-action="camera"/g)).toHaveLength(2);
 });
});
