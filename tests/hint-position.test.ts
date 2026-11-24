import {expect,it} from 'vitest';
import {clampHint} from '../src/story/hint-position';
it('keeps the full label inside narrow mobile and desktop viewports',()=>{
 for(const [w,h] of [[390,844],[1440,900]])for(const [x,y] of [[-100,-100],[w+100,h+100],[w/2,h/2]]){
  const p=clampHint(x,y,160,48,w,h);expect(p.x).toBeGreaterThanOrEqual(8);expect(p.y).toBeGreaterThanOrEqual(8);expect(p.x+160).toBeLessThanOrEqual(w-8);expect(p.y+48).toBeLessThanOrEqual(h-8);
 }
});
it('respects notches and home-indicator safe areas on every edge',()=>{
 const insets={top:44,right:20,bottom:34,left:20};
 expect(clampHint(0,0,180,50,390,844,insets)).toEqual({x:28,y:52});
 expect(clampHint(390,900,180,50,390,844,insets)).toEqual({x:182,y:752});
});
it('steps the label below the corner buttons it would cover, or above when there is no room below', () => {
 // 412 × 915 phone: the six corner buttons sit at the top right (P9 review: the pill covered the first two).
 const buttons = { x: 252, y: 12, width: 148, height: 96 };
 const p = clampHint(206, -50, 236, 34, 412, 915, undefined, 8, [buttons]);
 expect(p.y).toBe(buttons.y + buttons.height + 8);
 const overlaps = p.x < buttons.x + buttons.width && buttons.x < p.x + 236 && p.y < buttons.y + buttons.height && buttons.y < p.y + 34;
 expect(overlaps).toBe(false);
 // Two stacked boxes: the label clears both.
 const status = { x: 12, y: 112, width: 260, height: 40 };
 const q = clampHint(206, -50, 236, 34, 412, 915, undefined, 8, [buttons, status]);
 expect(q.y).toBe(status.y + status.height + 8);
 // A label that does not touch a box keeps its anchored place.
 expect(clampHint(206, 600, 236, 34, 412, 915, undefined, 8, [buttons])).toEqual(clampHint(206, 600, 236, 34, 412, 915));
 // Nothing below: go above the box.
 const low = { x: 0, y: 860, width: 412, height: 40 };
 expect(clampHint(206, 915, 236, 34, 412, 915, undefined, 8, [low]).y).toBe(860 - 8 - 34);
});
