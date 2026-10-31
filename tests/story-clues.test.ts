/** Campus-history clues for the journal (spec-v7 Lane B): unlocked `story-*` side quests, done once the
 * matching campus-info story was collected. */
import { beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { campusClues } from '../src/story/clues';
import { StoryEngine, type StoryEffects, type StoryWorld } from '../src/story/engine';
import type { StoryData } from '../src/story/schema';

const data = JSON.parse(fs.readFileSync('public/data/chapters.json', 'utf8')) as StoryData;
const info = JSON.parse(fs.readFileSync('public/data/campus-info.json', 'utf8')) as { stories: { id: string }[] };

beforeEach(() => { (globalThis as { localStorage?: unknown }).localStorage = undefined; });

describe('campusClues', () => {
  it('lists only unlocked clues, in chapter order, with done from the collected campus stories', () => {
    const clues = campusClues(['story-tunnel', 'story-sunset'], new Set(['tunnel']), data);
    expect(clues).toEqual([
      { id: 'story-sunset', title: '海堤的兩人座', hint: '校碑旁的海堤，找一個凹進去的位子。', done: false },
      { id: 'story-tunnel', title: '洞口的回音', hint: '回到隧道校園側的洞口看看拱圈。', done: true },
    ]);
  });

  it('accepts any iterable of collected ids and ignores unknown or duplicate unlocks', () => {
    expect(campusClues([], [], data)).toEqual([]);
    expect(campusClues(['nope', 'story-lions', 'story-lions'], ['lions', 'ghost'], data).map(c => `${c.id}:${c.done}`)).toEqual(['story-lions:true']);
  });

  it('every shipped side quest maps to a campus-info story, so collecting all gems completes all clues', () => {
    const all = campusClues(data.sideQuests.map(q => q.id), info.stories.map(s => s.id), data);
    expect(all.length).toBe(data.sideQuests.length);
    expect(all.every(c => c.done)).toBe(true);
    expect(campusClues(data.sideQuests.map(q => q.id), [], data).every(c => !c.done)).toBe(true);
  });

  it('follows the engine: finishing chapter 1 unlocks the seawall clue, nothing is done until the gem is read', () => {
    const world: StoryWorld = { distanceTo: () => 0, inZone: () => false, atDestination: () => false, timeOfDay: () => 'day' };
    const fx: StoryEffects = { dialogue: (_l, done) => done(), setObjective: () => {}, showArrow: () => {}, setSky: () => {}, playSound: () => {}, moveNpc: () => {}, chapterComplete: () => {}, chapterStart: () => {}, unlockSideQuest: () => {} };
    const engine = new StoryEngine(data, world, fx);
    expect(campusClues(engine.progress.sideQuests, [], data)).toEqual([]);
    engine.update(); engine.press(); engine.update();
    expect(engine.progress.done).toEqual(['c1-gate']);
    expect(campusClues(engine.progress.sideQuests, [], data).map(c => [c.id, c.done])).toEqual([['story-sunset', false]]);
    expect(campusClues(engine.progress.sideQuests, ['sunset'], data).map(c => [c.id, c.done])).toEqual([['story-sunset', true]]);
  });
});
