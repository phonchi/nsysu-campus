import {describe,it,expect} from 'vitest';
import * as T from 'three';
import {Avatar} from '../src/walk/avatar';
import {loadRideAsset} from '../tools/ride-assets';

describe('animated walking ground contact',()=>{
 for(const gender of ['m','f'])it(`${gender}: grounding never pulls the animated torso down between strides`,async()=>{
  const asset=await loadRideAsset(`public/models/characters/student-${gender}.glb`);
  asset.scene.rotation.y=Math.PI;
  const avatar=new Avatar();avatar.setModel(asset.scene,asset.animations);
  avatar.setVehicle((await loadRideAsset('public/models/campus/bicycle.glb')).scene);
  const body=asset.scene.getObjectByName('Body')!;
  expect(body).toBeDefined();
  let previous:number|undefined,maxStep=0;
  let x=0;
  for(let i=0;i<300;i++){
   const moving=i>=20&&i<150||i>=180&&i<240;if(moving)x+=.06;
   avatar.update(1/60,{foot:new T.Vector3(x,0,0),onGround:true,airborneFor:0,speed:moving?3.6:0,intendedSpeed:moving?3.6:0,heading:new T.Vector3(1,0,0),jumped:false,runSpeed:7.2,surfaceHeight:0,supportAt:()=>0});
   avatar.root.updateMatrixWorld(true);
   const y=body.getWorldPosition(new T.Vector3()).y-avatar.root.position.y;
   if(previous!==undefined&&i>35)maxStep=Math.max(maxStep,Math.abs(y-previous));
   previous=y;
  }
  expect(maxStep,'torso correction must not snap down to a raised swing foot').toBeLessThan(.03);
 });
});
