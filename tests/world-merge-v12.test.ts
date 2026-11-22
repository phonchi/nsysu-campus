import {expect,it,vi} from 'vitest';
import * as T from 'three';
import {buildRuntimeWorld} from './world-fixture';
import {addCampusProps,decorateCampus} from '../src/walk-art';
import {loadRideAsset} from '../tools/ride-assets';

const merges=vi.hoisted(()=>({asset:'procedural world',calls:0,failed:[] as string[]}));
vi.mock('three/addons/utils/BufferGeometryUtils.js',async original=>{
 const real=await original<typeof import('three/addons/utils/BufferGeometryUtils.js')>();
 return {...real,mergeGeometries:(...args:Parameters<typeof real.mergeGeometries>)=>{
  merges.calls++;const result=real.mergeGeometries(...args);
  if(!result)merges.failed.push(merges.asset);
  return result;
 }};
});
// Texture painting requires a DOM; geometry merging and the shipped GLB decoder stay real.
vi.mock('../src/render/foliage',async original=>({...await original<typeof import('../src/render/foliage')>(),buildTrees:()=>new T.Group()}));

it('builds the runtime world and async campus props without a null merge or missing prop geometry',async()=>{
 const errors=vi.spyOn(console,'error').mockImplementation(()=>{});
 try{
  const {world,structure,terrain}=buildRuntimeWorld();decorateCampus(world,structure,terrain,0);
  const expected=new Map<string,{vertices:number;bounds:T.Box3}>();
  await addCampusProps(world,async file=>{
   merges.asset=file;
   const gltf=await loadRideAsset(`public/${file}`);gltf.scene.updateMatrixWorld(true);
   let vertices=0;const bounds=new T.Box3(),point=new T.Vector3();
   gltf.scene.traverse(o=>{if(!(o instanceof T.Mesh))return;
    const g=o.geometry,p=g.getAttribute('position');vertices+=g.index?.count??p.count;
    // Decode first, independently of the production batching path.
    for(let i=0;i<p.count;i++)bounds.expandByPoint(point.fromBufferAttribute(p,i).applyMatrix4(o.matrixWorld));
   });
   expected.set(file,{vertices,bounds});return gltf;
  },p=>p);
  expect(merges.calls).toBeGreaterThan(0);
  expect(merges.failed,'each real merge must return geometry, including async asset batches').toEqual([]);
  expect(errors.mock.calls).toEqual([]);
  for(const [file,name] of [['monkey','Formosan macaques'],['bicycle','Parked bicycles'],['cone','Traffic cones'],['sailboat','Sailboats']]){
   const group=world.display.getObjectByName(name),mesh=group?.children[0] as T.InstancedMesh|undefined;
   expect(mesh,`${file} must remain visible`).toBeInstanceOf(T.InstancedMesh);
   const source=expected.get(`models/campus/${file}.glb`)!;
   expect(mesh!.geometry.getAttribute('position').count).toBe(source.vertices);
   mesh!.geometry.computeBoundingBox();const box=mesh!.geometry.boundingBox!;
   expect(box.min.distanceTo(source.bounds.min),`${file} quantized positions must not wrap`).toBeLessThan(1e-4);
   expect(box.max.distanceTo(source.bounds.max)).toBeLessThan(1e-4);
   for(const name of ['position','normal']){const a=mesh!.geometry.getAttribute(name);expect(a.array).toBeInstanceOf(Float32Array);expect(a.normalized).toBe(false);}
  }
 }finally{errors.mockRestore();}
},30000);
