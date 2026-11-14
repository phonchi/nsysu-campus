/** v10.2 WP-Q contract on fixtures: availability, quest flags, works, grants and the save guards (spec-v10.2 §1, §3). */
import { describe, expect, it } from 'vitest';
import { QuestEngine, QUEST_KEY, condFlags, evalCond, questFlags, resolveStep, validateQuests, type QuestData, type QuestDefinition, type QuestWorld } from '../src/story/quests';
import type { QuestSpot } from '../src/world/quest-spots';

const memory = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); } }; };
const choices = [{ id: 'a', label: 'A', result: 'ra' }, { id: 'b', label: 'B', result: 'rb' }];
const spots: Record<string, QuestSpot> = { notice: { kind: 'notice', label: 'n', at: [0, 0], stand: [0, 2] }, ledger: { kind: 'ledger', label: 'l', at: [5, 0], stand: [5, 2] }, shared: { kind: 'board', label: 's', at: [9, 0], stand: [9, 2] } };
const quest = (extra: Partial<QuestDefinition> = {}): QuestDefinition => ({
  id: 'q', title: 'Q', zone: 'gate', npc: 'host', description: '', reward: '保管回條',
  accept: { near: 'npc:host', chapterDone: 'c1', times: ['day', 'sunset'] },
  absent: { night: '夜裡不在。' },
  steps: [{ id: 'errand-1', target: 'npc:host', text: '' }, { id: 'errand-2', target: 'spot:notice', text: '' }, { id: 'return', target: 'npc:host', text: '', choices }],
  works: [{ id: 'w-notice', spot: 'notice', if: { flag: 'quest.q.return.a' }, variants: [{ if: { flag: 'quest.q.return.a' }, kind: 'notice-claim' }] }, { id: 'w-ledger', spot: 'ledger', if: { flag: 'quest.q.done' }, variants: [{ if: { flag: 'quest.q.return.a' }, kind: 'ledger' }, { if: { flag: 'quest.q.return.b' }, kind: 'ledger-entry' }] }],
  completionRewards: [{ kind: 'item', itemId: 'item-quest-q', variantBy: 'return' }],
  legacyRewards: ['舊紀念章'],
  ...extra,
});
const data = (q: QuestDefinition = quest(), more: QuestDefinition[] = []): QuestData => ({ version: 1, quests: [q, ...more], spots });
const world = (o: Partial<QuestWorld> = {}): QuestWorld => ({ distanceTo: () => 0, timeOfDay: () => 'day', chapterDone: () => true, npcPresent: () => true, ...o });
const finish = (e: QuestEngine, choice = 'a') => { expect(e.accept('q', world())).toBe(true); expect(e.interact('q', world())).toBe(true); expect(e.interact('q', world())).toBe(true); expect(e.choose('q', choice, world())).toBe(true); };

