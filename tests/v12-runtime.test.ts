import {afterEach,beforeAll,expect,it,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import * as T from 'three';
import {normalizeLift,LiftRuntime} from '../src/walk/lift';
import { liftDoorYaw,makeWorldLift,syncLift,liftObstacles,insideLift,liftDoorOccupied,LiftPassenger,PASSENGER_MARGIN} from '../src/walk/lift-world';
import {nearestLift,liftWins} from '../src/walk/interaction';
import type {WalkWorld} from '../src/walk-world';
import {initPhysics,RapierController} from '../src/walk/controller';
import {gestureReactions} from '../src/walk/gestures';
import {searchDestinations} from '../src/walk/search';
import {Avatar} from '../src/walk/avatar';
import {Npc,NpcManager} from '../src/world/npc';
import {WalkInput} from '../src/walk/input';
import type {LiftSpec,WalkDestination} from '../src/walk-types';
const old:LiftSpec={id:'fixture-lift',center:[0,0],size:2,angle:0,basis:'schematic',stops:[1,2,3,4].map(n=>({floorId:`F${n}`,level:n,storey:n}))};
const tick=(lift:LiftRuntime,n:number)=>{for(let i=0;i<n*60;i++)lift.update(1/60,{doorway:false});};
const until=(lift:LiftRuntime,predicate:()=>boolean)=>{for(let i=0;i<6000&&!predicate();i++)lift.update(1/60,{doorway:false});expect(predicate()).toBe(true);};
beforeAll(initPhysics);
afterEach(()=>vi.unstubAllGlobals());
it('normalizes legacy lifts without mutating input and respects authored landing geometry',()=>{
 const copy=JSON.stringify(old),g=normalizeLift(old,'SC');expect(g.shaftPolygon).toHaveLength(4);expect(g.stops[0].landingDoor).toEqual({center:[-1,0],tangent:[-0,1],clearWidth:.9});expect(JSON.stringify(old)).toBe(copy);
 g.stops[0].landingDoor.center=[0,1];expect(normalizeLift(g,'SC').stops[0].landingDoor.center).toEqual([0,1]);expect(g.replacesServiceIds).toEqual([]);
});
it('calls remotely, opens only on arrival, and reopens on door occupancy',()=>{
 const l=new LiftRuntime(normalizeLift(old,'SC'));expect(l.snapshot.phase).toBe('idle');expect(l.call('bad')).toBe(false);
 l.call('F3');until(l,()=>l.snapshot.phase==='moving');expect(l.snapshot.atFloorId).toBeNull();expect(l.snapshot.doorOpen01).toBe(0);
 until(l,()=>l.snapshot.phase==='open');expect(l.snapshot.atFloorId).toBe('F3');tick(l,2.2);expect(l.snapshot.phase).toBe('closing');
 l.update(.1,{doorway:true});expect(l.snapshot.phase).toBe('opening');l.update(1,{doorway:true});expect(l.snapshot.phase).toBe('open');
 l.holdOpen();l.update(.1,{doorway:false});expect(l.snapshot.phase).toBe('open');
});
it('accepts an ahead stop while moving but completes the direction before a behind request',()=>{
 const l=new LiftRuntime(normalizeLift(old,'SC'));l.select('F4');until(l,()=>l.snapshot.phase==='moving');tick(l,.3);l.select('F2');l.select('F1');
 const arrived:string[]=[];let last='';for(let i=0;i<5000&&arrived.length<3;i++){const s=l.update(1/60,{doorway:false});if(s.phase==='arrived'&&s.atFloorId!==last){arrived.push(s.atFloorId!);last=s.atFloorId!;}}
 expect(arrived).toEqual(['F2','F4','F1']);
});
it('physically boards one car, carries continuously, releases and walks out at the new floor',()=>{
 const parent=new T.Group(),g=normalizeLift({...old,stops:old.stops.slice(0,2)},'SC'),lift=makeWorldLift(g,new T.Matrix4(),new Map(),parent);
 parent.updateMatrixWorld(true);expect(parent.getObjectsByProperty('name','Car fixture-lift')).toHaveLength(1);expect(lift.car.name.startsWith('Lift ')).toBe(false);
 const floors=new T.Group();for(const y of [.08,3.78]){const m=new T.Mesh(new T.BoxGeometry(3,.1,4));m.position.set(-2.5,y-.05,0);floors.add(m);}
 const physics=new RapierController(floors),passenger=new LiftPassenger(),world={lifts:[lift]},zero=new T.Vector3();
 const advance=(dir=zero)=>{
  passenger.update(world,physics.position);lift.runtime.update(1/60,{doorway:liftDoorOccupied(lift,[physics.position])});syncLift(lift);physics.setLiftObstacles(liftObstacles([lift]));
  const carried=passenger.update(world,physics.position);if(carried)physics.carry(carried);else physics.step(dir,1/60,false,1.5);
 };
 try {
  physics.teleport(new T.Vector3(-1.8,.15,0));for(let i=0;i<45;i++)advance();
  // Closed landing stops the capsule; the car is not an open shaft.
  for(let i=0;i<70;i++)advance(new T.Vector3(1,0,0));expect(physics.position.x).toBeLessThan(-1.2);
  lift.runtime.call('F1');for(let i=0;i<65;i++)advance();expect(lift.runtime.snapshot.phase).toBe('open');
  for(let i=0;i<75&&!insideLift(lift,physics.position,.32);i++)advance(new T.Vector3(1,0,0));
  // Move clear of both the landing sensor and the inside face of the door.
  for(let i=0;i<30;i++)advance(new T.Vector3(1,0,0));expect(insideLift(lift,physics.position,.3)).toBe(true);
  const teleport=vi.spyOn(physics,'teleport');lift.runtime.select('F2');let previous=physics.position.y,sawCarried=false;
  for(let i=0;i<600;i++){advance();sawCarried ||= passenger.carried;expect(Math.abs(physics.position.y-previous)).toBeLessThan(.08);previous=physics.position.y;if(lift.runtime.snapshot.phase==='open'&&lift.runtime.snapshot.atFloorId==='F2')break;}
  expect(sawCarried).toBe(true);expect(teleport).not.toHaveBeenCalled();expect(passenger.carried).toBe(false);expect(physics.position.y).toBeCloseTo(3.78,1);
  for(let i=0;i<100&&physics.position.x>-1.8;i++)advance(new T.Vector3(-1,0,0));expect(physics.position.x).toBeLessThan(-1.6);expect(physics.position.y).toBeCloseTo(3.78,1);passenger.clear();expect(passenger.motion).toEqual({kind:'walk'});
 }finally{physics.dispose();}
});
it('selects ±60° nearest primary and two nods, while seated/dialogue NPCs only nod',()=>{
 const npcs=[{id:'near',position:[1,0,-1] as [number,number,number]},{id:'far',position:[0,0,-3] as [number,number,number]},{id:'back',position:[0,0,1] as [number,number,number]},{id:'extra',position:[-1,0,1] as [number,number,number]},{id:'upstairs',position:[0,3.7,-1] as [number,number,number]}];
 const result=gestureReactions('bow',[0,0,0],0,npcs);expect(result[0]).toEqual({npcId:'near',role:'primary',kind:'bow'});expect(result).toHaveLength(3);expect(result.slice(1).every(r=>r.kind==='nod')).toBe(true);
 for(const flag of ['seated','talking','reserved'])expect(gestureReactions('wave',[0,0,0],0,[{...npcs[0],[flag]:true}])[0].kind).toBe('nod');
 expect(gestureReactions('clap',[0,0,0],0,npcs,n=>n.id!=='near')[0]).toMatchObject({npcId:'far',kind:'clap'});
});
it('one-shot player gestures end and attempted movement cancels them, Sit dispatch remains intact',()=>{
 const avatar=new Avatar(),model=new T.Group();model.name='figure';const clips=['Idle','Walk','Sit','Wave','Bow','ThumbsUp','Clap'].map(name=>new T.AnimationClip(name,.5,[]));avatar.setModel(model,clips);
 const frame={foot:new T.Vector3(),onGround:true,airborneFor:0,speed:0,intendedSpeed:0,jumped:false,runSpeed:7.2};
 for(const gesture of ['wave','bow','thumbsUp','clap'] as const){avatar.gesture(gesture);avatar.update(.1,frame);expect(avatar.state).toBe(gesture);avatar.update(.1,{...frame,intendedSpeed:1});expect(avatar.state).not.toBe(gesture);avatar.gesture(gesture);for(let i=0;i<60;i++)avatar.update(1/60,frame);expect(avatar.state).toBe('idle');}
 avatar.setSeated(true);avatar.gesture('bow');avatar.update(.1,frame);expect(avatar.state).toBe('sit');avatar.setSeated(false);avatar.gesture('clap');avatar.update(.1,frame);expect(avatar.state).toBe('clap');avatar.dispose();
});
it('NPC nod overlays keep Talk running and restore the head without cumulative drift',()=>{
 const model=new T.Group(),head=new T.Bone();head.name='Head';model.add(head);const npc=new Npc('n',model,['Idle','Talk','Sit','Wave','Bow','Clap'].map(name=>new T.AnimationClip(name,1,[])));npc.talking=true;npc.react('bow',new T.Vector3(1,0,-1));
 npc.update(.15,()=>0,new T.Vector3(1,0,-1),true);expect(npc.animationState.clip).toBe('Talk');expect(Math.abs(head.rotation.x)+Math.abs(head.rotation.y)).toBeGreaterThan(0);
 for(let i=0;i<100;i++)npc.update(1/60,()=>0,new T.Vector3(1,0,-1),true);expect(head.quaternion.angleTo(new T.Quaternion())).toBeLessThan(1e-6);expect(npc.animationState.clip).toBe('Talk');npc.dispose();
});
it('search lists all alias children lexically and chooses shortest reachable restroom route',()=>{
 const d=(id:string,category:'room'|'restroom',aliases?:string[]):WalkDestination=>({id,label:id,category,aliases,buildingId:'SC',floorId:'F1',position:[0,0,0],level:1});
 const rooms=[d('SC2003-2','room',['SC2003']),d('SC2003-1','room',['SC2003']),d('SC2003-3','room',['SC2003']),d('WC1','restroom'),d('WC2','restroom'),d('WC3','restroom')];
 expect(searchDestinations(rooms,'sc2003').map(d=>d.id)).toEqual(['SC2003-1','SC2003-2','SC2003-3']);
 for(const term of ['廁所','洗手間','ｗｃ'])expect(searchDestinations(rooms,term,d=>({WC1:Infinity,WC2:20,WC3:5}[d.id]??Infinity)).map(d=>d.id)).toEqual(['WC3']);
 expect(searchDestinations(rooms,'WC',()=>Infinity)).toEqual([]);
});
it('T, Q and 1–9 are owned; carried mode suppresses movement and photo T stays modal',()=>{
 const element=()=>Object.assign(new EventTarget(),{style:{},classList:{remove:()=>{}},setPointerCapture:()=>{}}) as unknown as HTMLElement;
 const win=new EventTarget(),doc=Object.assign(new EventTarget(),{pointerLockElement:null});vi.stubGlobal('window',win);vi.stubGlobal('document',doc);
 const press=vi.fn(),modal=vi.fn(),move=vi.fn(),input=new WalkInput(element(),element(),element(),{press,modal,moveStarted:move,look:()=>{},zoom:()=>{},canLook:()=>false});
 const key=(key:string)=>{const e=Object.assign(new Event('keydown',{cancelable:true}),{key,repeat:false});win.dispatchEvent(e);return e;};
 for(const k of ['t','q','9'])expect(key(k).defaultPrevented).toBe(true);expect(press).toHaveBeenCalledWith('9');
 input.mode='carried';key('w');key('9');expect(input.keys.has('w')).toBe(true);expect(input.axes).toEqual({forward:0,right:0});expect(move).not.toHaveBeenCalled();expect(modal).toHaveBeenLastCalledWith('9','carried');input.mode='photo';key('t');expect(modal).toHaveBeenLastCalledWith('t','photo');input.dispose();
});

it('manager cooldown does not cancel reserved paths and secondary nods do not turn the body',()=>{
 const manager=new NpcManager({zones:{},npcs:{}},undefined,undefined,x=>x),model=new T.Group(),head=new T.Bone();head.name='Head';model.add(head);
 const npc=new Npc('n',model,['Idle','Talk','Sit','Wave','Bow','Clap'].map(name=>new T.AnimationClip(name,1,[])));npc.position.set(0,0,-2);
 (manager as unknown as {npcs:Map<string,Npc>}).npcs.set('n',npc);manager.reserveForGame('n',true);npc.path=[new T.Vector3(3,0,-2)];const path=npc.path;
 expect(manager.reactToGesture('bow',new T.Vector3(),0)).toEqual([{npcId:'n',role:'primary',kind:'nod'}]);expect(npc.path).toBe(path);expect(manager.reactToGesture('wave',new T.Vector3(),0)).toEqual([]);
 manager.update(8.1,new T.Vector3());expect(manager.reactToGesture('wave',new T.Vector3(),0)).toHaveLength(1);expect(npc.path).toBe(path);
 manager.reserveForGame('n',false);npc.path=[];npc.heading=.7;npc.root.rotation.y=.7;npc.react('nod',new T.Vector3());npc.update(.1,()=>0,new T.Vector3(),true);expect(npc.heading).toBe(.7);expect(npc.animationState.clip).toBe('Idle');manager.dispose();
});

// ---- fix1: lift occupancy, carried boundaries and interaction --------------------------------
const twoStops=old.stops.slice(0,2);
/** A scaled building frame with an authored shaft wider than the car (sill gap). */
function scaledLift(scale:number,gap:boolean){
 const frame=new T.Matrix4().makeScale(scale,1,scale),parent=new T.Group();parent.applyMatrix4(frame);
 const spec:LiftSpec=gap?{...old,stops:twoStops.map(s=>({...s,approach:[-2,0] as [number,number],landingDoor:{center:[-1.2,0] as [number,number],tangent:[0,1] as [number,number],clearWidth:.9}})),shaftPolygon:[[-1.2,-1.2],[1.2,-1.2],[1.2,1.2],[-1.2,1.2]],cabinSize:[1.8,1.8]}:{...old,stops:twoStops};
 const lift=makeWorldLift(normalizeLift(spec,'SC'),frame,new Map(),parent);parent.updateMatrixWorld(true);syncLift(lift);return {lift,frame,parent};
}
it('door sensor and passenger zones tile the car and sill in world metres at any scale',()=>{
 for(const scale of [.8,1,1.4])for(const gap of [false,true]){
  const {lift}=scaledLift(scale,gap);lift.runtime.call('F1');for(let i=0;i<90;i++)lift.runtime.update(1/60,{doorway:false});syncLift(lift);
  expect(lift.runtime.snapshot.doorOpen01).toBe(1);
  const landing=lift.stops[0].landing.getWorldPosition(new T.Vector3()).x,back=lift.car.localToWorld(new T.Vector3(lift.geometry.cabinSize[0]/2,0,0)).x;
  // Capsule centres cannot come nearer than radius + half wall to the back wall.
  for(let x=landing-.25;x<back-PASSENGER_MARGIN-.04*scale;x+=.01)for(const z of [-.3,0,.3]){
   const p=new T.Vector3(x,.08,z),inCar=insideLift(lift,p),onSill=x>=landing-.25&&x<=lift.car.localToWorld(new T.Vector3(-lift.geometry.cabinSize[0]/2,0,0)).x;
   if(inCar||onSill)expect(liftDoorOccupied(lift,[p])||insideLift(lift,p,PASSENGER_MARGIN),`scale ${scale} gap ${gap} x ${x.toFixed(2)} z ${z}`).toBe(true);
  }
 }
});
it('closed doors sense nobody, and a remote call departs at once with someone waiting at the closed door',()=>{
 const {lift}=scaledLift(1,false),l=lift.runtime;expect(l.snapshot.phase).toBe('idle');expect(l.snapshot.doorOpen01).toBe(0);
 const waiting=lift.stops[0].landing.getWorldPosition(new T.Vector3());expect(liftDoorOccupied(lift,[waiting])).toBe(false);
 l.call('F2');l.update(1/60,{doorway:true});expect(l.snapshot.phase).toBe('moving');expect(l.snapshot.doorOpen01).toBe(0);
 until(l,()=>l.snapshot.phase==='open');expect(l.snapshot.atFloorId).toBe('F2');
 // A call at the current floor opens instead of travelling.
 const here=new LiftRuntime(normalizeLift(old,'SC'));here.call('F1');here.update(1/60,{doorway:true});expect(here.snapshot.phase).toBe('opening');
});
it('a rider without a request is never locked; doors stay open, also when the car was idle',()=>{
 const {lift}=scaledLift(1.4,false),floors=new T.Group();
 for(const y of [.08,3.78]){const m=new T.Mesh(new T.BoxGeometry(4,.1,4));m.position.set(-3.4,y-.05,0);floors.add(m);}
 const physics=new RapierController(floors),passenger=new LiftPassenger(),world={lifts:[lift]};
 try{
  physics.setLiftObstacles(liftObstacles([lift]));physics.teleport(new T.Vector3(.2,.2,0));
  for(let i=0;i<360;i++){
   passenger.update(world,physics.position);lift.runtime.update(1/60,{doorway:liftDoorOccupied(lift,[physics.position]),cabin:insideLift(lift,physics.position)});syncLift(lift);physics.setLiftObstacles(liftObstacles([lift]));
   const carried=passenger.update(world,physics.position);expect(carried).toBeUndefined();expect(passenger.carried).toBe(false);physics.step(new T.Vector3(),1/60,false,1.5);
  }
  expect(insideLift(lift,physics.position)).toBe(true);expect(lift.runtime.snapshot).toMatchObject({phase:'open',doorOpen01:1,atFloorId:'F1'});
  // Without cabin occupancy the car closes to idle; the rider still is not carried and can walk.
  for(let i=0;i<300;i++){passenger.update(world,physics.position);lift.runtime.update(1/60,{doorway:false});syncLift(lift);physics.setLiftObstacles(liftObstacles([lift]));expect(passenger.update(world,physics.position)).toBeUndefined();physics.step(new T.Vector3(),1/60,false,1.5);}
  expect(lift.runtime.snapshot.phase).toBe('idle');const x=physics.position.x;for(let i=0;i<20;i++)physics.step(new T.Vector3(1,0,0),1/60,false,1.5);expect(physics.position.x).toBeGreaterThan(x+.1);
  // Modal hold-open keeps a selected floor waiting.
  lift.runtime.select('F2');for(let i=0;i<300;i++){lift.runtime.holdOpen();lift.runtime.update(1/60,{doorway:false,cabin:true});}expect(lift.runtime.snapshot.phase).toBe('open');
 }finally{physics.dispose();}
});
for(const dt of [1/60,.065,.25])it(`a carried rider never falls through, even jumping at departure in a scaled car with a sill gap (dt ${dt.toFixed(3)})`,()=>{
 const {lift}=scaledLift(1.4,true),floors=new T.Group(),frames=Math.ceil(16.5/dt),opened=Math.ceil(1.5/dt);
 // Landing floors reach the car edge; the shaft below stays empty.
 for(const y of [.08,3.78]){const m=new T.Mesh(new T.BoxGeometry(3,.1,4));m.position.set(-1.27-1.5,y-.05,0);floors.add(m);}
 const physics=new RapierController(floors),passenger=new LiftPassenger(),world={lifts:[lift]};
 const carY=()=>lift.car.getWorldPosition(new T.Vector3()).y;
 try{
  physics.setLiftObstacles(liftObstacles([lift]));physics.teleport(new T.Vector3(.3,.2,0));
  let jumped=false,sawCarried=false,lowest=Infinity;
  for(let i=0;i<frames;i++){
   if(i===opened){expect(lift.runtime.snapshot.phase).toBe('open');lift.runtime.select('F2');}
   passenger.update(world,physics.position);lift.runtime.update(dt,{doorway:liftDoorOccupied(lift,[physics.position]),cabin:insideLift(lift,physics.position)});syncLift(lift);physics.setLiftObstacles(liftObstacles([lift]));
   const s=lift.runtime.snapshot,carried=passenger.update(world,physics.position);
   if(carried)physics.carry(carried);else{const jump:boolean=!jumped&&s.phase==='closing'&&s.doorOpen01<.35;jumped||=jump;physics.step(new T.Vector3(),dt,jump,1.5);}
   sawCarried||=passenger.carried;if(s.phase==='moving')lowest=Math.min(lowest,physics.position.y-carY());
   if(s.phase==='open'&&s.atFloorId==='F2')break;
  }
  expect(jumped).toBe(true);expect(sawCarried).toBe(true);expect(lowest).toBeGreaterThan(-.05);expect(passenger.carried).toBe(false);expect(physics.position.y).toBeCloseTo(3.78,1);
 }finally{physics.dispose();}
});
it('nearestLift prefers the car the player stands in, even at the back of a scaled cabin',()=>{
 const {lift}=scaledLift(1.4,false),world={lifts:[lift],doors:[],scales:new Map([['SC',1.4]])} as unknown as WalkWorld;
 const back=lift.car.localToWorld(new T.Vector3(lift.geometry.cabinSize[0]/2-.25,0,0));
 expect(nearestLift(world,back)?.lift).toBe(lift);expect(nearestLift(world,back)?.stop.floorId).toBe('F1');
 expect(liftWins(world,back)?.lift).toBe(lift);
});
it('a gesture interrupted by riding does not hold the ride pose after dismounting',()=>{
 const avatar=new Avatar(),model=new T.Group();avatar.setModel(model,['Idle','Walk','Bow'].map(name=>new T.AnimationClip(name,name==='Bow'?2:.5,[])));
 (avatar as unknown as {rideRig:unknown}).rideRig={ready:true,reset(){},releaseGround(){},apply:()=>true};
 const frame={foot:new T.Vector3(),onGround:true,airborneFor:0,speed:0,intendedSpeed:0,jumped:false,runSpeed:7.2};
 avatar.gesture('bow');avatar.update(.1,frame);expect(avatar.state).toBe('bow');
 avatar.riding=true;avatar.update(.1,frame);expect(avatar.state).toBe('ride');avatar.riding=false;avatar.update(.1,frame);expect(avatar.state).toBe('idle');avatar.dispose();
});
it('an NPC replying with a full gesture is not treated as stalled by recovery',()=>{
 const manager=new NpcManager({zones:{},npcs:{}},undefined,undefined,x=>x),model=new T.Group();
 const npc=new Npc('n',model,['Idle','Walk','Talk','Sit','Wave','Bow','Clap'].map(name=>new T.AnimationClip(name,name==='Bow'?2.5:1,[])));npc.position.set(0,0,-2);
 (manager as unknown as {npcs:Map<string,Npc>}).npcs.set('n',npc);npc.path=[new T.Vector3(1,0,-2)];const path=npc.path,goal=path[0];
 npc.react('bow',new T.Vector3());expect(npc.gesturing).toBe(true);
 for(let i=0;i<120;i++)manager.update(1/60,new T.Vector3());
 expect(npc.path[0]).toBe(goal);expect(npc.path).toBe(path);manager.dispose();
});
it('a slow frame never moves the car in the update that shuts its doors',()=>{
 for(const offset of [0,.01,.02,.03,.04]){
  const l=new LiftRuntime(normalizeLift(old,'SC'));l.call('F1');until(l,()=>l.snapshot.phase==='open');l.select('F3');
  until(l,()=>l.snapshot.phase==='closing');l.update(.7+offset,{doorway:false});const y=l.snapshot.carPositionWorld[1];
  // QA maxFrame: the shut and up to 0.2 s of travel would share one call without the departure break.
  const s=l.update(.25,{doorway:false});expect(s.phase).toBe('moving');expect(s.carPositionWorld[1]).toBe(y);
 }
});

// Execute the actual frame's lift/input orchestration without starting WebGL or a browser.
// This deliberately includes camera entry/exit cleanup: testing WalkInput alone misses its release() calls.
const runtimeSource=readFileSync('src/walk/runtime.ts','utf8');
const liftFrameSource=runtimeSource.slice(runtimeSource.indexOf('    guide.update();'),runtimeSource.indexOf('    scheduleNpcs();',runtimeSource.indexOf('    guide.update();')));
function liftInputFixture(){
 const element=()=>{const captures=new Set<number>();return Object.assign(new EventTarget(),{
  style:{},classList:{remove:()=>{},toggle:()=>{}},getBoundingClientRect:()=>({left:0,top:0,width:100,height:100}),
  setPointerCapture:(id:number)=>captures.add(id),hasPointerCapture:(id:number)=>captures.has(id),releasePointerCapture:(id:number)=>captures.delete(id),
 }) as unknown as HTMLElement;};
 const win=new EventTarget(),doc=Object.assign(new EventTarget(),{pointerLockElement:null});vi.stubGlobal('window',win);vi.stubGlobal('document',doc);
 const joystick=element(),moveStarted=vi.fn(),modal=vi.fn(),input=new WalkInput(element(),joystick,element(),{press:()=>{},modal,moveStarted,look:()=>{},zoom:()=>{},canLook:()=>false});
 const {lift}=scaledLift(1,false),passenger=new LiftPassenger(),floors=new T.Group();
 for(const y of [.08,3.78]){const m=new T.Mesh(new T.BoxGeometry(3,.1,4));m.position.set(-2.5,y-.05,0);floors.add(m);}
 const physics=new RapierController(floors);physics.teleport(new T.Vector3(0,.08,0));
 const context={input,passenger,world:{lifts:[lift]},physics,insideLift,liftDoorOccupied,liftObstacles,syncLift,
  walking:true,overview:false,bike:{riding:false},npcs:undefined,wasBlocking:false,director:undefined,notebook:undefined,quiz:undefined,
  guide:{open:false,update(){}},gestures:{open:false,close(){}},photo:{active:false},menuOpen:()=>false,
  rig:{yaw:0,pitch:0,distance:4,locked:false,snap(){},protect(){}},carriedCamera:undefined,liftPoses:new WeakMap(),clearAuto(){},avatar:{cancelGesture(){}},
  // v12.1 hooks in the same frame slice: no water/bus/sports runtime in this fixture.
  v12:undefined,rhythm:undefined,realDt:0,sky:{preset:'day'},BIKE_MOTION:{kind:'bike'},WALK_MOTION:{kind:'walk'},cachedLiftObstacles:[],lastBusObstacleKey:'',cancelCampusActivity(){},
 };
 const update=new Function('context',`with(context){return function(dt){${liftFrameSource}\nreturn carried;};}`)(context) as (dt:number)=>T.Vector3|undefined;
 const step=()=>{const carried=update(1/30);if(!carried&&!passenger.carried)physics.step(input.direction(new T.Vector3(-1,0,0)),1/30,false,1.5);};
 const wait=(done:()=>boolean)=>{for(let i=0;i<1000&&!done();i++)step();expect(done()).toBe(true);};
 const key=(type:string,key:string,repeat=false,tag='BUTTON')=>{
  const e=Object.assign(new Event(type,{cancelable:true}),{key,repeat});
  // The window capture listener sees the focused floor button as event.target.
  Object.defineProperty(e,'target',{value:{tagName:tag,matches:(selector:string)=>selector.split(',').includes(tag.toLowerCase())}});
  win.dispatchEvent(e);return e;
 };
 const pointer=(type:string,y=-1)=>joystick.dispatchEvent(Object.assign(new Event(type),{pointerId:1,clientX:50,clientY:50+y*38}));
 const depart=()=>{lift.runtime.select('F2');wait(()=>passenger.carried);step();};
 const arrive=()=>wait(()=>lift.runtime.snapshot.phase==='open'&&lift.runtime.snapshot.atFloorId==='F2');
 const exit=()=>{for(let i=0;i<60;i++)step();expect(physics.intendedSpeed).toBeGreaterThan(0);expect(physics.position.x).toBeLessThan(-1.6);expect(physics.position.y).toBeCloseTo(3.78,1);};
 return {input,win,joystick,moveStarted,modal,physics,passenger,lift,key,pointer,step,depart,arrive,exit,rig:context.rig,dispose(){input.dispose();physics.dispose();}};
}

it('restores pitch, distance and lock on arrival and turns to face the open door',()=>{
 const f=liftInputFixture();
 try{
  const saved={yaw:2.1,pitch:-.6,distance:7,locked:false};Object.assign(f.rig,saved);
  f.depart();expect(f.rig.locked).toBe(true);
  // The travelling view never depends on or overwrites the saved orbit settings.
  expect(runtimeSource).toContain('passenger.updateCamera(camera);');
  f.arrive();
  const {yaw,...rest}=saved;expect(f.rig).toMatchObject(rest);
  // QA (v12 retest): riders walk in facing the back wall; facing the door makes W walk out.
  expect(f.rig.yaw).toBeCloseTo(liftDoorYaw(f.lift),6);
  const [x,z]=f.lift.car.userData.carDoor as [number,number];
  const door=f.lift.car.localToWorld(new T.Vector3(x,0,z)).sub(f.lift.car.localToWorld(new T.Vector3()));
  expect(-Math.sin(f.rig.yaw)*door.x-Math.cos(f.rig.yaw)*door.z).toBeGreaterThan(0);
 }finally{f.dispose();}
});
it('a fresh W on the first open frame exits even with a floor button focused',()=>{
 const f=liftInputFixture();try{
  f.depart();f.arrive();
  expect(f.key('keydown','w').defaultPrevented).toBe(true);f.exit();
 }finally{f.dispose();}
});
it('a fresh W after the arrival transition exits; text fields still own their keys',()=>{
 const f=liftInputFixture();try{
  f.depart();f.arrive();f.step();
  expect(f.key('keydown','w',false,'INPUT').defaultPrevented).toBe(false);expect(f.input.keys.size).toBe(0);
  f.key('keydown','w');f.exit();
 }finally{f.dispose();}
});
for(const repeat of [false,true])it(`W held during travel exits without a fresh press (auto-repeat ${repeat})`,()=>{
 const f=liftInputFixture();try{
  f.depart();f.key('keydown','w');if(repeat)f.key('keydown','w',true);
  expect(f.input.direction(new T.Vector3(-1,0,0)).length()).toBe(0);expect(f.moveStarted).not.toHaveBeenCalled();
  f.arrive();f.exit();expect(f.moveStarted).toHaveBeenCalledTimes(1);f.key('keyup','w');expect(f.input.direction(new T.Vector3(-1,0,0)).length()).toBe(0);
 }finally{f.dispose();}
});
for(const start of ['before','during'])it(`a stationary held joystick started ${start} travel exits without another pointer event`,()=>{
 const f=liftInputFixture();try{
  if(start==='before')f.pointer('pointerdown');f.depart();if(start==='during')f.pointer('pointerdown');
  expect(f.input.direction(new T.Vector3(-1,0,0)).length()).toBe(0);
  expect(f.joystick.hasPointerCapture(1)).toBe(true);f.arrive();f.exit();
  f.pointer('pointerup');expect(f.input.direction(new T.Vector3(-1,0,0)).length()).toBe(0);
 }finally{f.dispose();}
});
it('W held before departure survives camera cleanup',()=>{
 const f=liftInputFixture();try{
  f.key('keydown','w');f.depart();f.arrive();f.exit();
 }finally{f.dispose();}
});
it('desktop auto-repeat after arrival restores W even without another physical press',()=>{
 const f=liftInputFixture();try{
  f.depart();f.key('keydown','w');f.arrive();f.step();
  f.key('keydown','w',true);f.exit();
 }finally{f.dispose();}
});
it('entering without selecting a floor keeps fresh keyboard input usable',()=>{
 const f=liftInputFixture();try{
  for(let i=0;i<180;i++)f.step();expect(f.lift.runtime.snapshot.phase).toBe('open');expect(f.passenger.carried).toBe(false);
  f.key('keydown','w');for(let i=0;i<60;i++)f.step();expect(f.physics.position.x).toBeLessThan(-1.6);expect(f.physics.position.y).toBeCloseTo(.08,1);
 }finally{f.dispose();}
});
for(const cancel of ['keyup','pointerup','pointercancel','lostpointercapture','blur','menu'])it(`carried input respects ${cancel} and never restores released movement`,()=>{
 const f=liftInputFixture();try{
  f.depart();if(cancel==='keyup')f.key('keydown','w');else f.pointer('pointerdown');
  if(cancel==='keyup')f.key('keyup','w');else if(cancel==='blur')f.win.dispatchEvent(new Event('blur'));else if(cancel==='menu')f.input.mode='menu';else f.pointer(cancel);
  f.arrive();f.step();expect(f.input.direction(new T.Vector3(-1,0,0)).length()).toBe(0);expect(f.physics.intendedSpeed).toBe(0);
 }finally{f.dispose();}
});
