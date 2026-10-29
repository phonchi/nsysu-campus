import { describe,it,expect } from 'vitest';
import { Raycaster,Vector3,Mesh,MeshBasicMaterial,DoubleSide } from 'three';
import { loadTerrain } from './terrain-fixture';

describe('terrain visible/collision surface contract',()=>{
 it('height query agrees with the actual terrain triangle at an inland bend',()=>{
  const t=loadTerrain(),mesh=new Mesh(t.mesh([132,0,148,16]),new MeshBasicMaterial({side:DoubleSide}));
  mesh.updateMatrixWorld(true);
  const hit=new Raycaster(new Vector3(138,100,6),new Vector3(0,-1,0)).intersectObject(mesh)[0];
  expect(hit).toBeDefined();expect(t.heightAt(138,6)).toBeCloseTo(hit.point.y,5);
  mesh.geometry.dispose();(mesh.material as MeshBasicMaterial).dispose();
 });
});

import { Terrain, type TerrainMeta } from '../src/world/terrain';
import { roadRibbon,projectRoadGeometry,buildRoadLayers,clippedRoadPaths,buildCrosswalkGeometry } from '../src/world/road-surface';
const synthetic=()=>new Terrain({origin:[0,0],cell:4,cols:4,rows:4,minY:0,maxY:12,seaLevel:-1} as TerrainMeta,new Float32Array([0,0,0,0,0,7,3,2,0,2,12,3,0,0,2,1]));
function maxError(g:import('three').BufferGeometry,t:Terrain,offset:number){const p=g.attributes.position;let max=0;for(let k=0;k<p.count;k+=3)for(const [u,v] of [[.2,.3],[1/3,1/3],[.7,.1]]){const x=p.getX(k)*(1-u-v)+p.getX(k+1)*u+p.getX(k+2)*v,z=p.getZ(k)*(1-u-v)+p.getZ(k+1)*u+p.getZ(k+2)*v,y=p.getY(k)*(1-u-v)+p.getY(k+1)*u+p.getY(k+2)*v;max=Math.max(max,Math.abs(y-t.heightAt(x,z)-offset));}return max;}
describe('roads share actual terrain planes',()=>{
 it('splits long road strips at grid edges and diagonals, retaining metre-scaled UV',()=>{
  const t=synthetic(),src=roadRibbon([[1,1],[11,11]],2),g=projectRoadGeometry(src,t);expect(g.attributes.position.count).toBeGreaterThan(6);expect(maxError(g,t,.012)).toBeLessThan(1e-5);expect(g.attributes.uv.count).toBe(g.attributes.position.count);src.dispose();g.dispose();
 });
 it('omits complete carved terrain cells and reports no support there',()=>{
  const t=synthetic();t.carves=[[[4,4],[8,4],[8,8],[4,8]]];expect(t.surfaceAt(6,6)).toBeUndefined();const src=roadRibbon([[1,6],[11,6]],2),g=projectRoadGeometry(src,t),p=g.attributes.position;
  for(let k=0;k<p.count;k+=3){const x=(p.getX(k)+p.getX(k+1)+p.getX(k+2))/3,z=(p.getZ(k)+p.getZ(k+1)+p.getZ(k+2))/3;expect(x>4.00001&&x<7.99999&&z>4.00001&&z<7.99999).toBe(false);}src.dispose();g.dispose();
 });
 it('subtracts buildings and stops incoming lane markings at same-level road crossings',()=>{
  const t=synthetic(),layers=buildRoadLayers([{id:'a',kind:'service',width:2,points:[[0,6],[12,6]]},{id:'b',kind:'service',width:2,points:[[6,0],[6,12]]}],t,[0,0,12,12],[[[9,5],[11,5],[11,7],[9,7]]]);
  for(const layer of layers){for(const g of [layer.base,layer.markings].filter(Boolean) as import('three').BufferGeometry[]){expect(maxError(g,t,g===layer.base ? .006:.012)).toBeLessThan(1e-5);const p=g.attributes.position;for(let k=0;k<p.count;k+=3){const x=(p.getX(k)+p.getX(k+1)+p.getX(k+2))/3,z=(p.getZ(k)+p.getZ(k+1)+p.getZ(k+2))/3;expect(x>9.0001&&x<10.9999&&z>5.0001&&z<6.9999).toBe(false);if(g===layer.markings)expect(x>5.0001&&x<6.9999&&z>5.0001&&z<6.9999).toBe(false);}g.dispose();}}
 });
 it('clips re-entering paths without joining across an outside gap',()=>{
  const paths=clippedRoadPaths([[1,1],[5,1],[5,5],[1,5],[1,1]],[0,0,3,3]);expect(paths).toHaveLength(2);expect(paths[0]).toEqual([[1,1],[3,1]]);expect(paths[1]).toEqual([[1,3],[1,1]]);
 });
 it('fixes all three shipped road/terrain discrepancy samples',()=>{
  const t=loadTerrain();const roads=JSON.parse(require('node:fs').readFileSync('public/data/walkthrough/campus-structure.json','utf8')).context.roads;
  for(const id of ['osm-226268238','osm-232777683','osm-417499971']){const r=roads.find((r:{id:string})=>r.id===id),src=roadRibbon(r.points,r.width),g=projectRoadGeometry(src,t);expect(maxError(g,t,.012)).toBeLessThan(.00003);src.dispose();g.dispose();}
 });
});

