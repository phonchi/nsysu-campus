import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import survey from '../../public/data/terrain/hamasen-rail-backdrop.json';
import type { CampusStructure, Point2 } from '../walk-types';
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

export function hamasenRailDetails(context:Context,terrain:Terrain):T.Group{
 const group=new T.Group();
 group.name='Hamasen railway · surveyed backdrop';
 group.userData.visualOnly=true;group.userData.terrainSeated=true;
 const ground:HeightAt=(x,z)=>x<=origin[0]?terrain.surfaceAt(x,z)?.height??null:surveyedHeight(x,z);
 addSurveyLand(group,terrain);
 addSkyline(group,ground);
 addRailYard(group,context,ground);
 return group;
}
