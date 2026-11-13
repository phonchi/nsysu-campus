import { describe, expect, it } from 'vitest';
import { CAMPUS_EVENTS_KEY, CampusEventEngine, validateEvents, type CampusEventCommand, type CampusEventDefinition, type CampusEventWorld } from '../src/story/campus-events';
import { QuestEngine, type QuestData } from '../src/story/quests';
import questData from '../public/data/quests.json';

const memory = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); } }; };
/** Fixture only (npcs.json is the coordinator's): the daytime macaque pilot of spec-v10 §5. */
const macaque: CampusEventDefinition = {
  id: 'ev-macaque-alert-day', when: 'day', anchor: 'zone:arcade-east', radius: 25, npcs: ['monkey-volunteer-man', 'm3-thief'],
  banner: '哨聲響起，大膽從樹上下來了', title: '白天的獼猴警戒', journal: '阿滿姐吹哨提醒：大膽沿邊坡下來了。',
  lines: [{ who: 'monkey-volunteer-man', text: '大膽下來了，食物先收好。' }],
  activity: {
    id: 'macaque-coexist', host: 'monkey-volunteer-man', invite: '牠要從長廊這頭過。點心收進包包，退開幾步讓路，好嗎？', accept: '好，我讓路', decline: '我先走了',
    prepare: [{ kind: 'move', npc: 'm3-thief', to: 'zone:arcade-east' }], inviteDelay: 5,
    steps: [
      { kind: 'action', id: 'stash', text: '把點心收進包包', needs: 'item-bread' },
      { kind: 'keepAway', npc: 'm3-thief', min: 4, hold: 2, text: '退到 4 公尺外，讓大膽過去', then: [{ kind: 'move', npc: 'm3-thief', to: 'zone:arcade-slope' }] },
    ],
    onDone: [{ kind: 'say', who: 'monkey-volunteer-man', text: '不餵食、不對視、食物收好，牠就會自己走。' }],
    onEnd: [{ kind: 'release', npc: 'm3-thief' }],
    timeout: 90, cooldown: 600, journal: { title: '與大膽共處', done: '點心收好、退開讓路，大膽自己走回邊坡了。', abandoned: '這次沒有留到最後。' }, reward: '哨子', counter: 'whistle',
  },
};
const song: CampusEventDefinition = { id: 'ev-night-song', when: 'night', anchor: 'zone:arcade', npcs: ['guitar-yun'], banner: '長廊夜唱，柱廊燈全亮' };
const events = [macaque, song];
interface Scene { time?: string; anchorDistance?: number; monkeyDistance?: number; bread?: boolean }
const world = (s: Scene = {}): CampusEventWorld => ({
  timeOfDay: () => s.time ?? 'day',
  distanceTo: t => t === 'zone:arcade-east' ? s.anchorDistance ?? 10 : t === 'npc:m3-thief' ? s.monkeyDistance ?? 2 : 1e9,
  hasItem: id => id === 'item-bread' ? s.bread ?? true : false,
});
const kinds = (c: CampusEventCommand[]) => c.map(x => x.kind);
const fire = (e: CampusEventEngine, s: Scene = {}) => { const out = e.update(1, world(s)); const invite = e.update(5, world(s)); return [...out, ...invite]; };
const complete = (e: CampusEventEngine, s: Scene = {}) => {
  const out = fire(e, s);
  expect(e.activity?.phase).toBe('invited');
  out.push(...(e.respond(true) || []));
  out.push(...(e.act('stash') || []));
  out.push(...e.update(1, world({ ...s, monkeyDistance: 6 })), ...e.update(1.5, world({ ...s, monkeyDistance: 6 })));
  return out;
};

