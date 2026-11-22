import {afterEach,expect,it,vi} from 'vitest';
import * as T from 'three';
import {V12Runtime} from '../src/walk/v12-runtime';
import {Avatar} from '../src/walk/avatar';
import {CampusEventEngine,validateEvents,type CampusEventDefinition} from '../src/story/campus-events';
import {RhythmRound} from '../src/audio/rhythm';
import type {RapierController} from '../src/walk/controller';
import {TimedSports} from '../src/walk/sports-activity';
import type {TimedCourse} from '../src/world/v12-types';
afterEach(()=>vi.unstubAllGlobals());
it('empty optional data leaves walking, input and scene startup intact',async()=>{
 const element=()=>Object.assign(new EventTarget(),{className:'',hidden:false,dataset:{},textContent:'',setAttribute(){},append(){},remove(){},querySelector(){return null;}});
 const doc=Object.assign(new EventTarget(),{createElement:element});vi.stubGlobal('document',doc);
 const avatar=new Avatar(),physics={position:new T.Vector3(),canStand:()=>true} as unknown as RapierController,scene=new T.Scene(),changed=vi.fn();
 const runtime=new V12Runtime({host:element() as unknown as HTMLElement,scene,data:{issues:[]},physics,avatar,asset:x=>x,say:()=>{},cue:()=>{},modeChanged:changed,params:new URLSearchParams()});await runtime.load();
 expect(runtime.update(.1,new T.Vector3(1,0,0),[],'day',{kind:'walk'})).toBeUndefined();expect(runtime.ownsMotion).toBe(false);expect(runtime.locked).toBe(false);expect(runtime.actions(physics.position)).toEqual([]);expect(runtime.key('w')).toBe(false);expect(changed).not.toHaveBeenCalled();runtime.dispose();expect(scene.children).toHaveLength(0);avatar.dispose();
});
it('surf presentation survives campus-event dispatch and uses the unchanged rhythm judge',()=>{
 const event:CampusEventDefinition={id:'surf',when:'day',anchor:'npc:coach',npcs:['coach'],banner:'衝浪課',activity:{id:'surf',host:'coach',invite:'來練習',accept:'好',decline:'稍後',inviteDelay:0,steps:[{kind:'rhythm',id:'balance',text:'踏穩浪板',presentation:'surf',cues:2,interval:1,lead:1,window:.2,need:2}],journal:{title:'衝浪課',done:'完成',abandoned:'離開',partial:'命中 {hits}'}}};
 expect(validateEvents([event])).toEqual([]);const engine=new CampusEventEngine([event],{storage:{getItem:()=>null,setItem:()=>{},removeItem:()=>{}},now:()=>1});const world={timeOfDay:()=> 'day',distanceTo:()=>0};engine.update(1,world);engine.update(1,world);const commands=engine.respond(true)||[];expect(commands.some(c=>c.kind==='rhythm'&&c.presentation==='surf')).toBe(true);
 let time=0;const round=new RhythmRound({id:'balance',presentation:'surf',cues:2,interval:1,lead:1,window:.2,need:2},()=>time);time=1;round.clap();time=2;round.clap();time=3;expect(round.sample().hits).toBe(2);expect(engine.act('balance',{hits:2})).toBeTruthy();
});
it('pool timing accepts distinct outward and return gates at the same position',()=>{
 const c:TimedCourse={id:'pool',mode:'swim',waterId:'pool',corridor:[[-1,-2],[12,-2],[12,2],[-1,2]],gates:[{id:'out',a:[1,0,-1],b:[1,0,1],direction:[1,0]},{id:'turn',a:[10,0,-1],b:[10,0,1],direction:[1,0]},{id:'back',a:[1,0,-1],b:[1,0,1],direction:[-1,0]}],requiredGateSequence:['out','turn','back']};
 const timer=new TimedSports();timer.start(c,[0,0,0]);for(let x=.5;x<=11;x+=.5)timer.update(.5,[x,0,0],{kind:'swim',waterId:'pool'});for(let x=10.5;x>=0;x-=.5)timer.update(.5,[x,0,0],{kind:'swim',waterId:'pool'});expect(timer.result?.valid).toBe(true);
});
