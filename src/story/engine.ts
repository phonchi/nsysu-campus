import type { Action, Chapter, Condition, Line, StoryData } from './schema';

/** What the engine can ask about the world. Targets are `npc:<id>` or `zone:<id>`. */
export interface StoryWorld {
  distanceTo(target: string): number;
  inZone(zone: string): boolean;
  atDestination(code: string): boolean;
  timeOfDay(): string;
}

/** What the engine asks the presentation layer to do. `dialogue` must call `done` when the player finishes it. */
export interface StoryEffects {
  dialogue(lines: Line[], done: () => void): void;
  setObjective(chapter: Chapter, text: string): void;
  showArrow(target: string | null): void;
  setSky(preset: string): void;
  playSound(id: string): void;
  moveNpc(npc: string, anchor: string): void;
  chapterComplete(chapter: Chapter, fact: string | undefined, next: Chapter | undefined): void;
  chapterStart(chapter: Chapter): void;
  unlockSideQuest(id: string): void;
}

export interface StoryProgress {
  active?: string;
  done: string[];
  flags: string[];
  fired: Record<string, string[]>;
  sideQuests: string[];
  /** Last anchor each NPC was sent to, so a resumed save puts everyone back where the story left them. */
  npcAt: Record<string, string>;
}

const strings = (v: unknown) => Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
/** Accept only well-formed fields from storage; anything else falls back to a fresh value. */
export function normalizeProgress(raw: unknown): StoryProgress {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const fired: Record<string, string[]> = {}, npcAt: Record<string, string> = {};
  if (o.fired && typeof o.fired === 'object') for (const [k, v] of Object.entries(o.fired)) fired[k] = strings(v);
  if (o.npcAt && typeof o.npcAt === 'object') for (const [k, v] of Object.entries(o.npcAt)) if (typeof v === 'string') npcAt[k] = v;
  return { active: typeof o.active === 'string' ? o.active : undefined, done: strings(o.done), flags: strings(o.flags), fired, sideQuests: strings(o.sideQuests), npcAt };
}

const KEY = 'nsysu-story-v3';
export function loadProgress(): StoryProgress | undefined {
  try { const raw = localStorage.getItem(KEY); return raw ? normalizeProgress(JSON.parse(raw)) : undefined; } catch { return undefined; }
}
function saveProgress(p: StoryProgress) { try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* private mode: progress lasts this visit */ } }
export function clearProgress() { try { localStorage.removeItem(KEY); } catch { /* ignore */ } }

/** Chapter/step state machine (spec §14.11): `when` is AND, `{any}` is OR, each step fires once,
 * a dialogue blocks the rest of its step until finished, completing a chapter starts the next. */
export class StoryEngine {
  readonly progress: StoryProgress;
  private busy = false;
  private pressed = false;
  private queue: Action[] = [];
  private fact?: string;
  private pending?: string;
  private lastFiredOnPress = false;

  constructor(readonly data: StoryData, private world: StoryWorld, private fx: StoryEffects, saved?: StoryProgress) {
    this.progress = saved ? normalizeProgress(saved) : normalizeProgress({});
    if (this.progress.active && !data.chapters.some(c => c.id === this.progress.active)) this.progress.active = undefined;
  }

  get active() { return this.data.chapters.find(c => c.id === this.progress.active); }
  get finished() { return this.progress.done.length === this.data.chapters.length; }

  /** Re-announce the current chapter after loading a save (objective + arrow), without replaying actions. */
  resume() {
    for (const [npc, anchor] of Object.entries(this.progress.npcAt)) this.fx.moveNpc(npc, anchor);
    const ch = this.active;
    if (!ch) return;
    this.fx.chapterStart(ch);
    this.fx.setObjective(ch, ch.objective);
    for (const s of ch.steps) if (this.firedIn(ch).includes(s.id)) for (const a of s.then) {
      if ('showArrow' in a) this.fx.showArrow(a.showArrow);
      if ('setObjective' in a) this.fx.setObjective(ch, a.setObjective);
    }
  }

  /** Unlock a side quest from outside the chapters (NPC dialogue, spec §15.3); saved with the story. */
  unlockSideQuest(id: string) {
    if (this.progress.sideQuests.includes(id) || !this.data.sideQuests.some(q => q.id === id)) return;
    this.progress.sideQuests.push(id); saveProgress(this.progress); this.fx.unlockSideQuest(id);
  }

  /** The player pressed E. Returns true when a story step consumed the press. */
  press(): boolean {
    if (this.busy) return false;
    this.pressed = true;
    const fired = this.update();
    this.pressed = false;
    // Only a step that waited for E consumes the key; steps with other conditions would have fired anyway.
    return fired && this.lastFiredOnPress;
  }