describe('campus events: anchors, time and the journal', () => {
  it('fires only at the anchor and only at its time of day, once per time of day', () => {
    const e = new CampusEventEngine(events, { storage: memory(), now: () => 1 });
    expect(e.update(1, world({ anchorDistance: 100 }))).toEqual([]);
    expect(e.update(1, world({ time: 'sunset' }))).toEqual([]);
    const out = e.update(1, world());
    expect(kinds(out)).toEqual(['banner', 'journal', 'request', 'request']);
    expect(out[0]).toMatchObject({ kind: 'banner', text: macaque.banner, title: '校園事件' });
    expect(out[1]).toMatchObject({ kind: 'journal', entry: { kind: 'event', title: '白天的獼猴警戒', zone: 'arcade-east', npc: 'monkey-volunteer-man' } });
    expect(out[2]).toMatchObject({ kind: 'request', request: { kind: 'say', who: 'monkey-volunteer-man' } });
    expect(out[3]).toMatchObject({ kind: 'request', request: { kind: 'move', npc: 'm3-thief', to: 'zone:arcade-east' } });
    expect(e.activity?.phase).toBe('preparing');
  });
  it('an event without an activity is a banner, a journal line and nothing to answer; the journal entry goes through the quest journal', () => {
    const questStorage = memory(), journal = new QuestEngine(questData as QuestData, { storage: questStorage });
    const e = new CampusEventEngine(events, { storage: memory() });
    const out = e.update(1, { ...world({ time: 'night' }), distanceTo: t => t === 'zone:arcade' ? 3 : 1e9 });
    expect(kinds(out)).toEqual(['banner', 'journal']);
    const entry = out[1].kind === 'journal' ? out[1].entry : undefined;
    expect(journal.record(entry!)).toBe(true);
    expect(journal.progress.journal[0]).toMatchObject({ kind: 'event', title: song.banner, zone: 'arcade' });
    expect(new QuestEngine(questData as QuestData, { storage: questStorage }).progress.journal).toHaveLength(1);
    expect(e.activity).toBeUndefined();
  });
  it('nothing happens while paused: no trigger, no clock, no invitation', () => {
    const e = new CampusEventEngine(events, { storage: memory() });
    expect(e.update(10, world(), true)).toEqual([]);
    e.update(1, world());
    const remaining = e.activity!.remaining;
    expect(e.update(100, world(), true)).toEqual([]);
    expect(e.activity!.remaining).toBe(remaining);
  });
});

