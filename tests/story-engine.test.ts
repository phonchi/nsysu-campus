import { describe, expect, it, beforeEach } from 'vitest';
import fs from 'node:fs';
import { StoryEngine, type StoryEffects, type StoryWorld } from '../src/story/engine';
import { validateStory, type Condition, type StoryData } from '../src/story/schema';

const data = JSON.parse(fs.readFileSync('public/data/chapters.json', 'utf8')) as StoryData;

/** A world where the test teleports the "player" to whatever a condition asks for. */
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
    if ('any' in c) this.satisfy(c.any[0]);
  }
}

function effects(log: string[], auto = true): StoryEffects {
  return {
    dialogue: (lines, done) => { log.push(`dialogue:${lines.length}`); if (auto) done(); },
    setObjective: (_c, t) => log.push(`objective:${t}`),
    showArrow: t => log.push(`arrow:${t}`),
    setSky: s => log.push(`sky:${s}`),
    playSound: s => log.push(`sound:${s}`),
    moveNpc: (n, a) => log.push(`npc:${n}->${a}`),
    chapterComplete: (c, fact, next) => log.push(`complete:${c.id}:${fact ? 'fact' : 'nofact'}:${next?.id ?? 'end'}`),
    chapterStart: c => log.push(`start:${c.id}`),
    unlockSideQuest: id => log.push(`side:${id}`),
  };
}

beforeEach(() => { (globalThis as { localStorage?: unknown }).localStorage = undefined; });

describe('story engine on public/data/chapters.json', () => {
  it('validates', () => { expect(validateStory(data)).toEqual([]); });

  it('plays all six chapters in order, each ending with a verified history note', () => {
    const world = new FakeWorld(), log: string[] = [];
    const engine = new StoryEngine(data, world, effects(log));
    for (let guard = 0; guard < 400 && !engine.finished; guard++) {
      engine.update();
      const ch = engine.active;
      if (!ch) continue;
      const fired = engine.progress.fired[ch.id] ?? [];
      const step = ch.steps.find(s => !fired.includes(s.id) && s.when.every(c => !('flag' in c) || engine.progress.flags.includes(c.flag)));
      if (!step) continue;
      step.when.forEach(c => world.satisfy(c));
      if (step.when.some(c => 'press' in c)) engine.press(); else engine.update();
    }
    expect(engine.finished).toBe(true);
    const completes = log.filter(l => l.startsWith('complete:'));
    expect(completes.map(l => l.split(':')[1])).toEqual(data.chapters.map(c => c.id));
    expect(completes.every(l => l.includes(':fact:'))).toBe(true);
    expect(log).toContain('sky:sunset');
    expect(engine.progress.sideQuests.length).toBeGreaterThan(0);
  });

  it('E is only consumed by a step that needs it, and never while a dialogue is open', () => {
    const world = new FakeWorld(), log: string[] = [];
    const fx = effects(log, false);
    let finish: (() => void) | undefined;
    fx.dialogue = (_l, done) => { finish = done; };
    const engine = new StoryEngine(data, world, fx);
    engine.update();
    expect(engine.press()).toBe(false); // far from the guide: E falls through to doors/lifts
    world.at = 'npc:guide';
    expect(engine.press()).toBe(true);
    expect(engine.press()).toBe(false); // dialogue open
    finish?.();
    expect(engine.progress.flags).toContain('c1.talked');
  });

  it('a step fires once even if its condition stays true', () => {
    const world = new FakeWorld(), log: string[] = [];
    const engine = new StoryEngine(data, world, effects(log));
    engine.update(); world.at = 'npc:guide'; engine.press();
    const n = log.length;
    for (let i = 0; i < 5; i++) engine.update();
    expect(log.slice(n).filter(l => l.startsWith('dialogue')).length).toBeLessThanOrEqual(log.slice(n).length);
    expect(engine.progress.fired['c1-gate'].filter(s => s === 'talk').length).toBe(1);
  });
  it('quitting during a dialogue does not lose the step (it replays on reload)', () => {
    const world = new FakeWorld(), log: string[] = [];
    const fx = effects(log, false);
    fx.dialogue = () => { /* player closes the tab mid-dialogue */ };
    const first = new StoryEngine(data, world, fx);
    first.update(); world.at = 'npc:guide'; first.press();
    const saved = JSON.parse(JSON.stringify(first.progress));
    expect(saved.fired['c1-gate'] ?? []).not.toContain('talk');
    const again = new StoryEngine(data, world, effects(log), saved);
    again.update(); again.press();
    expect(again.progress.flags).toContain('c1.talked');
  });
  it('restores where the story sent each NPC and survives malformed saves', () => {
    const moves: string[] = [];
    const fx = effects([]); fx.moveNpc = (n, a) => moves.push(`${n}@${a}`);
    const e = new StoryEngine(data, new FakeWorld(), fx, { active: 'c3-admin', done: ['c1-gate', 'c2-tunnel'], flags: [], fired: {}, sideQuests: [], npcAt: { guide: 'admin' } });
    e.resume();
    expect(moves).toContain('guide@admin');
    expect(() => new StoryEngine(data, new FakeWorld(), effects([]), {} as never).update()).not.toThrow();
    expect(() => new StoryEngine(data, new FakeWorld(), effects([]), { done: 'x', active: 42 } as never).update()).not.toThrow();
  });
});


it('previews E without starting chapters, firing actions, creating arrays or skipping automatic steps', () => {
  const world = new FakeWorld(), log: string[] = [];
  const chapter = { ...data.chapters[0], steps: [
    {id:'automatic',when:[],then:[{setFlag:'auto'}]},
    {id:'manual',when:[{press:'E'}],then:[{setFlag:'pressed'}]},
  ] } as StoryData['chapters'][number];
  const engine = new StoryEngine({...data,chapters:[chapter]},world,effects(log));
  const untouched=JSON.stringify(engine.progress);
  expect(engine.canPress()).toBe(false);expect(JSON.stringify(engine.progress)).toBe(untouched);expect(log).toEqual([]);
  engine.progress.active=chapter.id;
  const before=JSON.stringify(engine.progress);expect(engine.canPress()).toBe(false);expect(JSON.stringify(engine.progress)).toBe(before);
  engine.update();const afterAuto=JSON.stringify(engine.progress),calls=log.length;
  expect(engine.canPress()).toBe(true);expect(engine.canPress()).toBe(true);expect(JSON.stringify(engine.progress)).toBe(afterAuto);expect(log.length).toBe(calls);
  expect(engine.press()).toBe(true);expect(engine.progress.flags).toContain('pressed');expect(engine.canPress()).toBe(false);
});
