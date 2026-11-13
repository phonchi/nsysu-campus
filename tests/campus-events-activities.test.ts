/** v10.1 activities (spec-v10 §11): 'stay' and 'rhythm' steps, sit/stand poses, achievements, partial completions and
 * conditional lines, driven by the real ev-sunset-crowd / ev-night-song data of npcs.json. */
import { describe, expect, it } from 'vitest';
import { CAMPUS_EVENTS_KEY, CampusEventEngine, validateEvents, type ActivityDefinition, type CampusEventCommand, type CampusEventDefinition, type CampusEventWorld } from '../src/story/campus-events';
import npcData from '../public/data/npcs.json';
import zoneData from '../public/data/story-zones.json';
import collection from '../public/data/collection.json';
import questData from '../public/data/quests.json';

const memory = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); } }; };
const events = npcData.events as CampusEventDefinition[];
const sunset = events.find(e => e.id === 'ev-sunset-crowd')!, song = events.find(e => e.id === 'ev-night-song')!;
const minute = sunset.activity!, beat = song.activity!;
const stay = beat.steps[0] as Extract<ActivityDefinition['steps'][number], { kind: 'stay' }>, rhythm = beat.steps[1] as Extract<ActivityDefinition['steps'][number], { kind: 'rhythm' }>;
interface Scene { time?: string; seat?: number; anchor?: number; moving?: boolean; choice?: string }
/** Distances: the event anchor (zone:seawall / zone:arcade) and the seat; everything else is far away. */
const world = (s: Scene = {}): CampusEventWorld => ({
  timeOfDay: () => s.time ?? 'sunset',
  distanceTo: t => t === 'zone:seawall' || t === 'zone:arcade' ? s.anchor ?? 10 : t === 'zone:seawall-seat' || t === 'zone:arcade-seat' ? s.seat ?? 1 : 1e9,
  playerMoving: () => s.moving ?? false,
  questChoice: (quest, step) => quest === 'sea-stage' && step === 'return' ? s.choice : undefined,
});
const kinds = (c: CampusEventCommand[]) => c.map(x => x.kind);
const requests = (c: CampusEventCommand[]) => c.flatMap(x => x.kind === 'request' ? [x.request] : []);
const poses = (c: CampusEventCommand[]) => requests(c).flatMap(r => r.kind === 'pose' ? [r.pose] : []);
/** Fire the event and wait out inviteDelay (2 s) so the invitation is up. */
const fire = (e: CampusEventEngine, s: Scene = {}) => { const out = e.update(1, world(s)); out.push(...e.update(2.5, world(s))); expect(e.activity?.phase).toBe('invited'); return out; };
const night: Scene = { time: 'night' };
/** Accept the night song and sit through the 2 s stay step: the rhythm step is now waiting for act('clap', { hits }). */
const toRhythm = (e: CampusEventEngine, s: Scene = night) => { fire(e, s); const out = e.respond(true) || []; out.push(...e.update(1, world(s)), ...e.update(1.2, world(s))); expect(e.activity?.step).toBe(1); return out; };

describe('the data of the two v10.1 activities', () => {
  it('passes the extended schema and refers to things that exist', () => {
    expect(validateEvents(events)).toEqual([]);
    expect(minute).toMatchObject({ host: 'poet-wen', achievement: 'silence', timeout: 180, steps: [{ kind: 'stay', target: 'zone:seawall-seat', hold: 60, still: true, sit: true }] });
    expect(beat).toMatchObject({ host: 'guitar-yun', achievement: 'audience', timeout: 180, steps: [{ kind: 'stay', target: 'zone:arcade-seat', max: 2, hold: 2, sit: true, keepSeated: true }, { kind: 'rhythm', id: 'clap', cues: 8, interval: 3.6, lead: 2, window: 0.2, need: 5 }] });
    expect(beat.journal.partial).toContain('{hits}');
    const achievements = collection.achievements.map(a => a.id);
    expect(achievements).toEqual(expect.arrayContaining(['silence', 'audience']));
    const returnStep = questData.quests.find(q => q.id === 'sea-stage')!.steps.find(s => s.id === 'return')!;
    const conditions = (beat.onDone ?? []).flatMap(r => r.kind === 'say' && r.if ? [r.if] : []);
    expect(conditions).toHaveLength(2);
    for (const c of conditions) { expect(c).toMatchObject({ quest: 'sea-stage', step: 'return' }); expect(returnStep.choices!.map(x => x.id)).toContain(c.choice); }
    expect(rhythm.lead + (rhythm.cues - 1) * rhythm.interval).toBeCloseTo(27.2);  // the last cue; the song is about 30 s with its tail
  });
  it('every line fits a speech bubble (≤ 28 characters) and the hosts take part in their events', () => {
    for (const e of [sunset, song]) {
      const a = e.activity!;
      const texts = [a.invite, a.accept, a.decline, ...a.steps.map(s => s.text), ...Object.values(a.journal), ...[...(a.prepare ?? []), ...(a.onDone ?? []), ...(a.onEnd ?? []), ...a.steps.flatMap(s => s.then ?? [])].flatMap(r => r.kind === 'say' ? [r.text] : [])];
      for (const t of texts) expect([...t.replace('{hits}', '8')].length, t).toBeLessThanOrEqual(28);
      expect(e.npcs).toContain(a.host);
    }
  });
  it('the seats are story zones inside their parent zones, so entering one never raises a zone banner', () => {
    const zones = zoneData.zones as unknown as Record<string, { p: number[]; r: number }>;
    for (const [seat, parent] of [['seawall-seat', 'seawall'], ['arcade-seat', 'arcade']] as const) {
      expect(zones[seat]).toBeDefined();
      const d = Math.hypot(zones[seat].p[0] - zones[parent].p[0], zones[seat].p[1] - zones[parent].p[1]);
      expect(d + zones[seat].r).toBeLessThan(zones[parent].r);
      expect(Object.keys(zones).indexOf(parent)).toBeLessThan(Object.keys(zones).indexOf(seat));
    }
  });
});

