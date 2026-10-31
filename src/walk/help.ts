/** First-run guide and the `?` help entry (spec-v7 Lane C).
 * The show-once decision and the key routing are DOM-free so they run in node tests; only `FirstRunGuide` touches the DOM. */

export const GUIDE_KEY = 'nsysu-walk-guide-v7';

export interface GuideStorage { getItem(key: string): string | null; setItem(key: string, value: string): void }

/** `localStorage` itself can throw (sandboxed frames, blocked storage), so even reading the global is guarded. */
export function defaultGuideStorage(): GuideStorage | undefined {
  try { return typeof localStorage !== 'undefined' ? localStorage : undefined; } catch { return undefined; }
}

/** Whether the guide was dismissed on an earlier visit; any storage failure counts as "not seen", so the guide shows once this visit. */
export function readGuideSeen(storage: GuideStorage | undefined): boolean {
  try { return storage?.getItem(GUIDE_KEY) === '1'; } catch { return false; }
}

/** Remembers the dismissal; returns false when storage refused (the game carries on either way). */
export function writeGuideSeen(storage: GuideStorage | undefined): boolean {
  try { storage?.setItem(GUIDE_KEY, '1'); return true; } catch { return false; }
}

export interface GuideWorld {
  /** The player is on foot in the world (not the welcome card, the loading screen or bird's-eye). */
  walking: boolean;
  /** A dialogue, chapter card, menu, journal, quiz or photo mode is up; the guide waits until it closes. */
  blocked: boolean;
}

/** Show-once policy: opens the first time the player is walking with nothing modal on screen, and never again after
 * dismissal, even when storage refuses to remember it (an in-memory flag covers the rest of the visit). */
export class GuidePolicy {
  private seen: boolean;
  private _open = false;
  constructor(private storage: GuideStorage | undefined) { this.seen = readGuideSeen(storage); }
  get open() { return this._open; }
  /** True once the guide has been dismissed (or was seen on an earlier visit): nothing left to decide. */
  get settled() { return this.seen && !this._open; }
  /** Call every tick; returns true on the tick the guide should appear. */
  update(world: GuideWorld): boolean {
    if (this.seen || this._open || !world.walking || world.blocked) return false;
    this._open = true;
    return true;
  }
  /** Returns true when the guide was open (so the caller hides it exactly once). */
  dismiss(): boolean {
    if (!this._open) return false;
    this._open = false; this.seen = true;
    writeGuideSeen(this.storage);
    return true;
  }
}

/** Keys while the guide owns the keyboard (input mode "menu"). Enter/Space are left to the focused button's native
 * activation, so they are not listed here. */
export type GuideKeyAction = 'dismiss' | 'help' | 'none';
export function guideKeyAction(key: string): GuideKeyAction {
  if (key === 'h') return 'help';
  if (key === 'escape' || key === 'e') return 'dismiss';
  return 'none';
}

/** The H shortcut and the `?` button: open the help tab, or close the menu when that tab is already showing. */
export function helpShortcut(menuOpen: boolean, helpTabShowing: boolean): 'open' | 'close' {
  return menuOpen && helpTabShowing ? 'close' : 'open';
}

export interface GuideHooks {
  walking(): boolean;
  blocked(): boolean;
  /** Open the full help (the Esc menu's 操作說明 tab). */
  help(): void;
}

const DESKTOP_TIPS = [
  '<kbd>WASD</kbd>／方向鍵移動，<kbd>Shift</kbd> 奔跑；拖曳畫面轉頭，滾輪拉遠拉近。',
  '靠近人物或物件時按 <kbd>E</kbd> 互動；同一處有多個目標時按 <kbd>R</kbd> 切換。',
  '<kbd>G</kbd> 自動走到任務地點，<kbd>J</kbd> 打開校園手帳查看任務。',
  '<kbd>Esc</kbd> 選單、<kbd>P</kbd> 拍照、<kbd>N</kbd> 切換時段。',
];
const TOUCH_TIPS = [
  '左下搖桿移動，在畫面上拖曳可以轉頭。',
  '靠近人物或物件時，按右下的「互動 E」交談、開門；多個目標時會出現「切換目標 R」。',
  '右上角的圖示可以打開校園手帳、選單、音樂與拍照。',
];

/** The dismissable overlay shown once at the first entry into walking. */
export class FirstRunGuide {
  readonly el: HTMLElement;
  private policy: GuidePolicy;
  private previous?: Element | null;
  constructor(host: HTMLElement, private hooks: GuideHooks, options: { coarse: boolean; storage?: GuideStorage } = { coarse: false }) {
    this.policy = new GuidePolicy(options.storage ?? defaultGuideStorage());
    const tips = options.coarse ? TOUCH_TIPS : DESKTOP_TIPS;
    this.el = document.createElement('div');
    this.el.className = 'walk-guide'; this.el.hidden = true;
    this.el.setAttribute('role', 'dialog'); this.el.setAttribute('aria-modal', 'true'); this.el.setAttribute('aria-labelledby', 'walk-guide-title');
    this.el.innerHTML = `<div class="walk-guide-panel"><small>第一次來？</small><h2 id="walk-guide-title">歡迎來到山海之間</h2><ul>${tips.map(t => `<li><span>${t}</span></li>`).join('')}</ul><div class="walk-guide-actions"><button type="button" data-guide="start">開始探索</button><button type="button" data-guide="help">看完整說明${options.coarse ? '' : ' H'}</button></div><p class="walk-guide-note">之後${options.coarse ? '' : '按 H 或'}點右上角的「?」都能再看說明。</p></div>`;
    this.el.addEventListener('click', e => {
      const t = e.target as HTMLElement;
      if (t === this.el) { this.dismiss(); return; }
      const action = t.closest<HTMLElement>('[data-guide]')?.dataset.guide;
      if (action === 'start') this.dismiss();
      else if (action === 'help') this.dismiss(true);
    });
    // Tab stays inside the dialog (the input layer lets Tab through natively while a menu-like mode owns the keyboard).
    this.el.addEventListener('keydown', e => {
      if (e.key !== 'Tab') return;
      const focusable = [...this.el.querySelectorAll<HTMLElement>('button')];
      if (!focusable.length) return;
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
    host.append(this.el);
  }
  get open() { return this.policy.open; }
  /** Call once per frame; shows the guide on the first tick it is allowed to appear. */
  update() {
    if (this.policy.settled || this.policy.open || !this.el.isConnected) return;
    if (this.policy.update({ walking: this.hooks.walking(), blocked: this.hooks.blocked() })) this.show();
  }
  private show() {
    this.previous = document.activeElement;
    this.el.hidden = false;
    this.el.querySelector<HTMLElement>('[data-guide=start]')?.focus();
  }
  /** Hides the guide and remembers it; optionally continues into the full help. */
  dismiss(toHelp = false) {
    if (!this.policy.dismiss()) return;
    this.el.hidden = true;
    const prev = this.previous as HTMLElement | null | undefined;
    if (prev && prev.isConnected && prev !== document.body && typeof prev.focus === 'function') prev.focus(); else (document.activeElement as HTMLElement | null)?.blur?.();
    this.previous = undefined;
    if (toHelp) this.hooks.help();
  }
  /** Keys routed here by the input's modal hook while the guide is open. */
  key(k: string) {
    const action = guideKeyAction(k);
    if (action === 'dismiss') this.dismiss();
    else if (action === 'help') this.dismiss(true);
  }
  dispose() { this.el.remove(); }
}
