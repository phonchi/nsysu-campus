/** v4 progress beside the story save (spec-v4 §9.1, §15.3): dialogue flags, items, stamps, achievements,
 * counters, who the player talked to, mini-game results and the player's look. Story progress stays in
 * `nsysu-story-v3`; this store never writes story flags. */
export type Body = 'm' | 'f';
export interface PlayerLook { body: Body; palette: number; nickname: string }
export interface GameResult { best: number; wins: number; plays: number }
export interface CampusProgress {
  flags: string[];
  items: string[];
  stamps: string[];
  achievements: string[];
  counters: Record<string, number>;
  talked: string[];
  games: Record<string, GameResult>;
  player: PlayerLook;
}

export const KEY = 'nsysu-campus-v4';
const strings = (v: unknown) => Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string'))] : [];
const num = (v: unknown, d = 0) => typeof v === 'number' && Number.isFinite(v) ? v : d;

/** Nicknames: 1–8 characters, no markup or braces (they are substituted into dialogue). */
export function cleanNickname(v: unknown) {
  return typeof v === 'string' ? [...v.replace(/[<>{}&"'`\\]/g, '').trim()].slice(0, 8).join('') : '';
}

/** Accept only well-formed fields from storage; anything else falls back to a fresh value. */
export function normalizeCampus(raw: unknown): CampusProgress {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const counters: Record<string, number> = {}, games: Record<string, GameResult> = {};
  if (o.counters && typeof o.counters === 'object') for (const [k, v] of Object.entries(o.counters)) if (typeof v === 'number' && Number.isFinite(v) && v >= 0) counters[k] = Math.floor(v);
  if (o.games && typeof o.games === 'object') for (const [k, v] of Object.entries(o.games)) {
    const g = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
    games[k] = { best: num(g.best), wins: Math.max(0, Math.floor(num(g.wins))), plays: Math.max(0, Math.floor(num(g.plays))) };
  }
  const p = (o.player && typeof o.player === 'object' ? o.player : {}) as Record<string, unknown>;
  const palette = Math.floor(num(p.palette));
  return {
    flags: strings(o.flags), items: strings(o.items), stamps: strings(o.stamps), achievements: strings(o.achievements),
    counters, talked: strings(o.talked), games,
    player: { body: p.body === 'f' ? 'f' : 'm', palette: palette >= 0 && palette < 6 ? palette : 0, nickname: cleanNickname(p.nickname) },
  };
}

export function loadCampus(): CampusProgress {
  try { const raw = localStorage.getItem(KEY); return normalizeCampus(raw ? JSON.parse(raw) : {}); } catch { return normalizeCampus({}); }
}
export function saveCampus(p: CampusProgress) { try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { if (typeof window !== 'undefined') window.dispatchEvent(new Event('campus-storage-error')); } }
export function clearCampus(keepPlayer = true) {
  const player = keepPlayer ? loadCampus().player : undefined;
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
  if (player) { const fresh = normalizeCampus({}); fresh.player = player; saveCampus(fresh); }
}

/** Mutations with change notification (stamps/achievements raise toasts; the HUD listens). */
export class Campus {
  readonly progress: CampusProgress;
  private listeners: ((kind: 'item' | 'stamp' | 'achievement' | 'flag' | 'player', id: string) => void)[] = [];
  constructor(saved?: CampusProgress) { this.progress = saved ?? loadCampus(); }
  on(fn: (kind: 'item' | 'stamp' | 'achievement' | 'flag' | 'player', id: string) => void) { this.listeners.push(fn); }
  private emit(kind: 'item' | 'stamp' | 'achievement' | 'flag' | 'player', id: string) { saveCampus(this.progress); for (const f of this.listeners) f(kind, id); }
  private add(list: string[], id: string) { if (list.includes(id)) return false; list.push(id); return true; }
  setFlag(id: string) { if (this.add(this.progress.flags, id)) this.emit('flag', id); }
  giveItem(id: string) { if (this.add(this.progress.items, id)) this.emit('item', id); }
  stamp(id: string) { if (this.add(this.progress.stamps, id)) this.emit('stamp', id); }
  achieve(id: string) { if (this.add(this.progress.achievements, id)) this.emit('achievement', id); }
  count(id: string, by = 1) { this.progress.counters[id] = (this.progress.counters[id] ?? 0) + by; this.emit('flag', id); }
  talked(npc: string) { if (this.add(this.progress.talked, npc)) saveCampus(this.progress); }
  game(id: string, score: number, win: boolean) {
    const g = this.progress.games[id] ??= { best: 0, wins: 0, plays: 0 };
    g.plays++; if (win) g.wins++; g.best = Math.max(g.best, score); saveCampus(this.progress);
  }
  setPlayer(look: Partial<PlayerLook>) {
    const p = this.progress.player;
    if (look.body) p.body = look.body === 'f' ? 'f' : 'm';
    if (look.palette !== undefined) p.palette = Math.max(0, Math.min(5, Math.floor(look.palette)));
    if (look.nickname !== undefined) p.nickname = cleanNickname(look.nickname);
    this.emit('player', p.body);
  }
}