describe('the sunset minute: a stay step with sit and still', () => {
  it('sits the player at the seat when the step starts and counts only while there and still', () => {
    const e = new CampusEventEngine(events, { storage: memory() });
    const out = fire(e);
    expect(out[0]).toMatchObject({ kind: 'banner', text: sunset.banner });
    expect(out.at(-1)).toMatchObject({ kind: 'invite', activity: 'sunset-minute', host: 'poet-wen', text: minute.invite });
    expect(e.respond(true)).toEqual([{ kind: 'objective', text: minute.steps[0].text }, { kind: 'request', request: { kind: 'pose', pose: 'sit', at: 'zone:seawall-seat' } }]);
    expect(e.activity).toMatchObject({ phase: 'active', seated: true, stepProgress: { held: 0, hold: 60 } });
    expect(e.update(30, world())).toEqual([]);
    expect(e.activity!.stepProgress).toEqual({ held: 30, hold: 60 });
    expect(e.update(1, world({ moving: true }))).toEqual([]);
    expect(e.activity!.stepProgress).toEqual({ held: 0, hold: 60 });
    e.update(20, world());
    expect(e.update(1, world({ seat: 5 }))).toEqual([]);
    expect(e.activity!.stepProgress).toEqual({ held: 0, hold: 60 });
    e.update(59, world());
    expect(e.activity!.stepProgress).toEqual({ held: 59, hold: 60 });
    expect(e.activity!.step).toBe(0);
  });
  it('a full minute stands the player up, lets the poet speak, writes the journal and grants the achievement once', () => {
    const storage = memory(), e = new CampusEventEngine(events, { storage, now: () => 5 });
    fire(e); e.respond(true); e.update(59.5, world());
    const out = e.update(1, world());
    expect(kinds(out)).toEqual(['request', 'request', 'journal', 'achievement', 'objective']);
    expect(out[0]).toMatchObject({ request: { kind: 'pose', pose: 'stand' } });
    expect(out[1]).toMatchObject({ request: { kind: 'say', who: 'poet-wen', text: (minute.onDone![0] as { text: string }).text } });
    expect(out[2]).toMatchObject({ entry: { kind: 'event', title: minute.journal.title, result: minute.journal.done, choice: '參與並完成', npc: 'poet-wen', zone: 'seawall' } });
    expect(out[2].kind === 'journal' && out[2].entry.reward).toBeUndefined();
    expect(out[3]).toEqual({ kind: 'achievement', id: 'silence' });
    expect(e.activity).toBeUndefined();
    expect(e.progress).toEqual({ version: 1, completed: { 'sunset-minute': 1 }, rewarded: [], achieved: ['silence'] });
    expect(JSON.parse(storage.getItem(CAMPUS_EVENTS_KEY)!)).toMatchObject({ completed: { 'sunset-minute': 1 }, rewarded: [], achieved: ['silence'] });
    // The next sunset, after the cooldown and a reload: the minute is offered again, the achievement is not.
    const again = new CampusEventEngine(events, { storage, now: () => 6 });
    expect(again.progress.achieved).toEqual(['silence']);
    again.update(1, world({ time: 'day', anchor: 1e9 })); again.update(200, world({ time: 'day', anchor: 1e9 }));
    fire(again); again.respond(true); again.update(59.5, world());
    const second = again.update(1, world());
    expect(kinds(second)).toEqual(['request', 'request', 'journal', 'objective']);
    expect(again.progress).toEqual({ version: 1, completed: { 'sunset-minute': 2 }, rewarded: [], achieved: ['silence'] });
  });
  it('stand pairs with sit on every way out: timeout, leaving, a change of time of day; declining never sat down', () => {
    const timed = new CampusEventEngine(events, { storage: memory() });
    fire(timed); timed.respond(true); timed.update(10, world());
    const out = timed.update(171, world());
    expect(kinds(out)).toEqual(['request', 'journal', 'objective']);
    expect(out[0]).toMatchObject({ request: { kind: 'pose', pose: 'stand' } });
    expect(out[1]).toMatchObject({ entry: { result: minute.journal.abandoned, choice: '中途離開' } });
    const left = new CampusEventEngine(events, { storage: memory() });
    fire(left); left.respond(true);
    expect(poses(left.leave() || [])).toEqual(['stand']);
    const dusk = new CampusEventEngine(events, { storage: memory() });
    fire(dusk); dusk.respond(true); dusk.update(5, world());
    expect(poses(dusk.update(1, world({ time: 'night', anchor: 1e9 })))).toEqual(['stand']);
    expect(dusk.activity).toBeUndefined();
    const declined = new CampusEventEngine(events, { storage: memory() });
    fire(declined);
    const no = declined.respond(false) || [];
    expect(poses(no)).toEqual([]);
    expect(no.find(c => c.kind === 'journal')).toMatchObject({ entry: { result: minute.journal.declined, choice: '這次先不參加' } });
    expect(declined.progress).toEqual({ version: 1, completed: {}, rewarded: [] });
  });
});

