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
