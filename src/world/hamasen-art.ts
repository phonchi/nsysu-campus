/** Hamasen street models use source footprints, with details batched by street block. */
import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { ContextBuilding, ContextRoad, ContextShopfront, HamasenContext, Point2 } from '../walk-types';
import { clippedRoadPaths, geometryFootprints, projectRoadGeometry, roadRibbon, surfaceCutters } from './road-surface';
import { inPolygon, type Terrain } from './terrain';
import { NIGHT_MATERIALS, nightGlow } from '../walk-materials';
import type { TunnelProfile } from './tunnel-surface';
import { isHamasenModelFootprint } from './landmarks';
import { fasciaSign, fitSign, genericSigns, paintSign, paintStreetfront, streetfrontPlanner,
  type SignBoard, type StreetfrontStyle } from './hamasen-storefront';

const tones: Record<string, string> = {
  concrete:'#a7a7a0', stucco:'#bbb8ac', porcelain:'#d2d4cd', tile:'#b5b6ad', sand:'#c3bba7',
  gray:'#9a9f9c', 'gray-green':'#a1ada4', 'gray-blue':'#98a6ac', brick:'#9e624d',
  station:'#c6c9c4', industrial:'#8e9897', white:'#deded5', cream:'#d0c5ad',
};
const frame = '#414c4e', glazing = '#657e83', trim = '#bec5be', shutter = '#88918b';
const box = new T.BoxGeometry(1, 1, 1);
const plate = new T.PlaneGeometry(1,1);
const flatHeight = .4;
const portalWalls:Record<string,number[]> = {
  'hamasen-ov-589f6461-7d23-4ce5-981e-3fad38842d34':[0,3,4],
  'hamasen-ov-9da3e46e-03e2-41a0-b4a5-c1978cdb862e':[1,2],
};
// Small roof patches visible in the NLSC PHOTO2025 tiles over the middle and east blocks.
// Plan dimensions are approximate. The roof terrace and navigability stay as generated.
const roofSheds:Record<string,{x:number;z:number;width:number;depth:number;height:number}> = {
  'hamasen-ov-cb604dbb-1da6-4797-bb1e-89d6e3759201':{x:465.57,z:357.53,width:4.4,depth:2.1,height:.81},
  'hamasen-ov-f67fe280-fa04-4da8-b342-9a250262539f':{x:461.06,z:371.49,width:4.8,depth:1.8,height:.87},
  'hamasen-ov-d0a43566-15c1-405d-a251-89938bbbb9d5':{x:610.44,z:432.26,width:4.5,depth:3.3,height:1.14},
  'hamasen-ov-3faf149f-4db1-4e20-9af7-0442e730073f':{x:631.66,z:408.54,width:4.1,depth:3.5,height:1.24},
};
const shoushanCorners = {
  north:'osm-313913296',
  south:'osm-1388408935',
  balconies:'osm-1151925118',
};
const toV2 = ([x,z]: Point2) => new T.Vector2(x,z);
const paint = (tone?:string, fallback='#bcb8aa') => new T.Color(tone && /^#[a-f\d]{6}$/i.test(tone) ? tone : tone && tones[tone] || fallback);

interface Volume { baseY:number; topY:number; arcadeDepth:number }
interface Edge { a:Point2; tangent:Point2; normal:Point2; length:number; yaw:number; index:number }
interface DetailLevels { base:T.BufferGeometry[]; details:T.BufferGeometry[]; light:T.BufferGeometry[]; signs:T.BufferGeometry[]; distant:T.BufferGeometry[] }

type ShopStyle = 'glass' | 'counter' | 'cart' | 'diner' | 'wood' | 'curtain' | 'ice' | 'heritage';
interface ShopTheme {
  sign:string; ink:string; trim:string; counter:string; style:ShopStyle;
  form:'board'|'blade'|'banner'|'curtain'|'placard'|'cart';
  awning?:string; text?:string; secondary?:string;
}
const shopThemes:Record<string,ShopTheme> = {
  'matou-auntie-danbing':{sign:'#e7dec9',ink:'#9b302a',trim:'#b8b1a6',counter:'#a9b3ae',style:'cart',form:'placard',awning:'#b53a34',text:'阿姨蛋餅'},
  'lin-mama-danbing':{sign:'#e7d9af',ink:'#504433',trim:'#bdbab1',counter:'#9da7a2',style:'counter',form:'placard'},
  'my-warm-day':{sign:'#294938',ink:'#faf3dd',trim:'#28483b',counter:'#b4885e',style:'glass',form:'blade',awning:'#294938'},
  'dandan-burger':{sign:'#f3cd41',ink:'#a42f34',trim:'#3f545b',counter:'#b73e3a',style:'glass',form:'blade',awning:'#436a58'},
  'axue-eatery':{sign:'#e6bb4c',ink:'#9e3c2b',trim:'#7a9282',counter:'#aeb6ae',style:'diner',form:'blade',awning:'#438675'},
  'shunhe-pork-rib':{sign:'#a22821',ink:'#fff5dc',trim:'#aaa6a0',counter:'#aeb6af',style:'counter',form:'board',text:'順和排骨大王'},
  'loutijiao-pasta':{sign:'#d7b55f',ink:'#41372b',trim:'#594739',counter:'#826045',style:'heritage',form:'placard',awning:'#619391'},
  'maruhama-soft-serve':{sign:'#263857',ink:'#eee7d1',trim:'#ac7949',counter:'#9b6d43',style:'curtain',form:'curtain',text:'丸浜',secondary:'霜淇淋'},
  'yudian-tea':{sign:'#edeae1',ink:'#292d33',trim:'#aa8054',counter:'#a4774d',style:'wood',form:'blade'},
  'fifty-lan':{sign:'#efcf3d',ink:'#18366c',trim:'#ece9dd',counter:'#234580',style:'counter',form:'blade'},
  'macu-tea':{sign:'#b82e35',ink:'#fff2e6',trim:'#b82e35',counter:'#efe8dd',style:'counter',form:'blade'},
  'lin-mama-chicken-steak':{sign:'#bf734a',ink:'#4d2420',trim:'#afaaa0',counter:'#aeb6af',style:'cart',form:'cart'},
  'ferry-haizhibing':{sign:'#b0453d',ink:'#ffe7a1',trim:'#dbae49',counter:'#6a8a99',style:'ice',form:'banner',text:'渡船頭海之冰',secondary:'海之冰'},
  'yuanfu-yakiniku-rice':{sign:'#b43f37',ink:'#fff0d9',trim:'#b8a995',counter:'#a2a9a0',style:'diner',form:'board',awning:'#b95149',text:'元福',secondary:'香菇肉羹'},
};
const shopTheme=(shop:ContextShopfront)=>shopThemes[shop.id];
const streetColors = ['#d6d1c7','#c8c3ba','#ddd7cc','#cec5b7','#cfcabf','#d1c8bb','#bdb8af',
  '#9e5644','#b06854','#8c6854','#a8846d','#ccb486','#c2a49b','#9aa7b0','#a1aca3'];
const warmGrays=[0,1,2,3,4,5,6], earthTones=[7,8,9,10,11], accents=[12,13,14];
const metalRoofs=['#3a5a4a','#354f6b','#7c3f38','#7d8285'];
function streetColor(seed:number) {
  const rank=seed%100;
  const group=rank<57?warmGrays:rank<87?earthTones:accents;
  return group[Math.floor(seed/100)%group.length];
}
const windowTiles = ['sliding','grille','louver'] as const;
const streetfronts:StreetfrontStyle[]=['shutter','home','glass','stall','garage','clinic','grocery','vacant'];
const detailTiles = [...windowTiles,'rail','ac','side-vent',
  ...streetfronts.map(style=>`front:${style}`),
  ...streetColors.flatMap((_,i)=>(i<7||i>=12?['tile','stucco','metal']:['tile','brick','metal']).map(m=>`wall:${i}:${m}`))];
const keyForShop = (shop:ContextShopfront,suffix='board')=>`shop:${shop.id}:${suffix}`;
const keyForGeneric = (label:string,vertical=false)=>`generic:${vertical?'vertical:':''}${label}`;

function houseSeed(id:string) {
  let hash=2166136261;
  for(let i=0;i<id.length;i++)hash=Math.imul(hash^id.charCodeAt(i),16777619);
  return hash>>>0;
}

function batchGeometry(source:T.BufferGeometry, matrix:T.Matrix4, tint:T.Color, roof?:T.Color) {
  const geometry = source.index ? source.toNonIndexed() : source.clone();
  geometry.applyMatrix4(matrix);
  if (!geometry.hasAttribute('normal')) geometry.computeVertexNormals();
  const normal = geometry.getAttribute('normal'), position=geometry.getAttribute('position');
  const colors = new Float32Array(normal.count * 3);
  const uv = new Float32Array(normal.count * 2);
  for (let i=0;i<normal.count;i++) {
    const color = roof && normal.getY(i) > .8 ? roof : tint;
    colors.set([color.r,color.g,color.b],i*3);
    const axis = Math.abs(normal.getX(i))>Math.abs(normal.getZ(i)) ? position.getZ(i) : position.getX(i);
    uv.set(Math.abs(normal.getY(i))>.7 ? [position.getX(i),position.getZ(i)] : [axis,position.getY(i)],i*2);
  }
  for (const key of Object.keys(geometry.attributes)) if (!['position','normal'].includes(key)) geometry.deleteAttribute(key);
  geometry.setAttribute('color',new T.BufferAttribute(colors,3));
  geometry.setAttribute('uv',new T.BufferAttribute(uv,2));
  geometry.clearGroups();
  return geometry;
}

function geometryFromTriangles(triangles: readonly (readonly T.Vector3[])[]) {
  const positions:number[]=[];
  for (const triangle of triangles) {
    const [a,b,c]=triangle;
    const normal=b.clone().sub(a).cross(c.clone().sub(a));
    if (normal.lengthSq()<1e-10) continue;
    for (const p of normal.y < 0 ? [a,c,b] : [a,b,c]) positions.push(p.x,p.y,p.z);
  }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position',new T.Float32BufferAttribute(positions,3));
  geometry.computeVertexNormals();
  return geometry;
}

function beamGeometry(a:T.Vector3,b:T.Vector3,width:number,depth:number,tint:T.Color) {
  const axis=b.clone().sub(a),length=axis.length();
  if(length<.01)return;
  const rotation=new T.Quaternion().setFromUnitVectors(new T.Vector3(0,1,0),axis.divideScalar(length));
  const matrix=new T.Matrix4().compose(a.clone().lerp(b,.5),rotation,new T.Vector3(width,length,depth));
  return batchGeometry(box,matrix,tint);
}

function leanToRoof(x:number,y:number,z:number,width:number,depth:number,height:number,yaw:number,tint:T.Color) {
  const corners=[[-width/2,-depth/2],[width/2,-depth/2],[width/2,depth/2],[-width/2,depth/2]];
  const bottom=corners.map(([u,v])=>new T.Vector3(u,0,v)),top=corners.map(([u,v])=>
    new T.Vector3(u,height+(v>0?.19:-.19)*depth,v));
  const faces=[ [top[0],top[1],top[2]], [top[0],top[2],top[3]] ];
  for(let i=0;i<4;i++){
    const j=(i+1)%4;
    faces.push([bottom[i],top[i],bottom[j]],[bottom[j],top[i],top[j]]);
  }
  const source=geometryFromTriangles(faces).rotateY(yaw).translate(x,y,z);
  const geometry=batchGeometry(source,new T.Matrix4(),tint,tint.clone().lerp(new T.Color('#c1c4bc'),.18));
  source.dispose();
  return geometry;
}

function edgeOn(polygon:Point2[], index:number):Edge {
  const a=polygon[index], b=polygon[(index+1)%polygon.length];
  const dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz);
  const winding=Math.sign(polygon.reduce((sum, p, i) => {const q=polygon[(i+1)%polygon.length];return sum+p[0]*q[1]-p[1]*q[0];},0)) || 1;
  return {a,tangent:[dx/length,dz/length],normal:[winding*dz/length,-winding*dx/length],length,yaw:-Math.atan2(dz,dx),index};
}