describe('the night song: sit, then a rhythm step reported by the runtime', () => {
  it('seats the player for the short stay and keeps them seated while the rhythm starts with the cue timing of the step', () => {
    const e = new CampusEventEngine(events, { storage: memory() });
    const out = toRhythm(e);
    const after = out.slice(out.findIndex(c => c.kind === 'invite') + 1);
    expect(after).toEqual([
      { kind: 'objective', text: stay.text }, { kind: 'request', request: { kind: 'pose', pose: 'sit', at: 'zone:arcade-seat' } },
      { kind: 'objective', text: rhythm.text },
      { kind: 'rhythm', id: 'clap', cues: 8, interval: 3.6, lead: 2, window: 0.2, need: 5, style: rhythm.style },
    ]);
    expect(e.activity).toMatchObject({ step: 1, seated: true, partial: false });
    expect(e.activity!.stepProgress).toBeUndefined();
    expect(e.pendingAction()).toBeUndefined();  // a rhythm step is not an interaction-list action
    expect(e.update(100, world(night))).toEqual([]);  // the clock runs but nothing completes until the runtime reports
    expect(e.activity!.step).toBe(1);
  });
  it('enough hits: journal.done, the achievement, and the host line for the chosen style', () => {
    const storage = memory(), e = new CampusEventEngine(events, { storage });
    toRhythm(e, { ...night, choice: 'b' });
    expect(e.act('wave', { hits: 8 })).toBe(false);
    const out = e.act('clap', { hits: 5 }) || [];
    expect(kinds(out)).toEqual(['request', 'request', 'journal', 'achievement', 'request', 'objective']);
    expect(requests(out)).toEqual([{ kind: 'say', who: 'guitar-yun', text: (beat.onDone![0] as { text: string }).text }, beat.onDone![2], { kind: 'pose', pose: 'stand' }]);
    expect(out[2]).toMatchObject({ entry: { title: beat.journal.title, result: beat.journal.done, choice: '參與並完成', npc: 'guitar-yun', zone: 'arcade' } });
    expect(out[3]).toEqual({ kind: 'achievement', id: 'audience' });
    expect(e.progress).toEqual({ version: 1, completed: { 'night-song-beat': 1 }, rewarded: [], achieved: ['audience'] });
    expect(e.activity).toBeUndefined();
  });
  it('too few hits: the partial journal line with the count, no achievement, but a completion that starts the cooldown', () => {
    const storage = memory(), e = new CampusEventEngine(events, { storage });
    toRhythm(e, { ...night, choice: 'a' });
    const out = e.act('clap', { hits: 3 }) || [];
    expect(kinds(out)).toEqual(['request', 'request', 'journal', 'request', 'objective']);
    expect(poses(out)).toEqual(['stand']);
    expect(requests(out)[1]).toEqual(beat.onDone![1]);
    expect(out[2]).toMatchObject({ entry: { result: '跟著拍了 3 拍，歌還是聽完了。', choice: '參與並完成' } });
    expect(e.progress).toEqual({ version: 1, completed: { 'night-song-beat': 1 }, rewarded: [] });
    const saved = JSON.parse(storage.getItem(CAMPUS_EVENTS_KEY)!);
    expect(saved).toMatchObject({ completed: { 'night-song-beat': 1 }, rewarded: [] });
    expect(saved.achieved).toBeUndefined();
    // The same night nothing fires again; the next night within the cooldown only the banner comes back; after it, the invitation too.
    expect(e.update(1, world(night))).toEqual([]);
    e.update(10, world({ time: 'day', anchor: 1e9 }));  // past the banner spacing, within the cooldown
    expect(kinds(e.update(1, world(night)))).toEqual(['banner', 'journal', 'request']);
    expect(e.activity).toBeUndefined();
    e.update(1, world({ time: 'day', anchor: 1e9 })); e.update(120, world({ time: 'day', anchor: 1e9 }));
    expect(kinds(e.update(1, world(night)))).toEqual(['banner', 'journal', 'request']);
    expect(e.activity?.phase).toBe('preparing');
    // Succeeding later still grants the achievement for the first time.
    e.update(2.5, world(night)); e.respond(true); e.update(2.5, world(night));
    const win = e.act('clap', { hits: 8 }) || [];
    expect(kinds(win)).toContain('achievement');
    expect(e.progress).toEqual({ version: 1, completed: { 'night-song-beat': 2 }, rewarded: [], achieved: ['audience'] });
  });
  it('hits are clamped to 0..cues and a missing report counts as none', () => {
    const none = new CampusEventEngine(events, { storage: memory() });
    toRhythm(none);
    const out = none.act('clap') || [];
    expect(out.find(c => c.kind === 'journal')).toMatchObject({ entry: { result: '跟著拍了 0 拍，歌還是聽完了。' } });
    const many = new CampusEventEngine(events, { storage: memory() });
    toRhythm(many);
    expect(kinds(many.act('clap', { hits: 99 }) || [])).toContain('achievement');
    expect(many.activity).toBeUndefined();
  });
  it('a conditional line is only said for the matching choice, and never without questChoice', () => {
    const said = (scene: Scene, hits = 8) => { const e = new CampusEventEngine(events, { storage: memory() }); toRhythm(e, scene); return requests(e.act('clap', { hits }) || []).flatMap(r => r.kind === 'say' ? [r.text] : []); };
    const [generic, styleA, styleB] = beat.onDone!.map(r => (r as { text: string }).text);
    expect(said({ ...night, choice: 'a' })).toEqual([generic, styleA]);
    expect(said({ ...night, choice: 'b' })).toEqual([generic, styleB]);
    expect(said(night)).toEqual([generic]);
    const bare = new CampusEventEngine(events, { storage: memory() });
    const w = world(night); delete (w as Partial<CampusEventWorld>).questChoice;
    bare.update(1, w); bare.update(2.5, w); bare.respond(true); bare.update(1, w); bare.update(1.2, w);
    expect(requests(bare.act('clap', { hits: 8 }) || []).flatMap(r => r.kind === 'say' ? [r.text] : [])).toEqual([generic]);
  });
  it('one sit, one stand: the player stays seated through the song and stands only when the activity ends', () => {
    const run = (end: (e: CampusEventEngine) => CampusEventCommand[]) => {
      const e = new CampusEventEngine(events, { storage: memory() }), all = toRhythm(e);
      all.push(...e.update(20, world(night)), ...end(e));
      expect(e.activity).toBeUndefined();
      expect(poses(all)).toEqual(['sit', 'stand']);
      const stand = all.findIndex(c => c.kind === 'request' && c.request.kind === 'pose' && c.request.pose === 'stand');
      expect(stand).toBeGreaterThan(all.findIndex(c => c.kind === 'rhythm'));
      expect(all.slice(stand + 1).map(c => c.kind)).not.toContain('rhythm');  // the stand belongs to the end of the activity
      expect(all.at(-1)).toEqual({ kind: 'objective' });
      return all;
    };
    const won = run(e => e.act('clap', { hits: 8 }) || []);
    expect(won.findIndex(c => c.kind === 'achievement')).toBeLessThan(won.findIndex(c => c.kind === 'request' && c.request.kind === 'pose' && c.request.pose === 'stand'));
    run(e => e.act('clap', { hits: 1 }) || []);
    run(e => e.update(200, world(night)));  // timeout
    run(e => e.leave() || []);
    run(e => e.update(1, world({ time: 'day', anchor: 1e9 })));  // change of time of day
  });
  it('a sit step after a keepSeated step does not seat the player twice: still one sit and one stand', () => {
    const twice: CampusEventDefinition = { ...song, activity: { ...beat, steps: [{ ...stay, keepSeated: true }, { ...stay, keepSeated: false, hold: 1 }], journal: { ...beat.journal } } };
    const e = new CampusEventEngine([twice], { storage: memory() }), all = fire(e, night);
    all.push(...(e.respond(true) || []), ...e.update(2.5, world(night)), ...e.update(1.5, world(night)));
    expect(e.activity).toBeUndefined();
    expect(poses(all)).toEqual(['sit', 'stand']);
  });
  it('leaving during the song stands the player up, as does leaving while still on the seat', () => {
    const e = new CampusEventEngine(events, { storage: memory() });
    toRhythm(e);
    const out = e.leave() || [];
    expect(poses(out)).toEqual(['stand']);
    expect(out.find(c => c.kind === 'journal')).toMatchObject({ entry: { result: beat.journal.abandoned } });
    const seated = new CampusEventEngine(events, { storage: memory() });
    fire(seated, night); seated.respond(true); seated.update(1, world(night));
    expect(poses(seated.leave() || [])).toEqual(['stand']);
  });
});

