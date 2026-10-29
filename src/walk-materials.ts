/** Shared display palette, surface roles and procedural textures (docs/reference/art-direction.md).
 * Display-only: walk-world colours stay as stable surface ids so collision/navmesh never change. */
import * as T from 'three';

export const PALETTE = {
 brickLight:'#cf6a55', brickDark:'#a84a3b', mortar:'#e8d2c4', cream:'#f1e8d6', wallCream:'#efe4cf',
 roofDark:'#8d5a4c', roofDeck:'#c9c1b1', roofEquip:'#b8bdb9', glassDay:'#7fb3c4', glassNight:'#ffd37a', frame:'#3e4a50',
 grassA:'#8fcf66', grassB:'#86c860', grassC:'#a9d46e', asphalt:'#6b7380', mark:'#f6f3ea', markYellow:'#f2c23b',
 walk:'#e9e1cf', walkSeam:'#d6cbb6', plaza:'#dcd0b8', sand:'#f0dcb0', seaShallow:'#5fc3cf', seaDeep:'#2c7f91',
 hillNear:'#5f9e4f', hillMid:'#3f7a3c', hillFar:'#6f9f7f', trees:['#6fbf4f','#58a845','#8fcc5a','#3f8f4c'], trunk:'#8a6243',
 palmLeaf:'#4f9d4a', palmTrunk:'#a08664', interiorWall:'#f4ede0', interiorFloor:'#e3dccd', ceiling:'#f6efe0',
} as const;

/** Faculty colour bands: `band` on brick, `ui` on dark label pills. */
export const FACULTY:Record<string,{band:string;ui:string;name:string}> = {
 science:{band:'#2a8c99',ui:'#62d0dc',name:'理學院'}, engineering:{band:'#2f5fa8',ui:'#7fa8ea',name:'工學院'},
 management:{band:'#d9a521',ui:'#f2c94c',name:'管理學院'}, social:{band:'#7b4a8f',ui:'#c08ad8',name:'社會科學院'},
 admin:{band:'#3d7a4a',ui:'#7ccf8a',name:'行政／校級'}, marine:{band:'#2c7f91',ui:'#8fd4e0',name:'海洋／其他'},
};
export const BUILDING_FACULTY:Record<string,keyof typeof FACULTY> = {
 SC:'science',CH:'science',PH:'science',BI:'science',EN:'engineering',EC:'engineering',MS:'engineering',EV:'engineering',
 CMSS:'management',AD:'admin',IL:'admin',YH:'admin',SPORT:'admin',ACTIVITY:'admin',IR:'marine',ME:'marine',MA:'marine',MB:'marine',
 BEACH:'marine',GALLERY:'admin',KINDER:'admin',STARTUP:'admin',FA:'admin',
};

export type Surface='wall'|'trim'|'floor'|'wood'|'stone'|'door'|'glass'|'ground'|'sea'|'road'|'paving'|'cutawayCeiling'|'roof'|'rail'|'stair'|'column'|'context';
/** The single source of truth for walk-world material ids (hex) -> display role. */
const SURFACE_BY_HEX:Record<string,Surface> = {
 ddd4c0:'wall', bca98c:'trim', b8a88f:'trim', d7d1c2:'floor', d2c4ab:'wood', c3cfc9:'stone', d1c7b5:'floor',
 '9d7352':'door', ad9975:'door', a3937c:'door', '6c8e91':'glass', '647f7f':'glass',
 '8b9d79':'ground', '629caa':'sea', b7b7a8:'road', cfc4ae:'paving', c6bca5:'paving',
 e6e1d4:'cutawayCeiling', a27e68:'roof', '7c8b7b':'rail', '6e7e74':'rail', '718176':'rail', '6f7f75':'rail',
 cfc6b2:'stair', c7bba3:'stair', b8a68c:'stair', c5b8a0:'stair', d3c9b6:'stair', bcb7a6:'paving', a58d74:'roof', a99f8c:'wall',
};
export function surfaceOf(material:T.Material|T.Material[]):Surface|undefined{
 if(Array.isArray(material)||!(material instanceof T.MeshStandardMaterial))return undefined;
 return (material.userData.surface as Surface|undefined)??SURFACE_BY_HEX[material.color.getHexString()];
}

