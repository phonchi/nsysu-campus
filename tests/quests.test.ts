import { describe, expect, it } from 'vitest';
import { QuestEngine, QUEST_KEY, validateQuests, type QuestData, type QuestWorld } from '../src/story/quests';
import { EncounterEngine, type EncounterData } from '../src/story/encounters';
import questData from '../public/data/quests.json';
import encounterData from '../public/data/encounters.json';
const data = questData as QuestData, encounters = encounterData as EncounterData;
const memory = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k,v); }, removeItem: (k: string) => { m.delete(k); } }; };
const world = (target: string, photos = 0): QuestWorld => ({ distanceTo: t => t === target ? 0 : 1e9, timeOfDay: () => 'day', photoCount: photos });
describe('side quests and persistent journal', () => {
 it('validates all twelve authored quests', () => { expect(data.quests).toHaveLength(12); expect(validateQuests(data)).toEqual([]); });
 it('finishes every choice branch, reloads at every transition and never repeats reward', () => {
  for (const q of data.quests) for (const choice of q.steps.at(-1)!.choices!) {
   const storage = memory(); let engine = new QuestEngine(data, { storage, now: () => 100 });
   expect(engine.accept(q.id)).toBe(true); expect(engine.accept(q.id)).toBe(false);
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
  const failing = { ...storage, setItem:()=> {throw Error('quota');} }; const f = new QuestEngine(data,{storage:failing,onStorageError:()=>errors++}); f.accept(data.quests[0].id); expect(f.progress.quests[data.quests[0].id].status).toBe('active'); expect(errors).toBeGreaterThan(1); expect(e.progress.journal).toEqual([]);
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
  const q=data.quests.find(q=>q.steps[0].kind==='photo')!;const local:QuestData={version:1,quests:[{...q,steps:[{...q.steps[0],when:'sunset'},q.steps[1]]}]};const storage=memory();let e=new QuestEngine(local,{storage});e.accept(q.id);
  const correct={...world(q.steps[0].target,7),timeOfDay:()=> 'sunset'};
  e.update(correct);expect(e.progress.quests[q.id].step).toBe(0);
  expect(e.notifyPhoto(world('wrong',8))).toBe(0);expect(e.notifyPhoto(world(q.steps[0].target,9))).toBe(0);
  e=new QuestEngine(local,{storage});e.update(correct);expect(e.progress.quests[q.id].step).toBe(0);expect(e.interact(q.id,correct)).toBe(false);
  expect(e.notifyPhoto(correct)).toBe(1);e=new QuestEngine(local,{storage});expect(e.progress.quests[q.id].step).toBe(1);
 });
 it('does not let area/photo quests steal ordinary NPC E candidates',()=>{
  const e=new QuestEngine(data,{storage:memory()});const photo=data.quests.find(q=>q.steps[0].kind==='photo')!;e.accept(photo.id);expect(e.candidate(world(photo.steps[0].target))).toBeUndefined();
  const zone={...data.quests[0],id:'zone-fixture',steps:[{id:'zone-step',target:'zone:gate',text:'check area'},data.quests[0].steps.at(-1)!]};const areas=new QuestEngine({version:1,quests:[zone]},{storage:memory()});areas.accept(zone.id);expect(areas.candidate(world('zone:gate'))).toBeUndefined();expect(areas.candidate(world('zone:gate'),true)?.definition.id).toBe(zone.id);
 });
 it('unaccepted and unsafe offers do not journal or consume cooldown; active abandonment does',()=>{
  const records:unknown[]=[];const e=new EncounterEngine(encounters,{record:x=>records.push(x),random:()=>0});const d=encounters.encounters[0];
  e.offer(d.id);expect(e.cancelOffer()).toBe(true);expect(records).toHaveLength(0);
  e.offer(d.id);expect(e.offerSceneFailed()).toBe(true);expect(records).toHaveLength(0);
  e.update(30,world('zone:'+d.zone));expect(e.active).toBeDefined();e.giveUp();expect(records).toHaveLength(0);
  e.offer(d.id);e.accept();e.giveUp();expect(records).toHaveLength(1);e.update(30,world('zone:'+d.zone));expect(e.active).toBeUndefined();
 });
});
it('neutralizes unversioned legacy labels without deleting their evidence',()=>{
 const storage=memory();const old={id:'legacy:c1-gate',kind:'legacy',title:'更新前的導覽紀錄',text:'c1-gate：更新前已完成，無詳細經過。',at:123,zone:'gate',npc:'guide',result:'已完成',choice:'原選擇',reward:'原紀念'};
 storage.setItem(QUEST_KEY,JSON.stringify({version:1,quests:{},journal:[old],rewards:['原紀念']}));const e=new QuestEngine(data,{storage});e.importLegacy(['c1-gate','new'],[]);
 expect(e.progress.journal).toHaveLength(1);expect(e.progress.journal[0]).toEqual({...old,title:'過往進度',text:'來源版本未記錄，無詳細經過。'});expect(e.progress.legacySnapshotTaken).toBe(true);
 const reload=new QuestEngine(data,{storage});expect(reload.progress.journal[0]).toEqual(e.progress.journal[0]);
});
