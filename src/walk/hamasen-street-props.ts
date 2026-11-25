import type { CampusStructure, ContextBuilding, ContextRoad, Point2 } from '../walk-types';
import { crosswalkStripes } from '../world/road-surface';

/**
 * Pure placement plan for 哈瑪星 street furniture. Everything is derived from the
 * district data at load time (roads, building footprints and frontages, shopfronts,
 * the temple plaza), so new or edited buildings simply reject the slots they cover.
 * No collision: every prop must therefore stay off walk lines, doors and junctions.
 */
export type StreetPropKind = 'scooter'|'car'|'pole'|'lamp'|'signal'|'tree'|'planter'|'parasol'|'box';
export interface StreetProp {
 kind:StreetPropKind;
 x:number;z:number;
 /** Rotation about +Y; the prop's local +X axis points along (cos yaw, -sin yaw). */
 yaw:number;
 /** Non-uniform scale (box kit) or uniform size jitter (other kits). */
 sx?:number;sy?:number;sz?:number;
 /** Height above the local ground of the prop's origin (box parts, carts). */
 lift?:number;
 color:number;
 /** Stable 0–1 value; lower tiers drop the instances with the highest ranks. */
 rank:number;
 /** Signals: the cross street's name for the green plate on the mast arm (named streets only). */
 label?:string;
}
export interface StreetWire {a:[number,number];b:[number,number]}
export interface StreetPropPlan {props:StreetProp[];wires:StreetWire[];stats:Record<string,number>;sights:SightZone[]}
export interface KeepClear {x:number;z:number;r:number}
/** A card subject (shop sign or landmark) and the spot it is usually looked at from (the card landing). */
export interface SightView {x:number;z:number;vx:number;vz:number;
 /** Landmarks: the street the main facade faces. Its near kerb in front of the building stays open too. */
 street?:string}
/** Tall kinds that hide a facade or sign: never inside a sightline zone. */
export const TALL_KINDS:ReadonlySet<StreetPropKind>=new Set(['pole','lamp','tree','parasol','signal']);
/** Centre of the painted edge line, as a share of the carriageway width from its edge (roadTexture: texels 5–8 of 128). */
export const EDGE_LINE_INSET=6.5/128;
/** Kerbside depth across the road for each parking angle (perpendicular, angled, parallel scooter). */
export const SCOOTER_DEPTH={wide:.92,mid:.95,lane:.42};
/** Sightline zone: a trapezoid from a facade (or a card subject) out to where people stand to look at it. */
export interface SightZone {x:number;z:number;dx:number;dz:number;w0:number;spread:number;reach:number;
 /** Card subject to landing (plus the camera arm): the only zone that also moves temple-plaza stalls. */
 card?:boolean}
export function inSightZone(zone:SightZone,x:number,z:number,r=0){
 const ax=x-zone.x,az=z-zone.z,along=ax*zone.dx+az*zone.dz;
 if(along<-r||along>zone.reach+r)return false;
 return Math.abs(-ax*zone.dz+az*zone.dx)<zone.w0+Math.max(0,along)*zone.spread+r;
}
export interface StreetPropInput {
 context:CampusStructure['context'];
 /** Resident spots, bus stop points, story anchors: nothing within r. */
 keep?:KeepClear[];
 /** Walker polylines (ambient residents) kept clear by 1.3 m plus the prop radius. */
 paths?:Point2[][];
 /** Distance to the outdoor walking graph; optional, only checked for final candidates. */
 pathDistance?:(x:number,z:number)=>number;
 /** Ground test (sea, piers): return false to reject. */
 solid?:(x:number,z:number)=>boolean;
 /** Footprints replaced by hand-built landmark models (larger clearance, entrance kept). */
 isLandmark?:(id:string)=>boolean;
 /** Tunnel east portal forecourt: kept clear (its canopy is built in hamasen-art). */
 portal?:{x:number;z:number;dirX:number;dirZ:number};
 /** Card subjects and their landings: the line of sight between them stays free of tall props. */
 views?:SightView[];
}

/** Footprint radius used for clearance tests, metres. */
export const PROP_RADIUS:Record<StreetPropKind,number>={scooter:.5,car:1.15,pole:.22,lamp:.2,signal:.25,tree:.35,planter:.35,parasol:.25,box:.5};
const VEHICLE=new Set(['tertiary','secondary','primary','residential','living_street','unclassified','service']);
const FOOT=new Set(['footway','steps','path','cycleway','pedestrian','track']);
const SCOOTER_COLORS=10,CAR_COLORS=6,TREE_COLORS=4,PARASOL_COLORS=5;

export function hash01(text:string){
 let h=2166136261;
 for(let i=0;i<text.length;i++)h=Math.imul(h^text.charCodeAt(i),16777619);
 h^=h>>>15;h=Math.imul(h,2246822507);h^=h>>>13;
 return (h>>>0)/4294967296;
}

