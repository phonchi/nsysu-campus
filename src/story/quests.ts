/** Persistent side quests and journal; never touches the v3/v4 player saves.
 *
 * ---- v10.2 API（WP-Q 介面契約，Astra 依此接線；spec-v10.2 §1、§3）-------------------------------------------------
 *
 * 資料（public/data/quests.json）
 *   QuestDefinition.accept.times?: TimeOfDay[]      可接時段（只管「新接取」；已接取的支線不受影響）。
 *   QuestDefinition.legacySteps?: Record<retiredStepId, currentStepId>   退休步驟 id → 現行 id（本輪全空，只建機制）。
 *   QuestDefinition.legacyRewards?: string[]        舊 reward 字串（revision-1 契約用；restore() 認得它們）。
 *   QuestDefinition.works?: QuestWork[]             世界成果：{ id, spot, if: QuestCond, variants?: [{ if, kind }] }。
 *   QuestDefinition.completionRewards?: QuestReward[]   完成時發放的收藏品 { kind:'item', itemId, variantBy?: 'return' }。
 *   QuestDefinition.next?: string[]                 作者推薦的下一條（執行期再以 availability／距離過濾）。
 *   QuestCond 只有 { flag } | { notFlag } | { all } | { any }，flag 一律是 quest flag（見下）。
 *
 * 旗標（由 QuestState.choices／status 重建，不寫進 Campus flags）
 *   quest.<questId>.<stepId>.<choiceId>   該步驟選了該選項
 *   quest.<questId>.done                  該支線已完成
 *   QuestEngine.flag(id): boolean         talk.ts 的 facts.flag 多查這一層（只認 `quest.` 開頭）。
 *   QuestEngine.flags(): string[]         目前成立的 quest flags。
 *   questFlags(data): string[]            資料能產生的所有 quest flag（verify_dialogue 的目錄）。
 *
 * 可接狀態
 *   availability(quest, world): QuestAvailability = { state, times, reason, missing? }（reason 沒話說時是空字串）
 *     state 優先序：completed > active > locked > wrong-time > npc-away > available。**不看玩家距離**。
 *     times：accept.times（沒有 times 的舊資料回退到作息交集）。reason：wrong-time／npc-away 時給一句可直接顯示的話。
 *   acceptable(world)：availability 為 available 且與接取 NPC 距離 ≤ 4 m（互動清單用）。
 *   acceptableTimes()（退休，相容匯出）：有 accept.times 就回它，否則舊的作息交集。
 *
 * 世界成果
 *   QuestEngine.worksShown(world): ShownSpot[] = { spot, kind }[]
 *     ＝ 當前步驟的 spot（基礎 kind）∪ 條件成立的 works（variant 的 kind，否則 spot 基礎 kind）；同一 spot 只出現一次，
 *     當前步驟優先。這是「完整顯示集合」：QuestSpotField.sync(worksShown) 即可，sync 也接受只給 id 的舊呼叫。
 *
 * 獎勵
 *   QuestEngine.grants: readonly QuestGrant[] = { key:'quest:<questId>:<itemId>', quest, itemId, variant?, at }[]
 *     完成時發放一次；重載不重發；舊的 completed 存檔在 restore() 補發（variant 依 choices，未知選擇則沒有 variant）。
 *     album.ts 以 grants 合併 Campus items；collection.json 的 quest 收藏品形狀：
 *     { id:'item-quest-<questId>', name, desc, group:'quest', variants: { a:{name,desc}, b:{name,desc} } }（以 choice id 為鍵的物件）。
 *
 * 存檔防護
 *   restore()：completed 先判（步數縮短也保持完成，step 正規化為 steps.length）；active 依 stepId → legacySteps →
 *   legacyStepOrder 索引 → legacySteps 解析，都對不上才重設到第一步並寫一筆手帳。
 * -------------------------------------------------------------------------------------------------------------------- */
