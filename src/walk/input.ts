import {nativeDialogueLinkKey} from '../story/content-links';
import { Vector2, Vector3 } from 'three';

const MOVE_KEYS = ['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'];
const STICK_RUN_THRESHOLD = .85;
/** Keys the walkthrough owns while focus is not in a text field. */
const OWNED = [...MOVE_KEYS, ' ', 'e', 'g', 'v', 'm', 'k', 'n', 'l', 'p', 'b', 'j', 'r', 'h', 't', 'q', 'shift', '/', 'escape', '1', '2', '3', '4', '5', '6', '7', '8', '9'];

/** Raw camera-relative intent, shared by movement and follow-camera policy. */
export interface MoveAxes { forward: number; right: number }
export function moveAxes(keys: ReadonlySet<string>, stick: { x: number; y: number }): MoveAxes {
  return {
    forward: (keys.has('w') || keys.has('arrowup') ? 1 : 0) - (keys.has('s') || keys.has('arrowdown') ? 1 : 0) - stick.y,
    right: (keys.has('d') || keys.has('arrowright') ? 1 : 0) - (keys.has('a') || keys.has('arrowleft') ? 1 : 0) + stick.x,
  };
}
export function isForwardMove({ forward: f, right: r }: MoveAxes, speed: number): boolean {
  return speed > .25 && f > .1 && f / Math.hypot(f, r) >= .5;
}

/** Who owns the keyboard (spec-v4 §15.4). Modals suppress walk shortcuts. Photo records camera
 * movement; carried records held movement but suppresses its output until walking resumes. */
export type InputMode = 'walk' | 'dialogue' | 'menu' | 'photo' | 'game' | 'carried';

export interface InputHooks {
  /** A key press while a modal mode owns the keyboard. */
  modal?(key: string, mode: InputMode): void;
  /** A single key press (no auto-repeat), lower-case `KeyboardEvent.key`. */
  press(key: string): void;
  /** The player started moving by hand (keys or stick). */
  moveStarted(): void;
  /** Up/down belong to the visible interaction list while it has multiple rows. */
  interactionListOpen?(): boolean;
  /** Camera drag in pixels (unlocked third person / first person). */
  look(dx: number, dy: number): void;
  zoom(delta: number): void;
  /** Whether canvas drags currently steer the camera (false in bird's-eye). */
  canLook(): boolean;
}

/** Keyboard, mouse/touch look, wheel and the on-screen joystick, reduced to plain state. */
export class WalkInput {
  readonly keys = new Set<string>();
  readonly stick = new Vector2();
  private _runToggle = false;
  private runButton: HTMLButtonElement | null;
  get runToggle() { return this._runToggle; }
  set runToggle(value: boolean) {
    this._runToggle = value;
    // Runtime's is-running/aria-pressed reports all run sources; keep the latch separate.
    if (this.runButton) {
      this.runButton.dataset.toggle = value ? 'on' : 'off';
      this.runButton.setAttribute('aria-label', `持續奔跑：${value ? '已開啟，再按關閉' : '已關閉，按下開啟'}`);
      const state = this.runButton.querySelector('[data-run-toggle-state]');
      if (state) state.textContent = value ? '開' : '關';
    }
  }
  jump = false;
  private lookId = -1;
  private stickId = -1;
  private lastX = 0;
  private lastY = 0;
  private lockSettleUntil = 0;
  private abort = new AbortController();
  private _mode: InputMode = 'walk';
  get mode() { return this._mode; }
  /** A lift pauses movement without releasing the player's keys or captured finger.
   * Other modals still drop held input, so closing a dialogue never resumes an old walk. */
  set mode(m: InputMode) {
    if (m === this._mode) return;
    const liftTransition = (this._mode === 'walk' && m === 'carried') || (this._mode === 'carried' && m === 'walk');
    this._mode = m;
    if (!liftTransition) { this.release(); return; }
    this.jump = false; this.lookId = -1;
    if (m === 'walk' && (this.axes.forward !== 0 || this.axes.right !== 0)) this.hooks.moveStarted();
  }

