/** Display-only furniture models. Collision and navigation use science-interiors.ts envelopes. */
import * as T from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { createCatTeacherPlush } from './cat-teacher-plush';
import type { InteriorItem } from './science-interiors';

const BASE_C = { wood: '#bd9467', edge: '#e3c59e', dark: '#35484c', teal: '#337d80', fabric: '#688e84', cream: '#f4eee1', white: '#ebeee7', paper: '#d9dfce', board: '#294e49', brass: '#c6a15e', blue: '#83bdc7', clay: '#bc7963' };
const materials = new Map<string, T.MeshStandardMaterial>();
const unit = new T.BoxGeometry(1, 1, 1);
function material(color: string, glow = false) {
  const key = color + glow;
  if (!materials.has(key)) materials.set(key, new T.MeshStandardMaterial({ color, roughness: .8, emissive: color, emissiveIntensity: glow ? .65 : .08 }));
  return materials.get(key)!;
}
const rounded = new Map<string,T.BufferGeometry>();
const textureMaterials = new Map<string,T.MeshStandardMaterial>();
const leafGeometry = new T.SphereGeometry(1,8,5);
const cylinderGeometry = new T.CylinderGeometry(1,1,1,12);
/** Small local textures, generated deterministically: no video, network or canvas dependency. */
function patterned(kind:'rug'|'campus'|'art',variant=0) {
  const key=kind+variant;if(textureMaterials.has(key))return textureMaterials.get(key)!;
  const W=128,H=kind==='rug'?128:72,bytes=new Uint8Array(W*H*4);
  const rgb=(hex:string)=>{const n=parseInt(hex.slice(1),16);return [n>>16&255,n>>8&255,n&255];};
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){
    let color='#e6d9bd';
    if(kind==='rug'){
      const edge=Math.min(x,y,W-1-x,H-1-y);
      color=edge<4?'#496e68':edge<8?'#b79b68':edge<12?'#eee3cd':'#d4ccb7';
      if(edge>15&&Math.abs((x+y)%32-16)<2)color='#a3aea0';
      if(edge>15&&Math.abs((x-y+128)%32-16)<1)color='#f0e7d6';
    }else{
      // A stylised campus coast: sunset, hillside and red-brick colonnade.
      color=y<25?'#648e96':'#b8d2cf';
      if(y>24&&y<43+12*Math.sin(x/33+variant))color=['#52776b','#748978','#687f76'][variant%3];
      if((x-98)*(x-98)+(y-56)*(y-56)<49)color='#f1d094';
      if(kind==='campus'&&x>17&&x<100&&y>15&&y<33){
        color=y>29?'#e8d6b9':'#b7765a';
        if(y<27&&y>17&&x%12>3&&x%12<8)color='#38595e';
      }
      if(kind==='art'&&y<25&&((x+y*2+variant*15)%37)<3)color='#d1b780';
    }
    const c=rgb(color),weave=kind==='rug'?((x+y)%2?3:-3):0,i=(y*W+x)*4;
    bytes[i]=Math.max(0,Math.min(255,c[0]+weave));bytes[i+1]=Math.max(0,Math.min(255,c[1]+weave));bytes[i+2]=Math.max(0,Math.min(255,c[2]+weave));bytes[i+3]=255;
  }
  const map=new T.DataTexture(bytes,W,H,T.RGBAFormat);map.colorSpace=T.SRGBColorSpace;map.magFilter=T.LinearFilter;map.minFilter=T.LinearMipmapLinearFilter;map.generateMipmaps=true;map.needsUpdate=true;
  const m=new T.MeshStandardMaterial({map,color:'#ffffff',roughness:kind==='rug'?.98:.75,emissive:'#ffffff',emissiveMap:map,emissiveIntensity:kind==='campus'?.38:.08});
  textureMaterials.set(key,m);return m;
}
/** Furniture remains within its declared footprint. Desk accessories are visual only;
 * the closed solid envelope prevents walking through the table/chair from any side. */
