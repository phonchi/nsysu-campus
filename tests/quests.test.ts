import { describe, expect, it } from 'vitest';
import { QuestEngine, QUEST_KEY, validateQuests, type QuestData, type QuestWorld } from '../src/story/quests';
import { EncounterEngine, type EncounterData } from '../src/story/encounters';
import questData from '../public/data/quests.json';
import encounterData from '../public/data/encounters.json';
const data = questData as QuestData, encounters = encounterData as EncounterData;
const memory = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k,v); }, removeItem: (k: string) => { m.delete(k); } }; };
const world = (target: string, photos = 0): QuestWorld => ({ distanceTo: t => t === target ? 0 : 1e9, timeOfDay: () => 'day', chapterDone: () => true, photoCount: photos });
const accept = (e: QuestEngine, id: string) => { const q = e.data.quests.find(q => q.id === id)!; return e.accept(id, { ...world(q.accept.near), timeOfDay: () => q.steps[0].when ?? 'day' }); };
describe('side quests and persistent journal', () => {
 it('cannot be accepted while a first step at the same NPC is out of its time window', () => {
  const q = data.quests.find(q => q.id === 'sea-stage')!, e = new QuestEngine(data, { storage: memory() });
  expect(e.accept(q.id, world(q.accept.near))).toBe(false);
  expect(e.accept(q.id, { ...world(q.accept.near), timeOfDay: () => 'sunset' })).toBe(true);
 });
 it('validates all thirteen authored quests', () => { expect(data.quests).toHaveLength(13); expect(validateQuests(data)).toEqual([]); });
 it('finishes every choice branch, reloads at every transition and never repeats reward', () => {
  for (const q of data.quests) for (const choice of q.steps.at(-1)!.choices!) {
   const storage = memory(); let engine = new QuestEngine(data, { storage, now: () => 100 });
   expect(accept(engine, q.id)).toBe(true); expect(accept(engine, q.id)).toBe(false);
   for (const step of q.steps) {
    engine = new QuestEngine(data, { storage });
    const atStep={...world(step.target,1),timeOfDay:()=>step.when??'day'};
    if (step.choices) { expect(engine.choose(q.id, choice.id, world('wrong'))).toBe(false); expect(engine.choose(q.id, choice.id, atStep)).toBe(true); }
    else { if (step.kind === 'photo') { expect(engine.interact(q.id, world(step.target))).toBe(false); expect(engine.notifyPhoto(atStep)).toBe(1); } else expect(engine.interact(q.id, atStep)).toBe(true); }
   }
   engine = new QuestEngine(data, { storage });
   expect(engine.progress.quests[q.id].status).toBe('completed'); expect(engine.progress.rewards).toEqual([q.reward]);
   expect(engine.progress.journal).toHaveLength(q.steps.length+1); expect(engine.choose(q.id, choice.id, world(q.steps.at(-1)!.target))).toBe(false);
  }
 });
 it('preserves old saves, imports only known legacy facts and deduplicates', () => {
  const storage = memory(); storage.setItem('nsysu-campus-v4','old player');
  const engine = new QuestEngine(data,{storage}); engine.importLegacy(['chapter1'],['s1']); engine.importLegacy(['chapter1'],['s1']);
  expect(engine.progress.journal).toHaveLength(2); expect(storage.getItem('nsysu-campus-v4')).toBe('old player'); engine.clear(); expect(engine.progress.journal).toEqual([]); expect(storage.getItem('nsysu-campus-v4')).toBe('old player');
 });
 it('rejects malformed states, survives corrupt JSON and reports failed storage', () => {
  const storage = memory(); storage.setItem(QUEST_KEY, JSON.stringify({quests:{[data.quests[0].id]:{status:'active',step:-1}}})); expect(new QuestEngine(data,{storage}).list()[0].state).toBeUndefined();
  let errors=0; storage.setItem(QUEST_KEY,'{'); const e = new QuestEngine(data,{storage,onStorageError:()=>errors++}); expect(errors).toBe(1);
  const failing = { ...storage, setItem:()=> {throw Error('quota');} }; const f = new QuestEngine(data,{storage:failing,onStorageError:()=>errors++}); accept(f, data.quests[0].id); expect(f.progress.quests[data.quests[0].id].status).toBe('active'); expect(errors).toBeGreaterThan(1); expect(e.progress.journal).toEqual([]);
 });
});
describe('joyful encounters', () => {
 it('six authored kinds accept, require proximity and produce persistent results', () => {
  expect(encounters.encounters).toHaveLength(6);
  for (const d of encounters.encounters) {
   const journal = new QuestEngine(data,{storage:memory()}); const e = new EncounterEngine(encounters,{record: entry=>journal.record(entry)});
   e.offer(d.id); expect(e.accept()).toBe(true); expect(e.interact(world('wrong'))).toBe(false); expect(e.interact(world(d.target))).toBe(true); expect(e.active).toBeUndefined(); expect(journal.progress.journal[0].result).toBe(d.success);
  }
 });
 it('pauses offers and countdowns, enforces probability and cooldown', () => {
  const d = encounters.encounters[0], w = world(`zone:${d.zone}`), e = new EncounterEngine(encounters,{random:()=>0});
  e.update(100,w,true); expect(e.active).toBeUndefined(); e.update(30,w); expect(e.active).toBeDefined(); e.accept(); const remaining = e.active!.remaining; e.update(100,w,true); expect(e.active!.remaining).toBe(remaining); e.giveUp(); e.update(30,w); expect(e.active).toBeUndefined();
  const never = new EncounterEngine(encounters,{random:()=>.9}); never.update(30,w); expect(never.active).toBeUndefined();
 });
 it('misses and abandoned events cannot remove preexisting rewards', () => {
  const journal = new QuestEngine(data,{storage:memory()}); journal.progress.rewards.push('既有收藏');
  const e = new EncounterEngine(encounters,{record:x=>journal.record(x)}); e.offer(encounters.encounters[0].id); e.accept(); e.update(100,world('wrong')); expect(journal.progress.rewards).toEqual(['既有收藏']); expect(journal.progress.journal[0].result).toBe(encounters.encounters[0].giveUp);
 });
});
describe('review regressions',()=>{
 it('snapshots legacy once and never relabels new progress after reload',()=>{
  const storage=memory();let e=new QuestEngine(data,{storage});e.importLegacy(['old'],['old-npc']);e=new QuestEngine(data,{storage});e.importLegacy(['old','new'],['new-npc']);expect(e.progress.journal.map(x=>x.id)).toEqual(['legacy:old','legacy:npc:old-npc']);
  e.clear();e=new QuestEngine(data,{storage});e.importLegacy(['new'],['new-npc']);expect(e.progress.journal).toHaveLength(0);
 });
 it('does not fabricate legacy for an existing v5 save lacking a migration marker',()=>{
  const storage=memory();storage.setItem(QUEST_KEY,JSON.stringify({version:1,quests:{},journal:[],rewards:[]}));const e=new QuestEngine(data,{storage});e.importLegacy(['new'],[]);expect(e.progress.journal).toHaveLength(0);
 });
 it('only accepts a photo at the shutter instant in the right location and time',()=>{
  const q=data.quests.find(q=>q.steps[0].kind==='photo')!;const local:QuestData={version:1,quests:[{...q,accept:{...q.accept,times:['sunset']},steps:[{...q.steps[0],when:'sunset'},q.steps[1]]}]};const storage=memory();let e=new QuestEngine(local,{storage});accept(e, q.id);
  const correct={...world(q.steps[0].target,7),timeOfDay:()=> 'sunset'};
  e.update(correct);expect(e.progress.quests[q.id].step).toBe(0);
  expect(e.notifyPhoto(world('wrong',8))).toBe(0);expect(e.notifyPhoto(world(q.steps[0].target,9))).toBe(0);
  e=new QuestEngine(local,{storage});e.update(correct);expect(e.progress.quests[q.id].step).toBe(0);expect(e.interact(q.id,correct)).toBe(false);
  expect(e.notifyPhoto(correct)).toBe(1);e=new QuestEngine(local,{storage});expect(e.progress.quests[q.id].step).toBe(1);
 });
 it('unaccepted and unsafe offers do not journal or consume cooldown; active abandonment does',()=>{
  const records:unknown[]=[];const e=new EncounterEngine(encounters,{record:x=>records.push(x),random:()=>0});const d=encounters.encounters[0];
  e.offer(d.id);expect(e.cancelOffer()).toBe(true);expect(records).toHaveLength(0);
  e.offer(d.id);expect(e.offerSceneFailed()).toBe(true);expect(records).toHaveLength(0);
  e.update(30,world('zone:'+d.zone));expect(e.active).toBeDefined();e.giveUp();expect(records).toHaveLength(0);
  e.offer(d.id);e.accept();e.giveUp();expect(records).toHaveLength(1);e.update(30,world('zone:'+d.zone));expect(e.active).toBeUndefined();
 });
});
describe('stable step ids (v10)', () => {
 const legacySave = (id: string, step: number) => { const storage = memory(); storage.setItem(QUEST_KEY, JSON.stringify({ version: 1, quests: { [id]: { status: 'active', step, choices: {} } }, journal: [], rewards: [] })); return storage; };
 const local = (steps: string[], extra: Partial<QuestData['quests'][number]> = {}): QuestData => ({ version: 1, quests: [{ id: 'q', title: 'Q', zone: 'gate', npc: 'guide', description: '', reward: 'r', accept: { near: 'npc:guide' }, ...extra, steps: steps.map((id, i) => ({ id, target: `spot:${id}`, text: id, ...(i === steps.length - 1 ? { choices: [{ id: 'a', label: 'a', result: 'a' }, { id: 'b', label: 'b', result: 'b' }] } : {}) })) }] });
 it('a revision-1 save at every step position of every quest lands on the step with that id', () => {
  const contract = data.saveContract!;
  expect(Object.keys(contract.quests).sort()).toEqual(data.quests.map(q => q.id).sort());
  for (const q of data.quests) {
   const old = contract.quests[q.id].steps;
   for (let i = 0; i < old.length; i++) {
    const e = new QuestEngine(data, { storage: legacySave(q.id, i) }), v = e.list().find(v => v.definition.id === q.id)!;
    expect(v.step?.id, `${q.id}@${i}`).toBe(old[i]);
    expect(v.state).toMatchObject({ status: 'active', stepId: old[i], revision: q.revision ?? 1 });
    expect(e.progress.journal).toEqual([]);
   }
   if ((q.revision ?? 1) > 1 && q.steps.map(s => s.id).join() !== old.join()) expect(q.legacyStepOrder).toEqual(old);
  }
 });
 it('the save carries stepId and revision, and a reload follows the id when steps have moved', () => {
  const storage = memory(), before = local(['a', 'b', 'c', 'return']);
  let e = new QuestEngine(before, { storage });
  expect(e.accept('q', world('npc:guide'))).toBe(true);
  expect(e.interact('q', world('spot:a'))).toBe(true);
  expect(JSON.parse(storage.getItem(QUEST_KEY)!).quests.q).toMatchObject({ step: 1, stepId: 'b', revision: 1 });
  const after = local(['a', 'c', 'b', 'return'], { revision: 2, legacyStepOrder: ['a', 'b', 'c', 'return'] });
  e = new QuestEngine(after, { storage });
  expect(e.list()[0].step?.id).toBe('b'); expect(e.list()[0].state?.step).toBe(2);
  expect(JSON.parse(storage.getItem(QUEST_KEY)!).quests.q).toMatchObject({ step: 1 });
  expect(e.interact('q', world('spot:b'))).toBe(true);
  expect(JSON.parse(storage.getItem(QUEST_KEY)!).quests.q).toMatchObject({ step: 3, stepId: 'return', revision: 2 });
  // An index-only save (no stepId) goes through the legacy order of the rewritten quest.
  e = new QuestEngine(after, { storage: legacySave('q', 2) });
  expect(e.list()[0].step?.id).toBe('c'); expect(e.list()[0].state?.step).toBe(1);
 });
 it('a step id that no longer exists restarts the quest at its first step, says so once in the journal, and keeps choices and completion', () => {
  const storage = memory();
  storage.setItem(QUEST_KEY, JSON.stringify({ version: 1, quests: { q: { status: 'active', step: 2, stepId: 'gone', choices: { return: 'b' } } }, journal: [], rewards: [] }));
  const next = local(['a', 'b', 'c', 'return'], { revision: 2 });
  let e = new QuestEngine(next, { storage });
  expect(e.list()[0].state).toMatchObject({ status: 'active', step: 0, stepId: 'a', choices: { return: 'b' } });
  expect(e.progress.journal.map(x => x.id)).toEqual(['q:reset:2']);
  expect(e.progress.journal[0]).toMatchObject({ kind: 'quest', title: 'Q' });
  e = new QuestEngine(next, { storage: legacySave('q', 4) });
  expect(e.list()[0].state?.step).toBe(3);
  const done = memory(); done.setItem(QUEST_KEY, JSON.stringify({ version: 1, quests: { q: { status: 'completed', step: 4, stepId: 'gone', choices: { return: 'a' } } }, journal: [], rewards: ['r'] }));
  e = new QuestEngine(next, { storage: done });
  expect(e.list()[0].state).toMatchObject({ status: 'completed', step: 4, choices: { return: 'a' } }); expect(e.progress.journal).toEqual([]);
 });
 it('validates revisions and legacy orders', () => {
  expect(validateQuests(local(['a', 'return'], { revision: 2, legacyStepOrder: ['return', 'a'] }))).toEqual([]);
  expect(validateQuests(local(['a', 'return'], { legacyStepOrder: ['a', 'return'] }))).toEqual(['legacy order without a rewrite q']);
  expect(validateQuests(local(['a', 'return'], { revision: 2, legacyStepOrder: ['a', 'zz', 'return'] }))).toEqual(['legacy step q/zz no longer exists']);
  expect(validateQuests(local(['a', 'return'], { revision: 0 }))).toEqual(['bad revision q']);
 });
 it('a quest cannot be accepted while someone in its step chain is off campus, and says when it can be', () => {
  const q = data.quests.find(q => q.id === 'sea-stage')!, e = new QuestEngine(data, { storage: memory() });
  const sunset = { ...world(q.accept.near), timeOfDay: () => 'sunset' };
  expect(e.acceptable({ ...sunset, npcPresent: id => id !== 'intl-mia' }).map(v => v.definition.id)).toEqual([]);
  expect(e.accept(q.id, { ...sunset, npcPresent: id => id !== 'intl-mia' })).toBe(false);
  expect(e.missingNpcs(q, { ...sunset, npcPresent: id => id !== 'intl-mia' })).toEqual(['intl-mia']);
  expect(e.availability(q, { ...sunset, npcPresent: id => id !== 'intl-mia' })).toMatchObject({ state: 'npc-away', missing: ['intl-mia'], times: ['sunset'] });
  // v10.2: the authored accept.times answer "when", with or without a schedule to ask.
  expect(e.acceptableTimes(q, sunset)).toEqual(['sunset']);
  expect(e.acceptableTimes(data.quests.find(q => q.id === 'gate-lost')!, { ...sunset, npcPresentAt: (id, time) => !(id === 'guard-chung' && time === 'night') })).toEqual(['day', 'sunset']);
  expect(e.accept(q.id, { ...sunset, npcPresent: () => true })).toBe(true);
 });
});
it('neutralizes unversioned legacy labels without deleting their evidence',()=>{
 const storage=memory();const old={id:'legacy:c1-gate',kind:'legacy',title:'更新前的導覽紀錄',text:'c1-gate：更新前已完成，無詳細經過。',at:123,zone:'gate',npc:'guide',result:'已完成',choice:'原選擇',reward:'原紀念'};
 storage.setItem(QUEST_KEY,JSON.stringify({version:1,quests:{},journal:[old],rewards:['原紀念']}));const e=new QuestEngine(data,{storage});e.importLegacy(['c1-gate','new'],[]);
 expect(e.progress.journal).toHaveLength(1);expect(e.progress.journal[0]).toEqual({...old,title:'過往進度',text:'來源版本未記錄，無詳細經過。'});expect(e.progress.legacySnapshotTaken).toBe(true);
 const reload=new QuestEngine(data,{storage});expect(reload.progress.journal[0]).toEqual(e.progress.journal[0]);
});
