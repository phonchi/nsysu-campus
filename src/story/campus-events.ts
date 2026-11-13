/** Campus events (spec-v10 §5): pure logic, no DOM and no three.js, so fixtures drive it in node tests.
 *
 * An event fires at its anchor (`zone:<id>` or `npc:<id>`), never at a participant: once per time of day, when the player is
 * within `radius` of the anchor, the engine asks for a banner, writes one journal entry (kind 'event') and asks each present
 * participant to say a line. An event may carry an `activity`: a short invitation → action → result loop (the daytime macaque
 * pilot). The engine only *requests* NPC moves and lines; the runtime (WP-A) owns the NPCs and executes requests.
 *
 * API
 *   const events = new CampusEventEngine(definitions, { storage?, now?, onChange? });
 *   events.update(dt, world, paused?)  → CampusEventCommand[]  every frame; nothing moves while paused
 *   events.respond(accepted)           → boolean               the player answered the invitation
 *   events.act(actionId)               → boolean               the player did an 'action' step (e.g. 'stash')
 *   events.leave()                     → boolean               the player cancels or walks away: abandoned, no penalty
 *   events.activity                                            the activity in progress (undefined when none)
 *   events.progress                                            what persists: completions and granted rewards
 *   events.restore(raw) / events.snapshot()                    persistence hooks (the constructor uses `storage` when given)
 *
 * Lifecycle of an activity: idle → (event fires, `prepare` requests go out) → invited (after `inviteDelay` s, if the player is
 * still near the anchor) → active (steps in order; `timeout` s) → done | declined | abandoned → cooldown. Only completions and
 * rewards persist: a reload always starts idle, and a reward is granted once ever while the counter counts every completion.
 *
 * Commands the runtime executes, in order:
 *   banner    show the event banner (title '校園事件') with an optional sound cue
 *   journal   record the entry through QuestEngine.record() (it dedupes by id and grants `reward` once)
 *   request   { move | say | release }: borrow an NPC and walk it to a target, have an NPC say a line, or give it back
 *   invite    show the invitation with its accept/decline labels; answer with respond()
 *   objective show what to do now (text) or clear it (no text)
 *   counter   increment a collection counter (the '哨子' stamp counts completions)
 *   reward    a stamp was granted for the first time (feedback only; the journal entry already carries it)
 */
import { readSave, removeSave, writeSave } from './save-guard';
import type { JournalEntry } from './quests';

export interface EventLine { who: string; text: string }
export type ActivityRequest = { kind: 'move'; npc: string; to: string } | { kind: 'say'; who: string; text: string } | { kind: 'release'; npc: string };
export type ActivityStep =
  /** The runtime offers it (E or a button); done when it calls act(id). `needs` names an item the player must hold for the action to apply, otherwise the step is skipped. */
  | { kind: 'action'; id: string; text: string; needs?: string; then?: ActivityRequest[] }
  /** Stay at least `min` m from the NPC for `hold` s (default 2). */
  | { kind: 'keepAway'; npc: string; min: number; hold?: number; text: string; then?: ActivityRequest[] }
  /** Be within `max` m of a target (zone:/npc:/spot:). */
  | { kind: 'near'; target: string; max: number; text: string; then?: ActivityRequest[] };
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
  /** Requested once the last step is done (the macaque walks back, the host responds). */
  onDone?: ActivityRequest[];
  /** Requested whenever the activity stops, done or not (release borrowed NPCs). */
  onEnd?: ActivityRequest[];
  /** Seconds the active phase may take (default 90); the invitation itself expires after 45 s. */
  timeout?: number;
  /** Seconds before the activity may be offered again (default 600 of exploration time). */
  cooldown?: number;
  journal: { title: string; done: string; abandoned: string; declined?: string };
  /** Stamp granted on the first completion only. */
  reward?: string;
  /** Collection counter incremented on every completion. */
  counter?: string;
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
export interface CampusEventWorld { timeOfDay(): string; distanceTo(target: string): number; hasItem?(id: string): boolean; npcPresent?(id: string): boolean }
export type CampusEventCommand =
  | { kind: 'banner'; text: string; title: string; sound?: string }
  | { kind: 'journal'; entry: Omit<JournalEntry, 'at'> }
  | { kind: 'request'; request: ActivityRequest }
  | { kind: 'invite'; activity: string; host: string; text: string; accept: string; decline: string }
  | { kind: 'objective'; text?: string }
  | { kind: 'counter'; id: string }
  | { kind: 'reward'; id: string };
export interface ActiveActivity { event: CampusEventDefinition; definition: ActivityDefinition; phase: 'preparing' | 'invited' | 'active'; step: number; remaining: number; held: number; instance: string }
export interface CampusEventProgress { version: 1; completed: Record<string, number>; rewarded: string[] }
export interface CampusEventOptions { storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>; now?: () => number; onChange?: () => void; onStorageError?: () => void }