function edgesOf(building:ContextBuilding) {
  return building.polygon.map((_,i)=>edgeOn(building.polygon,i)).filter(edge=>edge.length>.5);
}

/** Keep pitched roofs inside the source footprint, including its courtyards. */
function pitchedRoof(building:ContextBuilding, edge:Edge, topY:number, vault=false) {
  const points = [...building.polygon,...(building.holes ?? []).flat()];
  const triangles = T.ShapeUtils.triangulateShape(building.polygon.map(toV2),(building.holes??[]).map(h=>h.map(toV2)));
  const across = (p:Point2)=>p[0]*edge.normal[0]+p[1]*edge.normal[1];
  const along = (p:Point2)=>p[0]*edge.tangent[0]+p[1]*edge.tangent[1];
  const b = building.polygon.map(across), a=building.polygon.map(along);
  const crossMin=Math.min(...b), crossMax=Math.max(...b), crossSpan=crossMax-crossMin;
  const axialMin=Math.min(...a), axialMax=Math.max(...a);
  const rise = vault ? Math.min(.72,crossSpan*.09) : Math.min(2.3,Math.max(.60,crossSpan*.16));
  if (crossSpan < 1.0 || !triangles.length) return undefined;
  type Plane = (p:Point2)=>number;
  const plans:Plane[] = [p=>(across(p)-crossMin)/crossSpan*2,p=>(crossMax-across(p))/crossSpan*2];
  if (building.roofShape==='hip') plans.push(p=>(along(p)-axialMin)/crossSpan*2,p=>(axialMax-along(p))/crossSpan*2);
  if (building.roofShape==='shed') plans.splice(0,plans.length,p=>(across(p)-crossMin)/crossSpan);
  if(vault){
    const height=(at:number)=>Math.sin(Math.PI*at);
    plans.splice(0,plans.length,...Array.from({length:8},(_,i)=>{
      const start=i/8,end=(i+1)/8,y=height(start),slope=(height(end)-y)*8;
      return (p:Point2)=>y+slope*((across(p)-crossMin)/crossSpan-start);
    }));
  }
  const cut=(poly:Point2[], plane:Plane)=>poly.flatMap((p,i)=>{
    const q=poly[(i+1)%poly.length],a=plane(p),b=plane(q),result:Point2[]=[];
    if(a>=-1e-6)result.push(p);
    if((a< -1e-6)!==(b< -1e-6)){const t=a/(a-b);result.push([p[0]+(q[0]-p[0])*t,p[1]+(q[1]-p[1])*t]);}
    return result;
  });
  const pieces:T.Vector3[][]=[];
  const top=(p:Point2,v:number)=>new T.Vector3(p[0],topY+.035+rise*Math.max(0,v),p[1]);
  for(const tri of triangles.map(t=>t.map(i=>points[i]))) for(const plane of plans){
    let patch=tri;
    for(const other of plans)if(other!==plane)patch=cut(patch,p=>other(p)-plane(p));
    for(let i=1;i<patch.length-1;i++)pieces.push([patch[0],patch[i],patch[i+1]].map(p=>top(p,plane(p))));
  }
  // Open rail canopies have no filled gable end.
  if(vault)return geometryFromTriangles(pieces);
  // Vertical gable and shed ends connect the upper faces to the wall head.
  for(let i=0;i<building.polygon.length;i++){
    const p=building.polygon[i],q=building.polygon[(i+1)%building.polygon.length],pm=across(p),qm=across(q),ridge=(crossMin+crossMax)/2;
    const t=(ridge-pm)/(qm-pm);
    const run:Point2[]=(t>.001 && t<.999)?[p,[p[0]+(q[0]-p[0])*t,p[1]+(q[1]-p[1])*t],q]:[p,q];
    for(let j=1;j<run.length;j++){
      const a=run[j-1],b=run[j],hiA=top(a,Math.min(...plans.map(fn=>fn(a)))),hiB=top(b,Math.min(...plans.map(fn=>fn(b))));
      const loA=new T.Vector3(a[0],topY,a[1]),loB=new T.Vector3(b[0],topY,b[1]);
      if (Math.max(hiA.y,hiB.y)-topY>.05) pieces.push([loA,loB,hiA],[hiA,loB,hiB]);
    }
  }
  return geometryFromTriangles(pieces);
}

export interface HamasenExterior {
  building:ContextBuilding;
  group:T.Object3D;
}

function masonryGrain() {
  const size=32, channels=new Uint8Array(size*size*4);
  for(let i=0;i<size*size;i++){
    const shade=235+((Math.imul(i+1,0x27d4eb2d)^Math.imul(i+71,0x165667b1))>>>24)%21;
    channels.set([shade,shade,shade,255],i*4);
  }
  const texture=new T.DataTexture(channels,size,size,T.RGBAFormat);
  texture.name='Hamasen material grain';texture.wrapS=texture.wrapT=T.RepeatWrapping;
  texture.magFilter=T.LinearFilter;texture.minFilter=T.LinearMipmapLinearFilter;texture.generateMipmaps=true;texture.needsUpdate=true;
  return texture;
}

function paintStorefront(ctx:CanvasRenderingContext2D,theme:ShopTheme) {
  const rect=(x:number,y:number,w:number,h:number,color:string)=>{ctx.fillStyle=color;ctx.fillRect(x,y,w,h);};
  const {style,trim,counter}=theme;
  const heritage=style==='heritage';
  const glass=style==='glass'||style==='wood'||style==='diner'||heritage;
  const wood=style==='wood'||style==='curtain'||heritage;
  const wallColor=style==='ice'?'#dfd0b3':style==='cart'?'#aaa99e':wood?'#bf9c74':
    style==='diner'?'#ccc2ad':style==='glass'?'#e3d3ba':'#e8e2cf';
  rect(0,0,384,96,trim);
  rect(13,8,358,83,wood?'#8b6c56':'#a9aaa0');
  rect(18,10,348,78,wallColor);
  rect(18,10,348,13,'#f6e6c5');
  rect(18,75,348,13,'#8e8474');
  for(let x=28;x<370;x+=91)rect(x,12,44,3,'#fff3d1');
  if(wood){
    for(let x=23;x<368;x+=23)rect(x,22,1,64,'#624a3938');
  }
  if(style==='cart'){
    for(let y=27;y<86;y+=7)rect(18,y,348,1,'#5e695333');
  }
  if(style==='ice'){
    for(let i=0;i<73;i++){
      const x=(i*79)%347+20,y=(i*31)%47+26;
      rect(x,y,3+i%13,1,i%3===0?'#905147':'#5d7990');
    }
    for(const x of [53,159,270]){
      rect(x,63,69,4,'#96674a');rect(x+7,67,4,15,'#635d52');rect(x+60,67,4,15,'#635d52');
    }
  }else if(heritage){
    rect(24,19,94,68,'#6c503f');rect(125,19,126,68,'#805e46');rect(260,19,94,68,'#6c503f');
    for(const x of [31,132,267]){
      rect(x,25,x===132?112:80,37,'#b4a687');
      for(let y=28;y<61;y+=7)rect(x,y,x===132?112:80,1,'#74665555');
    }
  }else{
    const menuWidth=style==='cart'?78:style==='counter'?150:96;
    const colorInset=style==='counter'&&theme.sign==='#efcf3d';
    rect(32,27,menuWidth,27,colorInset?'#e1bc3b':wood?'#debf91':'#efdfba');
    if(colorInset)rect(32,27,menuWidth,7,'#284a84');
    for(let x=39;x<32+menuWidth-7;x+=22)for(let y=33;y<51;y+=5)
      rect(x,y,12+(x+y)%6,1,theme.ink);
    for(const y of [54,64,74]){
      rect(220,y,125,2,wood?'#694833':'#838981');
      for(let x=226;x<335;x+=16)rect(x,y-5,9,5,['#a88d60','#789087','#d2ab78','#a5ae93'][(x+y)%4]);
    }
  }
  if(style!=='ice'&&style!=='cart'&&!heritage){
    rect(74,69,221,15,counter);
    rect(71,67,227,4,'#e8e1ca');
  }
  if(glass){
    ctx.fillStyle='#d2e8e23f';ctx.fillRect(20,13,345,73);
    for(const x of (heritage?[17,117,251,361]:[17,117,188,260,361]))rect(x,11,5,78,wood?'#604831':'#506364');
    rect(18,13,348,3,'#c0ced0');rect(18,85,348,3,'#7a8883');
    rect(174,49,3,21,'#545953');rect(202,49,3,21,'#545953');
  }
  if(wood)for(let x=0;x<384;x+=10){rect(x,0,1,7,'#614b38');rect(x,89,1,7,'#614b38');}
}

