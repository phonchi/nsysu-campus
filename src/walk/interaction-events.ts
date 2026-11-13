/** Runtime adapter for campus-event invitations/actions. Engine data and saves stay in story/campus-events. */
import type { Vector3 } from 'three';
import type { CampusEventCommand, CampusEventDefinition, CampusEventWorld, CampusEventEngine } from '../story/campus-events';

export interface EventPorts {
  banner(text:string,title:string):void;
  sound(id:string):void;
  journal(entry:Extract<CampusEventCommand,{kind:'journal'}>['entry']):void;
  move(npc:string,target:string):boolean;
  moving():boolean;
  release(npc:string):void;
  say(npc:string,text:string):void;
  invite(command:Extract<CampusEventCommand,{kind:'invite'}>):void;
  objective(text?:string):void;
  counter(id:string):void;
  reward(id:string):void;
  moveFailed(npc:string,target:string):void;
}
/** Movement is a barrier: subsequent feedback/release waits until the actual walk arrives.
 * No DOM, timers or engine mutations here, so command ordering can be checked with fixtures. */
export class EventCommandQueue {
  private pending:CampusEventCommand[]=[];
  constructor(private ports:EventPorts) {}
  get busy() { return this.pending.length>0 || this.ports.moving(); }
  clear() { this.pending=[]; }
  push(commands:CampusEventCommand[] | false) { if(commands)this.pending.push(...commands); }
  flush(paused=false) {
    if(paused || this.ports.moving())return;
    while(this.pending.length) {
      const c=this.pending.shift()!,p=this.ports;
      switch(c.kind) {
        case 'banner':p.banner(c.text,c.title);if(c.sound)p.sound(c.sound);break;
        case 'journal':p.journal(c.entry);break;
        case 'invite':p.invite(c);break;
        case 'objective':p.objective(c.text);break;
        case 'counter':p.counter(c.id);break;
        case 'reward':p.reward(c.id);break;
        case 'request': {
          const r=c.request;
          if(r.kind==='say')p.say(r.who,r.text);
          else if(r.kind==='release')p.release(r.npc);
          else {
            if(!p.move(r.npc,r.to)){this.clear();p.moveFailed(r.npc,r.to);return;}
            if(p.moving())return;
          }
          break;
        }
      }
    }
  }
}
export interface EventPauseState { walking:boolean; overview:boolean; dialogue:boolean; menu:boolean; notebook:boolean; photo:boolean; game:boolean; blocking:boolean; encounter:boolean; guide:boolean }
export const campusEventsPaused=(s:EventPauseState)=>!s.walking||s.overview||s.dialogue||s.menu||s.notebook||s.photo||s.game||s.blocking||s.encounter||s.guide;
/** Suppress the event before it fires if a required actor is absent or owned by the story/game.
 * A failed availability check does not consume the engine's shown/cooldown state. */
export function campusEventWorld(base:CampusEventWorld,definitions:readonly CampusEventDefinition[],available:(id:string)=>boolean):CampusEventWorld {
  return {...base,distanceTo:target=>{
    const unavailable=definitions.some(e=>e.when===base.timeOfDay() && e.anchor===target && e.activity &&
      (!available(e.activity.host) || e.activity.prepare?.some(r=>r.kind==='move'&&!available(r.npc))));
    return unavailable?Infinity:base.distanceTo(target);
  }};
}
export function campusEventAction(engine:CampusEventEngine,world:CampusEventWorld,paused:boolean) {
  const a=engine.activity,action=engine.pendingAction();
  if(paused || !a || !action || (action.needs && !world.hasItem?.(action.needs)) || world.distanceTo(a.event.anchor)>(a.event.radius??25))return undefined;
  return {id:`event:${a.instance}:${action.id}`,targetId:`activity:${a.instance}`,actionId:action.id,label:action.text};
}

/** The engine finishes logically before its final movement command has arrived. Stage its
 * save-guard writes until the command queue drains, so a reload mid-return cannot award completion. */
export class EventCompletionStorage {
  private pending=new Map<string,string>();
  constructor(private storage:Pick<Storage,'getItem'|'setItem'|'removeItem'>) {}
  getItem(key:string) { return this.pending.get(key)??this.storage.getItem(key); }
  setItem(key:string,value:string) { this.pending.set(key,value); }
  removeItem(key:string) { this.pending.delete(key);this.storage.removeItem(key); }
  discard() { this.pending.clear(); }
  commit() { for(const [key,value] of this.pending)this.storage.setItem(key,value);this.pending.clear(); }
}

/** Navigation may project its first point onto the mesh. Connect that point to the
 * live footpoint with a checked segment; never relocate the actor to the projected start. */
export function connectNpcPathStart(position:Vector3,path:readonly Vector3[],clear:(a:Vector3,b:Vector3)=>boolean):Vector3[] {
  if(path.length<2 || !position.toArray().every(Number.isFinite) || path.some(p=>!p.toArray().every(Number.isFinite)))return [];
  const start=position.clone(),gap=start.distanceTo(path[0]);
  if(gap>.75 || (gap>1e-8 && !clear(start,path[0])))return [];
  return gap>1e-8 ? [start,...path.map(p=>p.clone())] : [start,...path.slice(1).map(p=>p.clone())];
}