describe('availability', () => {
  it('ranks completed > active > locked > wrong-time > npc-away > available, without looking at distance', () => {
    const e = new QuestEngine(data(), { storage: memory() }), q = e.data.quests[0], far = world({ distanceTo: () => 1e9 });
    expect(e.availability(q, far)).toEqual({ state: 'available', times: ['day', 'sunset'], reason: '' });
    expect(e.acceptable(far)).toEqual([]);
    expect(e.acceptable(world()).map(v => v.definition.id)).toEqual(['q']);
    expect(e.availability(q, world({ chapterDone: () => false, timeOfDay: () => 'night', npcPresent: () => false }))).toMatchObject({ state: 'locked', reason: '' });
    expect(e.availability(q, world({ timeOfDay: () => 'night', npcPresent: () => false }))).toMatchObject({ state: 'wrong-time', times: ['day', 'sunset'], reason: '夜裡不在。' });
    expect(e.availability(q, world({ timeOfDay: () => 'sunset', npcPresent: () => false }))).toMatchObject({ state: 'npc-away', missing: ['host'], reason: '需要的人物現在不在校園。' });
    expect(e.accept('q', world({ timeOfDay: () => 'night' }))).toBe(false);
    expect(e.accept('q', world({ timeOfDay: () => 'sunset' }))).toBe(true);
    expect(e.availability(q, world({ timeOfDay: () => 'night', npcPresent: () => false }))).toMatchObject({ state: 'active', reason: '' });
    expect(e.interact('q', world())).toBe(true); expect(e.interact('q', world())).toBe(true); expect(e.choose('q', 'b', world())).toBe(true);
    expect(e.availability(q, world({ chapterDone: () => false }))).toMatchObject({ state: 'completed' });
  });
  it('a wrong time without an absent line names the open times; a chain member off campus is npc-away', () => {
    const q = quest({ absent: undefined, steps: [{ id: 'errand-1', target: 'npc:host', text: '' }, { id: 'errand-2', target: 'npc:friend', text: '' }, { id: 'return', target: 'npc:host', text: '', choices }] });
    const e = new QuestEngine(data(q), { storage: memory() });
    expect(e.availability(q, world({ timeOfDay: () => 'night' }))).toMatchObject({ state: 'wrong-time', reason: '可接時段：白天、夕陽。' });
    expect(e.availability(q, world({ npcPresent: id => id !== 'friend' }))).toMatchObject({ state: 'npc-away', missing: ['friend'] });
    expect(e.acceptableTimes(q, world())).toEqual(['day', 'sunset']);
  });
  it('data without accept.times keeps the old rule: a timed first step at the giver and the schedule intersection', () => {
    const q = quest({ accept: { near: 'npc:host' }, steps: [{ id: 'errand-1', target: 'npc:host', text: '', when: 'sunset' }, { id: 'return', target: 'npc:host', text: '', choices }] });
    const e = new QuestEngine(data(q), { storage: memory() });
    expect(e.availability(q, world())).toMatchObject({ state: 'wrong-time', times: [], reason: '可接時段：夕陽。' });
    expect(e.availability(q, world({ timeOfDay: () => 'sunset' }))).toMatchObject({ state: 'available' });
    expect(e.availability(q, world({ timeOfDay: () => 'sunset', npcPresentAt: (_id, t) => t !== 'day' }))).toMatchObject({ state: 'available', times: ['sunset'] });
    expect(e.acceptableTimes(q, world())).toBeUndefined();
  });
});

describe('quest flags', () => {
  it('are rebuilt from choices and status, so a and b never both hold, and survive a reload', () => {
    const storage = memory(); let e = new QuestEngine(data(), { storage });
    expect(e.flags()).toEqual([]);
    finish(e, 'a');
    expect(e.flag('quest.q.return.a')).toBe(true); expect(e.flag('quest.q.return.b')).toBe(false); expect(e.flag('quest.q.done')).toBe(true);
    e = new QuestEngine(data(), { storage });
    expect(e.flags().sort()).toEqual(['quest.q.done', 'quest.q.return.a']);
    e.clear(); expect(e.flags()).toEqual([]);
  });
  it('done holds only once the quest is complete, and the catalogue lists every possible flag', () => {
    const e = new QuestEngine(data(), { storage: memory() });
    e.accept('q', world()); e.interact('q', world());
    expect(e.flag('quest.q.done')).toBe(false);
    expect(questFlags(data()).sort()).toEqual(['quest.q.done', 'quest.q.return.a', 'quest.q.return.b']);
    expect(condFlags({ any: [{ flag: 'x' }, { all: [{ notFlag: 'y' }] }] })).toEqual(['x', 'y']);
    expect(evalCond({ all: [{ flag: 'x' }, { notFlag: 'y' }] }, id => id === 'x')).toBe(true);
    expect(evalCond({ any: [{ flag: 'y' }] }, id => id === 'x')).toBe(false);
  });
});

describe('works shown', () => {
  it('is the current steps\' spots plus the finished works in the chosen variant; the step wins over a work on the same spot', () => {
    const storage = memory(); let e = new QuestEngine(data(), { storage });
    expect(e.worksShown(world())).toEqual([]);
    e.accept('q', world()); e.interact('q', world());
    expect(e.worksShown(world())).toEqual([{ spot: 'notice', kind: 'notice' }]);
    e.interact('q', world()); e.choose('q', 'a', world());
    expect(e.worksShown(world())).toEqual([{ spot: 'notice', kind: 'notice-claim' }, { spot: 'ledger', kind: 'ledger' }]);
    e = new QuestEngine(data(), { storage });
    expect(e.worksShown(world())).toEqual([{ spot: 'notice', kind: 'notice-claim' }, { spot: 'ledger', kind: 'ledger' }]);
    const other = quest({ id: 'o', works: [], completionRewards: [], steps: [{ id: 'errand-1', target: 'npc:host', text: '' }, { id: 'return', target: 'spot:ledger', text: '', choices }] });
    e = new QuestEngine(data(quest(), [other]), { storage });
    e.accept('o', world()); e.interact('o', world());
    expect(e.worksShown(world())).toEqual([{ spot: 'ledger', kind: 'ledger' }, { spot: 'notice', kind: 'notice-claim' }]);
    e.clear(); expect(e.worksShown(world())).toEqual([]);
  });
  it('b picks the other variant and a condition that fails hides the work', () => {
    const e = new QuestEngine(data(), { storage: memory() });
    finish(e, 'b');
    expect(e.worksShown(world())).toEqual([{ spot: 'ledger', kind: 'ledger-entry' }]);
  });
});

