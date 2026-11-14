import {afterEach,expect,it,vi} from 'vitest';
import fs from 'node:fs';
import {contentLinksHtml,dialogueLinks,journalLinks,mergeContentLinks,nativeDialogueLinkKey,releasePointerLock} from '../src/story/content-links';
import {isAllowedLink,type QuestDefinition} from '../src/story/quests';
import {StoryUi} from '../src/story/ui';
const fixture=JSON.parse(fs.readFileSync('tests/fixtures/link-cases.json','utf8')) as {ok:string[];bad:string[]};
afterEach(()=>vi.unstubAllGlobals());
for(const url of fixture.ok)it(`renders allowed shared fixture: ${url}`,()=>{expect(isAllowedLink(url)).toBe(true);const html=contentLinksHtml([{label:'官網',url}]);expect(html).toContain('target="_blank" rel="noopener noreferrer"');expect(html).toContain('開啟官網：官網');});
for(const url of fixture.bad)it(`drops rejected shared fixture: ${url}`,()=>{expect(isAllowedLink(url)).toBe(false);expect(contentLinksHtml([{label:'官網',url}])).toBe('');});
it('step links precede quest links; normalized duplicate URLs preserve the first label',()=>{
 expect(mergeContentLinks([{label:'站點',url:'https://MATH.NSYSU.EDU.TW'}],[{label:'系網',url:'https://math.nsysu.edu.tw/'},{label:'系圖',url:'https://sites.google.com/math.nsysu.edu.tw/library'}]).map(l=>l.label)).toEqual(['站點','系圖']);
 expect(contentLinksHtml([{label:'<img onerror="x">',url:'https://math.nsysu.edu.tw/'}])).toContain('&lt;img onerror=&quot;x&quot;&gt;');
});
it('completed quest journal retains all distinct official sites and labels the steps',()=>{
 const q=JSON.parse(fs.readFileSync('public/data/quests.json','utf8')).quests.find((q:QuestDefinition)=>q.id==='math-freshman') as QuestDefinition;
 const links=journalLinks(q);expect(links).toHaveLength(4);expect(links.some(l=>l.url.includes('library'))).toBe(true);expect(links.find(l=>l.url.includes('library'))?.label).toBe('應數系數學圖書館（SC4009）');expect(links.every(l=>l.label.length<=24)).toBe(true);
 expect(dialogueLinks(q,q.steps[2])[0].url).toContain('library');
 expect(contentLinksHtml(links).match(/data-content-link/g)).toHaveLength(4);
 const runtime=fs.readFileSync('src/walk/runtime.ts','utf8');expect(runtime).toContain('links:journalLinks(v.definition)');
});
it('say clears stale links without altering the old two-argument signature and begin releases pointer lock',async()=>{
 const links={innerHTML:'old',hidden:false},skip={textContent:''};
 const ui={dialogueEl:{querySelector:(s:string)=>s==='.q-content-links'?links:skip},session:0,log:[],skipping:false,setLinks:(StoryUi.prototype as unknown as {setLinks:unknown}).setLinks};
 const exitPointerLock=vi.fn();vi.stubGlobal('document',{pointerLockElement:{},exitPointerLock});
 StoryUi.prototype.begin.call(ui as unknown as StoryUi);expect(exitPointerLock).toHaveBeenCalled();
 await StoryUi.prototype.say.call(ui as unknown as StoryUi,[],false,{links:[{label:'系網',url:'https://math.nsysu.edu.tw/'}]});expect(links.innerHTML).toContain('系網');expect(links.hidden).toBe(false);
 await StoryUi.prototype.say.call(ui as unknown as StoryUi,[],false);expect(links.innerHTML).toBe('');expect(links.hidden).toBe(true);
});
it('links use native Tab/Enter and never become dialogue choices',()=>{
 const target={closest:(s:string)=>s==='a[data-content-link]'?{}:null} as unknown as EventTarget;
 expect(nativeDialogueLinkKey('tab',null,true)).toBe(true);expect(nativeDialogueLinkKey('enter',target,true)).toBe(true);expect(nativeDialogueLinkKey('e',target,true)).toBe(false);
 const ui=fs.readFileSync('src/story/ui.ts','utf8');expect(ui).toContain('if(isContentLinkTarget(e.target))return;');expect(ui).toContain('this.setLinks();');
 const journal=fs.readFileSync('src/story/journal.ts','utf8');expect(journal).toContain('show(model: JournalModel) { releasePointerLock();');expect(journal).toContain("button:not([disabled]),a[data-content-link]");
});
