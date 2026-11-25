import type { Point2 } from '../walk-types';

export interface SignBoard {
  text:string;
  background:string;
  ink:string;
  vertical?:boolean;
  cloth?:boolean;
  subtitle?:string;
  badge?:'pelican'|'ice'|'tea'|'sun'|'bowl';
  targetAspect?:number;
  accent?:string;
}

/** Logical canvas aspect. The atlas cell is stretched on upload and restored by the panel. */
export function signAspect(board:SignBoard) {
  if(board.targetAspect&&board.targetAspect>0)return board.targetAspect;
  if(board.vertical)return .52;
  if(board.subtitle)return 4.5;
  return Math.max(1.9,Array.from(board.text).length*.79+.62);
}

export function fitSign(board:SignBoard, maxWidth:number, maxHeight:number) {
  const aspect=signAspect(board);
  const height=Math.min(maxHeight,maxWidth/aspect);
  return {width:height*aspect,height,aspect};
}

/** Local façade offsets measured from the forward wall, even for recessed arcades. */
export function fasciaSign(ceiling:number, wallTop:number, shelter:number){
  if(shelter){
    const canopyY=Math.min(wallTop-.48,ceiling-.31);
    return {canopyY, signY:canopyY+.31, signOffset:Math.max(.22,shelter*.42)};
  }
  return {canopyY:0, signY:Math.min(wallTop-.29,ceiling+.05), signOffset:.18};
}

export function paintSign(ctx:CanvasRenderingContext2D, board:SignBoard) {
  const width=96*signAspect(board);
  ctx.scale(384/width,1);
  ctx.fillStyle=board.background;
  ctx.fillRect(0,0,width,96);
  if(board.cloth){
    ctx.fillStyle='#1b273d';
    ctx.fillRect(0,0,width,12);
    const flaps=Math.max(3,Math.min(6,Math.round(width/115)));
    ctx.fillStyle='#dddac338';
    for(let i=1;i<flaps;i++)ctx.fillRect(i*width/flaps-1.5,8,3,88);
    for(let i=1;i<flaps;i++)ctx.clearRect(i*width/flaps-2,44,4,52);
    if(width>260&&ctx.strokeRect){
      ctx.strokeStyle=board.ink;ctx.lineWidth=2;
      ctx.strokeRect(24,20,52,52);
      ctx.fillStyle=board.ink;ctx.fillRect(36,34,28,4);ctx.fillRect(36,46,28,4);ctx.fillRect(48,28,4,36);
    }
  }else{
    if(board.accent){
      ctx.fillStyle=board.accent;
      ctx.fillRect(0,78,width,18);
    }
    ctx.strokeStyle=board.ink;ctx.lineWidth=2;ctx.strokeRect(5,5,width-10,86);
    if(width>340){
      ctx.fillStyle=board.accent??board.ink;
      ctx.fillRect(14,14,10,68);
      ctx.fillRect(width-24,14,10,68);
    }
  }
  let textCenterX=width/2, textAvailable=width-32;
  if(board.badge&&!board.vertical&&width>=260){
    const bx=42;
    if(board.badge==='pelican'){
      // Dandan Burger style chef-hat pelican emblem on left side of fascia.
      ctx.fillStyle='#d63830';ctx.fillRect(14,11,76,74);
      ctx.fillStyle='#fff9ee';ctx.fillRect(26,15,32,16);ctx.fillRect(30,29,26,38);
      ctx.fillStyle='#f4a62a';ctx.fillRect(52,36,28,13);ctx.fillRect(54,50,22,5);
      ctx.fillStyle='#232629';ctx.fillRect(44,34,5,5);
    }else if(board.badge==='ice'){
      ctx.fillStyle='#f7d86a';ctx.fillRect(18,14,68,68);
      ctx.fillStyle='#fffaf0';ctx.fillRect(28,24,48,26);
      ctx.fillStyle='#c8433a';ctx.fillRect(34,20,36,12);
      ctx.fillStyle='#3b6c8c';ctx.fillRect(24,50,56,18);
    }else if(board.badge==='tea'){
      ctx.fillStyle=board.ink;ctx.fillRect(20,16,58,64);
      ctx.fillStyle=board.background;ctx.fillRect(28,24,42,48);
      ctx.fillStyle=board.ink;ctx.fillRect(46,12,6,18);
    }else if(board.badge==='sun'){
      ctx.fillStyle='#e89a3c';ctx.fillRect(20,18,60,60);
      ctx.fillStyle='#faf3dd';ctx.fillRect(30,34,40,28);
    }else{
      ctx.fillStyle=board.ink;ctx.fillRect(20,22,56,52);
      ctx.fillStyle=board.background;ctx.fillRect(26,28,44,26);
    }
    textCenterX=bx+44+(width-(bx+64))/2;
    textAvailable=width-(bx+82);
  }
  ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle=board.ink;
  const font=(size:number)=>`700 ${size}px "Noto Sans TC", "Noto Sans CJK TC", sans-serif`;
  const line=(text:string,x:number,y:number,size:number,available:number)=>{
    ctx.font=font(size);
    ctx.font=font(Math.floor(size*Math.min(1,available/Math.max(1,ctx.measureText(text).width))));
    ctx.fillText(text,x,y);
  };
  if(board.vertical){
    const glyphs=Array.from(board.text), interval=80/glyphs.length;
    glyphs.forEach((glyph,i)=>line(glyph,width/2,8+interval*(i+.5),Math.min(34,interval*.88),width-14));
  }else if(board.subtitle){
    line(board.text,width*.30,48,62,width*.46-14);
    line('燒肉飯',width*.72,31,30,width*.42-14);
    line(board.subtitle,width*.72,66,30,width*.42-14);
  }else line(board.text,textCenterX,board.accent?43:49,64,Math.max(48,textAvailable));
}

