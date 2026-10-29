import { beforeAll, describe, expect, it } from 'vitest';
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, Vector3 } from 'three';
import { RapierController, initPhysics } from '../src/walk/controller';

const box = (w:number,h:number,d:number,x:number,y:number,z:number) => {
  const m=new Mesh(new BoxGeometry(w,h,d),new MeshBasicMaterial());m.position.set(x,y,z);return m;
};
const ground = () => {const root=new Group();root.add(box(30,1,30,0,-.5,0));return root;};
const idle = new Vector3(), DT = 1/60;
beforeAll(async()=>{await initPhysics();});

/** Steps n frames and returns the grounded/height trace for jitter checks. */
function trace(p:RapierController,dir:Vector3,n:number,speed=3.6){
  const ys:number[]=[],ground:boolean[]=[];
  for(let i=0;i<n;i++){p.step(dir,DT,false,speed);ys.push(p.position.y);ground.push(p.onGround);}
  return {ys,ground,spread:Math.max(...ys)-Math.min(...ys)};
}

describe('Rapier character controller',()=>{
 it('lands and stays still without drift',()=>{
  const p=new RapierController(ground());p.teleport(new Vector3(0,2,0));
  for(let i=0;i<120;i++)p.step(idle,DT,false);
  expect(p.position.y).toBeCloseTo(0,2);expect(p.onGround).toBe(true);
  const t=trace(p,idle,120);expect(t.spread).toBeLessThan(1e-3);expect(t.ground.every(Boolean)).toBe(true);
  p.dispose();
 });
 it('slides diagonally along a wall with no bounce and never loses ground',()=>{
  const root=ground();root.add(box(.16,4,20,2,2,0));const p=new RapierController(root);p.teleport(new Vector3(0,.2,-8));
  for(let i=0;i<30;i++)p.step(idle,DT,false);
  const t=trace(p,new Vector3(1,0,.4).normalize(),120);
  expect(t.spread).toBeLessThan(1e-3);expect(t.ground.every(Boolean)).toBe(true);
  expect(p.position.x).toBeLessThan(2-.08-.27);expect(p.position.z).toBeGreaterThan(-8+1);
  p.dispose();
 });
 it('weaves between columns without bouncing',()=>{
  const root=ground();for(let z=-8;z<=8;z+=4.2)root.add(box(.5,3,.5,1,1.5,z));const p=new RapierController(root);p.teleport(new Vector3(.4,.2,-10));
  for(let i=0;i<30;i++)p.step(idle,DT,false);
  const t=trace(p,new Vector3(.35,0,1).normalize(),150);
  // Raw contact noise stays within 2 mm; the avatar's visual smoothing takes it below 1 mm.
  expect(t.spread).toBeLessThan(2e-3);expect(t.ground.every(Boolean)).toBe(true);
  p.dispose();
 });
 it('walks up and down a ramp continuously and stays grounded',()=>{
  const root=ground();const ramp=box(8,.2,3,0,1.1,0);ramp.rotation.z=Math.atan(.6);root.add(ramp);
  const p=new RapierController(root);p.teleport(new Vector3(-6,.2,0));
  for(let i=0;i<30;i++)p.step(idle,DT,false);
  let last=p.position.clone();const up:boolean[]=[];
  for(let i=0;i<150;i++){p.step(new Vector3(1,0,0),DT,false,3);expect(p.position.distanceTo(last)).toBeLessThan(.08);last.copy(p.position);up.push(p.onGround);}
  expect(p.position.y).toBeGreaterThan(1.5);
  const down:boolean[]=[];for(let i=0;i<150;i++){p.step(new Vector3(-1,0,0),DT,false,3);down.push(p.onGround);}
  expect(p.position.y).toBeCloseTo(0,2);
  // Snap-to-ground keeps support on the way down; no airborne frames on a 31° ramp.
  expect(down.filter(g=>!g).length).toBe(0);expect(up.filter(g=>!g).length).toBe(0);
  p.dispose();
 });
 it('steps onto a low kerb without jumping',()=>{
  const root=ground();root.add(box(10,.15,8,6,.075,0));const p=new RapierController(root);p.teleport(new Vector3(0,.2,0));
  for(let i=0;i<30;i++)p.step(idle,DT,false);
  const t=trace(p,new Vector3(1,0,0),90);
  expect(p.position.y).toBeCloseTo(.15,2);expect(t.ground.filter(g=>!g).length).toBeLessThan(3);
  p.dispose();
 });
 it('jumps only on a fresh press and stops beneath a ceiling',()=>{
  const root=ground();root.add(box(8,.2,8,0,2.1,0));const p=new RapierController(root);p.teleport(new Vector3(0,.1,0));
  for(let i=0;i<10;i++)p.step(idle,DT,false);
  let high=0;
  for(let i=0;i<120;i++){p.step(idle,DT,true);high=Math.max(high,p.position.y);expect(p.position.y+1.7).toBeLessThanOrEqual(2.03);}
  expect(high).toBeGreaterThan(.1);expect(p.position.y).toBeCloseTo(0,2);expect(p.onGround).toBe(true);
  p.step(idle,DT,false);p.step(idle,DT,true);expect(p.position.y).toBeGreaterThan(.05);
  p.dispose();
 });
 it('cannot pass a thin wall during slow frames',()=>{
  const root=ground();root.add(box(.08,4,15,2,2,0));const p=new RapierController(root);p.teleport(new Vector3(0,.2,0));
  for(let i=0;i<20;i++)p.step(new Vector3(1,0,.3).normalize(),.2,false);
  expect(p.position.x).toBeLessThan(2);expect(p.position.y).toBeGreaterThan(-.01);
  p.dispose();
 });
 it('sweeps the camera sphere against walls',()=>{
  const root=ground();root.add(box(.2,4,10,-2,2,0));const p=new RapierController(root);p.teleport(new Vector3(0,.2,0));
  const free=p.sweep(new Vector3(0,1.5,0),new Vector3(-5,1.5,0));
  expect(free).toBeGreaterThan(1.4);expect(free).toBeLessThan(1.9);
  expect(p.sweep(new Vector3(0,1.5,0),new Vector3(5,1.5,0))).toBeCloseTo(5,3);
  p.dispose();
 });
});
