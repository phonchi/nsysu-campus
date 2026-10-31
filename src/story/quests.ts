/** Persistent side quests and journal; never touches the v3/v4 player saves. */
export interface QuestChoice { id: string; label: string; result: string }
export interface QuestStep { id: string; target: string; text: string; lines?: { who: string; text: string }[]; radius?: number; kind?: 'interact' | 'photo'; choices?: QuestChoice[]; when?: string }
export interface QuestDefinition { id: string; title: string; zone: string; npc: string; description: string; reward: string; accept: { near: string; chapterDone?: string; lines?: { who: string; text: string }[] }; absent?: Record<string, string>; steps: QuestStep[] }
export interface QuestData { version: number; quests: QuestDefinition[] }
export interface QuestState { status: 'active' | 'completed'; step: number; choices: Record<string, string>; photoBaseline?: number }
export interface JournalEntry { id: string; kind: 'quest' | 'encounter' | 'legacy'; title: string; text: string; at: number; zone: string; npc: string; choice?: string; result?: string; reward?: string }
export interface QuestProgress { version: 1; quests: Record<string, QuestState>; journal: JournalEntry[]; rewards: string[]; tracked?: string; legacySnapshotTaken?: boolean }
export interface QuestWorld { distanceTo(target: string): number; timeOfDay(): string; photoCount?: number; chapterDone?(id: string): boolean }
export interface QuestView { definition: QuestDefinition; state?: QuestState; step?: QuestStep }
export interface QuestOptions { storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>; now?: () => number; onChange?: () => void; onStorageError?: () => void }
export const QUEST_KEY = 'nsysu-campus-journal-v5';
const fresh = (): QuestProgress => ({ version: 1, quests: {}, journal: [], rewards: [] });
export function validateQuests(data: QuestData): string[] {
  const errors: string[] = [], ids = new Set<string>();
  for (const q of data.quests) {
    if (!q.id || ids.has(q.id)) errors.push(`duplicate quest ${q.id}`); ids.add(q.id);
    if (q.steps.length < 2) errors.push(`short quest ${q.id}`);
    if (!q.steps.some(s => (s.choices?.length ?? 0) >= 2)) errors.push(`missing choice ${q.id}`);
    if (new Set(q.steps.map(s => s.id)).size !== q.steps.length) errors.push(`duplicate step ${q.id}`);
    for (const s of q.steps) if (s.choices && new Set(s.choices.map(c => c.id)).size !== s.choices.length) errors.push(`duplicate choice ${q.id}/${s.id}`);
  }
  return errors;
}
export class QuestEngine {
  readonly progress: QuestProgress = fresh();
  private storage?: QuestOptions['storage'];
  private readonly now: () => number;
  private hadExistingSave = false;
  constructor(readonly data: QuestData, private options: QuestOptions = {}) {
    this.now = options.now ?? Date.now;
    try {
      this.storage = options.storage ?? (typeof localStorage !== 'undefined' ? localStorage : undefined);
      const raw = this.storage?.getItem(QUEST_KEY);
      if (raw) { this.hadExistingSave = true; this.restore(JSON.parse(raw)); }
    } catch { options.onStorageError?.(); }
  }
  private restore(raw: unknown) {
    if (!raw || typeof raw !== 'object') return;
    const p = raw as Partial<QuestProgress>;
    this.progress.legacySnapshotTaken = p.legacySnapshotTaken === true;
    for (const q of this.data.quests) {
      const s = p.quests?.[q.id];
      if (!s || !['active', 'completed'].includes(s.status) || !Number.isInteger(s.step) || s.step < 0 || s.step > q.steps.length) continue;
      const choices: Record<string, string> = {};
      for (const step of q.steps) if (step.choices?.some(c => c.id === s.choices?.[step.id])) choices[step.id] = s.choices[step.id];
      this.progress.quests[q.id] = { status: s.status, step: s.status === 'completed' ? q.steps.length : Math.min(s.step, q.steps.length - 1), choices, photoBaseline: typeof s.photoBaseline === 'number' ? s.photoBaseline : 0 };
    }
    if (Array.isArray(p.rewards)) this.progress.rewards = [...new Set(p.rewards.filter(x => typeof x === 'string'))];
    if (Array.isArray(p.journal)) {
      const seen = new Set<string>();
      this.progress.journal = p.journal.filter((x): x is JournalEntry => !!x && typeof x.id === 'string' && !seen.has(x.id) && !!seen.add(x.id) && typeof x.title === 'string' && typeof x.text === 'string' && Number.isFinite(x.at) && typeof x.zone === 'string' && typeof x.npc === 'string' && ['quest', 'encounter', 'legacy'].includes(x.kind));
    }
    // Pre-marker v5 builds may already have mislabeled current facts as 'before the update'.
    // Retain the evidence and stable IDs, but do not assert an unknowable source version.
    if (p.legacySnapshotTaken !== true) this.progress.journal = this.progress.journal.map(entry =>
      entry.kind === 'legacy' ? { ...entry, title: '過往進度', text: '來源版本未記錄，無詳細經過。' } : entry);
    if (p.tracked && this.data.quests.some(q => q.id === p.tracked) && this.progress.quests[p.tracked]?.status !== 'completed') this.progress.tracked = p.tracked;
  }
  list(): QuestView[] { return this.data.quests.map(definition => { const state = this.progress.quests[definition.id]; return { definition, state, step: state?.status === 'active' ? definition.steps[state.step] : undefined }; }); }
  unlocked(q: QuestDefinition, world: QuestWorld) { return !q.accept.chapterDone || world.chapterDone?.(q.accept.chapterDone) === true; }
  acceptable(world: QuestWorld): QuestView[] {
    // A first step spoken by the same NPC plays on acceptance, so it must be possible right now.
    return this.list().filter(v => { const first = v.definition.steps[0]; return !v.state && this.unlocked(v.definition, world) && world.distanceTo(v.definition.accept.near) <= 4 && (first.target !== v.definition.accept.near || !first.when || first.when === world.timeOfDay()); });
  }
  accept(id: string, world?: QuestWorld) {
    const q = this.data.quests.find(q => q.id === id);
    if (!q || !world || !this.acceptable(world).some(v => v.definition.id === id)) return false;
    this.progress.quests[id] = { status: 'active', step: 0, choices: {}, photoBaseline: world?.photoCount ?? 0 };
    this.progress.tracked = id;
    this.entry({ id: `${id}:accepted`, kind: 'quest', title: q.title, text: q.description, zone: q.zone, npc: q.npc }); this.save(); return true;
  }
  track(id?: string) { if (id && (!this.data.quests.some(q => q.id === id) || this.progress.quests[id]?.status === 'completed')) return false; this.progress.tracked = id; this.save(); return true; }
  private reachable(step: QuestStep, world: QuestWorld) { return world.distanceTo(step.target) <= (step.radius ?? 4) && (!step.when || step.when === world.timeOfDay()); }
  candidate(world: QuestWorld, includeZones = false): QuestView | undefined {
    return this.list().filter(v => v.step && v.step.kind !== 'photo' && (includeZones || v.step.target.startsWith('npc:')) && this.reachable(v.step, world)).sort((a, b) => Number(b.definition.id === this.progress.tracked) - Number(a.definition.id === this.progress.tracked) || world.distanceTo(a.step!.target) - world.distanceTo(b.step!.target))[0];
  }
  interact(id: string, world: QuestWorld) {
    const v = this.list().find(v => v.definition.id === id);
    if (!v?.step || !v.state || !this.reachable(v.step, world) || v.step.choices?.length) return false;
    if (v.step.kind === 'photo') return false;
    this.advance(v, undefined, world.photoCount); return true;
  }
  choose(id: string, choiceId: string, world?: QuestWorld) {
    const v = this.list().find(v => v.definition.id === id), c = v?.step?.choices?.find(c => c.id === choiceId);
    if (!v?.state || !v.step || !c || !world || !this.reachable(v.step, world)) return false;
    this.advance(v, c, world.photoCount); return true;
  }
  /** Photos are consumed only at the successful shutter event, never by arriving later. */
  notifyPhoto(world: QuestWorld): number {
    let advanced = 0;
    for (const v of this.list()) if (v.step?.kind === 'photo' && !v.step.choices?.length && this.reachable(v.step, world)) { this.advance(v); advanced++; }
    return advanced;
  }
  update(_world: QuestWorld) { /* Spatial polling never retroactively submits photos. */ }
  private advance(v: QuestView, choice?: QuestChoice, photoCount?: number) {
    const q = v.definition, s = v.state!, step = v.step!;
    if (choice) s.choices[step.id] = choice.id;
    s.step++; s.photoBaseline = photoCount ?? 0;
    const completed = s.step >= q.steps.length;
    if (completed) { s.status = 'completed'; if (!this.progress.rewards.includes(q.reward)) this.progress.rewards.push(q.reward); if (this.progress.tracked === q.id) this.progress.tracked = undefined; }
    this.entry({ id: `${q.id}:${step.id}`, kind: 'quest', title: q.title, text: step.text, zone: q.zone, npc: q.npc, choice: choice?.label, result: choice?.result ?? (completed ? '任務完成，謝謝你的幫忙！' : '完成這一步，接著前往下一個地點。'), reward: completed ? q.reward : undefined }); this.save();
  }
  record(entry: Omit<JournalEntry, 'at'>) { if (this.progress.journal.some(e => e.id === entry.id)) return false; if (entry.reward && !this.progress.rewards.includes(entry.reward)) this.progress.rewards.push(entry.reward); this.entry(entry); this.save(); return true; }
  private entry(entry: Omit<JournalEntry, 'at'>) { if (!this.progress.journal.some(e => e.id === entry.id)) this.progress.journal.push({ ...entry, at: this.now() }); }
  private save() { try { this.storage?.setItem(QUEST_KEY, JSON.stringify(this.progress)); } catch { this.options.onStorageError?.(); } this.options.onChange?.(); }
  clear() { Object.assign(this.progress, fresh(), { tracked: undefined, legacySnapshotTaken: true }); this.hadExistingSave = true; this.save(); }
  importLegacy(done: string[], talked: string[]) {
    if (this.progress.legacySnapshotTaken) return;
    this.progress.legacySnapshotTaken = true;
    // Existing v5 saves cannot establish when their v3/v4 facts happened. Preserve them without inventing history.
    if (this.hadExistingSave) { this.save(); return; }
    this.hadExistingSave = true;
    for (const id of done) if (!this.progress.journal.some(e => e.id === `legacy:${id}`)) this.entry({ id: `legacy:${id}`, kind: 'legacy', title: '更新前的導覽紀錄', text: `${id}：更新前已完成，無詳細經過。`, zone: '', npc: '' });
    for (const id of talked) if (!this.progress.journal.some(e => e.id === `legacy:npc:${id}`)) this.entry({ id: `legacy:npc:${id}`, kind: 'legacy', title: '曾經交談的人物', text: '更新前已認識，無詳細經過。', zone: '', npc: id });
    this.save();
  }
}
