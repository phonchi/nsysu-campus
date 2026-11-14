import {expect,it} from 'vitest';
import * as T from 'three';
import fs from 'node:fs';
import {loadRideAsset} from '../tools/ride-assets';
import {addOutlines} from '../src/render/outline';
import {characterCoverageThreshold,configureCharacterCoverage,CHARACTER_BODY_ORDER,CHARACTER_OUTLINE_ORDER} from '../src/render/character-surface';
import {Avatar} from '../src/walk/avatar';
import {toonMaterial} from '../src/render/toon';
import {PostPipeline} from '../src/render/post';
it('every shipped human and player model masks interior hulls but keeps the original silhouette width',async()=>{
 const ids=fs.readdirSync('public/models/characters').filter(f=>f.endsWith('.glb')&&!f.includes('monkey'));
 expect(ids).toEqual(expect.arrayContaining(['student-m.glb','student-f.glb','npc-teacher.glb','npc-guide.glb','npc-guard.glb','npc-volunteer.glb']));
 for(const id of ids){
  const g=await loadRideAsset('public/models/characters/'+id),hulls=addOutlines(g.scene,'character');expect(hulls.length,id).toBeGreaterThan(0);
  for(const hull of hulls){
   const material=hull.material as T.Material,body=hull.parent as T.Mesh;
   expect(hull.renderOrder).toBe(CHARACTER_OUTLINE_ORDER);expect(body.renderOrder).toBeLessThan(hull.renderOrder);
   expect(material.stencilWrite).toBe(true);expect(material.stencilFunc).toBe(T.NotEqualStencilFunc);expect(material.stencilRef).toBe(1);expect(material.stencilWriteMask).toBe(0);
   for(const m of [body.material].flat()){expect(m.stencilWrite).toBe(true);expect(m.stencilFunc).toBe(T.AlwaysStencilFunc);expect(m.stencilZPass).toBe(T.ReplaceStencilOp);expect(m.stencilRef).toBe(1);}
   // An interior body pixel has stencil=1: rejected. Exterior stencil=0: unchanged hull survives.
   expect((1&material.stencilFuncMask)!==(material.stencilRef&material.stencilFuncMask)).toBe(false);
   expect((0&material.stencilFuncMask)!==(material.stencilRef&material.stencilFuncMask)).toBe(true);
   const shader={vertexShader:'#include <common>\n#include <project_vertex>',fragmentShader:'',uniforms:{}} as Parameters<T.Material['onBeforeCompile']>[0];material.onBeforeCompile(shader,{} as T.WebGLRenderer);
   expect(shader.uniforms.uPx.value).toBe(2);expect(shader.uniforms.uMin.value).toBe(.006);expect(shader.uniforms.uMax.value).toBe(.03);
  }
 }
});
it('coverage keeps only the nearest opaque surface, with identical holes through every internal part',()=>{
 const material=toonMaterial(),oldKey=material.customProgramCacheKey();configureCharacterCoverage(material);material.opacity=.45;
 expect(material.transparent).toBe(false);expect(material.depthWrite).toBe(true);expect(material.depthTest).toBe(true);
 const shader={vertexShader:T.ShaderLib.toon.vertexShader,fragmentShader:T.ShaderLib.toon.fragmentShader,uniforms:{}} as Parameters<T.Material['onBeforeCompile']>[0];material.onBeforeCompile(shader,{} as T.WebGLRenderer);
 expect(shader.fragmentShader).toContain('characterCoverage(gl_FragCoord.xy)');expect(shader.fragmentShader).toContain('diffuseColor.a=1.0');expect(shader.fragmentShader).toContain('toonTint');
 const key=material.customProgramCacheKey();expect(key).toBe(oldKey+'|character-coverage-v1');configureCharacterCoverage(material);expect(material.customProgramCacheKey()).toBe(key);
 let samples=0;for(let y=0;y<8;y++)for(let x=0;x<8;x++){
  const threshold=characterCoverageThreshold(x,y);let z=Infinity,surface='background';
  // Simulate intersecting pieces in adversarial draw order, using the actual material depth-write rule.
  for(const [depth,name] of [[3,'inside hip'],[1,'outside shirt'],[2,'inside sleeve']] as const)if(material.opacity>=threshold&&depth<z){surface=name;if(material.depthWrite)z=depth;}
  expect(['background','outside shirt']).toContain(surface);if(surface==='outside shirt')samples++;
 }
 expect(samples).toBe(29);material.opacity=1;expect(material.customProgramCacheKey()).toBe(key);
});
it('player and vehicle fade use the same surface shader, and scene/warmup targets include stencil',()=>{
 const avatar=new Avatar(),model=new T.Group(),bike=new T.Group();model.add(new T.Mesh(new T.BoxGeometry(),toonMaterial()));bike.add(new T.Mesh(new T.BoxGeometry(),toonMaterial()));addOutlines(model,'character');addOutlines(bike,'character');avatar.setModel(model);avatar.setVehicle(bike);avatar.setOpacity(.45);
 for(const root of [model,bike])root.traverse(o=>{if(o instanceof T.Mesh&&!o.userData.outlineHull)for(const m of [o.material].flat()){expect(m.userData.characterCoverage).toBe(true);expect(m.opacity).toBe(.45);expect(m.transparent).toBe(false);expect(m.depthWrite).toBe(true);}});
 const renderer={capabilities:{maxSamples:4}} as T.WebGLRenderer,pipeline=new PostPipeline(renderer);
 expect((pipeline as unknown as {scene:T.WebGLRenderTarget}).scene.stencilBuffer).toBe(true);
 const runtime=fs.readFileSync('src/walk/runtime.ts','utf8');expect(runtime).toContain('new T.WebGLRenderer({ stencil:true');expect(runtime).toContain('new T.WebGLRenderTarget(1,1,{stencilBuffer:true})');
 pipeline.dispose();avatar.dispose();
});
