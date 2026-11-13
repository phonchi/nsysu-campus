import {expect,it,vi} from 'vitest';
import * as T from 'three';
import {configureShaderChecks,waitForSceneAssets,warmupWalkScene} from '../src/walk/runtime';

function fixture() {
  const scene=new T.Scene(),hidden=new T.Group();hidden.visible=false;scene.add(hidden);
  const geometry=new T.BoxGeometry(),material=new T.MeshStandardMaterial();material.visible=false;
  const mesh:T.InstancedMesh=new T.InstancedMesh(geometry,material,8);mesh.count=5;mesh.visible=false;mesh.castShadow=true;hidden.add(mesh);
  const lod=new T.LOD();lod.addLevel(new T.Mesh(new T.BoxGeometry(),new T.MeshBasicMaterial()),0);hidden.add(lod);
  const light=new T.DirectionalLight();light.castShadow=true;light.shadow.mapSize.set(1024,2048);scene.add(light);
  const originalShadow=new T.WebGLRenderTarget(4,4);light.shadow.map=originalShadow;
  const shadowDisposed=vi.spyOn(originalShadow,'dispose');
  const previous=new T.WebGLRenderTarget(2,2);let current:T.WebGLRenderTarget|null=previous;
  const viewport=new T.Vector4(2,3,40,50),scissor=new T.Vector4(1,2,30,40);
  const renderer={
    info:{programs:[{getUniforms:vi.fn(),getAttributes:vi.fn()}]},
    debug:{checkShaderErrors:true},shadowMap:{autoUpdate:false,needsUpdate:false},
    getRenderTarget:()=>current,setRenderTarget:vi.fn((next:T.WebGLRenderTarget|null)=>{current=next;}),
    getActiveCubeFace:()=>2,getActiveMipmapLevel:()=>1,
    getViewport:(v:T.Vector4)=>v.copy(viewport),setViewport:vi.fn(),getScissor:(v:T.Vector4)=>v.copy(scissor),setScissor:vi.fn(),
    getScissorTest:()=>true,setScissorTest:vi.fn(),
    compile:vi.fn(),compileAsync:vi.fn(async()=>{}),render:vi.fn(),
  };
  return {scene,hidden,mesh,lod,light,geometry,material,previous,originalShadow,shadowDisposed,renderer,viewport,scissor};
}

