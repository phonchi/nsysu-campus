import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import survey from '../../public/data/terrain/hamasen-rail-backdrop.json';
import type { CampusStructure, ContextBuilding, Point2 } from '../walk-types';
import { inPolygon, type Terrain } from '../world/terrain';

type Context = CampusStructure['context'];
type HeightAt = (x: number, z: number) => number | null;

const park = survey.greens as Point2[][];
const { origin, cols, rows, cell, heights } = survey.terrain;

function surveyedHeight(x: number, z: number) {
 const fx = (x-origin[0])/cell, fz = (z-origin[1])/cell;
 if(fx<0||fz<0||fx>cols-1||fz>rows-1)return null;
 const i=Math.min(cols-2,Math.floor(fx)),j=Math.min(rows-2,Math.floor(fz)),u=fx-i,v=fz-j;
 const a=heights[j*cols+i],b=heights[j*cols+i+1],c=heights[(j+1)*cols+i],d=heights[(j+1)*cols+i+1];
 if(u+v<=1)return a===null||b===null||c===null?null:a*(1-u-v)+b*u+c*v;
 return b===null||c===null||d===null?null:b*(1-v)+c*(1-u)+d*(u+v-1);
}

function meshFrom(positions: number[], indices?: number[]) {
 const geometry = new T.BufferGeometry();
 geometry.setAttribute('position', new T.Float32BufferAttribute(positions,3));
 if(indices)geometry.setIndex(indices);
 geometry.computeVertexNormals();
 return geometry;
}

function addSurveyLand(group: T.Group, terrain: Terrain) {
 const vertices: number[] = [], indices: number[] = [], colours: number[] = [];
 const urban=new T.Color('#b7b2a0'), grass=new T.Color('#82936b');
 for(const [i,height] of heights.entries()){
  const col=i%cols,x=origin[0]+col*cell,z=origin[1]+Math.floor(i/cols)*cell;
  // Match the existing gameplay DEM exactly along the common render edge.
  vertices.push(x,col===0?terrain.heightAt(x,z):height??0,z);
  const colour=park.some(p=>inPolygon([x,z],p))?grass:urban;
  colours.push(colour.r,colour.g,colour.b);
  if(col===cols-1||i+cols+1>=heights.length)continue;
  const a=i,b=i+1,c=i+cols,d=c+1;
  if(heights[a]!==null&&heights[b]!==null&&heights[c]!==null)indices.push(a,c,b);
  if(heights[b]!==null&&heights[c]!==null&&heights[d]!==null)indices.push(b,c,d);
 }
 const geometry=meshFrom(vertices,indices);
 geometry.setAttribute('color',new T.Float32BufferAttribute(colours,3));
 const land=new T.Mesh(geometry,new T.MeshStandardMaterial({vertexColors:true,roughness:1}));
 land.name='Hamasen · surveyed land beyond the railway park';
 group.add(land);
}

function addSkyline(group: T.Group, heightAt: HeightAt) {
 const silhouettes: T.BufferGeometry[] = [];
 const colours = new Map<string,T.Color>([
  ['apartments',new T.Color('#bdb8a8')],['warehouse',new T.Color('#9c816d')],
  ['office',new T.Color('#bcbaaf')],['hotel',new T.Color('#a7a39b')],
 ]);
 const fallback = new T.Color('#aca89e'), roof = new T.Color('#929795');
 for(const building of survey.buildings){
  const outline=building.polygon as Point2[];
  const ground=outline.map(([x,z])=>heightAt(x,z)).filter(y=>y!==null);
  if(!ground.length)continue;
  const y=Math.min(...ground)-.16;
  const shape=new T.Shape(outline.map(([x,z])=>new T.Vector2(x,-z)));
  const geometry=new T.ExtrudeGeometry(shape,{depth:building.height,bevelEnabled:false,steps:1});
  geometry.rotateX(-Math.PI/2).translate(0,y,0);
  const wall=colours.get(building.kind)??fallback,normals=geometry.getAttribute('normal'),rgb=[];
  for(let i=0;i<normals.count;i++){
   const colour=normals.getY(i)>.5?roof:wall;
   rgb.push(colour.r,colour.g,colour.b);
  }
  geometry.setAttribute('color',new T.Float32BufferAttribute(rgb,3));
  geometry.clearGroups();silhouettes.push(geometry);
 }
 const merged=silhouettes.length?mergeGeometries(silhouettes):null;
 for(const geometry of silhouettes)geometry.dispose();
 if(merged){
  const skyline=new T.Mesh(merged,new T.MeshStandardMaterial({vertexColors:true,roughness:.94}));
  skyline.name='Hamasen · mapped port and Pier-2 silhouettes';
  group.add(skyline);
 }
}

