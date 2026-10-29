import * as T from 'three';
import type { MinigameId } from '../story/dialogue';

/** The three mini-games (spec-v4 §9.3–§9.5, §15.5). Each resolves true (win) or false; the NPC's tree then
 * continues at its win/lose node. None of them can block the main story. */

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
export interface Question { id: string; q: string; options: string[]; answer: number; row: number; source: string; explain: string }

/** History quiz: 5 random questions, 4 options, pass with ≥ 4; each answer shows its source. */
export class Quiz {
  private el: HTMLElement;
  private resolve?: (win: boolean) => void;
  private qs: Question[] = [];
  private i = 0;
  private score = 0;
  private answered = false;
  constructor(host: HTMLElement, private bank: Question[], private cue: (id: string) => void) {
    this.el = document.createElement('div'); this.el.className = 'game-card'; this.el.hidden = true; this.el.setAttribute('role', 'dialog');
    host.append(this.el);
    this.el.addEventListener('click', e => {
      const t = e.target as HTMLElement, o = t.closest<HTMLElement>('[data-opt]'), n = t.closest('[data-q=next]');
      if (o) this.pick(Number(o.dataset.opt)); else if (n) this.next();
    });
  }
  get open() { return !this.el.hidden; }
  play(rand = Math.random) {
    this.qs = [...this.bank].sort(() => rand() - .5).slice(0, 5); this.i = 0; this.score = 0;
    this.el.hidden = false; this.show();
    return new Promise<boolean>(r => { this.resolve = r; });
  }
  private show() {
    const q = this.qs[this.i]; this.answered = false;
    this.el.innerHTML = `<header><b>校史問答</b><span>${this.i + 1}／${this.qs.length}・答對 ${this.score}</span></header><h3>${esc(q.q)}</h3>
<ol class="game-opts">${q.options.map((o, k) => `<li><button data-opt="${k}"><kbd>${k + 1}</kbd>${esc(o)}</button></li>`).join('')}</ol><div class="game-foot"></div>`;
  }
  private pick(k: number) {
    if (this.answered) return;
    this.answered = true;
    const q = this.qs[this.i], ok = k === q.answer;
    if (ok) this.score++;
    this.cue(ok ? 'chime' : 'pop');
    this.el.querySelectorAll<HTMLElement>('[data-opt]').forEach((b, j) => b.classList.add(j === q.answer ? 'right' : j === k ? 'wrong' : 'dim'));
    this.el.querySelector('.game-foot')!.innerHTML = `<p>${ok ? '答對了！' : '差一點。'}${esc(q.explain)} <a href="${esc(q.source)}" target="_blank" rel="noopener">出處</a></p><button data-q="next">${this.i + 1 < this.qs.length ? '下一題 →' : '看結果'}</button>`;
  }
  private next() {
    if (this.i >= this.qs.length) { this.finish(!!this.done); return; }
    if (!this.answered) return;
    if (++this.i < this.qs.length) { this.show(); return; }
    const win = this.score >= 4;
    this.el.innerHTML = `<header><b>校史問答</b></header><h3>${this.score}／${this.qs.length} 題</h3><p>${win ? '過關！你比很多學長姐還懂中山。' : '再挑戰一次吧，答對 4 題就過關。'}</p><div class="game-foot"><button data-q="next">回去找阿典</button></div>`;
    this.answered = true; this.i = this.qs.length; this.done = win;
  }
  private done?: boolean;
  /** Keyboard: 1–4 answer, E / Enter / Space continue. Returns true when the card used the key. */
  key(k: string) {
    if (!this.open) return false;
    const n = Number(k);
    if (n >= 1 && n <= 4) { this.pick(n - 1); return true; }
    if (k === 'e' || k === 'enter' || k === ' ') { this.next(); return true; }
    if (k === 'escape') { this.finish(false); return true; }
    return true;
  }
  private finish(win: boolean) { this.el.hidden = true; const r = this.resolve; this.resolve = undefined; this.done = undefined; r?.(win); }
}

