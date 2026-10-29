import { Vector2, Vector3 } from 'three';

const MOVE_KEYS = ['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'];
/** Keys the walkthrough owns while focus is not in a text field. */
const OWNED = [...MOVE_KEYS, ' ', 'e', 'g', 'v', 'm', 'n', 'l', 'p', 'b', 'j', 'r', 'shift', '/', 'escape'];

/** Who owns the keyboard (spec-v4 §15.4). Outside "walk" no movement is recorded and no walk shortcut fires;
 * every key goes to `modal` instead (photo mode still records movement keys for its camera). */
export type InputMode = 'walk' | 'dialogue' | 'menu' | 'photo' | 'game';

export interface InputHooks {
  /** A key press while a modal mode owns the keyboard. */
  modal?(key: string, mode: InputMode): void;
  /** A single key press (no auto-repeat), lower-case `KeyboardEvent.key`. */
  press(key: string): void;
  /** The player started moving by hand (keys or stick). */
  moveStarted(): void;
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
  runToggle = false;
  jump = false;
  private lookId = -1;
  private stickId = -1;
  private lastX = 0;
  private lastY = 0;
  private abort = new AbortController();
  private _mode: InputMode = 'walk';
  get mode() { return this._mode; }
  /** Switching modes drops held keys, so a key held into a dialogue never keeps walking afterwards. */
  set mode(m: InputMode) { if (m !== this._mode) { this._mode = m; this.release(); } }

  constructor(canvas: HTMLElement, joystick: HTMLElement, knob: HTMLElement, private hooks: InputHooks) {
    const signal = this.abort.signal;
    window.addEventListener('keydown', e => {
      const k = e.key.toLowerCase();
      const typing = (e.target as HTMLElement).matches?.('input,select,textarea');
      if (typing && k !== 'escape') return;
      const mode = this._mode;
      if (mode === 'dialogue' || mode === 'menu' || mode === 'photo') {
        // Menus keep native focus navigation (Tab, arrows, Enter, Space activate the focused control).
        const native = mode === 'menu' && (k === 'tab' || k === 'enter' || k === ' ' || k.startsWith('arrow'));
        if (!native && (k === 'tab' || k === 'enter' || k === ' ' || OWNED.includes(k) || /^[1-4]$/.test(k))) { e.preventDefault(); e.stopImmediatePropagation(); }
        if (mode === 'photo' && (MOVE_KEYS.includes(k) || k === 'shift')) { this.keys.add(k); return; }
        if (!e.repeat) hooks.modal?.(k, mode);
        return;
      }
      if (OWNED.includes(k)) { e.preventDefault(); e.stopImmediatePropagation(); }
      if (MOVE_KEYS.includes(k)) { if (!this.keys.has(k)) hooks.moveStarted(); this.keys.add(k); return; }
      if (k === 'shift') { this.keys.add(k); return; }
      if (k === ' ') { if (!e.repeat) this.jump = true; return; }
      if (!e.repeat) hooks.press(k);
    }, { capture: true, signal });
    window.addEventListener('keyup', e => this.keys.delete(e.key.toLowerCase()), { signal });
    window.addEventListener('blur', () => this.release(), { signal });
    document.addEventListener('pointerlockchange', () => { if (!document.pointerLockElement) this.lookId = -1; }, { signal });

    canvas.style.touchAction = 'none';
    canvas.addEventListener('pointerdown', e => {
      if (!hooks.canLook() || this.lookId !== -1) return;
      this.lookId = e.pointerId; this.lastX = e.clientX; this.lastY = e.clientY;
      canvas.setPointerCapture(e.pointerId);
    }, { signal });
    canvas.addEventListener('pointermove', e => {
      if (document.pointerLockElement === canvas) { hooks.look(e.movementX, e.movementY); return; }
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
      knob.style.transform = `translate(${v.x * 30}px,${v.y * 30}px)`;
    };
    joystick.addEventListener('pointerdown', e => {
      if (this.stickId !== -1) return;
      this.stickId = e.pointerId; joystick.setPointerCapture(e.pointerId); moveStick(e); hooks.moveStarted();
    }, { signal });
    joystick.addEventListener('pointermove', e => { if (e.pointerId === this.stickId) moveStick(e); }, { signal });
    const endStick = (e: PointerEvent) => { if (e.pointerId === this.stickId) { this.stickId = -1; this.stick.set(0, 0); knob.style.transform = ''; } };
    joystick.addEventListener('pointerup', endStick, { signal });
    joystick.addEventListener('pointercancel', endStick, { signal });
  }

  get running() { return this.runToggle || this.keys.has('shift'); }

  /** Requested movement relative to the camera's ground forward; length ≤ 1. */
  direction(forward: Vector3, out = new Vector3()) {
    const k = this.keys;
    const f = (k.has('w') || k.has('arrowup') ? 1 : 0) - (k.has('s') || k.has('arrowdown') ? 1 : 0) - this.stick.y;
    const r = (k.has('d') || k.has('arrowright') ? 1 : 0) - (k.has('a') || k.has('arrowleft') ? 1 : 0) + this.stick.x;
    out.set(forward.x * f - forward.z * r, 0, forward.z * f + forward.x * r);
    if (out.lengthSq() > 1) out.normalize();
    return out;
  }

  /** Read-and-clear the jump press. */
  takeJump() { const j = this.jump; this.jump = false; return j; }

  release() { this.keys.clear(); this.stick.set(0, 0); this.jump = false; this.lookId = -1; this.stickId = -1; }

  dispose() { this.abort.abort(); if (document.pointerLockElement) document.exitPointerLock(); }
}
