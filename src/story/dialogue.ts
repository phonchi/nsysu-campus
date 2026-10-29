/** NPC dialogue trees (spec-v4 §8, §15.2–§15.5): data types, the load-time validator and a pure runner.
 * A tree is entered at the first entry whose condition holds; a node shows its lines, applies its effects,
 * then offers choices (2–4, filtered by `if`) or follows `next`; a node with neither ends the talk.
 * Graphs are acyclic; "talk again" re-enters from the entries. */
import type { Line } from './schema';

export type Face = 'neutral' | 'smile' | 'surprised' | 'troubled';
export interface TalkLine extends Line { face?: Face }

export type Cond =
  | { flag: string } | { notFlag: string } | { hasItem: string } | { stamps: number }
  | { chapterDone: string } | { timeOfDay: string } | { count: string; gte: number }
  | { all: Cond[] } | { any: Cond[] };

export type Effect =
  | { setFlag: string } | { giveItem: string } | { stamp: string } | { achievement: string }
  | { unlockSideQuest: string } | { playSound: string } | { count: string }
  | { startMinigame: MinigameId; win: string; lose: string };

export type MinigameId = 'sunset-photo' | 'monkey-chase' | 'history-quiz';
export const MINIGAMES: MinigameId[] = ['sunset-photo', 'monkey-chase', 'history-quiz'];

export interface Choice { text: string; next?: string; if?: Cond; effects?: Effect[] }
export interface TalkNode { lines: TalkLine[]; effects?: Effect[]; choices?: Choice[]; next?: string }
export interface Tree { entries: { if?: Cond; node: string }[]; nodes: Record<string, TalkNode> }

/** What conditions can ask about (story flags and v4 flags merged, spec §15.3). */
export interface Facts {
  flag(id: string): boolean;
  hasItem(id: string): boolean;
  stamps(): number;
  chapterDone(id: string): boolean;
  timeOfDay(): string;
  count(id: string): number;
}

export function holds(c: Cond | undefined, f: Facts): boolean {
  if (!c) return true;
  if ('all' in c) return c.all.every(x => holds(x, f));
  if ('any' in c) return c.any.some(x => holds(x, f));
  if ('flag' in c) return f.flag(c.flag);
  if ('notFlag' in c) return !f.flag(c.notFlag);
  if ('hasItem' in c) return f.hasItem(c.hasItem);
  if ('stamps' in c) return f.stamps() >= c.stamps;
  if ('chapterDone' in c) return f.chapterDone(c.chapterDone);
  if ('timeOfDay' in c) return f.timeOfDay() === c.timeOfDay;
  if ('count' in c) return f.count(c.count) >= c.gte;
  return false;
}

export const entryNode = (t: Tree, f: Facts) => t.entries.find(e => holds(e.if, f))?.node;
export const choicesOf = (n: TalkNode, f: Facts) => (n.choices ?? []).filter(c => holds(c.if, f));

/** The presentation and world side of a conversation. */
export interface TalkIO {
  /** Show lines; with `hold` the last line stays on screen (choices follow) and the promise resolves once it is shown. */
  say(lines: TalkLine[], hold?: boolean): Promise<void>;
  /** Resolves with the index into `choices`. */
  choose(choices: Choice[]): Promise<number>;
  apply(e: Effect): void;
}

/** Play a conversation from `start` (an entry node, or a mini-game's win/lose node). Returns the minigame
 * request of the final node, if any, so the caller can run the game and come back via `win`/`lose`. */
export async function runTalk(t: Tree, start: string, f: Facts, io: TalkIO) {
  let id: string | undefined = start;
  for (let guard = 0; id && guard < 200; guard++) {
    const n: TalkNode | undefined = t.nodes[id];
    if (!n) return undefined;
    await io.say(n.lines, !!n.choices?.length);
    let game: Extract<Effect, { startMinigame: MinigameId }> | undefined;
    for (const e of n.effects ?? []) { if ('startMinigame' in e) game = e; else io.apply(e); }
    if (game) return game;
    const options = choicesOf(n, f);
    if (options.length) {
      const pick = options[await io.choose(options)];
      for (const e of pick.effects ?? []) io.apply(e);
      id = pick.next;
    } else id = n.next;
  }
  return undefined;
}