export function furnishScienceItem(item: InteriorItem, parent: T.Group, office = false, luxury = false, variant = 0) {
  const C = luxury ? { ...BASE_C, wood: '#8e684c', edge: '#d0b17b', teal: '#32686b', fabric: '#527d76', brass: '#c5a36b' } : BASE_C;
  const g = new T.Group();g.position.set(item.x, item.y, item.z);g.rotation.y = item.turn * Math.PI / 2;parent.add(g);
  const box = (w: number, h: number, d: number, x: number, y: number, z: number, color: string, glow = false) => { const m = new T.Mesh(unit, material(color, glow));m.scale.set(w,h,d);m.position.set(x,y,z);m.castShadow = !glow;m.receiveShadow = true;g.add(m);return m; };
  const soft=(w:number,h:number,d:number,x:number,y:number,z:number,color:string,r=.04)=>{
    const key=[w,h,d,r].join('/');if(!rounded.has(key))rounded.set(key,new RoundedBoxGeometry(w,h,d,2,Math.min(r,w/3,h/3,d/3)));
    const m=new T.Mesh(rounded.get(key)!,material(color));m.position.set(x,y,z);m.castShadow=true;m.receiveShadow=true;g.add(m);return m;
  };
  const cylinder=(r:number,height:number,x:number,y:number,z:number,color:string)=>{const m=new T.Mesh(cylinderGeometry,material(color));m.scale.set(r,height,r);m.position.set(x,y,z);m.castShadow=true;m.receiveShadow=true;g.add(m);return m;};
  const cup=(x:number,y:number,z:number,color:string)=>{cylinder(.035,.075,x,y+.0375,z,color);cylinder(.029,.004,x,y+.077,z,C.dark);};
  const { w, d, h, kind } = item;
  const legs = (height: number) => { for (const x of [-1,1]) for (const z of [-1,1]) box(.045,height,.045,x*(w/2-.09),height/2,z*(d/2-.09),C.dark); };
  if (kind === 'desk' || kind === 'table' || kind === 'computer' || kind === 'counter') {
    const top = kind === 'counter' ? 1 : .74;legs(top);
    if(luxury){soft(w,.07,d,0,top,0,C.wood,.025);box(.4,.65,.57,-w/2+.26,.34,0,C.wood);for(let k=0;k<3;k++){box(.35,.19,.025,-w/2+.26,.15+k*.20,.30,C.wood);box(.13,.018,.035,-w/2+.26,.17+k*.20,.315,C.brass);}}else box(w,.07,d,0,top,0,C.wood);box(w,.025,.025,0,top+.035,d/2-.013,C.edge);
    if (kind === 'counter') box(w-.1,.8,.08,0,.53,d/2-.08,C.teal);
    if (kind === 'computer') {
      box(.2,.025,.16,0,top+.05,-.11,C.dark);box(.04,.16,.04,0,top+.14,-.16,C.dark);
      box(.57,.37,.055,0,top+.32,-.19,C.dark);box(.52,.31,.008,0,top+.32,-.158,C.blue,true);
      box(.36,.025,.13,-.03,top+.06,.16,C.dark);box(.07,.025,.1,.27,top+.06,.16,C.cream);
      for(let i=0;i<3;i++) box(.22-i*.04,.018,.006,-.1,top+.37-i*.065,-.15,C.cream,true);
    } else if(kind === 'desk' && !office) { box(.25,.04,.18,w*.24,top+.06,0,C.teal);box(.2,.025,.18,w*.24,top+.09,0,C.paper); }
  } else if (kind === 'chair') {
    if(luxury){
      cylinder(.035,.38,0,.22,0,C.dark);
      for(let k=0;k<5;k++){const a=k*Math.PI*2/5,spoke=box(.028,.035,.22,Math.sin(a)*.11,.05,Math.cos(a)*.11,C.dark);spoke.rotation.y=a;}
      soft(w-.02,.09,d*.8,0,.46,0,C.teal);soft(w-.05,.38,.075,0,.69,d/2-.055,C.fabric);
      for(const sign of [-1,1]){box(.025,.19,.035,sign*(w/2-.035),.55,.10,C.dark);soft(.055,.04,.28,sign*(w/2-.035),.65,.02,C.dark,.012);}
    }else{legs(.43);box(w,.08,d*.8,0,.46,0,C.fabric);box(w,.4,.065,0,.69,d/2-.04,C.fabric);}
  } else if (kind === 'lecture-seat') {
    box(.08,.42,.24,0,.21,.12,C.dark);box(.47,.09,.41,0,.46,.12,C.teal);box(.48,.46,.075,0,.71,.36,C.teal);
    box(.52,.05,.23,0,.73,-.31,C.wood);box(.035,.7,.035,w/2-.04,.35,-.31,C.dark);
  } else if(kind==='plush-cat') {
    g.add(createCatTeacherPlush());
  } else if(kind==='sofa-back'||kind==='sofa-wing') {
    soft(w-.08,.16,d-.08,0,.17,0,C.wood);soft(w,.25,d,0,.34,0,C.fabric);
    soft(w-.035,.49,.16,0,.62,d/2-.08,C.fabric);
    if(kind==='sofa-back')for(const sign of [-1,1])soft(.16,.49,d-.16,sign*(w/2-.08),.62,-.08,C.fabric);
    const padding=kind==='sofa-back'?.20:.07,count=kind==='sofa-back'?3:1,seatW=(w-2*padding)/count-.025;
    for(let k=0;k<count;k++){
      const x=-w/2+padding+(k+.5)*(w-2*padding)/count;
      soft(seatW,.13,d-.22,x,.49,-.055,C.teal);
      if(kind==='sofa-back'){
        const pillow=soft(.31,.30,.12,x,.68,d/2-.22,k%2?C.edge:C.cream,.055);pillow.rotation.z=(k-1)*.08;
      }
    }
  } else if (kind === 'sofa') {
    if(luxury){
      soft(w-.12,.16,d-.1,0,.17,0,C.wood);soft(w,.25,d,0,.34,0,C.fabric);soft(w-.06,.49,.17,0,.62,d/2-.09,C.fabric);
      for(const sign of [-1,1]){
        soft(.16,.40,d-.03,sign*(w/2-.085),.51,0,C.fabric);
        soft(w/2-.20,.13,d-.24,sign*w/4,.49,-.055,C.teal);
        const pillow=soft(.31,.30,.12,sign*w*.28,.68,d/2-.23,sign<0?C.cream:C.edge,.055);pillow.rotation.z=sign*.12;
        box(.3,.012,.008,sign*w*.28,.70,d/2-.295,C.brass);
      }
      soft(.27,.015,.43,-w*.30,.566,-.08,C.cream,.006);
    }else{
      box(w-.14,.17,d-.12,0,.18,0,C.dark);box(w,.25,d,0,.35,0,C.fabric);box(w,.47,.15,0,.64,d/2-.075,C.fabric);
      for (const x of [-1,1]) box(.15,.42,d,x*(w/2-.075),.53,0,C.fabric);
      for (const x of [-1,1]) { box(w/2-.19,.12,d-.22,x*w/4,.53,-.04,C.teal);box(.3,.29,.12,x*w*.28,.73,d/2-.2,C.edge); }
    }
  } else if (kind === 'bookcase' || kind === 'cabinet') {
    box(w,h,.045,0,h/2,-d/2+.023,C.wood);
    for (const sign of [-1,1]) box(.06,h,d,sign*(w/2-.03),h/2,0,C.wood);
    for (let row=0;row<5;row++) box(w,.045,d,0,.08+row*(h-.12)/4,0,C.edge);
    if(kind==='bookcase') for(let row=0;row<4;row++) for(let i=0;i<Math.floor((w-.16)/.115);i++) {
      const colors=[C.teal,C.clay,C.cream,C.blue,C.brass],bh=.2+((i*7+row*3)%5)*.025;
      box(.075,bh,d*.63,-w/2+.13+i*.115,.11+row*(h-.12)/4+bh/2,0,colors[(i+row)%colors.length]);
    } else for(const sign of [-1,1]) { box(w/2-.08,h-.14,.035,sign*w/4,h/2,d/2-.018,C.cream);box(.025,.12,.035,sign*.06,h*.54,d/2+.002,C.dark); }
  } else if(kind==='board'||kind==='screen') {
    box(w,h,d,0,h/2,0,kind==='board'?C.wood:C.dark);box(w-.08,h-.08,.012,0,h/2,d/2+.002,kind==='board'?C.board:C.cream);
    if(kind==='board') for(let i=0;i<4;i++) box(w*(.25+.08*(i%2)),.012,.008,-w*.15,h*.7-i*.16,d/2+.011,C.paper);
  } else if(kind==='platform') {
    box(w,h,d,0,h/2,0,'#b3a895');box(w,.018,.035,0,h+.002,-d/2+.018,C.brass);
  } else if(kind==='plant'||kind==='shelf-plant') {
    const small=kind==='shelf-plant',potH=small?.12:.31,potR=Math.min(w,d)*.34;
    cylinder(potR,potH,0,potH/2,0,small?C.cream:C.clay);cylinder(potR*1.035,.018,0,potH-.018,0,C.brass);cylinder(potR*.88,.009,0,potH+.002,0,C.wood);
    box(.018,h-potH,.018,0,potH+(h-potH)/2,0,C.wood);
    for(let k=0;k<7;k++){
      const angle=k*2.4,reach=w*.24,y=potH+(h-potH)*(.32+k*.085);
      const leaf=new T.Mesh(leafGeometry,material(['#5a805a','#75936b','#8ba57a'][k%3]));
      leaf.scale.set(w*.18,(h-potH)*.14,d*.18);leaf.position.set(Math.sin(angle)*reach,y,Math.cos(angle)*reach);leaf.rotation.z=Math.sin(angle)*.5;leaf.castShadow=true;g.add(leaf);
    }
  } else if(kind==='rug') {
    const mesh=box(w,h,d,0,h/2,0,C.cream);mesh.material=patterned('rug');
  } else if(kind==='tv') {
    box(w*.45,h*.34,.012,0,h*.5,-d*.4,C.dark);soft(w,h,d*.78,0,h/2,0,'#233335',.018);
    const screen=box(w-.065,h-.065,.008,0,h/2,d*.41,'#ffffff');screen.material=patterned('campus');
    box(.018,.006,.008,w*.4,.02,d/2,C.blue,true);
  } else if(kind==='wall-panel') {
    box(w,h,d,0,h/2,0,C.wood);
    const n=14;for(let k=0;k<n;k++)box(w/n*.93,h-.04,.01,-w/2+(k+.5)*w/n,h/2,d/2+.002,k%2?C.wood:'#9b7858');
    box(.018,h-.06,.012,w/2-.035,h/2,d/2+.006,C.brass);
  } else if(kind==='wall-art') {
    box(w,h,d,0,h/2,0,C.wood);box(w-.04,h-.04,.009,0,h/2,d/2,C.cream);
    const art=box(w-.13,h-.13,.008,0,h/2,d/2+.006,'#ffffff');art.material=patterned('art',variant);
  } else if(kind==='coffee-table') {
    for(const sign of [-1,1]){box(.035,.40,d*.75,sign*(w/2-.10),.20,0,C.brass);box(w-.16,.025,.035,0,.13,sign*(d/2-.07),C.brass);}
    soft(w,.06,d,0,.43,0,C.wood,.025);box(.24,.035,.16,-.18,.48,-.015,C.teal);box(.21,.025,.16,-.17,.51,-.015,C.paper);cup(.22,.46,.025,C.cream);
  } else if(kind==='desk-accessories') {
    // One compact tray, lamp and cup stay inside the table's footprint.
    const color=[C.teal,C.clay,C.edge][variant];
    box(.25,.025,.18,-.015,.012,-.13,C.dark);box(.21,.014,.15,-.02,.032,-.13,C.paper);
    if(variant!==1)box(.19,.02,.14,-.025,.05,-.13,color);
    box(.12,.016,.10,.045,.008,.015,C.dark);box(.018,.23,.018,.045,.13,.015,C.brass);
    soft(.17,.065,.12,.005,.265,.015,C.dark,.012);box(.15,.01,.10,.005,.231,.015,C.cream,true);
    if(variant===2){
      cylinder(.04,.065,-.02,.0325,.19,C.clay);
      for(let k=0;k<3;k++){const leaf=new T.Mesh(leafGeometry,material(['#66845d','#87a478','#547450'][k]));leaf.scale.set(.025,.055,.025);leaf.position.set(-.02+(k-1)*.018,.10+(k%2)*.025,.19);leaf.rotation.z=(k-1)*.4;g.add(leaf);}
    }else cup(-.02,0,.19,C.cream);
  } else if(kind==='light') {box(w+.06,h,d+.06,0,h/2,0,C.dark);box(w,.015,d,0,-.004,0,C.cream,true);}
}
