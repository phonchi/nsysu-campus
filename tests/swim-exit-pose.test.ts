import {describe,it,expect} from 'vitest';
import * as T from 'three';
import {Avatar} from '../src/walk/avatar';
import {loadRideAsset} from '../tools/ride-assets';

// 上岸之後腳變得很奇怪: riding into the sea left Avatar.wasRiding latched through the swim; the first
// ground frame then dropped `current` without stopping it, so Tread/Swim stayed at full weight beside
// Idle/Walk for good (half-crouched legs, feet glued while walking).
const make=async(gender:string)=>{
 const asset=await loadRideAsset(`public/models/characters/student-${gender}.glb`);
 const avatar=new Avatar();avatar.setModel(asset.scene,asset.animations);
 avatar.setVehicle((await loadRideAsset('public/models/campus/bicycle.glb')).scene);
 return {avatar,body:asset.scene.getObjectByName('Body')!,legs:['L','R'].map(s=>asset.scene.getObjectByName('LowerLeg'+s)!)};
};
const frame=(x:number,moving:boolean,y=0)=>({foot:new T.Vector3(x,y,0),onGround:true,airborneFor:0,speed:moving?3.6:0,intendedSpeed:moving?3.6:0,heading:new T.Vector3(1,0,0),jumped:false,runSpeed:7.2,surfaceHeight:0,supportAt:()=>0});
const bodyHeight=(a:Awaited<ReturnType<typeof make>>)=>{a.avatar.root.updateMatrixWorld(true);return a.body.getWorldPosition(new T.Vector3()).y-a.avatar.root.position.y;};

describe('leaving the water restores the ground pose',()=>{
 for(const gender of ['m','f'])for(const fromBike of [true,false])it(`${gender}: ${fromBike?'bike → swim':'walk → swim'} → 上岸`,async()=>{
  const swimmer=await make(gender),control=await make(gender),dt=1/60;
  for(let i=0;i<30;i++){swimmer.avatar.update(dt,frame(0,false));control.avatar.update(dt,frame(0,false));}
  if(fromBike){swimmer.avatar.riding=true;for(let i=0;i<30;i++){swimmer.avatar.update(dt,frame(0,false));control.avatar.update(dt,frame(0,false));}expect(swimmer.avatar.state).toBe('ride');}
  // Entering the water: modeChanged() dismounts in the same frame the swim pose takes over.
  swimmer.avatar.riding=false;
  for(let i=0;i<120;i++){swimmer.avatar.externalPose={position:[0,-.6,0],heading:0,clip:i%40<20?'Tread':'Swim'};swimmer.avatar.update(dt,frame(0,false,.2));control.avatar.update(dt,frame(0,false));}
  swimmer.avatar.externalPose=undefined;
  swimmer.avatar.update(dt,frame(0,false));control.avatar.update(dt,frame(0,false));
  // No squat on the shore: the first ground frame already stands (treading pose puts Body ~0.1 m above the feet).
  expect(bodyHeight(swimmer)).toBeGreaterThan(bodyHeight(control)-.03);
  for(let i=0;i<60;i++){swimmer.avatar.update(dt,frame(0,false));control.avatar.update(dt,frame(0,false));}
  expect(Math.abs(bodyHeight(swimmer)-bodyHeight(control))).toBeLessThan(.02);
  let x=0,worst=0;
  for(let i=0;i<90;i++){x+=.06;swimmer.avatar.update(dt,frame(x,true));control.avatar.update(dt,frame(x,true));
   if(i>20)for(const k of [0,1])worst=Math.max(worst,swimmer.legs[k].quaternion.angleTo(control.legs[k].quaternion));}
  expect(swimmer.avatar.state).toBe('walk');
  expect(worst,'walking legs match an avatar that never swam').toBeLessThan(.05);
 });
});