function paintFacadeTile(ctx:CanvasRenderingContext2D,key:string) {
  const rect=(x:number,y:number,w:number,h:number,color:string)=>{
    ctx.fillStyle=color;ctx.fillRect(x,y,w,h);
  };
  if(key.startsWith('wall:')){
    const [,index,style]=key.split(':');
    const color=streetColors[Number(index)];
    rect(0,0,384,96,color);
    ctx.strokeStyle=style==='brick'?'#ead8c16a':'#69665d23';ctx.lineWidth=1;
    const height=style==='brick'?8:style==='tile'?11:17;
    if(style==='metal'){
      for(let x=0;x<384;x+=8){rect(x,0,2,96,'#f7fbef38');rect(x+3,0,1,96,'#514d452b');}
    }else if(style==='stucco'){
      for(let i=0;i<300;i++)rect(i*97%383,i*37%95,1,1,'#54514a39');
    }else{
      for(let y=0;y<96;y+=height){
        ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(384,y);
        for(let x=(y/height%2)*9;x<384;x+=19){ctx.moveTo(x,y);ctx.lineTo(x,y+height);}
        ctx.stroke();
      }
    }
    return;
  }
  if(key.startsWith('front:')){
    paintStreetfront(ctx,key.slice(6) as StreetfrontStyle);
    return;
  }
  if(key==='side-vent'){
    rect(0,0,384,96,'#bfc1b2');rect(10,9,364,78,'#606f69');
    for(let y=14;y<82;y+=8)rect(17,y,350,3,'#959e93');
    return;
  }
  if(key==='sliding'||key==='grille'||key==='louver'){
    rect(0,0,384,96,'#b6b4a3');
    rect(9,7,366,82,'#414b49');
    rect(21,13,342,68,key==='louver'?'#68726b':'#567477');
    rect(21,15,342,20,'#637f80');
    rect(193,38,170,43,'#445a5a');
    rect(184,12,12,71,'#a8a99b');
    if(key==='grille'){
      for(let x=38;x<360;x+=39)rect(x,8,5,80,'#929992');
      for(const y of [18,54,76])rect(20,y,344,3,'#a0a49b');
    }
    if(key==='louver')for(let y=19;y<80;y+=8)rect(21,y,342,3,'#414b46');
    return;
  }
  if(key==='rail'){
    rect(0,3,384,6,'#c6cbc4');
    rect(0,84,384,5,'#9ba69e');
    for(let x=3;x<384;x+=18)rect(x,7,4,79,'#bfc6bc');
    return;
  }
  if(key==='ac'){
    rect(0,0,384,96,'#d3d4c8');
    rect(14,6,258,84,'#a5aaa4');
    ctx.beginPath();ctx.ellipse(143,48,89,34,0,0,Math.PI*2);ctx.fillStyle='#676d69';ctx.fill();
    for(let y=19;y<80;y+=6)rect(62,y,163,2,'#abb0a6');
    rect(291,17,61,6,'#949e96');
    return;
  }
}

function facadeAtlas(boards:ReadonlyMap<string,SignBoard>, shopTiles:ReadonlyMap<string,ShopTheme>) {
  if(typeof document==='undefined')return;
  const keys=[...detailTiles,...boards.keys(),...shopTiles.keys()];
  const canvas=document.createElement('canvas'),mask=document.createElement('canvas'),cols=5,cellWidth=388,cellHeight=100;
  canvas.width=cols*cellWidth;
  canvas.height=Math.ceil(keys.length/cols)*cellHeight;
  mask.width=canvas.width;mask.height=canvas.height;
  const ctx=canvas.getContext('2d'),light=mask.getContext('2d');if(!ctx||!light)return;
  light.fillStyle='#000';light.fillRect(0,0,mask.width,mask.height);
  const uvs=new Map<string,[number,number,number,number]>();
  keys.forEach((key,i)=>{
    const x=(i%cols)*cellWidth+2,y=Math.floor(i/cols)*cellHeight+2;
    const board=boards.get(key),store=shopTiles.get(key);
    ctx.save();ctx.translate(x,y);
    if(board)paintSign(ctx,board);
    else if(store)paintStorefront(ctx,store);
    else paintFacadeTile(ctx,key);
    ctx.restore();
    if(store&&store.style!=='heritage'||key==='front:stall'||key==='front:clinic'||key==='front:grocery'){
      light.fillStyle=store?'#151515':'#080808';
      light.fillRect(x+24,y+18,336,66);
      light.fillStyle=store?'#4b4b4b':'#292929';
      for(const px of [39,130,221,312])light.fillRect(x+px,y+14,28,3);
    }
    uvs.set(key,[(x+.5)/canvas.width,1-(y+95.5)/canvas.height,(x+383.5)/canvas.width,1-(y+.5)/canvas.height]);
  });
  const map=new T.CanvasTexture(canvas);map.colorSpace=T.SRGBColorSpace;
  map.anisotropy=4;
  const emissive=new T.CanvasTexture(mask);
  emissive.name='Hamasen shop interior mask';
  const material=nightGlow(new T.MeshStandardMaterial({map,alphaTest:.45,roughness:.87,
    name:'Hamasen storefront and joinery atlas'}),emissive);
  return {material,uvs};
}

