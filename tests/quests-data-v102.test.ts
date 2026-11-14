/** v10.2 on the authored data: the fourteen quests' acceptable times against npcs.json, flags, works and keepsakes, and
 * the revision-1 save contract after the rewrite (spec-v10.2 §2, §4). */
import { describe, expect, it } from 'vitest';
import { QuestEngine, QUEST_KEY, evalCond, questFlags, validateQuests, type QuestData, type QuestWorld, type TimeOfDay } from '../src/story/quests';
import { SPOT_RECIPES, baseKind } from '../src/world/quest-spots';
import { npcPresentAt } from '../src/walk/interaction';
import questData from '../public/data/quests.json';
import npcData from '../public/data/npcs.json';
import collection from '../public/data/collection.json';
import type { NpcData } from '../src/story/talk';
const data = questData as QuestData, npcs = (npcData as unknown as NpcData).npcs;
const memory = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); } }; };
/** npcs.json is the coordinator's: presence here is the authored schedule (the v10.2 moves keep every presence the same). */
const world = (time: TimeOfDay, o: Partial<QuestWorld> = {}): QuestWorld => ({ distanceTo: () => 0, timeOfDay: () => time, chapterDone: () => true, npcPresent: id => npcPresentAt(npcs, id, time), npcPresentAt: (id, t) => npcPresentAt(npcs, id, t), ...o });
const at = (target: string, time: TimeOfDay) => world(time, { distanceTo: t => t === target ? 0 : 1e9, photoCount: 1 });
const complete = (e: QuestEngine, id: string, choice: string) => {
  const q = data.quests.find(q => q.id === id)!, time = q.accept.times![0];
  expect(e.accept(id, at(q.accept.near, time)), `${id} accept`).toBe(true);
  for (const s of q.steps) {
    const w = at(s.target, (s.when as TimeOfDay | undefined) ?? time);
    if (s.choices) expect(e.choose(id, choice, w), `${id}/${s.id}`).toBe(true);
    else if (s.kind === 'photo') expect(e.notifyPhoto(w), `${id}/${s.id}`).toBe(1);
    else expect(e.interact(id, w), `${id}/${s.id}`).toBe(true);
  }
};
/** Spec §2's "可接時段" column, hard-coded so a data slip shows up as a diff against the decision, not against itself. */
const SPEC_TIMES: Record<string, TimeOfDay[]> = {
  'gate-lost': ['day', 'sunset'], 'gate-mia': ['day'], 'tunnel-leaflet': ['day'], 'tunnel-photo': ['day'], 'admin-list': ['day', 'sunset', 'night'],
  'admin-garden': ['day'], 'library-bookmark': ['day', 'night'], 'library-corner': ['day', 'night'], 'arcade-coffee': ['day', 'sunset'],
  'arcade-club': ['day'], 'sea-postcard': ['sunset'], 'sea-stage': ['sunset'], 'math-day': ['day', 'sunset'], 'math-freshman': ['day', 'sunset'],
};
const SPEC_GATES: Record<string, string> = { 'gate-lost': 'c1-gate', 'tunnel-leaflet': 'c2-tunnel', 'tunnel-photo': 'c2-tunnel' };

