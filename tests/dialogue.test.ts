import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { runTalk, entryNode, validateTrees, choicesOf, type Facts, type Tree, type Effect, type TalkIO } from '../src/story/dialogue';
import { normalizeCampus, cleanNickname } from '../src/story/collection';

const facts = (flags: string[] = [], extra: Partial<Facts> = {}): Facts => ({
  flag: f => flags.includes(f), hasItem: () => false, stamps: () => 0, chapterDone: () => false, timeOfDay: () => 'day', count: () => 0, ...extra,
});
const cat = { npcs: ['kai'], items: ['cup'], stamps: ['s'], achievements: ['a'], sideQuests: ['story-zoo'], chapters: ['c1-gate'], storyFlags: ['c1.talked'], sounds: ['chime'] };
const tree: Tree = {
  entries: [{ if: { flag: 'kai.met' }, node: 'again' }, { node: 'first' }],
  nodes: {
    first: { lines: [{ who: 'kai', text: '要喝咖啡嗎？' }], effects: [{ setFlag: 'kai.met' }], choices: [
      { text: '好', next: 'buy', effects: [{ giveItem: 'cup' }] },
      { text: '不用', next: 'bye' },
      { text: '考我', if: { flag: 'kai.quiz' }, next: 'bye' },
    ] },
    buy: { lines: [{ who: 'kai', text: '請慢用。' }] },
    bye: { lines: [{ who: 'kai', text: '下次見。' }], effects: [{ setFlag: 'kai.quiz' }] },
    again: { lines: [{ who: 'kai', text: '又是你。' }], effects: [{ startMinigame: 'history-quiz', win: 'buy', lose: 'bye' }] },
  },
};

/** Scripted IO: picks choices in order, records shown lines and applied effects. */
function io(picks: number[]) {
  const shown: string[] = [], applied: Effect[] = [];
  const t: TalkIO = { say: async l => { shown.push(...l.map(x => x.text)); }, choose: async () => picks.shift() ?? 0, apply: e => { applied.push(e); } };
  return { t, shown, applied };
}

describe('dialogue trees', () => {
  it('validates the sample tree', () => expect(validateTrees({ kai: tree }, { kai: 'kai' }, cat)).toEqual([]));
  it('enters at the first entry whose condition holds', () => {
    expect(entryNode(tree, facts())).toBe('first');
    expect(entryNode(tree, facts(['kai.met']))).toBe('again');
  });
  it('hides conditional choices', () => {
    expect(choicesOf(tree.nodes.first, facts()).map(c => c.text)).toEqual(['好', '不用']);
    expect(choicesOf(tree.nodes.first, facts(['kai.quiz'])).length).toBe(3);
  });
  it('plays lines, applies node and choice effects, follows the pick', async () => {
    const r = io([0]);
    expect(await runTalk(tree, 'first', facts(), r.t)).toBeUndefined();
    expect(r.shown).toEqual(['要喝咖啡嗎？', '請慢用。']);
    expect(r.applied).toEqual([{ setFlag: 'kai.met' }, { giveItem: 'cup' }]);
  });
  it('returns a minigame request from a terminal node', async () => {
    const r = io([]);
    expect(await runTalk(tree, 'again', facts(['kai.met']), r.t)).toEqual({ startMinigame: 'history-quiz', win: 'buy', lose: 'bye' });
  });
  it('rejects cycles, missing nodes, foreign flags, minigames on choices and an all-conditional choice list', () => {
    const bad: Tree = { entries: [{ node: 'a' }], nodes: {
      a: { lines: [{ who: 'kai', text: 'a' }], effects: [{ setFlag: 'c1.talked' }], choices: [{ text: 'x', next: 'b', if: { flag: 'kai.x' } }, { text: 'y', next: 'zz', if: { flag: 'kai.y' }, effects: [{ startMinigame: 'history-quiz', win: 'a', lose: 'a' }] }] },
      b: { lines: [{ who: 'kai', text: 'b' }], next: 'a' },
    } };
    const errs = validateTrees({ kai: bad }, { kai: 'kai' }, cat).join('\n');
    for (const s of ['cycle', 'missing zz', 'must start with', 'story flag', 'startMinigame only', 'every choice is conditional', 'never set']) expect(errs).toContain(s);
  });
});

describe('v4 progress store', () => {
  it('normalizes garbage and keeps valid fields', () => {
    const p = normalizeCampus({ flags: ['a', 'a', 3], counters: { x: 2, y: -1, z: 'q' }, player: { body: 'f', palette: 9, nickname: '<阿明>{x}' }, games: { q: { best: 4, wins: 1, plays: 'x' } } });
    expect(p.flags).toEqual(['a']);
    expect(p.counters).toEqual({ x: 2 });
    expect(p.player).toEqual({ body: 'f', palette: 0, nickname: '阿明x' });
    expect(p.games.q).toEqual({ best: 4, wins: 1, plays: 0 });
  });
  it('limits nicknames to 8 characters', () => expect(cleanNickname('一二三四五六七八九十')).toBe('一二三四五六七八'));
});

describe('shipped NPC data', () => {
  const path = 'public/data/npcs.json';
  it.skipIf(!fs.existsSync(path))('every branch of every NPC ends, under several flag states', async () => {
    const data = JSON.parse(fs.readFileSync(path, 'utf8')) as { trees: Record<string, Tree> };
    const states: Facts[] = [facts(), facts([], { chapterDone: () => true, stamps: () => 20, count: () => 99 })];
    for (const [id, t] of Object.entries(data.trees)) {
      states.push(facts(Object.values(t.nodes).flatMap(n => [...(n.effects ?? []), ...(n.choices ?? []).flatMap(c => c.effects ?? [])]).filter((e): e is { setFlag: string } => 'setFlag' in e).map(e => e.setFlag)));
      void id;
    }
    for (const [id, t] of Object.entries(data.trees)) for (const f of states) {
      // Explore every choice path from every entry (DAG, so bounded).
      const starts = new Set([entryNode(t, f)!, ...Object.values(t.nodes).flatMap(n => (n.effects ?? []).flatMap(e => 'startMinigame' in e ? [e.win, e.lose] : []))]);
      for (const start of starts) {
        const stack: number[][] = [[]];
        let runs = 0;
        while (stack.length && runs < 400) {
          const prefix = stack.pop()!; runs++;
          let depth = 0;
          const r = io([...prefix]);
          r.t.choose = async ch => { const k = prefix[depth] ?? 0; if (depth === prefix.length) for (let j = 1; j < ch.length; j++) stack.push([...prefix, j]); depth++; return k; };
          await expect(runTalk(t, start, f, r.t), `${id} from ${start}`).resolves.not.toThrow;
          expect(r.shown.length, `${id} from ${start} shows lines`).toBeGreaterThan(0);
        }
      }
    }
  });
});
