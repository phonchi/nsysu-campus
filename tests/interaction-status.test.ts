import { expect, it } from 'vitest';
import { QuestEngine, type QuestDefinition } from '../src/story/quests';
import { npcQuestStatuses } from '../src/walk/interaction-status';
it('gold is an unlocked offer; blue follows the current active step, respects time/presence, and wins over gold',()=>{
 const q:QuestDefinition={id:'q',title:'Q',zone:'gate',npc:'a',description:'',reward:'',accept:{near:'npc:a',chapterDone:'c1'},steps:[{id:'one',target:'npc:b',text:'',when:'day'},{id:'two',target:'npc:a',text:''}]};
 let done=false,time='day';const absent=new Set<string>();
 const world={distanceTo:()=>100,timeOfDay:()=>time,chapterDone:()=>done,npcPresent:(id:string)=>!absent.has(id)};
 const quests=new QuestEngine({version:1,quests:[q]},{storage:{getItem:()=>null,setItem:()=>{},removeItem:()=>{}}});
 expect([...npcQuestStatuses(quests,world)]).toEqual([]);
 done=true;expect(npcQuestStatuses(quests,world).get('a')).toBe('acceptable');
 expect(quests.accept('q',{...world,distanceTo:()=>0})).toBe(true);
 expect([...npcQuestStatuses(quests,world)]).toEqual([['b','deliverable']]);
 // An accepted save stays usable even if its chapter history is incomplete.
 done=false;expect(npcQuestStatuses(quests,world).get('b')).toBe('deliverable');done=true;
 absent.add('b');expect([...npcQuestStatuses(quests,world)]).toEqual([]);
 absent.clear();time='night';expect([...npcQuestStatuses(quests,world)]).toEqual([]);
 time='day';quests.interact('q',{...world,distanceTo:()=>0});
 expect([...npcQuestStatuses(quests,world)]).toEqual([['a','deliverable']]);
 quests.interact('q',{...world,distanceTo:()=>0});expect([...npcQuestStatuses(quests,world)]).toEqual([]);
});
