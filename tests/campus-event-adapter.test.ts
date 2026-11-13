import { describe, expect, it, vi } from 'vitest';
import { CampusEventEngine, type CampusEventCommand, type CampusEventDefinition } from '../src/story/campus-events';
import { EventCommandQueue, EventCompletionStorage, campusEventAction, campusEventWorld, campusEventsPaused, type EventPauseState, type EventPorts } from '../src/walk/interaction-events';
import npcData from '../public/data/npcs.json';
const definitions=npcData.events as CampusEventDefinition[];
const macaque=definitions.find(e=>e.activity)!;
function fixture() {
 const log:string[]=[];let moving=false;
 const ports:EventPorts={banner:(text,title)=>log.push(`banner:${title}:${text}`),sound:id=>log.push(`sound:${id}`),journal:e=>log.push(`journal:${e.id}`),
 move:(id,to)=>{log.push(`move:${id}:${to}`);moving=true;return true;},moving:()=>moving,release:id=>log.push(`release:${id}`),say:(id,text)=>log.push(`say:${id}:${text}`),
 invite:c=>log.push(`invite:${c.activity}`),objective:text=>log.push(`objective:${text??''}`),counter:id=>log.push(`counter:${id}`),reward:id=>log.push(`reward:${id}`),moveFailed:(id,to)=>log.push(`failed:${id}:${to}`)};
 return {ports,log,arrive:()=>{moving=false;}};
}
const base={timeOfDay:()=> 'day',distanceTo:()=>1,hasItem:()=>true,npcPresent:()=>true};
const memory=()=>{const data=new Map<string,string>();return {data,getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>{data.set(k,v);},removeItem:(k:string)=>{data.delete(k);}};};
it('adapts every command in order; return movement completes before speech, journal, count, reward and release',()=>{
 const f=fixture(),queue=new EventCommandQueue(f.ports);
 const commands:CampusEventCommand[]=[{kind:'banner',text:'哨聲',title:'校園事件',sound:'chime'},
 {kind:'invite',activity:'a',host:'h',text:'請讓路',accept:'好',decline:'先走'}, {kind:'objective',text:'退開'},
 {kind:'request',request:{kind:'move',npc:'m',to:'zone:slope'}},{kind:'request',request:{kind:'say',who:'h',text:'謝謝'}},
 {kind:'journal',entry:{id:'done',kind:'event',title:'共處',text:'完成',zone:'slope',npc:'h'}},
 {kind:'counter',id:'whistle'},{kind:'reward',id:'紀念'},{kind:'request',request:{kind:'release',npc:'m'}},{kind:'objective'}];
 queue.push(commands);queue.flush(true);expect(f.log).toEqual([]);
 queue.flush();expect(f.log).toEqual(['banner:校園事件:哨聲','sound:chime','invite:a','objective:退開','move:m:zone:slope']);
 queue.flush();expect(f.log).toHaveLength(5);expect(queue.busy).toBe(true);
 f.arrive();queue.flush();expect(f.log.slice(5)).toEqual(['say:h:謝謝','journal:done','counter:whistle','reward:紀念','release:m','objective:']);expect(queue.busy).toBe(false);
});
it('a rejected route never emits later success feedback or reward',()=>{
 const f=fixture();f.ports.move=()=>false;const queue=new EventCommandQueue(f.ports);
 queue.push([{kind:'request',request:{kind:'move',npc:'m',to:'zone:blocked'}},{kind:'reward',id:'incorrect'}]);queue.flush();
 expect(f.log).toEqual(['failed:m:zone:blocked']);expect(queue.busy).toBe(false);
});
it('each blocking mode pauses the event; ordinary walking does not',()=>{
 const state:EventPauseState={walking:true,overview:false,dialogue:false,menu:false,notebook:false,photo:false,game:false,blocking:false,encounter:false,guide:false};
 expect(campusEventsPaused(state)).toBe(false);
 for(const key of Object.keys(state) as (keyof EventPauseState)[])expect(campusEventsPaused({...state,[key]:key==='walking'?false:true}),key).toBe(true);
});
it('a reserved macaque suppresses the event without consuming its offer; action rechecks item, range, pause and step',()=>{
 const engine=new CampusEventEngine([macaque],{storage:memory()}),available=vi.fn((id:string)=>id!=='m3-thief');
 const blocked=campusEventWorld(base,[macaque],available);
 expect(engine.update(1,blocked)).toEqual([]);expect(engine.activity).toBeUndefined();
 const world=campusEventWorld(base,[macaque],()=>true);
 engine.update(1,world);engine.update(6,world);engine.respond(true);
 const action=campusEventAction(engine,world,false)!;
 expect(action).toMatchObject({actionId:'stash',label:'把點心收進包包'});
 expect(campusEventAction(engine,world,true)).toBeUndefined();
 expect(campusEventAction(engine,{...world,hasItem:()=>false},false)).toBeUndefined();
 expect(campusEventAction(engine,{...world,distanceTo:()=>50},false)).toBeUndefined();
 engine.act(action.actionId);expect(campusEventAction(engine,world,false)).toBeUndefined();
});
it('actual data runs invitation → stash → keep away → return → reward, and saves only after the return arrives',()=>{
 const storage=memory(),deferred=new EventCompletionStorage(storage),engine=new CampusEventEngine([macaque],{storage:deferred,now:()=>1});
 const f=fixture(),queue=new EventCommandQueue(f.ports);
 queue.push(engine.update(1,base));queue.flush();expect(queue.busy).toBe(true);
 f.arrive();queue.flush();queue.push(engine.update(6,base));queue.flush();expect(engine.activity?.phase).toBe('invited');
 queue.push(engine.respond(true));queue.flush();queue.push(engine.act('stash'));queue.flush();
 queue.push(engine.update(3,{...base,distanceTo:()=>6}));queue.flush();
 expect(f.log.some(l=>l.startsWith('reward:'))).toBe(false);expect(storage.data.size).toBe(0);
 expect(new CampusEventEngine([macaque],{storage}).progress.completed).toEqual({});
 f.arrive();queue.flush();deferred.commit();
 expect(f.log).toContain('counter:whistle');expect(f.log).toContain(`reward:${macaque.activity!.reward}`);
 expect(new CampusEventEngine([macaque],{storage}).progress.completed).toEqual({'macaque-coexist':1});
});
it('discarding staged completion keeps existing durable progress intact',()=>{
 const storage=memory();storage.setItem('progress','old');const deferred=new EventCompletionStorage(storage);
 deferred.setItem('progress','new');expect(deferred.getItem('progress')).toBe('new');deferred.discard();expect(storage.getItem('progress')).toBe('old');
});
