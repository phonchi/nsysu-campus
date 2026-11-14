import fs from 'node:fs';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {addSeatProps} from '../src/world/props';
import {NpcManager,type StoryZones} from '../src/world/npc';
import type {NpcData} from '../src/story/talk';
import {RapierController,initPhysics} from '../src/walk/controller';
import {afterEach,expect,it,vi} from 'vitest';
import * as T from 'three';
import {followRoute} from '../src/walk/autopilot';
import {campusActivityGuide,EventPlayerPose} from '../src/walk/interaction-events';
import {Avatar} from '../src/walk/avatar';
import {loadRideAsset} from '../tools/ride-assets';
import {ChairPose,SeatRegistry,seatApproach,withinSeatApproach,type Seat,type SeatSpec} from '../src/world/seats';
import {CameraRig} from '../src/walk/camera-rig';
const spec:SeatSpec={foot:[12,34],yaw:0,pose:'chair',surfaceHeight:.475,approachRadius:.6,prop:{kind:'bench',offset:[0,0,0],yaw:Math.PI}};
const seat:Seat={id:'test',spec,foot:new T.Vector3(12,2,34)};
const frame={foot:seatApproach(seat),onGround:true,airborneFor:0,speed:0,intendedSpeed:0,jumped:false,runSpeed:7.2,surfaceHeight:2,supportAt:()=>2};
for(const body of ['m','f'])it(`${body}: supported pelvis, planted soles and pose-derived camera without moving physics`,async()=>{
 const asset=await loadRideAsset(`public/models/characters/student-${body}.glb`);asset.scene.rotation.y=Math.PI;
 const avatar=new Avatar();avatar.setModel(asset.scene,asset.animations);avatar.update(.1,frame);const foot=frame.foot.clone();
 avatar.setSeated(true,seat.spec.yaw,seat);
 let worst=0;for(let i=0;i<90;i++){avatar.update(1/30,frame);const d=avatar.seatDiagnostics!;worst=Math.max(worst,Math.abs(d.contact-d.surface));expect(d.contactPoint[2]).toBeGreaterThan(.04);expect(d.contactPoint[2]).toBeLessThan(.4);expect(d.feet.every(y=>Math.abs(y-2)<.02)).toBe(true);expect(Math.max(...d.legErrors)).toBeLessThan(.03);}
 console.log(body,avatar.seatDiagnostics,'worst contact',worst);expect(worst).toBeLessThan(.001);expect(frame.foot.equals(foot)).toBe(true);expect(avatar.root.position.x).toBe(foot.x);expect(avatar.root.position.z).toBe(foot.z);
 const rig=new CameraRig(new T.PerspectiveCamera(),()=>100);rig.setMode('firstPerson');rig.setSeated(true);rig.poseView=avatar.seatView;const camera=new T.PerspectiveCamera(),view=new CameraRig(camera,()=>100);view.setMode('firstPerson');view.setSeated(true);view.poseView=avatar.seatView;view.update(1,{foot,running:false,moving:false});expect(camera.position.y).toBeCloseTo(foot.y+avatar.seatView!.eyeHeight,5);
 avatar.setSeated(false);avatar.update(.1,frame);expect(avatar.state).toBe('idle');expect(asset.scene.position.toArray()).toEqual([0,0,0]);expect(avatar.seatView).toBeUndefined();avatar.dispose();
});
it('only claims a free seat in the precise approach area, and claims survive repeated steps',()=>{
 const seats=new SeatRegistry({test:spec},()=>2,()=>2),s=seats.get('test')!;
 expect(withinSeatApproach(s,new T.Vector3(12,2,36))).toBe(false);expect(withinSeatApproach(s,seatApproach(s))).toBe(true);
 expect(seats.claim('test','npc')).toBe(true);expect(seats.claim('test','player')).toBe(false);seats.release('test','player');expect(seats.available('test','player')).toBe(false);
 seats.release('test','npc');expect(seats.claim('test','player')).toBe(true);expect(seats.claim('test','player')).toBe(true);seats.release('test','player');expect(seats.available('test','npc')).toBe(true);
});