const rng=(seed:number)=>()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
// sRGB bytes straight from hex: textures are tagged SRGBColorSpace, so never write linear T.Color values.
const rgb=(hex:string)=>{const v=parseInt(hex.slice(1),16);return [(v>>16)&255,(v>>8)&255,v&255];};
function dataTexture(size:number,paint:(x:number,y:number)=>[number,number,number],srgb=true){
 const data=new Uint8Array(size*size*4);
 for(let y=0;y<size;y++)for(let x=0;x<size;x++){const [r,g,b]=paint(x,y),i=(y*size+x)*4;data[i]=r;data[i+1]=g;data[i+2]=b;data[i+3]=255;}
 const tex=new T.DataTexture(data,size,size,T.RGBAFormat);tex.wrapS=tex.wrapT=T.RepeatWrapping;tex.magFilter=T.LinearFilter;tex.minFilter=T.LinearMipmapLinearFilter;tex.generateMipmaps=true;tex.anisotropy=4;
 if(srgb)tex.colorSpace=T.SRGBColorSpace;tex.needsUpdate=true;return tex;
}

/** One tile = 2 bays x 2 storeys (6.0 x 7.4 m). v=0 is a floor line (floorY offsets are .08). */
export const FACADE_TILE={w:6,h:7.4};
export function facadeTextures(base:'brick'|'cream'|'arcade'='brick'){
 const S=128,brick=rgb(PALETTE.brickLight),dark=rgb(PALETTE.brickDark),mortar=rgb(PALETTE.mortar).map((v,i)=>(v+rgb(PALETTE.brickLight)[i])/2),cream=rgb(PALETTE.cream),glass=rgb(PALETTE.glassDay),frame=rgb(PALETTE.frame),wallC=rgb(PALETTE.wallCream);
 const rand=rng(base==='brick'?917:313);const jitter=new Float32Array(64*8).map(()=>(rand()-.5)*12);
 // DataTexture rows run bottom->top (row y = v*S). One storey = 64 px = 3.7 m; row 0 is the slab line.
 const windowAt=(x:number,yy:number)=>{const bx=x%64,sy=yy%64;return bx>=13&&bx<51&&sy>=16&&sy<41;}; // 1.8 x 1.45 m window, sill 0.92 m
 // Night windows: hashed per bay, ~55% lit, and roughly a third of storeys fully dark (art-direction-v3 §2).
 const hash=(a:number,b:number)=>{const h=Math.sin(a*127.1+b*311.7)*43758.5453;return h-Math.floor(h);};
 const lit=(x:number,yy:number)=>hash(Math.floor(x/64),Math.floor(yy/64))<2; // every window lit in the map; the toon shader hashes per building/storey/bay
 const shadow=rgb('#5a463c'),deep=rgb(PALETTE.brickDark),paveC=rgb(PALETTE.walk);
 const map=dataTexture(S,(x,y)=>{
  const yy=y,sy=yy%64;
  if(base==='arcade'){const bx=x%32;if(sy>=58)return cream as [number,number,number];if(bx<4||bx>=28)return cream as [number,number,number];
   // Flat-roofed colonnade (photo-checked): through each bay you see the soffit, the inner wall with a glazed
   // door, and the paved floor — never a black void.
   const top=52;if(sy<2)return cream as [number,number,number];if(sy>=top)return deep as [number,number,number];
   if(sy>=top-5)return [cream[0]*.78,cream[1]*.76,cream[2]*.72];                   // soffit in shade
   if(sy<7)return [paveC[0]*.86+(bx%8===0?-12:0),paveC[1]*.86,paveC[2]*.84];      // paving seen under the colonnade
   if(bx>=11&&bx<21&&sy<38)return bx===11||bx===20||sy===37?frame as [number,number,number]:[glass[0]*.62,glass[1]*.7,glass[2]*.74];
   const r=Math.floor(sy/7)%2,xx=(bx+r*4)%8;if(sy%7===0||xx===0)return [shadow[0]*1.25,shadow[1]*1.25,shadow[2]*1.25];
   return [brick[0]*.78,brick[1]*.74,brick[2]*.72];}
  if(sy>=58||sy<3)return cream as [number,number,number];                       // 0.6 m storey band at the slab line
  if(windowAt(x,yy)){const bx=x%64;const edge=bx<15||bx>48||sy<18||sy>38;if(edge)return frame as [number,number,number];const shade=(38-sy)/20;return [glass[0]*(1-shade*.18),glass[1]*(1-shade*.12),glass[2]*(1-shade*.08)];}
  if(sy>=13&&sy<16&&x%64>=11&&x%64<53)return cream as [number,number,number];  // sill
  if(base==='cream'){const n=(rand()-.5)*5;return [wallC[0]+n,wallC[1]+n,wallC[2]+n];}
  const row=Math.floor(sy/7),off=(row%2)*8,xx=(x+off)%16;
  if(sy%7===0||xx===0)return mortar as [number,number,number];
  const j=jitter[(Math.floor((x+off)/16)%64)*8+row%8],c=row%5===0?dark:brick;return [c[0]+j,c[1]+j*.8,c[2]+j*.6];
 });
 const emissive=dataTexture(S,(x,y)=>{if(base==='arcade'){const bx=x%32,sy=y%64;return bx>=4&&bx<28&&sy>2&&sy<40?[90,80,60]:[0,0,0];}if(!windowAt(x,y))return [0,0,0];const bx=x%64,sy=y%64;if(bx<15||bx>48||sy<18||sy>38)return [0,0,0];return lit(x,y)?[255,255,255]:[18,18,18];},false);
 map.name=`Facade ${base}`;emissive.name=`Facade ${base} night windows`;return {map,emissive};
}
export function patternTexture(kind:'grass'|'asphalt'|'paving'|'sand'|'tile'|'plaster'|'wood'|'roof'){
 const S=128,rand=rng(kind.length*7919);
 const pick:Record<string,string>={grass:PALETTE.grassA,asphalt:PALETTE.asphalt,paving:PALETTE.walk,sand:PALETTE.sand,tile:PALETTE.interiorFloor,plaster:PALETTE.interiorWall,wood:'#c79b6d',roof:PALETTE.roofDeck};
 const base=rgb(pick[kind]),alt=rgb(kind==='grass'?PALETTE.grassB:kind==='paving'?PALETTE.walkSeam:pick[kind]);
 const blobs=Array.from({length:18},()=>[rand()*S,rand()*S,8+rand()*22]);
 return dataTexture(S,(x,y)=>{
  const n=(rand()-.5);
  if(kind==='grass'){let m=0;for(const [bx,by,r] of blobs){const d=Math.hypot(((x-bx+S*1.5)%S)-S/2,((y-by+S*1.5)%S)-S/2);m=Math.max(m,1-Math.min(1,Math.max(0,(d-r)/12)));}return [base[0]+(alt[0]-base[0])*m+n*5,base[1]+(alt[1]-base[1])*m+n*6,base[2]+(alt[2]-base[2])*m+n*3];}
  if(kind==='paving'){const seam=x%21===0||y%21===0;const c=seam?alt:base;return [c[0]+n*5,c[1]+n*5,c[2]+n*5];}
  if(kind==='tile'){const seam=x%32===0||y%32===0;return seam?[205,199,186]:[base[0]+n*4,base[1]+n*4,base[2]+n*4];}
  if(kind==='wood'){const v=Math.sin(y*.5+Math.sin(x*.04)*1.2)*8;return [base[0]+v+n*4,base[1]+v*.8+n*4,base[2]+v*.6];}
  if(kind==='roof'){const seam=x%64===0||y%64===0;const g=n*16;return seam?[178,171,158]:[base[0]+g,base[1]+g,base[2]+g];}
  return [base[0]+n*9,base[1]+n*9,base[2]+n*9];
 });
}
/** Box-projected UVs in metres (optionally scaled): walls use horizontal run x/z, floors x,z. */
export function boxUV(geometry:T.BufferGeometry,matrix:T.Matrix4|undefined,tileW:number,tileH:number,yOffset=0){
 const position=geometry.getAttribute('position');if(!geometry.getAttribute('normal'))geometry.computeVertexNormals();const normal=geometry.getAttribute('normal');
 const uv=new Float32Array(position.count*2),p=new T.Vector3(),n=new T.Vector3(),nm=matrix?new T.Matrix3().getNormalMatrix(matrix):undefined;
 for(let i=0;i<position.count;i++){
  p.fromBufferAttribute(position,i);n.fromBufferAttribute(normal,i);if(matrix){p.applyMatrix4(matrix);n.applyMatrix3(nm!).normalize();}
  const ax=Math.abs(n.x),ay=Math.abs(n.y),az=Math.abs(n.z);
  if(ay>=ax&&ay>=az){uv[i*2]=p.x/tileW;uv[i*2+1]=p.z/tileW;}
  else if(ax>az){uv[i*2]=p.z/tileW;uv[i*2+1]=(p.y-yOffset)/tileH;}
  else{uv[i*2]=p.x/tileW;uv[i*2+1]=(p.y-yOffset)/tileH;}
 }
 geometry.setAttribute('uv',new T.BufferAttribute(uv,2));
}
/** Night-capable facade material registry (sky presets drive emissive intensity). */
export const NIGHT_MATERIALS=new Set<T.MeshStandardMaterial>();
export function nightGlow(material:T.MeshStandardMaterial,emissive:T.Texture){material.emissiveMap=emissive;material.emissive.set(PALETTE.glassNight);material.emissiveIntensity=0;NIGHT_MATERIALS.add(material);return material;}

