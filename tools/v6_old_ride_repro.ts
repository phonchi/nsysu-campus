/** Reproduce the original Sit+0.42m v5 riding defect against the unchanged shipped student rigs. */
import assert from 'node:assert/strict';import * as T from 'three';import {loadRideAsset}from './ride-assets';
let max=0;
for(const gender of ['m','f']){const gltf=await loadRideAsset(`public/models/characters/student-${gender}.glb`);const mixer=new T.AnimationMixer(gltf.scene);mixer.clipAction(gltf.animations.find(c=>c.name==='Sit')!).play();mixer.update(0);gltf.scene.position.y=.42;gltf.scene.updateMatrixWorld(true);for(const [name,x]of [['L',.25],['R',-.25]]as const){const palm=gltf.scene.getObjectByName(`Palm${name}`)!;const error=palm.getWorldPosition(new T.Vector3()).distanceTo(new T.Vector3(x,.9,-.5));max=Math.max(max,error);console.log(JSON.stringify({gender,hand:name,v5SitPalmError:error}));}}
assert.ok(max<=.02,`Original v5 Sit pose misses the original grips by ${max.toFixed(3)} m`);