export function hamasenExteriors(exteriors:readonly HamasenExterior[], terrain?:Terrain, shortDetail=false):T.Group {
  const root=new T.Group();root.name='Hamasen exteriors';
  const procedural = exteriors.filter(({building}) => !isHamasenModelFootprint(building.id));
  if (!procedural.length) return root;
  const buckets=new Map<string,{x:number;z:number;levels:DetailLevels}>();
  const nearDetail = shortDetail ? 137 : 165;
  const chunk=168;
  const shell=new T.MeshStandardMaterial({name:'Hamasen masonry, metal and glazing',map:masonryGrain(),vertexColors:true,roughness:.87,side:T.DoubleSide});
  const warm=new T.MeshStandardMaterial({name:'Hamasen shop lights',vertexColors:true,emissive:'#e8bf84',emissiveIntensity:0,roughness:.8});
  NIGHT_MATERIALS.add(warm);
  const signName=(building:ContextBuilding)=>building.stationExit?undefined:building.signText??(building.facade==='platform'?building.name??undefined:undefined);
  const boards=new Map<string,SignBoard>(), shopTiles=new Map<string,ShopTheme>();
  for(const {building} of procedural){
    const label=signName(building);
    if(label)boards.set(label,{text:label,background:'#394746',ink:'#f3e8cd'});
    for(const shop of building.shopfronts??[]){
      const theme=shopTheme(shop);
      if(!theme)continue;
      const label=theme.text??shop.name;
      const board={text:label,background:theme.sign,ink:theme.ink};
      boards.set(keyForShop(shop),{...board,cloth:theme.form==='curtain',subtitle:shop.id==='yuanfu-yakiniku-rice'?theme.secondary:undefined});
      if(theme.form==='blade'||theme.form==='placard')boards.set(keyForShop(shop,'blade'),{...board,vertical:true});
      if(theme.form==='curtain')boards.set(keyForShop(shop,'blade'),{text:shop.name,background:'#eee9df',ink:'#303746'});
      if(theme.secondary&&shop.id!=='yuanfu-yakiniku-rice')boards.set(keyForShop(shop,'secondary'),{...board,text:theme.secondary});
      shopTiles.set(keyForShop(shop,'front'),theme);
    }
  }
  for(const [i,label] of genericSigns.entries())for(const vertical of [false,true]){
    boards.set(keyForGeneric(label,vertical),{text:label,vertical,background:['#655047','#456668','#733f33','#604e2e'][i%4],ink:'#f4e6c9'});
  }
  const atlas=facadeAtlas(boards,shopTiles);
  const signPanel=(key:string|undefined,maxWidth:number,maxHeight:number,x:number,y:number,z:number,yaw:number)=>{
    const tile=key&&atlas?.uvs.get(key);
    if(!tile||maxWidth<=.01||maxHeight<=.01)return;
    const board=key&&boards.get(key);
    const {width,height}=board?fitSign(board,maxWidth,maxHeight):{width:maxWidth,height:maxHeight};
    const shape=plate.clone().scale(width,height,1);
    const uv=shape.getAttribute('uv');
    for(let i=0;i<uv.count;i++)uv.setXY(i,T.MathUtils.lerp(tile[0],tile[2],uv.getX(i)),T.MathUtils.lerp(tile[1],tile[3],uv.getY(i)));
    const g=shape.toNonIndexed().rotateY(yaw).translate(x,y,z);
    shape.dispose();return g;
  };
  const transform=new T.Matrix4(), position=new T.Vector3(), quaternion=new T.Quaternion(), size=new T.Vector3(), axis=new T.Vector3(0,1,0);
  const tankShape=new T.CylinderGeometry(.5,.5,1,6);
  const planStreetfront=streetfrontPlanner();
  const addCuboid=(out:T.BufferGeometry[], x:number,y:number,z:number,w:number,h:number,d:number,yaw:number,tint:string|T.Color,shape:T.BufferGeometry=box)=>{
    if(w<=.01||h<=.01||d<=.01)return;
    position.set(x,y,z);quaternion.setFromAxisAngle(axis,yaw);size.set(w,h,d);
    transform.compose(position,quaternion,size);
    out.push(batchGeometry(shape,transform,typeof tint==='string'?new T.Color(tint):tint));
  };
  for(const {building,group} of procedural){
    const allEdges=edgesOf(building);
    if(!allEdges.length)continue;
    const frontage=building.id===shoushanCorners.balconies?2:building.frontage?.edge;
    const street=allEdges.find(e=>e.index===frontage)??allEdges.reduce((a,b)=>a.length>b.length?a:b);
    const centre=new T.Box2().setFromPoints(building.polygon.map(toV2)).getCenter(new T.Vector2());
    const i=Math.floor(centre.x/chunk),j=Math.floor(centre.y/chunk),key=`${i},${j}`;
    let bucket=buckets.get(key);
    if(!bucket){bucket={x:(i+.5)*chunk,z:(j+.5)*chunk,levels:{base:[],details:[],light:[],signs:[],distant:[]}};buckets.set(key,bucket);}
    const output=bucket.levels;
    const volume=group.userData.hamasenVolume as Volume|undefined;
    const inferredGround=terrain?.heightAt(centre.x,centre.y)??0;
    const bottom=volume?.baseY??inferredGround;
    const topY=volume?.topY??(bottom+(building.heightM??Math.max(4,building.storeys*3.6)));
    const seed=houseSeed(building.id);
    const named=building.shopfronts??[];
    const featured=named.find(s=>['ferry-haizhibing','loutijiao-pasta','dandan-burger'].includes(s.id));
    const specialWall=featured?.id==='ferry-haizhibing'?'#dec054':featured?.id==='loutijiao-pasta'?'#ebcb72':featured?.id==='dandan-burger'?'#54636f':undefined;
    const wall=paint(specialWall??building.tone), roof=paint(building.stationExit===1?'concrete':building.roofTone,metalRoofs[seed%metalRoofs.length]);
    const arcadeDepth=volume?.arcadeDepth??0;
    const use=building.facade??(building.stationExit?'station':'residential');
    const renderPlatform=use==='platform';
    const renderPitch=building.roofShape!==undefined&&building.roofShape!=='flat';
    const isOldStation=building.id.endsWith('-203342621');
    const isMarket=building.id.endsWith('-203577807');
    const isYongguang=building.id.endsWith('-310227406');
    const isCornerGlazing=building.id===shoushanCorners.north;
    const isCornerTiles=building.id===shoushanCorners.south;
    const isRowBalconies=building.id===shoushanCorners.balconies;
    const photoRow=use==='shophouse'&&centre.x>=366&&centre.x<=465
      &&Math.abs(centre.y-(242+(centre.x-319)*.606))<25;
    const portalEdges=portalWalls[building.id];
    const rowhouse=(use==='shophouse'||use==='residential'||use==='commercial')
      &&!(isMarket||isCornerTiles||isCornerGlazing||isRowBalconies||isYongguang);
    const detailgable=rowhouse||use==='warehouse'||use==='civic';
    if(rowhouse&&!specialWall&&!building.tone?.startsWith('#'))wall.set(streetColors[streetColor(seed)]);
    const around=(edge:Edge,along:number,outside:number):Point2=>[edge.a[0]+edge.tangent[0]*along+edge.normal[0]*outside,edge.a[1]+edge.tangent[1]*along+edge.normal[1]*outside];
    const at=(edge:Edge,along:number,outside:number,y:number)=>{const [x,z]=around(edge,along,outside);return new T.Vector3(x,y,z);};
    const addBeam=(out:T.BufferGeometry[],a:T.Vector3,b:T.Vector3,width:number,depth:number,tint:T.Color)=>{
      const beam=beamGeometry(a,b,width,depth,tint);
      if(beam)out.push(beam);
    };
    const panel=(out:T.BufferGeometry[],edge:Edge,along:number,level:number,w:number,h:number,d:number,offset:number,color:string|T.Color)=>{
      if(d>.11){
        const [x,z]=around(edge,along,offset);
        addCuboid(out,x,level,z,w,h,d,edge.yaw,color);
        return;
      }
      if(w<=.01||h<=.01)return;
      // Window panes, bay lines and shutter slats have no visible depth at this scale.
      const [x,z]=around(edge,along,offset+d/2);
      position.set(x,level,z);quaternion.setFromAxisAngle(axis,Math.atan2(edge.normal[0],edge.normal[1]));size.set(w,h,1);
      transform.compose(position,quaternion,size);
      out.push(batchGeometry(plate,transform,typeof color==='string'?new T.Color(color):color));
    };
    const graphic=(key:string,edge:Edge,along:number,y:number,w:number,h:number,offset:number,yaw=Math.atan2(edge.normal[0],edge.normal[1]),out=output.signs)=>{
      const [x,z]=around(edge,along,offset);
      const geometry=signPanel(key,w,h,x,y,z,yaw);
      if(geometry)out.push(geometry);
    };
    const filterShell=(geometry:T.BufferGeometry)=>{
      const pos=geometry.getAttribute('position'),normal=geometry.getAttribute('normal'),indices:number[]=[];
      const hidden=allEdges.filter(e=>building.sharedWalls?.[e.index]!==undefined);
      for(let i=0;i<pos.count;i+=3){
        const ys=[pos.getY(i),pos.getY(i+1),pos.getY(i+2)];
        if(normal.getY(i)<-.8&&Math.max(...ys)<bottom+.07)continue;
        if(Math.abs(normal.getY(i))<.1&&hidden.some(e=>
          [i,i+1,i+2].every(j=>Math.abs((pos.getX(j)-e.a[0])*e.normal[0]+(pos.getZ(j)-e.a[1])*e.normal[1])<.025)))continue;
        indices.push(i,i+1,i+2);
      }
      geometry.setIndex(indices);
      const visible=geometry.toNonIndexed();geometry.dispose();return visible;
    };
    group.updateWorldMatrix(true,true);
    group.traverse(o=>{
      if(!(o instanceof T.Mesh))return;
      if(renderPlatform){
        const material=o.userData.hamasenColumn?'#737f78':o.userData.hamasenPlatformDeck?'#b9b7ae':building.roofTone;
        output.base.push(batchGeometry(o.geometry,o.matrixWorld,paint(material)));
      }else output.base.push(filterShell(batchGeometry(o.geometry,o.matrixWorld,o.userData.hamasenColumn?wall.clone().lerp(new T.Color(trim),.4):wall,roof)));
    });
    for(const edge of allEdges){
      const shared=building.sharedWalls?.[edge.index];
      if(shared===undefined)continue;
      const covered=bottom+shared-.035,height=topY-covered;
      if(height>.06)panel(output.base,edge,edge.length/2,covered+height/2,edge.length,height,.015,-.007,wall);
    }
    if(building.stationExit)continue;
    if(renderPlatform){
      // Structure and collision retain the same apron and posts; the visible cover has an arched roof.
      const axisEdge=allEdges.reduce((a,b)=>a.length>b.length?a:b);
      const platformRoof=pitchedRoof({...building,roofShape:'gable'},axisEdge,topY,true);
      if(platformRoof){output.base.push(batchGeometry(platformRoof,new T.Matrix4(),roof));platformRoof.dispose();}
      for(const edge of allEdges.filter(e=>e.length>=axisEdge.length*.35)){
        panel(output.details,edge,edge.length/2,topY-.10,edge.length,.14,.17,0,'#69766e');
      }
      const sideEdges=allEdges.filter(e=>e.length>=axisEdge.length*.8);
      const west=sideEdges.find(edge=>edge.normal[0]<0)??axisEdge;
      const width=Math.max(...building.polygon.map(([x,z])=>-(x-west.a[0])*west.normal[0]-(z-west.a[1])*west.normal[1]));
      const steel=new T.Color('#67756a');
      const bays=Math.max(2,Math.round(west.length/7));
      for(let i=0;i<bays;i++){
        const along=(i+.5)*west.length/bays;
        const left=at(west,along,-.44,topY-.40),right=at(west,along,-width+.44,topY-.40);
        addBeam(output.details,left,right,.12,.115,steel);
        addBeam(output.details,at(west,along,-.44,topY-1.33),at(west,along,-1.47,topY-.40),.085,.085,steel);
        addBeam(output.details,at(west,along,-width+.44,topY-1.33),at(west,along,-width+1.47,topY-.40),.085,.085,steel);
      }
      for(const along of [west.length*.18,west.length*.40,west.length*.62]){
        panel(output.details,west,along,bottom+.62,1.65,.09,.44,-.98,'#8c6a50');
        panel(output.details,west,along,bottom+.90,1.65,.35,.09,-.78,'#81604a');
        for(const leg of [-.60,.60])panel(output.details,west,along+leg,bottom+.39,.08,.45,.08,-.98,'#554940');
      }
      const [sx,sz]=around(west,west.length*.26,-width*.51);
      const yaw=Math.atan2(-west.tangent[0],-west.tangent[1]);
      const stationPlate=signPanel(signName(building),1.48,.42,sx,topY-.78,sz,yaw);
      const reversePlate=signPanel(signName(building),1.48,.42,sx,topY-.78,sz,yaw+Math.PI);
      if(stationPlate&&reversePlate)output.signs.push(stationPlate,reversePlate);
      for(const side of [-.61,.61]){
        const dx=Math.cos(yaw)*side,dz=-Math.sin(yaw)*side;
        addBeam(output.details,new T.Vector3(sx+dx,topY-.60,sz+dz),new T.Vector3(sx+dx,topY-.30,sz+dz),.035,.035,steel);
      }
      continue;
    }
    if(renderPitch){
      const cap=pitchedRoof(building,street,topY);
      if(cap){output.base.push(batchGeometry(cap,new T.Matrix4(),roof));cap.dispose();}
    }else{
      for(const edge of (rowhouse?[]:allEdges)){
        const primary=edge===street;
        const parapet=rowhouse?.26+(seed%7)*.065:primary&&isCornerGlazing?.61:primary&&isCornerTiles?.48:primary&&isRowBalconies?.29:flatHeight;
        panel(output.base,edge,edge.length/2,topY+parapet/2,edge.length,parapet,rowhouse?.05:.13,-.025,wall);
        if(primary&&(photoRow||isRowBalconies)){
          panel(output.base,edge,edge.length/2,topY+parapet+.042,edge.length+.16,.092,.18,-.075,wall.clone().lerp(new T.Color('#b6b7ae'),.52));
          if(isCornerGlazing)for(const side of [.12,.88])
            panel(output.base,edge,edge.length*side,topY+parapet+.105,edge.length*.14,.15,.22,-.18,wall);
        }
      }
      const shed=roofSheds[building.id];
      if(shed){
        const angle=allEdges.reduce((a,b)=>a.length>b.length?a:b).yaw;
        const local=(u:number,v:number):Point2=>[shed.x+u*Math.cos(angle)+v*Math.sin(angle),shed.z-u*Math.sin(angle)+v*Math.cos(angle)];
        const w=shed.width/2,d=shed.depth/2;
        const footprint=[local(-w,-d),local(w,-d),local(w,d),local(-w,d)];
        if(footprint.every(p=>inPolygon(p,building.polygon)&&!building.holes?.some(h=>inPolygon(p,h)))){
          const material=paint(metalRoofs[seed%metalRoofs.length]);
          output.details.push(leanToRoof(shed.x,topY,shed.z,shed.width,shed.depth,shed.height,angle,material));
        }
      }
    }
    const [cx,cz]=around(street,street.length/2,.16);
    const curb=Math.max(bottom,terrain?.heightAt(cx,cz)??bottom);
    const floors=Math.max(1,Math.min(12,Math.round(building.storeys)));
    const groundFloor=Math.min(3.35,(topY-curb)*.8);
    const roofBand=Math.max(.14,Math.min(.35,groundFloor*.09));
    const storefront=use==='shophouse'||use==='commercial'||isMarket||isRowBalconies;
    const glass=glazing,metal=frame;
    // Carry the visual rhythm into every exposed edge, even when the source
    // has no road-facing classification. Shared party walls get bare upper caps.
    for(const edge of allEdges){
      const primary=edge===street;
      const corner=edge.index===building.frontage?.cornerEdge;
      const shops=named.filter(shop=>shop.edge===edge.index);
      const front=primary||corner||shops.length>0;
      const commercial=front&&(building.frontage?.commercial??(use==='commercial'||isRowBalconies));
      const depth=primary?arcadeDepth:0;
      const hidden=building.sharedWalls?.[edge.index]??0;
      const localFloor=(along:number,outside:number)=>terrain?.heightAt(...around(edge,along,outside))??bottom;
      const streetY=localFloor(edge.length/2,0);
      const ceiling=Math.min(topY-.08,depth?bottom+2.85:streetY+3.12);
      const floorStart=Math.max(ceiling,bottom+groundFloor*.89);
      const bayCount=Math.max(1,Math.round(edge.length/(front?5:7)));
      const bay=edge.length/bayCount;
      if (depth>0&&terrain&&(detailgable||named.length)){
        const corners=[[.08,.02],[edge.length-.08,.02],[edge.length-.08,-depth+.12],[.08,-depth+.12]]
          .map(([along,offset])=>at(edge,along,offset,localFloor(along,offset)+.025));
        const paving=geometryFromTriangles([[corners[0],corners[1],corners[2]],[corners[0],corners[2],corners[3]]]);
        output.base.push(batchGeometry(paving,new T.Matrix4(),new T.Color('#b9b5ad')));
        paving.dispose();
      }
      if(detailgable&&edge.length>1.15){
        for(let j=0;j<bayCount;j++){
          const along=(j+.5)*bay,variation=(seed+j*17+edge.index*3)%77;
          const color=streetColor(houseSeed(`${building.id}:${j}`));
          const material=front?(color>=7&&color<12?variation%3?'brick':'tile':variation%3?'tile':'stucco'):
            variation%3===0?'metal':color>=7&&color<12?'brick':'stucco';
          const base=Math.max(bottom+hidden,depth?ceiling:localFloor(along,0)+.03);
          const parapet=rowhouse&&front&&!renderPitch?.21+(variation%7)*.105:0;
          const top=topY+parapet;
          const w=bay-.036;
          if(hidden&&top-base<.11)continue;
          const upper=top-base;
          const tile=`wall:${color}:${material}`;
          if(upper>.15&&!specialWall){
            graphic(tile,edge,along,base+upper/2,w,upper,.026,undefined,output.distant);
          }
          if(parapet>0){
            panel(output.base,edge,along,topY+parapet/2,w,parapet,.095,-.025,specialWall??streetColors[color]);
          }
          const shopOverlap=shops.some(s=>Math.abs(along-s.along)<(w+s.width)/2);
          if(!hidden&&(!shopOverlap||shops.some(s=>s.id==='my-warm-day')&&shops.every(s=>Math.abs(along-s.along)>s.width*.58))){
            const streetHeight=ceiling-localFloor(along,-depth+.10)-.13;
            if(streetHeight>1.26){
              const {style,label}=front
                ?planStreetfront(commercial,houseSeed(`${building.id}:${edge.index}:${j}`),around(edge,along,0),edge.normal,bay)
                :{style:undefined,label:undefined};
              const usableW=w*(front?.86:.62);
              const key=style?`front:${style}`:'side-vent';
              const h=front?Math.min(streetHeight,2.61):Math.min(streetHeight*.46,1.25);
              graphic(key,edge,along+(!front?usableW*.14:0),ceiling-.21-h/2,usableW,h,-depth+.038,undefined,output.distant);
              if(label){
                const {signY,signOffset}=fasciaSign(ceiling,topY,0);
                if(variation%5===0&&w>3.4){
                  const yaw=Math.atan2(edge.normal[0],edge.normal[1])+Math.PI/2;
                  const offset=.99;
                  graphic(keyForGeneric(label,true),edge,along-w*.43,signY+.60,.64,1.18,offset,yaw);
                  graphic(keyForGeneric(label,true),edge,along-w*.43,signY+.60,.64,1.18,offset,yaw+Math.PI);
                }else graphic(keyForGeneric(label),edge,along,signY-.12,usableW*.91,.48,signOffset);
              }
            }
          }
          const levels=Math.max(0,Math.min(floors-1,Math.floor((topY-floorStart)/1.5)));
          for(let k=0;k<levels;k++){
            const step=(topY-floorStart)/levels;
            const sill=floorStart+k*step+.42+(variation%3)*.10;
            if(sill<base+.16)continue;
            const width=Math.min(front?3.1:1.23,w*(front?.62:.31))*(.9+variation%4*.06);
            const height=Math.min(front?1.48:.82,step*.54);
            const windowX=along+(variation%3-1)*w*.10;
            graphic(front?windowTiles[(variation+k)%3]:'side-vent',edge,windowX,sill+height/2,width,height,.033,undefined,output.distant);
            if(!front){
              panel(output.base,edge,along,sill-.17,w+.032,.08,.065,.014,'#a69f94');
              continue;
            }
            if(k===0&&variation%3!==0&&bay>3.5){
              const balcony=Math.min(w*.88,width+.55),projection=.38+(variation%3)*.09;
              panel(output.details,edge,windowX,sill-.09,balcony,.14,projection,projection*.48,'#b9b5aa');
              graphic('rail',edge,windowX,sill+.26,balcony,.62,projection-.005);
            }else panel(output.details,edge,windowX,sill-.07,width+.13,.08,.12,.05,'#c4c0b2');
            if((variation+k)%5===0&&w>3.5){
              const side=along+w*.36;
              graphic('ac',edge,side,sill+.14,.61,.39,.041);
            }
          }
        }
      }
      for(const shop of shops){
        const theme=shopTheme(shop);
        if(!theme)continue;
        const a=shop.along,w=shop.width,recess=-depth;
        const base=localFloor(a,recess+.15)+.035,h=Math.min(2.64,ceiling-base-.13);
        if(h<1.05)continue;
        const cart=theme.style==='cart',shelter=theme.awning?(cart?.87:.70):0;
        const {canopyY,signY:boardY,signOffset}=fasciaSign(ceiling,topY,shelter);
        const doorWidth=theme.style==='cart'?w*.82:w;
        const bayCount=theme.style==='ice'?3:1;
        for(let j=0;j<bayCount;j++){
          const bay=doorWidth/bayCount, centre=a-doorWidth*.5+bay*(j+.5);
          graphic(keyForShop(shop,'front'),edge,centre,base+h/2,bay-.07,h,recess+.052,undefined,output.distant);
          if(theme.style==='ice')panel(output.details,edge,centre-bay/2+.10,base+h*.51,.26,h,.17,recess+.13,theme.trim);
        }
        const hasCounter=cart||theme.style==='counter'||theme.style==='curtain'||theme.style==='diner';
        if(hasCounter){
          const counterH=cart?.90:1.04, width=w*(cart?.57:.55),along=a+(cart?.04:-.12)*w;
          panel(output.details,edge,along,base+counterH/2,width,counterH,.42,recess+.26,theme.counter);
          panel(output.details,edge,along,base+counterH,width+.12,.08,.48,recess+.28,'#e5e2d6');
          if(cart||theme.style==='diner'){
            panel(output.details,edge,along,base+counterH+.22,width*.86,.36,.19,recess+.21,'#aec4bc');
            panel(output.details,edge,along,base+counterH+.43,width*.9,.05,.23,recess+.22,theme.trim);
            if(cart&&shop.id==='matou-auntie-danbing'){
              const [x,z]=around(edge,along-width*.31,recess+.39);
              addCuboid(output.details,x,base+counterH+.16,z,.84,.10,.84,0,'#595452',tankShape);
            }
          }
        }
        if(theme.awning){
          panel(output.details,edge,a,canopyY,w,.14,shelter,shelter/2,theme.awning);
        }
        const sign=keyForShop(shop),side=keyForShop(shop,'blade');
        if(theme.form==='curtain'){
          graphic(sign,edge,a,base+h-.30,w*.97,.60,recess+.135,undefined,output.distant);
        }else if(theme.form==='cart'){
          graphic(sign,edge,a+w*.04,base+.53,w*.50,.41,recess+.479,undefined,output.distant);
        }else if(theme.form==='placard'){
          const width=Math.min(w*(cart?.57:.68),2.6),y=cart?base+1.61:boardY;
          graphic(sign,edge,a-w*(cart?.16:.10),y,width,.52,cart?recess+.48:signOffset,undefined,output.distant);
        }else{
          graphic(sign,edge,a,boardY,w*(theme.form==='banner'?.95:.86),theme.form==='banner'?.72:.59,signOffset,undefined,output.distant);
        }
        if(shop.id==='my-warm-day'){
          const remaining=a-w/2;
          if(remaining>2.25)for(const t of [.27,.73]){
            graphic(keyForShop(shop,'front'),edge,remaining*t,base+h/2,remaining*.42,h,recess+.057,undefined,output.distant);
          }
        }
        if(theme.form==='blade'||theme.form==='placard'||theme.form==='curtain'){
          const yaw=Math.atan2(edge.normal[0],edge.normal[1])+Math.PI/2;
          const blade=theme.form==='blade',curtain=theme.form==='curtain';
          const centre=a-w*.47,y=blade?boardY+.39:curtain?boardY+.20:base+1.50;
          const bladeWidth=curtain?.85:blade?.61:.44,bladeHeight=curtain?.39:blade?1.25:1.04;
          const offset=Math.max(shelter,.53)+bladeWidth/2+.035;
          graphic(side,edge,centre,y,bladeWidth,bladeHeight,offset,yaw);
          graphic(side,edge,centre,y,bladeWidth,bladeHeight,offset,yaw+Math.PI);
        }
        if(theme.secondary&&shop.id!=='yuanfu-yakiniku-rice'){
          const secondary=keyForShop(shop,'secondary');
          if(theme.style==='ice'&&allEdges.length>2){
            const sideEdge=allEdges.filter(e=>e!==edge&&e.length>3)
              .sort((a,b)=>a.normal[0]-b.normal[0])[0];
            if(sideEdge)graphic(secondary,sideEdge,sideEdge.length*.51,boardY+.49,Math.min(5.2,sideEdge.length*.76),.86,.085,undefined,output.distant);
          }else graphic(secondary,edge,a+w*.31,base+1.62,w*.28,.36,recess+.061);
        }
      }
    }
    if(rowhouse){
      if(!renderPitch&&!roofSheds[building.id]&&floors>1){
        const [x,z]=around(street,street.length*(.34+seed%3*.13),-Math.min(2.5,street.length*.39));
        const contained=(radius:number)=>[[-1,-1],[-1,1],[1,-1],[1,1]].every(([a,b])=>{
          const p:Point2=[x+a*radius,z+b*radius];
          return inPolygon(p,building.polygon)&&!building.holes?.some(h=>inPolygon(p,h));
        });
        if(seed%6<2&&contained(1.52)){
          const tint=paint(metalRoofs[Math.floor(seed/6)%metalRoofs.length]),rise=1.22+seed%5*.12;
          output.details.push(leanToRoof(x,topY,z,2.65,1.45,rise,street.yaw,tint));
        }else if(seed%6<4&&contained(.74)){
          const height=1.23+seed%3*.13;
          addCuboid(output.details,x,topY+height/2,z,.99,height,.99,0,'#a6b2b3',tankShape);
        }
      }
      continue;
    }
    if(isYongguang){
      // The photographs show a flat-fronted red brick portico with a grilled arch behind it.
      const stone=new T.Color('#b3aea1'),mortar=wall.clone().lerp(stone,.44);
      const doorCenter=street.length*.5;
      const arcadeWidth=street.length*.55;
      for(const edge of allEdges)if(edge.length>4){
        panel(output.base,edge,edge.length/2,curb+.21,edge.length+.08,.37,.17,.027,stone);
        panel(output.base,edge,edge.length/2,curb+groundFloor+.03,edge.length+.1,.22,.28,.10,stone);
        panel(output.base,edge,edge.length/2,topY-.22,edge.length+.13,.40,.36,.09,stone);
      }
      const arch=(along:number,low:number,w:number,h:number,raise:number,tone:string|T.Color)=>{
        const shape=new T.Shape();
        const radius=Math.min(w*.5,h*.32),spring=h-radius;
        shape.moveTo(-w/2,0);shape.lineTo(w/2,0);shape.lineTo(w/2,spring);
        for(let n=1;n<=12;n++){const t=n*Math.PI/12;shape.lineTo(w*.5*Math.cos(t),spring+radius*Math.sin(t));}
        shape.closePath();
        const point=at(street,along,raise,low);
        const geometry=new T.ShapeGeometry(shape).rotateY(Math.atan2(street.normal[0],street.normal[1])).translate(point.x,point.y,point.z);
        output.details.push(batchGeometry(geometry,new T.Matrix4(),typeof tone==='string'?new T.Color(tone):tone));geometry.dispose();
      };
      const guardedOpening=(along:number,low:number,w:number,h:number,trimColor:string|T.Color)=>{
        arch(along,low-.06,w+.17,h+.19,.081,trimColor);
        arch(along,low,w,h,.099,'#394643');
        const bars=Math.ceil(w/.19);
        for(let n=1;n<bars;n++){
          const horizontal=(n/bars-.5)*w;
          const height=h*.69+Math.sqrt(Math.max(0,1-(2*horizontal/w)**2))*h*.26;
          panel(output.details,street,along+horizontal,low+height/2,.028,height,.026,.113,'#777b74');
        }
        panel(output.details,street,along,low+h*.56,w,.032,.032,.114,'#888b81');
        panel(output.details,street,along,low-.045,w+.15,.105,.19,.113,stone);
      };
      for(let y=curb+.48;y<topY-.48;y+=.16)
        panel(output.details,street,doorCenter,y,street.length-.12,.016,.014,.019,mortar);
      panel(output.base,street,doorCenter,curb+groundFloor*.86,arcadeWidth,.32,.79,.36,stone);
      panel(output.base,street,doorCenter,curb+groundFloor*.86+.25,arcadeWidth,.20,.64,.287,wall);
      for(const side of [-1,1]){
        const pier=doorCenter+side*(arcadeWidth*.5-.22);
        panel(output.base,street,pier,curb+groundFloor*.43,.49,groundFloor*.86,.66,.34,wall);
        panel(output.base,street,pier,curb+.15,.57,.27,.71,.34,stone);
        guardedOpening(doorCenter+side*1.76,curb+.37,.76,groundFloor*.66,'#b7b1a3');
        for(let n=0;n<2;n++)guardedOpening(doorCenter+side*(arcadeWidth*.53+.69+n*1.26),curb+.57,.78,groundFloor*.62,'#b3ad9f');
      }
      guardedOpening(doorCenter,curb+.10,2.14,groundFloor*.75,'#c0b9a9');
      panel(output.base,street,doorCenter,curb+groundFloor+.50,arcadeWidth,.16,.52,.22,stone);
      panel(output.base,street,doorCenter,curb+groundFloor+.81,arcadeWidth,.13,.42,.18,stone);
      for(let n=-2;n<=2;n++){
        const along=doorCenter+n*1.36;
        panel(output.details,street,along,curb+groundFloor+.67,1.10,.17,.12,.16,n===0?'#777b72':stone);
      }
      const topCentre=curb+groundFloor+(topY-curb-groundFloor)*.58;
      for(let n=-3;n<=3;n++){
        const along=doorCenter+n*street.length*.123;
        const w=Math.min(1.16,street.length*.089),h=Math.min(1.26,(topY-curb-groundFloor)*.58);
        panel(output.base,street,along,topCentre,w+.12,h+.24,.07,.05,stone);
        panel(output.details,street,along,topCentre,w,h,.04,.102,'#677671');
        for(const bar of [-.29,0,.29])panel(output.details,street,along+w*bar,topCentre,.032,h,.028,.127,'#8c9186');
      }
      const plaquePosition=at(street,doorCenter-arcadeWidth*.5-.08,.075,curb+1.78);
      const plaque=signPanel(signName(building),.67,.19,plaquePosition.x,plaquePosition.y,plaquePosition.z,Math.atan2(street.normal[0],street.normal[1]));
      if(plaque)output.signs.push(plaque);
      continue;
    }
    if(groundFloor>=1.6&&street.length>=2.5&&!named.some(shop=>shop.edge===street.index)){
      const bays=Math.max(1,Math.min(12,Math.round(street.length/(storefront?4.1:5.0))));
      const bayWidth=street.length/bays;
      if(storefront||use==='civic'||isOldStation){
        const shopHeight=Math.min(2.5,groundFloor-.4),mid=curb+shopHeight/2+.12;
        const behind=-Math.max(0,arcadeDepth)+.045;
        for(let n=0;n<bays;n++){
          const a=(n+.5)*bayWidth,w=bayWidth*.77;
          const closed=storefront&&n%3===2&&!isCornerGlazing&&!isCornerTiles;
          panel(output.base,street,a,mid,w,shopHeight,.08,behind,metal);
          panel(output.details,street,a,mid,w*.94,shopHeight-.12,.035,behind+.055,closed?shutter:glass);
          if(closed){for(let k=1;k<6;k++)panel(output.details,street,a,mid-shopHeight/2+k*shopHeight/6,w*.92,.038,.028,behind+.08,'#737e78');}
          else{
            panel(output.details,street,a,mid,.072,shopHeight-.12,.04,behind+.09,trim);
            panel(output.details,street,a,mid+shopHeight*.25,w*.94,.08,.04,behind+.09,trim);
            panel(output.light,street,a,mid+shopHeight*.36,w*.75,.095,.025,behind+.10,'#c4aa7e');
          }
          if(photoRow||isRowBalconies){
            // Glazing sits behind the projecting piers, sills and shop header.
            const jamb=isCornerGlazing?'#8a786e':isCornerTiles?'#b7ab89':wall.clone().multiplyScalar(.87);
            for(const side of [-1,1])
              panel(output.details,street,a+w*.52*side,mid,.10,shopHeight+.06,.16,behind+.105,jamb);
            panel(output.details,street,a,curb+.15,w+.17,.094,.19,behind+.11,'#9b9c91');
            panel(output.details,street,a,mid+shopHeight*.49,w+.12,.17,.22,behind+.103,jamb);
          }
        }
        if((storefront||isOldStation)&&street.length>3.5){
          if(photoRow||isRowBalconies){
            for(let n=0;n<bays;n++){
              const along=(n+.5)*bayWidth;
              const awning=arcadeDepth>0?.31:isCornerGlazing?.85:isCornerTiles?.79:[.44,.68,.55][n%3];
              const y=curb+groundFloor-.26+[.03,.10,0][n%3],width=bayWidth*(isCornerGlazing?.985:.91);
              const color=isCornerGlazing?'#ded9ce':isCornerTiles?'#bbc4bd':['#676b63','#667a74','#8a7b6c'][n%3];
              panel(output.base,street,along,y,width,.18,awning,awning/2-.035,color);
              panel(output.details,street,along,y+.12,width,.17,.10,awning-.05,isCornerGlazing?'#9c7769':color);
              const braceY=y-.23;
              for(const side of [-1,1]){
                const near=along+side*width*.36;
                addBeam(output.details,at(street,near,.02,braceY-.13),at(street,near,awning-.12,y-.10),.043,.048,new T.Color('#575d58'));
              }
            }
          }else{
            const awning=arcadeDepth>0?.34:.70;
            const awningColor=isOldStation?'#706761':isMarket?'#526d5e':wall.clone().multiplyScalar(.79);
            panel(output.base,street,street.length/2,curb+groundFloor-.14,street.length*.98,.20,awning,awning/2-.04,awningColor);
            panel(output.details,street,street.length/2,curb+groundFloor-.04,street.length*.98,.055,.07,awning-.03,isMarket?'#819482':trim);
          }
        }
      }else if (use==='warehouse') {
        panel(output.base,street,street.length/2,curb+groundFloor*.48,street.length*.58,groundFloor*.78,.065,.05,shutter);
      }else {
        panel(output.details,street,street.length*.3,curb+groundFloor*.43,Math.min(1.25,street.length*.24),groundFloor*.8,.055,.06,metal);
        panel(output.details,street,street.length*.63,curb+groundFloor*.51,Math.min(1.6,street.length*.28),groundFloor*.46,.055,.06,glass);
      }
    }
    if (use==='temple') {
      // Emphasise the eaves and the robust street-facing columns of the religious hall.
      panel(output.base,street,street.length/2,topY-.18,street.length+.65,.20,1.25,.28,roof);
      for (const t of [.20,.5,.80])panel(output.details,street,street.length*t,curb+groundFloor*.50,.36,groundFloor*.97,.37,.21,wall.clone().multiplyScalar(.83));
    }
    if(street.length>=3.5&&topY-curb>=2.55){
      const width=Math.min(street.length*.82,4.2),offset=isOldStation?.82:.15;
      const [x,z]=around(street,street.length/2,offset);
      const g=signPanel(signName(building),width,Math.min(.58,width*.19),x,Math.min(topY-.4,curb+groundFloor+.30),z,Math.atan2(street.normal[0],street.normal[1]));
      if(g)output.signs.push(g);
    }
    if(floors<=1||use==='temple'||use==='warehouse')continue;
    const floorHeight=(topY-curb-groundFloor)/(floors-1);
    if(floorHeight<1.55)continue;
    // Only the photographed wings get portal-facing tile grids and security grilles.
    const photoEdges=isCornerGlazing?[2,3,4]:isCornerTiles?[0,4]:undefined;
    const observed=portalEdges??photoEdges;
    const sides=observed?allEdges.filter(e=>observed.includes(e.index)):use==='civic'||use==='commercial'?allEdges.filter(e=>e.length>=7):[street];
    for(const edge of allEdges.filter(e=>!sides.includes(e)&&e.length>9)){
      const seam=wall.clone().multiplyScalar(.83);
      for(let level=0;level<floors-1;level++){
        const y=curb+groundFloor+floorHeight*level;
        panel(output.details,edge,edge.length/2,y,edge.length-.18,.035,.013,.009,seam);
      }
      for(let along=4;along<edge.length-2;along+=4){
        panel(output.details,edge,along,(curb+topY)/2,.030,topY-curb-.34,.012,.009,seam);
      }
    }
    for(const edge of sides){
      const bays=Math.max(1,Math.min(16,Math.round(edge.length/(use==='commercial'?4.5:3.35))));
      const bay=edge.length/bays;
      if(portalEdges||photoEdges){
        const mortar=wall.clone().multiplyScalar(.72);
        const tile=portalEdges?.32:.39;
        for(let height=curb+tile;height<topY-.20;height+=tile)
          panel(output.details,edge,edge.length/2,height,edge.length-.08,.023,.009,.012,mortar);
        for(let along=tile;along<edge.length-.1;along+=tile)
          panel(output.details,edge,along,(curb+topY)/2,.023,topY-curb-.17,.009,.012,mortar);
      }
      for(let level=0;level<floors-1;level++){
        const cornerBay=isCornerGlazing&&edge.index===3;
        const y=curb+groundFloor+floorHeight*(level+.49);
        const w=Math.min(bay*(cornerBay?.92:use==='commercial'?.76:.68),3.25),h=Math.min(floorHeight*(cornerBay?.82:.53),cornerBay?2.45:1.85);
        if(w<.75)continue;
        if(building.tone==='tile'||building.tone==='porcelain'||isMarket)for(const offset of [-.29,.31])panel(output.details,edge,edge.length/2,y+floorHeight*offset,edge.length*.98,.027,.025,.015,wall.clone().multiplyScalar(.72));
        if(use==='commercial')panel(output.base,edge,edge.length/2,y+floorHeight*.39,edge.length,roofBand,.16,.09,wall.clone().lerp(new T.Color(trim),.38));
        for(let n=0;n<bays;n++){
          const centre=(n+.5)*bay;
          panel(output.base,edge,centre,y,w,h,.065,.048,metal);
          panel(output.details,edge,centre,y,w*.91,h*.87,.035,.096,glass);
          panel(output.details,edge,centre,y+h*.27,w*.91,.062,.038,.118,trim);
          panel(output.details,edge,centre,y,.06,h*.87,.038,.118,trim);
          panel(output.details,edge,centre,y-h*.52,w+.18,.13,.22,.115,wall.clone().lerp(new T.Color(trim),.25));
          if(portalEdges||isCornerTiles||isCornerGlazing&&!cornerBay){
            const grille='#526165';
            for(const bar of [-.34,-.17,0,.17,.34])
              panel(output.details,edge,centre+w*bar,y,.041,h*.96,.065,.172,grille);
            panel(output.details,edge,centre,y-h*.39,w*.94,.041,.065,.172,grille);
            panel(output.details,edge,centre,y+h*.39,w*.94,.041,.065,.172,grille);
          }
          if(photoRow&&isCornerGlazing&&!cornerBay){
            panel(output.details,edge,centre,y+h*.60,w+.17,.09,.33,.17,'#c5b1a2');
          }
          if((level+bays+n)%5===1)panel(output.light,edge,centre-w*.21,y+h*.07,w*.43,h*.64,.018,.123,'#af9c7e');
        }
        if(isRowBalconies&&edge===street){
          const railY=y-h*.38,front=.39;
          panel(output.base,edge,edge.length/2,railY-.17,edge.length*.97,.14,.57,.17,'#c1bdb0');
          panel(output.details,edge,edge.length/2,railY+.39,edge.length*.96,.038,.04,front,'#d5d4cb');
          for(let along=.45;along<edge.length-.45;along+=.26)
            panel(output.details,edge,along,railY+.15,.023,.47,.035,front,'#d5d4cb');
        }
      }
    }
  }
  for (const {x,z,levels} of buckets.values()){
    const block=new T.Group();block.name='Hamasen street block';block.position.set(x,0,z);
    const join=(geometries:T.BufferGeometry[],material:T.Material,name:string,castShadow:boolean,dispose=true)=>{
      if(!geometries.length)return;
      const merged=mergeGeometries(geometries,false);if(dispose)geometries.forEach(g=>g.dispose());
      if(!merged)return;
      merged.translate(-x,0,-z);merged.computeBoundingSphere();
      const mesh=new T.Mesh(merged,material);mesh.name=name;mesh.castShadow=castShadow;mesh.receiveShadow=true;return mesh;
    };
    const low=join(levels.base,shell,'Hamasen building silhouettes',true);if(low)block.add(low);
    const high=new T.Group();high.name='Hamasen close facade details';
    const middle=new T.Group();middle.name='Hamasen textured facades';
    if(atlas){
      const panels=join(levels.distant,atlas.material,'Hamasen street and side wall textures',false,false);
      if(panels)middle.add(panels);
      const signage=join([...levels.distant,...levels.signs],atlas.material,'Hamasen signs, windows and grilles',false);
      if(signage)high.add(signage);
    }
    const details=join(levels.details,shell,'Hamasen joinery and tiles',false);if(details)high.add(details);
    const lights=join(levels.light,warm,'Hamasen shop transoms',false);if(lights)high.add(lights);
    if(high.children.length){const lod=new T.LOD();lod.addLevel(high,0);lod.addLevel(middle,nearDetail);block.add(lod);}else block.add(middle);
    root.add(block);
  }
  tankShape.dispose();
  return root;
}

