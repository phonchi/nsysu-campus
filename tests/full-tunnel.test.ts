import fs from 'node:fs';
import {describe,it,expect,beforeAll} from 'vitest';
import * as T from 'three';
import {fullTunnelProfile,fullTunnelGeometry,tunnelGroundCuts} from '../src/world/tunnel-surface';
import {landmarkCarves,landmarkCollision,type Placement,type Box} from '../src/world/landmarks';
import {loadTerrain} from './terrain-fixture';
import {initPhysics,RapierController} from '../src/walk/controller';
const placements=JSON.parse(fs.readFileSync('public/models/landmarks/placements.json','utf8')) as Record<string,Placement>;
const terrain=loadTerrain(),ground=(x:number,z:number)=>terrain.heightAt(x,z),profile=fullTunnelProfile(placements.tunnel,ground);
beforeAll(async()=>{await initPhysics();});
describe('full public Sisihwan tunnel',()=>{
 it('connects the actual west and east OSM endpoints with supported gentle grade',()=>{
  expect(profile.length).toBeGreaterThan(270);expect(profile.sections.at(-1)!.distance).toBeGreaterThan(profile.length);
  expect(profile.east.x).toBeCloseTo(282.1);expect(profile.west.x).toBeCloseTo(19.9);
  for(let i=1;i<profile.sections.length;i++){const a=profile.sections[i-1].position,b=profile.sections[i].position;expect(Math.abs(b.y-a.y)/Math.hypot(b.x-a.x,b.z-a.z)).toBeLessThan(.4);}
 });
 it('does not retain a fog-end blocking collider and has two open portal transforms',()=>{
  const col=JSON.parse(fs.readFileSync('public/models/landmarks/tunnel.collision.json','utf8'));
  expect(col.boxes.some((b:any)=>b.tag==='fog-end')).toBe(false);
 });
 it('physically walks all the way west to east and back, not only into an inZone radius',()=>{
  const col=JSON.parse(fs.readFileSync('public/models/landmarks/tunnel.collision.json','utf8'));
  const world=landmarkCollision({tunnel:placements.tunnel},{tunnel:col},ground),c=new RapierController(world);
  const targets=profile.sections.map(s=>s.position);c.teleport(targets[0].clone().add(new T.Vector3(0,.03,0)));
  for(const end of [targets,targets.slice().reverse()])for(const goal of end){let steps=0;while(Math.hypot(c.position.x-goal.x,c.position.z-goal.z)>.15&&steps++<100){c.step(goal.clone().sub(c.position).setY(0).normalize(),1/30,false,4);}expect(steps,`stalled at ${c.position.toArray()} target ${goal.toArray()}`).toBeLessThan(100);expect(Math.abs(c.position.y-goal.y)).toBeLessThan(.35);}
  c.dispose();
 },30000);
 it('keeps high mountain soil but removes low ground occupying the bore',()=>{
  const cuts=tunnelGroundCuts(profile,ground);expect(cuts.length).toBeGreaterThan(0);expect(cuts.length).toBeLessThan(profile.sections.length-1);
  terrain.carves=landmarkCarves(placements,ground);expect(terrain.carves.length).toBe(cuts.length);
 });
});

it('actual runtime terrain cannot block the complete central bore or strand an entry in a carved hole',async()=>{
 const {buildRuntimeWorld}=await import('./world-fixture');const {world}=buildRuntimeWorld();const c=new RapierController(world.collision);
 for(const section of profile.sections){if(section.distance<0||section.distance>profile.length)continue;for(const lateral of [-2,0,2]){const sample=section.position.clone().addScaledVector(section.right,lateral);const height=c.supportAt(sample.x,sample.z,sample.y+1.2);expect(height,`missing floor at ${sample.toArray()}`).toBeDefined();expect(Math.abs(height!-sample.y),`terrain intrudes at ${sample.toArray()}`).toBeLessThan(.05);}}
 const points=profile.sections.map(s=>s.position);c.teleport(points[0].clone().add(new T.Vector3(0,.04,0)));
 for(const route of [points,points.slice().reverse()])for(const goal of route){let steps=0;while(Math.hypot(c.position.x-goal.x,c.position.z-goal.z)>.15&&steps++<120)c.step(goal.clone().sub(c.position).setY(0).normalize(),1/30,false,4);expect(steps,`actual terrain blocked ${c.position.toArray()} goal ${goal.toArray()}`).toBeLessThan(120);expect(Math.abs(c.position.y-goal.y)).toBeLessThan(.4);}
 c.dispose();
},60000);

it('removes actual terrain triangles protruding through the east tunnel wall, including cell corners',()=>{
 const terrain=loadTerrain();terrain.carves=tunnelGroundCuts(profile,(x,z)=>terrain.heightAt(x,z));
 // Cell (293,328), centre (274,214), used to survive the centre-based carve even though its
 // corner triangle projected through the lining. These are actual observed lawn ray hits.
 const geometry=terrain.mesh([268,208,280,224]),mesh=new T.Mesh(geometry,new T.MeshBasicMaterial({side:T.DoubleSide}));mesh.updateMatrixWorld(true);
 for(const [x,z] of [[272.214563954,215.936193431],[272.329784622,215.90700005],[272.539374264,215.928892526]]){
  const ray=new T.Raycaster(new T.Vector3(x,6,z),new T.Vector3(0,-1,0),0,6);
  expect(ray.intersectObject(mesh),`retained lawn triangle at ${x},${z}`).toHaveLength(0);
  expect(terrain.surfaceAt(x,z)).toBeUndefined();
 }
 geometry.dispose();(mesh.material as T.Material).dispose();
});