const COND_KEYS = ['flag', 'notFlag', 'hasItem', 'stamps', 'chapterDone', 'timeOfDay', 'count', 'all', 'any'];
const EFFECT_KEYS = ['setFlag', 'giveItem', 'stamp', 'achievement', 'unlockSideQuest', 'playSound', 'count', 'startMinigame'];

export interface Catalog {
  npcs: string[]; items: string[]; stamps: string[]; achievements: string[]; sideQuests: string[];
  chapters: string[]; storyFlags: string[]; sounds: string[];
}

/** Problems in a set of trees (empty = OK). `owner` maps tree id → npc id (for the flag namespace rule). */
export function validateTrees(trees: Record<string, Tree>, owner: Record<string, string>, cat: Catalog): string[] {
  const errors: string[] = [];
  const setFlags = new Set<string>();
  const walkEffects = (es: Effect[] | undefined, fn: (e: Effect) => void) => es?.forEach(fn);
  for (const t of Object.values(trees)) for (const n of Object.values(t.nodes ?? {})) {
    walkEffects(n.effects, e => { if ('setFlag' in e) setFlags.add(e.setFlag); });
    for (const c of n.choices ?? []) walkEffects(c.effects, e => { if ('setFlag' in e) setFlags.add(e.setFlag); });
  }
  for (const [tid, t] of Object.entries(trees)) {
    const at = (s: string) => `${tid}: ${s}`;
    const npc = owner[tid] ?? tid;
    if (!t.entries?.length) { errors.push(at('no entries')); continue; }
    if (t.entries[t.entries.length - 1].if) errors.push(at('last entry must be unconditional'));
    const checkCond = (c: Cond | undefined, where: string) => {
      if (!c) return;
      const keys = Object.keys(c).filter(k => k !== 'gte');
      if (keys.length !== 1 || !COND_KEYS.includes(keys[0])) { errors.push(at(`${where}: bad condition ${JSON.stringify(c)}`)); return; }
      if ('all' in c) c.all.forEach(x => checkCond(x, where));
      if ('any' in c) c.any.forEach(x => checkCond(x, where));
      if ('flag' in c || 'notFlag' in c) { const fl = 'flag' in c ? c.flag : c.notFlag; if (!setFlags.has(fl) && !cat.storyFlags.includes(fl)) errors.push(at(`${where}: flag ${fl} is never set`)); }
      if ('hasItem' in c && !cat.items.includes(c.hasItem)) errors.push(at(`${where}: unknown item ${c.hasItem}`));
      if ('chapterDone' in c && !cat.chapters.includes(c.chapterDone)) errors.push(at(`${where}: unknown chapter ${c.chapterDone}`));
      if ('timeOfDay' in c && !['day', 'sunset', 'night'].includes(c.timeOfDay)) errors.push(at(`${where}: unknown time ${c.timeOfDay}`));
      if ('count' in c && typeof c.gte !== 'number') errors.push(at(`${where}: count needs gte`));
    };
    const checkEffect = (e: Effect, where: string, terminal: boolean, onChoice: boolean) => {
      const keys = Object.keys(e).filter(k => k !== 'win' && k !== 'lose');
      if (keys.length !== 1 || !EFFECT_KEYS.includes(keys[0])) { errors.push(at(`${where}: bad effect ${JSON.stringify(e)}`)); return; }
      if ('setFlag' in e && !(e.setFlag.startsWith(npc + '.') || e.setFlag.startsWith('v4.'))) errors.push(at(`${where}: flag ${e.setFlag} must start with "${npc}." or "v4."`));
      if ('setFlag' in e && cat.storyFlags.includes(e.setFlag)) errors.push(at(`${where}: dialogue must not set story flag ${e.setFlag}`));
      if ('giveItem' in e && !cat.items.includes(e.giveItem)) errors.push(at(`${where}: unknown item ${e.giveItem}`));
      if ('stamp' in e && !cat.stamps.includes(e.stamp)) errors.push(at(`${where}: unknown stamp ${e.stamp}`));
      if ('achievement' in e && !cat.achievements.includes(e.achievement)) errors.push(at(`${where}: unknown achievement ${e.achievement}`));
      if ('unlockSideQuest' in e && !cat.sideQuests.includes(e.unlockSideQuest)) errors.push(at(`${where}: unknown side quest ${e.unlockSideQuest}`));
      if ('playSound' in e && !cat.sounds.includes(e.playSound)) errors.push(at(`${where}: unknown sound ${e.playSound}`));
      if ('startMinigame' in e) {
        if (!MINIGAMES.includes(e.startMinigame)) errors.push(at(`${where}: unknown minigame ${e.startMinigame}`));
        if (onChoice || !terminal) errors.push(at(`${where}: startMinigame only on a terminal node's effects`));
        for (const k of ['win', 'lose'] as const) if (!t.nodes[e[k]]) errors.push(at(`${where}: ${k} → missing node ${e[k]}`));
      }
    };
    // Edges, lines, choices.
    const edges = new Map<string, string[]>();
    for (const [nid, n] of Object.entries(t.nodes ?? {})) {
      const w = `node ${nid}`, out: string[] = [];
      if (!n.lines?.length) errors.push(at(`${w}: no lines`));
      for (const l of n.lines ?? []) {
        if (!l.text || [...l.text.replace('{player}', '新生')].length > 28) errors.push(at(`${w}: line over 28 characters: ${l.text}`));
        if (l.who !== 'player' && l.who !== 'narrator' && !cat.npcs.includes(l.who)) errors.push(at(`${w}: unknown speaker ${l.who}`));
        if (l.face && !['neutral', 'smile', 'surprised', 'troubled'].includes(l.face)) errors.push(at(`${w}: unknown face ${l.face}`));
      }
      if (n.choices && n.next) errors.push(at(`${w}: has both choices and next`));
      if (n.choices && (n.choices.length < 2 || n.choices.length > 4)) errors.push(at(`${w}: needs 2–4 choices`));
      const terminal = !n.choices?.length && !n.next;
      for (const e of n.effects ?? []) { checkEffect(e, w, terminal, false); if ('startMinigame' in e) out.push(e.win, e.lose); }
      for (const [i, c] of (n.choices ?? []).entries()) {
        checkCond(c.if, `${w} choice ${i}`);
        for (const e of c.effects ?? []) checkEffect(e, `${w} choice ${i}`, terminal, true);
        if (c.next) { if (!t.nodes[c.next]) errors.push(at(`${w} choice ${i}: next → missing ${c.next}`)); else out.push(c.next); }
        if (!c.text || [...c.text].length > 20) errors.push(at(`${w} choice ${i}: text empty or over 20 characters`));
      }
      // A node whose choices can all be filtered out would strand the player: one must be unconditional.
      if (n.choices?.length && n.choices.every(c => c.if)) errors.push(at(`${w}: every choice is conditional`));
      if (n.next) { if (!t.nodes[n.next]) errors.push(at(`${w}: next → missing ${n.next}`)); else out.push(n.next); }
      edges.set(nid, out);
    }
    for (const [i, e] of t.entries.entries()) { checkCond(e.if, `entry ${i}`); if (!t.nodes[e.node]) errors.push(at(`entry ${i} → missing node ${e.node}`)); }
    // Reachability and acyclicity.
    const seen = new Set<string>(), state = new Map<string, 1 | 2>();
    const visit = (id: string, path: string[]) => {
      if (!t.nodes[id]) return;
      if (state.get(id) === 1) { errors.push(at(`cycle ${[...path, id].join(' → ')}`)); return; }
      if (state.get(id) === 2) return;
      state.set(id, 1); seen.add(id);
      for (const nx of edges.get(id) ?? []) visit(nx, [...path, id]);
      state.set(id, 2);
    };
    for (const e of t.entries) visit(e.node, []);
    for (const nid of Object.keys(t.nodes ?? {})) if (!seen.has(nid)) errors.push(at(`node ${nid} unreachable`));
  }
  return errors;
}