const streetSidewalks = new Set(['臨海二路','鼓山一路','麗雄街','鼓元街','鼓波街','濱海一路','濱海二路','哨船街','登山街']);

export function tintHamasenGround(material:T.Material, context:HamasenContext, terrain:Terrain) {
  const paving=(context.ground??[]).filter(surface=>surface.kind==='paving').map(surface=>surface.polygon);
  const urban=[context.polygon,...(context.ferryVisualGround?[context.ferryVisualGround]:[]),...paving];
  const bounds=new T.Box2().setFromPoints(urban.flat().map(toV2));
  const cell=2,width=Math.ceil((bounds.max.x-bounds.min.x)/cell),height=Math.ceil((bounds.max.y-bounds.min.y)/cell);
  if(width<1||height<1)return;
  const mask=new Uint8Array(width*height);
  const green=(context.ground??[]).filter(r=>r.kind==='grass');
  for(let j=0;j<height;j++)for(let i=0;i<width;i++){
    const x=bounds.min.x+(i+.5)*cell,z=bounds.min.y+(j+.5)*cell,at:Point2=[x,z];
    if(!urban.some(p=>inPolygon(at,p))||green.some(r=>inPolygon(at,r.polygon)))continue;
    mask[j*width+i]=paving.some(p=>inPolygon(at,p))?255:
      Math.round(255*(1-T.MathUtils.smoothstep(terrain.heightAt(x,z),2.8,12)));
  }
  const texture=new T.DataTexture(mask,width,height,T.RedFormat);
  texture.magFilter=texture.minFilter=T.LinearFilter;texture.needsUpdate=true;
  const uniforms={uHamasenMask:{value:texture},uHamasenBounds:{value:new T.Vector4(bounds.min.x,bounds.min.y,width*cell,height*cell)},uHamasenConcrete:{value:new T.Color('#aaa9a5')}};
  const base=material.onBeforeCompile;
  const key=material.customProgramCacheKey.bind(material);
  material.onBeforeCompile=(shader,renderer)=>{
    base.call(material,shader,renderer);
    Object.assign(shader.uniforms,uniforms);
    shader.fragmentShader=shader.fragmentShader
      .replace('#include <common>','#include <common>\nuniform sampler2D uHamasenMask; uniform vec4 uHamasenBounds; uniform vec3 uHamasenConcrete;')
      .replace('diffuseColor.rgb *= g * uLawnTint;',`
        vec2 districtUV=(vLawn.xz-uHamasenBounds.xy)/uHamasenBounds.zw;
        if(all(greaterThan(districtUV,vec2(0.)))&&all(lessThan(districtUV,vec2(1.)))){
          float urban=texture2D(uHamasenMask,districtUV).r;
          float wear=.89+.14*gNoise(p/5.0)+.07*gNoise(p/.35);
          vec2 cell=abs(fract(p/3.6-.5)-.5);
          float joint=.045*(1.-smoothstep(.003,.017,min(cell.x,cell.y)))*near;
          g=mix(g,uHamasenConcrete*(wear-joint),urban);
        }
        diffuseColor.rgb *= g * uLawnTint;`);
  };
  material.customProgramCacheKey=()=>key()+'-hamasen-paving';
}