it('disables synchronous shader error checks only for production',()=>{
  const {renderer}=fixture();configureShaderChecks(renderer,false);expect(renderer.debug.checkShaderErrors).toBe(false);
  configureShaderChecks(renderer,true);expect(renderer.debug.checkShaderErrors).toBe(true);
});
it('waits for nested scene jobs and tolerates an already handled asset failure',async()=>{
  let complete!:()=>void;const done=vi.fn();
  const jobs:Promise<unknown>[]=[Promise.resolve().then(()=>{jobs.push(new Promise<void>(r=>{complete=r;}));}),Promise.reject(new Error('optional asset'))];
  const waiting=waitForSceneAssets(jobs).then(done);await Promise.resolve();await Promise.resolve();
  expect(done).not.toHaveBeenCalled();complete();await waiting;expect(done).toHaveBeenCalledOnce();
});
it('renders the complete visible scene after compilation, initializes program reflection, and restores state',async()=>{
  const f=fixture(),groups=f.geometry.groups,drawRange={...f.geometry.drawRange};
  let shadowTarget:T.WebGLRenderTarget|undefined;
  f.renderer.compileAsync.mockImplementation(async()=>{
    expect(f.hidden.visible&&f.mesh.visible&&f.material.visible).toBe(true);expect(f.mesh.frustumCulled).toBe(false);
    expect(f.lod.autoUpdate).toBe(false);expect(f.mesh.count).toBe(5);
    expect(f.geometry.groups).toBe(groups);expect(f.geometry.drawRange).toEqual(drawRange);
    expect(f.renderer.getRenderTarget()?.width).toBe(1);expect(f.light.shadow.mapSize.toArray()).toEqual([1,1]);
  });
  f.renderer.render.mockImplementation(()=>{
    expect(f.renderer.compileAsync).toHaveBeenCalledOnce();expect(f.hidden.visible&&f.mesh.visible).toBe(true);
    expect(f.mesh.count).toBe(5);expect(f.geometry.groups).toBe(groups);expect(f.geometry.drawRange).toEqual(drawRange);
    shadowTarget=new T.WebGLRenderTarget(1,1);f.light.shadow.map=shadowTarget;
  });
  const timing=await warmupWalkScene(f.renderer as unknown as Parameters<typeof warmupWalkScene>[0],f.scene,new T.PerspectiveCamera());
  expect(timing.renderPasses).toBe(1);expect(timing.compileMs).toBeGreaterThanOrEqual(0);expect(timing.firstUseMs).toBeGreaterThanOrEqual(0);
  expect(f.renderer.info.programs[0].getUniforms).toHaveBeenCalledOnce();expect(f.renderer.info.programs[0].getAttributes).toHaveBeenCalledOnce();
  expect(f.renderer.compileAsync).toHaveBeenCalledOnce();expect(f.renderer.compile).not.toHaveBeenCalled();expect(f.renderer.render).toHaveBeenCalledOnce();
  expect(f.hidden.visible||f.mesh.visible||f.material.visible).toBe(false);expect(f.mesh.frustumCulled).toBe(true);expect(f.lod.autoUpdate).toBe(true);expect(f.mesh.count).toBe(5);
  expect(f.geometry.groups).toBe(groups);expect(f.geometry.drawRange).toEqual(drawRange);
  expect(f.light.shadow.map).toBe(f.originalShadow);expect(f.shadowDisposed).not.toHaveBeenCalled();expect(f.light.shadow.mapSize.toArray()).toEqual([1024,2048]);
  expect(shadowTarget).toBeDefined();expect(f.renderer.getRenderTarget()).toBe(f.previous);
  expect(f.renderer.setRenderTarget).toHaveBeenLastCalledWith(f.previous,2,1);
  expect(f.renderer.setViewport).toHaveBeenLastCalledWith(f.viewport);expect(f.renderer.setScissor).toHaveBeenLastCalledWith(f.scissor);expect(f.renderer.setScissorTest).toHaveBeenLastCalledWith(true);
  expect(f.renderer.shadowMap).toEqual({autoUpdate:false,needsUpdate:false});
});
it('restores hidden state, LOD, shadows and target even when compilation rejects',async()=>{
  const f=fixture();f.renderer.compileAsync.mockRejectedValueOnce(new Error('compile failed'));
  await expect(warmupWalkScene(f.renderer as unknown as Parameters<typeof warmupWalkScene>[0],f.scene,new T.PerspectiveCamera())).rejects.toThrow('compile failed');
  expect(f.hidden.visible||f.mesh.visible||f.material.visible).toBe(false);expect(f.mesh.count).toBe(5);expect(f.lod.autoUpdate).toBe(true);
  expect(f.light.shadow.map).toBe(f.originalShadow);expect(f.renderer.getRenderTarget()).toBe(f.previous);expect(f.renderer.render).not.toHaveBeenCalled();
});
it('falls back to compile and also prepares screen-output shaders for tiers without post-processing',async()=>{
  const f=fixture(),renderer={...f.renderer,compileAsync:undefined};
  const targets:(T.WebGLRenderTarget|null)[]=[];
  renderer.render.mockImplementation(()=>{targets.push(renderer.getRenderTarget());expect(f.hidden.visible).toBe(true);});
  const timing=await warmupWalkScene(renderer as unknown as Parameters<typeof warmupWalkScene>[0],f.scene,new T.PerspectiveCamera(),false);
  expect(renderer.compile).toHaveBeenCalledTimes(2);expect(renderer.render).toHaveBeenCalledTimes(2);expect(timing.renderPasses).toBe(2);
  expect(targets).toEqual([expect.objectContaining({width:1,height:1}),null]);
  expect(renderer.setViewport).toHaveBeenCalledWith(new T.Vector4(0,0,1,1));expect(renderer.setScissor).toHaveBeenCalledWith(new T.Vector4(0,0,1,1));
  expect(renderer.info.programs[0].getUniforms).toHaveBeenCalledTimes(2);
  expect(renderer.setRenderTarget.mock.calls.map(([target])=>target)).toEqual([expect.objectContaining({width:1,height:1}),null,f.previous]);
});
it('restores original geometry groups and light state if the shadow first-use render fails',async()=>{
  const f=fixture(),groups=f.geometry.groups;f.mesh.material=[f.material];
  f.renderer.render.mockImplementation(()=>{expect(f.geometry.drawRange.count).toBe(Infinity);throw new Error('context lost');});
  await expect(warmupWalkScene(f.renderer as unknown as Parameters<typeof warmupWalkScene>[0],f.scene,new T.PerspectiveCamera())).rejects.toThrow('context lost');
  expect(f.geometry.groups).toBe(groups);expect(f.mesh.visible).toBe(false);expect(f.light.shadow.mapSize.toArray()).toEqual([1024,2048]);
  expect(f.renderer.getRenderTarget()).toBe(f.previous);expect(f.renderer.shadowMap.autoUpdate).toBe(false);
});