describe('grants', () => {
  it('are issued once on completion with the chosen variant, never again on reload, and cleared with the progress', () => {
    const storage = memory(); let e = new QuestEngine(data(), { storage, now: () => 7 });
    finish(e, 'b');
    expect(e.grants).toEqual([{ key: 'quest:q:item-quest-q', quest: 'q', itemId: 'item-quest-q', variant: 'b', at: 7 }]);
    expect(e.progress.rewards).toEqual(['保管回條']);
    e = new QuestEngine(data(), { storage, now: () => 9 });
    expect(e.grants).toHaveLength(1); expect(e.grants[0].at).toBe(7);
    expect(JSON.parse(storage.getItem(QUEST_KEY)!).grants).toHaveLength(1);
    e.clear(); expect(e.grants).toEqual([]);
  });
  it('backfills a quest finished under an old reward name, dating it from the journal, without touching the reward list', () => {
    const storage = memory();
    storage.setItem(QUEST_KEY, JSON.stringify({ version: 1, quests: { q: { status: 'completed', step: 3, choices: { return: 'a' } } }, journal: [{ id: 'q:return', kind: 'quest', title: 'Q', text: '', at: 1234, zone: 'gate', npc: 'host', reward: '舊紀念章' }], rewards: ['舊紀念章'] }));
    let e = new QuestEngine(data(), { storage, now: () => 99 });
    expect(e.grants).toEqual([{ key: 'quest:q:item-quest-q', quest: 'q', itemId: 'item-quest-q', variant: 'a', at: 1234 }]);
    expect(e.progress.rewards).toEqual(['舊紀念章']);
    expect(e.progress.journal).toHaveLength(1);
    e = new QuestEngine(data(), { storage, now: () => 100 });
    expect(e.grants).toHaveLength(1); expect(e.grants[0].at).toBe(1234);
    // No recorded choice: the plain collectible, no variant.
    const plain = memory(); plain.setItem(QUEST_KEY, JSON.stringify({ version: 1, quests: { q: { status: 'completed', step: 3, choices: {} } }, journal: [], rewards: [] }));
    expect(new QuestEngine(data(), { storage: plain, now: () => 5 }).grants).toEqual([{ key: 'quest:q:item-quest-q', quest: 'q', itemId: 'item-quest-q', at: 5 }]);
  });
  it('ignores malformed grants in a save and keeps one per key', () => {
    const storage = memory();
    storage.setItem(QUEST_KEY, JSON.stringify({ version: 1, quests: {}, journal: [], rewards: [], grants: [{ key: 'k', quest: 'q', itemId: 'i', at: 1 }, { key: 'k', quest: 'q', itemId: 'i', at: 2 }, { key: 'bad' }, null] }));
    expect(new QuestEngine(data(), { storage }).grants).toEqual([{ key: 'k', quest: 'q', itemId: 'i', at: 1 }]);
  });
});

