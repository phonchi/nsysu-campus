/** Campus-level UI: labels, building info cards, story collectibles and the north-up campus minimap. */
import * as T from 'three';
import type { WalkWorld } from './walk-world';
import type { CampusStructure, Point2, WalkBuilding } from './walk-types';
import { LabelLayer, type CampusLabel } from './walk-labels';
import { FACULTY, BUILDING_FACULTY, PALETTE } from './walk-materials';
import { CAMPUS_GROUND } from './walk-world';

interface Link {label:string;url:string;}
export interface CampusInfo {buildings:Record<string,{name:string;college:string;summary:string;facts:string[];links:Link[]}>;stories:{id:string;title:string;pos:Point2;text:string;sources:Link[]}[];}
interface Hooks {goToBuilding(id:string):void;inspectBuilding(id:string):void;say(text:string,ms?:number):void;}
const safe=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const STORE='nsysu-walk-stories-v1';
const readCollected=():Set<string>=>{try{return new Set(JSON.parse(localStorage.getItem(STORE)??'[]'));}catch{return new Set();}};
const writeCollected=(s:Set<string>)=>{try{localStorage.setItem(STORE,JSON.stringify([...s]));}catch{/* private mode: progress lives for this visit only */}};

export class CampusUi {
 private readonly labels:LabelLayer;private readonly card:HTMLDivElement;private readonly storyCard:HTMLDivElement;private readonly counter:HTMLButtonElement;
 private readonly markers:T.InstancedMesh;private readonly collected=readCollected();private readonly storyPos:T.Vector3[];
 private readonly map=document.createElement('canvas');private readonly mapScale=.36;
 nearStory?:CampusInfo['stories'][number];
 constructor(private readonly host:HTMLElement,private readonly scene:T.Scene,private readonly world:WalkWorld,private readonly structure:CampusStructure,data:WalkBuilding[],private readonly info:CampusInfo,private readonly hooks:Hooks){
  // Labels: the eight walkable buildings first, then OSM landmarks and a few places.
  const list:CampusLabel[]=[];
  for(const b of data){const fs=world.floors.filter(f=>f.buildingId===b.id),top=fs.reduce((a,c)=>c.y>a.y?c:a),g=fs.find(f=>f.data.level===1)??top;
   const c=g.data.outline.reduce((s,p)=>[s[0]+p[0]/g.data.outline.length,s[1]+p[1]/g.data.outline.length],[0,0]);
   list.push({id:b.id,name:info.buildings[b.id]?.name??b.name,sub:'可入內',position:new T.Vector3(c[0],top.y+6,c[1]).applyMatrix4(world.frames.get(b.id)!).setY(top.y+6),priority:0});}
  for(const l of structure.context.landmarks){if(list.some(x=>x.id===l.id))continue;const c=l.polygon.reduce((s,p)=>[s[0]+p[0]/l.polygon.length,s[1]+p[1]/l.polygon.length],[0,0]);
   list.push({id:l.id,name:info.buildings[l.id]?.name??l.name,position:new T.Vector3(c[0],l.storeys*3.6+5,c[1]),priority:info.buildings[l.id]?1:2});}
  for(const [id,name,x,z,y] of [['PLAZA','中庭・菩提樹廣場',-67,-27,4],['BEACH-SAND','西子灣',-280,240,4],['TUNNEL','西子灣隧道',24,150,8]] as [string,string,number,number,number][])
   list.push({id,name,position:new T.Vector3(x,y,z),priority:2,faculty:'marine'});
  this.labels=new LabelLayer(host,list,id=>this.openCard(id));
  const occ:T.Object3D[]=[];world.display.traverse(o=>{if(o.name==='Campus exteriors (merged)'||o.userData.campusLod)occ.push(o);});this.labels.setOccluders(occ);
  // Info card and story card share one dialog layer.
  this.card=document.createElement('div');this.card.className='walk-card';this.card.hidden=true;this.card.setAttribute('role','dialog');host.append(this.card);
  this.card.addEventListener('click',e=>{const a=(e.target as HTMLElement).closest<HTMLElement>('[data-card]')?.dataset;if(!a)return;if(a.card==='close')this.card.hidden=true;if(a.card==='go'){this.card.hidden=true;this.hooks.goToBuilding(a.id!);}if(a.card==='floors'){this.card.hidden=true;this.hooks.inspectBuilding(a.id!);}});
  this.storyCard=document.createElement('div');this.storyCard.className='walk-card walk-story';this.storyCard.hidden=true;this.storyCard.setAttribute('role','dialog');host.append(this.storyCard);
  this.storyCard.addEventListener('click',e=>{if((e.target as HTMLElement).closest('[data-card=close]'))this.storyCard.hidden=true;});
  this.counter=document.createElement('button');this.counter.className='walk-stories';this.counter.type='button';host.append(this.counter);this.counter.addEventListener('click',()=>this.listStories());this.refreshCounter();
  // Story markers: floating gems, gold when uncollected.
  this.storyPos=info.stories.map(s=>new T.Vector3(s.pos[0],1.6,s.pos[1]));
  this.markers=new T.InstancedMesh(new T.OctahedronGeometry(.45,0),new T.MeshStandardMaterial({color:'#f2c94c',emissive:'#f2a93b',emissiveIntensity:.6,roughness:.4}),info.stories.length);this.markers.name='Story markers';this.markers.castShadow=false;scene.add(this.markers);
  this.drawCampusMap();
 }
 get storyProgress(){return {found:[...this.collected].filter(id=>this.info.stories.some(s=>s.id===id)).length,total:this.info.stories.length};}
 private refreshCounter(){this.counter.innerHTML=`<span>校史支線</span><strong>${[...this.collected].filter(id=>this.info.stories.some(s=>s.id===id)).length}</strong><small>／${this.info.stories.length}</small>`;}
 openCard(id:string){
  const b=this.info.buildings[id];const walkable=this.world.frames.has(id);
  if(!b){this.hooks.say(id==='TUNNEL'?'西子灣隧道：1928 年貫通的「壽山洞」。':'這裡目前只有外觀。',3500);return;}
  const fac=FACULTY[b.college]??FACULTY[BUILDING_FACULTY[id]??'admin'];
  this.card.style.setProperty('--accent',fac.ui);
  this.card.innerHTML=`<button class="walk-card-close" data-card="close" aria-label="關閉">×</button><div class="walk-card-chip">${safe(fac.name)}${walkable?'・可入內':'・外觀'}</div><h2>${safe(b.name)}</h2><p>${safe(b.summary)}</p>${b.facts.length?`<ul>${b.facts.map(f=>`<li>${safe(f)}</li>`).join('')}</ul>`:''}${walkable?`<div class="walk-card-actions"><button class="walk-button primary" data-card="go" data-id="${safe(id)}">帶我去 1F 入口</button><button class="walk-button" data-card="floors" data-id="${safe(id)}">逐層看</button></div>`:''}<div class="walk-card-links">${b.links.map(l=>`<a href="${safe(l.url)}" target="_blank" rel="noopener">${safe(l.label)} ↗</a>`).join('')}</div>`;
  this.card.hidden=false;this.storyCard.hidden=true;
 }
 private listStories(){
  this.storyCard.innerHTML=`<button class="walk-card-close" data-card="close" aria-label="關閉">×</button><div class="walk-card-chip">校園故事收集</div><h2>${this.collected.size} ／ ${this.info.stories.length}</h2><ol class="walk-story-list">${this.info.stories.map(s=>`<li class="${this.collected.has(s.id)?'is-found':''}">${this.collected.has(s.id)?safe(s.title):'？？？（在校園裡找找發光的寶石）'}</li>`).join('')}</ol>`;
  this.storyCard.hidden=false;this.card.hidden=true;
 }
 /** E key: read a nearby story. Returns true when handled. */
 interact(foot:T.Vector3){
  const s=this.nearStory;if(!s)return false;
  const isNew=!this.collected.has(s.id);this.collected.add(s.id);writeCollected(this.collected);this.refreshCounter();
  this.storyCard.innerHTML=`<button class="walk-card-close" data-card="close" aria-label="關閉">×</button><div class="walk-card-chip">${isNew?'新收集・':''}校園故事 ${this.collected.size}／${this.info.stories.length}</div><h2>${safe(s.title)}</h2><p>${safe(s.text)}</p><div class="walk-card-links">${s.sources.map(l=>`<a href="${safe(l.url)}" target="_blank" rel="noopener">${safe(l.label)} ↗</a>`).join('')}</div>`;
  this.storyCard.hidden=false;this.card.hidden=true;void foot;return true;
 }
 private readonly dummy=new T.Object3D();private lastAvoid=-1e9;private avoid:DOMRect[]=[];
 update(camera:T.PerspectiveCamera,overview:boolean,foot:T.Vector3,time:number){
  if(time-this.lastAvoid>500){this.lastAvoid=time;this.avoid=[...this.host.querySelectorAll<HTMLElement>('.walk-topbar,.walk-location,.walk-floor-label,.walk-minimap,.walk-actions,.walk-stories,.walk-card:not([hidden]),.walk-welcome:not([hidden])')].filter(e=>e.offsetParent).map(e=>e.getBoundingClientRect());}
  this.labels.update(camera,innerWidth,innerHeight,overview,this.avoid);
  this.nearStory=undefined;
  this.info.stories.forEach((s,i)=>{const p=this.storyPos[i],found=this.collected.has(s.id);this.dummy.position.set(p.x,p.y+Math.sin(time*.002+i)*.18,p.z);this.dummy.rotation.set(0,time*.0012+i,0);const k=found?.55:1;this.dummy.scale.set(k,k*1.4,k);this.dummy.updateMatrix();this.markers.setMatrixAt(i,this.dummy.matrix);
   if(!overview&&Math.hypot(p.x-foot.x,p.z-foot.z)<3&&Math.abs(foot.y)<2.5)this.nearStory=s;});
  this.markers.instanceMatrix.needsUpdate=true;
 }
 // North-up campus minimap from OSM context (drawn once, panned per frame).
 private drawCampusMap(){
  const [x0,z0,x1,z1]=CAMPUS_GROUND,k=this.mapScale,c=this.map;c.width=Math.ceil((x1-x0)*k);c.height=Math.ceil((z1-z0)*k);const g=c.getContext('2d');if(!g)return;
  const P=(p:Point2)=>[(p[0]-x0)*k,(p[1]-z0)*k] as const;
  g.fillStyle='#cfe8b8';g.fillRect(0,0,c.width,c.height);g.fillStyle=PALETTE.seaShallow;g.fillRect(0,0,6,c.height);
  g.lineCap='round';g.lineJoin='round';
  for(const r of this.structure.context.roads){if(r.tunnel)continue;g.strokeStyle=['footway','path','steps','pedestrian','cycleway'].includes(r.kind)?'#f4efe2':'#ffffff';g.lineWidth=Math.max(1,r.width*k);g.beginPath();r.points.forEach((p,i)=>{const [x,y]=P(p);i?g.lineTo(x,y):g.moveTo(x,y);});g.stroke();}
  const poly=(pts:Point2[],fill:string)=>{g.fillStyle=fill;g.beginPath();pts.forEach((p,i)=>{const [x,y]=P(p);i?g.lineTo(x,y):g.moveTo(x,y);});g.closePath();g.fill();};
  for(const b of this.structure.context.background)poly(b.polygon,'#c9bfae');
  for(const b of this.structure.context.landmarks)poly(b.polygon,'#d79a85');
  for(const f of this.world.floors){if(f.data.level!==1)continue;const m=this.world.frames.get(f.buildingId)!;poly(f.data.outline.map(([x,z])=>{const v=new T.Vector3(x,0,z).applyMatrix4(m);return [v.x,v.z] as Point2;}),FACULTY[BUILDING_FACULTY[f.buildingId]??'science'].band);}
 }
 drawMinimap(ctx:CanvasRenderingContext2D,foot:T.Vector3,yaw:number,W=280,H=220){
  const [x0,z0]=CAMPUS_GROUND,k=this.mapScale*2.2;ctx.save();ctx.fillStyle='#183a40';ctx.fillRect(0,0,W,H);
  ctx.translate(W/2,H/2);ctx.scale(2.2,2.2);ctx.translate(-(foot.x-x0)*this.mapScale,-(foot.z-z0)*this.mapScale);ctx.drawImage(this.map,0,0);ctx.restore();
  ctx.fillStyle='#f2c94c';this.info.stories.forEach(s=>{if(this.collected.has(s.id))return;const x=W/2+(s.pos[0]-foot.x)*k,y=H/2+(s.pos[1]-foot.z)*k;if(x<0||y<0||x>W||y>H)return;ctx.beginPath();ctx.arc(x,y,3,0,Math.PI*2);ctx.fill();});
  ctx.save();ctx.translate(W/2,H/2);ctx.rotate(-yaw);ctx.fillStyle='#173e49';ctx.strokeStyle='#ffffff';ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(0,-9);ctx.lineTo(-6,6);ctx.lineTo(6,6);ctx.closePath();ctx.fill();ctx.stroke();ctx.restore();
  ctx.fillStyle='rgba(23,62,73,.9)';ctx.beginPath();ctx.arc(W-22,22,13,0,Math.PI*2);ctx.fill();ctx.fillStyle='#f2c94c';ctx.font='700 13px "Noto Sans TC",sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText('N',W-22,22);ctx.textAlign='start';ctx.textBaseline='alphabetic';
  ctx.font='13px "Noto Sans TC",sans-serif';ctx.fillStyle='#173e49';ctx.fillText('全校地圖 · 北朝上',10,H-10);
 }
 dispose(){this.labels.dispose();this.card.remove();this.storyCard.remove();this.counter.remove();this.scene.remove(this.markers);this.markers.geometry.dispose();(this.markers.material as T.Material).dispose();}
}