describe('fourteen quests × three times of day', () => {
  it('matches spec §2 and is available exactly at those times with the authored schedules', () => {
    expect(validateQuests(data)).toEqual([]);
    expect(data.quests.map(q => q.id).sort()).toEqual(Object.keys(SPEC_TIMES).sort());
    const e = new QuestEngine(data, { storage: memory() });
    for (const q of data.quests) {
      expect(q.accept.times, q.id).toEqual(SPEC_TIMES[q.id]);
      for (const time of ['day', 'sunset', 'night'] as const) {
        const a = e.availability(q, world(time, { distanceTo: () => 1e9 }));
        expect(a.times, `${q.id}@${time}`).toEqual(SPEC_TIMES[q.id]);
        if (SPEC_TIMES[q.id].includes(time)) expect(a, `${q.id}@${time}`).toEqual({ state: 'available', times: SPEC_TIMES[q.id], reason: '' });
        else { expect(a.state, `${q.id}@${time}`).toBe('wrong-time'); expect(a.reason, `${q.id}@${time}`).not.toBe(''); }
      }
    }
    for (const [id, gate] of Object.entries(SPEC_GATES)) expect(data.quests.find(q => q.id === id)!.accept.chapterDone).toBe(gate);
  });
  it('the four wrong-time showcases are grey, not silent: the postcard by day, lost property by night, the bookmark at sunset, the stage by day', () => {
    const e = new QuestEngine(data, { storage: memory() });
    const q = (id: string) => data.quests.find(q => q.id === id)!;
    expect(e.availability(q('sea-postcard'), world('day'))).toMatchObject({ state: 'wrong-time', reason: '小橘白天在隧道洞口拍照，夕陽時才到海堤。' });
    expect(e.availability(q('gate-lost'), world('night'))).toMatchObject({ state: 'wrong-time', reason: '阿忠伯夜裡巡到海堤，白天或傍晚才回校門警衛室。' });
    expect(e.availability(q('library-bookmark'), world('sunset'))).toMatchObject({ state: 'wrong-time', reason: '阿文傍晚在海堤看夕陽，白天在圖資廣場閱讀角旁，夜裡在廣場。' });
    expect(e.availability(q('sea-stage'), world('day'))).toMatchObject({ state: 'wrong-time', reason: '允哲白天在圖資大樓附近準備，夕陽才到長廊演出。' });
    expect(e.acceptable(world('day')).map(v => v.definition.id).sort()).toEqual(Object.keys(SPEC_TIMES).filter(id => SPEC_TIMES[id].includes('day')).sort());
  });
  it('an accepted quest is never pushed back by its times: the step window alone decides', () => {
    const e = new QuestEngine(data, { storage: memory() }), q = data.quests.find(q => q.id === 'gate-mia')!;
    expect(e.accept(q.id, at(q.accept.near, 'day'))).toBe(true);
    expect(e.availability(q, world('night'))).toMatchObject({ state: 'active' });
    expect(e.interact(q.id, at(q.steps[0].target, 'night'))).toBe(true);
  });
});

describe('choices leave flags, works and keepsakes', () => {
  it('every quest, both ways: one keepsake with the chosen variant, exclusive flags, and works in the authored variant kinds', () => {
    const items = new Map((collection as { items: { id: string; group?: string; variants?: Record<string, { name: string; desc: string }> }[] }).items.map(i => [i.id, i]));
    for (const q of data.quests) for (const choice of ['a', 'b']) {
      const storage = memory(); let e = new QuestEngine(storage ? data : data, { storage });
      complete(e, q.id, choice);
      e = new QuestEngine(data, { storage });
      expect(e.flag(`quest.${q.id}.done`), q.id).toBe(true);
      expect(e.flag(`quest.${q.id}.return.${choice}`), q.id).toBe(true);
      expect(e.flag(`quest.${q.id}.return.${choice === 'a' ? 'b' : 'a'}`), q.id).toBe(false);
      expect(e.grants, q.id).toEqual([{ key: `quest:${q.id}:item-quest-${q.id}`, quest: q.id, itemId: `item-quest-${q.id}`, variant: choice, at: expect.any(Number) }]);
      const item = items.get(`item-quest-${q.id}`)!;
      expect(item?.group, q.id).toBe('quest'); expect(item.variants?.[choice]?.name, q.id).toBeTruthy();
      expect(e.progress.rewards, q.id).toEqual([q.reward]);
      const shown = e.worksShown(world('day'));
      for (const w of q.works ?? []) {
        // A work shows when its condition holds, in the variant the choice picked or else in the spot's own kind.
        const expected = evalCond(w.if, id => e.flag(id)) ? w.variants?.find(v => evalCond(v.if, id => e.flag(id)))?.kind ?? data.spots![w.spot].kind : undefined;
        const got = shown.find(s => s.spot === w.spot)?.kind;
        expect(got, `${q.id}/${w.id}/${choice}`).toBe(expected);
        if (expected) { expect(baseKind(expected), `${q.id}/${w.id}`).toBe(data.spots![w.spot].kind); expect(SPOT_RECIPES[expected]).toBeDefined(); }
      }
    }
  });
  it('the flag catalogue has 14 done flags and 28 choice flags, all distinct', () => {
    const flags = questFlags(data);
    expect(new Set(flags).size).toBe(42);
    expect(flags.filter(f => f.endsWith('.done'))).toHaveLength(14);
  });
  it('every quest names a collectible that exists once in collection.json, and nothing else is group quest', () => {
    const quest = (collection as { items: { id: string; group?: string }[] }).items.filter(i => i.group === 'quest').map(i => i.id).sort();
    expect(quest).toEqual(data.quests.map(q => `item-quest-${q.id}`).sort());
    expect(new Set(quest).size).toBe(14);
  });
});

