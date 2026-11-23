import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Group, Mesh, Vector3 } from 'three';
import { loadTerrain } from './terrain-fixture';
import { landmarkLevels, landmarkFootings, landmarkCollision, type Box, type Placement } from '../src/world/landmarks';
import { prepareV12Terrain } from '../src/world/v12-surfaces';
import { parseV12, type V12Data } from '../src/walk/v12-data';
import { initPhysics, RapierController } from '../src/walk/controller';
const read=(p:string)=>JSON.parse(fs.readFileSync(p,'utf8'));
const p=read('public/models/landmarks/placements.json')['liberal-arts'] as Placement;
const col=read('public/models/landmarks/liberal-arts.collision.json') as {boxes:Box[]};
const bus=parseV12('bus',read('public/data/bus-routes.json')) as V12Data['bus'];
const c=Math.cos(p.yaw),s=Math.sin(p.yaw),at=(x:number,z:number):[number,number]=>[p.centroid[0]+x*c+z*s,p.centroid[1]-x*s+z*c];
function terrain() { const t=loadTerrain();t.levels.push(...landmarkLevels({'liberal-arts':p}));prepareV12Terrain(t,{bus,issues:[]});return t; }

describe('liberal-arts terrace approach',()=>{
 it('transforms local pad vertices using the same yaw and explicit seat as the landmark',()=>{
  expect(landmarkLevels({demo:{centroid:[10,20],yaw:Math.PI/2,elevation:7,levelPad:[[0,0],[4,0],[4,3],[0,3]]}})[0]).toEqual({y:7,polygon:[[10,20],[10,16],[13,16],[13,20]]});
  expect(landmarkLevels({demo:{centroid:[0,0],yaw:0,elevation:null,levelPad:[[0,0],[1,0],[1,1]]}})).toEqual([]);
 });
 it('uses the 49.9 m stair-front seat with a two-metre apron around all walkable boxes',()=>{
  expect(p.elevation).toBe(49.9);
  const b=col.boxes.filter(b=>b.walkable),x0=Math.min(...b.map(b=>b.center[0]-b.size[0]/2))-2,x1=Math.max(...b.map(b=>b.center[0]+b.size[0]/2))+2,z0=Math.min(...b.map(b=>b.center[2]-b.size[2]/2))-2,z1=Math.max(...b.map(b=>b.center[2]+b.size[2]/2))+2;
  expect(p.levelPad).toEqual([[x0,z0],[x1,z0],[x1,z1],[x0,z1]]);
 });
 it('keeps all terrace/tread corners at the seat and creates no walkable-box footings',()=>{
  const t=terrain(),ground=(x:number,z:number)=>t.heightAt(x,z),walk=col.boxes.filter(b=>b.walkable);
  for(const b of walk)for(const u of [-.5,0,.5])for(const v of [-.5,0,.5])expect(ground(...at(b.center[0]+u*b.size[0],b.center[2]+v*b.size[2]))).toBeCloseTo(49.9,5);
  const footings=landmarkFootings({'liberal-arts':p},{'liberal-arts':col},ground);
  expect(footings.filter(f=>walk.some(b=>Math.hypot(f.center[0]-at(b.center[0],b.center[2])[0],f.center[2]-at(b.center[0],b.center[2])[1])<.01))).toEqual([]);
  for(let x=-10;x<=10;x++)expect(p.elevation!+.2245-ground(...at(x,24.4))).toBeLessThan(.35);
 });
 it('bridges the former 3.2 m gap at the terrace top without a drop',()=>{
  for(let z=17.9;z<=21.3;z+=.05){const top=col.boxes.filter(b=>b.walkable&&Math.abs(b.center[2]-z)<=b.size[2]/2).map(b=>b.center[1]+b.size[1]/2);expect(Math.max(...top)).toBeCloseTo(.9,5);}
 });
 it('walks from soil up the treads and landing onto the actual terrace without jumping',async()=>{
  await initPhysics();const t=terrain(),g=new Group();g.add(new Mesh(t.mesh([-630,-950,-500,-820])));g.add(landmarkCollision({'liberal-arts':p},{'liberal-arts':col},(x,z)=>t.heightAt(x,z)));g.updateMatrixWorld(true);
  const controller=new RapierController(g),[sx,sz]=at(0,27),[gx,gz]=at(0,17);
  try{
   controller.teleport(new Vector3(sx,t.heightAt(sx,sz)+.03,sz));const goal=new Vector3(gx,50.8,gz);
   let steps=0;while(Math.hypot(controller.position.x-gx,controller.position.z-gz)>.12&&steps++<900)controller.step(goal.clone().sub(controller.position).setY(0).normalize(),1/30,false,3.6);
   expect(steps,`blocked at ${controller.position.toArray()}`).toBeLessThan(900);expect(controller.position.y).toBeGreaterThanOrEqual(50.7);expect(controller.position.y).toBeLessThan(50.9);
  }finally{controller.dispose();g.traverse(o=>{if(o instanceof Mesh)o.geometry.dispose();});}
 });
});
