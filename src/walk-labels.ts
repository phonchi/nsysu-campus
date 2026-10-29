/** Screen-space building labels (art-direction.md §7): pill + faculty underline, greedy de-overlap. */
import * as T from 'three';
import { FACULTY, BUILDING_FACULTY } from './walk-materials';

export interface CampusLabel {id:string;name:string;sub?:string;position:T.Vector3;priority:number;faculty?:string;}
const safe=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));

export class LabelLayer {
 readonly root:HTMLDivElement;
 private readonly nodes=new Map<string,HTMLButtonElement>();
 private readonly v=new T.Vector3();
 constructor(host:HTMLElement,private readonly labels:CampusLabel[],onSelect:(id:string)=>void){
  this.root=document.createElement('div');this.root.className='walk-labels';this.root.setAttribute('aria-label','建築名牌');host.append(this.root);
  for(const l of labels){
   const b=document.createElement('button');b.className='walk-label';b.type='button';b.dataset.label=l.id;
   const fac=FACULTY[l.faculty??BUILDING_FACULTY[l.id]??'admin'];b.style.setProperty('--accent',fac.ui);
   b.innerHTML=`<span>${safe(l.name)}</span>${l.sub?`<small>${safe(l.sub)}</small>`:''}`;b.hidden=true;
   b.addEventListener('click',e=>{e.stopPropagation();onSelect(l.id);});this.root.append(b);this.nodes.set(l.id,b);
  }
 }
 /** maxDistance limits labels in first/third-person walking; bird view shows the whole campus. */
 private occluders:T.Object3D[]=[];private readonly ray=new T.Raycaster();private occluded=new Set<string>();private lastOcclusion=-1e9;
 setOccluders(list:T.Object3D[]){this.occluders=list;}
 private refreshOcclusion(camera:T.PerspectiveCamera,ids:CampusLabel[]){
  this.occluded.clear();
  for(const l of ids){const dir=l.position.clone().sub(camera.position),d=dir.length();this.ray.set(camera.position,dir.normalize());this.ray.far=d-4;
   if(this.ray.intersectObjects(this.occluders,true).some(h=>{for(let o:T.Object3D|null=h.object;o;o=o.parent)if(!o.visible)return false;return true;}))this.occluded.add(l.id);}
 }
 update(camera:T.PerspectiveCamera,width:number,height:number,overview:boolean,avoid:DOMRect[]=[],now=performance.now()){
  const max=overview?(width<700?8:14):(width<700?3:5),limit=overview?2600:140,placed:{x0:number;y0:number;x1:number;y1:number}[]=avoid.map(r=>({x0:r.left,y0:r.top,x1:r.right,y1:r.bottom}));
  const order=this.labels.map(l=>({l,d:camera.position.distanceTo(l.position)})).filter(o=>o.d<(overview?limit:limit*.6)).sort((a,b)=>a.l.priority-b.l.priority||a.d-b.d);
  if(overview)this.occluded.clear();else if(now-this.lastOcclusion>150){this.lastOcclusion=now;this.refreshOcclusion(camera,order.slice(0,10).map(o=>o.l));}
  const shown=new Set<string>();
  for(const {l,d} of order){
   if(shown.size>=max)break;
   if(this.occluded.has(l.id))continue;
   this.v.copy(l.position).project(camera);if(this.v.z>1||this.v.z<-1)continue;
   const x=(this.v.x*.5+.5)*width,y=(-this.v.y*.5+.5)*height;if(x<8||x>width-8||y<70||y>height-40)continue;
   const node=this.nodes.get(l.id)!,w=node.offsetWidth||l.name.length*15+28,h=node.offsetHeight||30,box={x0:x-w/2-4,y0:y-h-4,x1:x+w/2+4,y1:y+4};
   if(placed.some(p=>!(box.x1<p.x0||box.x0>p.x1||box.y1<p.y0||box.y0>p.y1)))continue;
   placed.push(box);shown.add(l.id);node.style.transform=`translate(${Math.round(x-w/2)}px,${Math.round(y-h)}px)`;node.style.opacity=overview?String(T.MathUtils.clamp(1.15-d/limit,.6,1)):'1';
  }
  for(const [id,node] of this.nodes){const on=shown.has(id);if(node.hidden===on)node.hidden=!on;}
 }
 dispose(){this.root.remove();this.nodes.clear();}
}
