import { expect, it } from 'vitest';
import fc from 'fast-check';
import { QuestEngine, QUEST_KEY, type QuestData, type QuestWorld } from '../src/story/quests';
import authored from '../public/data/quests.json';
const data = authored as QuestData;
const memory = () => { let raw: string | null = null; return { getItem: () => raw, setItem: (_: string, v: string) => { raw = v; }, removeItem: () => { raw = null; } }; };
const at = (target: string, done = true, time = 'day'): QuestWorld => ({ distanceTo: t => t === target ? 0 : Infinity, chapterDone: () => done, timeOfDay: () => time });
it('requires completed chapter and live proximity; discovery tracking persists without accepting', () => {
 const storage = memory(); let e = new QuestEngine(data, { storage }); const q = data.quests[0];
 expect(e.accept(q.id)).toBe(false);
 expect(e.acceptable(at(q.accept.near, false))).toEqual([]);
 expect(e.accept(q.id, at(q.accept.near, false))).toBe(false);
 expect(e.accept(q.id, at('zone:gate'))).toBe(false);
 expect(e.track(q.id)).toBe(true); e = new QuestEngine(data, { storage });
 expect(e.progress.tracked).toBe(q.id); expect(e.progress.quests).toEqual({});
 expect(e.acceptable(at(q.accept.near)).some(v => v.definition.id === q.id)).toBe(true);
 expect(e.accept(q.id, at(q.accept.near))).toBe(true);
 expect(e.acceptable(at(q.accept.near)).some(v => v.definition.id === q.id)).toBe(false);
});
it('retains every old accepted step and choice even before the new gate is complete', () => {
 for (const q of data.quests) for (let step = 0; step < q.steps.length; step++) {
  const storage = memory(); storage.setItem(QUEST_KEY, JSON.stringify({ version: 1, quests: { [q.id]: { status: 'active', step, choices: {} } }, journal: [], rewards: [] }));
  const e = new QuestEngine(data, { storage }); const s = q.steps[step], w = at(s.target, false, s.when ?? 'day');
  expect(e.list().find(v => v.definition.id === q.id)?.state?.step).toBe(step);
  if (s.choices) expect(e.choose(q.id, s.choices[0].id, w)).toBe(true);
  else if (s.kind === 'photo') expect(e.notifyPhoto(w)).toBe(1);
  else expect(e.interact(q.id, w)).toBe(true);
 }
});
it('random acceptance, interactions, choices, reloads and time changes preserve progress invariants', () => {
 fc.assert(fc.property(fc.array(fc.record({ op: fc.integer({ min: 0, max: 6 }), q: fc.integer({ min: 0, max: 11 }), time: fc.constantFrom('day', 'sunset', 'night'), near: fc.boolean(), done: fc.boolean() }), { maxLength: 120 }), actions => {
  const storage = memory(); let e = new QuestEngine(data, { storage });
  const previous = new Map<string, number>();
  for (const a of actions) {
   const q = data.quests[a.q], s = e.list()[a.q].step;
   const w = at(a.near ? (a.op === 0 ? q.accept.near : s?.target ?? '') : 'wrong', a.done, a.time);
   switch (a.op) {
    case 0: e.accept(q.id, w); break;
    case 1: e.interact(q.id, w); break;
    case 2: e.choose(q.id, 'a', w); break;
    case 3: e.notifyPhoto(w); break;
    case 4: e = new QuestEngine(data, { storage }); break;
    case 5: e.track(q.id); break;
    case 6: e.update(w); break;
   }
   for (const v of e.list()) if (v.state) {
    const n = v.state.step;
    expect(n).toBeGreaterThanOrEqual(previous.get(v.definition.id) ?? 0);
    expect(n).toBeLessThanOrEqual(v.definition.steps.length);
    expect(v.state.status === 'completed').toBe(n === v.definition.steps.length);
    previous.set(v.definition.id, n);
    for (const [sid, cid] of Object.entries(v.state.choices)) expect(v.definition.steps.find(x => x.id === sid)?.choices?.some(x => x.id === cid)).toBe(true);
   }
   expect(new Set(e.progress.rewards).size).toBe(e.progress.rewards.length);
   expect(new Set(e.progress.journal.map(x => x.id)).size).toBe(e.progress.journal.length);
  }
 }), { seed: 71031, numRuns: 100 });
});
