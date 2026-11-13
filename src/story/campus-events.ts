/** Campus events (spec-v10 §5, §11.2): pure logic, no DOM and no three.js, so fixtures drive it in node tests.
 *
 * An event fires at its anchor (`zone:<id>` or `npc:<id>`), never at a participant: once per time of day, when the player is
 * within `radius` of the anchor, the engine asks for a banner, writes one journal entry (kind 'event') and asks each present
 * participant to say a line. An event may carry an `activity`: a short invitation → action → result loop (the daytime macaque
 * pilot, the sunset minute, the night song). The engine only *requests* NPC moves, lines and player poses; the runtime (WP-A)
 * owns the NPCs, the avatar and the rhythm game and executes requests.
 *
 * API
 *   const events = new CampusEventEngine(definitions, { storage?, now?, onChange? });
 *   events.update(dt, world, paused?)  → CampusEventCommand[]  every frame; nothing moves while paused
 *   events.respond(accepted)           → boolean               the player answered the invitation
 *   events.act(id, result?)            → boolean               the player did an 'action' step (e.g. 'stash'), or the runtime
 *                                                              reports a 'rhythm' step: act(id, { hits })
 *   events.leave()                     → boolean               the player cancels or walks away: abandoned, no penalty
 *   events.activity                                            the activity in progress (undefined when none); `stepProgress`
 *                                                              is { held, hold } during a 'stay' step for the on-screen countdown
 *   events.progress                                            what persists: completions, granted stamps and achievements
 *   events.restore(raw) / events.snapshot()                    persistence hooks (the constructor uses `storage` when given)
 *
 * Lifecycle of an activity: idle → (event fires, `prepare` requests go out) → invited (after `inviteDelay` s, if the player is
 * still near the anchor) → active (steps in order; `timeout` s) → done | declined | abandoned → cooldown. Only completions,
 * stamps and achievements persist: a reload always starts idle; a stamp or achievement is granted once ever while the counter
 * counts every completion. A 'rhythm' step short of `need` hits is a *partial* completion: journal.partial (with {hits}) instead
 * of journal.done, no reward, achievement or counter, but it counts as a completion so the cooldown applies.
 *
 * Commands the runtime executes, in order:
 *   banner      show the event banner (title '校園事件') with an optional sound cue
 *   journal     record the entry through QuestEngine.record() (it dedupes by id and grants `reward` once)
 *   request     { move | say | release | pose }: borrow an NPC and walk it to a target, have an NPC say a line (a `say` with
 *               `if` is only requested when that side quest's step was answered with that choice), give an NPC back, or seat /
 *               stand the player ('stay' steps with `sit` send sit at the step start and stand when the step ends, or, with
 *               `keepSeated`, only when the activity ends however it ends; one sit always pairs with one stand)
 *   invite      show the invitation with its accept/decline labels; answer with respond()
 *   objective   show what to do now (text) or clear it (no text)
 *   rhythm      start the rhythm game (cue timing of the step); the runtime judges it and reports act(id, { hits })
 *   counter     increment a collection counter (the '哨子' stamp counts completions)
 *   reward      a stamp was granted for the first time (feedback only; the journal entry already carries it)
 *   achievement an achievement was granted for the first time (write it to the collection and show it)
 */
import { readSave, removeSave, writeSave } from './save-guard';
import type { JournalEntry } from './quests';

export interface EventLine { who: string; text: string }
/** Only say it when the side quest `quest` answered step `step` with choice `choice` (world.questChoice). */
export interface SayCondition { quest: string; step: string; choice: string }
/** Cue timing of a 'rhythm' step: `cues` beats, the first `lead` s in, then every `interval` s; a clap within ±`window` s of a
 * beat hits; `need` hits succeed. `style` is a free hint for the synthesised melody. */