  constructor(canvas: HTMLElement, private joystick: HTMLElement, private knob: HTMLElement, private hooks: InputHooks) {
    this.runButton = joystick.parentElement?.querySelector<HTMLButtonElement>('[data-action=run]') ?? null;
    const signal = this.abort.signal;
    window.addEventListener('keydown', e => {
      const k = e.key.toLowerCase();
      const typing = (e.target as HTMLElement).matches?.('input,select,textarea');
      if (typing && k !== 'escape') return;
      // The clickable minimap owns its button activation keys, including Space (normally jump).
      if ((k === 'enter' || k === ' ') && (e.target as HTMLElement).matches?.('.walk-minimap')) return;
      const mode = this._mode;
      if(mode==='dialogue'&&nativeDialogueLinkKey(k,e.target,!!document.querySelector?.('.q-dialog:not([hidden]) a[data-content-link]')))return;
      if (mode === 'dialogue' || mode === 'menu' || mode === 'photo' || mode === 'carried') {
        // Menus keep native focus navigation (Tab, arrows, Enter, Space activate the focused control).
        const native = (mode === 'menu' || mode === 'carried') && (k === 'tab' || k === 'enter' || k === ' ' || k.startsWith('arrow'));
        if (!native && (k === 'tab' || k === 'enter' || k === ' ' || OWNED.includes(k) || /^[1-4]$/.test(k))) { e.preventDefault(); e.stopImmediatePropagation(); }
        if ((mode === 'photo' || mode === 'carried') && (MOVE_KEYS.includes(k) || k === 'shift')) { this.keys.add(k); return; }
        if (!e.repeat) hooks.modal?.(k, mode);
        return;
      }
      if (OWNED.includes(k)) { e.preventDefault(); e.stopImmediatePropagation(); }
      if (MOVE_KEYS.includes(k)) { if (!this.keys.has(k)) hooks.moveStarted(); this.keys.add(k); return; }
      if (k === 'shift') { this.keys.add(k); return; }
      if (k === ' ') { if (!e.repeat) this.jump = true; return; }
      if (!e.repeat) hooks.press(k);
    }, { capture: true, signal });
    window.addEventListener('keyup', e => this.keys.delete(e.key.toLowerCase()), { capture: true, signal });
    window.addEventListener('blur', () => this.release(), { signal });
    // Chromium often reports one huge movementX/Y right after a pointer-lock grab; ignore that burst so
    // entering first person keeps the level pitch it was given.
    document.addEventListener('pointerlockchange', () => { if (!document.pointerLockElement) this.lookId = -1; else this.lockSettleUntil = performance.now() + 120; }, { signal });

    canvas.style.touchAction = 'none';
    canvas.addEventListener('pointerdown', e => {
      if (!hooks.canLook() || this.lookId !== -1) return;
      this.lookId = e.pointerId; this.lastX = e.clientX; this.lastY = e.clientY;
      // Under pointer lock (first person) capture is invalid and throws InvalidStateError; movement comes from the lock.
      if (document.pointerLockElement !== canvas) { try { canvas.setPointerCapture(e.pointerId); } catch { /* capture is best-effort */ } }
    }, { signal });
    canvas.addEventListener('pointermove', e => {
      if (document.pointerLockElement === canvas) { if (performance.now() < this.lockSettleUntil || Math.abs(e.movementX) > 300 || Math.abs(e.movementY) > 300) return; hooks.look(e.movementX, e.movementY); return; }
      if (e.pointerId !== this.lookId) return;
      hooks.look(e.clientX - this.lastX, e.clientY - this.lastY);
      this.lastX = e.clientX; this.lastY = e.clientY;
    }, { signal });
    const endLook = (e: PointerEvent) => { if (e.pointerId === this.lookId) this.lookId = -1; };
    canvas.addEventListener('pointerup', endLook, { signal });
    canvas.addEventListener('pointercancel', endLook, { signal });
    canvas.addEventListener('wheel', e => { if (hooks.canLook()) { e.preventDefault(); hooks.zoom(e.deltaY); } }, { passive: false, signal });

    const moveStick = (e: PointerEvent) => {
      const r = joystick.getBoundingClientRect();
      const v = new Vector2(e.clientX - r.left - r.width / 2, e.clientY - r.top - r.height / 2).divideScalar(38);
      if (v.length() > 1) v.normalize();
      this.stick.copy(v);
      joystick.classList.toggle('is-stick-running', this.stickRunning);
      knob.style.transform = `translate(${v.x * 30}px,${v.y * 30}px)`;
    };
    joystick.addEventListener('pointerdown', e => {
      if ((this._mode !== 'walk' && this._mode !== 'carried') || this.stickId !== -1) return;
      this.stickId = e.pointerId; joystick.setPointerCapture(e.pointerId); moveStick(e);
      if (this._mode === 'walk') hooks.moveStarted();
    }, { signal });
    joystick.addEventListener('pointermove', e => { if (e.pointerId === this.stickId) moveStick(e); }, { signal });
    const endStick = (e: PointerEvent) => { if (e.pointerId === this.stickId) this.releaseStick(); };
    joystick.addEventListener('pointerup', endStick, { signal });
    joystick.addEventListener('pointercancel', endStick, { signal });
    joystick.addEventListener('lostpointercapture', endStick, { signal });
  }

  private get stickRunning() { return this.stick.lengthSq() >= STICK_RUN_THRESHOLD ** 2; }
  get running() { return this.runToggle || this.keys.has('shift') || this.stickRunning; }

  private releaseStick() {
    const id = this.stickId;
    this.stickId = -1;
    this.stick.set(0, 0);
    this.knob.style.transform = '';
    this.joystick.classList.remove('is-stick-running');
    if (id !== -1 && this.joystick.hasPointerCapture(id)) this.joystick.releasePointerCapture(id);
  }

  get axes(): MoveAxes { return this._mode === 'carried' ? { forward: 0, right: 0 } : moveAxes(this.keys, this.stick); }

  /** Requested movement relative to the camera's ground forward; length ≤ 1. */
  direction(forward: Vector3, out = new Vector3()) {
    const { forward: f, right: r } = this.axes;
    out.set(forward.x * f - forward.z * r, 0, forward.z * f + forward.x * r);
    if (out.lengthSq() > 1) out.normalize();
    return out;
  }

  /** Read-and-clear the jump press. */
  takeJump() { const j = this.jump; this.jump = false; return j; }

  release() { this.keys.clear(); this.releaseStick(); this.jump = false; this.lookId = -1; }

  dispose() { this.abort.abort(); this.release(); if (document.pointerLockElement) document.exitPointerLock(); }
}
