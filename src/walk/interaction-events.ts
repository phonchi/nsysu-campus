/** Runtime adapter for campus-event invitations/actions. Engine data and saves stay in story/campus-events. */
import type { Vector3 } from 'three';
import type { RhythmSpec } from '../audio/rhythm';
import type { GuideOverride } from '../story/director';
import type { CampusEventCommand, CampusEventDefinition, CampusEventWorld, CampusEventEngine, ActivityRequest, ActiveActivity, ActivityStep } from '../story/campus-events';

/** Temporary structural v10.1 contracts (§11.2), until the coordinator merges WP-B types. */
export type EventPoseRequest={kind:'pose';pose:'sit'|'stand';at?:string};
export type RuntimeEventRequest=Exclude<ActivityRequest,{kind:'say'}>|EventPoseRequest|{kind:'say';who:string;text:string;if?:{quest:string;step:string;choice:string}};
export type RhythmCommand={kind:'rhythm'}&RhythmSpec;
export type RuntimeEventCommand=Exclude<CampusEventCommand,{kind:'request'}>|{kind:'request';request:RuntimeEventRequest}|RhythmCommand|{kind:'achievement';id:string};
export interface RuntimeEventWorld extends CampusEventWorld {playerMoving?():boolean;questChoice?(quest:string,step:string):string|undefined}
export type RuntimeActivityStep=ActivityStep|({kind:'stay';target:string;max:number;hold:number;still?:boolean;sit?:boolean;text:string;then?:RuntimeEventRequest[]})|({kind:'rhythm';text:string;then?:RuntimeEventRequest[]}&RhythmSpec);
export type RuntimeActivity=Omit<ActiveActivity,'definition'>&{definition:Omit<ActiveActivity['definition'],'steps'>&{steps:RuntimeActivityStep[]};stepProgress?:{held:number;hold:number}};
export function activityPresentation(engine:Pick<CampusEventEngine,'activity'>){return engine.activity as RuntimeActivity|undefined;}
/** Activity guidance temporarily takes precedence over the tracked quest, without changing its save. */
export function campusActivityGuide(activity:ActiveActivity|undefined,point:(target:string)=>Vector3|undefined,seatReach?:(target:string)=>number|undefined): (GuideOverride & {max:number}) | undefined {
  const step=activity?.definition.steps[activity.step];
  if(activity?.phase!=='active' || !step || (step.kind!=='stay' && step.kind!=='near'))return undefined;
  return {target:step.target,point:point(step.target),title:activity.definition.journal.title,text:step.text,max:seatReach?.(step.target)??step.max};
}
export function submitRhythmResult(engine:unknown,id:string,hits:number):RuntimeEventCommand[]|false {
  return (engine as {act(id:string,result:{hits:number}):RuntimeEventCommand[]|false}).act(id,{hits});
}
export const staySecondsRemaining=(progress:{held:number;hold:number})=>Math.ceil(Math.max(0,progress.hold-progress.held));
/** Both avatar and camera look along local -Z. Missing/coincident hosts leave the view untouched. */
export function eventSeatHeading(player:Pick<Vector3,'x'|'z'>,host?:Pick<Vector3,'x'|'z'>):number|undefined {
  if(!host)return undefined;
  const dx=host.x-player.x,dz=host.z-player.z;
  return Number.isFinite(dx)&&Number.isFinite(dz)&&Math.hypot(dx,dz)>1e-4?Math.atan2(-dx,-dz):undefined;
}
/** E is owned by rhythm even on an offbeat or while paused; no fall-through to an interaction. */
export function routeEventE(rhythmActive:boolean,clap:()=>void,interact:()=>void){if(rhythmActive)clap();else interact();}
/** Paired visual pose, independent of physics. Moving stands up; resting at the requested seat sits again. */
export class EventPlayerPose {
  target?:string;
  requested=false;
  sitting=false;
  constructor(private apply:(sitting:boolean)=>void){}
  request(pose:'sit'|'stand',at?:string){this.requested=pose==='sit';this.target=this.requested?at:undefined;if(!this.requested)this.set(false);}
  update(moving:boolean,nearSeat:boolean){this.set(this.requested&&!moving&&nearSeat);}
  private set(value:boolean){if(value!==this.sitting){this.sitting=value;this.apply(value);}}
}

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
  pose?(pose:'sit'|'stand',at?:string):void;
  rhythm?(command:RhythmCommand):void;
  stopRhythm?():void;
  achievement?(id:string):void;
  questChoice?(quest:string,step:string):string|undefined;
}
/** Movement is a barrier: subsequent feedback/release waits until the actual walk arrives.
 * No DOM, timers or engine mutations here, so command ordering can be checked with fixtures. */
export class EventCommandQueue {
  private pending:RuntimeEventCommand[]=[];
  constructor(private ports:EventPorts) {}
  get busy() { return this.pending.length>0 || this.ports.moving(); }
  clear() { this.pending=[];this.ports.pose?.('stand');this.ports.stopRhythm?.(); }
  push(commands:RuntimeEventCommand[] | false) { if(commands)this.pending.push(...commands); }
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
        case 'achievement':p.achievement?.(c.id);break;
        case 'rhythm':p.rhythm?.(c);break;
        case 'request': {
          const r=c.request;
          if(r.kind==='say'){if(!r.if || p.questChoice?.(r.if.quest,r.if.step)===r.if.choice)p.say(r.who,r.text);}
          else if(r.kind==='pose')p.pose?.(r.pose,r.at);
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
export function campusEventWorld(base:RuntimeEventWorld,definitions:readonly CampusEventDefinition[],available:(id:string)=>boolean):RuntimeEventWorld {
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