/** Merged extrusions lose geometry groups: regroup triangles into sides (0) and roofs (1) by normal. */
export function splitRoof(geometry:T.BufferGeometry){
 const g=geometry.index?geometry.toNonIndexed():geometry,pos=g.attributes.position,uv=g.attributes.uv,count=pos.count/3,side:number[]=[],top:number[]=[];
 const a=new T.Vector3(),b=new T.Vector3(),c=new T.Vector3();
 for(let t=0;t<count;t++){a.fromBufferAttribute(pos,t*3);b.fromBufferAttribute(pos,t*3+1);c.fromBufferAttribute(pos,t*3+2);const n=b.clone().sub(a).cross(c.clone().sub(a)).normalize();(Math.abs(n.y)>.7?top:side).push(t);}
 const order=[...side,...top],P=new Float32Array(pos.count*3),U=uv?new Float32Array(pos.count*2):undefined;
 order.forEach((t,i)=>{for(let k=0;k<3;k++){const s=t*3+k,d=i*3+k;P[d*3]=pos.getX(s);P[d*3+1]=pos.getY(s);P[d*3+2]=pos.getZ(s);if(U&&uv){U[d*2]=uv.getX(s);U[d*2+1]=uv.getY(s);}}});
 const out=new T.BufferGeometry();out.setAttribute('position',new T.BufferAttribute(P,3));if(U)out.setAttribute('uv',new T.BufferAttribute(U,2));out.computeVertexNormals();
 out.addGroup(0,side.length*3,0);out.addGroup(side.length*3,top.length*3,1);return out;
}

/** Materials whose opacity follows the night glow (additive lamp halos). */
export const NIGHT_FADE=new Map<T.Material,number>();
