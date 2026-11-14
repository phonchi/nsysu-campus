import {isAllowedLink,MAX_CONTENT_LINKS,type ContentLink,type QuestDefinition,type QuestStep} from './quests';
export interface TalkPresentation {links?:readonly ContentLink[]}
/** Each authored group has at most two links; merged views retain every distinct safe URL. */
export function mergeContentLinks(...groups:(readonly ContentLink[]|undefined)[]):ContentLink[]{
 const seen=new Set<string>(),out:ContentLink[]=[];
 for(const group of groups)for(const link of Array.isArray(group)?group.slice(0,MAX_CONTENT_LINKS):[]){
  if(!link||typeof link.label!=='string'||!link.label.trim()||!isAllowedLink(link.url))continue;
  const url=new URL(link.url).href;if(seen.has(url))continue;seen.add(url);out.push({label:link.label,url});
 }
 return out;
}
export const dialogueLinks=(quest:QuestDefinition,step?:QuestStep)=>mergeContentLinks(step?.links,quest.links);
/** Journal view: quest links first, then each station's links labelled with its room code (e.g. SC4010) when it has one. */
const stationTag=(step:QuestStep)=>step.target?.startsWith('dest:')?`（${step.target.slice(5)}）`:'';
export function journalLinks(quest:QuestDefinition){return mergeContentLinks(quest.links,...quest.steps.map(step=>step.links?.map(link=>({...link,label:`${link.label}${stationTag(step)}`}))));}
const escape=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export function contentLinksHtml(links:readonly ContentLink[]|undefined){
 // Already merged arrays may exceed two: filter entries independently without truncating the view.
 return mergeContentLinks(...(links??[]).map(link=>[link])).map(link=>`<a data-content-link href="${escape(link.url)}" target="_blank" rel="noopener noreferrer">開啟官網：${escape(link.label)}</a>`).join('');
}
export const isContentLinkTarget=(target:EventTarget|null)=>!!(target as HTMLElement|null)?.closest?.('a[data-content-link]');
export function nativeDialogueLinkKey(key:string,target:EventTarget|null,hasLinks:boolean){return key==='tab'&&hasLinks||key==='enter'&&isContentLinkTarget(target);}
export function releasePointerLock(){if(typeof document!=='undefined'&&document.pointerLockElement)document.exitPointerLock?.();}
