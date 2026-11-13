import {expect,it,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import * as T from 'three';
import {characterWarmupModelIds,prepareCharacterWarmup,NpcManager,type StoryZones} from '../src/world/npc';
import {modelFor} from '../src/walk/player-look';
import {toonify,RAMP} from '../src/render/toon';
import type {NpcData} from '../src/story/talk';
import zoneData from '../public/data/story-zones.json';
import npcData from '../public/data/npcs.json';

const zones=zoneData as unknown as StoryZones,data=npcData as unknown as NpcData;
function source(model:string,convert=true){
  const root=new T.Group(),geometry=new T.BoxGeometry(),n=geometry.attributes.position.count;
  geometry.setAttribute('skinIndex',new T.Uint16BufferAttribute(new Uint16Array(n*4),4));
  const weights=new Float32Array(n*4);for(let i=0;i<n;i++)weights[i*4]=1;
  geometry.setAttribute('skinWeight',new T.Float32BufferAttribute(weights,4));
  const map=new T.Texture();map.colorSpace=T.SRGBColorSpace;
  const mesh=new T.SkinnedMesh(geometry,new T.MeshStandardMaterial({map,name:`${model}_toon`,fog:true})),bone=new T.Bone();
  root.add(mesh,bone);mesh.bind(new T.Skeleton([bone]));if(convert)toonify(root);
  return root;
}
const body=(root:T.Object3D)=>{let found:T.SkinnedMesh|undefined;root.traverse(o=>{if(o instanceof T.SkinnedMesh&&!o.userData.outlineHull)found=o;});return found!;};

it('covers every authored NPC, ambient, body-swap and literal late character loader model',()=>{
  const ids=characterWarmupModelIds(zones,data);
  // Read the independent encounter loader so changing/adding its late GLB cannot silently miss this catalog.
  const encounterSource=readFileSync('src/world/encounter-scene.ts','utf8');
  const late=[...encounterSource.matchAll(/characters\/([a-z0-9-]+)\.glb/g)].map(m=>m[1]);
  expect(late).toContain('monkey');
  const expected=new Set([...Object.values(zones.npcs).map(n=>n.model),...(zones.ambient?.students??[]),...data.npcs.map(n=>n.model),modelFor('m'),modelFor('f'),...late]);
  expect(ids).toEqual([...expected].sort());
  expect(ids).toEqual(expect.arrayContaining(['student-m','student-f','monkey','npc-guide','npc-desk','npc-clerk','npc-guard','npc-teacher','npc-volunteer',...Array.from({length:6},(_,i)=>`npc-student-${i+1}`)]));
  for(const id of ids){
    const bytes=readFileSync(`public/models/characters/${id}.glb`),length=bytes.readUInt32LE(12),gltf=JSON.parse(bytes.subarray(20,20+length).toString());
    expect(gltf.skins?.length,id).toBeGreaterThan(0);
    expect(gltf.materials.some((m:{pbrMetallicRoughness?:{baseColorTexture?:unknown}})=>m.pbrMetallicRoughness?.baseColorTexture),id).toBe(true);
  }
});

it('samples the actual skinned, fog/map/gradient-map material families and their camera-fade variants',async()=>{
  const sources=new Map(characterWarmupModelIds(zones,data).map(id=>[id,source(id)]));
  const samples=await prepareCharacterWarmup(zones,data,async id=>sources.get(id)!);
  expect(samples.failedModels).toEqual([]);expect(samples.modelIds).toEqual([...sources.keys()]);expect(samples.group.visible).toBe(false);
  for(const id of samples.modelIds){
    for(const transparent of [false,true]){
      const object=samples.group.children.find(o=>o.userData.characterWarmup.model===id&&o.userData.characterWarmup.shader==='source'&&o.userData.characterWarmup.transparent===transparent)!;
      const mesh=body(object),material=mesh.material as T.MeshToonMaterial,original=body(sources.get(id)!).material as T.MeshToonMaterial;
      expect(mesh.isSkinnedMesh,id).toBe(true);expect(mesh.geometry.attributes.skinIndex,id).toBeDefined();
      expect(material.isMeshToonMaterial,id).toBe(true);expect(material.fog,id).toBe(true);expect(material.map,id).toBe(original.map);expect(material.gradientMap,id).toBe(RAMP);
      expect(material.transparent,id).toBe(transparent);expect(material.depthWrite,id).toBe(!transparent);
      expect(material.onBeforeCompile,id).toBe(original.onBeforeCompile);expect(material.customProgramCacheKey(),id).toBe(original.customProgramCacheKey());
      expect(original.transparent,id).toBe(false);expect(mesh.skeleton,id).not.toBe(body(sources.get(id)!).skeleton);
    }
  }
  for(const id of new Set(data.npcs.filter(n=>n.look).map(n=>n.model))){
    const variants=samples.group.children.filter(o=>o.userData.characterWarmup.model===id&&o.userData.characterWarmup.shader==='npc-recolored');
    expect(variants.map(o=>o.userData.characterWarmup.transparent).sort(),id).toEqual([false,true]);
    for(const object of variants){
      const material=body(object).material as T.MeshToonMaterial,original=body(sources.get(id)!).material as T.Material;
      // Match the existing recoloring clone, which currently does not copy the custom toon hooks.
      expect(material.customProgramCacheKey()).toBe(original.clone().customProgramCacheKey());
      expect(material.gradientMap).toBe(RAMP);expect(material.map).toBeDefined();
    }
  }
  samples.dispose();
});

it('removes samples and frees cloned skeletons while pinning programs until scene teardown',async()=>{
  const original=source('student-m'),originalMesh=body(original),originalMaterial=originalMesh.material as T.MeshToonMaterial;
  const sourceMaterialDispose=vi.spyOn(originalMaterial,'dispose'),sourceGeometryDispose=vi.spyOn(originalMesh.geometry,'dispose'),sourceTextureDispose=vi.spyOn(originalMaterial.map!,'dispose');
  const samples=await prepareCharacterWarmup({zones:{},npcs:{}},undefined,async()=>original),scene=new T.Scene();scene.add(samples.group);
  const mesh=body(samples.group.children[0]),disposeMaterial=vi.spyOn(mesh.material as T.Material,'dispose'),disposeSkeleton=vi.spyOn(mesh.skeleton,'dispose');
  samples.removeFromScene();expect(scene.children).toHaveLength(0);expect(samples.group.children).toHaveLength(0);expect(disposeSkeleton).toHaveBeenCalledOnce();
  expect(samples.retainedMaterialCount).toBeGreaterThan(0);expect(disposeMaterial).not.toHaveBeenCalled();
  samples.dispose();samples.dispose();expect(disposeMaterial).toHaveBeenCalledOnce();expect(samples.retainedMaterialCount).toBe(0);
  expect(sourceMaterialDispose).not.toHaveBeenCalled();expect(sourceGeometryDispose).not.toHaveBeenCalled();expect(sourceTextureDispose).not.toHaveBeenCalled();
});

it('uses cached NPC sources, including models not spawned at any current anchor',async()=>{
  const manager=new NpcManager(zones,undefined,undefined,path=>path,data);
  const load=vi.spyOn(manager['loader'],'loadAsync').mockImplementation(async url=>({scene:source(url.split('/').at(-1)!.replace('.glb',''),false),animations:[]}) as never);
  const samples=await manager.prepareWarmupSamples();
  expect(load).toHaveBeenCalledTimes(characterWarmupModelIds(zones,data).length);
  await manager['source']('student-m');await manager['source']('monkey');expect(load).toHaveBeenCalledTimes(samples.modelIds.length);
  expect(manager.group.children).toHaveLength(0);expect(samples.modelIds).toContain('student-m');
  samples.dispose();manager.dispose();
});

it('reports missing models without discarding the other prepared character variants',async()=>{
  const samples=await prepareCharacterWarmup({zones:{},npcs:{}},undefined,async id=>{if(id==='student-f')throw new Error('unavailable');return source(id);});
  expect(samples.failedModels).toEqual(['student-f']);expect(samples.modelIds).toEqual(['monkey','student-m']);samples.dispose();
});