export const CAMPUS_EVENTS_KEY = 'nsysu-campus-events-v1';
export const EVENT_RADIUS = 25, BANNER_SPACING = 8, INVITE_TIMEOUT = 45, ACTIVITY_TIMEOUT = 90, ACTIVITY_COOLDOWN = 600, KEEP_AWAY_HOLD = 2;
export const EVENT_BANNER_TITLE = '校園事件';
const fresh = (): CampusEventProgress => ({ version: 1, completed: {}, rewarded: [] });
export const anchorZone = (anchor: string) => anchor.startsWith('zone:') ? anchor.slice(5) : '';

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
    if (!a.id || !a.host || !a.invite || !a.accept || !a.decline) errors.push(`event ${e.id}: activity needs id, host, invite, accept and decline`);
    if (!a.steps?.length) errors.push(`event ${e.id}: activity has no steps`);
    if (!a.journal?.title || !a.journal.done || !a.journal.abandoned) errors.push(`event ${e.id}: activity journal needs title, done and abandoned`);
    const actions = (a.steps ?? []).flatMap(s => s.kind === 'action' ? [s.id] : []);
    if (new Set(actions).size !== actions.length) errors.push(`event ${e.id}: duplicate action id`);
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
  /** Only completions and granted rewards come back; an activity that was in progress is gone, by design. */
  restore(raw: unknown) {
    if (!raw || typeof raw !== 'object') return;
    const p = raw as Partial<CampusEventProgress>;
    this.progress.completed = {};
    for (const [id, n] of Object.entries(p.completed ?? {})) if (typeof n === 'number' && Number.isInteger(n) && n > 0) this.progress.completed[id] = n;
    this.progress.rewarded = Array.isArray(p.rewarded) ? [...new Set(p.rewarded.filter((x): x is string => typeof x === 'string'))] : [];
  }
  snapshot(): CampusEventProgress { return { version: 1, completed: { ...this.progress.completed }, rewarded: [...this.progress.rewarded] }; }
  /** Read-only clock for diagnostics. */
  get diagnostics() { return { elapsed: this.elapsed, preset: this.preset, shown: [...this.shown], lastActivity: { ...this.lastActivity } }; }

  /** Exploration time only: the runtime passes `paused` while a dialogue, the notebook, a photo or a chase has the screen. */
  update(dt: number, world: CampusEventWorld, paused = false): CampusEventCommand[] {
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
        this.activity = { event: ev, definition: a, phase: 'preparing', step: 0, remaining: a.inviteDelay ?? 0, held: 0, instance: `${this.now()}:${this.serial}` };
        for (const r of a.prepare ?? []) out.push({ kind: 'request', request: r });
        if (this.activity.remaining <= 0) this.invite(out);
      }
      break;
    }
    return out;
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
    else done = world.distanceTo(step.target) <= step.max;
    if (done) this.completeStep(out);
  }
  private completeStep(out: CampusEventCommand[]) {
    const a = this.activity!, step = a.definition.steps[a.step];
    for (const r of step?.then ?? []) out.push({ kind: 'request', request: r });
    a.step++; a.held = 0;
    const next = a.definition.steps[a.step];
    if (next) { out.push({ kind: 'objective', text: next.text }); this.options.onChange?.(); }
    else this.finish(out);
  }
  /** The player answered the invitation. */
  respond(accepted: boolean, out: CampusEventCommand[] = []): CampusEventCommand[] | false {
    const a = this.activity;
    if (!a || a.phase !== 'invited') return false;
    if (!accepted) { this.stop('declined', out); return out; }
    a.phase = 'active'; a.remaining = a.definition.timeout ?? ACTIVITY_TIMEOUT; a.step = 0; a.held = 0;
    out.push({ kind: 'objective', text: a.definition.steps[0]?.text });
    this.options.onChange?.();
    return out;
  }
  /** The player did an action step (its id), e.g. stashed the snack. Only the current step counts. */
  act(actionId: string, out: CampusEventCommand[] = []): CampusEventCommand[] | false {
    const a = this.activity, step = a ? a.definition.steps[a.step] : undefined;
    if (!a || a.phase !== 'active' || !step || step.kind !== 'action' || step.id !== actionId) return false;
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
    const a = this.activity!, d = a.definition;
    for (const r of d.onDone ?? []) out.push({ kind: 'request', request: r });
    this.progress.completed[d.id] = (this.progress.completed[d.id] ?? 0) + 1;
    const first = !!d.reward && !this.progress.rewarded.includes(d.reward);
    if (first) this.progress.rewarded.push(d.reward!);
    out.push({ kind: 'journal', entry: { id: `activity:${d.id}:${a.instance}`, kind: 'event', title: d.journal.title, text: a.event.journal ?? a.event.banner, zone: a.event.zone ?? anchorZone(a.event.anchor), npc: d.host, choice: '參與並完成', result: d.journal.done, reward: first ? d.reward : undefined } });
    if (d.counter) out.push({ kind: 'counter', id: d.counter });
    if (first) out.push({ kind: 'reward', id: d.reward! });
    this.stop('done', out);
  }
  private stop(how: 'done' | 'declined' | 'abandoned' | 'left', out: CampusEventCommand[]) {
    const a = this.activity!, d = a.definition;
    if (how === 'abandoned' || (how === 'declined' && d.journal.declined)) out.push({ kind: 'journal', entry: { id: `activity:${d.id}:${a.instance}`, kind: 'event', title: d.journal.title, text: a.event.journal ?? a.event.banner, zone: a.event.zone ?? anchorZone(a.event.anchor), npc: d.host, choice: how === 'declined' ? '這次先不參加' : '中途離開', result: how === 'declined' ? d.journal.declined : d.journal.abandoned } });
    for (const r of d.onEnd ?? []) out.push({ kind: 'request', request: r });
    out.push({ kind: 'objective' });
    if (how !== 'left') this.lastActivity[d.id] = this.elapsed;
    this.activity = undefined;
    if (how === 'done') this.save(); else this.options.onChange?.();
  }
  private save() { try { writeSave(this.storage, CAMPUS_EVENTS_KEY, this.snapshot()); } catch { this.options.onStorageError?.(); } this.options.onChange?.(); }
  clear() { Object.assign(this.progress, fresh()); this.activity = undefined; this.lastActivity = {}; try { removeSave(this.storage, CAMPUS_EVENTS_KEY); } catch { /* nothing to keep */ } this.options.onChange?.(); }
}
