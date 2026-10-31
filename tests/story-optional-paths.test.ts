/** Optional story beats stay reachable on a fresh save (spec-v7 Lane B): c1 小禾 (`freshman`), c5 猴學長 (`monkey`)
 * and c6 night (`night`) each fire on a path that also finishes the tour, and skipping them still finishes it.
 * The c1 conversation is also reachable after reporting through 小禾's talk tree, without repeating itself. */
import { beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { StoryEngine, type StoryEffects, type StoryWorld } from '../src/story/engine';
import type { Condition, StoryData } from '../src/story/schema';
import { entryNode, runTalk, type Facts, type Tree } from '../src/story/dialogue';

const data = JSON.parse(fs.readFileSync('public/data/chapters.json', 'utf8')) as StoryData;
const npcs = JSON.parse(fs.readFileSync('public/data/npcs.json', 'utf8')) as { trees: Record<string, Tree> };
const OPTIONAL = new Set(['freshman', 'monkey', 'night']);

class FakeWorld implements StoryWorld {
  at = ''; zone = ''; dest = ''; time = 'day';
  distanceTo(t: string) { return t === this.at ? 0 : 99; }
  inZone(z: string) { return z === this.zone; }
  atDestination(c: string) { return c === this.dest; }
  timeOfDay() { return this.time; }
  satisfy(c: Condition) {
    if ('near' in c) this.at = c.near;
    if ('inZone' in c) this.zone = c.inZone;
    if ('atDestination' in c) this.dest = c.atDestination;
    if ('timeOfDay' in c) this.time = c.timeOfDay;
  }
}

function effects(log: string[]): StoryEffects {
  return {
    dialogue: (lines, done) => { log.push(`dialogue:${lines[0].text}`); done(); },
    setObjective: () => {}, showArrow: () => {}, setSky: s => log.push(`sky:${s}`), playSound: () => {}, moveNpc: () => {},
    chapterComplete: c => log.push(`complete:${c.id}`), chapterStart: c => log.push(`start:${c.id}`), unlockSideQuest: id => log.push(`side:${id}`),
  };
}

/** Drive the main line only (optional steps untouched) until `chapter` is active and its `until` step has fired. */
function mainLineTo(engine: StoryEngine, world: FakeWorld, chapter: string, until: string) {
  for (let guard = 0; guard < 200; guard++) {
    engine.update();
    const ch = engine.active;
    if (!ch) continue;
    const fired = engine.progress.fired[ch.id] ?? [];
    if (ch.id === chapter && fired.includes(until)) return;
    const step = ch.steps.find(s => !OPTIONAL.has(s.id) && !fired.includes(s.id) && s.when.every(c => !('flag' in c) || engine.progress.flags.includes(c.flag)));
    if (!step) continue;
    step.when.forEach(c => world.satisfy(c));
    if (step.when.some(c => 'press' in c)) engine.press(); else engine.update();
  }
  throw new Error(`never reached ${chapter}.${until}`);
}

const fired = (e: StoryEngine, ch: string) => e.progress.fired[ch] ?? [];
const lines = (id: string) => data.dialogues[id].filter(l => l.who !== 'narrator');

/** Facts the way TalkDirector builds them: story flags plus the talk tree's own flags. */
function facts(engine: StoryEngine, talkFlags: string[]): Facts {
  return {
    flag: f => engine.progress.flags.includes(f) || talkFlags.includes(f),
    hasItem: () => false, stamps: () => 0, chapterDone: c => engine.progress.done.includes(c), timeOfDay: () => 'day', count: () => 0,
  };
}

beforeEach(() => { (globalThis as { localStorage?: unknown }).localStorage = undefined; });

describe('c1 小禾 (optional freshman step)', () => {
  it('fires before reporting to the guide, sets c1.s1, and the chapter still completes', () => {
    const world = new FakeWorld(), log: string[] = [], engine = new StoryEngine(data, world, effects(log));
    engine.update();
    world.at = 'npc:s1';
    expect(engine.canPress()).toBe(true); // the story owns E here, small talk never pre-empts it
    expect(engine.press()).toBe(true);
    expect(fired(engine, 'c1-gate')).toContain('freshman');
    expect(engine.progress.flags).toContain('c1.s1');
    expect(log).toContain(`dialogue:${lines('c1-s1')[0].text}`);
    expect(engine.progress.done).toEqual([]);
    world.at = 'npc:guide'; engine.press(); engine.update();
    expect(engine.progress.done).toEqual(['c1-gate']);
    engine.update(); // the next chapter starts on the following tick
    expect(engine.active?.id).toBe('c2-tunnel');
  });

  it('is skippable: reporting first ends the chapter and the step can no longer fire', () => {
    const world = new FakeWorld(), engine = new StoryEngine(data, world, effects([]));
    mainLineTo(engine, world, 'c2-tunnel', 'arrow');
    expect(fired(engine, 'c1-gate')).not.toContain('freshman');
    expect(engine.progress.flags).not.toContain('c1.s1');
    world.at = 'npc:s1';
    expect(engine.canPress()).toBe(false); // E now falls through to 小禾's talk tree
    expect(engine.press()).toBe(false);
  });

  it('after reporting, 小禾 tells the same story once through her talk tree, then moves on', async () => {
    const world = new FakeWorld(), engine = new StoryEngine(data, world, effects([]));
    mainLineTo(engine, world, 'c2-tunnel', 'arrow');
    const tree = npcs.trees.s1, talkFlags: string[] = [];
    const f = facts(engine, talkFlags);
    expect(entryNode(tree, f)).toBe('gate-late');
    const said: string[] = [];
    await runTalk(tree, 'gate-late', f, {
      say: async ls => { said.push(...ls.map(l => l.text)); },
      choose: async () => 0,
      apply: e => { if ('setFlag' in e) talkFlags.push(e.setFlag); },
    });
    expect(said[0]).toBe(lines('c1-s1')[0].text); // the same opening the in-chapter version uses
    expect(said.some(t => t.includes('行政大樓'))).toBe(true);
    expect(talkFlags).toContain('s1.late');
    expect(entryNode(tree, f)).toBe('gate-root'); // never repeats
  });

  it('does not repeat for a player who already heard it before reporting', () => {
    const world = new FakeWorld(), engine = new StoryEngine(data, world, effects([]));
    engine.update(); world.at = 'npc:s1'; engine.press();
    const tree = npcs.trees.s1;
    expect(entryNode(tree, facts(engine, []))).toBe('gate-waiting'); // pre-report: no "我很熟" after she admitted she is lost
    world.at = 'npc:guide'; engine.press(); engine.update();
    expect(engine.progress.done).toContain('c1-gate');
    expect(entryNode(tree, facts(engine, []))).toBe('gate-root');
  });

  it('a brand-new player who talks to 小禾 first still meets the shy version', () => {
    const engine = new StoryEngine(data, new FakeWorld(), effects([]));
    expect(entryNode(npcs.trees.s1, facts(engine, []))).toBe('gate-shy');
  });
});

describe('c5 猴學長 (optional monkey step)', () => {
  it('fires after the arcade briefing and before the room, and the chapter still completes', () => {
    const world = new FakeWorld(), log: string[] = [], engine = new StoryEngine(data, world, effects(log));
    mainLineTo(engine, world, 'c5-arcade', 'arrive');
    world.at = 'npc:m1'; engine.update();
    expect(fired(engine, 'c5-arcade')).toContain('monkey');
    expect(engine.progress.flags).toContain('c5.monkey');
    expect(log).toContain(`dialogue:${lines('c5-monkey')[0].text}`);
    expect(engine.progress.done).not.toContain('c5-arcade');
    world.dest = 'SC2001'; engine.update();
    expect(engine.progress.done).toContain('c5-arcade');
    expect(log.indexOf(`dialogue:${lines('c5-monkey')[0].text}`)).toBeLessThan(log.indexOf('complete:c5-arcade'));
  });

  it('is skippable: walking straight to SC2001 completes the chapter without it', () => {
    const world = new FakeWorld(), engine = new StoryEngine(data, world, effects([]));
    mainLineTo(engine, world, 'c5-arcade', 'arrive');
    world.dest = 'SC2001'; engine.update();
    expect(engine.progress.done).toContain('c5-arcade');
    expect(fired(engine, 'c5-arcade')).not.toContain('monkey');
  });
});

describe('c6 night (optional night step)', () => {
  it('fires once night falls at the seawall, before sitting down, and the tour still finishes', () => {
    const world = new FakeWorld(), log: string[] = [], engine = new StoryEngine(data, world, effects(log));
    mainLineTo(engine, world, 'c6-sunset', 'arrive');
    expect(log).toContain('sky:sunset');
    engine.update();
    expect(fired(engine, 'c6-sunset')).not.toContain('night'); // sunset: nothing yet
    world.time = 'night'; engine.update();
    expect(fired(engine, 'c6-sunset')).toContain('night');
    expect(log).toContain(`dialogue:${lines('c6-night')[0].text}`);
    expect(engine.finished).toBe(false);
    world.at = 'npc:guide'; expect(engine.press()).toBe(true);
    expect(engine.finished).toBe(true);
  });

  it('is skippable: sitting down at sunset ends the tour without it', () => {
    const world = new FakeWorld(), engine = new StoryEngine(data, world, effects([]));
    mainLineTo(engine, world, 'c6-sunset', 'arrive');
    world.at = 'npc:guide'; engine.press();
    expect(engine.finished).toBe(true);
    expect(fired(engine, 'c6-sunset')).not.toContain('night');
  });
});
