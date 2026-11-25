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

interface Volume {
  baseY:number; topY:number; arcadeDepth:number; cornerArcadeDepth?:number;
  arcadeEdges?:Record<number,number>;
  columns?:{x:number;z:number;yaw:number;size:number;bottom:number;top:number}[];
}
interface Edge { a:Point2; tangent:Point2; normal:Point2; length:number; yaw:number; index:number }
interface DetailLevels { base:T.BufferGeometry[]; details:T.BufferGeometry[]; light:T.BufferGeometry[]; signs:T.BufferGeometry[]; distant:T.BufferGeometry[] }

type ShopStyle = 'glass' | 'counter' | 'cart' | 'diner' | 'wood' | 'curtain' | 'ice' | 'heritage';
interface ShopTheme {
  sign:string; ink:string; trim:string; counter:string; style:ShopStyle;
  form:'board'|'blade'|'banner'|'curtain'|'placard'|'cart';
  awning?:string; text?:string; secondary?:string;
  badge?:'pelican'|'ice'|'tea'|'sun'|'bowl';
  accent?:string;
}
const shopThemes:Record<string,ShopTheme> = {
  'matou-auntie-danbing':{sign:'#e7dec9',ink:'#9b302a',trim:'#b8b1a6',counter:'#a9b3ae',style:'cart',form:'placard',awning:'#9f3630',text:'阿姨蛋餅'},
  'lin-mama-danbing':{sign:'#e7d9af',ink:'#504433',trim:'#bdbab1',counter:'#9da7a2',style:'counter',form:'placard',accent:'#9b4734'},
  'my-warm-day':{sign:'#294938',ink:'#faf3dd',trim:'#28483b',counter:'#b4885e',style:'glass',form:'blade',awning:'#294938',badge:'sun',accent:'#d98829'},
  'dandan-burger':{sign:'#f3cd41',ink:'#a42f34',trim:'#3f545b',counter:'#b73e3a',style:'glass',form:'blade',awning:'#355d4c',badge:'pelican',accent:'#c8322b'},
  'axue-eatery':{sign:'#e6bb4c',ink:'#9e3c2b',trim:'#7a9282',counter:'#aeb6ae',style:'diner',form:'blade',awning:'#396d5e',badge:'bowl',accent:'#9e3c2b'},
  'shunhe-pork-rib':{sign:'#a22821',ink:'#fff5dc',trim:'#aaa6a0',counter:'#aeb6af',style:'counter',form:'board',text:'順和排骨大王',badge:'bowl',accent:'#dfc059'},
  'loutijiao-pasta':{sign:'#d7b55f',ink:'#41372b',trim:'#594739',counter:'#826045',style:'heritage',form:'placard',awning:'#4c7674'},
  'maruhama-soft-serve':{sign:'#263857',ink:'#eee7d1',trim:'#ac7949',counter:'#9b6d43',style:'curtain',form:'curtain',text:'丸浜',secondary:'霜淇淋'},
  'yudian-tea':{sign:'#edeae1',ink:'#292d33',trim:'#aa8054',counter:'#a4774d',style:'wood',form:'blade',badge:'tea',accent:'#7a5736'},
  'fifty-lan':{sign:'#efcf3d',ink:'#18366c',trim:'#ece9dd',counter:'#234580',style:'counter',form:'blade',badge:'tea',accent:'#18366c'},
  'macu-tea':{sign:'#b82e35',ink:'#fff2e6',trim:'#b82e35',counter:'#efe8dd',style:'counter',form:'blade',badge:'tea',accent:'#f0e3d3'},
  'lin-mama-chicken-steak':{sign:'#bf734a',ink:'#4d2420',trim:'#afaaa0',counter:'#aeb6af',style:'cart',form:'cart'},
  'ferry-haizhibing':{sign:'#b0453d',ink:'#ffe7a1',trim:'#dbae49',counter:'#6a8a99',style:'ice',form:'banner',text:'渡船頭海之冰',secondary:'海之冰',badge:'ice',accent:'#f0ca4d'},
  'yuanfu-yakiniku-rice':{sign:'#b43f37',ink:'#fff0d9',trim:'#b8a995',counter:'#a2a9a0',style:'diner',form:'board',awning:'#9f4039',text:'元福',secondary:'香菇肉羹'},
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
    ctx.strokeStyle=style==='brick'?'#ebdac582':'#57534b3c';ctx.lineWidth=1;
    const height=style==='brick'?6:style==='tile'?8:16;
    if(style==='metal'){
      // Taiwanese corrugated iron waterproof party-wall cladding (鐵皮浪板).
      const sheet=['#4b6355','#495c6c','#764840','#7d8384'][Number(index)%4];
      rect(0,0,384,96,sheet);
      for(let x=0;x<384;x+=6){rect(x,0,2,96,'#f7fbef2c');rect(x+3,0,2,96,'#1f242138');}
      for(const y of [32,64])rect(0,y,384,2,'#262b2848');
    }else if(style==='stucco'){
      for(let i=0;i<520;i++)rect(i*97%383,i*37%95,1+(i%2),1,'#4c49423d');
      for(let i=0;i<240;i++)rect((i*61+13)%383,(i*53+7)%95,1,1,'#f4efe436');
    }else{
      for(let y=0;y<96;y+=height){
        ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(384,y);
        const step=style==='brick'?15:22;
        for(let x=(Math.floor(y/height)%2)*Math.floor(step/2);x<384;x+=step){ctx.moveTo(x,y);ctx.lineTo(x,y+height);}
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
    // Compact bathroom/stairwell utility casement instead of a giant green industrial louver.
    rect(0,0,384,96,'#b3afa4');rect(28,12,328,72,'#464e4d');
    rect(188,14,8,68,'#9fa298');
    for(let y=20;y<78;y+=10)rect(38,y,308,3,'#6f7976');
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
    if(board){
      // Illuminated Taiwanese fascia & blade sign lightboxes at night (kept <90 to avoid bloom blowout).
      light.fillStyle='#565656';
      light.fillRect(x+8,y+8,368,80);
    }else if(store&&store.style!=='heritage'||key.startsWith('front:')&&key!=='front:shutter'){
      light.fillStyle=store?'#444444':'#2e2e2e';
      light.fillRect(x+24,y+18,336,66);
      light.fillStyle=store?'#565656':'#424242';
      for(const px of [39,130,221,312])light.fillRect(x+px,y+14,32,4);
    }else if(key==='sliding'||key==='grille'){
      // Subtle lived-in apartment window glow on one sash so upper floors read warmly at night.
      light.fillStyle='#2e2e2e';
      if(key==='sliding')light.fillRect(x+24,y+18,156,60);
      else light.fillRect(x+198,y+22,160,54);
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
  const nearDetail = shortDetail ? 84 : 155;
  const chunk=168;
  const shell=new T.MeshStandardMaterial({name:'Hamasen masonry, metal and glazing',map:masonryGrain(),vertexColors:true,roughness:.87,side:T.DoubleSide});
  const warm=new T.MeshStandardMaterial({name:'Hamasen shop lights',vertexColors:true,emissive:'#ffd089',emissiveIntensity:0,roughness:.75});
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
      const spanRatio=theme.form==='cart'?undefined:
        theme.form==='curtain'?Math.max(4.5,Math.min(10.5,shop.width*.96/.62)):
        theme.form==='banner'?Math.max(6.5,Math.min(13.8,shop.width*.94/.76)):
        theme.form==='placard'?Math.max(3.2,Math.min(5.6,Math.min(shop.width*.76,3.4)/.56)):
        Math.max(4.0,Math.min(8.2,shop.width*.88/.64));
      const board:SignBoard={text:label,background:theme.sign,ink:theme.ink,badge:theme.badge,accent:theme.accent};
      boards.set(keyForShop(shop),{...board,targetAspect:spanRatio,cloth:theme.form==='curtain',subtitle:shop.id==='yuanfu-yakiniku-rice'?theme.secondary:undefined});
      if(theme.form==='blade'||theme.form==='placard')boards.set(keyForShop(shop,'blade'),{text:label,background:theme.sign,ink:theme.ink,vertical:true});
      if(theme.form==='curtain')boards.set(keyForShop(shop,'blade'),{text:shop.name,background:'#eee9df',ink:'#303746'});
      if(theme.secondary&&shop.id!=='yuanfu-yakiniku-rice')boards.set(keyForShop(shop,'secondary'),{text:theme.secondary,background:theme.sign,ink:theme.ink});
      shopTiles.set(keyForShop(shop,'front'),theme);
    }
  }
  const genericColors=['#65483d','#395c5e','#7a392e','#5c4b28','#2f4966','#425e46'];
  for(const [i,label] of genericSigns.entries())for(const vertical of [false,true]){
    boards.set(keyForGeneric(label,vertical),{
      text:label,vertical,
      targetAspect:vertical?undefined:4.4,
      background:genericColors[i%genericColors.length],
      ink:'#f6ebd2',
      accent:vertical?undefined:'#e2c067',
    });
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
  const around=(edge:Edge,along:number,outside:number):Point2=>[edge.a[0]+edge.tangent[0]*along+edge.normal[0]*outside,edge.a[1]+edge.tangent[1]*along+edge.normal[1]*outside];
  const at=(edge:Edge,along:number,outside:number,y:number)=>{const [x,z]=around(edge,along,outside);return new T.Vector3(x,y,z);};
  const slopedAwning=(out:T.BufferGeometry[],edge:Edge,along:number,wallY:number,width:number,depth:number,color:string|T.Color)=>{
    if(width<=.15||depth<=.15)return;
    const drop=Math.min(.22,depth*.26),lip=.095;
    const c=typeof color==='string'?new T.Color(color):color.clone();
    const under=c.clone().multiplyScalar(.62),valance=c.clone().multiplyScalar(.84);
    const p00=at(edge,along-width/2,.015,wallY),p10=at(edge,along+width/2,.015,wallY);
    const p01=at(edge,along-width/2,depth,wallY-drop),p11=at(edge,along+width/2,depth,wallY-drop);
    const p02=at(edge,along-width/2,depth,wallY-drop-lip),p12=at(edge,along+width/2,depth,wallY-drop-lip);
    const topGeo=geometryFromTriangles([[p00,p10,p11],[p00,p11,p01]]);
    out.push(batchGeometry(topGeo,new T.Matrix4(),c));topGeo.dispose();
    const underGeo=geometryFromTriangles([[p00,p11,p10],[p00,p01,p11]]);
    out.push(batchGeometry(underGeo,new T.Matrix4(),under));underGeo.dispose();
    const lipGeo=geometryFromTriangles([[p01,p11,p12],[p01,p12,p02]]);
    out.push(batchGeometry(lipGeo,new T.Matrix4(),valance));lipGeo.dispose();
    const rod=new T.Color('#474f50');
    for(const side of [-1,1]){
      const s=along+side*Math.max(.15,width*.42);
      const strut=beamGeometry(at(edge,s,.02,wallY-.26),at(edge,s,depth*.86,wallY-drop-.02),.032,.032,rod);
      if(strut)out.push(strut);
    }
  };
  for(const {building,group} of procedural){
    const allEdges=edgesOf(building);
    if(!allEdges.length)continue;
    const frontage=building.frontage?.edge;
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
    const arcadeEdges:Record<number,number>=volume?.arcadeEdges??(arcadeDepth>0&&frontage!==undefined?{[frontage]:arcadeDepth}:{});
    const arcadeCutEdges=allEdges.filter(e=>(arcadeEdges[e.index]??0)>0);
    const arcadeCeiling=Math.min(topY-.35,bottom+3.02);
    const archedArcade=building.frontage?.arcadeStyle==='arched';
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
    const filterShell=(geometry:T.BufferGeometry,isColumn=false)=>{
      const pos=geometry.getAttribute('position'),normal=geometry.getAttribute('normal'),col=geometry.getAttribute('color'),indices:number[]=[];
      const hidden=allEdges.filter(e=>building.sharedWalls?.[e.index]!==undefined);
      if(arcadeCutEdges.length&&col){
        for(let j=0;j<pos.count;j++){
          const vx=pos.getX(j),vy=pos.getY(j),vz=pos.getZ(j),ny=normal.getY(j);
          let shade=1;
          if(isColumn){
            // Darken the interior-facing side and top soffit junction of arcade piers.
            const nx=normal.getX(j),nz=normal.getZ(j);
            const facingIn=arcadeCutEdges.some(e=>nx*e.normal[0]+nz*e.normal[1]<-.35);
            const topJoin=T.MathUtils.smoothstep(vy,arcadeCeiling-.55,arcadeCeiling);
            shade=(facingIn?.76:.98)*(1-.22*topJoin);
          }else if(ny<-.75&&vy>bottom+1.5&&vy<arcadeCeiling+.22){
            // Deep shadow on the arcade ceiling soffit so the corridor reads from afar.
            shade=.46;
          }else if(Math.abs(ny)<.25&&vy<arcadeCeiling+.08){
            const recessed=arcadeCutEdges.some(e=>{
              const inward=-(vx-e.a[0])*e.normal[0]-(vz-e.a[1])*e.normal[1];
              return inward>.38&&inward<=(arcadeEdges[e.index]??0)+.18;
            });
            if(recessed)shade=T.MathUtils.lerp(.74,.50,T.MathUtils.clamp((vy-bottom)/2.9,0,1));
          }
          if(shade<1)col.setXYZ(j,col.getX(j)*shade,col.getY(j)*shade,col.getZ(j)*shade);
        }
      }
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
    const pierColor=archedArcade?new T.Color('#a45b46'):wall.clone().lerp(new T.Color('#dbd6ca'),.62);
    group.updateWorldMatrix(true,true);
    group.traverse(o=>{
      if(!(o instanceof T.Mesh))return;
      if(renderPlatform){
        const material=o.userData.hamasenColumn?'#737f78':o.userData.hamasenPlatformDeck?'#b9b7ae':building.roofTone;
        output.base.push(batchGeometry(o.geometry,o.matrixWorld,paint(material)));
      }else{
        const isCol=!!o.userData.hamasenColumn;
        output.base.push(filterShell(batchGeometry(o.geometry,o.matrixWorld,isCol?pierColor:wall,roof),isCol));
      }
    });
    for(const col of volume?.columns??[]){
      // Washed-stone plinth (柱礎) and pier necking collar on every arcade column.
      addCuboid(output.base,col.x,col.bottom+.24,col.z,col.size+.075,.48,col.size+.075,col.yaw,'#6e6b64');
      addCuboid(output.details,col.x,col.top-.36,col.z,col.size+.05,.11,col.size+.05,col.yaw,'#c9c4b8');
    }
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
      const depth=arcadeEdges[edge.index]??0;
      const front=primary||corner||depth>0||shops.length>0;
      const commercial=front&&(building.frontage?.commercial??(use==='commercial'||isRowBalconies));
      const hidden=building.sharedWalls?.[edge.index]??0;
      const localFloor=(along:number,outside:number)=>terrain?.heightAt(...around(edge,along,outside))??bottom;
      const streetY=localFloor(edge.length/2,0);
      const ceiling=Math.min(topY-.08,depth?arcadeCeiling:streetY+3.12);
      const floorStart=Math.max(ceiling,bottom+groundFloor*.89);
      const bayCount=Math.max(1,Math.round(edge.length/(front?5:7)));
      const bay=edge.length/bayCount;
      if (depth>0&&terrain&&(detailgable||named.length)){
        // Structural arcade spandrel beam (騎樓橫樑), drip molding, ceiling lights and terracotta tile paving.
        const spandrelTint=archedArcade?new T.Color('#9a5642'):wall.clone().lerp(new T.Color('#9c968b'),.48);
        panel(output.base,edge,edge.length/2,ceiling-.16,edge.length,.32,.40,-.20,spandrelTint);
        panel(output.details,edge,edge.length/2,ceiling-.335,edge.length+.04,.055,.44,-.20,'#cfc9bc');
        const curbBand=[[.01,.05],[edge.length-.01,.05],[edge.length-.01,-.14],[.01,-.14]]
          .map(([along,offset])=>at(edge,along,offset,localFloor(along,offset)+.028));
        const curbGeo=geometryFromTriangles([[curbBand[0],curbBand[1],curbBand[2]],[curbBand[0],curbBand[2],curbBand[3]]]);
        output.base.push(batchGeometry(curbGeo,new T.Matrix4(),new T.Color('#cfcabe')));
        curbGeo.dispose();
        for(let bIdx=0;bIdx<bayCount;bIdx++){
          const u0=bIdx*bay+.02,u1=(bIdx+1)*bay-.02,mid=(u0+u1)/2;
          const tileTone=(bIdx+seed)%2===0?'#a28b79':'#988474';
          const corners=[[u0,-.14],[u1,-.14],[u1,-depth+.05],[u0,-depth+.05]]
            .map(([along,offset])=>at(edge,along,offset,localFloor(along,offset)+.027));
          const paving=geometryFromTriangles([[corners[0],corners[1],corners[2]],[corners[0],corners[2],corners[3]]]);
          output.base.push(batchGeometry(paving,new T.Matrix4(),new T.Color(tileTone)));
          paving.dispose();
          // Ceiling cross-beam and warm fluorescent tube fixture per arcade bay.
          if(bIdx>0)addBeam(output.details,at(edge,bIdx*bay,-.22,ceiling-.09),at(edge,bIdx*bay,-depth+.08,ceiling-.09),.16,.18,new T.Color('#646059'));
          panel(output.details,edge,mid,ceiling-.035,Math.min(1.05,bay*.34),.055,.18,-depth*.52,'#707472');
          panel(output.light,edge,mid,ceiling-.068,Math.min(.92,bay*.30),.032,.11,-depth*.52,'#f0d199');
          if(archedArcade&&bay>2.8&&!shops.some(s=>s.id==='maruhama-soft-serve')){
            for(const sgn of [-1,1]){
              panel(output.details,edge,mid+sgn*(bay*.5-.28),ceiling-.44,.52,.22,.34,-.20,'#924f3c');
              panel(output.details,edge,mid+sgn*(bay*.5-.16),ceiling-.58,.28,.16,.32,-.20,'#cec6b6');
            }
          }
        }
      }
      if(!front&&!hidden&&detailgable&&edge.length>2.6&&seed%3===0){
        // Exposed PVC rainwater downpipe on party/side walls instead of fake industrial louvers.
        panel(output.details,edge,edge.length*.84,(bottom+topY)/2,.068,Math.max(1.2,topY-bottom-.28),.068,.038,'#8d9390');
      }
      if(detailgable&&edge.length>1.15){
        for(let j=0;j<bayCount;j++){
          const along=(j+.5)*bay,variation=(seed+j*17+edge.index*3)%77;
          const color=streetColor(houseSeed(`${building.id}:${j}`));
          const material=front?(color>=7&&color<12?variation%3?'brick':'tile':variation%3?'tile':'stucco'):
            variation%5<2?'metal':color>=7&&color<12?'brick':'stucco';
          const base=Math.max(bottom+hidden,depth?ceiling:localFloor(along,0)+.03);
          const parapet=rowhouse&&front&&!renderPitch?.21+(variation%7)*.105:0;
          const top=topY+parapet;
          const w=bay-.036;
          if(hidden&&top-base<.11)continue;
          const upper=top-base;
          const tile=`wall:${color}:${material}`;
          if(upper>.15&&!specialWall){
            const bands=front?Math.max(1,Math.min(3,Math.round(upper/3.6))):1;
            const bandH=upper/bands;
            for(let bBand=0;bBand<bands;bBand++){
              graphic(tile,edge,along,base+(bBand+.5)*bandH,w,bandH,.026,undefined,output.distant);
            }
          }
          if(parapet>0){
            panel(output.base,edge,along,topY+parapet/2,w,parapet,.095,-.025,specialWall??streetColors[color]);
          }
          const shopOverlap=shops.some(s=>Math.abs(along-s.along)<(w+s.width)/2);
          if(!hidden&&front&&(!shopOverlap||shops.some(s=>s.id==='my-warm-day')&&shops.every(s=>Math.abs(along-s.along)>s.width*.58))){
            const streetHeight=ceiling-localFloor(along,-depth+.10)-.13;
            if(streetHeight>1.26){
              const {style,label}=planStreetfront(commercial,houseSeed(`${building.id}:${edge.index}:${j}`),around(edge,along,0),edge.normal,bay);
              const usableW=w*.88;
              const key=`front:${style}`;
              const h=Math.min(streetHeight,2.62);
              const frontY=ceiling-.20-h/2;
              graphic(key,edge,along,frontY,usableW,h,-depth+.038,undefined,output.distant);
              // 3D roller-shutter header box for realistic ground-floor relief.
              panel(output.details,edge,along,ceiling-.15,usableW+.08,.20,.15,-depth+.075,'#5b625f');
              if(depth===0&&commercial&&variation%3!==0){
                const awningColors=['#355b49','#7a3933','#314e68','#58625d'];
                slopedAwning(output.details,edge,along,ceiling-.34,w*.94,.66,awningColors[(seed+j)%awningColors.length]);
              }
              if(label){
                const {signY,signOffset}=fasciaSign(ceiling,topY,depth===0&&commercial&&variation%3!==0?.66:0);
                if(variation%11<5&&w>3.1){
                  const yaw=Math.atan2(edge.normal[0],edge.normal[1])+Math.PI/2;
                  const sideDir=Math.sign(Math.sin(yaw)*edge.tangent[0]+Math.cos(yaw)*edge.tangent[1])||1;
                  const bladeW=.66,bladeH=1.28,offset=.96,bx=along-w*.43;
                  // Place each blade face on the outward side matching its front normal (works for both CW & CCW polygons).
                  graphic(keyForGeneric(label,true),edge,bx+sideDir*.048,signY+.56,bladeW,bladeH,offset,yaw);
                  graphic(keyForGeneric(label,true),edge,bx-sideDir*.048,signY+.56,bladeW,bladeH,offset,yaw+Math.PI);
                  panel(output.details,edge,bx,signY+.56,.082,bladeH+.04,bladeW+.04,offset,'#394042');
                  for(const dy of [-.42,.42])addBeam(output.details,at(edge,bx,.04,signY+.56+dy),at(edge,bx,offset-bladeW*.48,signY+.56+dy),.036,.036,new T.Color('#42494b'));
                }else{
                  const signW=usableW*.92,signH=.52;
                  graphic(keyForGeneric(label),edge,along,signY-.06,signW,signH,signOffset);
                  const fit=fitSign(boards.get(keyForGeneric(label))!,signW,signH);
                  panel(output.details,edge,along,signY-.06,fit.width+.05,fit.height+.05,.10,signOffset-.055,'#353c3e');
                }
              }
            }
          }
          const levels=Math.max(0,Math.min(floors-1,Math.floor((topY-floorStart)/1.5)));
          for(let k=0;k<levels;k++){
            const step=(topY-floorStart)/levels;
            const sill=floorStart+k*step+.42+(variation%3)*.10;
            if(sill<base+.16)continue;
            if(!front){
              panel(output.base,edge,along,sill-.17,w+.032,.06,.045,.012,'#9c968b');
              if(j===0&&k===levels-1&&variation%4===0&&w>2.2){
                graphic('side-vent',edge,along,sill+.28,.64,.48,.032,undefined,output.distant);
              }
              continue;
            }
            const width=Math.min(3.1,w*.62)*(.9+variation%4*.06);
            const height=Math.min(1.48,step*.54);
            const windowX=along+(variation%3-1)*w*.10;
            graphic(windowTiles[(variation+k)%3],edge,windowX,sill+height/2,width,height,.033,undefined,output.distant);
            if(k===0&&variation%3!==0&&bay>3.5){
              const balcony=Math.min(w*.88,width+.55),projection=.44+(variation%3)*.09;
              panel(output.details,edge,windowX,sill-.09,balcony,.14,projection,projection*.48,'#b5b0a4');
              graphic('rail',edge,windowX,sill+.26,balcony,.62,projection-.005);
            }else if((variation+k)%5<2&&bay>3.1){
              // Lightweight 3D projecting Taiwanese security window cage (遮雨鐵皮蓋 + 外推框體).
              const cageD=.21,cageW=width+.12,cageH=height+.06;
              panel(output.details,edge,windowX,sill+height+.07,cageW+.10,.055,cageD+.08,(cageD+.08)*.5,'#3f5a4d');
              panel(output.details,edge,windowX,sill-.04,cageW,.05,cageD,cageD*.5,'#556260');
              for(const sgn of [-1,1])panel(output.details,edge,windowX+sgn*cageW*.5,sill+height/2,.038,cageH,cageD,cageD*.5,'#556260');
            }else panel(output.details,edge,windowX,sill-.07,width+.14,.085,.14,.06,'#c4c0b2');
            if((variation+k)%4===0&&w>3.2){
              const side=along+w*.35;
              // 3D AC outdoor unit cabinet with fan grille decal on front face.
              panel(output.details,edge,side,sill+.14,.63,.41,.24,.125,'#c8cac1');
              graphic('ac',edge,side,sill+.14,.61,.39,.252);
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
        const cart=theme.style==='cart',shelter=theme.awning?(cart?.87:.72):0;
        const {canopyY,signY:boardY,signOffset}=fasciaSign(ceiling,topY,shelter);
        const doorWidth=theme.style==='cart'?w*.82:w;
        const bayCount=theme.style==='ice'?3:1;
        for(let j=0;j<bayCount;j++){
          const bay=doorWidth/bayCount, centre=a-doorWidth*.5+bay*(j+.5);
          graphic(keyForShop(shop,'front'),edge,centre,base+h/2,bay-.07,h,recess+.052,undefined,output.distant);
          if(theme.style==='ice')panel(output.details,edge,centre-bay/2+.10,base+h*.51,.26,h,.17,recess+.13,theme.trim);
        }
        panel(output.details,edge,a,base+h+.05,doorWidth+.08,.16,.15,recess+.075,theme.trim);
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
          slopedAwning(output.details,edge,a,canopyY-.08,w*.97,shelter,theme.awning);
        }
        const sign=keyForShop(shop),side=keyForShop(shop,'blade');
        if(theme.form==='curtain'){
          graphic(sign,edge,a,base+h-.30,w*.96,.62,recess+.14,undefined,output.distant);
          panel(output.details,edge,a,base+h+.02,w*.98,.055,.08,recess+.13,'#4d3828');
        }else if(theme.form==='cart'){
          graphic(sign,edge,a+w*.04,base+.53,w*.50,.41,recess+.479,undefined,output.distant);
        }else if(theme.form==='placard'){
          const width=Math.min(w*(cart?.57:.76),3.4),sH=.56,y=cart?base+1.61:boardY+.04;
          const sOff=cart?recess+.48:Math.max(signOffset,shelter*.68);
          graphic(sign,edge,a-w*(cart?.16:.06),y,width,sH,sOff,undefined,output.distant);
          if(!cart){
            const fit=fitSign(boards.get(sign)!,width,sH);
            panel(output.details,edge,a-w*.06,y,fit.width+.05,fit.height+.05,.10,sOff-.055,theme.trim);
          }
        }else{
          const maxW=w*(theme.form==='banner'?.95:.90),maxH=theme.form==='banner'?.78:.64;
          const sOff=Math.max(signOffset,shelter*.72);
          const sY=boardY+(theme.awning?.05:0);
          graphic(sign,edge,a,sY,maxW,maxH,sOff,undefined,output.distant);
          const fit=fitSign(boards.get(sign)!,maxW,maxH);
          panel(output.details,edge,a,sY,fit.width+.06,fit.height+.06,.11,sOff-.06,theme.trim);
        }
        if(shop.id==='my-warm-day'){
          const remaining=a-w/2;
          if(remaining>2.25)for(const t of [.27,.73]){
            graphic(keyForShop(shop,'front'),edge,remaining*t,base+h/2,remaining*.42,h,recess+.057,undefined,output.distant);
          }
        }
        if(theme.form==='blade'||theme.form==='placard'||theme.form==='curtain'){
          const yaw=Math.atan2(edge.normal[0],edge.normal[1])+Math.PI/2;
          const sideDir=Math.sign(Math.sin(yaw)*edge.tangent[0]+Math.cos(yaw)*edge.tangent[1])||1;
          const blade=theme.form==='blade',curtain=theme.form==='curtain';
          const centre=a-w*.47,y=blade?boardY+.42:curtain?boardY+.22:base+1.52;
          const bladeWidth=curtain?.88:blade?.64:.48,bladeHeight=curtain?.42:blade?1.30:1.08;
          const offset=Math.max(shelter,.55)+bladeWidth/2+.05;
          // Place each blade face on the outward side matching its front normal (works for both CW & CCW polygons).
          graphic(side,edge,centre+sideDir*.048,y,bladeWidth,bladeHeight,offset,yaw);
          graphic(side,edge,centre-sideDir*.048,y,bladeWidth,bladeHeight,offset,yaw+Math.PI);
          panel(output.details,edge,centre,y,.084,bladeHeight+.04,bladeWidth+.04,offset,'#384042');
          for(const dy of [-bladeHeight*.32,bladeHeight*.32]){
            addBeam(output.details,at(edge,centre,.03,y+dy),at(edge,centre,offset-bladeWidth*.48,y+dy),.038,.038,new T.Color('#424a4c'));
          }
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
        const maxInward=Math.max(...building.polygon.map(([px,pz])=>-(px-street.a[0])*street.normal[0]-(pz-street.a[1])*street.normal[1]));
        const contained=(cx:number,cz:number,rx:number,rz:number)=>[[-1,-1],[-1,1],[1,-1],[1,1]].every(([sa,sb])=>{
          const u=sa*rx,v=sb*rz;
          const p:Point2=[cx+street.tangent[0]*u+street.normal[0]*v,cz+street.tangent[1]*u+street.normal[1]*v];
          return inPolygon(p,building.polygon)&&!building.holes?.some(h=>inPolygon(p,h));
        });
        // Street-visible sheet-metal rooftop addition (鐵皮加蓋斜棚) set closer to the front parapet.
        const shedSetback=Math.min(2.15,Math.max(1.25,maxInward*.34));
        const [sx,sz]=around(street,street.length*.5,-shedSetback);
        const shedW=Math.min(street.length*.80,4.3),shedD=Math.min(2.5,maxInward*.46);
        if(seed%5<2&&shedW>2.1&&shedD>1.5&&contained(sx,sz,shedW*.5+.12,shedD*.5+.12)){
          const tint=paint(metalRoofs[Math.floor(seed/5)%metalRoofs.length]),rise=1.82+(seed%4)*.15;
          output.details.push(leanToRoof(sx,topY,sz,shedW,shedD,rise,street.yaw,tint));
        }
        // Cylindrical stainless-steel rooftop water tower (不鏽鋼水塔 + 腳架) visible above skyline.
        const tankAlong=street.length*(seed%2===0?.24:.76);
        const tankBack=Math.min(maxInward*.68,Math.max(1.4,shedSetback+(seed%5<2?1.55:.2)));
        const [tx,tz]=around(street,tankAlong,-tankBack);
        if(seed%5>=1&&seed%5<=3&&contained(tx,tz,.62,.62)){
          const tankH=1.52+(seed%3)*.14,legH=.36;
          addCuboid(output.details,tx,topY+legH/2,tz,.72,legH,.72,0,'#545b5c');
          addCuboid(output.details,tx,topY+legH+tankH/2,tz,1.06,tankH,1.06,0,'#bcc6c8',tankShape);
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

const arterialSidewalks = new Set(['臨海一路','臨海二路','鼓山一路','濱海一路','濱海二路']);
const gutterStreets = new Set(['麗雄街','鼓元街','鼓波街','延平街','哨船街','登山街','長安街','鼓南街','捷興二街','千光路']);
const scooterBoxStreets = new Set(['臨海二路','鼓山一路','濱海一路','濱海二路','麗雄街','鼓元街','鼓波街']);

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
  const uniforms={uHamasenMask:{value:texture},uHamasenBounds:{value:new T.Vector4(bounds.min.x,bounds.min.y,width*cell,height*cell)},uHamasenConcrete:{value:new T.Color('#aba69d')}};
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
          float wear=.87+.15*gNoise(p/4.2)+.08*gNoise(p/.42);
          vec2 slab=abs(fract(p/2.4-.5)-.5);
          vec2 brick=abs(fract(p/.60-.5)-.5);
          float joint=.075*(1.-smoothstep(.004,.022,min(slab.x,slab.y)))*near
            +.028*(1.-smoothstep(.01,.05,min(brick.x,brick.y)))*near;
          vec3 alleyTone=mix(uHamasenConcrete,vec3(.63,.60,.56),smoothstep(.2,.8,gNoise(p/7.5)));
          g=mix(g,alleyTone*(wear-joint),urban);
        }
        diffuseColor.rgb *= g * uLawnTint;`);
  };
  material.customProgramCacheKey=()=>key()+'-hamasen-paving-v2';
}

function lineHit(a:Point2,b:Point2,c:Point2,d:Point2):Point2|undefined{
  const rx=b[0]-a[0],rz=b[1]-a[1],sx=d[0]-c[0],sz=d[1]-c[1],den=rx*sz-rz*sx;
  if(Math.abs(den)<1e-8)return undefined;
  const t=((c[0]-a[0])*sz-(c[1]-a[1])*sx)/den,u=((c[0]-a[0])*rz-(c[1]-a[1])*rx)/den;
  if(t<-.02||t>1.02||u<-.02||u>1.02)return undefined;
  return [a[0]+rx*t,a[1]+rz*t];
}

/** Same draped terrain as the road surface, with hierarchical sidewalks/gutters, grates, markings and quay details. */
export function hamasenStreetGround(context:HamasenContext, roads:readonly ContextRoad[], terrain:Terrain):T.Group {
  const group=new T.Group();group.name='Hamasen street ground';group.userData.terrainSeated=true;
  const area=context.polygon,shore=context.ferryVisualGround;
  const paving=(context.ground??[]).filter(surface=>surface.kind==='paving');
  const urban=(x:number,z:number)=>inPolygon([x,z],area)||!!shore&&inPolygon([x,z],shore)
    ||paving.some(surface=>inPolygon([x,z],surface.polygon));
  const xs=area.map(p=>p[0]),zs=area.map(p=>p[1]);
  const bounds:[number,number,number,number]=[Math.min(...xs),Math.min(...zs),Math.max(...xs),shore?Math.max(...shore.map(p=>p[1])):Math.max(...zs)];
  const built:T.BufferGeometry[]=[];
  const threeD:T.BufferGeometry[]=[];
  const glow3D:T.BufferGeometry[]=[];
  const unitCyl=new T.CylinderGeometry(.5,.5,1,8);
  const addBox3D=(x:number,y:number,z:number,w:number,h:number,d:number,yaw:number,color:string,shape:T.BufferGeometry=box,target=threeD)=>{
    const m=new T.Matrix4().compose(new T.Vector3(x,y,z),new T.Quaternion().setFromAxisAngle(new T.Vector3(0,1,0),yaw),new T.Vector3(w,h,d));
    target.push(batchGeometry(shape,m,new T.Color(color)));
  };
  if(context.ferryLand){
    // The surveyed quay continues beyond the DTM's last row.
    const shape=new T.Shape(context.ferryLand.map(([x,z])=>new T.Vector2(x,-z)));
    const geometry=new T.ShapeGeometry(shape).rotateX(-Math.PI/2).translate(0,terrain.seaLevel+.08,0);
    built.push(batchGeometry(geometry,new T.Matrix4(),new T.Color('#aba79e')));
    geometry.dispose();
  }
  if(context.ferryHarbor){
    // Complete concrete seawall face, quay coping, waterfront safety railing, mooring bollards and fenders
    // along all land-facing banks of Gushan 1st Canal (一號船渠, extending from the ferry pier north to the east portal).
    const ring=context.ferryHarbor;
    const sides:T.Vector3[][]=[];
    const water=terrain.seaLevel-.15;
    for(let i=0;i<ring.length;i++){
      const [x0,z0]=ring[i],[x1,z1]=ring[(i+1)%ring.length];
      // Skip open southern harbor mouth (z >= 746) and off-map west edge.
      if(Math.min(z0,z1)>=746||(z0>=746&&z1>=746)||Math.max(x0,x1)<282)continue;
      const segLen=Math.hypot(x1-x0,z1-z0);
      if(segLen<1)continue;
      const steps=Math.max(1,Math.ceil(segLen/terrain.meta.cell));
      const nx=(z1-z0)/segLen,nz=-(x1-x0)/segLen;
      const midX=(x0+x1)/2,midZ=(z0+z1)/2;
      const landSign=inPolygon([midX+nx*.6,midZ+nz*.6],ring)?-1:1;
      const lx=nx*landSign,lz=nz*landSign;
      const top=(t:number)=>{
        const px=T.MathUtils.lerp(x0,x1,t)+lx*.04,pz=T.MathUtils.lerp(z0,z1,t)+lz*.04;
        return new T.Vector3(px,Math.max(water+.24,terrain.heightAt(px,pz)+.02),pz);
      };
      for(let k=0;k<steps;k++){
        const a=top(k/steps),b=top((k+1)/steps);
        const loA=new T.Vector3(a.x,water,a.z),loB=new T.Vector3(b.x,water,b.z);
        sides.push([loA,loB,a],[loB,b,a],[a,loB,loA],[a,b,loB]);
      }
      const yaw=-Math.atan2(z1-z0,x1-x0);
      for(let d=4;d<segLen-3;d+=14){
        const t=d/segLen,px=T.MathUtils.lerp(x0,x1,t),pz=T.MathUtils.lerp(z0,z1,t);
        const gy=Math.max(terrain.seaLevel+.12,terrain.heightAt(px+lx*.42,pz+lz*.42));
        addBox3D(px+lx*.40,gy+.22,pz+lz*.40,.24,.44,.24,yaw,'#3a3e40',unitCyl);
        addBox3D(px-lx*.08,gy-.22,pz-lz*.08,1.15,.32,.18,yaw,'#26282a');
      }
      // Concrete quay coping + waterfront promenade handrail along canal banks (north of ferry slipway).
      const mx=midX+lx*.20,mz=midZ+lz*.20;
      const my=Math.max(terrain.seaLevel+.12,terrain.heightAt(mx,mz));
      addBox3D(mx,my+.06,mz,segLen,.12,.36,yaw,'#c7c3b8');
      if(Math.min(z0,z1)<743&&segLen>4){
        addBox3D(mx+lx*.14,my+.96,mz+lz*.14,segLen,.06,.06,yaw,'#556062');
        addBox3D(mx+lx*.14,my+.52,mz+lz*.14,segLen,.04,.04,yaw,'#6c7678');
        for(let d=1;d<segLen-1;d+=6){
          const t=d/segLen,px=T.MathUtils.lerp(x0,x1,t)+lx*.34,pz=T.MathUtils.lerp(z0,z1,t)+lz*.34;
          const py=Math.max(terrain.seaLevel+.12,terrain.heightAt(px,pz));
          addBox3D(px,py+.50,pz,.06,.96,.06,yaw,'#556062');
        }
        // Waterfront promenade lamp posts along the east bank of Gushan 1st Canal.
        if(lx>.35&&segLen>12){
          for(let d=8;d<segLen-6;d+=20){
            const t=d/segLen,px=T.MathUtils.lerp(x0,x1,t)+lx*.55,pz=T.MathUtils.lerp(z0,z1,t)+lz*.55;
            const py=Math.max(terrain.seaLevel+.12,terrain.heightAt(px,pz));
            addBox3D(px,py+2.15,pz,.12,4.3,.12,yaw,'#4c5659',unitCyl);
            addBox3D(px,py+4.36,pz,.34,.38,.34,yaw,'#3a4245',unitCyl);
            addBox3D(px,py+4.36,pz,.36,.26,.36,yaw,'#ffd892',unitCyl,glow3D);
          }
        }
      }
    }
    // South ferry promenade safety railing (visual companion to the PLAY_BOUNDS[3] south guardrail).
    const southY=Math.max(terrain.seaLevel+.14,terrain.heightAt(368,743.4));
    addBox3D(369.5,southY+.96,743.4,41,.06,.06,0,'#556062');
    addBox3D(369.5,southY+.52,743.4,41,.04,.04,0,'#6c7678');
    for(let px=350;px<=390;px+=6)addBox3D(px,southY+.50,743.4,.06,.96,.06,0,'#556062');
    const geometry=geometryFromTriangles(sides);
    if(geometry.attributes.position.count)built.push(batchGeometry(geometry,new T.Matrix4(),new T.Color('#928f86')));
    geometry.dispose();
  }
  // Daitian Temple forecourt (代天宮廟埕) warm red/amber perimeter lantern posts so the plaza glows at night.
  const templePoles:[number,number][]=[[462,448],[478,438],[496,434],[508,450],[498,468],[474,470],[458,462]];
  for(let i=0;i<templePoles.length;i++){
    const [px,pz]=templePoles[i],py=terrain.heightAt(px,pz);
    addBox3D(px,py+2.4,pz,.12,4.8,.12,0,'#5a342e',unitCyl);
    addBox3D(px,py+4.92,pz,.38,.44,.38,0,'#f26a48',unitCyl,glow3D);
    // Warm lantern string between perimeter poles flanking the forecourt.
    if(i<templePoles.length-1){
      const [qx,qz]=templePoles[i+1],dist=Math.hypot(qx-px,qz-pz);
      if(dist<26){
        const count=Math.max(3,Math.round(dist/3.6));
        for(let k=1;k<count;k++){
          const t=k/count,lx=T.MathUtils.lerp(px,qx,t),lz=T.MathUtils.lerp(pz,qz,t);
          const sag=Math.sin(t*Math.PI)*.42,ly=terrain.heightAt(lx,lz)+4.65-sag;
          addBox3D(lx,ly,lz,.26,.32,.26,0,k%2?'#ff8652':'#ffd076',unitCyl,glow3D);
        }
      }
    }
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
  const roadFootprints=roads.filter(r=>r.district==='hamasen'&&!r.tunnel&&!r.bridge).flatMap(road=>{
    const ribbon=roadRibbon(road.points,road.width);
    const tris=geometryFootprints(ribbon);ribbon.dispose();return tris;
  });
  const cutRoad=surfaceCutters(roadFootprints);
  for(const surface of context.ground??[]){
    if(surface.kind==='grass')continue;
    const shape=new T.Shape(surface.polygon.map(([x,z])=>new T.Vector2(x,-z)));
    add(new T.ShapeGeometry(shape).rotateX(-Math.PI/2),.004,surface.kind==='parking'?'#535654':surface.kind==='yard'?'#b5a692':'#b4b1a9');
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
  const sidewalk=(line:Point2[],width:number,tint:string,raise=.019)=>{
    const ribbon=roadRibbon(line,width);
    const footprint=surfaceCutters(geometryFootprints(ribbon));
    add(ribbon,raise,tint,[...cutRoad,...occupiedSidewalk]);
    occupiedSidewalk.push(...footprint);
  };
  const grateBoxes:T.BufferGeometry[]=[];
  for(const road of carriageways){
    const surveyed=!!road.sidewalk&&!['no','separate','none'].includes(road.sidewalk);
    const arterial=surveyed||arterialSidewalks.has(road.name??'');
    const gutter=!arterial&&(gutterStreets.has(road.name??'')||road.kind==='service'||road.kind==='living_street');
    if(!arterial&&!gutter)continue;
    const sides=road.sidewalk==='left'?[-1]:road.sidewalk==='right'?[1]:[-1,1];
    for(const line of clippedRoadPaths(road.points,bounds))for(const side of sides){
      if(arterial){
        // Raised-look light concrete curb + jointed arterial sidewalk.
        sidewalk(offset(line,side*(road.width/2+.11)),.20,'#d7d2c7',.020);
        sidewalk(offset(line,side*(road.width/2+.82)),1.22,'#beb9af',.018);
      }else{
        // Taiwanese old-town lane: flush concrete roadside gutter apron + cast-iron drainage grates (水溝蓋).
        sidewalk(offset(line,side*(road.width/2+.20)),.38,'#9d9a92',.016);
        for(let sIdx=1;sIdx<line.length;sIdx++){
          const [ax,az]=line[sIdx-1],[bx,bz]=line[sIdx],segL=Math.hypot(bx-ax,bz-az);
          if(segL<3)continue;
          const tx=(bx-ax)/segL,tz=(bz-az)/segL,nx=-tz*side,nz=tx*side;
          for(let d=2.2;d<segL-1.8;d+=4.2){
            const gx=ax+tx*d+nx*(road.width/2+.20),gz=az+tz*d+nz*(road.width/2+.20);
            if(!urban(gx,gz))continue;
            const gRibbon=roadRibbon([[gx-tx*.28,gz-tz*.28],[gx+tx*.28,gz+tz*.28]],.26);
            const gSurf=projectRoadGeometry(gRibbon,terrain,{offset:.019,cutters:cutRoad});
            if(gSurf.getAttribute('position').count)grateBoxes.push(batchGeometry(gSurf,new T.Matrix4(),new T.Color('#3d4345')));
            gRibbon.dispose();gSurf.dispose();
          }
        }
      }
    }
  }
  built.push(...grateBoxes);

  // Intersection stop lines (停止線), red corner no-parking lines (紅線), yellow curb lines & scooter parking boxes (機車格).
  const junctions:Point2[]=[];
  const namedVeh=carriageways.filter(r=>r.width>=4.8&&!r.visualOnly);
  for(let i=0;i<namedVeh.length;i++)for(let j=i+1;j<namedVeh.length;j++){
    const rA=namedVeh[i],rB=namedVeh[j];
    if(rA.name&&rA.name===rB.name)continue;
    for(let a=1;a<rA.points.length;a++)for(let b=1;b<rB.points.length;b++){
      const hit=lineHit(rA.points[a-1],rA.points[a],rB.points[b-1],rB.points[b]);
      if(!hit||!inPolygon(hit,area)||Math.hypot(hit[0]-309.93,hit[1]-236.77)<14)continue;
      if(junctions.some(q=>Math.hypot(q[0]-hit[0],q[1]-hit[1])<12))continue;
      junctions.push(hit);
      for(const [rd,segIdx,otherW] of [[rA,a,rB.width],[rB,b,rA.width]] as const){
        if(rd.width<5.5)continue;
        const p0=rd.points[segIdx-1],p1=rd.points[segIdx],segL=Math.hypot(p1[0]-p0[0],p1[1]-p0[1]);
        if(segL<4)continue;
        const ux=(p1[0]-p0[0])/segL,uz=(p1[1]-p0[1])/segL,nx=-uz,nz=ux;
        const distAlong=(hit[0]-p0[0])*ux+(hit[1]-p0[1])*uz;
        for(const dir of [-1,1]){
          const stopAt=distAlong+dir*(otherW/2+1.9);
          if(stopAt<1.2||stopAt>segL-1.2)continue;
          const sx=p0[0]+ux*stopAt,sz=p0[1]+uz*stopAt;
          const half=rd.width*.44;
          // Stop line across the approaching half of the carriageway.
          const s0:Point2=dir<0?[sx+nx*.12,sz+nz*.12]:[sx-nx*half,sz-nz*half];
          const s1:Point2=dir<0?[sx+nx*half,sz+nz*half]:[sx-nx*.12,sz-nz*.12];
          project([s0,s1],.32,.017,'#eae5d8');
          // Red no-parking curb lines (禁止臨時停車紅線) flanking the junction approach.
          const rEnd=Math.max(.5,Math.min(segL-.5,stopAt+dir*5.2));
          for(const cSide of [-1,1]){
            const edgeOff=cSide*(rd.width/2-.16);
            project([[sx+nx*edgeOff,sz+nz*edgeOff],[p0[0]+ux*rEnd+nx*edgeOff,p0[1]+uz*rEnd+nz*edgeOff]],.11,.017,'#b54540');
          }
        }
      }
    }
  }
  // White scooter parking boxes (機車停車格) & commercial yellow lines along kerbside blocks.
  for(const road of namedVeh){
    if(!scooterBoxStreets.has(road.name??''))continue;
    const wide=road.width>=7.5;
    const boxDepth=wide?1.55:.78,boxStep=wide?.86:1.90;
    const innerOff=road.width/2-.28,outerOff=innerOff-boxDepth;
    for(let sIdx=1;sIdx<road.points.length;sIdx++){
      const [ax,az]=road.points[sIdx-1],[bx,bz]=road.points[sIdx],segL=Math.hypot(bx-ax,bz-az);
      if(segL<14)continue;
      const tx=(bx-ax)/segL,tz=(bz-az)/segL,nx=-tz,nz=tx;
      for(const side of [-1,1]){
        let runStart:Point2|undefined,runEnd:Point2|undefined,slots=0;
        for(let d=6.5;d<segL-6.5;d+=boxStep){
          const cx=ax+tx*d,cz=az+tz*d;
          if(junctions.some(j=>Math.hypot(j[0]-cx,j[1]-cz)<8.5))continue;
          const blockIdx=Math.floor(d/9);
          if((blockIdx+sIdx+(side>0?1:0))%3===0){
            if(slots>=3&&runStart&&runEnd)project([runStart,runEnd],.08,.016,'#e6e2d6');
            runStart=undefined;runEnd=undefined;slots=0;
            continue;
          }
          const pIn:Point2=[cx+nx*side*innerOff,cz+nz*side*innerOff];
          const pOut:Point2=[cx+nx*side*outerOff,cz+nz*side*outerOff];
          if(!inPolygon(pIn,area))continue;
          project([pIn,pOut],.075,.016,'#e6e2d6');
          if(!runStart)runStart=pOut;
          runEnd=pOut;slots++;
        }
        if(slots>=3&&runStart&&runEnd)project([runStart,runEnd],.08,.016,'#e6e2d6');
        // Yellow curb line on mid-block segments opposite scooter bays.
        if(segL>22&&(sIdx+(side>0?1:0))%3===0){
          const y0=Math.min(segL-7,8),y1=Math.max(y0+4,Math.min(segL-8,20));
          const off=side*(road.width/2-.16);
          const aPt:Point2=[ax+tx*y0+nx*off,az+tz*y0+nz*off],bPt:Point2=[ax+tx*y1+nx*off,az+tz*y1+nz*off];
          if(!junctions.some(j=>Math.hypot(j[0]-aPt[0],j[1]-aPt[1])<8))project([aPt,bPt],.10,.016,'#cfa23a');
        }
      }
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
      project([at(5.4,across),at(8.6,across)],.54,.020,'#e8e3d6');
    }
    project([at(4.55,-half),at(4.55,-.18)],.24,.020,'#e8e3d6');
    project([at(9.45,.18),at(9.45,half)],.24,.020,'#e8e3d6');
    for(const side of [-1,1])project([at(2.1,side*half),at(14,side*half)],.13,.020,'#ae4844');
  }
  for(const rail of context.rails??[]){
    if(rail.kind==='subway')continue;
    for(const line of clippedRoadPaths(rail.points,bounds)){
      project(line,2.0,.002,'#88867b');
      const halfGauge=rail.kind==='light_rail'?.7175:.5335;
      project(offset(line,-halfGauge),.095,.018,'#4a5355');project(offset(line,halfGauge),.095,.018,'#4a5355');
    }
  }
  unitCyl.dispose();
  if(built.length){
    const geometry=mergeGeometries(built,false);built.forEach(g=>g.dispose());
    if(geometry){
      const material=new T.MeshStandardMaterial({vertexColors:true,roughness:.92,
        polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-2});
      const mesh=new T.Mesh(geometry,material);mesh.name='Hamasen sidewalks, markings and rails';mesh.receiveShadow=true;group.add(mesh);
    }
  }
  if(threeD.length){
    const geometry=mergeGeometries(threeD,false);threeD.forEach(g=>g.dispose());
    if(geometry){
      const mesh=new T.Mesh(geometry,new T.MeshStandardMaterial({vertexColors:true,roughness:.86}));
      mesh.name='Hamasen quay bollards, fenders and coping';mesh.castShadow=true;mesh.receiveShadow=true;group.add(mesh);
    }
  }
  if(glow3D.length){
    const geometry=mergeGeometries(glow3D,false);glow3D.forEach(g=>g.dispose());
    if(geometry){
      const glowMat=new T.MeshStandardMaterial({vertexColors:true,emissive:'#ffba6b',emissiveIntensity:0,roughness:.45});
      NIGHT_MATERIALS.add(glowMat);
      const mesh=new T.Mesh(geometry,glowMat);
      mesh.name='Hamasen plaza lanterns and canal lamps';group.add(mesh);
    }
  }
  return group;
}

/** Photo-checked ribs, stone retaining wing-walls and tiled threshold at the east portal. */
export function hamasenPortalCanopy(profile:TunnelProfile,terrain:Terrain) {
  const group=new T.Group();group.name='Hamasen east portal canopy';group.userData.terrainSeated=true;
  const tangent=profile.sections.at(-1)!.tangent,side=profile.sections.at(-1)!.right;
  const at=(along:number,across:number,y:number)=>profile.east.clone().addScaledVector(tangent,along).addScaledVector(side,across).setY(y);
  const parts:T.BufferGeometry[]=[];
  const ribColor=new T.Color('#ded7c9'),brass=new T.Color('#a88d58');
  const yaw=-Math.atan2(tangent.z,tangent.x);
  const beam=(a:T.Vector3,b:T.Vector3,width:number,depth:number,tint:T.Color)=>{
    const geometry=beamGeometry(a,b,width,depth,tint);
    if(geometry)parts.push(geometry);
  };
  // Subtle stone masonry flank piers and upper greenery neatly framing the east portal edges without protruding onto the arch face.
  for(const direction of [-1,1]){
    const pBase=at(.55,direction*4.45,0),gy=terrain.heightAt(pBase.x,pBase.z);
    const m=new T.Matrix4().compose(at(.55,direction*4.45,gy+2.25),new T.Quaternion().setFromAxisAngle(new T.Vector3(0,1,0),yaw),new T.Vector3(1.1,4.6,.95));
    parts.push(batchGeometry(box,m,new T.Color('#d2cdc2')));
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
    // Frosted skylight purlins along upper pergola arch.
    for(let r=1;r<ribs.length;r++){
      for(const t of [.68,.84,.98]){
        const pA=ribs[r-1].getPoint(t),pB=ribs[r].getPoint(t);
        beam(pA,pB,.06,.38,new T.Color('#e5e3da'));
      }
    }
    for(const height of [.12,.23,.34,.45,.56,.67,.77]){
      const rail=ribs.map(rib=>rib.getPoint(height).addScaledVector(side,direction*.12));
      for(let i=1;i<rail.length;i++)beam(rail[i-1],rail[i],.045,.045,brass);
    }
  }
  const shrub=new T.DodecahedronGeometry(1,1),shrubColors=['#5d744f','#6a7f52','#4c6747','#738859'];
  for(const direction of [-1,1])for(let i=0;i<6;i++){
    const distance=1.9+i*2.2,base=at(distance,direction*4.15,0);
    base.y=terrain.heightAt(base.x,base.z);
    const pad=new T.Matrix4().compose(base.clone().setY(base.y+.20),new T.Quaternion().setFromAxisAngle(new T.Vector3(0,1,0),yaw),new T.Vector3(1.95,.42,.72));
    parts.push(batchGeometry(box,pad,new T.Color('#9f9b92')));
    for(const [along,acrossOff,sy,sc] of [[-.52,0,.58,.46],[.12,.08,.66,.52],[.58,-.05,.55,.43]] as const){
      const center=base.clone().addScaledVector(tangent,along).addScaledVector(side,direction*acrossOff).setY(base.y+sy);
      const transform=new T.Matrix4().compose(center,new T.Quaternion(),new T.Vector3(sc*1.1,sc*.88,sc));
      parts.push(batchGeometry(shrub,transform,new T.Color(shrubColors[(i+(along>.1?1:0))%shrubColors.length])));
    }
    // Hillside slope greenery clusters above retaining wing-walls.
    if(i<4){
      const hill=at(.8+i*1.6,direction*(5.2+i*.35),0);
      hill.y=terrain.heightAt(hill.x,hill.z)+.65;
      const hm=new T.Matrix4().compose(hill,new T.Quaternion(),new T.Vector3(1.25,.95,1.15));
      parts.push(batchGeometry(shrub,hm,new T.Color(shrubColors[(i+2)%shrubColors.length])));
    }
  }
  shrub.dispose();
  const pavement=(points:T.Vector3[],width:number,raise:number,tint:string)=>{
    const source=roadRibbon(points.map(p=>[p.x,p.z]),width);
    const projected=projectRoadGeometry(source,terrain,{offset:raise});
    if(projected.getAttribute('position').count)parts.push(batchGeometry(projected,new T.Matrix4(),new T.Color(tint)));
    source.dispose();projected.dispose();
  };
  pavement([at(.8,0,0),at(15.6,0,0)],7.85,.014,'#b6b3aa');
  for(const along of [3.2,6.7,10.2,13.7])pavement([at(along,-3.7,0),at(along,3.7,0)],.53,.016,'#989691');
  pavement([at(1.2,0,0),at(7.6,-.26,0),at(15.2,-1.1,0)],.46,.018,'#d8d4c8');
  pavement([at(1.2,0,0),at(7.6,-.26,0),at(15.2,-1.1,0)],.28,.019,'#3c768a');
  const geometry=mergeGeometries(parts,false);parts.forEach(p=>p.dispose());
  if(geometry){const mesh=new T.Mesh(geometry,new T.MeshStandardMaterial({vertexColors:true,roughness:.90}));mesh.receiveShadow=true;group.add(mesh);}
  return group;
}
