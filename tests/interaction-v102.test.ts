import { expect, it, vi } from 'vitest';
import { nearbyQuestOffers, questAvailability, questOfferLabel, questWaitReason, nextQuestRecommendation, syncQuestWorks, type QuestPresentationEngine, type QuestAvailability, type QuestWork } from '../src/walk/interaction-quests';
import { npcQuestStatuses } from '../src/walk/interaction-status';
import type { QuestDefinition, QuestView, QuestWorld } from '../src/story/quests';
const q = (id: string, npc = 'host'): QuestDefinition => ({id,title:id,zone:'library',npc,description:'',reward:'卡',accept:{near:`npc:${npc}`},steps:[{id:'one',target:'npc:other',text:''},{id:'return',target:`npc:${npc}`,text:''}]});
const world: QuestWorld = {distanceTo:()=>3,timeOfDay:()=> 'night',npcPresent:()=>true};
function fixture(views: QuestView[], status: Record<string, QuestAvailability>): QuestPresentationEngine {
 return {list:()=>views,unlocked:()=>true,acceptable:()=>{throw Error('new engine consumers must use availability');},availability:q=>status[q.id]};
}
it('one availability result drives gray offers, badge and objective reason; available and deliverable badges win',()=>{
 const a={state:'wrong-time',times:['sunset'],reason:'可接：夕陽，按 N'} as QuestAvailability;
 const first=q('a'),second=q('b');
 const views:QuestView[]=[{definition:first},{definition:second}];
 const status:Record<string,QuestAvailability>={a,b:{...a,state:'npc-away'}};
 const engine=fixture(views,status);
 expect(questAvailability(engine,first,world)).toBe(a);
 expect(questOfferLabel(first.title,a)).toBe('接取・a（可接：夕陽，按 N）');
 expect(questWaitReason(engine,first,world)).toBe(a.reason);
 expect(npcQuestStatuses(engine,world).get('host')).toBe('waiting');
 status.b={...a,state:'available',reason:''};expect(npcQuestStatuses(engine,world).get('host')).toBe('acceptable');
 views[1].step={id:'return',target:'npc:host',text:''};status.b={...a,state:'active',reason:''};
 expect(npcQuestStatuses(engine,world).get('host')).toBe('deliverable');
 expect(npcQuestStatuses(engine,{...world,npcPresent:()=>false}).size).toBe(0);
});
it('active step wait reasons do not impose the acceptance time window',()=>{
 const quest=q('a'),view={definition:quest,step:{id:'return',target:'npc:host',text:''}};
 const engine=fixture([view],{a:{state:'active',times:['day'],reason:''}});
 expect(questWaitReason(engine,quest,world)).toBe('');
 view.step={...view.step,when:'day'} as typeof view.step;
 expect(questWaitReason(engine,quest,world)).toContain('白天');
});
it('recommendation honors authored preference, skips completed offers and explains waiting destinations without changing the world',()=>{
 const source=q('gate-mia'), preferred=q('library-corner'), nearby=q('other');
 const status:Record<string,QuestAvailability>={ 'library-corner':{state:'available',times:['day'],reason:''},other:{state:'available',times:[],reason:''}};
 const views:QuestView[]=[{definition:nearby},{definition:preferred}];const engine=fixture(views,status);
 const recommendation=()=>nextQuestRecommendation(source,engine,world,()=> '圖資廣場');
 expect(recommendation()).toContain('「library-corner」');expect(recommendation()).toContain('圖資廣場（直線約 3 m）');
 views[1].state={status:'completed',step:2,choices:{}};expect(recommendation()).toContain('「other」');
 views[1].state=undefined;status['library-corner']={state:'wrong-time',times:['day'],reason:'可接：白天，按 N'};
 views.splice(0,1);expect(recommendation()).toContain('可接：白天，按 N');
 expect(world.timeOfDay()).toBe('night');
 expect(nextQuestRecommendation(q('tunnel-photo'),engine,world,()=> '')).toContain('主線第 3 章');
 expect(nextQuestRecommendation(q('sea-postcard'),engine,world,()=> '')).toContain('夕陽人潮');
});
it('passes active spots and persistent variants to the field on completion, reload and clearing',()=>{
 const field={sync:vi.fn()},works:QuestWork[]=[{spot:'shared',kind:'board'}];
 const engine={worksShown:vi.fn(()=>works)};
 syncQuestWorks(field,['shared','active'],engine,world);
 expect(field.sync).toHaveBeenLastCalledWith(['shared','active'],works);
 syncQuestWorks(field,[],engine,world);expect(field.sync).toHaveBeenLastCalledWith([],works);
 works[0]={spot:'shared',kind:'planters'};syncQuestWorks(field,[],engine,world);
 expect(field.sync).toHaveBeenLastCalledWith([],[{spot:'shared',kind:'planters'}]);
 works.length=0;syncQuestWorks(field,[],engine,world);expect(field.sync).toHaveBeenLastCalledWith([],[]);
 expect(engine.worksShown).toHaveBeenCalledWith(world);
});

it('waiting rows require the acceptance NPC within 4 m and never include locked, active or completed quests',()=>{
 const quest=q('a'), status:Record<string,QuestAvailability>={a:{state:'wrong-time',times:['sunset'],reason:'可接：夕陽，按 N'}};
 const engine=fixture([{definition:quest}],status);
 expect(nearbyQuestOffers(engine,{...world,distanceTo:()=>4})[0].disabled).toBe(true);
 expect(nearbyQuestOffers(engine,{...world,distanceTo:()=>4.001})).toEqual([]);
 for (const state of ['locked','active','completed'] as const) {status.a={...status.a,state};expect(nearbyQuestOffers(engine,world)).toEqual([]);}
 status.a={...status.a,state:'npc-away'};expect(nearbyQuestOffers(engine,world)).toHaveLength(1);
 status.a={...status.a,state:'available'};expect(nearbyQuestOffers(engine,world)[0].disabled).toBe(false);
});