export interface RhythmSpec { id: string; cues: number; interval: number; lead: number; window: number; need: number; style?: string }
export type ActivityRequest =
  | { kind: 'move'; npc: string; to: string }
  | { kind: 'say'; who: string; text: string; if?: SayCondition }
  | { kind: 'release'; npc: string }
  | { kind: 'pose'; pose: 'sit' | 'stand'; at?: string };
export type ActivityStep =
  /** The runtime offers it (E or a button); done when it calls act(id). `needs` names an item the player must hold for the action to apply, otherwise the step is skipped. */
  | { kind: 'action'; id: string; text: string; needs?: string; then?: ActivityRequest[] }
  /** Stay at least `min` m from the NPC for `hold` s (default 2). */
  | { kind: 'keepAway'; npc: string; min: number; hold?: number; text: string; then?: ActivityRequest[] }
  /** Be within `max` m of a target (zone:/npc:/spot:). */
  | { kind: 'near'; target: string; max: number; text: string; then?: ActivityRequest[] }
  /** Stay within `max` m of `target` for `hold` s in a row; leaving (or, with `still`, moving) starts over. `sit` seats the player at the
   * target for the step; `keepSeated` (with `sit`) keeps them seated through the following steps until the activity ends. */
  | { kind: 'stay'; target: string; max: number; hold: number; still?: boolean; sit?: boolean; keepSeated?: boolean; text: string; then?: ActivityRequest[] }
  /** The runtime plays the cues and reports act(id, { hits }); `hits >= need` succeeds, fewer is a partial completion. */
  | ({ kind: 'rhythm'; text: string; then?: ActivityRequest[] } & RhythmSpec);
export interface ActivityDefinition {
  id: string;
  /** Who invites; the invitation is shown as this person speaking. */
  host: string;
  invite: string; accept: string; decline: string;
  /** Requested as soon as the event fires, before the invitation (the macaque walks down to where the player can see it). */
  prepare?: ActivityRequest[];
  /** Seconds between the event firing and the invitation; the player must still be within the event radius. */
  inviteDelay?: number;
  steps: ActivityStep[];
  /** Requested once the last step is done, full or partial (the macaque walks back, the host responds). */
  onDone?: ActivityRequest[];
  /** Requested whenever the activity stops, done or not (release borrowed NPCs). */
  onEnd?: ActivityRequest[];
  /** Seconds the active phase may take (default 90); the invitation itself expires after 45 s. */
  timeout?: number;
  /** Seconds before the activity may be offered again (default 600 of exploration time). */
  cooldown?: number;
  /** `partial` (with `{hits}`) replaces `done` when a rhythm step fell short of `need`. */
  journal: { title: string; done: string; abandoned: string; declined?: string; partial?: string };
  /** Stamp granted on the first completion only. */
  reward?: string;
  /** Collection counter incremented on every completion. */
  counter?: string;
  /** Achievement granted on the first full completion only. */
  achievement?: string;
}
export interface CampusEventDefinition {
  id: string; when: string; anchor: string; radius?: number; npcs: string[]; banner: string;
  /** Journal title and text; the banner stands in for both when absent. */
  title?: string; journal?: string;
  /** Zone label for the journal; the anchor's zone when it is a zone, otherwise ''. */
  zone?: string;
  /** What present participants say when the event fires. */
  lines?: EventLine[];
  activity?: ActivityDefinition;
}
export interface CampusEventWorld {
  timeOfDay(): string; distanceTo(target: string): number; hasItem?(id: string): boolean; npcPresent?(id: string): boolean;
  /** Whether the player is walking right now ('stay' steps with `still` start over while true; absent means never moving). */
  playerMoving?(): boolean;
  /** The choice id the player picked at a side quest step, if any (gates `say` requests with `if`). */
  questChoice?(quest: string, step: string): string | undefined;
}
export type CampusEventCommand =
  | { kind: 'banner'; text: string; title: string; sound?: string }
  | { kind: 'journal'; entry: Omit<JournalEntry, 'at'> }
  | { kind: 'request'; request: ActivityRequest }
  | { kind: 'invite'; activity: string; host: string; text: string; accept: string; decline: string }
  | { kind: 'objective'; text?: string }
  | ({ kind: 'rhythm' } & RhythmSpec)
  | { kind: 'counter'; id: string }
  | { kind: 'reward'; id: string }
  | { kind: 'achievement'; id: string };