  /** Read-only E preview: never starts a chapter, fires actions or creates fired arrays. */
  canPress(): boolean {
    if (this.busy || !this.active) return false;
    const containsPress = (c: Condition): boolean => 'press' in c || ('any' in c && c.any.some(containsPress));
    const ready = (c: Condition): boolean => 'press' in c ? true : 'any' in c ? c.any.some(ready) : this.holds(c);
    const firstReady = this.active.steps.find(step => !(this.progress.fired[this.active!.id] ?? []).includes(step.id) && step.when.every(ready));
    return !!firstReady?.when.some(containsPress);
  }

  /** Evaluate the active chapter; returns whether any step fired. */
  update(): boolean {
    if (this.busy) return false;
    if (!this.active) this.startNext();
    const ch = this.active;
    if (!ch) return false;
    for (const step of ch.steps) {
      if (this.firedIn(ch).includes(step.id)) continue;
      if (!step.when.every(c => this.holds(c))) continue;
      // The step is committed only after all its actions ran: quitting mid-dialogue replays it next time.
      this.pending = step.id;
      this.lastFiredOnPress = step.when.some(c => 'press' in c || ('any' in c && c.any.some(x => 'press' in x)));
      this.queue.push(...step.then);
      this.run(ch);
      return true;
    }
    return false;
  }

  private firedIn(ch: Chapter) { return this.progress.fired[ch.id] ??= []; }

  private startNext() {
    const next = this.data.chapters.find(c => !this.progress.done.includes(c.id) && c.start.when.every(x => this.holds(x)));
    if (!next) return;
    this.progress.active = next.id; this.fact = undefined;
    saveProgress(this.progress);
    this.fx.chapterStart(next);
    this.fx.setObjective(next, next.objective);
  }

  private holds(c: Condition): boolean {
    if ('any' in c) return c.any.some(x => this.holds(x));
    if ('near' in c) return this.world.distanceTo(c.near) <= (c.r ?? 3);
    if ('press' in c) return this.pressed;
    if ('flag' in c) return this.progress.flags.includes(c.flag);
    if ('chapterDone' in c) return this.progress.done.includes(c.chapterDone);
    if ('inZone' in c) return this.world.inZone(c.inZone);
    if ('atDestination' in c) return this.world.atDestination(c.atDestination);
    if ('timeOfDay' in c) return this.world.timeOfDay() === c.timeOfDay;
    return false;
  }

  private run(ch: Chapter) {
    while (this.queue.length) {
      const a = this.queue.shift()!;
      if ('dialogue' in a) {
        const lines = this.data.dialogues[a.dialogue] ?? [];
        // Narrator lines are the chapter's verified history note: shown on the completion card, not in the dialogue box.
        const fact = lines.filter(l => l.who === 'narrator').map(l => l.text.replace(/^【校史小知識】/, '')).pop();
        if (fact) this.fact = fact;
        const spoken = lines.filter(l => l.who !== 'narrator');
        if (!spoken.length) continue;
        this.busy = true;
        this.fx.dialogue(spoken, () => { this.busy = false; this.run(ch); });
        return;
      }
      if ('setFlag' in a) { if (!this.progress.flags.includes(a.setFlag)) this.progress.flags.push(a.setFlag); }
      else if ('setObjective' in a) this.fx.setObjective(ch, a.setObjective);
      else if ('showArrow' in a) this.fx.showArrow(a.showArrow);
      else if ('setSky' in a) this.fx.setSky(a.setSky);
      else if ('playSound' in a) this.fx.playSound(a.playSound);
      else if ('moveNpc' in a) { this.progress.npcAt[a.moveNpc[0]] = a.moveNpc[1]; this.fx.moveNpc(...a.moveNpc); }
      else if ('unlockSideQuest' in a) { if (!this.progress.sideQuests.includes(a.unlockSideQuest)) this.progress.sideQuests.push(a.unlockSideQuest); this.fx.unlockSideQuest(a.unlockSideQuest); }
      else if ('completeChapter' in a) {
        if (!this.progress.done.includes(ch.id)) this.progress.done.push(ch.id);
        this.progress.active = undefined;
        this.fx.showArrow(null);
        const next = this.data.chapters.find(c => !this.progress.done.includes(c.id) && c.start.when.every(x => this.holds(x)));
        this.fx.chapterComplete(ch, this.fact, next);
      }
    }
    if (this.pending) { const f = this.progress.fired[ch.id] ??= []; if (!f.includes(this.pending)) f.push(this.pending); this.pending = undefined; }
    saveProgress(this.progress);
  }
}