/** Same draped terrain as the road surface, with the adjoining paved curb bands. */
export function hamasenStreetGround(context:HamasenContext, roads:readonly ContextRoad[], terrain:Terrain):T.Group {
  const group=new T.Group();group.name='Hamasen street ground';group.userData.terrainSeated=true;
  const area=context.polygon,shore=context.ferryVisualGround;
  const paving=(context.ground??[]).filter(surface=>surface.kind==='paving');
  const urban=(x:number,z:number)=>inPolygon([x,z],area)||!!shore&&inPolygon([x,z],shore)
    ||paving.some(surface=>inPolygon([x,z],surface.polygon));
  const xs=area.map(p=>p[0]),zs=area.map(p=>p[1]);
  const bounds:[number,number,number,number]=[Math.min(...xs),Math.min(...zs),Math.max(...xs),shore?Math.max(...shore.map(p=>p[1])):Math.max(...zs)];
  const built:T.BufferGeometry[]=[];
  if(context.ferryLand){
    // The surveyed quay continues beyond the DTM's last row. This backdrop
    // sits below the existing supported streets and joins the visible land.
    const shape=new T.Shape(context.ferryLand.map(([x,z])=>new T.Vector2(x,-z)));
    const geometry=new T.ShapeGeometry(shape).rotateX(-Math.PI/2).translate(0,terrain.seaLevel+.08,0);
    built.push(batchGeometry(geometry,new T.Matrix4(),new T.Color('#aaa8a1')));
    geometry.dispose();
  }
  if(context.ferryHarbor){
    // Continue the visible concrete face down to the canal at the DEM carve.
    const quayEdges=context.ferryHarbor.filter(([x,z])=>x===349&&z>=709&&z<=747);
    const sides:T.Vector3[][]=[];
    for(let i=1;i<quayEdges.length;i++){
      const [x,z0]=quayEdges[i-1],z1=quayEdges[i][1],steps=Math.ceil(Math.abs(z1-z0)/terrain.meta.cell);
      const water=terrain.seaLevel-.13;
      const top=(z:number)=>new T.Vector3(x+.018,Math.max(water+.10,terrain.heightAt(x+.018,z)+.006),z);
      for(let k=0;k<steps;k++){
        const a=top(T.MathUtils.lerp(z0,z1,k/steps)),b=top(T.MathUtils.lerp(z0,z1,(k+1)/steps));
        const loA=new T.Vector3(a.x,water,a.z),loB=new T.Vector3(b.x,water,b.z);
        sides.push([loA,loB,a],[loB,b,a]);
      }
    }
    const geometry=geometryFromTriangles(sides);
    if(geometry.attributes.position.count)built.push(batchGeometry(geometry,new T.Matrix4(),new T.Color('#97948b')));
    geometry.dispose();
  }
  const add=(ribbon:T.BufferGeometry,raise:number,tint:string,cutters?:ReturnType<typeof surfaceCutters>)=>{
    const surface=projectRoadGeometry(ribbon,terrain,{offset:raise,accept:urban,cutters});
    if(surface.getAttribute('position').count)built.push(batchGeometry(surface,new T.Matrix4(),new T.Color(tint)));
    ribbon.dispose();surface.dispose();
  };
  const offset=(line:Point2[],metres:number)=>line.map((p,i):Point2=>{
    const a=line[Math.max(0,i-1)],b=line[Math.min(line.length-1,i+1)],dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz)||1;
    return [p[0]-dz/length*metres,p[1]+dx/length*metres];
  });
  const project=(line:Point2[],width:number,raise:number,tint:string,cutters?:ReturnType<typeof surfaceCutters>)=>{
    add(roadRibbon(line,width),raise,tint,cutters);
  };
  const carriageways=roads.filter(r=>r.district==='hamasen'&&['tertiary','residential','living_street','unclassified','service'].includes(r.kind));
  const cutRoad=surfaceCutters(roads.filter(r=>r.district==='hamasen'&&!r.tunnel&&!r.bridge).flatMap(road=>{
    const ribbon=roadRibbon(road.points,road.width);
    const tris=geometryFootprints(ribbon);ribbon.dispose();return tris;
  }));
  for(const surface of context.ground??[]){
    if(surface.kind==='grass')continue;
    const shape=new T.Shape(surface.polygon.map(([x,z])=>new T.Vector2(x,-z)));
    add(new T.ShapeGeometry(shape).rotateX(-Math.PI/2),.004,surface.kind==='parking'?'#535654':surface.kind==='yard'?'#b5a692':'#b4b4b0');
    if(surface.kind!=='parking')continue;
    const [a,b]=surface.polygon,len=Math.hypot(b[0]-a[0],b[1]-a[1]);
    const ux=(b[0]-a[0])/len,uz=(b[1]-a[1])/len;
    const stall=(along:number,across:number):Point2=>[a[0]+ux*along-uz*across,a[1]+uz*along+ux*across];
    for(const row of [7,22,36]){
      const start=row===36?8:3,end=row===36?33:len-5;
      const stops:Point2[]=[];
      for(let along=start;along<=end;along+=2.6){
        const head=stall(along,row),tail=stall(along,row+4.8);
        if(!inPolygon(head,surface.polygon)||!inPolygon(tail,surface.polygon))continue;
        stops.push(head);project([head,tail],.10,.018,'#e3e0d6');
      }
      if(stops.length>1)project([stops[0],stops.at(-1)!],.10,.018,'#e3e0d6');
    }
  }
  const occupiedSidewalk:ReturnType<typeof surfaceCutters>=[];
  const sidewalk=(line:Point2[],width:number,tint:string)=>{
    const ribbon=roadRibbon(line,width);
    const footprint=surfaceCutters(geometryFootprints(ribbon));
    add(ribbon,.020,tint,[...cutRoad,...occupiedSidewalk]);
    occupiedSidewalk.push(...footprint);
  };
  for(const road of carriageways){
    const surveyed=!!road.sidewalk&&!['no','separate','none'].includes(road.sidewalk);
    if(!surveyed&&!streetSidewalks.has(road.name??''))continue;
    // The side of an OSM line is relative to its stored direction.
    const sides=road.sidewalk==='left'?[-1]:road.sidewalk==='right'?[1]:[-1,1];
    for(const line of clippedRoadPaths(road.points,bounds))for(const side of sides){
      // Keep the two strips edge-to-edge, and let the first strip own each
      // intersection. The previous curb overlaid 18 cm of coplanar sidewalk.
      sidewalk(offset(line,side*(road.width/2+.107)),.18,'#d4cfc6');
      sidewalk(offset(line,side*(road.width/2+.782)),1.17,'#bdb9b0');
    }
  }
  // Resurface the crossing's paint zone, then place perpendicular rectangular bars.
  const crossing=roads.find(road=>road.id==='hamasen-osm-249154067');
  if(crossing){
    const a=crossing.points.at(-1)!,b=crossing.points.at(-2)!;
    const length=Math.hypot(b[0]-a[0],b[1]-a[1]),ux=(b[0]-a[0])/length,uz=(b[1]-a[1])/length;
    const at=(along:number,across:number):Point2=>[a[0]+ux*along-uz*across,a[1]+uz*along+ux*across];
    const half=crossing.width/2-.15;
    project([at(7,-half),at(7,half)],5.6,.017,'#535654');
    for(let i=0;i<6;i++){
      const across=(i-2.5)*1.13;
      project([at(5.4,across),at(8.6,across)],.54,.022,'#e8e3d6');
    }
    project([at(4.55,-half),at(4.55,-.18)],.24,.023,'#e8e3d6');
    project([at(9.45,.18),at(9.45,half)],.24,.023,'#e8e3d6');
    for(const side of [-1,1])project([at(2.1,side*half),at(14,side*half)],.13,.022,'#ae4844');
  }
  for(const rail of context.rails??[]){
    if(rail.kind==='subway')continue;
    for(const line of clippedRoadPaths(rail.points,bounds)){
      project(line,2.0,.002,'#88867b');
      const halfGauge=rail.kind==='light_rail'?.7175:.5335;
      project(offset(line,-halfGauge),.095,.018,'#4a5355');project(offset(line,halfGauge),.095,.018,'#4a5355');
    }
  }
  if(built.length){
    const geometry=mergeGeometries(built,false);built.forEach(g=>g.dispose());
    if(geometry){
      const material=new T.MeshStandardMaterial({vertexColors:true,roughness:.92,
        polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-2});
      const mesh=new T.Mesh(geometry,material);mesh.name='Hamasen sidewalks, markings and rails';mesh.receiveShadow=true;group.add(mesh);
    }
  }
  return group;
}

