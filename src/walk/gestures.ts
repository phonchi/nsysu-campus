import type { GestureId, GestureReaction, P3 } from '../world/v12-types';
export const GESTURES:readonly {id:GestureId;label:string}[]=[{id:'wave',label:'揮手'},{id:'bow',label:'鞠躬'},{id:'thumbsUp',label:'比讚'},{id:'clap',label:'拍手'}];
export interface GestureNpc {id:string;position:P3;seated?:boolean;talking?:boolean;reserved?:boolean;visible?:boolean}
/** Spec §1: ±60 degrees, one primary plus at most two secondary nods. */
export function gestureReactions(gesture:GestureId,player:P3,heading:number,npcs:readonly GestureNpc[],visible:(npc:GestureNpc)=>boolean=()=>true):GestureReaction[]{
 const near=npcs.filter(n=>n.visible!==false&&Math.abs(n.position[1]-player[1])<1&&Math.hypot(n.position[0]-player[0],n.position[2]-player[2])<=4&&visible(n))
  .sort((a,b)=>Math.hypot(a.position[0]-player[0],a.position[2]-player[2])-Math.hypot(b.position[0]-player[0],b.position[2]-player[2])||(a.id<b.id?-1:a.id>b.id?1:0));
 const primary=near.find(n=>{const x=n.position[0]-player[0],z=n.position[2]-player[2],d=Math.hypot(x,z);return d===0||(-Math.sin(heading)*x-Math.cos(heading)*z)/d>=.5-1e-9;});
 const out:GestureReaction[]=[];
 if(primary)out.push({npcId:primary.id,role:'primary',kind:primary.seated||primary.talking||primary.reserved?'nod':gesture==='thumbsUp'?'nod':gesture});
 for(const n of near.filter(n=>n!==primary).slice(0,2))out.push({npcId:n.id,role:'secondary',kind:'nod'});
 return out;
}
/** Overlay owns only its keys; closing returns to the unchanged photo/dialogue state. */
export class GestureMenu {
 readonly element:HTMLElement;private previous:HTMLElement|null=null;
 constructor(host:HTMLElement,private choose:(id:GestureId)=>void,private changed:()=>void){
  this.element=document.createElement('div');this.element.className='walk-gestures';this.element.hidden=true;this.element.setAttribute('role','dialog');this.element.setAttribute('aria-label','手勢');
  this.element.innerHTML=`<strong>手勢</strong><div>${GESTURES.map((g,i)=>`<button type="button" data-gesture="${g.id}">${i+1} · ${g.label}</button>`).join('')}<button type="button" data-gesture-close>關閉</button></div>`;
  host.append(this.element);this.element.addEventListener('click',e=>{const b=(e.target as HTMLElement).closest<HTMLElement>('button');if(b?.dataset.gesture)this.pick(b.dataset.gesture as GestureId);else if(b)this.close();});
 }
 get open(){return !this.element.hidden;}
 toggle(){if(this.open)this.close();else{this.previous=document.activeElement as HTMLElement|null;this.element.hidden=false;this.changed();this.element.querySelector('button')?.focus();}}
 key(k:string){if(k==='escape'||k==='t')this.close();else if(/^[1-4]$/.test(k))this.pick(GESTURES[Number(k)-1].id);}
 private pick(id:GestureId){this.close();this.choose(id);}
 close(){if(!this.open)return;this.element.hidden=true;this.previous?.focus();this.changed();}
 dispose(){this.element.remove();}
}
