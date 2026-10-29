import { beforeAll, afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, Vector3 } from 'three';
import { init, NavMeshQuery, Detour } from 'recast-navigation';
import { generateSoloNavMesh } from 'recast-navigation/generators';
import { geometryArrays } from '../src/walk-world';
import { WalkNavigation, loadWalkBuildings, WALK_BUILDING_IDS } from '../src/walk-nav';
let nav:WalkNavigation;
beforeAll(async()=>{
 await init();const root=new Group();
 for(const [x,y] of [[-3,0],[3,0],[-3,3.7]]){const m=new Mesh(new BoxGeometry(4,.2,4),new MeshBasicMaterial());m.position.set(x,y-.1,0);root.add(m);}
 const {positions,indices}=geometryArrays(root);
 const result=generateSoloNavMesh(positions,indices,{cs:.12,ch:.08,walkableRadius:3,walkableHeight:22,walkableClimb:1,minRegionArea:0,mergeRegionArea:0});
 if(!result.success)throw new Error(result.error);nav=new WalkNavigation(result.navMesh);
});
afterAll(()=>nav?.dispose());
describe('prebaked navigation query semantics',()=>{
 it('returns a complete path on a connected surface',()=>{
  const p=nav.findPath(new Vector3(-4,0,0),new Vector3(-2,0,0));expect(p.length).toBeGreaterThan(0);expect(p.at(-1)!.x).toBeCloseTo(-2,3);
 });
 it('rejects a partial path ending at an island edge',()=>expect(nav.findPath(new Vector3(-3,0,0),new Vector3(3,0,0))).toEqual([]));
 it('never projects to another floor or distant ledge',()=>{
  expect(nav.findPath(new Vector3(-3,0,0),new Vector3(-3,3.7,0))).toEqual([]);
  expect(nav.findPath(new Vector3(-3,0,0),new Vector3(-3,1.5,0))).toEqual([]);
  expect(nav.findPath(new Vector3(-3,0,0),new Vector3(-5.8,0,0))).toEqual([]);
 });
});

afterEach(()=>vi.restoreAllMocks());
it('loads each indexed building once under the deployment base',async()=>{
 const fetcher=vi.spyOn(globalThis,'fetch').mockImplementation(async(input)=>{
  const url=String(input);
  if(url.endsWith('/index.json'))return new Response(JSON.stringify({buildings:WALK_BUILDING_IDS.map(id=>({id,url:`/data/walkthrough/${id}.json`}))}));
  const id=url.split('/').at(-1)!.replace('.json','');
  return new Response(JSON.stringify({id,floors:[{id:`${id}-1F`}]}));
 });
 const data=await loadWalkBuildings('/campus/');expect(data.map(b=>b.id)).toEqual([...WALK_BUILDING_IDS]);
 expect(fetcher).toHaveBeenCalledTimes(9);
 for(const [url] of fetcher.mock.calls)expect(String(url).startsWith('/campus/data/walkthrough/')).toBe(true);
});
it('rejects an incomplete or duplicate campus index before loading buildings',async()=>{
 const fetcher=vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(JSON.stringify({buildings:WALK_BUILDING_IDS.map(()=>({id:'SC',url:'/data/walkthrough/SC.json'}))})));
 await expect(loadWalkBuildings('/campus/')).rejects.toThrow('exactly once');expect(fetcher).toHaveBeenCalledTimes(1);
});

it('uses a fully validated reverse corridor only when the forward search exhausts nodes',()=>{
 const original=NavMeshQuery.prototype.findPath;let calls=0;
 const spy=vi.spyOn(NavMeshQuery.prototype,'findPath').mockImplementation(function(this:NavMeshQuery,...args){
  const result=original.apply(this,args);if(calls++===0)result.status|=Detour.DT_OUT_OF_NODES|Detour.DT_PARTIAL_RESULT;return result;
 });
 const path=nav.findPath(new Vector3(-4,0,0),new Vector3(-2,0,0));
 expect(path.length).toBeGreaterThan(0);expect(path[0].x).toBeCloseTo(-4);expect(path.at(-1)!.x).toBeCloseTo(-2);expect(spy).toHaveBeenCalledTimes(2);
});
it('never promotes an island partial path, even through the exhaustion fallback',()=>{
 const original=NavMeshQuery.prototype.findPath;let calls=0;
 vi.spyOn(NavMeshQuery.prototype,'findPath').mockImplementation(function(this:NavMeshQuery,...args){const r=original.apply(this,args);if(calls++===0)r.status|=Detour.DT_OUT_OF_NODES;return r;});
 expect(nav.findPath(new Vector3(-3,0,0),new Vector3(3,0,0))).toEqual([]);
});
it('does not reverse a one-way off-mesh connection',()=>{
 const root=new Group();for(const x of [-3,3]){const m=new Mesh(new BoxGeometry(4,.2,4),new MeshBasicMaterial());m.position.set(x,-.1,0);root.add(m);}
 const {positions,indices}=geometryArrays(root),built=generateSoloNavMesh(positions,indices,{cs:.12,ch:.08,walkableRadius:3,walkableHeight:22,walkableClimb:2,minRegionArea:0,mergeRegionArea:0,
  offMeshConnections:[{startPosition:{x:-2,y:0,z:0},endPosition:{x:2,y:0,z:0},radius:.6,bidirectional:false}]});
 if(!built.success)throw new Error(built.error);const oneWay=new WalkNavigation(built.navMesh);
 try{
  expect(oneWay.findPath(new Vector3(-3,0,0),new Vector3(3,0,0)).length).toBeGreaterThan(0);
  const original=NavMeshQuery.prototype.findPath;let calls=0;
  vi.spyOn(NavMeshQuery.prototype,'findPath').mockImplementation(function(this:NavMeshQuery,...args){const r=original.apply(this,args);calls++;r.status|=Detour.DT_OUT_OF_NODES;return r;});
  expect(oneWay.findPath(new Vector3(3,0,0),new Vector3(-3,0,0))).toEqual([]);expect(calls).toBe(1);
 }finally{oneWay.dispose();}
});
