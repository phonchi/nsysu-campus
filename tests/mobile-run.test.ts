import { afterEach, describe, expect, it, vi } from 'vitest';
import { Vector3 } from 'three';
import { WalkInput, type InputMode } from '../src/walk/input';

function element() {
  const classes = new Set<string>(), captures = new Set<number>();
  return Object.assign(new EventTarget(), {
    style: { transform: '' },
    classList: {
      toggle(name: string, on: boolean) { if (on) classes.add(name); else classes.delete(name); },
      remove(name: string) { classes.delete(name); },
      contains(name: string) { return classes.has(name); },
    },
    getBoundingClientRect: () => ({ left: 24, top: 100, width: 100, height: 100 }),
    setPointerCapture: (id: number) => captures.add(id),
    hasPointerCapture: (id: number) => captures.has(id),
    releasePointerCapture: (id: number) => captures.delete(id),
  }) as unknown as HTMLElement;
}

const inputs: WalkInput[] = [];
afterEach(() => { inputs.splice(0).forEach(input => input.dispose()); vi.unstubAllGlobals(); });

function setup() {
  const win = new EventTarget();
  vi.stubGlobal('window', win);
  vi.stubGlobal('document', Object.assign(new EventTarget(), { pointerLockElement: null }));
  const joystick = element(), knob = element(), state = { textContent: '關' };
  const button = { dataset: { toggle: 'off' }, setAttribute: vi.fn(), querySelector: () => state };
  Object.assign(joystick, { parentElement: { querySelector: () => button } });
  const moveStarted = vi.fn();
  const input = new WalkInput(element(), joystick, knob, {
    press: vi.fn(), moveStarted, look: vi.fn(), zoom: vi.fn(), canLook: () => false,
  });
  inputs.push(input);
  const pointer = (type: string, x = 0, y = 0, id = 1) => joystick.dispatchEvent(Object.assign(new Event(type), {
    pointerId: id, clientX: 74 + x * 38, clientY: 150 + y * 38,
  }));
  const key = (type: string, key: string) => win.dispatchEvent(Object.assign(new Event(type), { key, repeat: false }));
  return { input, win, joystick, knob, button, state, moveStarted, pointer, key };
}

