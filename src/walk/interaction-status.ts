import type { QuestWorld } from '../story/quests';
import { questAvailability, type QuestPresentationEngine } from './interaction-quests';
export type NpcQuestStatus = 'acceptable' | 'deliverable' | 'waiting';
/** Head badges advertise NPC offers before entering the action radius. All acceptance
 * rules (chapter, time and the NPC schedule chain) come from availability(). */
export function npcQuestStatuses(quests: QuestPresentationEngine, world: QuestWorld & { npcPresent?(id:string):boolean }): Map<string,NpcQuestStatus> {
  const states=new Map<string,NpcQuestStatus>();
  for (const v of quests.list()) {
    if (!v.definition.accept.near.startsWith('npc:')) continue;
    const id = v.definition.accept.near.slice(4), a = questAvailability(quests, v.definition, world);
    if (world.npcPresent?.(id) === false) continue;
    if (a.state === 'available') states.set(id, 'acceptable');
    else if ((a.state === 'wrong-time' || a.state === 'npc-away') && !states.has(id)) states.set(id, 'waiting');
  }
  for(const v of quests.list()) {
    const s=v.step;
    if(!s || !s.target.startsWith('npc:') || s.kind==='photo' || (s.when && s.when!==world.timeOfDay()))continue;
    const id=s.target.slice(4);
    if(world.npcPresent?.(id)!==false)states.set(id,'deliverable');
  }
  return states;
}
