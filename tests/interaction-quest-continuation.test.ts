import { expect,it } from 'vitest';
import { continueQuestAtTarget,npcPresentAt } from '../src/walk/interaction';
import { QuestEngine,type QuestData } from '../src/story/quests';
import data from '../public/data/quests.json';
import npcs from '../public/data/npcs.json';
import type { NpcData } from '../src/story/talk';
const world={distanceTo:()=>0,timeOfDay:()=> 'day',chapterDone:()=>true};
for(const [id,from,to,target] of [['admin-list','errand-3','return','npc:s3'],['sea-stage','errand-2','return','npc:jogger-po']])it(`${id}: continues ${from} → ${to} without a second interaction`,()=>{
 const quest=(data as QuestData).quests.find(q=>q.id===id)!;
 const storage={getItem:()=>null,setItem:()=>{},removeItem:()=>{}};
 const engine=new QuestEngine({version:1,quests:[quest]},{storage});
 const w={...world,timeOfDay:()=>quest.steps.find(s=>s.when)?.when??'day'};
 expect(engine.accept(id,w)).toBe(true);
 while(engine.list()[0].step?.id!==from)expect(engine.interact(id,w)).toBe(true);
 const previous=engine.list()[0].step!;expect(previous.target).toBe(target);expect(engine.interact(id,w)).toBe(true);
 const next=engine.list()[0].step!;expect(next.id).toBe(to);expect(continueQuestAtTarget(previous,next,w)).toBe(true);
 expect(continueQuestAtTarget(previous,next,{...w,distanceTo:()=>100})).toBe(false);
 expect(continueQuestAtTarget(previous,{...next,when:'night'},{...w,timeOfDay:()=> 'day'})).toBe(false);
 expect(continueQuestAtTarget(previous,{...next,target:'npc:other'},w)).toBe(false);
 expect(continueQuestAtTarget(previous,{...next,kind:'photo'},w)).toBe(false);
 expect(continueQuestAtTarget(previous,previous,w)).toBe(false);
});
it('npcPresentAt uses the authored schedule, handles absent/unknown NPCs and invalid times',()=>{
 const definitions=(npcs as unknown as NpcData).npcs;
 expect(npcPresentAt(definitions,'m3-thief','day')).toBe(true);
 expect(npcPresentAt(definitions,'m3-thief','night')).toBe(false);
 expect(npcPresentAt(definitions,'missing','day')).toBe(false);
 expect(npcPresentAt(definitions,'m3-thief','invalid')).toBe(false);
 for(const n of definitions)for(const time of ['day','sunset','night'] as const)expect(npcPresentAt(definitions,n.id,time)).toBe(n.schedule[time]!=null);
});
it('acceptableTimes/missingNpcs share the same runtime schedule contract',()=>{
 const definitions=(npcs as unknown as NpcData).npcs;
 const engine=new QuestEngine(data as QuestData,{storage:{getItem:()=>null,setItem:()=>{},removeItem:()=>{}}});
 const q=engine.data.quests.find(q=>q.id==='sea-stage')!;
 const w={...world,npcPresent:(id:string)=>npcPresentAt(definitions,id,'night'),npcPresentAt:(id:string,time:string)=>npcPresentAt(definitions,id,time)};
 expect(engine.acceptableTimes(q,w)).toContain('sunset');
 expect(engine.missingNpcs(q,w).length).toBeGreaterThan(0);
});