const shopLabels = {
  glass:['洗衣','眼鏡','鐘錶','理髮'],
  stall:['早餐','小吃','麵食','熟食','飲料'],
  garage:['機車行','機車維修','自行車','車輛保養'],
  clinic:['診所','藥局','牙科','中藥'],
  grocery:['雜貨','五金','文具','米糧','水果'],
} as const;
export type StreetfrontStyle = keyof typeof shopLabels | 'shutter' | 'home' | 'vacant';
export const genericSigns=[...Object.values(shopLabels).flat()];
const commercialStyles:readonly StreetfrontStyle[]=[
  'stall','glass','grocery','garage','stall','clinic','glass','shutter','grocery','home','vacant','stall',
];
const residentialStyles:readonly StreetfrontStyle[]=[
  'home','shutter','home','vacant','home','garage','shutter','home','grocery','shutter','home','glass',
];

interface Frontage { at:Point2; normal:Point2; width:number; label:string }
/** Include neighboring footprints and the individual bays of long footprints. */
export function streetfrontPlanner(){
  const signs:Frontage[]=[];
  return (commercial:boolean, seed:number, at:Point2, normal:Point2, width:number)=>{
    const styles=commercial?commercialStyles:residentialStyles;
    const style=styles[seed%styles.length];
    if(style==='home'||style==='shutter'||style==='vacant')return {style,label:undefined};
    const candidates=shopLabels[style];
    const adjacent=signs.filter(s=>{
      const nx=s.at[0]-at[0],nz=s.at[1]-at[1];
      return s.normal[0]*normal[0]+s.normal[1]*normal[1]>.82
        &&Math.abs(nx*normal[0]+nz*normal[1])<5.5
        &&Math.hypot(nx,nz)<(s.width+width)*.5+4.5;
    });
    for(let i=0;i<candidates.length;i++){
      const label=candidates[(Math.floor(seed/styles.length)+i)%candidates.length];
      if(adjacent.some(s=>s.label===label))continue;
      signs.push({at,normal,width,label});
      return {style,label};
    }
    return {style,label:undefined};
  };
}