describe('validation of the new step kinds', () => {
  const base: CampusEventDefinition = { id: 'ev-x', when: 'night', anchor: 'zone:arcade', npcs: ['guitar-yun'], banner: 'x' };
  const activity = (steps: ActivityDefinition['steps'], extra: Partial<ActivityDefinition> = {}): CampusEventDefinition => ({ ...base, activity: { id: 'x', host: 'guitar-yun', invite: 'i', accept: 'a', decline: 'd', steps, journal: { title: 't', done: 'd', abandoned: 'a' }, ...extra } });
  it('rejects a bad stay step, a bad rhythm step, a missing or malformed partial line and a malformed say.if', () => {
    expect(validateEvents([activity([{ kind: 'stay', target: 'arcade-seat', max: 3, hold: 0, text: 't' }])])).toEqual(['event ev-x: stay step needs target zone:/npc:/spot:, max > 0 and hold > 0']);
    expect(validateEvents([activity([{ kind: 'stay', target: 'zone:arcade-seat', max: 3, hold: 2, keepSeated: true, text: 't' }])])).toEqual(['event ev-x: keepSeated needs sit']);
    expect(validateEvents([activity([{ kind: 'rhythm', id: 'clap', cues: 8, interval: 3.6, lead: 2, window: 2, need: 5, text: 't' }], { journal: { title: 't', done: 'd', abandoned: 'a', partial: '{hits}' } })]))
      .toEqual(['event ev-x: rhythm step clap needs id, 1..64 cues, interval > 0, lead > 0, 0 <= window < interval/2 and 1 <= need <= cues']);
    expect(validateEvents([activity([{ kind: 'rhythm', id: 'clap', cues: 8, interval: 3.6, lead: 2, window: 0.2, need: 9, text: 't' }], { journal: { title: 't', done: 'd', abandoned: 'a', partial: '{hits}' } })])).toHaveLength(1);
    expect(validateEvents([activity([rhythm])])).toEqual(['event ev-x: a rhythm step needs journal.partial']);
    expect(validateEvents([activity([rhythm], { journal: { title: 't', done: 'd', abandoned: 'a', partial: 'no count' } })])).toEqual(['event ev-x: journal.partial must contain {hits}']);
    expect(validateEvents([activity([{ kind: 'action', id: 'clap', text: 't' }, rhythm], { journal: { title: 't', done: 'd', abandoned: 'a', partial: '{hits}' } })])).toEqual(['event ev-x: duplicate action id']);
    expect(validateEvents([activity([stay], { onDone: [{ kind: 'say', who: 'guitar-yun', text: 'x', if: { quest: 'sea-stage', step: '', choice: 'a' } }] })])).toEqual(['event ev-x: say.if needs quest, step and choice']);
    expect(validateEvents([activity([stay], { onDone: [{ kind: 'say', who: 'poet-wen', text: 'x' }] })])).toEqual(['event ev-x: say by poet-wen, who is not a participant']);
    expect(validateEvents([activity([stay], { host: 'poet-wen' })])).toEqual(['event ev-x: host poet-wen is not a participant']);
    expect(validateEvents([activity([stay, rhythm], { journal: { title: 't', done: 'd', abandoned: 'a', partial: '{hits}' }, achievement: 'audience' })])).toEqual([]);
  });
});