it('seat guidance does not stop at the broad activity radius and cancellation restores the pose',()=>{
 const at=seatApproach(seat).add(new T.Vector3(0,0,-.2)),out=new T.Vector3();
 expect(followRoute([seatApproach(seat)],0,at,out,.08).arrived).toBe(false);
 const changes:boolean[]=[],pose=new EventPlayerPose(on=>changes.push(on));pose.request('sit','zone:seat');pose.update(false,false);expect(pose.sitting).toBe(false);
 pose.update(false,true);pose.request('sit','zone:seat');pose.update(false,true);expect(changes).toEqual([true]);
 pose.request('stand');expect(changes).toEqual([true,false]);expect(pose.target).toBeUndefined();
});

afterEach(()=>vi.restoreAllMocks());
it('registered bench geometry has matching board/back colliders and a free front approach',async()=>{
 vi.spyOn(GLTFLoader.prototype,'loadAsync').mockImplementation(async(url)=>loadRideAsset(String(url)) as never);
 const data=JSON.parse(fs.readFileSync('public/data/story-zones.json','utf8')) as StoryZones;
 const registry=new SeatRegistry(data.seats!,()=>0,()=>0),root=new T.Group();
 const group=await addSeatProps(root,registry,p=>'public/'+p,()=>true);
 expect(group.children.length).toBeGreaterThan(0);expect(group.userData.obstacles).toHaveLength(22);
 const bounds=new T.Box3().setFromObject(group);
 expect(bounds.min.x).toBeLessThan(-315);expect(bounds.max.z).toBeGreaterThan(474.7);
 for(const mesh of group.children as T.Mesh[])expect(mesh.geometry.attributes.position.array).toBeInstanceOf(Float32Array);
 await initPhysics();const floor=new T.Mesh(new T.BoxGeometry(1500,1,1500),new T.MeshBasicMaterial());floor.position.y=-.5;
 const physics=new RapierController(floor);physics.teleport(new T.Vector3(400,0,400));physics.addObstacles(group.userData.obstacles);
 for(const id of Object.keys(data.seats!)){
  const s=registry.get(id)!,at=seatApproach(s).add(new T.Vector3(0,.875,0));
  expect(physics.sweepActor(id,at,at,.32,1.7),id).toBe(Infinity);
 }
 physics.dispose();
});
it('NPC seat locks position/yaw through a conversation and player proximity,',async()=>{
 vi.spyOn(GLTFLoader.prototype,'loadAsync').mockImplementation(async(url)=>loadRideAsset(String(url)) as never);
 const zones:StoryZones={zones:{home:{label:'home',p:[0,0],r:4}},npcs:{},seats:{chair:{...spec,foot:[0,0]}}};
 const data={version:1,trees:{},npcs:[{id:'seated',name:'坐者',role:'',portrait:{},model:'npc-guide',schedule:{day:{at:'home',activity:'Sit',seat:'chair'},sunset:null,night:null}}]} as NpcData;
 const manager=new NpcManager(zones,undefined,undefined,p=>'public/'+p,data);manager.setCollision((_id,a,b)=>a.equals(b)?Infinity:a.distanceTo(b),()=>0);
 await manager.load();manager.schedule('day',true,{});const npc=manager.get('seated')!,position=npc.position.clone();
 for(let i=0;i<60;i++)manager.update(1/30,new T.Vector3(0,0,-1));manager.setTalking('seated');
 for(let i=0;i<60;i++)manager.update(1/30,new T.Vector3(.1,0,-.6));
 expect(npc.position.equals(position)).toBe(true);expect(npc.heading).toBe(spec.yaw);expect(npc.seatDiagnostics!.contact).toBeCloseTo(.475,3);
 expect(manager.seats.claim('chair','player')).toBe(false);manager.setTalking(undefined);manager.schedule('night',true,{});expect(manager.seats.claim('chair','player')).toBe(true);
 manager.dispose();
});
it('switching character while seated preserves the seat and releases corrections on standing',async()=>{
 const avatar=new Avatar();
 for(const body of ['m','f']){const asset=await loadRideAsset(`public/models/characters/student-${body}.glb`);asset.scene.rotation.y=Math.PI;avatar.setModel(asset.scene,asset.animations);avatar.setSeated(true,0,seat);for(let i=0;i<15;i++)avatar.update(1/30,frame);expect(avatar.seatDiagnostics!.contact).toBeCloseTo(2.475,3);expect(avatar.state).toBe('sit');}
 avatar.setSeated(false);avatar.update(.1,frame);expect(avatar.seatView).toBeUndefined();expect(avatar.root.position.toArray()).toEqual(frame.foot.toArray());avatar.dispose();
});