export function paintStreetfront(ctx:CanvasRenderingContext2D, style:StreetfrontStyle) {
  const rect=(x:number,y:number,w:number,h:number,color:string)=>{
    ctx.fillStyle=color;ctx.fillRect(x,y,w,h);
  };
  rect(0,0,384,96,'#938b7e');
  rect(8,5,368,86,'#4c514b');
  if(style==='home'){
    rect(12,8,132,81,'#596963');
    rect(23,14,109,25,'#87908a');
    rect(158,14,214,70,'#b4a99a');
    rect(174,30,180,38,'#636e66');
    for(let x=185;x<350;x+=16)rect(x,30,3,38,'#a0a598');
    for(let x=28;x<135;x+=17)rect(x,14,3,24,'#404a45');
    rect(117,49,6,13,'#b8b1a0');
  }else if(style==='shutter'||style==='vacant'){
    rect(14,8,356,83,style==='vacant'?'#928477':'#929a93');
    for(let y=12;y<89;y+=5){rect(14,y,356,1,'#686d65');rect(14,y+1,356,1,'#acaa9f');}
    rect(31,10,4,79,'#545e58');rect(348,10,4,79,'#545e58');
    if(style==='vacant'){
      rect(85,34,68,20,'#b89e80');
      rect(93,40,49,2,'#8f715a');
      for(let i=0;i<10;i++)rect(19+i*32,74+i%4*2,20,10,'#685a4d30');
    }else rect(171,80,42,4,'#555f57');
  }else if(style==='glass'||style==='clinic'){
    const clinic=style==='clinic';
    rect(10,7,364,82,clinic?'#cccec0':'#75908d');
    rect(17,11,350,27,clinic?'#5b8782':'#9da89a');
    rect(19,42,346,42,clinic?'#dedcd0':'#4e6766');
    for(const x of [17,106,182,271,361])rect(x,8,5,80,clinic?'#d7dacc':'#354949');
    rect(174,53,4,15,'#afb8ad');rect(192,53,4,15,'#afb8ad');
    if(clinic)for(let x=215;x<330;x+=37){
      rect(x,48,29,20,'#eee9db');rect(x+5,53,19,2,'#828d83');rect(x+5,58,14,2,'#828d83');
    }
  }else if(style==='garage'){
    rect(12,9,360,15,'#6c7470');
    rect(18,28,348,54,'#4a4c43');
    rect(21,28,119,42,'#7b725e');
    for(let x=32;x<136;x+=18)rect(x,34,4,23,'#53534a');
    rect(193,66,139,13,'#737168');
    for(const x of [209,309]){
      ctx.beginPath();ctx.ellipse(x,70,22,14,0,0,Math.PI*2);ctx.fillStyle='#302e2b';ctx.fill();
    }
    rect(210,58,93,7,'#76604c');rect(279,45,14,18,'#7d8276');
  }else if(style==='stall'){
    rect(14,9,356,19,'#817664');
    for(let x=15;x<369;x+=30)rect(x,9,14,10,'#ad8e6a');
    rect(23,30,338,41,'#857d67');
    rect(33,33,103,29,'#c3ae82');rect(42,38,81,2,'#776859');
    rect(173,60,170,25,'#8d9590');rect(157,56,187,7,'#b4b6a8');
    for(let x=190;x<342;x+=37)rect(x,48,25,8,'#9b744f');
  }else{
    rect(15,10,354,77,'#756957');
    for(const y of [34,55,75]){
      rect(31,y,122,3,'#9b8062');rect(209,y,142,3,'#9b8062');
      for(let x=34;x<351;x+=21)if(x<140||x>208)rect(x,y-9,15,9,['#ac8860','#b5a475','#7c8a72','#8f6250'][(x+y)%4]);
    }
    rect(159,14,45,73,'#4d5044');
    for(const x of [33,96,278])rect(x,74,48,15,'#9e835b');
  }
}