export interface ActiveActivity {
  event: CampusEventDefinition; definition: ActivityDefinition; phase: 'preparing' | 'invited' | 'active'; step: number; remaining: number; held: number; instance: string;
  /** Countdown of the current 'stay' step (seconds held so far, seconds needed); absent on other steps. */
  stepProgress?: { held: number; hold: number };
  /** A 'sit' pose was requested and not yet stood up from; `keepSeated` holds it until the activity ends. */
  seated: boolean; keepSeated?: boolean;
  /** Hits reported for the rhythm step, and whether the activity fell short of `need`. */
  hits?: number; partial: boolean;
}
export interface CampusEventProgress { version: 1; completed: Record<string, number>; rewarded: string[]; achieved?: string[] }
export interface CampusEventOptions { storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>; now?: () => number; onChange?: () => void; onStorageError?: () => void }

export const CAMPUS_EVENTS_KEY = 'nsysu-campus-events-v1';
export const EVENT_RADIUS = 25, BANNER_SPACING = 8, INVITE_TIMEOUT = 45, ACTIVITY_TIMEOUT = 90, ACTIVITY_COOLDOWN = 600, KEEP_AWAY_HOLD = 2, MAX_RHYTHM_CUES = 64;
export const EVENT_BANNER_TITLE = '校園事件';
const fresh = (): CampusEventProgress => ({ version: 1, completed: {}, rewarded: [] });
export const anchorZone = (anchor: string) => anchor.startsWith('zone:') ? anchor.slice(5) : '';
const TARGET = /^(zone|npc|spot):./;
const positive = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0;
/** Ids act() answers to: action and rhythm steps share one namespace. */
const actIds = (steps: readonly ActivityStep[]) => steps.flatMap(s => s.kind === 'action' || s.kind === 'rhythm' ? [s.id] : []);
const rhythmSpec = (s: RhythmSpec): RhythmSpec => ({ id: s.id, cues: s.cues, interval: s.interval, lead: s.lead, window: s.window, need: s.need, ...(s.style !== undefined ? { style: s.style } : {}) });