import { readSave, removeSave, writeSave } from './save-guard';
import type { QuestSpot, SpotKind, ShownSpot } from '../world/quest-spots';
export type TimeOfDay = 'day' | 'sunset' | 'night';
export const TIMES_OF_DAY: readonly TimeOfDay[] = ['day', 'sunset', 'night'];
export const TIME_LABELS: Record<TimeOfDay, string> = { day: '白天', sunset: '夕陽', night: '夜晚' };
export type QuestCond = { flag: string } | { notFlag: string } | { all: QuestCond[] } | { any: QuestCond[] };
export interface QuestWork { id: string; spot: string; if: QuestCond; variants?: { if: QuestCond; kind: SpotKind }[] }
export interface QuestReward { kind: 'item'; itemId: string; /** The step whose choice picks the item's variant. */ variantBy?: string }
export interface QuestChoice { id: string; label: string; result: string }
/** v11: an official web page a step or a quest points at (spec-v11 §3). Rendered as「開啟官網：<label>」; `isAllowedLink` is the only gate. */
export interface ContentLink { label: string; url: string }
/** At most this many links per step and per quest (spec-v11 §3). */
export const MAX_CONTENT_LINKS = 2;
/** The v11 official-site whitelist, identical to `tools/verify_quests.py:allowed_link` and checked against the shared
 * `tests/fixtures/link-cases.json`: https only, a literal host of `[A-Za-z0-9.-]` (so no credentials, no explicit port, not even
 * 443, no percent-encoding), printable ASCII only, no backslashes, dot segments or percent-encoded `.`/`/`/`\` (so the two URL
 * parsers cannot disagree); then the hostname ends
 * with `.nsysu.edu.tw`, or is `sites.google.com` with a path of `/math.nsysu.edu.tw` or below it. Story `sources` never use it. */
