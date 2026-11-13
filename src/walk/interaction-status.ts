import type { QuestEngine, QuestWorld } from '../story/quests';
export type NpcQuestStatus = 'acceptable' | 'deliverable';
/** Head badges advertise NPC offers before entering the action radius. All other acceptance
 * rules (chapter, time and, after WP-B, the full NPC schedule chain) still run in acceptable(). */
export function npcQuestStatuses(quests: Pick<QuestEngine,'acceptable'|'list'|'unlocked'>, world: QuestWorld & { npcPresent?(id:string):boolean }): Map<string,NpcQuestStatus> {
  const states=new Map<string,NpcQuestStatus>();
  const offers=quests.acceptable({...world,distanceTo:target=>target.startsWith('npc:')?0:world.distanceTo(target)});
  for(const v of offers) if(v.definition.accept.near.startsWith('npc:')) {
    const id=v.definition.accept.near.slice(4);
    if(world.npcPresent?.(id)!==false)states.set(id,'acceptable');
  }
  for(const v of quests.list()) {
    const s=v.step;
    if(!s || !quests.unlocked(v.definition,world) || !s.target.startsWith('npc:') || s.kind==='photo' || (s.when && s.when!==world.timeOfDay()))continue;
    const id=s.target.slice(4);
    if(world.npcPresent?.(id)!==false)states.set(id,'deliverable');
  }
  return states;
}