describe('the macaque pilot: invite → act → result', () => {
  it('invites after the macaque has walked down, only if the player is still near', () => {
    const e = new CampusEventEngine(events, { storage: memory() });
    e.update(1, world());
    expect(e.update(4, world())).toEqual([]);
    const out = e.update(1.5, world());
    expect(out).toEqual([{ kind: 'invite', activity: 'macaque-coexist', host: 'monkey-volunteer-man', text: macaque.activity!.invite, accept: '好，我讓路', decline: '我先走了' }]);
    const gone = new CampusEventEngine(events, { storage: memory() });
    gone.update(1, world());
    expect(kinds(gone.update(5, world({ anchorDistance: 60 })))).toEqual(['request', 'objective']);
    expect(gone.activity).toBeUndefined();
  });
  it('declining costs nothing: no reward, no journal line, the macaque is released, and the activity waits out its cooldown', () => {
    const e = new CampusEventEngine(events, { storage: memory() });
    fire(e);
    const out = e.respond(false);
    expect(out && kinds(out)).toEqual(['request', 'objective']);
    expect(out && out[0]).toMatchObject({ request: { kind: 'release', npc: 'm3-thief' } });
    expect(e.progress).toEqual({ version: 1, completed: {}, rewarded: [] });
    expect(e.respond(true)).toBe(false);
    // The next day: the banner comes back, the invitation does not until the cooldown has passed.
    e.update(10, world({ time: 'sunset' }));
    expect(kinds(e.update(1, world()))).toEqual(['banner', 'journal', 'request']);
    expect(e.activity).toBeUndefined();
    e.update(1, world({ time: 'sunset' })); e.update(600, world({ time: 'sunset', anchorDistance: 100 }));
    expect(kinds(e.update(1, world()))).toEqual(['banner', 'journal', 'request', 'request']);
    expect(e.activity?.phase).toBe('preparing');
  });
  it('stashing the snack and stepping back lets the macaque go: a journal entry with the stamp, the counter and the host line', () => {
    const storage = memory(), journal = new QuestEngine(questData as QuestData, { storage: memory() });
    const e = new CampusEventEngine(events, { storage, now: () => 7 });
    const out = complete(e);
    const after = out.slice(out.findIndex(c => c.kind === 'invite') + 1);
    expect(kinds(after)).toEqual(['objective', 'objective', 'request', 'request', 'journal', 'counter', 'reward', 'request', 'objective']);
    expect(after[0]).toMatchObject({ text: '把點心收進包包' });
    expect(after[1]).toMatchObject({ text: '退到 4 公尺外，讓大膽過去' });
    expect(after[2]).toMatchObject({ request: { kind: 'move', to: 'zone:arcade-slope' } });
    expect(after[3]).toMatchObject({ request: { kind: 'say', who: 'monkey-volunteer-man' } });
    expect(after[4]).toMatchObject({ entry: { kind: 'event', title: '與大膽共處', result: macaque.activity!.journal.done, reward: '哨子', choice: '參與並完成' } });
    expect(after[5]).toEqual({ kind: 'counter', id: 'whistle' });
    expect(after[6]).toEqual({ kind: 'reward', id: '哨子' });
    for (const c of out) if (c.kind === 'journal') journal.record(c.entry);
    expect(journal.progress.rewards).toEqual(['哨子']);
    expect(e.activity).toBeUndefined();
    expect(e.progress).toEqual({ version: 1, completed: { 'macaque-coexist': 1 }, rewarded: ['哨子'] });
    expect(JSON.parse(storage.getItem(CAMPUS_EVENTS_KEY)!)).toMatchObject({ completed: { 'macaque-coexist': 1 }, rewarded: ['哨子'] });
  });
  it('after a reload the stamp is not granted twice, the counter still counts, and an unfinished activity is simply gone', () => {
    const storage = memory(), journal = new QuestEngine(questData as QuestData, { storage: memory() });
    const first = new CampusEventEngine(events, { storage, now: () => 1 });
    for (const c of complete(first)) if (c.kind === 'journal') journal.record(c.entry);
    const halfway = new CampusEventEngine(events, { storage, now: () => 2 });
    fire(halfway); halfway.respond(true);
    expect(halfway.activity?.phase).toBe('active');
    const reloaded = new CampusEventEngine(events, { storage, now: () => 3 });
    expect(reloaded.activity).toBeUndefined();
    expect(reloaded.progress).toEqual({ version: 1, completed: { 'macaque-coexist': 1 }, rewarded: ['哨子'] });
    const out = complete(reloaded);
    expect(kinds(out)).not.toContain('reward');
    expect(kinds(out)).toContain('counter');
    const entry = out.find(c => c.kind === 'journal' && c.entry.title === '與大膽共處');
    expect(entry && entry.kind === 'journal' ? entry.entry.reward : 'missing').toBeUndefined();
    for (const c of out) if (c.kind === 'journal') journal.record(c.entry);
    expect(journal.progress.rewards).toEqual(['哨子']);
    expect(journal.progress.journal.filter(x => x.title === '與大膽共處')).toHaveLength(2);
    expect(reloaded.progress.completed['macaque-coexist']).toBe(2);
  });
  it('running out of time or walking away is abandoned: noted in the journal, nothing granted, people released', () => {
    const e = new CampusEventEngine(events, { storage: memory() });
    fire(e); e.respond(true);
    const out = e.update(91, world());
    expect(kinds(out)).toEqual(['journal', 'request', 'objective']);
    expect(out[0]).toMatchObject({ entry: { result: '這次沒有留到最後。', choice: '中途離開' } });
    expect(out[0].kind === 'journal' && out[0].entry.reward).toBeUndefined();
    expect(e.progress.completed).toEqual({});
    const left = new CampusEventEngine(events, { storage: memory() });
    fire(left); left.respond(true);
    expect(kinds(left.leave() || [])).toEqual(['journal', 'request', 'objective']);
    expect(left.activity).toBeUndefined();
  });
  it('without a snack to stash, the stash step does not apply and stepping back is enough', () => {
    const e = new CampusEventEngine(events, { storage: memory() });
    fire(e, { bread: false }); e.respond(true);
    expect(e.update(.1, world({ bread: false }))).toEqual([{ kind: 'objective', text: '退到 4 公尺外，讓大膽過去' }]);
    expect(e.act('stash')).toBe(false);
    expect(e.pendingAction()).toBeUndefined();
  });
  it('an action out of turn, a wrong action id, or stepping back too briefly do nothing', () => {
    const e = new CampusEventEngine(events, { storage: memory() });
    expect(e.act('stash')).toBe(false);
    fire(e); e.respond(true);
    expect(e.pendingAction()).toMatchObject({ id: 'stash', needs: 'item-bread' });
    expect(e.act('wave')).toBe(false);
    e.act('stash');
    e.update(1, world({ monkeyDistance: 6 })); e.update(1, world({ monkeyDistance: 2 }));
    expect(e.update(1.5, world({ monkeyDistance: 6 }))).toEqual([]);
    expect(e.activity?.step).toBe(1);
  });
  it('validates the extended schema', () => {
    expect(validateEvents(events)).toEqual([]);
    expect(validateEvents([{ ...song, anchor: 'arcade' }, { ...song, id: 'ev-night-song' }])).toEqual(['event ev-night-song: anchor must be zone:<id> or npc:<id>', 'duplicate event ev-night-song']);
    expect(validateEvents([{ ...macaque, lines: [{ who: 'guide', text: 'x' }] }])).toEqual(['event ev-macaque-alert-day: line by guide, who is not a participant']);
  });
});