export function validateEvents(events: readonly CampusEventDefinition[]): string[] {
  const errors: string[] = [], ids = new Set<string>();
  for (const e of events) {
    if (!e.id || ids.has(e.id)) errors.push(`duplicate event ${e.id}`); ids.add(e.id);
    if (!/^(zone|npc):./.test(e.anchor ?? '')) errors.push(`event ${e.id}: anchor must be zone:<id> or npc:<id>`);
    if (!e.banner) errors.push(`event ${e.id}: missing banner`);
    if (!Array.isArray(e.npcs)) errors.push(`event ${e.id}: npcs must be a list`);
    for (const l of e.lines ?? []) if (!e.npcs.includes(l.who)) errors.push(`event ${e.id}: line by ${l.who}, who is not a participant`);
    const a = e.activity;
    if (!a) continue;
    const at = `event ${e.id}`;
    if (!a.id || !a.host || !a.invite || !a.accept || !a.decline) errors.push(`${at}: activity needs id, host, invite, accept and decline`);
    if (a.host && Array.isArray(e.npcs) && !e.npcs.includes(a.host)) errors.push(`${at}: host ${a.host} is not a participant`);
    if (!a.steps?.length) errors.push(`${at}: activity has no steps`);
    if (!a.journal?.title || !a.journal.done || !a.journal.abandoned) errors.push(`${at}: activity journal needs title, done and abandoned`);
    const acts = actIds(a.steps ?? []);
    if (new Set(acts).size !== acts.length) errors.push(`${at}: duplicate action id`);
    for (const s of a.steps ?? []) {
      if (!s.text) errors.push(`${at}: step without text`);
      if (s.kind === 'stay') {
        if (!TARGET.test(s.target ?? '') || !positive(s.max) || !positive(s.hold)) errors.push(`${at}: stay step needs target zone:/npc:/spot:, max > 0 and hold > 0`);
        if (s.keepSeated && !s.sit) errors.push(`${at}: keepSeated needs sit`);
      } else if (s.kind === 'rhythm') {
        if (!s.id || !Number.isInteger(s.cues) || s.cues < 1 || s.cues > MAX_RHYTHM_CUES || !positive(s.interval) || !positive(s.lead)
          || typeof s.window !== 'number' || !(s.window >= 0) || !(s.window < s.interval / 2) || !Number.isInteger(s.need) || s.need < 1 || s.need > s.cues)
          errors.push(`${at}: rhythm step ${s.id ?? '?'} needs id, 1..${MAX_RHYTHM_CUES} cues, interval > 0, lead > 0, 0 <= window < interval/2 and 1 <= need <= cues`);
      }
    }
    const rhythm = (a.steps ?? []).some(s => s.kind === 'rhythm');
    if (a.journal?.partial !== undefined && !a.journal.partial.includes('{hits}')) errors.push(`${at}: journal.partial must contain {hits}`);
    if (rhythm && !a.journal?.partial) errors.push(`${at}: a rhythm step needs journal.partial`);
    if (a.achievement !== undefined && (typeof a.achievement !== 'string' || !a.achievement)) errors.push(`${at}: achievement must be an id`);
    const requests = [...(a.prepare ?? []), ...(a.onDone ?? []), ...(a.onEnd ?? []), ...(a.steps ?? []).flatMap(s => s.then ?? [])];
    for (const r of requests) {
      if (r.kind === 'say') {
        if (Array.isArray(e.npcs) && !e.npcs.includes(r.who)) errors.push(`${at}: say by ${r.who}, who is not a participant`);
        if (r.if !== undefined && !(r.if.quest && r.if.step && r.if.choice)) errors.push(`${at}: say.if needs quest, step and choice`);
      } else if (r.kind === 'pose' && r.pose !== 'sit' && r.pose !== 'stand') errors.push(`${at}: pose must be sit or stand`);
    }
  }
  return errors;
}

export class CampusEventEngine {
  readonly progress: CampusEventProgress = fresh();
  activity?: ActiveActivity;
  private elapsed = 0;
  private preset = '';
  private shown = new Set<string>();
  private lastBanner = -Infinity;
  private lastActivity: Record<string, number> = {};
  private serial = 0;
  private storage?: CampusEventOptions['storage'];
  /** The world of the latest update(): act() has none of its own but may finish an activity whose `say.if` needs questChoice. */
  private world?: CampusEventWorld;
  private readonly now: () => number;
  constructor(readonly events: readonly CampusEventDefinition[], private options: CampusEventOptions = {}) {
    this.now = options.now ?? Date.now;
    try {
      this.storage = options.storage ?? (typeof localStorage !== 'undefined' ? localStorage : undefined);
      const read = readSave(this.storage, CAMPUS_EVENTS_KEY);
      if (read.corrupt && !read.recovered) options.onStorageError?.();
      if (read.value !== undefined) this.restore(read.value);
    } catch { options.onStorageError?.(); }
  }
  /** Only completions, granted stamps and achievements come back; an activity that was in progress is gone, by design. */
  restore(raw: unknown) {
    if (!raw || typeof raw !== 'object') return;
    const p = raw as Partial<CampusEventProgress>;
    const strings = (list: unknown) => Array.isArray(list) ? [...new Set(list.filter((x): x is string => typeof x === 'string'))] : [];
    this.progress.completed = {};
    for (const [id, n] of Object.entries(p.completed ?? {})) if (typeof n === 'number' && Number.isInteger(n) && n > 0) this.progress.completed[id] = n;
    this.progress.rewarded = strings(p.rewarded);
    const achieved = strings(p.achieved);
    if (achieved.length) this.progress.achieved = achieved; else delete this.progress.achieved;
  }
  snapshot(): CampusEventProgress {
    return { version: 1, completed: { ...this.progress.completed }, rewarded: [...this.progress.rewarded], ...(this.progress.achieved?.length ? { achieved: [...this.progress.achieved] } : {}) };
  }
  /** Read-only clock for diagnostics. */
  get diagnostics() { return { elapsed: this.elapsed, preset: this.preset, shown: [...this.shown], lastActivity: { ...this.lastActivity } }; }

