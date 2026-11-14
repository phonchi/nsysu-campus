import { Vector3 } from 'three';
import { campusFacts } from '../src/walk/loading-tips';
import { expect,it } from 'vitest';
import { readFileSync } from 'node:fs';
import { storyCategoryLabel, storySupportHeight, nearStorySupport, LORE_NOTE } from '../src/walk-campus-ui';
it('labels history, news, legend, lore and legacy stories consistently',()=>{
 expect(['history','news','legend','lore',undefined].map(storyCategoryLabel)).toEqual(['校史','新聞記載','校園趣聞','校園口傳','校史']);
 const ui=readFileSync('src/walk-campus-ui.ts','utf8');
 expect(ui).toContain('校園口傳依公開頁面收錄並附出處；查無出處的怪談不收。');
 expect((ui.match(/categoryTag\(s.category\)/g)??[]).length).toBe(2);
});
it('the interaction list paints above NPC badges',()=>{
 const css=readFileSync('src/story/story.css','utf8');
 expect(css).toMatch(/\.q-hint\.has-choices\{z-index:4;/);
 expect(css).toContain('.q-npc-badge{z-index:1}');
});

it('keeps lore out of loading facts and marks the card as unverified oral tradition',()=>{
 expect(LORE_NOTE).toBe('此為公開記錄的校園口傳，不代表事件已獲證實。');
 expect(campusFacts({campus:{stories:[{text:'傳說。',category:'lore',sources:[{}]},{text:'校史。',category:'history',sources:[{}]},{text:'舊資料。',sources:[{}]}]}})).toEqual(['校史。','舊資料。']);
 const ui=readFileSync('src/walk-campus-ui.ts','utf8');
 expect(ui).toContain('${LORE_NOTE}');
 expect(readFileSync('src/walkthrough.css','utf8')).toContain('.walk-story-category.is-lore,.walk-story-note.is-lore{border:1px dashed');
});
it('uses a hill or explicit support height for both gem elevation and interaction',()=>{
 const story={id:'hill',title:'hill',pos:[8,12] as [number,number],text:'',sources:[]};
 const height=storySupportHeight(story,()=>24);
 const gem=new Vector3(8,height+1.6,12);
 expect(height).toBe(24);
 expect(nearStorySupport(new Vector3(8,24,12),gem)).toBe(true);
 expect(nearStorySupport(new Vector3(8,0,12),gem)).toBe(false);
 expect(nearStorySupport(new Vector3(8,27,12),gem)).toBe(false);
 expect(storySupportHeight({...story,y:0},()=>24)).toBe(0);
 expect(storySupportHeight({...story,y:30},()=>24)).toBe(30);
});
