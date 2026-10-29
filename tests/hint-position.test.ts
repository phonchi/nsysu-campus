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
