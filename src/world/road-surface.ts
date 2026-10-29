import * as T from 'three';
import { Terrain, type TerrainSurface } from './terrain';
export type Point2=[number,number];
type Vertex={x:number;z:number;u:number;v:number};
const cross=(a:Vertex,b:Vertex,c:Vertex)=>(b.x-a.x)*(c.z-a.z)-(b.z-a.z)*(c.x-a.x);
function clip(poly:Vertex[],a:Vertex,b:Vertex,sign:number,keepInside=true):Vertex[]{
 const out:Vertex[]=[];if(!poly.length)return out;
 const d=(p:Vertex)=>cross(a,b,p)*sign*(keepInside?1:-1);
 for(let i=0;i<poly.length;i++){
  const p=poly[i],q=poly[(i+1)%poly.length],dp=d(p),dq=d(q),pi=dp>=-1e-8,qi=dq>=-1e-8;
  if(pi)out.push(p);
  if(pi!==qi){const t=dp/(dp-dq);out.push({x:p.x+(q.x-p.x)*t,z:p.z+(q.z-p.z)*t,u:p.u+(q.u-p.u)*t,v:p.v+(q.v-p.v)*t});}
 }
 return out;
}
const toVertex=(p:Point2):Vertex=>({x:p[0],z:p[1],u:0,v:0});
function intersect(poly:Vertex[],triangle:Vertex[]){let out=poly;const sign=Math.sign(cross(...triangle as [Vertex,Vertex,Vertex]))||1;for(let i=0;i<3;i++)out=clip(out,triangle[i],triangle[(i+1)%3],sign);return out;}
interface Cutter{tri:Vertex[];bounds:[number,number,number,number]}
const bounds=(p:Vertex[]):[number,number,number,number]=>[Math.min(...p.map(p=>p.x)),Math.min(...p.map(p=>p.z)),Math.max(...p.map(p=>p.x)),Math.max(...p.map(p=>p.z))];
const overlap=(a:number[],b:number[])=>a[0]<b[2]-1e-7&&a[2]>b[0]+1e-7&&a[1]<b[3]-1e-7&&a[3]>b[1]+1e-7;
export function surfaceCutters(polys:readonly Point2[][]):Cutter[]{
 return polys.flatMap(poly=>{if(poly.length<3)return [];const contour=poly.map(([x,z])=>new T.Vector2(x,z));return T.ShapeUtils.triangulateShape(contour,[]).map(ix=>{const tri=ix.map(i=>toVertex(poly[i]));return {tri,bounds:bounds(tri)};});});
}
/** Convex subtraction retains outside fragments, never bridges across a cut-out. */
function subtract(poly:Vertex[],cutter:Cutter):Vertex[][]{
 if(!overlap(bounds(poly),cutter.bounds))return [poly];
 let inside=poly;const outside:Vertex[][]=[],sign=Math.sign(cross(...cutter.tri as [Vertex,Vertex,Vertex]))||1;
 for(let i=0;i<3&&inside.length;i++){const a=cutter.tri[i],b=cutter.tri[(i+1)%3],part=clip(inside,a,b,sign,false);if(part.length>=3)outside.push(part);inside=clip(inside,a,b,sign);}
 return outside;
}
export interface ProjectOptions{offset?:number;exclude?:readonly Point2[][];cutters?:Cutter[];accept?:(x:number,z:number)=>boolean;cellFilter?:(i:number,j:number)=>boolean}
/** Clip each source triangle at every DEM grid edge AND diagonal. Every emitted triangle is on
 * exactly one supporting terrain plane; this is a visual overlay, never another collider. */
