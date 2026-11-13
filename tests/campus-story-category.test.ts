import { expect,it } from 'vitest';
import { readFileSync } from 'node:fs';
import { storyCategoryLabel } from '../src/walk-campus-ui';
it('labels history, news, legend and legacy stories consistently',()=>{
 expect(['history','news','legend',undefined].map(storyCategoryLabel)).toEqual(['校史','新聞記載','校園趣聞','校史']);
 const ui=readFileSync('src/walk-campus-ui.ts','utf8');
 expect(ui).toContain('怪談類傳說查無可引用來源，暫不收錄。');
 expect((ui.match(/categoryTag\(s.category\)/g)??[]).length).toBe(2);
});
it('the interaction list paints above NPC badges',()=>{
 const css=readFileSync('src/story/story.css','utf8');
 expect(css).toMatch(/\.q-hint\.has-choices\{z-index:4;/);
 expect(css).toContain('.q-npc-badge{z-index:1}');
});