function segDistance(x:number,z:number,ax:number,az:number,bx:number,bz:number){
 const dx=bx-ax,dz=bz-az,l=dx*dx+dz*dz;
 const t=l?Math.max(0,Math.min(1,((x-ax)*dx+(z-az)*dz)/l)):0;
 return Math.hypot(x-ax-dx*t,z-az-dz*t);
}
function inside(x:number,z:number,poly:readonly Point2[]){
 let c=false;
 for(let i=0,j=poly.length-1;i<poly.length;j=i++){
  const [xi,zi]=poly[i],[xj,zj]=poly[j];
  if((zi>z)!==(zj>z)&&x<(xj-xi)*(z-zi)/(zj-zi)+xi)c=!c;
 }
 return c;
}
function polylineDistance(x:number,z:number,points:readonly Point2[]){
 let best=Infinity;
 for(let i=1;i<points.length;i++)best=Math.min(best,segDistance(x,z,points[i-1][0],points[i-1][1],points[i][0],points[i][1]));
 return best;
}

/** Uniform grid of segments with a half-width (roads, rails, walker lines). */
class SegmentGrid {
 private cells=new Map<number,number[]>();
 private data:number[]=[];
 private tags:number[]=[];
 constructor(private cell=10,private reach=8){}
 private key(i:number,j:number){return (i+4096)*8192+(j+4096);}
 add(a:Point2,b:Point2,half:number,tag:number){
  const id=this.tags.length;this.data.push(a[0],a[1],b[0],b[1],half);this.tags.push(tag);
  const pad=half+this.reach,c=this.cell;
  for(let i=Math.floor((Math.min(a[0],b[0])-pad)/c);i<=Math.floor((Math.max(a[0],b[0])+pad)/c);i++)
   for(let j=Math.floor((Math.min(a[1],b[1])-pad)/c);j<=Math.floor((Math.max(a[1],b[1])+pad)/c);j++){
    const k=this.key(i,j);let list=this.cells.get(k);if(!list){list=[];this.cells.set(k,list);}list.push(id);
   }
 }
 /** Smallest distance from (x,z) to a segment's ribbon edge (negative inside); ignores `skip` tags. */
 clearance(x:number,z:number,skip=-1,skip2=-1){
  const list=this.cells.get(this.key(Math.floor(x/this.cell),Math.floor(z/this.cell)));
  let best=Infinity;
  if(!list)return best;
  for(const id of list){
   const tag=this.tags[id];if(tag===skip||tag===skip2)continue;
   const o=id*5,d=segDistance(x,z,this.data[o],this.data[o+1],this.data[o+2],this.data[o+3])-this.data[o+4];
   if(d<best)best=d;
  }
  return best;
 }
}

/** Grid of building polygons: inside test plus distance to the nearest wall. */
class FootprintGrid {
 private cells=new Map<number,number[]>();
 constructor(private polygons:readonly Point2[][],private cell=12,private reach=6){
  polygons.forEach((poly,id)=>{
   let x0=Infinity,z0=Infinity,x1=-Infinity,z1=-Infinity;
   for(const [x,z] of poly){x0=Math.min(x0,x);z0=Math.min(z0,z);x1=Math.max(x1,x);z1=Math.max(z1,z);}
   for(let i=Math.floor((x0-reach)/cell);i<=Math.floor((x1+reach)/cell);i++)
    for(let j=Math.floor((z0-reach)/cell);j<=Math.floor((z1+reach)/cell);j++){
     const k=(i+4096)*8192+(j+4096);let list=this.cells.get(k);if(!list){list=[];this.cells.set(k,list);}list.push(id);
    }
  });
 }
 /** Distance to the nearest footprint (negative when inside one). */
 clearance(x:number,z:number,skip=-1){
  const list=this.cells.get((Math.floor(x/this.cell)+4096)*8192+(Math.floor(z/this.cell)+4096));
  let best=Infinity;
  if(!list)return best;
  for(const id of list){
   if(id===skip)continue;
   const poly=this.polygons[id];
   let d=Infinity;
   for(let i=0;i<poly.length;i++){const a=poly[i],b=poly[(i+1)%poly.length];d=Math.min(d,segDistance(x,z,a[0],a[1],b[0],b[1]));}
   if(inside(x,z,poly))return -d;
   best=Math.min(best,d);
  }
  return best;
 }
}

interface Edge {a:Point2;b:Point2;tx:number;tz:number;nx:number;nz:number;length:number}
/** Polygon edge with its outward normal (winding independent). */
function edgeOf(poly:readonly Point2[],index:number):Edge {
 const a=poly[index],b=poly[(index+1)%poly.length],dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz)||1;
 let area=0;for(let i=0;i<poly.length;i++){const p=poly[i],q=poly[(i+1)%poly.length];area+=p[0]*q[1]-p[1]*q[0];}
 const w=Math.sign(area)||1;
 return {a,b,tx:dx/length,tz:dz/length,nx:w*dz/length,nz:-w*dx/length,length};
}
const yawOf=(tx:number,tz:number)=>Math.atan2(-tz,tx);