/** Photo-checked ribs and tiled threshold at the east portal, outside the tunnel bore. */
export function hamasenPortalCanopy(profile:TunnelProfile,terrain:Terrain) {
  const group=new T.Group();group.name='Hamasen east portal canopy';group.userData.terrainSeated=true;
  const tangent=profile.sections.at(-1)!.tangent,side=profile.sections.at(-1)!.right;
  const at=(along:number,across:number,y:number)=>profile.east.clone().addScaledVector(tangent,along).addScaledVector(side,across).setY(y);
  const parts:T.BufferGeometry[]=[];
  const ribColor=new T.Color('#ded7c9'),brass=new T.Color('#a88d58');
  const beam=(a:T.Vector3,b:T.Vector3,width:number,depth:number,tint:T.Color)=>{
    const geometry=beamGeometry(a,b,width,depth,tint);
    if(geometry)parts.push(geometry);
  };
  for(const direction of [-1,1]){
    const ribs=[2.0,4.35,6.7,9.05,11.4,13.75].map(distance=>{
      const base=at(distance,direction*3.82,0);
      const ground=terrain.heightAt(base.x,base.z);base.y=ground+.14;
      return new T.CubicBezierCurve3(base,
        at(distance,direction*3.82,ground+1.61),
        at(distance,direction*3.09,ground+3.15),
        at(distance,direction*1.79,ground+4.42));
    });
    for(const rib of ribs){
      const arc=rib.getPoints(9);
      for(let i=1;i<arc.length;i++)beam(arc[i-1],arc[i],.19,.255,ribColor);
    }
    // Low ochre rods track each row lengthwise, with open air between both sides.
    for(const height of [.12,.23,.34,.45,.56,.67,.77]){
      const rail=ribs.map(rib=>rib.getPoint(height).addScaledVector(side,direction*.12));
      for(let i=1;i<rail.length;i++)beam(rail[i-1],rail[i],.045,.045,brass);
    }
  }
  const shrub=new T.IcosahedronGeometry(1,0),shrubColors=['#65765a','#6d7d50','#556d51'];
  for(const direction of [-1,1])for(let i=0;i<5;i++){
    const distance=2.75+i*2.38,base=at(distance,direction*4.1,0);
    base.y=terrain.heightAt(base.x,base.z);
    const pad=new T.Matrix4().compose(base.clone().setY(base.y+.18),new T.Quaternion().setFromAxisAngle(new T.Vector3(0,1,0),-Math.atan2(tangent.z,tangent.x)),new T.Vector3(1.84,.4,.64));
    parts.push(batchGeometry(box,pad,new T.Color('#a4a098')));
    for(const along of [-.51,.15,.55]){
      const center=base.clone().addScaledVector(tangent,along).setY(base.y+.58);
      const transform=new T.Matrix4().compose(center,new T.Quaternion(),new T.Vector3(.44,.40,.39));
      parts.push(batchGeometry(shrub,transform,new T.Color(shrubColors[(i+(along>.1?1:0))%shrubColors.length])));
    }
  }
  shrub.dispose();
  const pavement=(points:T.Vector3[],width:number,raise:number,tint:string)=>{
    const source=roadRibbon(points.map(p=>[p.x,p.z]),width);
    const projected=projectRoadGeometry(source,terrain,{offset:raise});
    if(projected.getAttribute('position').count)parts.push(batchGeometry(projected,new T.Matrix4(),new T.Color(tint)));
    source.dispose();projected.dispose();
  };
  pavement([at(1.8,0,0),at(15,0,0)],7.65,.014,'#b5b4ac');
  for(const along of [3.2,6.7,10.2,13.7])pavement([at(along,-3.6,0),at(along,3.6,0)],.53,.016,'#9a9996');
  pavement([at(1.8,0,0),at(7.6,-.26,0),at(14.7,-1.1,0)],.115,.019,'#4f8292');
  const geometry=mergeGeometries(parts,false);parts.forEach(p=>p.dispose());
  if(geometry){const mesh=new T.Mesh(geometry,new T.MeshStandardMaterial({vertexColors:true,roughness:.92}));mesh.receiveShadow=true;group.add(mesh);}
  return group;
}