function strip(out:number[],points:Point2[],width:number,heightAt:HeightAt,raise:number,shift=0){
 for(let i=1;i<points.length;i++){
  const [x,z]=points[i-1],[u,v]=points[i],dist=Math.hypot(u-x,v-z);
  if(dist<.03)continue;
  const nx=(z-v)/dist,nz=(u-x)/dist,step=Math.ceil(dist/12);
  for(let j=0;j<step;j++){
   const f=j/step,g=(j+1)/step;
   const vertex=(t:number,side:number)=>{
    const a=T.MathUtils.lerp(x,u,t)+nx*(shift+width/2*side),b=T.MathUtils.lerp(z,v,t)+nz*(shift+width/2*side);
    const y=heightAt(a,b);return y===null?null:[a,y+raise,b];
   };
   const a=vertex(f,1),b=vertex(g,1),c=vertex(g,-1),d=vertex(f,-1);
   if(a&&b&&c&&d)out.push(...a,...b,...c,...a,...c,...d);
  }
 }
}

function addRailYard(group: T.Group, context: Context, heightAt: HeightAt) {
 const ballast:number[] = [],rails:number[]=[],sleepers:number[]=[];
 for(const line of survey.rails){
  const points=line.points as Point2[];
  strip(ballast,points,line.kind==='light_rail'?2.05:1.9,heightAt,.013);
  const gauge=line.kind==='light_rail'?.7175:.5335;
  for(const side of [-1,1])strip(rails,points,.1,heightAt,.04,side*gauge);
 }
 const historical=context.hamasen?.rails?.filter(line=>/^hamasen-rail-124768819[57]-/.test(line.id))??[];
 // Period platform photograph shows close timber sleepers. Limit geometry to
 // the two source alignments immediately alongside the original platform.
 for(const line of historical){
  let made=0;
  for(let i=1;i<line.points.length;i++){
   const [x,z]=line.points[i-1],[u,v]=line.points[i],length=Math.hypot(u-x,v-z);
   if(length<.05)continue;
   for(;made<length;made+=.82){
    const f=made/length,cx=T.MathUtils.lerp(x,u,f),cz=T.MathUtils.lerp(z,v,f);
    if(cx<930||cx>993||cz<473||cz>575)continue;
    const nx=(z-v)/length,nz=(u-x)/length;
    strip(sleepers,[[cx-nx*.97,cz-nz*.97],[cx+nx*.97,cz+nz*.97]],.22,heightAt,.024);
   }
   made-=length;
  }
 }
 for(const [points, colour, name] of [
  [ballast,'#958d79','Hamasen · trackbed continuation'],
  [rails,'#626360','Hamasen · surveyed rail continuation'],
  [sleepers,'#6b5a48','Hamasen · timber platform-side sleepers'],
 ] as const){
  if(!points.length)continue;
  const mesh=new T.Mesh(meshFrom(points),new T.MeshStandardMaterial({color:colour,roughness:.94}));
  mesh.name=name;group.add(mesh);
 }
}

function axis(footprint:Point2[],edge: number){
 const [x,z]=footprint[edge],[u,v]=footprint[(edge+1)%footprint.length];
 const length=Math.hypot(u-x,v-z),tx=(u-x)/length,tz=(v-z)/length;
 const center=footprint.reduce((sum,p)=>[sum[0]+p[0],sum[1]+p[1]],[0,0]);
 const outward=(center[0]/footprint.length-x)*tz-(center[1]/footprint.length-z)*tx < 0?1:-1;
 const nx=tz*outward,nz=-tx*outward;
 return {length,tx,tz,nx,nz,yaw:Math.atan2(nx,nz),
  place:(distance:number,offset:number,y:number)=>new T.Vector3(x+tx*distance+nx*offset,y,z+tz*distance+nz*offset)};
}

function plaque(lines: [string,string], width:number,height:number){
 const canvas=document.createElement('canvas');canvas.width=768;canvas.height=294;
 const ink=canvas.getContext('2d')!;
 ink.fillStyle='#241f1a';ink.fillRect(0,0,canvas.width,canvas.height);
 ink.strokeStyle='#806f59';ink.lineWidth=6;ink.strokeRect(11,11,746,272);
 ink.fillStyle='#f0e7d1';ink.textAlign='center';ink.textBaseline='middle';
 ink.font='bold 116px "Noto Serif TC","PMingLiU",serif';ink.fillText(lines[0],384,112,702);
 ink.font='600 43px Georgia,serif';ink.fillText(lines[1],384,220,690);
 const texture=new T.CanvasTexture(canvas);texture.colorSpace=T.SRGBColorSpace;
 return new T.Mesh(new T.PlaneGeometry(width,height),new T.MeshBasicMaterial({map:texture}));
}