/** Walk a polyline at a fixed spacing, offset sideways; yields point, tangent and outward normal. */
function* stations(points:readonly Point2[],spacing:number,offset:number,start=spacing/2){
 let carry=start,index=0;
 for(let i=1;i<points.length;i++){
  const a=points[i-1],b=points[i],dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz);
  if(length<1e-3)continue;
  const tx=dx/length,tz=dz/length,nx=-tz,nz=tx;
  for(let t=carry;t<length;t+=spacing){
   yield {x:a[0]+tx*t+nx*offset,z:a[1]+tz*t+nz*offset,tx,tz,nx,nz,index:index++,segment:i};
  }
  carry=((carry-length)%spacing+spacing)%spacing;
 }
}

export function planHamasenStreetProps(input:StreetPropInput):StreetPropPlan {
 const {context}=input;
 const district=context.hamasen?.polygon;
 const empty:StreetPropPlan={props:[],wires:[],stats:{},sights:[]};
 if(!district)return empty;
 const local=(x:number,z:number)=>inside(x,z,district);
 const buildings=context.background.filter(b=>b.district==='hamasen'&&b.polygon.length>=3);
 const landmarkish=(b:ContextBuilding)=>!!input.isLandmark?.(b.id)||['civic','temple','station','platform'].includes(b.facade??'');
 const footprints=new FootprintGrid(buildings.map(b=>b.polygon));
 const landmarkGrid=new FootprintGrid(buildings.filter(landmarkish).map(b=>b.polygon),12,8);
 const roads=context.roads.filter(r=>r.district==='hamasen'&&!r.tunnel&&!r.bridge&&r.points.length>=2);
 const roadIndex=new Map<ContextRoad,number>(roads.map((r,i)=>[r,i]));
 const sameName=new Map<string,number>();
 const tagOf=(r:ContextRoad)=>{if(!r.name)return roadIndex.get(r)!;let t=sameName.get(r.name);if(t===undefined){t=10000+sameName.size;sameName.set(r.name,t);}return t;};
 const carriage=new SegmentGrid(10,9),foot=new SegmentGrid(10,6),rails=new SegmentGrid(10,6),walkers=new SegmentGrid(10,6);
 for(const r of roads){
  const grid=FOOT.has(r.kind)?foot:VEHICLE.has(r.kind)?carriage:undefined;
  if(!grid)continue;
  for(let i=1;i<r.points.length;i++)grid.add(r.points[i-1],r.points[i],r.width/2,tagOf(r));
 }
 for(const rail of context.hamasen?.rails??[])for(let i=1;i<rail.points.length;i++)rails.add(rail.points[i-1],rail.points[i],0,0);
 for(const path of input.paths??[])for(let i=1;i<path.length;i++)walkers.add(path[i-1],path[i],0,0);
 // The zebra crossings exactly as road-surface draws them.
 const crossings=new SegmentGrid(10,6);
 for(const stripe of crosswalkStripes(roads)){
  const [p,q,r,t]=stripe.polygon;
  crossings.add([(p[0]+q[0])/2,(p[1]+q[1])/2],[(r[0]+t[0])/2,(r[1]+t[1])/2],.25,0);
 }

 // Doors and entrances: shopfront approaches, the door point on the facade, landmark frontages.
 const keep:KeepClear[]=[...(input.keep??[])];
 // Open a curbside gap directly in front of the ferry hall's through passage.
 if(buildings.some(b=>b.id==='hamasen-osm-205060865'))keep.push({x:375.07,z:736.55,r:1.25});
 for(const b of buildings){
  for(const shop of b.shopfronts??[]){
   keep.push({x:shop.approach[0],z:shop.approach[1],r:2.4});
   const e=edgeOf(b.polygon,shop.edge),along=Math.min(e.length,Math.max(0,shop.along));
   const dx=e.a[0]+e.tx*along,dz=e.a[1]+e.tz*along;
   for(const out of [.6,2.0,3.4])keep.push({x:dx+e.nx*out,z:dz+e.nz*out,r:Math.max(1.6,shop.width/2+.5)});
  }
  if(landmarkish(b)&&b.frontage){
   const e=edgeOf(b.polygon,b.frontage.edge);
   const mx=(e.a[0]+e.b[0])/2,mz=(e.a[1]+e.b[1])/2;
   for(const out of [1.5,4.5,7.5])keep.push({x:mx+e.nx*out,z:mz+e.nz*out,r:Math.max(3.2,e.length*.35)});
  }
 }
 const keepGrid=new Map<number,KeepClear[]>();
 for(const k of keep){
  for(let i=Math.floor((k.x-k.r)/16);i<=Math.floor((k.x+k.r)/16);i++)for(let j=Math.floor((k.z-k.r)/16);j<=Math.floor((k.z+k.r)/16);j++){
   const key=(i+4096)*8192+(j+4096);let list=keepGrid.get(key);if(!list){list=[];keepGrid.set(key,list);}list.push(k);
  }
 }
 const kept=(x:number,z:number,radius:number)=>{
  for(const k of keepGrid.get((Math.floor(x/16)+4096)*8192+(Math.floor(z/16)+4096))??[])if(Math.hypot(x-k.x,z-k.z)<k.r+radius)return true;
  return false;
 };
 // Sightlines: what stands in front of a shop sign, a landmark's main facade, or between a card subject and
 // its landing (plus the camera arm behind the player) would hide the very thing the street is known for.
 const sights:SightZone[]=[];
 for(const b of buildings){
  for(const shop of b.shopfronts??[]){
   const e=edgeOf(b.polygon,shop.edge),along=Math.min(e.length,Math.max(0,shop.along));
   sights.push({x:e.a[0]+e.tx*along,z:e.a[1]+e.tz*along,dx:e.nx,dz:e.nz,w0:shop.width/2+.4,spread:.5,reach:16});
  }
  if(landmarkish(b)&&b.frontage){
   const e=edgeOf(b.polygon,b.frontage.edge);
   sights.push({x:(e.a[0]+e.b[0])/2,z:(e.a[1]+e.b[1])/2,dx:e.nx,dz:e.nz,w0:e.length*.5,spread:.35,reach:20});
  }
 }
 for(const v of input.views??[]){
  const dx=v.vx-v.x,dz=v.vz-v.z,length=Math.hypot(dx,dz);
  if(length<.5)continue;
  sights.push({x:v.x,z:v.z,dx:dx/length,dz:dz/length,w0:2.4,spread:.06,reach:length+7,card:true});
  if(!v.street)continue;
  let near:{d:number;x:number;z:number;width:number}|undefined;
  for(const r of roads)if(r.name===v.street&&VEHICLE.has(r.kind))for(let i=1;i<r.points.length;i++){
   const [ax,az]=r.points[i-1],[bx,bz]=r.points[i],sx=bx-ax,sz=bz-az,l=sx*sx+sz*sz;
   const t=l?Math.max(0,Math.min(1,((v.x-ax)*sx+(v.z-az)*sz)/l)):0,px=ax+sx*t,pz=az+sz*t,d=Math.hypot(px-v.x,pz-v.z);
   if(!near||d<near.d)near={d,x:px,z:pz,width:r.width};
  }
  // People look at a landmark from across its street: both kerbs in front of it stay free of tall props.
  if(near&&near.d>1&&near.d<70)sights.push({x:v.x,z:v.z,dx:(near.x-v.x)/near.d,dz:(near.z-v.z)/near.d,w0:7,spread:.3,reach:near.d+near.width/2+1.6});
 }
 const blocksView=(x:number,z:number,radius:number,cardOnly=false)=>sights.some(zone=>(!cardOnly||zone.card)&&inSightZone(zone,x,z,radius));
 // Kerbside vehicles: tall props keep clear of them.
 const parked:{x:number;z:number;r:number}[]=[];
 const nearParked=(x:number,z:number,radius:number)=>parked.some(o=>Math.hypot(o.x-x,o.z-z)<o.r+radius);
 const portal=input.portal;
 const inPortal=(x:number,z:number)=>{
  if(!portal)return false;
  const dx=x-portal.x,dz=z-portal.z,along=dx*portal.dirX+dz*portal.dirZ,across=Math.abs(-dx*portal.dirZ+dz*portal.dirX);
  return along>-2&&along<17&&across<5.6;
 };

 interface Check {radius:number;road?:ContextRoad;parked?:boolean;kerb?:boolean;roadClear?:number;building?:number;buildingClear?:number;junction?:number;skipFoot?:boolean}
 /** Shared rejection for every prop: district, footprints, other roads, rails, doors, walkers. */
 const free=(x:number,z:number,c:Check)=>{
  if(!local(x,z)||inPortal(x,z))return false;
  if(input.solid&&!input.solid(x,z))return false;
  if(footprints.clearance(x,z,c.building??-1)<c.radius+(c.buildingClear??.3))return false;
  if(landmarkGrid.clearance(x,z)<c.radius+1.6)return false;
  const own=c.road?tagOf(c.road):-1;
  // Off every other carriageway by enough to clear its junction mouth.
  if(carriage.clearance(x,z,own)<c.radius+(c.junction??2.6))return false;
  // Only kerbside parking may stand on its own carriageway.
  if(!c.parked&&carriage.clearance(x,z)<(c.kerb?.06:c.radius+(c.roadClear??.15)))return false;
  if(crossings.clearance(x,z)<c.radius+1.1)return false;
  if(!c.skipFoot&&foot.clearance(x,z)<c.radius+.7)return false;
  if(rails.clearance(x,z)<c.radius+2.2)return false;
  // Walkers pass kerbside trunks and poles at arm's length; anything bulkier keeps a wider berth.
  if(walkers.clearance(x,z)<c.radius+(c.kerb?.45:1.3))return false;
  if(kept(x,z,c.radius))return false;
  return true;
 };
 const walkClear=(x:number,z:number,radius:number)=>!input.pathDistance||input.pathDistance(x,z)>=radius+.75;

 const props:StreetProp[]=[],wires:StreetWire[]=[];
 const box=(x:number,z:number,yaw:number,sx:number,sy:number,sz:number,lift:number,color:number,rank:number)=>
  props.push({kind:'box',x,z,yaw,sx,sy,sz,lift,color,rank});
 const BOX={stainless:0,green:1,red:2,blue:3,wood:4,grey:5,pit:6,white:7,yellow:8} as const;

 const ferry=buildings.find(b=>/輪渡/.test(b.name??''));
 const ferryCentre=ferry?ferry.polygon.reduce((s,p)=>[s[0]+p[0]/ferry.polygon.length,s[1]+p[1]/ferry.polygon.length],[0,0]):undefined;
 const nearFerry=(x:number,z:number)=>!!ferryCentre&&Math.hypot(x-ferryCentre[0],z-ferryCentre[1])<46;

 const vehicular=roads.filter(r=>VEHICLE.has(r.kind)&&r.width>=4.5);

 // 1. Concrete utility poles along the old lanes and residential streets; wires join neighbours.
 //    None in front of a shop sign or a landmark facade (a pole there hides the name), so a run may break.
 for(const road of vehicular.filter(r=>r.kind!=='tertiary')){
  const side=hash01(road.id+':pole')<.5?-1:1;
  let previous:{x:number;z:number;index:number}|undefined;
  for(const s of stations(road.points,26,side*(road.width/2+.3),9+hash01(road.id)*8)){
   let spot:{x:number;z:number}|undefined;
   // Kerb strip first (the footway behind it stays open), then just inside the kerb.
   for(const offset of [.3,.55,-.3]){
    const x=s.x+s.nx*side*(offset-.3),z=s.z+s.nz*side*(offset-.3);
    if(blocksView(x,z,PROP_RADIUS.pole))continue;
    if(free(x,z,{radius:PROP_RADIUS.pole,road,parked:offset<0,buildingClear:.15,junction:1.4,kerb:true})&&walkClear(x,z,PROP_RADIUS.pole)){spot={x,z};break;}
   }
   if(!spot){previous=undefined;continue;}
   const yaw=yawOf(s.tx,s.tz)+Math.PI/2;
   props.push({kind:'pole',x:spot.x,z:spot.z,yaw,color:hash01(`${road.id}:${s.index}:tx`)<.34?1:0,rank:0});
   if(previous&&s.index-previous.index===1&&Math.hypot(spot.x-previous.x,spot.z-previous.z)<34)wires.push({a:[previous.x,previous.z],b:[spot.x,spot.z]});
   previous={...spot,index:s.index};
  }
 }

 // 2. Street lamps on arterials (22 m staggered) and main commercial/residential streets (26 m single-side).
 for(const road of vehicular){
  const main=road.kind==='tertiary';
  if(!main&&road.width<5.4)continue;
  const sides=main?[-1,1]:[hash01(`${road.id}:lamp-side`)<.5?-1:1];
  const step=main?22:26;
  for(const side of sides)for(const s of stations(road.points,step,side*(road.width/2+.3),side<0?6:17)){
   if(blocksView(s.x,s.z,PROP_RADIUS.lamp))continue;
   if(!free(s.x,s.z,{radius:PROP_RADIUS.lamp,road,buildingClear:.25,junction:1.2,kerb:true})||!walkClear(s.x,s.z,PROP_RADIUS.lamp))continue;
   props.push({kind:'lamp',x:s.x,z:s.z,yaw:yawOf(-s.nx*side,-s.nz*side),color:0,rank:main?0:hash01(`${road.id}:${s.index}:lr`)});
   if(main&&hash01(`${road.id}:${side}:${s.index}:tb`)<.35){
    const bx=s.x+s.tx*3.4+s.nx*side*.25,bz=s.z+s.tz*3.4+s.nz*side*.25;
    if(free(bx,bz,{radius:.65,road,buildingClear:.3,junction:1.5})&&walkClear(bx,bz,.65))box(bx,bz,yawOf(s.tx,s.tz),1.15,1.25,.6,0,BOX.green,hash01(`${s.index}tb`));
   }
  }
 }

 // 3. Street trees along the main roads where the frontage leaves a footway behind them.
 for(const road of vehicular.filter(r=>r.kind==='tertiary')){
  for(const side of [-1,1])for(const s of stations(road.points,8.5,side*(road.width/2+.45),4.2)){
   // Trunk in a kerbside pit; the crown needs air in front of the facade and must not cover a sign.
   if(footprints.clearance(s.x,s.z)<2.3||blocksView(s.x,s.z,2))continue;
   if(!free(s.x,s.z,{radius:PROP_RADIUS.tree,road,buildingClear:1.9,junction:2.2,kerb:true})||!walkClear(s.x,s.z,PROP_RADIUS.tree+.2))continue;
   const size=.85+hash01(`${road.id}:${s.index}:ts`)*.3;
   props.push({kind:'tree',x:s.x,z:s.z,yaw:hash01(`${road.id}:${side}:${s.index}:ty`)*Math.PI*2,sx:size,sy:size,sz:size,color:Math.floor(hash01(`${road.id}:${s.index}:tc`)*TREE_COLORS),rank:0});
   box(s.x,s.z,yawOf(s.tx,s.tz),.9,.07,.9,0,BOX.pit,1);
  }
 }
 const standing=props.filter(p=>p.kind==='pole'||p.kind==='lamp'||p.kind==='tree'||(p.kind==='box'&&(p.sy??1)>.5));

 // 4. Kerbside scooters, in blocks with gaps; perpendicular on wide roads, angled or parallel on lanes.
 //    The whole scooter stands outside the painted edge line, between it and the kerb or on the kerb strip.
 for(const road of vehicular){
  const wide=road.width>=7.5,lane=road.width<6;
  const along=wide?.78:lane?1.95:.95;
  const depth=wide?SCOOTER_DEPTH.wide:lane?SCOOTER_DEPTH.lane:SCOOTER_DEPTH.mid;
  // Centre: past the line's outer edge (line 3/128 of the width) by the scooter's half depth.
  const offset=road.width/2-road.width*EDGE_LINE_INSET+road.width*1.5/128+depth+.05;
  const turn=wide?Math.PI/2:lane?0:.95;
  const sides=lane?[hash01(road.id+':side')<.5?-1:1]:[-1,1];
  const base=road.kind==='tertiary'?.36:road.kind==='service'?.12:.26;
  for(const side of sides){
   for(const s of stations(road.points,along,side*offset)){
    const block=Math.floor(s.index*along/7.5);
    const ferryZone=nearFerry(s.x,s.z);
    if(!ferryZone&&hash01(`${road.id}:${side}:${block}`)>base)continue;
    if(hash01(`${road.id}:${side}:${s.index}:slot`)>(ferryZone?.96:.8))continue;
    if(standing.some(o=>Math.hypot(o.x-s.x,o.z-s.z)<PROP_RADIUS[o.kind]+.9))continue;
    if(!free(s.x,s.z,{radius:PROP_RADIUS.scooter,road,parked:true,buildingClear:depth+.1-PROP_RADIUS.scooter+.35}))continue;
    if(!walkClear(s.x,s.z,PROP_RADIUS.scooter))continue;
    const outward=side;
    const reverse=hash01(`${road.id}:${s.index}:dir`)<.7;
    const jitter=(hash01(`${road.id}:${s.index}:j`)-.5)*.16;
    const yaw=yawOf(s.tx,s.tz)+(turn?outward*turn*(reverse?-1:1):0)+jitter+(!turn&&reverse?Math.PI:0);
    props.push({kind:'scooter',x:s.x,z:s.z,yaw,color:Math.floor(hash01(`${road.id}:${s.index}:c`)*SCOOTER_COLORS),rank:ferryZone?hash01(`${road.id}:${s.index}:r`)*.6:hash01(`${road.id}:${s.index}:r`)});
    parked.push({x:s.x,z:s.z,r:.6});
   }
  }
 }
 // Cars park only in the marked stalls of the surveyed car park: the streets have no room for a car
 // between the edge line and the kerb, and a car inside the line stands in the traffic lane.

 // 5. Cars in the surveyed car park, in the stall rows its ground markings use (rows 7, 22 and 36 m
 // in from the first edge, 2.6 m stalls, 4.8 m deep). Re-check if the car-park layout changes.
 for(const [n,lot] of (context.hamasen?.ground??[]).filter(g=>g.kind==='parking').entries()){
  const [a,b]=lot.polygon,len=Math.hypot(b[0]-a[0],b[1]-a[1]);
  if(len<8)continue;
  const ux=(b[0]-a[0])/len,uz=(b[1]-a[1])/len;
  for(const row of [7,22,36]){
   const start=row===36?8:3,end=row===36?33:len-5;
   for(let along=start;along+2.6<=end;along+=2.6){
    const key=`lot${n}:${row}:${along.toFixed(1)}`;
    if(hash01(key)>.5)continue;
    const x=a[0]+ux*(along+1.3)-uz*(row+2.4),z=a[1]+uz*(along+1.3)+ux*(row+2.4);
    if(!inside(x,z,lot.polygon)||!free(x,z,{radius:.9,buildingClear:.4,junction:.8})||!walkClear(x,z,1))continue;
    props.push({kind:'car',x,z,yaw:yawOf(-uz,ux)+(hash01(key+'d')<.5?Math.PI:0),color:Math.floor(hash01(key+'c')*CAR_COLORS),rank:hash01(key+'r')});
   }
  }
 }
 // 6. Potted plants at party walls just outside the arcade piers of homes and shophouses, never on
 // the kerbside footway strip.
 for(const [id,b] of buildings.entries()){
  if(landmarkish(b)||!b.frontage)continue;
  const e=edgeOf(b.polygon,b.frontage.edge);
  if(e.length<2.4)continue;
  for(const end of [0,1]){
   if(hash01(`${b.id}:${end}:pot`)>.42)continue;
   const t=end?e.length-.4:.4,out=.62;
   const x=e.a[0]+e.tx*t+e.nx*out,z=e.a[1]+e.tz*t+e.nz*out;
   if(nearParked(x,z,PROP_RADIUS.planter)||!free(x,z,{radius:PROP_RADIUS.planter,building:id,buildingClear:.15,junction:1.2,roadClear:1.5})||!walkClear(x,z,PROP_RADIUS.planter))continue;
   const size=.8+hash01(`${b.id}:${end}:ps`)*.45;
   props.push({kind:'planter',x,z,yaw:hash01(`${b.id}:${end}:py`)*6.28,sx:size,sy:size,sz:size,color:Math.floor(hash01(`${b.id}:${end}:pc`)*TREE_COLORS),rank:hash01(`${b.id}:${end}:pr`)});
  }
 }

 // 7. Temple forecourt: food carts with parasols and a few tables around the plaza edge.
 const temple=buildings.find(b=>b.facade==='temple');
 const templeId=temple?buildings.indexOf(temple):-1;
 if(temple){
  const centre=temple.polygon.reduce((s,p)=>[s[0]+p[0]/temple.polygon.length,s[1]+p[1]/temple.polygon.length],[0,0]);
  const ring=roads.find(r=>r.kind==='pedestrian'&&/廟埕/.test(r.name??''))?.points
   ??context.hamasen?.ground?.filter(g=>g.kind==='paving').map(g=>g.polygon).sort((p,q)=>polylineDistance(centre[0],centre[1],p)-polylineDistance(centre[0],centre[1],q))[0];
  const front=temple.frontage?edgeOf(temple.polygon,temple.frontage.edge):undefined;
  if(ring&&ring.length>=3){
   const plaza=ring[0][0]===ring.at(-1)![0]&&ring[0][1]===ring.at(-1)![1]?ring.slice(0,-1):ring;
   const pc=plaza.reduce((s,p)=>[s[0]+p[0]/plaza.length,s[1]+p[1]/plaza.length],[0,0]);
   let stall=0;
   for(let i=0;i<plaza.length;i++){
    const e=edgeOf(plaza,i);
    // Carts stand 3 m inside the plaza edge, behind the paved walking ring.
    for(let t=2.4;t<e.length-2.4;t+=4.2){
     const x=e.a[0]+e.tx*t-e.nx*3.0,z=e.a[1]+e.tz*t-e.nz*3.0;
     if(!inside(x,z,plaza))continue;
     if(front){
      const fx=(front.a[0]+front.b[0])/2,fz=(front.a[1]+front.b[1])/2;
      const ax=x-fx,az=z-fz,depth=ax*front.nx+az*front.nz,lateral=Math.abs(ax*front.tx+az*front.tz);
      if(depth>-1&&depth<26&&lateral<front.length*.32+2.5)continue;
     }
     if(Math.hypot(x-pc[0],z-pc[1])<4.5||props.some(p=>p.kind==='parasol'&&Math.hypot(p.x-x,p.z-z)<3.2))continue;
     // The parasol canopy (1.3 m) stands .75 m off the cart: no stall between the temple card's landing and the temple.
     // (The plaza in front of the hall keeps its stalls; the front-of-hall gap above already frames the facade.)
     if(blocksView(x-e.nx*.75,z-e.nz*.75,1.3,true))continue;
     if(!free(x,z,{radius:1.1,building:templeId,buildingClear:.8,junction:.6,skipFoot:true})||!walkClear(x,z,.9))continue;
     const yaw=yawOf(e.tx,e.tz),key=`${i}:${t.toFixed(1)}`;
     box(x,z,yaw,1.45,.86,.78,0,hash01(key+'cart')<.6?BOX.stainless:BOX.red,hash01(key+'r'));
     box(x,z,yaw,1.5,.06,.84,.86,BOX.white,hash01(key+'r'));
     const px=x-e.nx*.75,pz=z-e.nz*.75;
     props.push({kind:'parasol',x:px,z:pz,yaw:0,color:stall%PARASOL_COLORS,rank:hash01(key+'r')});
     if(stall%2===0){
      const tx=x-e.nx*2.1+e.tx*.9,tz=z-e.nz*2.1+e.tz*.9;
      if(free(tx,tz,{radius:.9,building:templeId,buildingClear:.6,junction:.6,skipFoot:true})&&walkClear(tx,tz,.7)){
       box(tx,tz,yaw,.8,.05,.8,.72,BOX.white,hash01(key+'t'));
       box(tx,tz,yaw,.12,.72,.12,0,BOX.grey,hash01(key+'t'));
       for(const [u,v] of [[.62,0],[-.62,0],[0,.62]])box(tx+e.tx*u-e.nx*v,tz+e.tz*u-e.nz*v,yaw,.3,.43,.3,0,(stall+u>0?1:0)%2?BOX.blue:BOX.red,hash01(key+'t'));
      }
     }
     stall++;
    }
   }
  }
 }

 // 8. Mast-arm signals and street-name plates at main-road junctions with named streets.
 const mains=vehicular.filter(r=>r.kind==='tertiary');
 const junctions:{x:number;z:number;main:ContextRoad;cross:ContextRoad;tx:number;tz:number}[]=[];
 for(const main of mains)for(const cross of vehicular){
  if(cross===main||!cross.name||cross.name===main.name||cross.kind==='service')continue;
  for(let i=1;i<main.points.length;i++)for(let j=1;j<cross.points.length;j++){
   const p=intersect(main.points[i-1],main.points[i],cross.points[j-1],cross.points[j]);
   if(!p||!local(p[0],p[1])||junctions.some(q=>Math.hypot(q.x-p[0],q.z-p[1])<18))continue;
   const dx=main.points[i][0]-main.points[i-1][0],dz=main.points[i][1]-main.points[i-1][1],l=Math.hypot(dx,dz)||1;
   junctions.push({x:p[0],z:p[1],main,cross,tx:dx/l,tz:dz/l});
  }
 }
 for(const j of junctions){
  const crossHalf=j.cross.width/2,mainHalf=j.main.width/2;
  let placed=0;
  for(const [u,v] of [[1,1],[-1,-1],[1,-1],[-1,1]]){
   if(placed>=2)break;
   const along=u*(crossHalf+2.4),side=v*(mainHalf+.9);
   const x=j.x+j.tx*along-j.tz*side,z=j.z+j.tz*along+j.tx*side;
   if(blocksView(x,z,PROP_RADIUS.signal)||!free(x,z,{radius:PROP_RADIUS.signal,road:j.main,buildingClear:.2,junction:1.0})||!walkClear(x,z,PROP_RADIUS.signal))continue;
   if(props.some(p=>p.kind==='signal'&&Math.hypot(p.x-x,p.z-z)<6))continue;
   // The arm points across the main road, towards its centreline.
   props.push({kind:'signal',x,z,yaw:yawOf(j.tz*v,-j.tx*v),color:0,rank:0,label:j.cross.name!});
   placed++;
  }
 }

 const stats:Record<string,number>={wires:wires.length,junctions:junctions.length};
 for(const p of props)stats[p.kind]=(stats[p.kind]??0)+1;
 return {props,wires,stats,sights};
}