import { vi } from 'vitest';
import { loadWalkNavigation } from '../src/walk-nav';
it('rejects navigation baked for another supporting surface before importing it',async()=>{
 const fetcher=vi.spyOn(globalThis,'fetch').mockImplementation(async input=>String(input).endsWith('.json')?new Response(JSON.stringify({status:'ready',scope:'campus-science-engineering-v2',surfaceVersion:'terrain-triangles-v1:old:hole'})):new Response(new Uint8Array()));
 try{await expect(loadWalkNavigation('/','campus-science-engineering-v2','terrain-triangles-v1:new:hole')).rejects.toThrow('surface version mismatch');}finally{fetcher.mockRestore();}
});

it('crosswalk stripes are clipped and draped onto the same real triangles',()=>{const t=synthetic(),g=buildCrosswalkGeometry([{id:'road',kind:'service',width:4,points:[[0,6],[12,6]]},{id:'foot',kind:'footway',width:2,points:[[6,0],[6,12]]}],t,[0,0,12,12]);expect(g.attributes.position.count).toBeGreaterThan(0);expect(maxError(g,t,.018)).toBeLessThan(.00001);g.dispose();});

import { buildRuntimeWorld } from './world-fixture';
import { geometryArrays } from '../src/walk-world';
function padOnly(world:ReturnType<typeof buildRuntimeWorld>['world']){const {positions,indices}=geometryArrays(world.collision),selected:number[]=[];for(let k=0;k<indices.length;k+=3){const ids=indices.slice(k,k+3);if(ids.every(i=>Math.abs(positions[i*3+1]+.055)<1e-6))for(const i of ids)selected.push(...positions.slice(i*3,i*3+3));}const g=new (require('three').BufferGeometry)();g.setAttribute('position',new (require('three').Float32BufferAttribute)(selected,3));return new Mesh(g,new MeshBasicMaterial({side:DoubleSide}));}
it('does not retain an invisible walkable pad below sloping DEM land',()=>{
 const {world}=buildRuntimeWorld(),pad=padOnly(world);pad.updateWorldMatrix(true,true);
 const ray=new Raycaster(new Vector3(62.813,.5,-150.950),new Vector3(0,-1,0),0,2);
 expect(ray.intersectObject(pad,true)).toHaveLength(0);
 world.display.traverse(o=>{if(o instanceof Mesh)o.geometry.dispose();});
},30000);
it('retains precise basement openings and their neighbouring flat ground without grid-sized gaps',()=>{
 const {world,structure}=buildRuntimeWorld(),pad=padOnly(world);pad.updateWorldMatrix(true,true);
 const core=structure.stairCores.SC.find(c=>c.levels.some(l=>l.level<0))!,frame=world.frames.get('SC')!;
 const local=(along:number)=>new Vector3(core.center[0]+Math.cos(core.angle)*along,0,core.center[1]+Math.sin(core.angle)*along).applyMatrix4(frame);
 const hasPad=(p:Vector3)=>new Raycaster(new Vector3(p.x,.5,p.z),new Vector3(0,-1,0),0,1).intersectObject(pad,true).length>0;
 expect(hasPad(local(0))).toBe(false);expect(hasPad(local(core.length/2-.05))).toBe(false);expect(hasPad(local(core.length/2+.05))).toBe(true);
 world.display.traverse(o=>{if(o instanceof Mesh)o.geometry.dispose();});
},30000);