export function projectRoadGeometry(source:T.BufferGeometry,terrain:Terrain,options:ProjectOptions={}):T.BufferGeometry{
 const positions:number[]=[],uvs:number[]=[],src=source.attributes.position,uv=source.attributes.uv,index=source.index;
 const {origin,cell,cols,rows}=terrain.meta,offset=Math.min(.02,Math.max(0,options.offset??.012)),cutters=options.cutters??surfaceCutters(options.exclude??[]);
 const count=index?.count??src.count;
 for(let k=0;k<count;k+=3){
  const base=[0,1,2].map(j=>{const n=index?index.getX(k+j):k+j;return {x:src.getX(n),z:src.getZ(n),u:uv?.getX(n)??0,v:uv?.getY(n)??0};});
  if(Math.abs(cross(...base as [Vertex,Vertex,Vertex]))<1e-9)continue;
  const box=bounds(base),relevant=cutters.filter(c=>overlap(box,c.bounds)),i0=Math.max(0,Math.floor((box[0]-origin[0])/cell)),i1=Math.min(cols-2,Math.floor((box[2]-origin[0])/cell)),j0=Math.max(0,Math.floor((box[1]-origin[1])/cell)),j1=Math.min(rows-2,Math.floor((box[3]-origin[1])/cell));
  for(let j=j0;j<=j1;j++)for(let i=i0;i<=i1;i++){
   if(terrain.cellCarved(i,j)||options.cellFilter&&!options.cellFilter(i,j))continue;
   const x=origin[0]+i*cell,z=origin[1]+j*cell,a=toVertex([x,z]),b=toVertex([x+cell,z]),c=toVertex([x,z+cell]),d=toVertex([x+cell,z+cell]);
   for(const tri of [[a,c,b],[b,c,d]]){
    const poly=intersect(base,tri);if(poly.length<3)continue;let pieces=[poly];const polyBox=bounds(poly);
    for(const cutter of relevant){if(overlap(polyBox,cutter.bounds))pieces=pieces.flatMap(p=>subtract(p,cutter));if(!pieces.length)break;}
    for(const p of pieces)for(let n=1;n<p.length-1;n++){
     let points=[p[0],p[n],p[n+1]];const area=cross(...points as [Vertex,Vertex,Vertex]);if(Math.abs(area)<1e-8)continue;
     const cx=points.reduce((s,p)=>s+p.x,0)/3,cz=points.reduce((s,p)=>s+p.z,0)/3;if(options.accept&&!options.accept(cx,cz))continue;
     if(area>0)points=[points[0],points[2],points[1]];
     for(const q of points){positions.push(q.x,terrain.heightAt(q.x,q.z)+offset,q.z);uvs.push(q.u,q.v);}
    }
   }
  }
 }
 const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(positions,3));g.setAttribute('uv',new T.Float32BufferAttribute(uvs,2));g.computeVertexNormals();g.computeBoundingBox();g.computeBoundingSphere();g.userData.surfaceVersion=terrain.surfaceVersion;return g;
}

/** Preserve outside re-entry as separate paths; filtering vertices would invent a shortcut. */
export function clippedRoadPaths(points:Point2[],box:[number,number,number,number]):Point2[][]{
 const out:Point2[][]=[];let run:Point2[]=[];
 const append=(a:Point2,b:Point2)=>{if(run.length&&Math.hypot(run.at(-1)![0]-a[0],run.at(-1)![1]-a[1])<1e-6)run.push(b);else{if(run.length>1)out.push(run);run=[a,b];}};
 for(let i=1;i<points.length;i++){
  const a=points[i-1],b=points[i],dx=b[0]-a[0],dz=b[1]-a[1];let lo=0,hi=1;
  for(const [p,q] of [[-dx,a[0]-box[0]],[dx,box[2]-a[0]],[-dz,a[1]-box[1]],[dz,box[3]-a[1]]]){if(Math.abs(p)<1e-12){if(q<0){hi=-1;break;}}else if(p<0)lo=Math.max(lo,q/p);else hi=Math.min(hi,q/p);}
  if(lo>hi){if(run.length>1)out.push(run);run=[];continue;}
  append([a[0]+lo*dx,a[1]+lo*dz],[a[0]+hi*dx,a[1]+hi*dz]);
 }
 if(run.length>1)out.push(run);return out;
}

/** Standard UV corridor; projection below is what determines its elevation. */
export function roadRibbon(points:Point2[],width:number):T.BufferGeometry{
 const pos:number[]=[],uv:number[]=[],index:number[]=[];let distance=0;
 for(let i=0;i<points.length;i++){
  const p=points[i],a=points[Math.max(0,i-1)],b=points[Math.min(points.length-1,i+1)];let dx=b[0]-a[0],dz=b[1]-a[1];const len=Math.hypot(dx,dz)||1;dx/=len;dz/=len;
  if(i)distance+=Math.hypot(p[0]-points[i-1][0],p[1]-points[i-1][1]);
  pos.push(p[0]-dz*width/2,0,p[1]+dx*width/2,p[0]+dz*width/2,0,p[1]-dx*width/2);uv.push(0,distance/6,1,distance/6);
  if(i){const k=i*2;index.push(k-2,k-1,k,k-1,k+1,k);}
 }
 const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(pos,3));g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));g.setIndex(index);return g;
}
export function geometryFootprints(g:T.BufferGeometry):Point2[][]{
 const p=g.attributes.position,ix=g.index,count=ix?.count??p.count,out:Point2[][]=[];
 for(let k=0;k<count;k+=3){const tri:[number,number][]=[];for(let j=0;j<3;j++){const n=ix?ix.getX(k+j):k+j;tri.push([p.getX(n),p.getZ(n)]);}out.push(tri);}return out;
}
export interface SurfaceRoad {id:string;kind:string;width:number;points:Point2[];tunnel?:boolean;bridge?:boolean}
export interface RoadLayer {id:string;foot:boolean;base:T.BufferGeometry;markings?:T.BufferGeometry}
export function buildRoadLayers(roads:readonly SurfaceRoad[],terrain:Terrain,box:[number,number,number,number],exclude:Point2[][]=[]):RoadLayer[]{
 const foot=(r:SurfaceRoad)=>['footway','path','steps','pedestrian','cycleway'].includes(r.kind);
 const paths=roads.filter(r=>!r.tunnel).sort((a,b)=>Number(foot(a))-Number(foot(b))||b.width-a.width).flatMap(r=>clippedRoadPaths(r.points,box).map(points=>{const source=roadRibbon(points,r.width);return {r,source,polys:geometryFootprints(source)};}));
 const layers:RoadLayer[]=[],solid=surfaceCutters(exclude),used:Cutter[]=[];
 const all=paths.map(p=>surfaceCutters(p.polys));
 for(let k=0;k<paths.length;k++){
  const {r,source}=paths[k],base=projectRoadGeometry(source,terrain,{offset:.006,cutters:[...solid,...used]});
  // The road union is a single surface. At crossings, every incoming edge/centre marking stops.
  const markings=foot(r)?undefined:projectRoadGeometry(source,terrain,{offset:.012,cutters:[...solid,...all.flatMap((c,i)=>paths[i].r.id===r.id?[]:c)]});
  if(base.attributes.position.count)layers.push({id:r.id,foot:foot(r),base,markings});else {base.dispose();markings?.dispose();}
  used.push(...all[k]);source.dispose();
 }
 return layers;
}

