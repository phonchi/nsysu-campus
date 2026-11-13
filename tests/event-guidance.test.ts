import {expect,it} from 'vitest';
import {Vector3} from 'three';
import {CampusEventEngine,type CampusEventDefinition} from '../src/story/campus-events';
import {campusActivityGuide} from '../src/walk/interaction-events';
import {StoryUi} from '../src/story/ui';
import npcData from '../public/data/npcs.json';
import zones from '../public/data/story-zones.json';

const point=(target:string)=>{
  const zone=zones.zones[target.slice(5) as keyof typeof zones.zones];
  return zone?new Vector3(zone.p[0],0,zone.p[1]):undefined;
};
for(const [id,target,hold] of [['ev-sunset-crowd','zone:seawall-seat',60],['ev-night-song','zone:arcade-seat',2]] as const)it(`${id} guides to the shipped seat only during its stay step`,()=>{
  const definition=npcData.events.find(e=>e.id===id)! as CampusEventDefinition;
  const engine=new CampusEventEngine([definition],{storage:{getItem:()=>null,setItem:()=>{},removeItem:()=>{}}});
  let distance=10;const world={timeOfDay:()=>definition.when,distanceTo:(t:string)=>t===target?distance:0,playerMoving:()=>false,npcPresent:()=>true};
  engine.update(.1,world);expect(campusActivityGuide(engine.activity,point)).toBeUndefined();
  engine.update(3,world);engine.respond(true);
  const seat=definition.activity!.steps.find(s=>s.kind==='stay')!;
  expect(campusActivityGuide(engine.activity,point)).toMatchObject({target,point:point(target),max:seat.kind==='stay'?seat.max:NaN}); // the shipped data owns max
  engine.update(1,world);expect(campusActivityGuide(engine.activity,point)?.target).toBe(target);
  distance=0;engine.update(hold,world);
  expect(campusActivityGuide(engine.activity,point)).toBeUndefined(); // finish or enter rhythm; caller restores trackedGuide
});
it('near steps use their own target, and cancellation releases the override',()=>{
  const original=npcData.events.find(e=>e.id==='ev-night-song')! as CampusEventDefinition;
  const definition={...original,activity:{...original.activity!,inviteDelay:0,steps:[{kind:'near' as const,target:'zone:arcade-seat',max:2,text:'走到座位'}]}};
  const engine=new CampusEventEngine([definition],{storage:{getItem:()=>null,setItem:()=>{},removeItem:()=>{}}});
  engine.update(.1,{timeOfDay:()=>definition.when,distanceTo:()=>0,npcPresent:()=>true});engine.respond(true);
  expect(campusActivityGuide(engine.activity,point)?.target).toBe('zone:arcade-seat');
  engine.leave();expect(campusActivityGuide(engine.activity,point)).toBeUndefined();
});
it('the activity card exposes walking, stopping and arrived states and removes guidance after the step',()=>{
  const button={hidden:true,disabled:false,textContent:''};
  const ui={eventObjectiveEl:{querySelector:()=>button}} as unknown as StoryUi;
  const go=()=>{};
  StoryUi.prototype.eventGuidance.call(ui,go);expect(button).toEqual({hidden:false,disabled:false,textContent:'G 自動前往'});
  StoryUi.prototype.eventGuidance.call(ui,go,true);expect(button.textContent).toBe('停止帶路');
  StoryUi.prototype.eventGuidance.call(ui,go,false,true);expect(button.disabled).toBe(true);expect(button.textContent).toBe('已抵達');
  StoryUi.prototype.eventGuidance.call(ui);expect(button.hidden).toBe(true);
});
