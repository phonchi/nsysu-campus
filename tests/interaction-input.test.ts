import { afterEach, expect, it, vi } from 'vitest';
import { WalkInput } from '../src/walk/input';
const element=()=>Object.assign(new EventTarget(),{style:{},classList:{remove:()=>{}},setPointerCapture:()=>{}}) as unknown as HTMLElement;
afterEach(()=>vi.unstubAllGlobals());
it('routes numbers to the list and dialogue; arrow keys always walk, even with a list open',()=>{
 const win=new EventTarget(),doc=Object.assign(new EventTarget(),{pointerLockElement:null});
 vi.stubGlobal('window',win);vi.stubGlobal('document',doc);
 let list=true;const press=vi.fn(),modal=vi.fn(),moveStarted=vi.fn();
 const input=new WalkInput(element(),element(),element(),{press,modal,moveStarted,look:()=>{},zoom:()=>{},canLook:()=>false,interactionListOpen:()=>list});
 const key=(key:string)=>{const e=Object.assign(new Event('keydown',{cancelable:true}),{key,repeat:false});win.dispatchEvent(e);return e;};
 expect(key('2').defaultPrevented).toBe(true);expect(press).toHaveBeenLastCalledWith('2');
 key('ArrowDown');expect(input.keys.has('arrowdown')).toBe(true);expect(press).toHaveBeenCalledTimes(1);
 key('w');expect(input.keys.has('w')).toBe(true);
 input.mode='dialogue';key('1');key('ArrowUp');
 expect(modal.mock.calls).toEqual([['1','dialogue'],['arrowup','dialogue']]);expect(press).toHaveBeenCalledTimes(1);expect(input.keys.size).toBe(0);
 input.mode='walk';list=false;key('ArrowUp');expect(input.keys.has('arrowup')).toBe(true);
 input.dispose();
});
it('dialogue link Tab and Enter remain native while other dialogue keys still route',()=>{
 let focusedLink=false;
 const win=Object.assign(new EventTarget(),{closest:()=>focusedLink?{}:null}),doc=Object.assign(new EventTarget(),{pointerLockElement:null,querySelector:()=>({})});
 vi.stubGlobal('window',win);vi.stubGlobal('document',doc);
 const modal=vi.fn(),input=new WalkInput(element(),element(),element(),{press:()=>{},modal,moveStarted:()=>{},look:()=>{},zoom:()=>{},canLook:()=>false});
 input.mode='dialogue';
 const key=(key:string)=>{const e=Object.assign(new Event('keydown',{cancelable:true}),{key,repeat:false});win.dispatchEvent(e);return e;};
 expect(key('Tab').defaultPrevented).toBe(false);focusedLink=true;expect(key('Enter').defaultPrevented).toBe(false);expect(modal).not.toHaveBeenCalled();
 expect(key('e').defaultPrevented).toBe(true);expect(modal).toHaveBeenCalledWith('e','dialogue');input.dispose();
});

it('holds a touch run across threshold noise and releases it on a shorter pull or touch end', () => {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('document', Object.assign(new EventTarget(), { pointerLockElement: null }));
  const joystick = element();
  Object.assign(joystick, {
    classList: { toggle() {}, remove() {} },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }),
    hasPointerCapture: () => false,
  });
  const input = new WalkInput(element(), joystick, element(), {
    press() {}, moveStarted() {}, look() {}, zoom() {}, canLook: () => false,
  });
  const touch = (type: string, offset: number) => {
    joystick.dispatchEvent(Object.assign(new Event(type), { pointerId: 1, clientX: 50, clientY: 50 - offset }));
  };
  touch('pointerdown', 32);
  expect(input.running).toBe(false);
  touch('pointermove', 33);
  expect(input.running).toBe(true);
  touch('pointermove', 32);
  expect(input.running).toBe(true);
  expect(input.axes.forward).toBeCloseTo(32 / 38);
  touch('pointermove', 30);
  expect(input.running).toBe(false);
  touch('pointermove', 38);
  expect(input.running).toBe(true);
  touch('pointerup', 38);
  expect(input.running).toBe(false);
  expect(input.axes.forward).toBe(0);
  input.dispose();
});