export interface CrossingStripe {roadId:string;polygon:Point2[]}
export function crosswalkStripes(roads:readonly SurfaceRoad[]):CrossingStripe[]{
 const usable=roads.filter(r=>!r.tunnel&&r.points.length>1),foot=(r:SurfaceRoad)=>['footway','path','steps','pedestrian','cycleway'].includes(r.kind),centres:Point2[]=[],out:CrossingStripe[]=[];
 for(const f of usable.filter(foot))for(const r of usable.filter(r=>!foot(r)))for(let i=1;i<f.points.length;i++)for(let j=1;j<r.points.length;j++){
  const a=f.points[i-1],b=f.points[i],c=r.points[j-1],d=r.points[j],den=(b[0]-a[0])*(d[1]-c[1])-(b[1]-a[1])*(d[0]-c[0]);if(Math.abs(den)<1e-9)continue;
  const t=((c[0]-a[0])*(d[1]-c[1])-(c[1]-a[1])*(d[0]-c[0]))/den,u=((c[0]-a[0])*(b[1]-a[1])-(c[1]-a[1])*(b[0]-a[0]))/den;if(t<0||t>1||u<0||u>1)continue;
  const x=a[0]+(b[0]-a[0])*t,z=a[1]+(b[1]-a[1])*t;if(centres.some(p=>Math.hypot(p[0]-x,p[1]-z)<6))continue;centres.push([x,z]);
  const len=Math.hypot(d[0]-c[0],d[1]-c[1]),ux=(d[0]-c[0])/len,uz=(d[1]-c[1])/len;
  for(let k=-2;k<=2;k++){const cx=x+ux*k*.9,cz=z+uz*k*.9;out.push({roadId:r.id,polygon:[[-.225,-r.width*.45],[.225,-r.width*.45],[.225,r.width*.45],[-.225,r.width*.45]].map(([along,across])=>[cx+along*ux-across*uz,cz+along*uz+across*ux])});}
 }
 return out;
}
/** Stripe footprint is clipped to its same-level carriageway before projecting onto terrain. */
export function buildCrosswalkGeometry(roads:readonly SurfaceRoad[],terrain:Terrain,box:[number,number,number,number],exclude:Point2[][]=[]){
 const footprints=new Map<string,Point2[][]>();for(const r of roads){const polygons:Point2[][]=[];for(const points of clippedRoadPaths(r.points,box)){const g=roadRibbon(points,r.width);polygons.push(...geometryFootprints(g));g.dispose();}footprints.set(r.id,polygons);}
 const positions:number[]=[],uv:number[]=[];
 for(const stripe of crosswalkStripes(roads))for(const tri of footprints.get(stripe.roadId)??[]){const clipped=intersect(stripe.polygon.map(toVertex),tri.map(toVertex));if(clipped.length<3)continue;for(let k=1;k<clipped.length-1;k++)for(const p of [clipped[0],clipped[k],clipped[k+1]]){positions.push(p.x,0,p.z);uv.push(0,0);}}
 const source=new T.BufferGeometry();source.setAttribute('position',new T.Float32BufferAttribute(positions,3));source.setAttribute('uv',new T.Float32BufferAttribute(uv,2));const out=projectRoadGeometry(source,terrain,{offset:.018,exclude});source.dispose();return out;
}
