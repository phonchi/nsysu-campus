import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { resolveNpcPlacement, STORY_NPCS, type StoryZones } from '../src/world/npc';
import type { NpcDef } from '../src/story/talk';

const zones = JSON.parse(fs.readFileSync('public/data/story-zones.json', 'utf8')) as StoryZones;
const def = (id: string, night: NpcDef['schedule']['night']): NpcDef => ({ id, name: id, role: '', model: 'npc-student-1', portrait: {},
  schedule: { day: { at: 'admin' }, sunset: { at: 'seawall', activity: 'Sit' }, night }, talk: id });

describe('NPC placement ownership (spec-v4 §15.1)', () => {
  it('the story owns story NPCs in every preset until the tour is done', () => {
    for (const id of STORY_NPCS) for (const preset of ['day', 'sunset', 'night'] as const) {
      const p = resolveNpcPlacement(id, def(id, null), preset, false, zones, { guide: 'library' });
      expect(p, `${id} ${preset}`).not.toBeNull();
      expect(p!.at).toBe(id === 'guide' ? 'library' : zones.npcs[id].at);
    }
  });
  it('after the tour, story NPCs follow their schedule', () => {
    expect(resolveNpcPlacement('s2', def('s2', { at: 'admin' }), 'sunset', true, zones, {})!.at).toBe('seawall');
  });
  it('other NPCs follow their schedule and may be absent', () => {
    expect(resolveNpcPlacement('coffee', def('coffee', null), 'night', false, zones, {})).toBeNull();
    expect(resolveNpcPlacement('coffee', def('coffee', null), 'sunset', false, zones, {})).toEqual({ at: 'seawall', activity: 'Sit' });
  });
});

import { Group, Vector3 } from 'three';
import { NpcManager } from '../src/world/npc';
import type { Facts } from '../src/story/dialogue';
import type { NpcData, ScheduleOverride } from '../src/story/talk';
const facts = (flag: (id: string) => boolean): Facts => ({flag,hasItem:()=>false,stamps:()=>0,chapterDone:()=>false,timeOfDay:()=> 'day',count:()=>0});
it('quest schedule overrides use Cond, only in their preset, below main-story ownership',()=>{
 const override:ScheduleOverride={npc:'s2',preset:'day',if:{all:[{flag:'quest.q.return.a'},{notFlag:'quest.q.return.b'}]},at:'admin',offset:[10,2],activity:'Sit'};
 const f=facts(id=>id==='quest.q.return.a');
 expect(resolveNpcPlacement('s2',def('s2',null),'day',true,zones,{},[override],f)).toEqual({at:'admin',offset:[10,2],activity:'Sit'});
 expect(resolveNpcPlacement('s2',def('s2',null),'day',false,zones,{s2:'library'},[override],f)?.at).toBe('library');
 expect(resolveNpcPlacement('s2',def('s2',null),'sunset',true,zones,{},[override],f)?.at).toBe('seawall');
 expect(resolveNpcPlacement('s2',def('s2',null),'day',true,zones,{},[override],facts(()=>false))).toEqual({at:'admin'});
});
it('defers a quest placement until talking ends and re-evaluates after event/game release or clear',()=>{
 const z:StoryZones={zones:{admin:{label:'admin',p:[0,0],r:4}},npcs:{}};
 const override:ScheduleOverride={npc:'mia',preset:'day',if:{flag:'quest.q.done'},at:'admin',offset:[10,0],activity:'Sit'};
 const manager=new NpcManager(z,undefined,undefined,x=>x,{version:1,npcs:[def('mia',null)],trees:{},scheduleOverrides:[override]});
 const root=new Group(), actor={id:'mia',root,position:root.position,path:[] as Vector3[],absent:false,talking:false,speed:1,activity:'Idle'};
 (manager as unknown as {npcs:Map<string,typeof actor>}).npcs.set('mia',actor);
 let done=false;const f=facts(()=>done);
 manager.schedule('day',true,{},undefined,f);manager.setTalking('mia');
 done=true;manager.schedule('day',true,{},undefined,f);
 expect(actor.position.x).toBe(0);expect(actor.activity).toBe('Idle');
 manager.setTalking(undefined);expect(actor.position.x).toBe(10);expect(actor.activity).toBe('Sit');
 manager.reserveForGame('mia',true);done=false;manager.schedule('day',true,{},undefined,f);expect(actor.position.x).toBe(10);
 manager.reserveForGame('mia',false);manager.schedule('day',true,{},undefined,f);expect(actor.position.x).toBe(0);
 expect(manager.borrowPath('mia',[actor.position.clone(),new Vector3(3,0,0)])).toBe(true);
 done=true;manager.schedule('day',true,{},undefined,f);expect(actor.position.x).toBe(0);
 manager.releaseAllBorrowed();manager.schedule('day',true,{},undefined,f);expect(actor.position.x).toBe(10);
 done=false;manager.schedule('day',true,{},undefined,f);expect(actor.position.x).toBe(0);
});
