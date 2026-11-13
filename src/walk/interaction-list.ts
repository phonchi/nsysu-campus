import { numberedInteractions, type InteractionAction } from './interaction-choice';
export interface InteractionRow extends InteractionAction { label:string; targetLabel?:string }
const esc=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
/** Preserve action priority across people; repeat a group heading when priorities split its rows.
 * Nothing is collapsed or discarded. The four-key window follows the highlighted action. */
export function interactionListHtml(rows:readonly InteractionRow[],selectedId:string):string {
  const numbered=numberedInteractions(rows,selectedId), counts=new Map<string,number>();
  for(const row of rows)counts.set(row.targetId,(counts.get(row.targetId)??0)+1);
  let previous='';
  const html=rows.map(row=>{
    const heading=row.targetLabel && previous!==row.targetId?`<div class="q-interaction-group">${esc(row.targetLabel)} · ${counts.get(row.targetId)} 件事</div>`:'';
    previous=row.targetId;
    const index=numbered.findIndex(r=>r.id===row.id), selected=row.id===selectedId;
    const key=selected?'E':index>=0?String(index+1):'點選';
    return `${heading}<button type="button" data-interaction="${esc(row.id)}" aria-pressed="${selected}"${index>=0?` aria-keyshortcuts="${selected?'E ':''}${index+1}"`:''}><kbd>${key}</kbd><span>${esc(row.label)}</span></button>`;
  }).join('');
  return `<div class="q-interaction-rows" role="group" aria-label="附近可做的事">${html}</div><small class="q-interaction-help">點選或 1–4 執行 · E 高亮項 · R 換高亮</small>`;
}