describe('mobile running', () => {
  it.each([[1, 0], [0, -1], [-Math.SQRT1_2, Math.SQRT1_2]])('runs in the outer ring and walks again inside (%s, %s)', (x, y) => {
    const { input, pointer, joystick, moveStarted } = setup();
    pointer('pointerdown', x * .84, y * .84);
    expect(input.running).toBe(false);
    expect(joystick.classList.contains('is-stick-running')).toBe(false);
    pointer('pointermove', x * .86, y * .86);
    expect(input.running).toBe(true);
    expect(input.runToggle).toBe(false);
    expect(joystick.classList.contains('is-stick-running')).toBe(true);
    pointer('pointermove', x * .4, y * .4);
    expect(input.running).toBe(false);
    expect(joystick.classList.contains('is-stick-running')).toBe(false);
    // Manual movement still interrupts guiding once, at the start of the gesture.
    expect(moveStarted).toHaveBeenCalledTimes(1);
  });

  it('the latch runs with a light push, shows its own state, and toggles off', () => {
    const { input, pointer, button, state, moveStarted } = setup();
    input.runToggle = !input.runToggle; // Existing runtime click contract.
    expect(button.dataset.toggle).toBe('on');
    expect(state.textContent).toBe('開');
    expect(button.setAttribute).toHaveBeenLastCalledWith('aria-label', '持續奔跑：已開啟，再按關閉');
    expect(moveStarted).not.toHaveBeenCalled(); // Toggling alone must not cancel guiding.
    pointer('pointerdown', 0, -.2);
    expect(input.running).toBe(true);
    pointer('pointerup');
    expect(input.runToggle).toBe(true);
    expect(input.direction(new Vector3(0, 0, -1)).length()).toBe(0);
    input.runToggle = !input.runToggle;
    expect(button.dataset.toggle).toBe('off');
    expect(state.textContent).toBe('關');
    pointer('pointerdown', 0, -.2);
    expect(input.running).toBe(false);
  });

  it('full stick and desktop W + Shift produce the same movement and running state', () => {
    const { input, pointer, key, button } = setup();
    const forward = new Vector3(0, 0, -1);
    pointer('pointerdown', 0, -2);
    const touchDirection = input.direction(forward);
    expect(touchDirection.length()).toBeCloseTo(1);
    expect(input.running).toBe(true);
    expect(button.dataset.toggle).toBe('off');
    pointer('pointerup');
    key('keydown', 'w'); key('keydown', 'Shift');
    expect(input.direction(forward).equals(touchDirection)).toBe(true);
    expect(input.running).toBe(true);
    key('keyup', 'Shift');
    expect(input.running).toBe(false);
    expect(input.direction(forward).equals(touchDirection)).toBe(true);
    key('keyup', 'w');
    expect(input.direction(forward).length()).toBe(0);
  });

  it('releasing one run source does not cancel another', () => {
    const { input, pointer, key } = setup();
    key('keydown', 'Shift'); pointer('pointerdown', 1, 0); pointer('pointerup');
    expect(input.running).toBe(true);
    input.runToggle = true; key('keyup', 'Shift');
    expect(input.running).toBe(true);
    pointer('pointerdown', 1, 0); input.runToggle = false;
    expect(input.running).toBe(true);
    pointer('pointermove', .4, 0);
    expect(input.running).toBe(false);
  });

  it.each(['pointerup', 'pointercancel', 'lostpointercapture'])('%s clears movement and the ring', event => {
    const { input, pointer, joystick, knob } = setup();
    pointer('pointerdown', 1, 0); pointer(event);
    expect(input.running).toBe(false);
    expect(input.stick.length()).toBe(0);
    expect(knob.style.transform).toBe('');
    expect(joystick.classList.contains('is-stick-running')).toBe(false);
    expect(joystick.hasPointerCapture(1)).toBe(false);
  });

  it.each(['blur', 'release', 'dispose'])('%s clears a held stick and its feedback', action => {
    const { input, pointer, win, joystick, knob } = setup();
    pointer('pointerdown', 1, 0);
    if (action === 'blur') win.dispatchEvent(new Event('blur'));
    else if (action === 'release') input.release();
    else input.dispose();
    expect(input.running).toBe(false);
    expect(input.stick.length()).toBe(0);
    expect(joystick.classList.contains('is-stick-running')).toBe(false);
    expect(knob.style.transform).toBe('');
  });

  it.each<InputMode>(['menu', 'dialogue', 'photo', 'game'])('drops held touch movement and ignores the stick during %s', mode => {
    const { input, pointer, joystick } = setup();
    pointer('pointerdown', 1, 0); input.mode = mode;
    pointer('pointerdown', 1, 0); pointer('pointermove', 1, 0);
    expect(input.running).toBe(false);
    expect(joystick.classList.contains('is-stick-running')).toBe(false);
    input.mode = 'walk'; pointer('pointerdown', 1, 0);
    expect(input.running).toBe(true);
  });

  it('a second finger cannot take over or release the movement stick', () => {
    const { input, pointer } = setup();
    pointer('pointerdown', 1, 0, 1);
    pointer('pointerdown', .1, 0, 2); pointer('pointermove', .1, 0, 2); pointer('pointerup', 0, 0, 2);
    expect(input.running).toBe(true);
    pointer('pointerup', 0, 0, 1);
    expect(input.running).toBe(false);
  });

  it('ignores stale pointer events after blur and accepts a fresh gesture', () => {
    const { input, pointer, win, joystick } = setup();
    pointer('pointerdown', 1, 0, 1);
    win.dispatchEvent(new Event('blur'));
    pointer('pointermove', 1, 0, 1);
    expect(input.running).toBe(false);
    expect(input.stick.length()).toBe(0);
    expect(joystick.hasPointerCapture(1)).toBe(false);
    pointer('pointerdown', 0, -1, 2);
    pointer('lostpointercapture', 0, 0, 1);
    expect(input.running).toBe(true);
    expect(joystick.hasPointerCapture(2)).toBe(true);
    pointer('pointerup', 0, 0, 2);
    expect(input.running).toBe(false);
  });

  it('keeps the run latch across a menu but requires fresh movement afterwards', () => {
    const { input, pointer, button, state, joystick } = setup();
    input.runToggle = true;
    pointer('pointerdown', 1, 0);
    input.mode = 'menu';
    expect(input.stick.length()).toBe(0);
    expect(joystick.classList.contains('is-stick-running')).toBe(false);
    expect(button.dataset.toggle).toBe('on');
    expect(state.textContent).toBe('開');
    input.mode = 'walk';
    pointer('pointermove', 1, 0);
    expect(input.direction(new Vector3(0, 0, -1)).length()).toBe(0);
    pointer('pointerdown', .2, 0);
    expect(input.running).toBe(true);
    expect(input.direction(new Vector3(0, 0, -1)).length()).toBeCloseTo(.2);
    expect(joystick.classList.contains('is-stick-running')).toBe(false);
  });
});
