/** WP-R's structural seam while WP-Q is developed in its own worktree.
 * Once present, the engine is the only authority for availability, flags and works. */
import type { QuestDefinition, QuestEngine, QuestWorld } from '../story/quests';
import type { SpotKind } from '../world/quest-spots';

export interface QuestAvailability {
  state: 'locked' | 'wrong-time' | 'npc-away' | 'available' | 'active' | 'completed';
  times: readonly string[];
  reason: string;
}
export interface QuestGrant { itemId: string; variant?: string }
export interface QuestWork { spot: string; kind: SpotKind }
export interface QuestConsequences {
  flag?(id: string): boolean;
  readonly grants?: readonly QuestGrant[] | Record<string, QuestGrant>;
  worksShown?(world: QuestWorld): readonly QuestWork[];
}
export type QuestPresentationEngine = Pick<QuestEngine, 'list' | 'unlocked' | 'acceptable'> & QuestConsequences & {
  availability?(quest: QuestDefinition, world: QuestWorld): QuestAvailability;
};
export const questGrants = (quests?: QuestConsequences): readonly QuestGrant[] => Object.values(quests?.grants ?? {});
export function questAvailability(quests: QuestPresentationEngine, quest: QuestDefinition, world: QuestWorld): QuestAvailability {
  if (quests.availability) return quests.availability(quest, world);
  // Pre-merge v10.1 fallback only; do not invent v10.2 state from its old data.
  const state = quests.list().find(v => v.definition.id === quest.id)?.state;
  if (state) return { state: state.status, times: [], reason: '' };
  if (!quests.unlocked(quest, world)) return { state: 'locked', times: [], reason: '' };
  const available = quests.acceptable({ ...world, distanceTo: () => 0 }).some(v => v.definition.id === quest.id);
  return { state: available ? 'available' : 'npc-away', times: [], reason: available ? '' : '人物目前不在校園，請切換時段再來。' };
}
/** Local offers use the same 4 m boundary for enabled and waiting rows. */
export function nearbyQuestOffers(quests: QuestPresentationEngine, world: QuestWorld) {
  return quests.list().flatMap(v => {
    const availability = questAvailability(quests, v.definition, world);
    const disabled = availability.state === 'wrong-time' || availability.state === 'npc-away';
    if (availability.state !== 'available' && !disabled) return [];
    if (world.distanceTo(v.definition.accept.near) > 4 || (disabled && !v.definition.accept.near.startsWith('npc:'))) return [];
    return [{ definition: v.definition, availability, disabled }];
  });
}
const TIME: Record<string, string> = { day: '白天', sunset: '夕陽', night: '夜晚' };
export function questOfferLabel(title: string, availability: QuestAvailability) {
  return `接取・${title}${availability.state === 'wrong-time' || availability.state === 'npc-away'
    ? `（${availability.times.length ? `可接：${availability.times.map(t => TIME[t] ?? t).join('、')}，按 N` : availability.reason}）` : ''}`;
}
/** Same source for the objective card and journal, including a blocked active step. */
export function questWaitReason(quests: QuestPresentationEngine, quest: QuestDefinition, world: QuestWorld): string {
  const availability = questAvailability(quests, quest, world);
  if (availability.reason) return availability.reason;
  const step = quests.list().find(v => v.definition.id === quest.id)?.step;
  if (step?.when && step.when !== world.timeOfDay()) return `可續作：${TIME[step.when] ?? step.when}，按 N`;
  if (step?.target.startsWith('npc:') && world.npcPresent?.(step.target.slice(4)) === false) return '人物目前不在校園，請切換時段再來。';
  return '';
}
/** Spec §2 author's preference; WP-Q may replace it with quest.next. No acceptance or time change. */
export const QUEST_NEXT: Record<string, string[]> = {
  'gate-lost': ['tunnel-leaflet'], 'gate-mia': ['library-corner'], 'tunnel-leaflet': ['tunnel-photo'],
  'tunnel-photo': [], 'admin-list': ['library-bookmark'], 'admin-garden': ['admin-list'],
  'library-bookmark': ['library-corner'], 'library-corner': ['gate-mia'], 'arcade-coffee': ['math-day'],
  'arcade-club': ['arcade-coffee'], 'sea-postcard': [], 'sea-stage': ['sea-postcard'], 'math-day': ['arcade-club'],
};
export function nextQuestRecommendation(completed: QuestDefinition, quests: QuestPresentationEngine, world: QuestWorld,
  zoneLabel: (zone: string) => string): string {
  if (completed.id === 'tunnel-photo') return '接下來：主線第 3 章，前往行政大樓。';
  if (completed.id === 'sea-postcard') return '接下來：沿海堤尋找夕陽人潮活動。';
  const preferences = (completed as QuestDefinition & { next?: string[] }).next ?? QUEST_NEXT[completed.id] ?? [];
  const offers = quests.list().filter(v => !v.state && questAvailability(quests, v.definition, world).state === 'available');
  const next = preferences.map(id => offers.find(v => v.definition.id === id)).find(Boolean)
    ?? offers.filter(v => world.distanceTo(v.definition.accept.near) <= 60).sort((a,b) => world.distanceTo(a.definition.accept.near) - world.distanceTo(b.definition.accept.near))[0];
  const waiting = preferences.map(id => quests.list().find(v => v.definition.id === id && !v.state)).find(Boolean);
  const target = next ?? waiting;
  if (!target) return '接下來：回主線繼續導覽，或在附近自由探索。';
  const q = target.definition, a = questAvailability(quests, q, world), distance = world.distanceTo(q.accept.near);
  const where = `前往${zoneLabel(q.zone)}${Number.isFinite(distance) && distance <= 60 ? `（直線約 ${Math.round(distance)} m）` : ''}`;
  return `推薦「${q.title}」：${where}。${a.state === 'locked' ? '完成前置主線後可接。' : a.reason}`;
}
/** WP-Q owns union/deduplication, variant rebuilds and matching collision recipes. */
export function syncQuestWorks(field: { sync(ids: readonly string[], works?: readonly QuestWork[]): void }, ids: readonly string[], quests: QuestConsequences, world: QuestWorld) {
  field.sync(ids, quests.worksShown?.(world) ?? []);
}
