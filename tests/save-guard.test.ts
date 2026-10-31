import fc from 'fast-check';
import { beforeEach, describe, expect, it } from 'vitest';
import { QuestEngine, QUEST_KEY, type QuestData } from '../src/story/quests';
import { SAVE_VERSION, backupKey, lockedSaves, readSave, removeSave, writeSave, type SaveStorage } from '../src/story/save-guard';

const memory = (seed: Record<string, string> = {}): Required<SaveStorage> & { seed: Record<string, string> } => ({ seed, getItem: k => seed[k] ?? null, setItem: (k, v) => { seed[k] = v; }, removeItem: k => { delete seed[k]; } });
const KEY = 'test-save';

describe('save guard', () => {
  beforeEach(() => removeSave(memory(), KEY));
  it('reads saves from before versioning', () => {
    const s = memory({ [KEY]: JSON.stringify({ done: ['c1'] }) });
    expect(readSave(s, KEY)).toMatchObject({ value: { done: ['c1'] }, existed: true, locked: false, corrupt: false });
  });
  it('never overwrites a save from a newer build', () => {
    const newer = JSON.stringify({ saveVersion: SAVE_VERSION + 1, shape: 'future' }), s = memory({ [KEY]: newer });
    expect(readSave(s, KEY)).toMatchObject({ locked: true });
    expect(readSave(s, KEY).value).toBeUndefined();
    expect(lockedSaves()).toContain(KEY);
    expect(writeSave(s, KEY, { done: [] })).toBe(false);
    expect(s.seed[KEY]).toBe(newer);
    expect(s.seed[backupKey(KEY)]).toBeUndefined();
  });
  it('a deliberate wipe releases the lock', () => {
    const s = memory({ [KEY]: JSON.stringify({ saveVersion: SAVE_VERSION + 1 }) });
    readSave(s, KEY); removeSave(s, KEY);
    expect(writeSave(s, KEY, { a: 1 })).toBe(true);
  });
  it('recovers the last good save after a corrupt write', () => {
    const s = memory();
    writeSave(s, KEY, { n: 1 }); writeSave(s, KEY, { n: 2 });
    s.seed[KEY] = '{broken';
    expect(readSave(s, KEY)).toMatchObject({ value: { n: 1 }, corrupt: true, recovered: true });
  });
  it('does not replace a good backup with a corrupt save', () => {
    const s = memory();
    writeSave(s, KEY, { n: 1 }); writeSave(s, KEY, { n: 2 });
    s.seed[KEY] = '{broken';
    writeSave(s, KEY, { n: 3 });
    expect(JSON.parse(s.seed[backupKey(KEY)])).toMatchObject({ n: 1 });
    expect(readSave(s, KEY)).toMatchObject({ value: { n: 3 }, corrupt: false });
  });
  it('still saves when the backup does not fit', () => {
    const s = memory({ [KEY]: JSON.stringify({ n: 1 }) }), set = s.setItem;
    s.setItem = (k, v) => { if (k === backupKey(KEY)) throw Error('quota'); set(k, v); };
    expect(writeSave(s, KEY, { n: 2 })).toBe(true);
    expect(JSON.parse(s.seed[KEY])).toMatchObject({ n: 2 });
  });
  it('any write sequence reads back as the last write, and any corruption as a recent one', () => {
    fc.assert(fc.property(fc.array(fc.integer(), { minLength: 1, maxLength: 12 }), fc.boolean(), (writes, corrupt) => {
      const s = memory();
      for (const n of writes) writeSave(s, KEY, { n });
      const last = writes.at(-1)!;
      if (!corrupt) { expect(readSave(s, KEY).value).toMatchObject({ n: last }); return; }
      s.seed[KEY] = '{broken';
      const read = readSave(s, KEY);
      if (writes.length === 1) expect(read.recovered).toBe(false);
      else expect(read.value).toMatchObject({ n: writes.at(-2)! });
    }));
  });
});

describe('quest save', () => {
  const data = { version: 1, quests: [{ id: 'q', title: 'q', zone: 'gate', npc: 'guide', description: '', reward: 'r', accept: { near: 'npc:guide' }, steps: [{ id: 's', target: 'npc:guide', text: 't' }] }] } as unknown as QuestData;
  it('leaves a newer quest save untouched while still playable', () => {
    const newer = JSON.stringify({ saveVersion: SAVE_VERSION + 1, quests: { q: { status: 'completed', step: 1 } } }), s = memory({ [QUEST_KEY]: newer });
    const e = new QuestEngine(data, { storage: s });
    e.track('q');
    expect(s.seed[QUEST_KEY]).toBe(newer);
    removeSave(s, QUEST_KEY);
  });
  it('recovers accepted quests from the backup', () => {
    const s = memory();
    const e = new QuestEngine(data, { storage: s });
    e.track('q'); e.track('q');
    s.seed[QUEST_KEY] = '{';
    let errors = 0;
    const recovered = new QuestEngine(data, { storage: s, onStorageError: () => errors++ });
    expect(errors).toBe(0);
    expect(recovered.progress.tracked).toBe('q');
  });
});