function intersect(a:Point2,b:Point2,c:Point2,d:Point2):Point2|undefined {
 const rx=b[0]-a[0],rz=b[1]-a[1],sx=d[0]-c[0],sz=d[1]-c[1],den=rx*sz-rz*sx;
 if(Math.abs(den)<1e-9)return undefined;
 const t=((c[0]-a[0])*sz-(c[1]-a[1])*sx)/den,u=((c[0]-a[0])*rz-(c[1]-a[1])*rx)/den;
 const e=.02;
 if(t<-e||t>1+e||u<-e||u>1+e)return undefined;
 return [a[0]+rx*t,a[1]+rz*t];
}

type XYZ=readonly number[];
interface NpcSource {npcs?:{schedule?:Record<string,{at?:unknown;offset?:readonly number[]}|null|undefined>}[];ambient?:Record<string,readonly {route?:readonly Point2[]}[]|undefined>}
interface StopSource {sign:XYZ;boardingPoint:XYZ;alightingPoints:readonly XYZ[];berth:{position:XYZ}}
/** Resident posts, walker routes and bus stop points from the runtime data files. */
export function streetPropKeepClear(npcData?:NpcSource,stops?:readonly StopSource[]):{keep:KeepClear[];paths:Point2[][]} {
 const keep:KeepClear[]=[],paths:Point2[][]=[];
 for(const npc of npcData?.npcs??[])for(const slot of Object.values(npc.schedule??{})){
  const at=slot?.at;
  if(Array.isArray(at)&&at.length===2&&at.every(Number.isFinite))keep.push({x:at[0]+(slot?.offset?.[0]??0),z:at[1]+(slot?.offset?.[1]??0),r:2.3});
 }
 for(const group of Object.values(npcData?.ambient??{}))for(const walker of group??[])if(walker.route&&walker.route.length>1)paths.push([...walker.route]);
 for(const stop of stops??[]){
  for(const p of [stop.sign,stop.boardingPoint,...stop.alightingPoints])keep.push({x:p[0],z:p[2],r:3});
  keep.push({x:stop.berth.position[0],z:stop.berth.position[2],r:7.5});
 }
 return {keep,paths};
}