/** Macaque thief chase: the macaque flees along the path network away from the player; get within 2 m and
 * press E within 90 s. The lesson (official rules) is in the NPC's after-win / after-lose lines. */
export interface ChaseDeps {
  monkey(): { position: T.Vector3; path: T.Vector3[]; speed: number } | undefined;
  flee(from: T.Vector3, away: T.Vector3): T.Vector3[];
  say(text: string, ms?: number): void;
  cue(id: string): void;
  timer(text: string | null): void;
}
export class Chase {
  active = false;
  private left = 0;
  private resolve?: (win: boolean) => void;
  private replan = 0;
  private home = new T.Vector3();
  constructor(private d: ChaseDeps) {}
  play() {
    const m = this.d.monkey();
    if (!m) return Promise.resolve(false);
    this.active = true; this.left = 90; this.replan = 0; this.home.copy(m.position);
    this.d.cue('monkey'); this.d.say('大膽搶走了便當！追上牠，靠近後按 E 取回（90 秒）。', 5000);
    return new Promise<boolean>(r => { this.resolve = r; });
  }
  update(dt: number, player: T.Vector3) {
    if (!this.active) return;
    const m = this.d.monkey(); if (!m) { this.end(false); return; }
    this.left -= dt; this.replan -= dt;
    this.d.timer(`追回便當 ${Math.max(0, Math.ceil(this.left))} 秒`);
    if (this.left <= 0) { this.d.say('大膽溜進樹林了……', 3000); this.end(false); return; }
    const d = Math.hypot(player.x - m.position.x, player.z - m.position.z);
    // Flee when the player is close, otherwise catch a breath (that is the chance to catch up).
    if (d < 9 && (!m.path.length || this.replan <= 0)) { m.path = this.d.flee(m.position, player); m.speed = 4.4; this.replan = 2.5; }
    else if (d > 16 && m.path.length) m.path = [];
  }
  /** E pressed in walk mode; returns true when the chase used it. */
  press(player: T.Vector3) {
    if (!this.active) return false;
    const m = this.d.monkey(); if (!m) return false;
    if (Math.hypot(player.x - m.position.x, player.z - m.position.z) < 2.2) { this.d.cue('chime'); this.d.say('拿回便當了！大膽丟下袋子跑掉。', 3000); this.end(true); return true; }
    this.d.say('再靠近一點（2 公尺內）才拿得到。', 1800); return true;
  }
  private end(win: boolean) {
    this.active = false; this.d.timer(null);
    const m = this.d.monkey(); if (m) { m.path = []; m.speed = 1.1; m.position.copy(this.home); }
    const r = this.resolve; this.resolve = undefined; r?.(win);
  }
  cancel() { if (this.active) this.end(false); }
}

/** Sunset photo judge: sunset preset, inside the seawall zone, the sun inside the central 60 % of the frame
 * and not hidden behind anything. Returns a message, and whether it passed. */
export function judgeSunset(camera: T.PerspectiveCamera, sunDir: T.Vector3, preset: string, atSeawall: boolean, occluded: (from: T.Vector3, dir: T.Vector3) => boolean) {
  if (preset !== 'sunset') return { ok: false, msg: '要在夕陽時段拍（上方按「夕陽」）。' };
  if (!atSeawall) return { ok: false, msg: '回到海堤上再拍。' };
  const p = camera.position.clone().addScaledVector(sunDir, 500).project(camera);
  if (p.z > 1 || Math.abs(p.x) > .6 || Math.abs(p.y) > .6) return { ok: false, msg: '把夕陽放進畫面中間一點。' };
  if (occluded(camera.position, sunDir)) return { ok: false, msg: '夕陽被擋住了，換個角度。' };
  return { ok: true, msg: '漂亮！夕陽正好落在海峽上。' };
}

export type Games = Record<MinigameId, () => Promise<boolean>>;
