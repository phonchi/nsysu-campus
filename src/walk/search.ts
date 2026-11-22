import type { WalkDestination } from '../walk-types';
const normalize=(s:string)=>s.normalize('NFKC').toUpperCase().replace(/\s/g,'');
export const isRestroomSearch=(term:string)=>['廁所','洗手間','WC'].includes(normalize(term));
/** Route length callback returns Infinity for unreachable destinations; generic searches do not
 * trigger pathfinding. Exact aliases list every child in code-string order, without truncation. */
export function searchDestinations(destinations:readonly WalkDestination[],term:string,routeLength:(d:WalkDestination)=>number=()=>Infinity):WalkDestination[]{
 const q=normalize(term);if(!q)return [];
 if(isRestroomSearch(q))return destinations.filter(d=>d.category==='restroom').map(d=>({d,length:routeLength(d)})).filter(x=>Number.isFinite(x.length))
  .sort((a,b)=>a.length-b.length||(a.d.id<b.d.id?-1:a.d.id>b.d.id?1:0)).slice(0,1).map(x=>x.d);
 const compare=(a:WalkDestination,b:WalkDestination)=>a.label<b.label?-1:a.label>b.label?1:a.id<b.id?-1:a.id>b.id?1:0;
 const aliases=destinations.filter(d=>d.aliases?.some(a=>normalize(a)===q));if(aliases.length)return aliases.sort(compare);
 return destinations.filter(d=>normalize([d.label,d.buildingId,d.displayName,...d.aliases??[]].join(' ')).includes(q)).sort(compare).slice(0,12);
}