export function isAllowedLink(url: unknown): boolean {
  if (typeof url !== 'string' || !url || url.length > 2048) return false;
  if (!/^[\x21-\x7e]+$/.test(url) || url.includes('\\') || /%(2e|2f|5c)/i.test(url)) return false;
  if (url.slice(0, 8).toLowerCase() !== 'https://') return false;
  const authority = url.slice(8).split(/[/?#]/, 1)[0];
  if (!/^[A-Za-z0-9.-]+$/.test(authority)) return false; // no userinfo, port, percent-encoding or IDN: the host is literal
  const rawPath = url.slice(8 + authority.length).split(/[?#]/, 1)[0];
  if (/(^|\/)\.{1,2}(\/|$)/.test(rawPath)) return false;
  let u: URL;
  try { u = new URL(url); } catch { return false; }
  const host = u.hostname.toLowerCase(), path = u.pathname;
  if (host.length > '.nsysu.edu.tw'.length && host.endsWith('.nsysu.edu.tw')) return true;
  return host === 'sites.google.com' && (path === '/math.nsysu.edu.tw' || path.startsWith('/math.nsysu.edu.tw/'));
}
export interface QuestStep { id: string; target: string; text: string; lines?: { who: string; text: string }[]; radius?: number; kind?: 'interact' | 'photo'; choices?: QuestChoice[]; when?: string; links?: ContentLink[] }
/** `revision` counts content rewrites (1 = the original); a rewrite that reordered steps also lists `legacyStepOrder`, the step
 * ids in revision-1 order, so a save made before `stepId` existed (it only knew its index) still lands on the same step. */
export interface QuestDefinition { id: string; title: string; zone: string; npc: string; description: string; reward: string; revision?: number; legacyStepOrder?: string[]; legacySteps?: Record<string, string>; legacyRewards?: string[]; accept: { near: string; chapterDone?: string; lines?: { who: string; text: string }[]; times?: TimeOfDay[] }; absent?: Record<string, string>; steps: QuestStep[]; works?: QuestWork[]; completionRewards?: QuestReward[]; next?: string[]; links?: ContentLink[] }
/** What a revision-1 save may refer to, kept with the data so that `tools/verify_quests.py` checks every rewrite against it. */
export interface QuestSaveContract { revision: 1; quests: Record<string, { steps: string[]; reward: string; gate: string; choices: Record<string, string[]> }> }
export interface QuestData { version: number; quests: QuestDefinition[]; spots?: Record<string, QuestSpot>; saveContract?: QuestSaveContract }
/** `step` is the index into the current steps; `stepId` is what survives a rewrite (steps keep their id when they move). */
export interface QuestState { status: 'active' | 'completed'; step: number; stepId?: string; revision?: number; choices: Record<string, string>; photoBaseline?: number }
export interface JournalEntry { id: string; kind: 'quest' | 'encounter' | 'legacy' | 'event'; title: string; text: string; at: number; zone: string; npc: string; choice?: string; result?: string; reward?: string }
export const JOURNAL_KINDS: readonly JournalEntry['kind'][] = ['quest', 'encounter', 'legacy', 'event'];
export interface QuestGrant { key: string; quest: string; itemId: string; variant?: string; at: number }
export interface QuestProgress { version: 1; quests: Record<string, QuestState>; journal: JournalEntry[]; rewards: string[]; grants: QuestGrant[]; tracked?: string; legacySnapshotTaken?: boolean }
/** `npcPresent` (spec-v10 §8): is this person on campus at the current time of day? Missing means yes.
 * `npcPresentAt` is the same question for another time of day; with it, `availability()` can say when a blocked quest opens. */
export interface QuestWorld { distanceTo(target: string): number; timeOfDay(): string; photoCount?: number; chapterDone?(id: string): boolean; npcPresent?(npcId: string): boolean; npcPresentAt?(npcId: string, time: string): boolean }
export interface QuestView { definition: QuestDefinition; state?: QuestState; step?: QuestStep }
export type AvailabilityState = 'locked' | 'wrong-time' | 'npc-away' | 'available' | 'active' | 'completed';
export interface QuestAvailability { state: AvailabilityState; /** When a new acceptance is possible. */ times: TimeOfDay[]; /** One sentence for the grey row, the badge and the objective card; empty when there is nothing to say. */ reason: string; /** People off campus now (npc-away). */ missing?: string[] }
export type { ShownSpot };
export interface QuestOptions { storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>; now?: () => number; onChange?: () => void; onStorageError?: () => void; onStep?: (quest: QuestDefinition, next: QuestStep | undefined) => void }
export const QUEST_KEY = 'nsysu-campus-journal-v5';
export const QUEST_FLAG_PREFIX = 'quest.';
export const isQuestFlag = (id: string) => id.startsWith(QUEST_FLAG_PREFIX);
export const questFlag = (quest: string, step: string, choice: string) => `${QUEST_FLAG_PREFIX}${quest}.${step}.${choice}`;
export const questDoneFlag = (quest: string) => `${QUEST_FLAG_PREFIX}${quest}.done`;
export const grantKey = (quest: string, itemId: string) => `quest:${quest}:${itemId}`;
const fresh = (): QuestProgress => ({ version: 1, quests: {}, journal: [], rewards: [], grants: [] });
export const questRevision = (q: QuestDefinition) => q.revision ?? 1;
export const isTimeOfDay = (t: unknown): t is TimeOfDay => typeof t === 'string' && (TIMES_OF_DAY as readonly string[]).includes(t);
export const timesLabel = (times: readonly TimeOfDay[]) => times.map(t => TIME_LABELS[t]).join('、');
/** People a quest's steps talk to, after the one it is accepted from. */
export const chainNpcs = (q: QuestDefinition) => [...new Set(q.steps.flatMap(s => s.target.startsWith('npc:') ? [s.target.slice(4)] : []))];
/** Every quest flag the data can produce: one per choice and one `done` per quest (the catalogue for dialogue validation). */
export const questFlags = (data: QuestData) => data.quests.flatMap(q => [questDoneFlag(q.id), ...q.steps.flatMap(s => (s.choices ?? []).map(c => questFlag(q.id, s.id, c.id)))]);
/** Flags a condition refers to, for validation. */
export const condFlags = (c: QuestCond): string[] => 'flag' in c ? [c.flag] : 'notFlag' in c ? [c.notFlag] : ('all' in c ? c.all : c.any).flatMap(condFlags);
export const evalCond = (c: QuestCond, flag: (id: string) => boolean): boolean => 'flag' in c ? flag(c.flag) : 'notFlag' in c ? !flag(c.notFlag) : 'all' in c ? c.all.every(x => evalCond(x, flag)) : c.any.some(x => evalCond(x, flag));
export function validateQuests(data: QuestData): string[] {
  const errors: string[] = [], ids = new Set<string>(), catalogue = new Set(questFlags(data));
  for (const q of data.quests) {
    if (!q.id || ids.has(q.id)) errors.push(`duplicate quest ${q.id}`); ids.add(q.id);
    if (q.steps.length < 2) errors.push(`short quest ${q.id}`);
    if (!q.steps.some(s => (s.choices?.length ?? 0) >= 2)) errors.push(`missing choice ${q.id}`);
    if (new Set(q.steps.map(s => s.id)).size !== q.steps.length) errors.push(`duplicate step ${q.id}`);
    const checkLinks = (links: unknown, where: string) => {
      if (links === undefined) return;
      if (!Array.isArray(links)) { errors.push(`links ${where}: not an array`); return; }
      if (links.length > MAX_CONTENT_LINKS) errors.push(`links ${where}: more than ${MAX_CONTENT_LINKS}`);
      links.forEach((l: unknown, i) => {
        const link = l as Partial<ContentLink> | null;
        if (!link || typeof link.label !== 'string' || !link.label.trim() || typeof link.url !== 'string') errors.push(`links ${where}[${i}]: needs label and url`);
        else if (!isAllowedLink(link.url)) errors.push(`links ${where}[${i}]: url not allowed ${link.url}`);
      });
    };
    checkLinks(q.links, q.id);
    for (const s of q.steps) {
      if (s.choices && new Set(s.choices.map(c => c.id)).size !== s.choices.length) errors.push(`duplicate choice ${q.id}/${s.id}`);
      if (s.when !== undefined && !isTimeOfDay(s.when)) errors.push(`bad step time ${q.id}/${s.id}`);
      checkLinks(s.links, `${q.id}/${s.id}`);
    }
    if (q.revision !== undefined && (!Number.isInteger(q.revision) || q.revision < 1)) errors.push(`bad revision ${q.id}`);
    if (q.legacyStepOrder) {
      if (questRevision(q) < 2) errors.push(`legacy order without a rewrite ${q.id}`);
      for (const id of q.legacyStepOrder) if (!q.steps.some(s => s.id === id) && !(q.legacySteps && id in q.legacySteps)) errors.push(`legacy step ${q.id}/${id} no longer exists`);
    }
    for (const [from, to] of Object.entries(q.legacySteps ?? {})) {
      if (q.steps.some(s => s.id === from)) errors.push(`legacy step ${q.id}/${from} still exists`);
      if (!q.steps.some(s => s.id === to)) errors.push(`legacy step ${q.id}/${from} maps to missing ${to}`);
    }
    if (q.accept.times !== undefined && (!q.accept.times.length || !q.accept.times.every(isTimeOfDay) || new Set(q.accept.times).size !== q.accept.times.length)) errors.push(`bad accept times ${q.id}`);
    const workIds = new Set<string>();
    for (const w of q.works ?? []) {
      if (!w.id || workIds.has(w.id)) errors.push(`duplicate work ${q.id}/${w.id}`); workIds.add(w.id);
      if (data.spots && !data.spots[w.spot]) errors.push(`work ${q.id}/${w.id}: unknown spot ${w.spot}`);
      for (const f of [w.if, ...(w.variants ?? []).map(v => v.if)].flatMap(condFlags)) if (!catalogue.has(f)) errors.push(`work ${q.id}/${w.id}: unknown flag ${f}`);
    }
    for (const r of q.completionRewards ?? []) {
      if (r.kind !== 'item' || !r.itemId) errors.push(`bad reward ${q.id}`);
      if (r.variantBy && !q.steps.some(s => s.id === r.variantBy && s.choices?.length)) errors.push(`reward ${q.id}/${r.itemId}: variantBy names no choice step`);
    }
  }
  for (const q of data.quests) for (const n of q.next ?? []) if (!ids.has(n)) errors.push(`next ${q.id}: unknown quest ${n}`);
  return errors;
}
/** Which current step an old save's position means: by id first (through `legacySteps` when retired), by revision-1 index
 * second (again through `legacySteps`), nothing when neither fits. */
export function resolveStep(q: QuestDefinition, s: { step?: unknown; stepId?: unknown }): number | undefined {
  const byId = (id: string) => { const i = q.steps.findIndex(x => x.id === id); if (i >= 0) return i; const to = q.legacySteps?.[id]; const j = to === undefined ? -1 : q.steps.findIndex(x => x.id === to); return j < 0 ? undefined : j; };
  if (typeof s.stepId === 'string') return byId(s.stepId);
  if (!Number.isInteger(s.step) || (s.step as number) < 0) return undefined;
  const order = q.legacyStepOrder ?? q.steps.map(x => x.id);
  return byId(order[Math.min(s.step as number, order.length - 1)]);
}
export class QuestEngine {
  readonly progress: QuestProgress = fresh();
  private storage?: QuestOptions['storage'];
  private readonly now: () => number;
  private hadExistingSave = false;
  private flagIndex = new Set<string>();
  constructor(readonly data: QuestData, private options: QuestOptions = {}) {
    this.now = options.now ?? Date.now;
    try {
      this.storage = options.storage ?? (typeof localStorage !== 'undefined' ? localStorage : undefined);
      const read = readSave(this.storage, QUEST_KEY);
      this.hadExistingSave = read.existed;
      if (read.corrupt && !read.recovered) options.onStorageError?.();
      if (read.value !== undefined) this.restore(read.value);
    } catch { options.onStorageError?.(); }
    this.reindex();
  }
  private restore(raw: unknown) {
    if (!raw || typeof raw !== 'object') return;
    const p = raw as Partial<QuestProgress>;
    this.progress.legacySnapshotTaken = p.legacySnapshotTaken === true;
    if (Array.isArray(p.journal)) {
      const seen = new Set<string>();
      this.progress.journal = p.journal.filter((x): x is JournalEntry => !!x && typeof x.id === 'string' && !seen.has(x.id) && !!seen.add(x.id) && typeof x.title === 'string' && typeof x.text === 'string' && Number.isFinite(x.at) && typeof x.zone === 'string' && typeof x.npc === 'string' && JOURNAL_KINDS.includes(x.kind));
    }
    if (Array.isArray(p.grants)) {
      const seen = new Set<string>();
      this.progress.grants = p.grants.filter((g): g is QuestGrant => !!g && typeof g.key === 'string' && !seen.has(g.key) && !!seen.add(g.key) && typeof g.quest === 'string' && typeof g.itemId === 'string' && Number.isFinite(g.at) && (g.variant === undefined || typeof g.variant === 'string'));
    }
    for (const q of this.data.quests) {
      const s = p.quests?.[q.id];
      // A finished quest stays finished whatever its steps became (even fewer of them); an active one follows its step id across a rewrite.
      if (!s || !['active', 'completed'].includes(s.status) || (s.status === 'active' && (!Number.isInteger(s.step) || s.step < 0))) continue;
      const choices: Record<string, string> = {};
      for (const step of q.steps) if (step.choices?.some(c => c.id === s.choices?.[step.id])) choices[step.id] = s.choices[step.id];
      let step = q.steps.length;
      if (s.status === 'active') {
        const resolved = resolveStep(q, s);
        step = resolved ?? 0;
        if (resolved === undefined) this.entry({ id: `${q.id}:reset:${questRevision(q)}`, kind: 'quest', title: q.title, text: '任務內容更新後，先前的進度對不上新的步驟，從第一步重新開始。', zone: q.zone, npc: q.npc });
      }
      this.progress.quests[q.id] = { status: s.status, step, stepId: q.steps[step]?.id, revision: questRevision(q), choices, photoBaseline: typeof s.photoBaseline === 'number' ? s.photoBaseline : 0 };
      // A quest finished before rewards became collectibles (or under an old reward name) gets its collectible once, now.
      if (s.status === 'completed') this.grant(q, choices, this.progress.journal.find(e => e.id === `${q.id}:return`)?.at);
    }
    if (Array.isArray(p.rewards)) this.progress.rewards = [...new Set(p.rewards.filter(x => typeof x === 'string'))];
    // Pre-marker v5 builds may already have mislabeled current facts as 'before the update'.
    // Retain the evidence and stable IDs, but do not assert an unknowable source version.
    if (p.legacySnapshotTaken !== true) this.progress.journal = this.progress.journal.map(entry =>
      entry.kind === 'legacy' ? { ...entry, title: '過往進度', text: '來源版本未記錄，無詳細經過。' } : entry);
    if (p.tracked && this.data.quests.some(q => q.id === p.tracked) && this.progress.quests[p.tracked]?.status !== 'completed') this.progress.tracked = p.tracked;
  }
  /** The flag index is derived from choices and status; rebuilt whenever they change, so a and b never both hold. */
  private reindex() {
    this.flagIndex = new Set<string>();
    for (const q of this.data.quests) {
      const s = this.progress.quests[q.id]; if (!s) continue;
      if (s.status === 'completed') this.flagIndex.add(questDoneFlag(q.id));
      for (const [step, choice] of Object.entries(s.choices)) this.flagIndex.add(questFlag(q.id, step, choice));
    }
  }
  flag(id: string) { return this.flagIndex.has(id); }
  flags() { return [...this.flagIndex]; }
  get grants(): readonly QuestGrant[] { return this.progress.grants; }
  /** Collectibles for a finished quest, once each; the variant follows the recorded choice, if any. Returns the new ones. */
  private grant(q: QuestDefinition, choices: Record<string, string>, at = this.now()) {
    const added: QuestGrant[] = [];
    for (const r of q.completionRewards ?? []) {
      const key = grantKey(q.id, r.itemId);
      if (this.progress.grants.some(g => g.key === key)) continue;
      const variant = r.variantBy ? choices[r.variantBy] : undefined;
      const g: QuestGrant = { key, quest: q.id, itemId: r.itemId, at, ...(variant ? { variant } : {}) };
      this.progress.grants.push(g); added.push(g);
    }
    return added;
  }
  list(): QuestView[] { return this.data.quests.map(definition => { const state = this.progress.quests[definition.id]; return { definition, state, step: state?.status === 'active' ? definition.steps[state.step] : undefined }; }); }
  unlocked(q: QuestDefinition, world: QuestWorld) { return !q.accept.chapterDone || world.chapterDone?.(q.accept.chapterDone) === true; }
  /** People the quest will need who are not on campus right now (spec-v10 §3): accepting it would mean a walk to nobody. */
  missingNpcs(q: QuestDefinition, world: QuestWorld) { return chainNpcs(q).filter(id => world.npcPresent?.(id) === false); }
  /** Times of day when a new acceptance is possible: the authored `accept.times`, or (older data) when everyone the quest needs is on campus. */
  private openTimes(q: QuestDefinition, world: QuestWorld): TimeOfDay[] | undefined {
    if (q.accept.times) return q.accept.times;
    if (!world.npcPresentAt) return undefined;
    return TIMES_OF_DAY.filter(time => chainNpcs(q).every(id => world.npcPresentAt!(id, time) !== false) && q.steps.every(s => !s.when || s.when === time));
  }
  /** @deprecated v10.2: use availability().times. Kept for the notebook's "switch to a time when it can be accepted". */
  acceptableTimes(q: QuestDefinition, world: QuestWorld): string[] | undefined { return this.openTimes(q, world); }
  /** The one question every surface asks about a quest that is not yet accepted (spec-v10.2 §1). Distance is not part of it. */
  availability(q: QuestDefinition, world: QuestWorld): QuestAvailability {
    const state = this.progress.quests[q.id], now = world.timeOfDay(), times = this.openTimes(q, world) ?? [];
    if (state?.status === 'completed') return { state: 'completed', times, reason: '' };
    if (state) return { state: 'active', times, reason: '' };
    if (!this.unlocked(q, world)) return { state: 'locked', times, reason: '' };
    const first = q.steps[0], firstTimed = first.target === q.accept.near && !!first.when && first.when !== now;
    if ((q.accept.times && !q.accept.times.includes(now as TimeOfDay)) || firstTimed) {
      const label = timesLabel(times.length ? times : isTimeOfDay(first.when) ? [first.when] : []);
      return { state: 'wrong-time', times, reason: q.absent?.[now] ?? (label ? `可接時段：${label}。` : '現在不是可接時段。') };
    }
    const missing = [...(world.npcPresent?.(q.npc) === false ? [q.npc] : []), ...this.missingNpcs(q, world).filter(id => id !== q.npc)];
    if (missing.length) return { state: 'npc-away', times, missing, reason: q.absent?.[now] ?? '需要的人物現在不在校園。' };
    return { state: 'available', times, reason: '' };
  }
  acceptable(world: QuestWorld): QuestView[] {
    return this.list().filter(v => this.availability(v.definition, world).state === 'available' && world.distanceTo(v.definition.accept.near) <= 4);
  }
  /** The display set for the world: current steps' objects plus every finished work whose condition holds (variant kind when one matches). */
  worksShown(_world?: QuestWorld): ShownSpot[] {
    const out = new Map<string, SpotKind>(), spots = this.data.spots ?? {};
    for (const v of this.list()) if (v.step?.target.startsWith('spot:')) { const id = v.step.target.slice(5); if (spots[id]) out.set(id, spots[id].kind); }
    for (const q of this.data.quests) for (const w of q.works ?? []) {
      if (out.has(w.spot) || !spots[w.spot] || !evalCond(w.if, id => this.flag(id))) continue;
      out.set(w.spot, w.variants?.find(v => evalCond(v.if, id => this.flag(id)))?.kind ?? spots[w.spot].kind);
    }
    return [...out].map(([spot, kind]) => ({ spot, kind }));
  }
  accept(id: string, world?: QuestWorld) {
    const q = this.data.quests.find(q => q.id === id);
    if (!q || !world || !this.acceptable(world).some(v => v.definition.id === id)) return false;
    this.progress.quests[id] = { status: 'active', step: 0, stepId: q.steps[0].id, revision: questRevision(q), choices: {}, photoBaseline: world?.photoCount ?? 0 };
    this.progress.tracked = id;
    this.entry({ id: `${id}:accepted`, kind: 'quest', title: q.title, text: q.description, zone: q.zone, npc: q.npc }); this.save(); return true;
  }
  /** With `world`, a quest not yet offered cannot be tracked; undefined means back to the main story. */
  track(id?: string, world?: QuestWorld) {
    if (id) { const q = this.data.quests.find(q => q.id === id); if (!q || this.progress.quests[id]?.status === 'completed' || (world && this.locked(q, world))) return false; }
    this.progress.tracked = id; this.save(); return true;
  }
  /** Not accepted and its chapter not done yet. An accepted quest is never locked, whatever an old save's chapters say. */
  locked(q: QuestDefinition, world: QuestWorld) { return !this.progress.quests[q.id] && !this.unlocked(q, world); }
  /** Older builds could track a quest still locked: such a save starts on the main story. Call once the chapters are known. */
  settle(world: QuestWorld) { const q = this.data.quests.find(q => q.id === this.progress.tracked); if (q && this.locked(q, world)) { this.progress.tracked = undefined; this.save(); } }
  private reachable(step: QuestStep, world: QuestWorld) { return world.distanceTo(step.target) <= (step.radius ?? 4) && (!step.when || step.when === world.timeOfDay()); }
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
    s.step++; s.stepId = q.steps[s.step]?.id; s.revision = questRevision(q); s.photoBaseline = photoCount ?? 0;
    const completed = s.step >= q.steps.length;
    if (completed) { s.status = 'completed'; if (!this.progress.rewards.includes(q.reward)) this.progress.rewards.push(q.reward); this.grant(q, s.choices); if (this.progress.tracked === q.id) this.progress.tracked = undefined; }
    this.entry({ id: `${q.id}:${step.id}`, kind: 'quest', title: q.title, text: step.text, zone: q.zone, npc: q.npc, choice: choice?.label, result: choice?.result ?? (completed ? '任務完成，謝謝你的幫忙！' : '完成這一步，接著前往下一個地點。'), reward: completed ? q.reward : undefined }); this.save();
    this.options.onStep?.(q, completed ? undefined : q.steps[s.step]);
  }
  record(entry: Omit<JournalEntry, 'at'>) { if (this.progress.journal.some(e => e.id === entry.id)) return false; if (entry.reward && !this.progress.rewards.includes(entry.reward)) this.progress.rewards.push(entry.reward); this.entry(entry); this.save(); return true; }
  private entry(entry: Omit<JournalEntry, 'at'>) { if (!this.progress.journal.some(e => e.id === entry.id)) this.progress.journal.push({ ...entry, at: this.now() }); }
  private save() { this.reindex(); try { writeSave(this.storage, QUEST_KEY, this.progress); } catch { this.options.onStorageError?.(); } this.options.onChange?.(); }
  clear() { Object.assign(this.progress, fresh(), { tracked: undefined, legacySnapshotTaken: true }); this.hadExistingSave = true; try { removeSave(this.storage, QUEST_KEY); } catch { /* the save below reports it */ } this.save(); }
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