describe('save guards (restore)', () => {
  const save = (state: object) => { const s = memory(); s.setItem(QUEST_KEY, JSON.stringify({ version: 1, quests: { q: state }, journal: [], rewards: [] })); return s; };
  const shorter = quest({ revision: 2, legacyStepOrder: ['errand-1', 'errand-2', 'errand-3', 'return'], legacySteps: { 'errand-3': 'return' } });
  it('a quest completed with four steps stays completed when it shrinks to three, keeping its choice and collectible', () => {
    const e = new QuestEngine(data(shorter), { storage: save({ status: 'completed', step: 4, stepId: 'return', choices: { return: 'b' } }) });
    expect(e.list()[0].state).toMatchObject({ status: 'completed', step: 3, stepId: undefined, choices: { return: 'b' }, revision: 2 });
    expect(e.flag('quest.q.done')).toBe(true); expect(e.grants[0]).toMatchObject({ variant: 'b' });
    expect(e.progress.journal).toEqual([]);
  });
  it('an active save on a retired step id follows legacySteps, by id and by revision-1 index', () => {
    let e = new QuestEngine(data(shorter), { storage: save({ status: 'active', step: 2, stepId: 'errand-3', choices: {} }) });
    expect(e.list()[0].step?.id).toBe('return'); expect(e.list()[0].state?.step).toBe(2); expect(e.progress.journal).toEqual([]);
    e = new QuestEngine(data(shorter), { storage: save({ status: 'active', step: 2, choices: {} }) });
    expect(e.list()[0].step?.id).toBe('return');
    e = new QuestEngine(data(shorter), { storage: save({ status: 'active', step: 1, choices: {} }) });
    expect(e.list()[0].step?.id).toBe('errand-2');
    expect(resolveStep(shorter, { stepId: 'errand-3' })).toBe(2); expect(resolveStep(shorter, { step: 9 })).toBe(2); expect(resolveStep(shorter, { stepId: 'gone' })).toBeUndefined();
  });
  it('an unmapped retired id still restarts the quest once, with a journal line; malformed states are dropped', () => {
    const e = new QuestEngine(data(shorter), { storage: save({ status: 'active', step: 2, stepId: 'gone', choices: {} }) });
    expect(e.list()[0].state).toMatchObject({ status: 'active', step: 0 }); expect(e.progress.journal.map(x => x.id)).toEqual(['q:reset:2']);
    expect(new QuestEngine(data(shorter), { storage: save({ status: 'active', step: -1, choices: {} }) }).list()[0].state).toBeUndefined();
    expect(new QuestEngine(data(shorter), { storage: save({ status: 'done', step: 1, choices: {} }) }).list()[0].state).toBeUndefined();
  });
});

describe('validateQuests (v10.2 fields)', () => {
  it('checks legacySteps, accept.times, works, rewards and next', () => {
    expect(validateQuests(data())).toEqual([]);
    expect(validateQuests(data(quest({ revision: 2, legacyStepOrder: ['errand-1', 'errand-2', 'errand-3', 'return'], legacySteps: { 'errand-3': 'return' } })))).toEqual([]);
    expect(validateQuests(data(quest({ legacySteps: { 'errand-2': 'return' } })))).toEqual(['legacy step q/errand-2 still exists']);
    expect(validateQuests(data(quest({ legacySteps: { 'errand-9': 'nowhere' } })))).toEqual(['legacy step q/errand-9 maps to missing nowhere']);
    expect(validateQuests(data(quest({ accept: { near: 'npc:host', times: [] } })))).toEqual(['bad accept times q']);
    expect(validateQuests(data(quest({ accept: { near: 'npc:host', times: ['dawn' as 'day'] } })))).toEqual(['bad accept times q']);
    expect(validateQuests(data(quest({ works: [{ id: 'w', spot: 'nowhere', if: { flag: 'quest.q.done' } }] })))).toEqual(['work q/w: unknown spot nowhere']);
    expect(validateQuests(data(quest({ works: [{ id: 'w', spot: 'notice', if: { flag: 'quest.q.return.c' } }] })))).toEqual(['work q/w: unknown flag quest.q.return.c']);
    expect(validateQuests(data(quest({ works: [{ id: 'w', spot: 'notice', if: { flag: 'quest.q.done' } }, { id: 'w', spot: 'ledger', if: { flag: 'quest.q.done' } }] })))).toEqual(['duplicate work q/w']);
    expect(validateQuests(data(quest({ completionRewards: [{ kind: 'item', itemId: 'i', variantBy: 'errand-1' }] })))).toEqual(['reward q/i: variantBy names no choice step']);
    expect(validateQuests(data(quest({ next: ['ghost'] })))).toEqual(['next q: unknown quest ghost']);
    expect(validateQuests(data(quest({ steps: [{ id: 'errand-1', target: 'npc:host', text: '', when: 'dawn' }, { id: 'return', target: 'npc:host', text: '', choices }] })))).toEqual(['bad step time q/errand-1']);
  });
});
