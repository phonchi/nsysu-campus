import { expect,it } from 'vitest';
import { PerspectiveCamera,Vector3 } from 'three';
import { Avatar,type AvatarInput } from '../src/walk/avatar';
import { CameraRig } from '../src/walk/camera-rig';
import { loadRideAsset } from '../tools/ride-assets';
import {eventSeatHeading} from '../src/walk/interaction-events';
const frame:AvatarInput={foot:new Vector3(12,0,34),onGround:true,airborneFor:0,speed:0,intendedSpeed:0,jumped:false,runSpeed:7.2,surfaceHeight:0};
for(const body of ['m','f'])it(`${body}: the shipped Sit animation is paired with a full return to idle`,async()=>{
 const asset=await loadRideAsset(`public/models/characters/student-${body}.glb`),avatar=new Avatar();
 expect(asset.animations.some(c=>c.name==='Sit')).toBe(true);avatar.setModel(asset.scene,asset.animations);avatar.update(.1,frame);
 avatar.setSeated(true);for(let i=0;i<20;i++)avatar.update(.05,frame);
 expect(avatar.state).toBe('sit');expect(avatar.root.position.toArray()).toEqual(frame.foot.toArray());
 expect(avatar['current']?.getClip().name).toBe('Sit');
 avatar.gesture('wave');avatar.update(.1,frame);expect(avatar['current']?.getClip().name).toBe('Sit');
 avatar.setSeated(false);avatar.update(.1,frame);expect(avatar.state).toBe('idle');expect(avatar.seated).toBe(false);
 expect(avatar['current']?.getClip().name).toBe('Idle');expect(avatar.root.position.toArray()).toEqual(frame.foot.toArray());avatar.dispose();
});
for(const firstPerson of [true,false])it(`seated ${firstPerson?'first':'third'}-person camera uses the supplied pose eye and pivot heights and standing restores the view`,()=>{
 const cam=new PerspectiveCamera(),rig=new CameraRig(cam,()=>100);rig.setMode(firstPerson?'firstPerson':'follow');rig.yaw=.3;rig.pitch=-.2;
 const f={foot:new Vector3(1,2,3),running:false,moving:false};rig.update(1,f);const initial=cam.position.clone();
 rig.setSeated(true);rig.poseView={eyeHeight:1.23,pivotHeight:1.13,offsetX:0,offsetZ:0};for(let i=0;i<120;i++)rig.update(1/60,f);expect(initial.y-cam.position.y).toBeCloseTo(.32,4);
 rig.seated=false;for(let i=0;i<120;i++)rig.update(1/60,f);expect(cam.position.distanceTo(initial)).toBeLessThan(.0001);expect(rig.yaw).toBe(.3);expect(rig.pitch).toBe(-.2);
});
it('host-facing yaw uses the shared -Z convention and ignores missing or coincident hosts',()=>{
 const player={x:12,z:34};
 expect(eventSeatHeading(player,{x:12,z:24})).toBeCloseTo(0);
 expect(eventSeatHeading(player,{x:22,z:34})).toBeCloseTo(-Math.PI/2);
 expect(Math.abs(eventSeatHeading(player,{x:12,z:44})!)).toBeCloseTo(Math.PI);
 expect(eventSeatHeading(player,{x:2,z:34})).toBeCloseTo(Math.PI/2);
 expect(eventSeatHeading(player)).toBeUndefined();expect(eventSeatHeading(player,player)).toBeUndefined();
 expect(eventSeatHeading(player,{x:NaN,z:34})).toBeUndefined();
});
it('sitting smoothly turns both the avatar and camera toward the host across the ±pi seam',()=>{
 const avatar=new Avatar(),rig=new CameraRig(new PerspectiveCamera(),()=>100),initial=Math.PI-.1,target=-Math.PI+.1;
 avatar.face(initial);rig.yaw=initial;avatar.setSeated(true,target);rig.setSeated(true,target);
 const cameraFrame={foot:frame.foot,running:false,moving:false};
 avatar.update(.1,frame);rig.update(.1,cameraFrame);
 const delta=Math.atan2(Math.sin(avatar.heading-initial),Math.cos(avatar.heading-initial));
 expect(delta).toBeGreaterThan(0);expect(delta).toBeLessThan(.2);expect(rig.yaw).toBeCloseTo(avatar.heading);
 for(let i=0;i<30;i++){avatar.update(.1,frame);rig.update(.1,cameraFrame);}
 expect(avatar.heading).toBeCloseTo(target,6);expect(rig.yaw).toBeCloseTo(target,6);
 avatar.setSeated(false);rig.setSeated(false);const yaw=rig.yaw;
 avatar.update(.1,frame);rig.update(.1,cameraFrame);expect(rig.yaw).toBeCloseTo(yaw);avatar.dispose();
});
it('without a host sitting preserves both headings, and a camera drag can take over a seated turn',()=>{
 const avatar=new Avatar(),rig=new CameraRig(new PerspectiveCamera(),()=>100),cameraFrame={foot:frame.foot,running:false,moving:false};
 avatar.face(.7);rig.yaw=-.3;avatar.setSeated(true);rig.setSeated(true);
 avatar.update(.1,frame);rig.update(.1,cameraFrame);expect(avatar.heading).toBe(.7);expect(rig.yaw).toBe(-.3);
 rig.setSeated(true,1);rig.rotate(10,0);const dragged=rig.yaw;rig.update(.2,cameraFrame);expect(rig.yaw).toBe(dragged);avatar.dispose();
});