function addMuseumEntrance(group:T.Group,building:ContextBuilding,terrain:Terrain){
 const face=axis(building.polygon,building.frontage?.edge??3),middle=face.length/2;
 const floor=terrain.maxUnder(building.polygon),steel=new T.MeshStandardMaterial({color:'#775649',roughness:.83});
 const cement=new T.MeshStandardMaterial({color:'#a9a092',roughness:.96});
 const glazing=new T.MeshStandardMaterial({color:'#6f8e91',opacity:.4,transparent:true,side:T.DoubleSide,depthWrite:false});
 const width=4.25,front=2.55,back=.18,eave=floor+2.48,ridge=floor+3.52;
 const at=(dx:number,dy:number,offset:number)=>face.place(middle+dx,offset,dy);
 const beam=(a:T.Vector3,b:T.Vector3,w:number,d:number)=>{
  const step=b.clone().sub(a);
  const mesh=new T.Mesh(new T.BoxGeometry(w,step.length(),d),steel);
  mesh.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),step.normalize());mesh.position.copy(a).lerp(b,.5);
  group.add(mesh);
 };
 for(const side of [-1,1]){
  const span=side*width/2,base=at(span,floor,front);
  const toe=new T.Mesh(new T.BoxGeometry(.47,.22,.47),cement);
  toe.position.copy(base).add(new T.Vector3(0,.04,0));toe.rotation.y=face.yaw;
  group.add(toe);beam(at(span,floor+.13,front),at(span,eave,front),.19,.23);
  beam(at(span,eave,front),at(0,ridge,front),.19,.24);
  beam(at(span,eave,back),at(0,ridge,back),.14,.16);
  beam(at(span,eave,back),at(span,eave,front),.18,.20);
  const a=at(span,eave+.06,front),b=at(0,ridge+.06,front),c=at(0,ridge+.06,back),d=at(span,eave+.06,back);
  const surface=new T.Mesh(meshFrom([a,b,c,a,c,d].flatMap(p=>p.toArray())),glazing);
  group.add(surface);
 }
 beam(at(0,ridge,back),at(0,ridge,front),.135,.135);
 // The board hangs just inside the glass gable, below the roof ridge.
 const sign=plaque(['舊打狗驛','故事館 · TAKAO RAILWAY MUSEUM'],2.65,.85);
 sign.name='舊打狗驛故事館 · 入口題牌';sign.rotation.y=face.yaw;
 sign.position.copy(at(0,floor+2.83,front+.11));group.add(sign);
}

function addPlatformBoard(group:T.Group,platform:ContextBuilding,terrain:Terrain){
 const face=axis(platform.polygon,platform.frontage?.edge??3);
 const xz=face.place(face.length*.58,-4.35,0),top=terrain.maxUnder(platform.polygon)+(platform.heightM??4.6);
 const y=top-1.26,alongYaw=Math.atan2(face.tx,face.tz);
 const material=new T.MeshStandardMaterial({color:'#63706a',roughness:.92});
 const panel=new T.Mesh(new T.BoxGeometry(1.83,.73,.085),new T.MeshStandardMaterial({color:'#2f2923',roughness:.94}));
 panel.position.set(xz.x,y,xz.z);panel.rotation.y=alongYaw;group.add(panel);
 for(const side of [-1,1]){
  const yaw=side>0?alongYaw:alongYaw+Math.PI;
  // 1941 board in the current exhibit reads right-to-left.
  const tag=plaque(['港雄高','1941'],1.78,.68);
  tag.name='高雄港站月台 · 1941 年題牌';tag.rotation.y=yaw;
  tag.position.set(xz.x+face.tx*side*.045,y,xz.z+face.tz*side*.045);
  group.add(tag);
  const rod=new T.Mesh(new T.BoxGeometry(.025,top-y-.44,.035),material);
  rod.position.set(xz.x+face.nx*side*.67,top/2+y/2+.12,xz.z+face.nz*side*.67);group.add(rod);
 }
}

export function hamasenRailDetails(context:Context,terrain:Terrain):T.Group{
 const group=new T.Group();
 group.name='Hamasen railway · historic plaques and surveyed backdrop';
 group.userData.visualOnly=true;group.userData.terrainSeated=true;
 const ground:HeightAt=(x,z)=>x<=origin[0]?terrain.surfaceAt(x,z)?.height??null:surveyedHeight(x,z);
 addSurveyLand(group,terrain);
 addSkyline(group,ground);
 addRailYard(group,context,ground);
 const museum=context.background.find(building=>building.id.endsWith('-203342621'));
 if(museum)addMuseumEntrance(group,museum,terrain);
 const platform=context.background.find(building=>building.id.endsWith('-435657348'));
 if(platform)addPlatformBoard(group,platform,terrain);
 return group;
}