describe('revision-1 saves after the v10.2 rewrite', () => {
  const contract = data.saveContract!;
  const save = (id: string, state: object, extra: object = {}) => { const s = memory(); s.setItem(QUEST_KEY, JSON.stringify({ version: 1, quests: { [id]: state }, journal: [], rewards: [], ...extra })); return s; };
  it('index-only and stepId saves land on the same step; the new targets are what the step now points at', () => {
    for (const q of data.quests) {
      const old = contract.quests[q.id].steps;
      for (let i = 0; i < old.length; i++) {
        const byIndex = new QuestEngine(data, { storage: save(q.id, { status: 'active', step: i, choices: {} }) }).list().find(v => v.definition.id === q.id)!;
        const byId = new QuestEngine(data, { storage: save(q.id, { status: 'active', step: 99, stepId: old[i], choices: {} }) }).list().find(v => v.definition.id === q.id)!;
        expect(byIndex.step?.id, `${q.id}@${i}`).toBe(old[i]); expect(byId.step?.id, `${q.id}#${old[i]}`).toBe(old[i]);
        expect(byIndex.state?.step).toBe(byId.state?.step);
      }
    }
    const stage = new QuestEngine(data, { storage: save('sea-stage', { status: 'active', step: 1, choices: {} }) }).list().find(v => v.definition.id === 'sea-stage')!;
    expect(stage.step).toMatchObject({ id: 'errand-2', target: 'npc:intl-mia' });
  });
  it('a completed revision-1 save keeps its completion and choice, gets its keepsake once, and keeps the old reward string', () => {
    for (const q of data.quests) {
      const legacy = contract.quests[q.id].reward, storage = save(q.id, { status: 'completed', step: contract.quests[q.id].steps.length, choices: { return: 'b' } }, { rewards: [legacy] });
      let e = new QuestEngine(data, { storage });
      expect(e.list().find(v => v.definition.id === q.id)!.state, q.id).toMatchObject({ status: 'completed', step: q.steps.length, choices: { return: 'b' } });
      // A quest born after the keepsake rewrite (v11 math-freshman) has no older reward string: its contract reward is the current one.
      expect(e.progress.rewards, q.id).toEqual([legacy]); expect(q.legacyRewards ?? [q.reward], q.id).toEqual([legacy]);
      expect(e.grants, q.id).toMatchObject([{ itemId: `item-quest-${q.id}`, variant: 'b' }]);
      expect(e.worksShown(world('day')).map(s => s.spot).sort(), q.id).toEqual((q.works ?? []).filter(w => evalCond(w.if, id => e.flag(id))).map(w => w.spot).sort());
      e.track(undefined); e = new QuestEngine(data, { storage });
      expect(e.grants, q.id).toHaveLength(1);
    }
  });
});
