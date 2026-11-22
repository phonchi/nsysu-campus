import * as T from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {MeshoptDecoder} from 'three/addons/libs/meshopt_decoder.module.js';
import type {V12Data} from './v12-data';
import type {MotionMode,P3,SeaActivity,WaterBodySpec,WaterDecision,EquipmentSpec} from '../world/v12-types';
import type {Avatar} from './avatar';
import type {RapierController} from './controller';
import type {ActorBody,Obstacle} from './obstacles';
import {SeaPolicyClock,evaluateSea,waterReasons} from './water-policy';
import {SwimRuntime} from './swim';
import {WatercraftRuntime,attachPaddle} from './watercraft';
import {BusFleet,BusPassenger,supportedStopPoint} from './bus';
import {TimedSports,FitnessRuntime} from './sports-activity';
import {SailingShow} from '../world/sailing-show';
import {inside,distance,nearestOnPolygon,SHORE_REACH,validLanding,motionDt} from './v12-geometry';
import {safe,makeDoorSign} from './hud';
import {disposeObject} from '../world/npc';
export interface V12Action {id:string;label:string;point:T.Vector3;run:()=>void}
interface Dependencies {host:HTMLElement;scene:T.Scene;data:V12Data;physics:RapierController;avatar:Avatar;asset:(p:string)=>string;say:(s:string)=>void;cue:(id:string)=>void;modeChanged:()=>void;params:URLSearchParams;ground?:(x:number,z:number)=>number}
/** Runtime adapter owns optional modes; legacy walking remains the only other position writer. */
export class V12Runtime {
 readonly group=new T.Group();readonly swim:SwimRuntime;readonly craft=new WatercraftRuntime();readonly busPassenger=new BusPassenger();readonly fleet?:BusFleet;readonly fitness:FitnessRuntime;readonly timer:TimedSports;readonly policy:SeaPolicyClock;
 private assets=new Map<string,T.Object3D>();private vehicles=new Map<string,T.Object3D>();private sailing?:SailingShow;private alive=true;private panel:HTMLDivElement;private status:HTMLDivElement;private lastPanel='';private rentals=new Set<string>();
 private craftGroup=new T.Group();private paddleGroup=new T.Group();private surfGroup=new T.Group();surfActive=false;private surfTime=0;
 private period:'day'|'sunset'|'night'='day';private visibility=()=>this.policy.update(this.period);
 constructor(private d:Dependencies){
  this.group.name='v12 水域與交通';d.scene.add(this.group);this.group.add(this.craftGroup,this.paddleGroup,this.surfGroup);
  this.policy=new SeaPolicyClock(d.params);this.swim=new SwimRuntime(()=>{d.cue('whistle');d.say('救生員吹哨召回，正沿救援路線返回岸上。');this.timer.invalidate('救援召回');},p=>this.safe(p),p=>this.supported(p));this.fitness=new FitnessRuntime(p=>this.safe(p));
  let storage:Storage|undefined;try{storage=localStorage;}catch{}this.timer=new TimedSports(storage);
  if(d.data.bus){this.fleet=new BusFleet(d.data.bus.routes,d.data.bus.stops,d.ground);this.fleet.applyQa(d.params);}
  this.panel=document.createElement('div');this.panel.className='walk-v12-panel';this.panel.hidden=true;this.panel.setAttribute('role','dialog');this.panel.setAttribute('aria-label','公車下車站');d.host.append(this.panel);
  this.panel.addEventListener('click',e=>{const id=(e.target as HTMLElement).closest<HTMLElement>('[data-bus-stop]')?.dataset.busStop;if(id)this.busPassenger.select(id);});
  this.status=document.createElement('div');this.status.className='walk-v12-status';this.status.setAttribute('role','status');d.host.append(this.status);document.addEventListener('visibilitychange',this.visibility);
 }
 private supported(p:P3){return this.d.physics.supportAt?supportedStopPoint(p,(x,z,y)=>this.d.physics.supportAt(x,z,y),this.d.ground):p;}
 private safe(p:P3){return this.d.physics.canStand(new T.Vector3(...p));}
 private changed(){this.timer.invalidate('移動模式切換');this.d.modeChanged();}
 get mode():MotionMode {
  if(this.busPassenger.bus)return this.busPassenger.motion;
  if(this.swim.water)return {kind:this.swim.phase==='rescue'?'rescue':'swim',waterId:this.swim.water.id};
  if(this.craft.route)return {kind:'watercraft',craftId:this.craft.route.id,type:this.craft.route.craft};
  if(this.fitness.equipment)return {kind:'exercise',equipmentId:this.fitness.equipment.id};return {kind:'walk'};
 }
 get ownsMotion(){return this.mode.kind!=='walk';}
 get locked(){return ['carried','rescue','exercise'].includes(this.mode.kind);}
 get hideAvatar(){return !!this.busPassenger.bus;}
 /** Heading of the bus the player rides (model front = local +Z), for a forward-facing seat view. */
 get busYaw(){return this.busPassenger.bus?.yaw;}
 allowsWater(x:number,z:number){return !!this.swim.water&&inside([x,z],this.swim.water.polygon)||!!this.craft.water&&inside([x,z],this.craft.water.polygon);}
 private decision(w:WaterBodySpec,activity:SeaActivity):WaterDecision {if(w.kind!=='pool')return evaluateSea(activity,this.policy.conditions);const reasons:WaterDecision['reasons']=[];if(w.open===false)reasons.push('operator');if(this.policy.conditions.period==='night')reasons.push('night');return {allowed:!reasons.length,recall:!!reasons.length,reasons};}
 async load(){
  const names=new Set<string>();if(this.d.data.bus){names.add('bus_campus');names.add('bus_orange1');names.add('bus_stop');}
  if(this.d.data.sea){for(const n of ['sup_board','sup_paddle','kayak','kayak_paddle','surfboard','swim_buoy','lifeguard_chair'])names.add(n);if(this.d.data.sea.sailingShow)names.add('laser_dinghy');}
  if(this.d.data.sports||this.d.data.fitness)for(const n of ['treadmill','fitness_station','start_gate'])names.add(n);
  const loader=new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  // Sequential asset loads keep memory bounded while other startup jobs run.
  for(const name of names)try{const g=await loader.loadAsync(this.d.asset(`models/props/${name}.glb`));if(!this.alive){disposeObject(g.scene);return;}this.assets.set(name,g.scene);}catch(error){this.d.data.issues.push(`${name}.glb: ${String(error)}`);}
  if(!this.alive)return;
  if(this.fleet)for(let i=this.fleet.buses.length-1;i>=0;i--){const b=this.fleet.buses[i];if(!this.assets.has(b.route.id==='campus-bus'?'bus_campus':'bus_orange1')){b.dispose();this.fleet.buses.splice(i,1);}}
  for(const b of this.fleet?.buses??[]){const m=this.asset(b.route.id==='campus-bus'?'bus_campus':'bus_orange1');if(m){this.group.add(m);this.vehicles.set(b.id,m);}}
  for(const s of this.d.data.bus?.stops??[]){const p=this.supported(s.sign);if(p){this.place('bus_stop',p);this.sign(`${s.name} 公車站 E`,p);}}
  const sea=this.d.data.sea;if(sea){if(sea.sailingShow&&this.assets.has('laser_dinghy')){this.sailing=new SailingShow(sea.sailingShow,this.assets.get('laser_dinghy')!,text=>{const plate=makeDoorSign(text,76),sprite=new T.Sprite(new T.SpriteMaterial({map:plate.material.map}));sprite.scale.set(1.35,.38,1);plate.geometry.dispose();plate.material.dispose();return sprite;});this.group.add(this.sailing.group);}for(const p of sea.buoys??[])this.place('swim_buoy',p);if(sea.lifeguardChair)this.place('lifeguard_chair',sea.lifeguardChair);if(sea.sailingShow&&sea.viewingPoint)this.sign('帆船賽 情境重現',sea.viewingPoint);if(sea.center)this.sign('海域中心 位置示意・租借 E',sea.center.rentalDesk??sea.center.position);for(const w of sea.waterBodies)for(const p of w.entryPoints){this.sign(w.kind==='pool'?'游泳池・下水 E':'游泳區・下水 E',p);if(w.kind==='sea'){this.sign('夜間、颱風、打雷關閉',[p[0],p[1]-.4,p[2]]);this.sign('浪高達1m 衝浪課／核准訓練',[p[0],p[1]-.8,p[2]]);this.sign('浪高達2m 全面關閉',[p[0],p[1]-1.2,p[2]]);}}}
  for(const p of this.d.data.sports?.portals??[])this.sign('體適能中心・示意 E',p.exteriorTrigger);
  for(const e of this.equipment())this.place(e.kind==='treadmill'?'treadmill':'fitness_station',e.position,e.yaw);
  for(const c of this.d.data.sports?.courses??[]){const g=c.gates[0];this.place('start_gate',g.a.map((n,i)=>(n+g.b[i])/2) as P3);}
 }
 private asset(name:string){return this.assets.get(name)?.clone(true);}
 private place(name:string,p:P3,yaw=0){const m=this.asset(name);if(m){m.position.fromArray(p);m.rotation.y=yaw;this.group.add(m);}return m;}
 private sign(text:string,p:P3){const m=makeDoorSign(text);m.position.fromArray(p).y+=2;this.group.add(m);}
 /** Player-facing names for the story-zone anchors above (never show raw data ids). */
 anchorLabel(id:string):string|undefined{
  const sea=this.d.data.sea;
  if(id===(sea?.center?.id??'sea-center'))return '海域運動中心（位置示意）';
  const w=sea?.waterBodies.find(w=>w.id===id);if(w)return (w as {name?:string}).name??(w.kind==='pool'?'游泳池':'游泳區');
  const r=sea?.routes.find(r=>r.id===id);if(r)return r.craft==='sup'?'SUP 下水點':'獨木舟下水點';
  if(id==='surf-zone')return '衝浪區';
  if(id===sea?.sailingShow?.viewingAnchorId||id==='sail-view')return '帆船賽觀賞點';
  if(this.d.data.sports?.portals.some(p=>p.id===id))return '體適能中心';
  return undefined;
 }
 anchors():Record<string,P3>{
  const sea=this.d.data.sea,out:Record<string,P3>={...sea?.anchors};
  if(sea?.center)out[sea.center.id??'sea-center']=sea.center.position;
  for(const w of sea?.waterBodies??[])out[w.id]=w.entryPoints[0];for(const r of sea?.routes??[])out[r.id]=r.launchPoint;
  if(sea?.surfZone?.position)out['surf-zone']=sea.surfZone.position;
  if(sea?.sailingShow&&sea.viewingPoint)out[sea.sailingShow.viewingAnchorId]=sea.viewingPoint;
  for(const p of this.d.data.sports?.portals??[])out[p.id]=p.exteriorTrigger;return out;
 }
 private equipment():EquipmentSpec[]{return [...this.d.data.sports?.equipment??[],...this.d.data.fitness?.scenes.flatMap(s=>s.equipment)??[]];}
 private move(p:P3){if(!this.safe(p))return false;this.d.physics.carry(new T.Vector3(...p));this.changed();return true;}
 actions(foot:T.Vector3):V12Action[]{
  const out:V12Action[]=[],at=foot.toArray() as P3,add=(id:string,label:string,p:P3,run:()=>void,reach=3)=>{if(distance(at,p)<reach)out.push({id:`v12:${id}`,label,point:new T.Vector3(...p),run});};
  if(this.busPassenger.bus||this.swim.phase==='rescue')return out;
  if(this.fitness.equipment){out.push({id:'v12:stop',label:'停止運動',point:foot.clone(),run:()=>this.stopEquipment()});return out;}
  if(this.swim.water){const w=this.swim.water,exit=this.swim.exitPoint();for(const p of [...w.exitPoints,...(exit?[exit]:[])])if(validLanding(p,w.polygon)){const edge=nearestOnPolygon([p[0],p[2]],w.polygon);add('exit-water','上岸 E',[edge[0],foot.y,edge[1]],()=>{const q=this.swim.exit();if(q)this.move(q);else this.d.say('上岸位置暫時受阻，請稍候或使用選單回到起點。');},SHORE_REACH);}}
  else if(this.craft.route){const p=this.craft.route.returnPoint;add('return-craft','歸還船具',[p[0],foot.y,p[2]],()=>{if(!this.safe(p))return;const q=this.craft.returnToShore();if(q){this.craftGroup.clear();this.paddleGroup.clear();this.move(q);}},15);return out;}
  else if(this.fitness.portal){const s=this.d.data.fitness?.scenes.find(s=>s.id===this.fitness.portal!.interiorSceneId);if(s)add('exit-fitness','離開體適能中心',s.exitPoint,()=>{const p=this.fitness.exit();if(p)this.move(p);else this.d.say('出口暫時受阻，可從選單回到起點。');});for(const e of this.equipment())add(e.id,e.kind==='treadmill'?'使用跑步機':'使用健身車',e.approach,()=>{if(this.fitness.use(e,at))this.changed();});return out;}
  else {
   for(const w of this.d.data.sea?.waterBodies??[])for(const p of w.entryPoints)add(w.id,`${w.kind==='pool'?'泳池':'海域'}下水`,p,()=>{const allowed=this.decision(w,'swim');if(!allowed.allowed){this.d.say('目前不開放游泳：'+waterReasons(allowed));return;}if(this.swim.enter(w,at,allowed))this.changed();else this.d.say('目前沒有安全的下水／返回位置。');});
   const center=this.d.data.sea?.center;
   if(center)for(const craft of ['sup','kayak'])add(`rent-${craft}`,`租借 ${craft==='sup'?'SUP':'獨木舟'}`,center.rentalDesk??center.position,()=>{if(!evaluateSea(craft as SeaActivity,this.policy.conditions).allowed){this.d.say('目前海況不開放租借。');return;}this.rentals.add(craft);this.d.say('已借好船具，請到沙灘的下水點。');});
   for(const r of this.d.data.sea?.routes??[])if(this.rentals.has(r.craft)||!center)add(r.id,`${r.craft==='sup'?'SUP':'獨木舟'}下水`,r.launchPoint,()=>{const w=this.d.data.sea!.waterBodies.find(w=>w.id===r.waterId)!;if(this.craft.rent(r,w,at,this.decision(w,r.craft))){this.changed();this.craftGroup.clear();this.paddleGroup.clear();const model=this.asset(r.craft==='sup'?'sup_board':'kayak'),paddle=this.asset(r.craft==='sup'?'sup_paddle':'kayak_paddle');if(model)this.craftGroup.add(model);if(paddle)this.paddleGroup.add(paddle);}});
   for(const b of this.fleet?.buses??[])if(b.atStop&&this.supported(b.stop.boardingPoint))add(b.id,`搭乘${b.route.id==='campus-bus'?'校園公車':'橘1延'} E`,this.supported(b.stop.boardingPoint)!,()=>{if(this.busPassenger.board(b,at,p=>this.supported(p))){b.departureHold=undefined;this.changed();}else this.d.say('目前沒有安全的上車位置。');},3.5);
   for(const p of this.d.data.sports?.portals??[])if(this.d.data.fitness?.scenes.some(s=>s.id===p.interiorSceneId))add(p.id,'進入體適能中心（示意）',p.exteriorTrigger,()=>{const q=this.fitness.enter(p,at);if(q)this.move(q);else this.d.say('室內尚未有安全落點。');});
  }
  for(const c of this.d.data.sports?.courses??[]){const g=c.gates.find(g=>g.id===c.requiredGateSequence[0]);if(!g)continue;const p=g.a.map((n,i)=>(n+g.b[i])/2) as P3;if(c.mode==='run'&&Math.abs(foot.y-p[1])>1.5)continue;if(c.mode==='swim'?this.swim.water?.id===c.waterId:!this.ownsMotion)add(c.id,`${c.mode==='run'?'跑圈':'泳池'}計時${this.timer.best[c.id]?`・最佳 ${this.timer.best[c.id].toFixed(1)} 秒`:''}`,[p[0],foot.y,p[2]],()=>{if(!this.timer.start(c,this.swim.water?this.swim.position.toArray():at))this.d.say('請站在賽道內、起跑線後方再開始。');},5);}
  return out;
 }
 key(k:string){if(this.busPassenger.bus){if(/^[1-9]$/.test(k)){const o=this.busPassenger.bus.route.stopOccurrences[+k-1];if(o)this.busPassenger.select(o.occurrenceId);}return true;}if(this.fitness.equipment&&(k==='e'||k==='escape')){const stopped=this.stopEquipment();return k==='escape'?stopped:true;}return this.swim.phase==='rescue';}
 private stopEquipment(){const p=this.fitness.stop();if(p)return this.move(p);this.d.say('器材出口暫時受阻；按 Esc 開啟選單，可回到起點。');return false;}
 beginSurf(foot:T.Vector3){if(!this.d.data.sea||!evaluateSea('surf-class',this.policy.conditions).allowed)return false;this.endSurf();this.surfActive=true;this.surfTime=0;const board=this.asset('surfboard');if(board)this.surfGroup.add(board);this.surfGroup.position.copy(foot);const wave=new T.Mesh(new T.PlaneGeometry(6,5,24,20).rotateX(-Math.PI/2),new T.MeshStandardMaterial({color:'#66a8b6',transparent:true,opacity:.65}));wave.userData.v12Owned=true;wave.position.y=-.15;this.surfGroup.add(wave);return true;}
 endSurf(){this.surfActive=false;for(const c of this.surfGroup.children)if(c.userData.v12Owned)disposeObject(c);this.surfGroup.clear();}
 update(dt:number,direction:T.Vector3,bodies:ActorBody[],period:'day'|'sunset'|'night',external:MotionMode,paused=false,playerDt=motionDt(dt)):T.Vector3|undefined {
  this.period=period;this.policy.update(period);const foot=this.d.physics.position;
  this.fleet?.update(dt,[{id:'player',position:foot.toArray(),radius:.32},...bodies.map(b=>({id:b.id,position:b.position.toArray() as P3,radius:b.radius}))],this.busPassenger.bus?.id);
  for(const b of this.fleet?.buses??[]){const m=this.vehicles.get(b.id);if(m){m.visible=b.active&&b.id!==this.busPassenger.bus?.id; // riding: hide own shell so the seat view sees out
 m.position.copy(b.position);m.rotation.set(-b.pitch,b.yaw,0,'YXZ');}}
  if(this.sailing){this.sailing.group.visible=evaluateSea('sailing-show',this.policy.conditions).allowed;if(this.sailing.group.visible)this.sailing.update(dt);
  // Team labels only near the seawall viewing point; elsewhere they would crowd the skyline (QA v12.1 final OBS-2).
  if(this.sailing?.group.visible){const vp=this.d.data.sea?.viewingPoint,near=!vp||Math.hypot(foot.x-vp[0],foot.z-vp[2])<120;for(const g of this.sailing.group.children){const l=g.getObjectByName('team-label');if(l)l.visible=near;}}}
  if(this.surfActive){if(!evaluateSea('surf-class',this.policy.conditions).allowed)this.endSurf();else{this.surfTime+=dt;for(const child of this.surfGroup.children){if(child.userData.v12Owned&&child instanceof T.Mesh){const p=child.geometry.attributes.position;for(let i=0;i<p.count;i++)p.setY(i,Math.sin(p.getZ(i)*1.8-this.surfTime*2)*.18);p.needsUpdate=true;child.geometry.computeVertexNormals();}else{child.rotation.z=Math.sin(this.surfTime*2)*.08;child.position.y=Math.sin(-this.surfTime*2)*.18;}}}}
  const input=paused?new T.Vector3():direction;let out:T.Vector3|undefined;
  if(this.craft.route){const route=this.craft.route,water=this.craft.water!;if(this.craft.update(paused?0:playerDt,input,this.decision(water,route.craft))==='recall'){this.swim.adoptForRescue(water,this.craft.position.toArray());this.craft.clear();this.craftGroup.clear();this.paddleGroup.clear();this.changed();}}
  if(this.swim.water){const exit=this.swim.update(paused?0:this.swim.phase==='rescue'?dt:playerDt,input,this.decision(this.swim.water,'swim'),!!this.timer.course);out=exit?new T.Vector3(...exit):this.swim.foot;if(exit){this.d.physics.carry(new T.Vector3(...exit));this.d.modeChanged();}}
  else if(this.craft.route){out=this.craft.position.clone().add(new T.Vector3(0,.8,0));this.craftGroup.position.copy(this.craft.position);this.craftGroup.rotation.y=this.craft.heading+Math.PI;}
  const passenger=this.busPassenger.update(p=>this.safe(p),dt,p=>this.supported(p));if(passenger){out=new T.Vector3(...passenger.foot);if(passenger.exit){this.d.physics.carry(out);this.d.modeChanged();}}
  if(this.fitness.equipment)out=new T.Vector3(...this.fitness.equipment.position);
  this.d.avatar.externalPose=undefined;
  const frame=this.swim.frame??this.craft.frame;if(frame)this.d.avatar.externalPose={position:frame.renderRootWorld,heading:frame.heading,clip:frame.clip};
  if(this.fitness.equipment){const e=this.fitness.equipment;this.d.avatar.externalPose={position:e.position,heading:e.yaw,clip:e.kind==='treadmill'?'Run':'Ride'};}
  if(this.surfActive)this.d.avatar.externalPose={position:[foot.x,foot.y+.08+Math.sin(-this.surfTime*2)*.18,foot.z],heading:this.d.avatar.heading,clip:'Idle'};
  this.ui();return out;
 }
 afterMovement(dt:number,external:MotionMode){this.timer.update(dt,this.swim.water?this.swim.position.toArray():this.d.physics.position.toArray(),this.ownsMotion?this.mode:external);}
 afterAvatar(){const l=this.d.avatar.palm('L'),r=this.d.avatar.palm('R'),p=this.paddleGroup.children[0];if(l&&r&&p&&this.craft.route)attachPaddle(p,l,r,this.paddleGroup,this.craft.route.craft);}
 private ui(){
  const c=this.policy.conditions,water=this.d.data.sea,near=this.d.data.bus?.stops.filter(s=>distance(s.sign,this.d.physics.position.toArray())<12)??[];
  const lines:string[]=[];if(water?.viewingPoint&&distance(water.viewingPoint,this.d.physics.position.toArray())<25)lines.push('帆船賽（情境重現）・金色旗：中山隊・藍色旗：日本隊');if(water)lines.push(`今日遊戲浪高 ${c.waveHeightM.toFixed(1)} m${c.qaOverride?'（QA）':''}・${evaluateSea('swim',c).allowed?'游泳開放':'游泳關閉'}`);
  for(const stop of near)for(const b of this.fleet?.buses??[]){const eta=Math.min(...b.route.stopOccurrences.filter(o=>o.stopId===stop.id).map(o=>b.eta(o.occurrenceId)));if(Number.isFinite(eta))lines.push(`${stop.name}・${b.route.id==='campus-bus'?'校園公車':'橘1延'} 約 ${Math.ceil(eta)} 秒（可能延誤）`);}
  if(this.swim.water)lines.push(this.swim.phase==='rescue'?(this.swim.waitingForReturn?'救援已啟動，等待岸上安全落點；可由選單回到起點':'救生員召回中'):`體力 ${Math.round(this.swim.stamina*100)}%`);
  if(this.craft.route)lines.push('方向鍵／WASD 划行・回到下水點附近按 E 歸還（15 m 內）');
  if(this.busPassenger.notice)lines.push(this.busPassenger.notice);
  for(const b of this.fleet?.buses??[])if(b.notice&&b.position.distanceTo(this.d.physics.position)<20)lines.push(b.notice);
  if(this.timer.course)lines.push(`計時 ${this.timer.elapsed.toFixed(1)} 秒・gate ${this.timer.next}/${this.timer.course.requiredGateSequence.length}`);
  else if(this.timer.result)lines.push(this.timer.result.valid?`完成 ${this.timer.result.seconds.toFixed(1)} 秒`:`成績作廢：${this.timer.result.reason}`);
  if(this.fitness.portal)lines.push('體適能中心・示意室內'+(this.fitness.equipment?'・E 停止運動':''));
  const text=lines.map(line=>line.trim()).filter(Boolean).join('\n');if(this.status.dataset.text!==text){this.status.dataset.text=text;this.status.textContent=text;}
  if(this.swim.water){let meter=this.status.querySelector('meter');if(!meter){meter=document.createElement('meter');meter.min=0;meter.max=1;meter.setAttribute('aria-label','游泳體力');this.status.append(meter);}meter.value=this.swim.stamina;}
  this.status.hidden=!text;
  const b=this.busPassenger.bus;this.panel.hidden=!b;if(b){const key=b.id+':'+this.busPassenger.selected;if(key!==this.lastPanel){this.lastPanel=key;this.panel.innerHTML=`<strong>選擇下車站</strong><div>${b.route.stopOccurrences.map((o,i)=>`<button type="button" data-bus-stop="${safe(o.occurrenceId)}" aria-pressed="${this.busPassenger.selected===o.occurrenceId}">${i<9?i+1+' · ':''}${safe(b.stops.find(s=>s.id===o.stopId)?.name??o.stopId)}（${i+1}）</button>`).join('')}</div>`;}}
 }
 busObstacles():Obstacle[]{return (this.fleet?.buses??[]).filter(b=>b.active).map(b=>({id:`bus:${b.id}`,shape:'box',center:[b.position.x,b.position.y+b.route.vehicle.heightM/2,b.position.z],half:[b.route.vehicle.widthM/2,b.route.vehicle.heightM/2,b.route.vehicle.lengthM/2],yaw:b.yaw,navigation:false}));}
 reset(){this.swim.clear();this.craft.clear();this.busPassenger.clear();this.fitness.clear();this.timer.invalidate('重設位置');this.endSurf();this.craftGroup.clear();this.paddleGroup.clear();this.d.avatar.externalPose=undefined;this.panel.hidden=true;this.d.modeChanged();}
 dispose(){this.alive=false;document.removeEventListener('visibilitychange',this.visibility);this.fleet?.dispose();disposeObject(this.group);this.sailing?.dispose();this.group.removeFromParent();this.panel.remove();this.status.remove();for(const asset of this.assets.values())disposeObject(asset);this.assets.clear();}
}