  /** Exploration time only: the runtime passes `paused` while a dialogue, the notebook, a photo or a chase has the screen. */
  update(dt: number, world: CampusEventWorld, paused = false): CampusEventCommand[] {
    this.world = world;
    if (paused || !Number.isFinite(dt) || dt <= 0) return [];
    const out: CampusEventCommand[] = [];
    this.elapsed += dt;
    const time = world.timeOfDay();
    if (time !== this.preset) { this.preset = time; this.shown.clear(); if (this.activity) this.stop(this.activity.phase === 'active' ? 'abandoned' : 'left', out); }
    if (this.activity) { this.tick(dt, world, out); return out; }
    if (this.elapsed - this.lastBanner < BANNER_SPACING) return out;
    for (const ev of this.events) {
      if (ev.when !== time || this.shown.has(ev.id) || world.distanceTo(ev.anchor) > (ev.radius ?? EVENT_RADIUS)) continue;
      this.shown.add(ev.id); this.lastBanner = this.elapsed;
      out.push({ kind: 'banner', text: ev.banner, title: EVENT_BANNER_TITLE, sound: 'chime' });
      out.push({ kind: 'journal', entry: { id: `event:${ev.id}:${this.now()}:${++this.serial}`, kind: 'event', title: ev.title ?? ev.banner, text: ev.journal ?? ev.banner, zone: ev.zone ?? anchorZone(ev.anchor), npc: ev.npcs[0] ?? '' } });
      for (const line of ev.lines ?? []) if (world.npcPresent?.(line.who) !== false) out.push({ kind: 'request', request: { kind: 'say', who: line.who, text: line.text } });
      const a = ev.activity;
      if (a && this.elapsed - (this.lastActivity[a.id] ?? -Infinity) >= (a.cooldown ?? ACTIVITY_COOLDOWN) && world.npcPresent?.(a.host) !== false) {
        this.activity = { event: ev, definition: a, phase: 'preparing', step: 0, remaining: a.inviteDelay ?? 0, held: 0, instance: `${this.now()}:${this.serial}`, seated: false, partial: false };
        for (const r of a.prepare ?? []) this.request(r, out);
        if (this.activity.remaining <= 0) this.invite(out);
      }
      break;
    }
    return out;
  }
  /** A `say` with `if` goes out only when that side-quest choice was made (unknown without questChoice: not said). */
  private request(r: ActivityRequest, out: CampusEventCommand[]) {
    if (r.kind === 'say' && r.if && this.world?.questChoice?.(r.if.quest, r.if.step) !== r.if.choice) return;
    out.push({ kind: 'request', request: r });
  }
  private invite(out: CampusEventCommand[]) {
    const a = this.activity!;
    a.phase = 'invited'; a.remaining = INVITE_TIMEOUT;
    out.push({ kind: 'invite', activity: a.definition.id, host: a.definition.host, text: a.definition.invite, accept: a.definition.accept, decline: a.definition.decline });
    this.options.onChange?.();
  }
  private tick(dt: number, world: CampusEventWorld, out: CampusEventCommand[]) {
    const a = this.activity!;
    a.remaining -= dt;
    if (a.phase === 'preparing') {
      if (a.remaining > 0) return;
      if (world.distanceTo(a.event.anchor) > (a.event.radius ?? EVENT_RADIUS)) { this.stop('left', out); return; }
      this.invite(out); return;
    }
    if (a.phase === 'invited') { if (a.remaining <= 0) this.stop('left', out); return; }
    if (a.remaining <= 0) { this.stop('abandoned', out); return; }
    const step = a.definition.steps[a.step];
    if (!step) { this.finish(out); return; }
    let done = false;
    if (step.kind === 'action') done = !!step.needs && world.hasItem?.(step.needs) === false;  // nothing to stash: the step does not apply
    else if (step.kind === 'keepAway') { a.held = world.distanceTo(`npc:${step.npc}`) >= step.min ? a.held + dt : 0; done = a.held >= (step.hold ?? KEEP_AWAY_HOLD); }
    else if (step.kind === 'stay') {
      const there = world.distanceTo(step.target) <= step.max, moving = !!step.still && world.playerMoving?.() === true;
      a.held = there && !moving ? a.held + dt : 0;
      a.stepProgress = { held: Math.min(a.held, step.hold), hold: step.hold };
      done = a.held >= step.hold;
    }
    else if (step.kind === 'rhythm') done = false;  // the runtime reports it through act(id, { hits })
    else done = world.distanceTo(step.target) <= step.max;
    if (done) this.completeStep(out);
  }
  /** Objective and start-of-step requests (seat the player, start the rhythm) for the current step. */
  private startStep(out: CampusEventCommand[]) {
    const a = this.activity!, step = a.definition.steps[a.step];
    if (!step) return;
    out.push({ kind: 'objective', text: step.text });
    if (step.kind === 'stay') {
      a.stepProgress = { held: 0, hold: step.hold };
      if (step.sit) { if (!a.seated) out.push({ kind: 'request', request: { kind: 'pose', pose: 'sit', at: step.target } }); a.seated = true; a.keepSeated = !!step.keepSeated; }  // already seated (keepSeated): no second sit
    } else if (step.kind === 'rhythm') out.push({ kind: 'rhythm', ...rhythmSpec(step) });
  }
  private standUp(out: CampusEventCommand[]) {
    const a = this.activity!;
    if (!a.seated) return;
    a.seated = false; a.keepSeated = false; out.push({ kind: 'request', request: { kind: 'pose', pose: 'stand' } });
  }
  private completeStep(out: CampusEventCommand[]) {
    const a = this.activity!, step = a.definition.steps[a.step];
    if (!a.keepSeated) this.standUp(out);  // keepSeated: stop() stands the player up when the activity ends
    for (const r of step?.then ?? []) this.request(r, out);
    a.step++; a.held = 0; a.stepProgress = undefined;
    if (a.definition.steps[a.step]) { this.startStep(out); this.options.onChange?.(); }
    else this.finish(out);
  }
  /** The player answered the invitation. */
  respond(accepted: boolean, out: CampusEventCommand[] = []): CampusEventCommand[] | false {
    const a = this.activity;
    if (!a || a.phase !== 'invited') return false;
    if (!accepted) { this.stop('declined', out); return out; }
    a.phase = 'active'; a.remaining = a.definition.timeout ?? ACTIVITY_TIMEOUT; a.step = 0; a.held = 0;
    if (a.definition.steps[0]) this.startStep(out); else out.push({ kind: 'objective', text: undefined });
    this.options.onChange?.();
    return out;
  }
  /** The player did an action step (its id), e.g. stashed the snack, or the runtime reports the rhythm step: act(id, { hits }).
   * Only the current step counts. */
  act(actionId: string, result?: { hits: number }, out: CampusEventCommand[] = []): CampusEventCommand[] | false {
    const a = this.activity, step = a ? a.definition.steps[a.step] : undefined;
    if (!a || a.phase !== 'active' || !step || (step.kind !== 'action' && step.kind !== 'rhythm') || step.id !== actionId) return false;
    if (step.kind === 'rhythm') {
      const hits = Number.isFinite(result?.hits) ? Math.max(0, Math.min(step.cues, Math.floor(result!.hits))) : 0;
      a.hits = hits; if (hits < step.need) a.partial = true;
    }
    this.completeStep(out); return out;
  }
  /** What the player can do right now, for the interaction list. */
  pendingAction(): { id: string; text: string; needs?: string } | undefined {
    const a = this.activity, step = a ? a.definition.steps[a.step] : undefined;
    return a?.phase === 'active' && step?.kind === 'action' ? { id: step.id, text: step.text, needs: step.needs } : undefined;
  }
  /** The player walks away or cancels: no penalty, borrowed people go back, a journal line notes it when the activity had begun. */
  leave(out: CampusEventCommand[] = []): CampusEventCommand[] | false {
    const a = this.activity;
    if (!a) return false;
    this.stop(a.phase === 'active' ? 'abandoned' : 'left', out); return out;
  }
  private finish(out: CampusEventCommand[]) {
    const a = this.activity!, d = a.definition, partial = a.partial;
    for (const r of d.onDone ?? []) this.request(r, out);
    this.progress.completed[d.id] = (this.progress.completed[d.id] ?? 0) + 1;
    const first = !partial && !!d.reward && !this.progress.rewarded.includes(d.reward);
    if (first) this.progress.rewarded.push(d.reward!);
    const achieved = !partial && !!d.achievement && !(this.progress.achieved ?? []).includes(d.achievement);
    if (achieved) (this.progress.achieved ??= []).push(d.achievement!);
    const result = partial ? (d.journal.partial ?? d.journal.done).replace(/\{hits\}/g, String(a.hits ?? 0)) : d.journal.done;
    out.push({ kind: 'journal', entry: { id: `activity:${d.id}:${a.instance}`, kind: 'event', title: d.journal.title, text: a.event.journal ?? a.event.banner, zone: a.event.zone ?? anchorZone(a.event.anchor), npc: d.host, choice: '參與並完成', result, reward: first ? d.reward : undefined } });
    if (d.counter && !partial) out.push({ kind: 'counter', id: d.counter });
    if (first) out.push({ kind: 'reward', id: d.reward! });
    if (achieved) out.push({ kind: 'achievement', id: d.achievement! });
    this.stop('done', out);
  }
  private stop(how: 'done' | 'declined' | 'abandoned' | 'left', out: CampusEventCommand[]) {
    const a = this.activity!, d = a.definition;
    this.standUp(out);
    if (how === 'abandoned' || (how === 'declined' && d.journal.declined)) out.push({ kind: 'journal', entry: { id: `activity:${d.id}:${a.instance}`, kind: 'event', title: d.journal.title, text: a.event.journal ?? a.event.banner, zone: a.event.zone ?? anchorZone(a.event.anchor), npc: d.host, choice: how === 'declined' ? '這次先不參加' : '中途離開', result: how === 'declined' ? d.journal.declined : d.journal.abandoned } });
    for (const r of d.onEnd ?? []) this.request(r, out);
    out.push({ kind: 'objective' });
    if (how !== 'left') this.lastActivity[d.id] = this.elapsed;
    this.activity = undefined;
    if (how === 'done') this.save(); else this.options.onChange?.();
  }
  private save() { try { writeSave(this.storage, CAMPUS_EVENTS_KEY, this.snapshot()); } catch { this.options.onStorageError?.(); } this.options.onChange?.(); }
  clear() { Object.assign(this.progress, fresh()); delete this.progress.achieved; this.activity = undefined; this.lastActivity = {}; try { removeSave(this.storage, CAMPUS_EVENTS_KEY); } catch { /* nothing to keep */ } this.options.onChange?.(); }
}
