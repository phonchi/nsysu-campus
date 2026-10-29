/** Campus art pass. Solid tree trunks and street furniture also export simplified obstacles. */
import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { WalkWorld, WorldFloor } from './walk-world';
import { CAMPUS_GROUND, drape } from './walk-world';
import { GROUND_Y, PLAY_BOUNDS, inPolygon, type Terrain } from './world/terrain';
import { buildRoadLayers, buildCrosswalkGeometry, roadRibbon } from './world/road-surface';
import type { CampusStructure, Point2 } from './walk-types';
import { buildTrees, familyFor, assignTreeYaw, filterTreeSpots, type TreeBore, type TreeSpot } from './render/foliage';
import { groundMask, lawnMaterial, setLawnMask } from './render/ground';
import { seaMaterial } from './render/sea';
import type { Obstacle, SupportAt } from './walk/obstacles';
import { PALETTE, FACULTY, BUILDING_FACULTY, surfaceOf, facadeTextures, patternTexture, boxUV, nightGlow, splitRoof, NIGHT_MATERIALS, NIGHT_FADE, FACADE_TILE } from './walk-materials';

const solid=(color:string,roughness=.82,extra:T.MeshStandardMaterialParameters={})=>new T.MeshStandardMaterial({color,roughness,...extra});
interface Piece{position:T.Vector3;scale:T.Vector3;rotation?:T.Euler;}
const piece=(x:number,y:number,z:number,w:number,h:number,d:number,ry=0):Piece=>({position:new T.Vector3(x,y,z),scale:new T.Vector3(w,h,d),rotation:new T.Euler(0,ry,0)});
function instances(parent:T.Object3D,geo:T.BufferGeometry,material:T.Material,pieces:Piece[],name:string,shadow=true){
 if(!pieces.length)return;const mesh=new T.InstancedMesh(geo,material,pieces.length),o=new T.Object3D();mesh.name=name;
 pieces.forEach((p,i)=>{o.position.copy(p.position);o.scale.copy(p.scale);o.rotation.copy(p.rotation??new T.Euler());o.updateMatrix();mesh.setMatrixAt(i,o.matrix);});
 mesh.castShadow=shadow;mesh.receiveShadow=true;mesh.computeBoundingSphere();parent.add(mesh);return mesh;
}
const rng=(seed:number)=>()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
interface CampusTree { x:number;y:number;z:number;s:number;kind?:'street'|'lawn';i?:number }
/** Physical tree layout is independent of pointer/device/leaf density. */
export function campusTreeSpots(trees:readonly CampusTree[],random:()=>number=rng(2026)):TreeSpot[]{
 return trees.map(t=>{
  if(t.y>1)return {x:t.x,y:t.y,z:t.z,s:t.s*.85,f:'hill'};
  const f=t.x<-150?'coast':familyFor(t.kind??'lawn',t.i??0,random);
  return {x:t.x,y:t.y,z:t.z,s:(f==='banyan'?.8:f==='flame'?.85:f==='coast'?1:.75)*t.s,f};
 });
}
function inside(p:Point2,poly:Point2[]){let c=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const a=poly[i],b=poly[j];if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])c=!c;}return c;}
function segDist(p:Point2,a:Point2,b:Point2){const dx=b[0]-a[0],dz=b[1]-a[1],L=dx*dx+dz*dz,t=L?Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dz)/L)):0;return Math.hypot(p[0]-a[0]-dx*t,p[1]-a[1]-dz*t);}

/** 2 m occupancy grid over the campus ground: buildings, context blocks, roads, water. */
class Occupancy {
 readonly cell=2;readonly nx:number;readonly nz:number;readonly grid:Uint8Array;
 constructor(readonly x0:number,readonly z0:number,x1:number,z1:number){this.nx=Math.ceil((x1-x0)/this.cell);this.nz=Math.ceil((z1-z0)/this.cell);this.grid=new Uint8Array(this.nx*this.nz);}
 private each(minx:number,minz:number,maxx:number,maxz:number,f:(p:Point2,i:number)=>void){
  const i0=Math.max(0,Math.floor((minx-this.x0)/this.cell)),i1=Math.min(this.nx-1,Math.ceil((maxx-this.x0)/this.cell)),k0=Math.max(0,Math.floor((minz-this.z0)/this.cell)),k1=Math.min(this.nz-1,Math.ceil((maxz-this.z0)/this.cell));
  for(let k=k0;k<=k1;k++)for(let i=i0;i<=i1;i++)f([this.x0+(i+.5)*this.cell,this.z0+(k+.5)*this.cell],k*this.nx+i);
 }
 polygon(poly:Point2[],pad=0,mark=1){const xs=poly.map(p=>p[0]),zs=poly.map(p=>p[1]);this.each(Math.min(...xs)-pad,Math.min(...zs)-pad,Math.max(...xs)+pad,Math.max(...zs)+pad,(p,i)=>{if(inside(p,poly)||(pad>0&&poly.some((a,j)=>segDist(p,a,poly[(j+1)%poly.length])<pad)))this.grid[i]=Math.max(this.grid[i],mark);});}
 line(points:Point2[],half:number,mark=2){for(let j=1;j<points.length;j++){const a=points[j-1],b=points[j];this.each(Math.min(a[0],b[0])-half,Math.min(a[1],b[1])-half,Math.max(a[0],b[0])+half,Math.max(a[1],b[1])+half,(p,i)=>{if(segDist(p,a,b)<half)this.grid[i]=Math.max(this.grid[i],mark);});}}
 at(x:number,z:number){const i=Math.floor((x-this.x0)/this.cell),k=Math.floor((z-this.z0)/this.cell);if(i<0||k<0||i>=this.nx||k>=this.nz)return 9;return this.grid[k*this.nx+i];}
 free(x:number,z:number,r=1.5){for(const [dx,dz] of [[0,0],[r,0],[-r,0],[0,r],[0,-r]])if(this.at(x+dx,z+dz))return false;return true;}
}

function roadTexture(centre:boolean,markings=true){
 const S=128,data=new Uint8Array(S*S*4),r=rng(41),base=new T.Color(PALETTE.asphalt),white=new T.Color(PALETTE.mark),yellow=new T.Color(PALETTE.markYellow);
 for(let y=0;y<S;y++)for(let x=0;x<S;x++){let c=base.clone().offsetHSL(0,0,(r()-.5)*.03);if(markings&&(x>=5&&x<8||x>=120&&x<123))c=white;if(markings&&centre&&x>=61&&x<67&&y%64<36)c=yellow;const i=(y*S+x)*4;data[i]=c.r*255;data[i+1]=c.g*255;data[i+2]=c.b*255;data[i+3]=255;}
 const t=new T.DataTexture(data,S,S);t.wrapS=T.ClampToEdgeWrapping;t.wrapT=T.RepeatWrapping;t.colorSpace=T.LinearSRGBColorSpace;t.magFilter=T.LinearFilter;t.minFilter=T.LinearMipmapLinearFilter;t.generateMipmaps=true;t.anisotropy=4;t.needsUpdate=true;return t;
}

/** Merge all static meshes under root into one mesh per material (root-local space). */
function mergeByMaterial(root:T.Object3D){
 root.updateWorldMatrix(true,true);const inverse=root.matrixWorld.clone().invert(),batches=new Map<T.Material|T.Material[],T.BufferGeometry[]>(),olds:T.Mesh[]=[];
 root.traverse(o=>{if(!(o instanceof T.Mesh)||o instanceof T.InstancedMesh||o===root)return;for(let p:T.Object3D|null=o;p&&p!==root;p=p.parent)if(p.userData.dynamicDoor)return;
  let g=o.geometry.clone().applyMatrix4(new T.Matrix4().multiplyMatrices(inverse,o.matrixWorld));if(g.index)g=g.toNonIndexed();for(const k of Object.keys(g.attributes))if(!['position','normal','uv'].includes(k))g.deleteAttribute(k);
  if(!g.attributes.uv)g.setAttribute('uv',new T.Float32BufferAttribute(new Float32Array(g.attributes.position.count*2),2));if(!g.attributes.normal)g.computeVertexNormals();
  const push=(key:T.Material,geo:T.BufferGeometry)=>{if(!batches.has(key))batches.set(key,[]);batches.get(key)!.push(geo);};
  if(Array.isArray(o.material)){const src=o.geometry.groups;for(const grp of src){const part=new T.BufferGeometry();for(const [k,a] of Object.entries(g.attributes)){const att=a as T.BufferAttribute;part.setAttribute(k,new T.BufferAttribute((att.array as Float32Array).slice(grp.start*att.itemSize,(grp.start+grp.count)*att.itemSize),att.itemSize));}push(o.material[grp.materialIndex??0],part);}g.dispose();}
  else push(o.material,g);olds.push(o);});
 for(const [mat,geos] of batches){const merged=mergeGeometries(geos,false);if(!merged)continue;const m=new T.Mesh(merged,mat);m.castShadow=true;m.receiveShadow=true;root.add(m);for(const g of geos)g.dispose();}
 for(const o of olds)o.removeFromParent();
}
/** Call once immediately after buildWalkWorld, before renderer compilation. */
export function decorateCampus(world:WalkWorld,structure:CampusStructure,terrain?:Terrain,leafDensity?:number):void{
 if(world.display.userData.campusArtApplied)return;world.display.userData.campusArtApplied=true;
 const brick=facadeTextures('brick'),cream=facadeTextures('cream');
 const tex={grass:patternTexture('grass'),paving:patternTexture('paving'),tile:patternTexture('tile'),plaster:patternTexture('plaster'),wood:patternTexture('wood'),roof:patternTexture('roof'),sand:patternTexture('sand')};
 const cache=new Map<string,T.MeshStandardMaterial>();
 const material=(key:string,make:()=>T.MeshStandardMaterial)=>{let m=cache.get(key);if(!m){m=make();cache.set(key,m);}return m;};
 const textured=(map:T.Texture,color='#ffffff',roughness=.85)=>new T.MeshStandardMaterial({map,color,roughness});
 // 1. Walkable buildings: repaint by surface role; interiors warm cream, exteriors brick/cream.
 const isBuilding=(o:T.Object3D)=>{for(let p:T.Object3D|null=o.parent;p;p=p.parent)if(world.frames.has(p.name))return true;return false;};
 world.display.traverse(object=>{
  if(!(object instanceof T.Mesh)||Array.isArray(object.material))return;
  const s=surfaceOf(object.material);if(!s)return;const inB=isBuilding(object);
  let m:T.MeshStandardMaterial|undefined,uv:[number,number]|undefined;
  switch(s){
   case 'wall':m=material('wall',()=>textured(tex.plaster,PALETTE.interiorWall,.92));uv=[3,3];break;
   case 'floor':m=material('floor',()=>textured(tex.tile,'#ffffff',.7));uv=[2.4,2.4];break;
   case 'trim':m=material('trim',()=>solid(PALETTE.cream,.8));break;
   case 'wood':case 'door':m=material('wood',()=>textured(tex.wood,'#ffffff',.72));uv=[1.2,1.2];break;
   case 'stone':m=material('stone',()=>solid('#cfd9d2',.8));break;
   case 'glass':m=material('glass',()=>solid(PALETTE.glassDay,.35,{metalness:.05}));break;
   case 'rail':m=material('rail',()=>{const t=brick.map.clone();t.needsUpdate=true;return textured(t,'#ffffff',.88);});uv=[FACADE_TILE.w,FACADE_TILE.h];break;
   case 'stair':m=material('stair',()=>solid('#e4dccb',.82));break;
   case 'roof':m=material('roof',()=>textured(tex.roof,'#ffffff',.9));uv=[4,4];break;
   case 'cutawayCeiling':m=material('ceiling',()=>solid(PALETTE.ceiling,.95));break;
   case 'ground':m=material('ground',()=>lawnMaterial(undefined,tex.grass) as unknown as T.MeshStandardMaterial);object.castShadow=false;break;
   case 'paving':m=material('paving',()=>textured(tex.paving,'#ffffff',.9));uv=[3,3];object.castShadow=false;break;
   case 'sea':case 'road':object.visible=false;return;
  }
  if(!m)return;
  // Keep identity so the LOD cutaway can still find ceilings/roofs by role.
  m.userData.surface=s;object.material=m;
  if(uv){object.updateWorldMatrix(true,false);boxUV(object.geometry,inB?object.matrixWorld:undefined,uv[0],uv[1],s==='rail'?.08:0);}
 });
 // The walk-world road ribbon group is replaced below by UV-mapped roads.
 world.display.traverse(o=>{if(o.name==='Campus roads (OSM)')o.visible=false;});
 // 2. OSM landmarks/background: brick or cream facades with night windows.
 const brickMat=nightGlow(textured(brick.map,'#ffffff',.88),brick.emissive),creamMat=nightGlow(textured(cream.map,'#ffffff',.88),cream.emissive);
 const roofMat=textured(tex.roof,'#ffffff',.9);
 world.display.traverse(group=>{
  if(!group.name.startsWith('Campus exterior '))return;
  const id=group.name.slice('Campus exterior '.length),lm=structure.context.landmarks.find(l=>l.id===id),tone=lm?.tone??'brick';
  group.traverse(o=>{if(!(o instanceof T.Mesh))return;boxUV(o.geometry,undefined,FACADE_TILE.w,FACADE_TILE.h,.08);const g=splitRoof(o.geometry);o.geometry.dispose();o.geometry=g;o.material=[tone==='brick'?brickMat:creamMat,roofMat];});
 });
 // Draw-call budget: one batch per material for all OSM exteriors, per building for stairs/lifts.
 const exteriors=new T.Group();exteriors.name='Campus exteriors (merged)';
 for(const g of [...world.display.children])if(g.name.startsWith('Campus exterior ')){const lm=g.userData.landmark;if(lm)exteriors.userData.landmarks=[...(exteriors.userData.landmarks??[]),lm];exteriors.add(g);}
 world.display.add(exteriors);mergeByMaterial(exteriors);
 const perBuilding=new Map<T.Object3D,T.Object3D[]>();
 world.display.traverse(o=>{if(o.userData.stairGroup||o.name.startsWith('Lift ')){const p=o.parent!;if(!perBuilding.has(p))perBuilding.set(p,[]);perBuilding.get(p)!.push(o);}});
 for(const [parent,groups] of perBuilding){const merged=new T.Group();merged.name='Vertical circulation '+parent.name;merged.userData.stairGroup=true;parent.add(merged);for(const g of groups)merged.add(g);mergeByMaterial(merged);}
 const joins=new T.Group();joins.name='Join walkways (merged)';for(const g of [...world.display.children])if(g.name.startsWith('Join '))joins.add(g);world.display.add(joins);mergeByMaterial(joins);
 const art=new T.Group();art.name='Campus art';art.userData.visualOnly=true;world.display.add(art);
 const box=new T.BoxGeometry(1,1,1);
 // 3. Faculty cornice bands on every walkable floor (world-scale via building frame).
 for(const floor of world.floors){
  const fac=FACULTY[BUILDING_FACULTY[floor.buildingId]??'science'],bands:Piece[]=[],trims:Piece[]=[],outline=floor.data.outline,y=floor.y;
  for(let i=0;i<outline.length;i++){const a=outline[i],b=outline[(i+1)%outline.length],L=Math.hypot(b[0]-a[0],b[1]-a[1]);if(L<2.5)continue;const r=-Math.atan2(b[1]-a[1],b[0]-a[0]);
   bands.push(piece((a[0]+b[0])/2,y+3.36,(a[1]+b[1])/2,L,.18,.34,r));trims.push(piece((a[0]+b[0])/2,y+3.5,(a[1]+b[1])/2,L,.07,.36,r));}
  const g=new T.Group();g.name='Faculty cornice '+floor.data.id;g.userData.visualOnly=true;floor.group.add(g);
  instances(g,box,material('band-'+fac.band,()=>solid(fac.band,.7)),bands,'Faculty colour cornice');instances(g,box,material('trim',()=>solid(PALETTE.cream,.8)),trims,'Cream cornice edge');
 }
 // Roofscape: cream parapet caps and rooftop plant on each building's top storey (display only).
 const caps:Piece[]=[],tanks:Piece[]=[],units:Piece[]=[],rr=rng(99);
 for(const floor of world.floors){
  const top=world.floors.filter(f=>f.buildingId===floor.buildingId).reduce((a,b)=>b.y>a.y?b:a);if(top!==floor)continue;
  const frame=world.frames.get(floor.buildingId)!,pts=floor.data.outline.map(([x,z])=>{const v=new T.Vector3(x,0,z).applyMatrix4(frame);return [v.x,v.z] as Point2;}),y=floor.y+3.7;
  for(let i=0;i<pts.length;i++){const a=pts[i],b=pts[(i+1)%pts.length],L=Math.hypot(b[0]-a[0],b[1]-a[1]);if(L<1.5)continue;caps.push(piece((a[0]+b[0])/2,y+.55,(a[1]+b[1])/2,L+.3,1.1,.32,-Math.atan2(b[1]-a[1],b[0]-a[0])));}
  const xs=pts.map(p=>p[0]),zs=pts.map(p=>p[1]),area=Math.abs(pts.reduce((n,a,i)=>{const b=pts[(i+1)%pts.length];return n+a[0]*b[1]-b[0]*a[1];},0)/2);
  for(let n=0;n<Math.min(14,Math.round(area/400));n++){for(let k=0;k<20;k++){const x=Math.min(...xs)+rr()*(Math.max(...xs)-Math.min(...xs)),z=Math.min(...zs)+rr()*(Math.max(...zs)-Math.min(...zs));if(!inside([x,z],pts)||pts.some((a,i)=>segDist([x,z],a,pts[(i+1)%pts.length])<3))continue;
   if(n%3===0)tanks.push(piece(x,y+1,z,2.4,2,2.4));else units.push(piece(x,y+.5,z,1.6,1,1.1,rr()*3));break;}}
 }
 instances(art,box,solid(PALETTE.cream,.8),caps,'Parapet caps');instances(art,new T.CylinderGeometry(.5,.5,1,10),solid(PALETTE.roofEquip,.6,{metalness:.2}),tanks,'Roof water tanks');instances(art,box,solid('#aab1ad',.6,{metalness:.25}),units,'Roof plant');
 // 4. Ground features: occupancy, roads, crosswalks, beach, hills, trees, props.
 const [gx0,gz0,gx1,gz1]=CAMPUS_GROUND,occ=new Occupancy(gx0,gz0,gx1,gz1);
 for(const floor of world.floors){if(floor.data.level!==1)continue;const frame=world.frames.get(floor.buildingId)!,pts=(floor.data.access?.walkOutline??floor.data.outline).map(([x,z])=>{const v=new T.Vector3(x,0,z).applyMatrix4(frame);return [v.x,v.z] as Point2;});occ.polygon(pts,3);}
 for(const c of structure.connectors)occ.line([c.a,c.b],2.5);
 for(const l of [...structure.context.landmarks,...structure.context.background])occ.polygon(l.polygon,2.5);
 const roads=structure.context.roads.filter(r=>!r.tunnel&&r.points.length>=2);
 for(const r of roads)occ.line(r.points,r.width/2+1.2,3);
 const shore=-232; // 西子灣: sand from the ground edge to here, south of the coastal hill
 const beach:Point2[]=[[gx0,40],[-262,48],[-240,120],[shore,220],[-246,330],[gx0,380]];occ.polygon(beach,0,4);
 // Lawn: worn bands by paths and buildings, and the free-lawn mask for grass tufts (render/ground.ts).
 const mask=groundMask(occ.grid,occ.nx,occ.nz,occ.x0,occ.z0,occ.cell);world.display.userData.groundMask=mask;world.display.userData.occupancy=occ;
 { const lawn=cache.get('ground');if(lawn)setLawnMask(lawn,mask); }
 // Roads (OSM): asphalt with lane markings; footways as paving.
 const roadMats={main:new T.MeshStandardMaterial({map:roadTexture(true),roughness:.92}),side:new T.MeshStandardMaterial({map:roadTexture(false),roughness:.92}),foot:textured(tex.paving,'#ffffff',.9)};
 roadMats.foot.map=tex.paving.clone();roadMats.foot.map.needsUpdate=true;
 const roadGroup=new T.Group();roadGroup.name='Campus roads · OSM';art.add(roadGroup);
 const footKinds=['footway','path','steps','pedestrian','cycleway'];
 const [bx0,bz0,bx1,bz1]=terrain?PLAY_BOUNDS:CAMPUS_GROUND,lift=(x:number,z:number)=>terrain?terrain.heightAt(x,z)-GROUND_Y:0;
 const roadExclusions:Point2[][]=[...[...structure.context.landmarks,...structure.context.background].map(l=>l.polygon),...((world.display.userData.roadExclusions??[]) as Point2[][])];
 for(const f of world.floors)if(f.data.level===1){const frame=world.frames.get(f.buildingId)!;roadExclusions.push((f.data.access?.walkOutline??f.data.outline).map(([x,z])=>{const p=new T.Vector3(x,0,z).applyMatrix4(frame);return [p.x,p.z] as Point2;}));}
 if(terrain){
  const asphalt=new T.MeshStandardMaterial({map:roadTexture(false,false),roughness:.92});
  for(const layer of buildRoadLayers(roads,terrain,[bx0,bz0,bx1,bz1],roadExclusions)){
   const mesh=new T.Mesh(layer.base,layer.foot?roadMats.foot:asphalt);mesh.name=`Road surface ${layer.id}`;mesh.receiveShadow=true;roadGroup.add(mesh);
   if(layer.markings?.attributes.position.count){const marking=new T.Mesh(layer.markings,roads.find(r=>r.id===layer.id)!.width>=7?roadMats.main:roadMats.side);marking.name=`Road markings ${layer.id}`;marking.receiveShadow=true;roadGroup.add(marking);}
  }
 }else for(const r of roads){const pts=r.points;if(pts.length<2)continue;const geo=roadRibbon(pts,r.width);geo.translate(0,.006,0);roadGroup.add(new T.Mesh(geo,footKinds.includes(r.kind)?roadMats.foot:roadMats.main));}
 // Crosswalks share the exact same supporting triangles and stop at building/carve boundaries.
 if(terrain){const g=buildCrosswalkGeometry(roads,terrain,[bx0,bz0,bx1,bz1],roadExclusions);if(g.attributes.position.count){const mesh=new T.Mesh(g,solid(PALETTE.mark,.6));mesh.name='Zebra crossings · terrain surface';mesh.receiveShadow=true;roadGroup.add(mesh);}else g.dispose();}
 // West: sand and shallow sea of 西子灣; the deep sea box is replaced by a two-tone plane.
 const shapeOf=(pts:Point2[])=>new T.Shape(pts.map(([x,z])=>new T.Vector2(x,-z)));
 const sand=new T.Mesh(new T.ShapeGeometry(shapeOf(beach)),textured(tex.sand,'#ffffff',1));sand.rotation.x=-Math.PI/2;sand.position.y=-.045;sand.receiveShadow=true;boxUV(sand.geometry,undefined,6,6);sand.name='西子灣 beach';art.add(sand);
 if(terrain){sand.geometry.rotateX(-Math.PI/2);sand.rotation.x=0;drape(sand.geometry,(x,z)=>Math.max(lift(x,z),terrain.seaLevel+.12-GROUND_Y));}
 const sea=new T.Mesh(new T.PlaneGeometry(2600,3200,1,1),new T.ShaderMaterial({fog:true,uniforms:{...T.UniformsLib.fog,shallow:{value:new T.Color(PALETTE.seaShallow)},deep:{value:new T.Color(PALETTE.seaDeep)},edge:{value:gx0}},
  vertexShader:'#include <fog_pars_vertex>\nvarying vec3 vW;void main(){vec4 w=modelMatrix*vec4(position,1.);vW=w.xyz;vec4 mvPosition=viewMatrix*w;gl_Position=projectionMatrix*mvPosition;\n#include <fog_vertex>\n}',
  fragmentShader:'#include <fog_pars_fragment>\nuniform vec3 shallow;uniform vec3 deep;uniform float edge;varying vec3 vW;void main(){float d=clamp((edge-vW.x)/180.,0.,1.);vec3 c=mix(shallow,deep,smoothstep(0.,1.,d));float foam=step(edge-3.,vW.x);c=mix(c,vec3(1.),foam*.7);gl_FragColor=vec4(c,1.);\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n#include <fog_fragment>\n}'}));
 sea.rotation.x=-Math.PI/2;sea.position.set(gx0-1300+2,-.35,80);if(terrain){sea.geometry.dispose();sea.geometry=new T.PlaneGeometry(6000,6000);sea.position.set(0,terrain.seaLevel,0);(sea.material as T.Material).dispose();sea.material=seaMaterial({origin:terrain.meta.origin,cell:terrain.meta.cell,cols:terrain.meta.cols,rows:terrain.meta.rows,heights:terrain.heights,seaLevel:terrain.seaLevel,groundOffset:GROUND_Y});}sea.name='Taiwan Strait · 西子灣';art.add(sea);
 // 壽山 terrain: one low-poly height field around the campus ground (display only, never collision).
 const hash=(x:number,z:number)=>{const h=Math.sin(x*127.1+z*311.7)*43758.5453;return h-Math.floor(h);};
 const noise=(x:number,z:number)=>{const ix=Math.floor(x),iz=Math.floor(z),fx=x-ix,fz=z-iz,u=fx*fx*(3-2*fx),v=fz*fz*(3-2*fz);const a=hash(ix,iz),b=hash(ix+1,iz),c=hash(ix,iz+1),d=hash(ix+1,iz+1);return a+(b-a)*u+(c-a)*v+(a-b-c+d)*u*v;};
 const fbm=(x:number,z:number)=>noise(x,z)*.55+noise(x*2.1,z*2.1)*.28+noise(x*4.3,z*4.3)*.17;
 const outside=(x:number,z:number)=>Math.max(gx0-x,x-gx1,gz0-z,z-gz1,0);
 const height=(x:number,z:number)=>{if(x<gx0+1)return -8; // sea side sinks under the water plane
  const d=outside(x,z);if(d<=0)return -.5;
  const north=T.MathUtils.smoothstep(-z,-gz0+10,-gz0+260),east=T.MathUtils.smoothstep(x,gx1+10,gx1+240);
  const ridge=Math.max(north*(.55+.45*T.MathUtils.smoothstep(x,-250,100)),east)*95,rise=T.MathUtils.smoothstep(d,0,210);
  return Math.max(0,rise*(ridge*(.55+.45*fbm(x/140,z/140))+fbm(x/40,z/40)*6))-.06;};
 const dem=terrain,N=dem?2:110,span=1900,terrainGeo=new T.PlaneGeometry(span,span,N,N);terrainGeo.rotateX(-Math.PI/2);const tp=terrainGeo.attributes.position,colors:number[]=[];
 const cLow=new T.Color(PALETTE.hillNear),cMid=new T.Color(PALETTE.hillNear),cHigh=new T.Color(PALETTE.hillMid),cFar=new T.Color(PALETTE.hillFar);
 for(let i=0;i<tp.count;i++){const x=tp.getX(i)+(gx0+gx1)/2,z=tp.getZ(i)+(gz0+gz1)/2,h=height(x,z);tp.setXYZ(i,x,h,z);const c=h<4?cLow.clone().lerp(cMid,h/4):h<60?cMid.clone().lerp(cHigh,(h-4)/56):cHigh.clone().lerp(cFar,Math.min(1,(h-60)/60));colors.push(c.r,c.g,c.b);}
 terrainGeo.setAttribute('color',new T.Float32BufferAttribute(colors,3));terrainGeo.computeVertexNormals();
 if(!dem){const terrainMesh=new T.Mesh(terrainGeo,new T.MeshStandardMaterial({vertexColors:true,roughness:1}));terrainMesh.receiveShadow=true;terrainMesh.name='壽山 terrain';art.add(terrainMesh);}else terrainGeo.dispose();
 // Trees: street rows, campus lawns, hill slopes. Four crown colours; palms by the coast.
 const rand=rng(2026),trees:{x:number;z:number;s:number;y:number;kind?:'street'|'lawn';i?:number}[]=[],palms:{x:number;z:number;s:number}[]=[];
 // Keep the arrival view and story gems clear of trunks and crowns.
 occ.polygon([[world.spawn.x-14,world.spawn.z-14],[world.spawn.x+14,world.spawn.z-14],[world.spawn.x+14,world.spawn.z+14],[world.spawn.x-14,world.spawn.z+14]],0,5);
 let streetIndex=0;const addTree=(x:number,z:number,s:number,y=0,kind:'street'|'lawn'='lawn')=>{if(trees.length<4200)trees.push({x,z,s,y,kind,i:kind==='street'?streetIndex++:0});};
 for(const r of roads.filter(r=>!footKinds.includes(r.kind)&&r.width>=6))for(let j=1;j<r.points.length;j++){const a=r.points[j-1],b=r.points[j],L=Math.hypot(b[0]-a[0],b[1]-a[1]),ux=(b[0]-a[0])/L,uz=(b[1]-a[1])/L;
  for(let t=4;t<L;t+=9)for(const side of [-1,1]){const off=r.width/2+2.6,x=a[0]+ux*t-uz*off*side,z=a[1]+uz*t+ux*off*side;if(x<gx0+2||x>gx1-2||z<gz0+2||z>gz1-2)continue;
   if(x<-170&&occ.at(x,z)===0){palms.push({x,z,s:.9+rand()*.3});continue;}if(occ.free(x,z,1.2))addTree(x,z,.85+rand()*.3,0,'street');}}
 for(let z=gz0+4;z<gz1-4;z+=7)for(let x=gx0+4;x<gx1-4;x+=7){const jx=x+(rand()-.5)*5,jz=z+(rand()-.5)*5;
  const campusCore=jx>-200&&jx<170&&jz>-210&&jz<260;if(campusCore&&rand()>.42)continue;if(occ.free(jx,jz,2))addTree(jx,jz,.9+rand()*.5);}
 let hillTrees=0;
 if(dem){// 壽山 forest on the real DTM: above 3 m, off buildings/roads, denser with height.
  const [tx0,tz0,tx1,tz1]=[-900,-1100,900,700];
  for(let n=0;n<60000&&hillTrees<3600;n++){const x=tx0+rand()*(tx1-tx0),z=tz0+rand()*(tz1-tz0),h=lift(x,z);if(h<3||rand()>Math.min(1,h/25))continue;if(x>gx0&&x<gx1&&z>gz0&&z<gz1&&!occ.free(x,z,2))continue;trees.push({x,z,s:1.6+rand()*1.2,y:h+GROUND_Y-.3});hillTrees++;}
 }else for(let n=0;n<30000&&hillTrees<3200;n++){const x=gx0+(rand()*1.3-.05)*(gx1-gx0+500),z=gz0-450+rand()*(gz1-gz0+700),h=height(x,z);if(h<1.5||h>140||outside(x,z)<6)continue;trees.push({x,z,s:1.6+rand()*1.2,y:h-.3});hillTrees++;}
 // Triangle budget: campus trees get a trunk + 1–2 crowns with shadows; hill trees one crown, no shadow.
 const mobile=typeof matchMedia!=='undefined'&&matchMedia('(pointer:coarse)').matches;
 const trunkGeo=new T.CylinderGeometry(.14,.22,1,5,1,true),crownGeo=new T.IcosahedronGeometry(1,0);
 // Crown volume: baked vertical AO (underside 0.68 → top 1.0) so a crown reads as a ball, not a flat blob.
 {const p=crownGeo.attributes.position,c=new Float32Array(p.count*3);for(let i=0;i<p.count;i++){const v=.68+.32*T.MathUtils.smoothstep(p.getY(i),-1,.9);c.set([v,v,v],i*3);}crownGeo.setAttribute('color',new T.BufferAttribute(c,3));}
 const trunkPieces:Piece[]=[],crowns:Piece[][]=[[],[],[],[]],hillCrowns:Piece[][]=[[],[],[],[]];
 // v4: campus trees are leaf-card families (render/foliage.ts); the hill forest keeps one cheap crown each.
 const sourceSpots=assignTreeYaw(campusTreeSpots(trees,rand));
 const treeSeat=terrainSeatAt(structure,lift),worldSpots=sourceSpots.map(t=>({...t,y:t.y+(t.f==='hill'?0:treeSeat(t.x,t.z))}));
 const spots=filterTreeSpots(worldSpots,(world.display.userData.treeBores??[]) as TreeBore[],terrain?(x,z)=>terrain.surfaceAt(x,z):undefined);
 const treeGroup=buildTrees(spots,leafDensity??(mobile?.5:1));treeGroup.userData.terrainSeated=true;art.add(treeGroup);
 art.userData.treeFiltering={before:sourceSpots.length,after:spots.length,removed:worldSpots.filter(t=>!spots.includes(t)).map(t=>({x:t.x,y:t.y,z:t.z,f:t.f,s:t.s,yaw:t.yaw}))};
 const crownMats=PALETTE.trees.map(c=>solid(c,.9,{flatShading:true,vertexColors:true}));
 instances(art,trunkGeo,solid(PALETTE.trunk),trunkPieces,'Tree trunks');
 // Per-tree tint so neighbouring crowns of one colour still differ (art-direction-v3 foliage.1–6).
 const tint=(m:T.InstancedMesh|undefined,hill:boolean)=>{if(!m)return;const c=new T.Color();for(let i=0;i<m.count;i++){const k=rand();c.setHSL(0,0,1);c.offsetHSL((k-.5)*.04,(rand()-.5)*.12,(hill?-.08:0)+(rand()-.5)*.12);m.setColorAt(i,c);}m.instanceColor!.needsUpdate=true;};
hillCrowns.forEach((p,i)=>tint(instances(art,crownGeo,crownMats[i],p,'Hill tree crowns',false),true));
 const palmTrunk:Piece[]=[],palmLeaf:Piece[]=[];const leafGeo=new T.ConeGeometry(.35,3,4);leafGeo.rotateX(Math.PI/2);leafGeo.translate(0,0,1.5);
 for(const p of palms){const h=5.5*p.s;palmTrunk.push(piece(p.x,h/2,p.z,.7*p.s,h,.7*p.s));for(let k=0;k<6;k++){const o=new T.Euler(-.45,k*Math.PI/3+p.x,0,'YXZ');palmLeaf.push({position:new T.Vector3(p.x,h,p.z),scale:new T.Vector3(p.s,p.s,p.s),rotation:o});}}
 instances(art,trunkGeo,solid(PALETTE.palmTrunk),palmTrunk,'Palm trunks');instances(art,leafGeo,solid(PALETTE.palmLeaf,.85,{flatShading:true}),palmLeaf,'Palm fronds');
 // Street furniture: lamps every 25 m, benches and bike racks near building entrances.
 const lampPole:Piece[]=[],lampHead:Piece[]=[],benches:Piece[]=[],racks:Piece[]=[],bins:Piece[]=[];
 for(const r of roads.filter(r=>!footKinds.includes(r.kind)&&r.width>=6))for(let j=1;j<r.points.length;j++){const a=r.points[j-1],b=r.points[j],L=Math.hypot(b[0]-a[0],b[1]-a[1]),ux=(b[0]-a[0])/L,uz=(b[1]-a[1])/L;
  for(let t=12;t<L;t+=25){const off=r.width/2+1.1,x=a[0]+ux*t+uz*off,z=a[1]+uz*t-ux*off;if(occ.at(x,z)===1||x<gx0||x>gx1)continue;lampPole.push(piece(x,2.3,z,.12,4.6,.12));lampHead.push(piece(x,4.65,z,.5,.28,.5));}}
 for(const floor of world.floors){if(floor.data.level!==1||!floor.data.access?.entry)continue;const frame=world.frames.get(floor.buildingId)!,e=floor.data.access.entry;const p=new T.Vector3(e[0],0,e[1]).applyMatrix4(frame);
  for(const [dx,dz,kind] of [[3,2.5,'bench'],[-3,2.5,'rack'],[4.5,-1,'bin']] as const){const x=p.x+dx,z=p.z+dz;if(occ.at(x,z)===1&&kind!=='bin')continue;
   if(kind==='bench')benches.push(piece(x,.45,z,1.8,.12,.5),piece(x,.75,z-.22,1.8,.45,.08));else if(kind==='rack')for(let k=0;k<5;k++)racks.push(piece(x+k*.6-1.2,.4,z,.06,.8,.9));else bins.push(piece(x,.45,z,.5,.9,.5));}}
 instances(art,box,solid('#3e4a50',.5,{metalness:.3}),lampPole,'Lamp posts');
 const glow=solid('#fff4dc',.6,{emissive:'#ffd79a',emissiveIntensity:0});NIGHT_MATERIALS.add(glow);instances(art,box,glow,lampHead,'Lamp heads',false);
 const halo=new T.MeshBasicMaterial({color:'#ffd79a',transparent:true,opacity:0,blending:T.AdditiveBlending,depthWrite:false,visible:false});NIGHT_FADE.set(halo,.35);
 const haloGeo=new T.CircleGeometry(1,20);haloGeo.rotateX(-Math.PI/2);
 instances(art,haloGeo,halo,lampPole.map(p=>piece(p.position.x,-.02,p.position.z,1.8,1,1.8)),'Lamp glow pools',false);
 art.userData.treeSpots=sourceSpots.filter((_,i)=>spots.includes(worldSpots[i])).map(t=>[t.x,t.y,t.z]);art.userData.rackSpots=racks.filter((_,i)=>i%5===2).map(p=>[p.position.x,p.position.z]);
 art.userData.groundAt=(x:number,z:number)=>terrain?terrain.heightAt(x,z):GROUND_Y;
 instances(art,box,solid('#b07d4f',.75),benches,'Benches');instances(art,box,solid('#5d6b70',.45,{metalness:.4}),racks,'Bike racks');instances(art,box,solid('#2f6e5a',.7),bins,'Bins');
 const lmCaps:Piece[]=[];
 for(const l of [...structure.context.landmarks,...structure.context.background]){const h=Math.max(4,l.storeys*3.6);if(!l.polygon.every(([x,z])=>x>gx0&&x<gx1&&z>gz0&&z<gz1))continue;
  for(let i=0;i<l.polygon.length;i++){const a=l.polygon[i],b=l.polygon[(i+1)%l.polygon.length],L=Math.hypot(b[0]-a[0],b[1]-a[1]);if(L<1)continue;lmCaps.push(piece((a[0]+b[0])/2,h+.45,(a[1]+b[1])/2,L+.3,.9,.35,-Math.atan2(b[1]-a[1],b[0]-a[0])));}}
 instances(art,box,solid(PALETTE.cream,.8),lmCaps,'Landmark parapets');
 addLandmarkFeatures(world,structure,art);
 if(terrain)seatOnTerrain(art,structure,lift);
 world.display.updateMatrixWorld(true);
 world.display.userData.obstacles=artObstacles(art);
}

/** Read the final instance transforms after terrain seating, so collision follows the
 * visible tree trunk rather than the canopy bounding box. No DOM or renderer required. */
export function artObstacles(art:T.Object3D):Obstacle[]{
 const out:Obstacle[]=[],m=new T.Matrix4(),p=new T.Vector3(),q=new T.Quaternion(),s=new T.Vector3(),e=new T.Euler(0,0,0,'YXZ');
 const trunks:Record<string,[number,number]>={banyan:[.45,3.4],flame:[.28,2.6],almond:[.22,8.2],hill:[.18,2]};
 art.updateWorldMatrix(true,true);
 art.traverse(o=>{
  if(!(o instanceof T.InstancedMesh))return;
  const family=/^Tree crowns (\w+) /.exec(o.name)?.[1],trunk=family?trunks[family]:undefined;
  const furniture=['Lamp posts','Benches','Bike racks','Bins'].includes(o.name),palm=o.name==='Palm trunks';
  const loadedProp=['Parked bicycles','Traffic cones','Formosan macaques'].includes(o.name);
  if(!trunk&&!furniture&&!palm&&!loadedProp)return; // foliage, shrubs, roofs and light halos do not block movement
  if(loadedProp&&!o.geometry.boundingBox)o.geometry.computeBoundingBox();
  for(let i=0;i<o.count;i++){
   o.getMatrixAt(i,m);m.premultiply(o.matrixWorld);m.decompose(p,q,s);e.setFromQuaternion(q,'YXZ');
   const id=`art:${o.name}:${i}`;
   if(loadedProp&&o.geometry.boundingBox){
    const center=o.geometry.boundingBox.getCenter(new T.Vector3()).applyMatrix4(m),half=o.geometry.boundingBox.getSize(new T.Vector3()).multiply(s).multiplyScalar(.5);
    const cylinder=o.name!=='Parked bicycles',r=Math.max(Math.abs(half.x),Math.abs(half.z));
    out.push({id,shape:cylinder?'cylinder':'box',center:center.toArray(),half:cylinder?[r,Math.abs(half.y),r]:[Math.abs(half.x),Math.abs(half.y),Math.abs(half.z)],yaw:e.y});
   }
   else if(trunk){const radius=trunk[0]*Math.max(s.x,s.z),h=trunk[1]*s.y;out.push({id,shape:'cylinder',center:[p.x,p.y+h/2,p.z],half:[radius,h/2,radius]});}
   else if(palm){const radius=.22*Math.max(s.x,s.z);out.push({id,shape:'cylinder',center:p.toArray(),half:[radius,s.y/2,radius]});}
   else out.push({id,shape:'box',center:p.toArray(),half:[s.x/2,s.y/2,s.z/2],yaw:e.y});
  }
 });
 return out;
}

/** Lift flat-ground props onto the DEM. Anything inside an exterior footprint (roof plant, parapets, landmark
 * features) rides with that building's seat height; hill trees already carry their own y. */
function terrainSeatAt(structure:CampusStructure,lift:(x:number,z:number)=>number){
 const blocks=[...structure.context.landmarks,...structure.context.background].filter(b=>b.polygon.length>=3).map(b=>({poly:b.polygon,base:Math.min(...b.polygon.map(([x,z])=>lift(x,z)))}));
 return (x:number,z:number)=>{for(const b of blocks)if(inPolygon([x,z],b.poly))return b.base;return lift(x,z);};
}
export function seatOnTerrain(art:T.Group,structure:CampusStructure,lift:(x:number,z:number)=>number){
 const liftAt=terrainSeatAt(structure,lift);
 const m=new T.Matrix4(),p=new T.Vector3(),q=new T.Quaternion(),sc=new T.Vector3();
 art.updateMatrixWorld(true);
 const seat=(o:T.Object3D)=>{
  if(o.userData.terrainSeated)return;
  if(/^Hill tree|^Tree crowns hill |Taiwan Strait|西子灣 beach|Campus roads/.test(o.name))return;
  if(o instanceof T.InstancedMesh){
   for(let i=0;i<o.count;i++){o.getMatrixAt(i,m);m.decompose(p,q,sc);p.y+=liftAt(p.x,p.z);m.compose(p,q,sc);o.setMatrixAt(i,m);}
   o.instanceMatrix.needsUpdate=true;o.computeBoundingSphere();o.computeBoundingBox();
  }else if(o instanceof T.Mesh){const c=new T.Box3().setFromObject(o).getCenter(new T.Vector3());o.position.y+=liftAt(c.x,c.z);}
  else for(const c of [...o.children])seat(c); // groups of features spread over the campus: seat each piece
 };
 for(const o of [...art.children])seat(o);
}

function canvasSign(lines:string[],w:number,h:number,vertical:boolean){
 const c=document.createElement('canvas');c.width=w;c.height=h;const g=c.getContext('2d')!;g.fillStyle='#f1e8d6';g.fillRect(0,0,w,h);g.fillStyle='#173e49';g.textAlign='center';g.textBaseline='middle';
 if(vertical){const t=lines[0],step=h/(t.length+.6);g.font=`700 ${Math.floor(step*.78)}px "Noto Sans TC",serif`;[...t].forEach((ch,i)=>g.fillText(ch,w/2,step*(i+.8)));}
 else{g.font=`700 ${Math.floor(h*.42)}px "Noto Sans TC",sans-serif`;g.fillText(lines[0],w/2,h/2);}
 const tex=new T.CanvasTexture(c);tex.colorSpace=T.SRGBColorSpace;return tex;
}
/** Recognisable silhouettes (art-direction.md §4), procedural and display-only. */
function addLandmarkFeatures(world:WalkWorld,structure:CampusStructure,art:T.Group){
 if(typeof document==='undefined')return;
 const g=new T.Group();g.name='Landmark features';art.add(g);const brick=solid(PALETTE.brickDark,.85),cream=solid(PALETTE.cream,.8),stone=solid('#bfb6a3',.9),darkStone=solid('#8d8677',.9);
 const add=(geo:T.BufferGeometry,m:T.Material,x:number,y:number,z:number,ry=0)=>{const o=new T.Mesh(geo,m);o.position.set(x,y,z);o.rotation.y=ry;o.castShadow=true;o.receiveShadow=true;g.add(o);return o;};
 // 校碑 by the sea wall: 21.2 m brick monolith with a vertical cream nameplate (lit at night).
 const gate:Point2=[-232,170];add(new T.BoxGeometry(2.6,21.2,1.6),brick,gate[0],10.6,gate[1]);add(new T.BoxGeometry(1.6,14,1.2),brick,gate[0]+2.2,7,gate[1]);
 const plate=new T.MeshStandardMaterial({map:canvasSign(['國立中山大學'],128,768,true),roughness:.7,emissive:'#ffffff',emissiveIntensity:0});plate.emissiveMap=plate.map;NIGHT_MATERIALS.add(plate);
 add(new T.PlaneGeometry(1.5,9),plate,gate[0]+1.32,13,gate[1],Math.PI/2);
 // 西子灣隧道 west portal: stone arch set into a hill mound, facing along the tunnel road.
 const tun=structure.context.roads.find(r=>r.tunnel&&r.points.length>=2&&r.name?.includes('隧道'));
 if(tun){const end=tun.points.at(-1)!,prev=tun.points.at(-2)!,ang=Math.atan2(end[1]-prev[1],end[0]-prev[0]);
  const shape=new T.Shape();shape.moveTo(-8,0);shape.lineTo(8,0);shape.lineTo(8,10);shape.lineTo(-8,10);shape.lineTo(-8,0);const hole=new T.Path();hole.moveTo(-3,0);hole.lineTo(-3,3.5);hole.absarc(0,3.5,3,Math.PI,0,true);hole.lineTo(3,0);hole.lineTo(-3,0);shape.holes.push(hole);
  const portal=new T.ExtrudeGeometry(shape,{depth:1.6,bevelEnabled:false});portal.translate(0,0,-.8);const o=add(portal,stone,end[0],0,end[1],-ang-Math.PI/2);
  add(new T.BoxGeometry(2,1.6,1.8),darkStone,end[0],9.4,end[1],-ang-Math.PI/2);void o;
  const mound=new T.Mesh(new T.IcosahedronGeometry(1,1),solid(PALETTE.hillNear,1,{flatShading:true}));mound.scale.set(16,11,22);mound.position.set(end[0]-Math.cos(ang)*-14,-1,end[1]-Math.sin(ang)*-14);g.add(mound);
  const dark=add(new T.PlaneGeometry(5.8,6.4),solid('#1b2426',1),end[0]+Math.cos(ang)*.9,3.2,end[1]+Math.sin(ang)*.9,-ang+Math.PI/2);void dark;}
 // 圖資大樓 crown: octagonal pyramid roof with four cream corner posts.
 const il=structure.context.landmarks.find(l=>l.id==='IL');
 if(il){const xs=il.polygon.map(p=>p[0]),zs=il.polygon.map(p=>p[1]),cx=(Math.min(...xs)+Math.max(...xs))/2,cz=(Math.min(...zs)+Math.max(...zs))/2,top=il.storeys*3.6,r=Math.min(Math.max(...xs)-Math.min(...xs),Math.max(...zs)-Math.min(...zs))*.32;
  add(new T.CylinderGeometry(r*.9,r*.9,4,8),cream,cx,top+2,cz);add(new T.ConeGeometry(r,7,8),solid('#5a5d60',.75),cx,top+7.5,cz);
  for(const [dx,dz] of [[1,1],[1,-1],[-1,1],[-1,-1]])add(new T.BoxGeometry(1.2,6,1.2),cream,cx+dx*r*.8,top+3,cz+dz*r*.8);
  const crownGlow=solid('#ffd37a',.6,{emissive:'#ffd37a',emissiveIntensity:0});NIGHT_MATERIALS.add(crownGlow);add(new T.CylinderGeometry(r*.92,r*.92,.6,8),crownGlow,cx,top+3.6,cz);}
 // 行政大樓 portico on the south face: four columns and a cream canopy.
 const ad=structure.context.landmarks.find(l=>l.id==='AD');
 if(ad){const xs=ad.polygon.map(p=>p[0]),zs=ad.polygon.map(p=>p[1]),cx=(Math.min(...xs)+Math.max(...xs))/2,south=Math.max(...zs);
  for(const dx of [-6,-2,2,6])add(new T.BoxGeometry(1,10,1),cream,cx+dx,5,south+3.5);add(new T.BoxGeometry(15,.8,4.6),cream,cx,10.4,south+2.1);add(new T.BoxGeometry(14,.5,6),solid(PALETTE.plaza,.9),cx,.2,south+5);}
 // 國徽 plaza in the courtyard: raised disc with 12 rays, flagpoles around.
 const plaza:Point2=[-67,-27];const disc=add(new T.CylinderGeometry(7,7,.2,36),solid(PALETTE.plaza,.9),plaza[0],.06,plaza[1]);disc.castShadow=false;
 add(new T.CylinderGeometry(1.4,1.4,.24,24),solid('#2f5fa8',.6),plaza[0],.1,plaza[1]);
 for(let i=0;i<12;i++){const a=i*Math.PI/6;add(new T.BoxGeometry(.25,.23,2.6),solid('#ffffff',.6),plaza[0]+Math.cos(a)*2.9,.1,plaza[1]+Math.sin(a)*2.9,-a+Math.PI/2);}
 for(let i=0;i<8;i++){const a=i*Math.PI/4+.2;add(new T.CylinderGeometry(.06,.08,7,6),solid('#d8dcdc',.4,{metalness:.5}),plaza[0]+Math.cos(a)*9,3.5,plaza[1]+Math.sin(a)*9);}
}

/** GLB props (characters live in walkthrough.ts): monkeys, bicycles, cones, sailboats as instances. */
export async function addCampusProps(world:WalkWorld,load:(url:string)=>Promise<{scene:T.Object3D}>,asset:(p:string)=>string,alive:()=>boolean=()=>true,support?:SupportAt):Promise<Obstacle[]>{
 const art=world.display.getObjectByName('Campus art');if(!art)return [];
 const obstacles:Obstacle[]=[],ground=art.userData.groundAt as ((x:number,z:number)=>number)|undefined;
 // One InstancedMesh per prop: the GLB's parts are baked into one geometry with their material colour as a
 // vertex colour (v4 draw budget: a multi-part prop costs one draw instead of one per part).
 const toInstances=async(file:string,matrices:T.Matrix4[],name:string,tint?:(i:number)=>T.Color|undefined)=>{
  if(!matrices.length||!alive())return;const gltf=await load(asset('models/campus/'+file)).catch(e=>{console.warn(`campus prop ${file}`,e);return undefined;});if(!gltf)return;
  const parts:T.BufferGeometry[]=[];let metalStart=-1;gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse(o=>{if(!(o instanceof T.Mesh))return;const mat=(Array.isArray(o.material)?o.material[0]:o.material) as T.MeshStandardMaterial;const g0=o.geometry.clone().applyMatrix4(o.matrixWorld);const g=g0.index?g0.toNonIndexed():g0;
   for(const k of Object.keys(g.attributes))if(k!=='position'&&k!=='normal')g.deleteAttribute(k);
   const c=mat.color??new T.Color('#ffffff'),n=g.attributes.position.count,col=new Float32Array(n*3);
   // Tintable parts (bicycle frames) are flagged with alpha-less white so the instance colour shows through.
   const tintable=!!tint&&mat.metalness>.1;for(let i=0;i<n;i++)col.set(tintable?[1,1,1]:[c.r,c.g,c.b],i*3);g.setAttribute('color',new T.BufferAttribute(col,3));
   if(tintable&&metalStart<0)metalStart=0;parts.push(g);});
  gltf.scene.traverse(o=>{if(o instanceof T.Mesh){o.geometry.dispose();(Array.isArray(o.material)?o.material:[o.material]).forEach(m=>m.dispose());}});
  if(!alive()||!parts.length){parts.forEach(g=>g.dispose());return;}
  const geo=mergeGeometries(parts,false);parts.forEach(g=>g.dispose());if(!geo)return;
  const group=new T.Group();group.name=name;art.add(group);
  const inst=new T.InstancedMesh(geo,new T.MeshStandardMaterial({vertexColors:true,roughness:.8}),matrices.length);inst.name=name;
  const p=new T.Vector3(),q=new T.Quaternion(),s=new T.Vector3(),seated=new T.Matrix4();
  matrices.forEach((m,i)=>{seated.copy(m);if(name!=='Sailboats'){seated.decompose(p,q,s);const reference=ground?.(p.x,p.z)??p.y;p.y=support?.(p.x,p.z,reference)??reference;seated.compose(p,q,s);}inst.setMatrixAt(i,seated);});
  if(tint){for(let i=0;i<matrices.length;i++)inst.setColorAt(i,tint(i)??new T.Color('#ffffff'));}
  inst.castShadow=true;inst.receiveShadow=true;inst.computeBoundingSphere();group.add(inst);obstacles.push(...artObstacles(group));
  return group;
 };
 const M=(x:number,y:number,z:number,ry=0,s=1)=>new T.Matrix4().compose(new T.Vector3(x,y,z),new T.Quaternion().setFromEuler(new T.Euler(0,ry,0)),new T.Vector3(s,s,s));
 const rand=rng(18);const spots=(art.userData.treeSpots??[]) as [number,number,number][];
 const monkeySpots=spots.filter(([x,y,z])=>y>.5&&y<25&&x>-150&&x<260&&z<120).sort(()=>rand()-.5).slice(0,12);
 for(const [x,z] of [[95,40],[100,62],[-60,-150],[-80,-148],[150,-200],[160,-190]] as Point2[])monkeySpots.push([x,0,z]);
 await toInstances('monkey.glb',monkeySpots.map(([x,y,z])=>M(x+1.6,y,z+.8,rand()*6,1.1)),'Formosan macaques');
 const racks=(art.userData.rackSpots??[]) as Point2[],colours=['#2f5fa8','#e04b3a','#f2c94c','#173e49','#ffffff'];
 await toInstances('bicycle.glb',racks.flatMap(([x,z])=>[-1.2,-.6,0,.6,1.2].filter(()=>rand()<.6).map(dx=>M(x+dx,0,z,Math.PI/2))),'Parked bicycles',i=>new T.Color(colours[i%colours.length]));
 await toInstances('cone.glb',[[-226,166],[-224,172],[-222,178]].map(([x,z])=>M(x,0,z)),'Traffic cones');
 const boats=await toInstances('sailboat.glb',[0,1,2,3,4].map(i=>M(-420-i*110,-.3,40+i*85,i)),'Sailboats');
 if(boats)boats.userData.drift=[0,1,2,3,4].map(i=>({x:-420-i*110,z:40+i*85,r:30+i*8,phase:i*1.3}));
 return obstacles;
}
/** Per-frame ambient motion (sailboats drift on slow ellipses). */
export function animateCampus(world:WalkWorld,time:number){
 const boats=world.display.getObjectByName('Sailboats');const drift=boats?.userData.drift as {x:number;z:number;r:number;phase:number}[]|undefined;if(!boats||!drift)return;
 const m=new T.Matrix4();
 boats.traverse(o=>{if(!(o instanceof T.InstancedMesh))return;drift.forEach((d,i)=>{const t=time*.00004+d.phase;m.compose(new T.Vector3(d.x+Math.cos(t)*d.r,-.3+Math.sin(time*.0012+i)*.15,d.z+Math.sin(t)*d.r*.5),new T.Quaternion().setFromEuler(new T.Euler(Math.sin(time*.001+i)*.04,-t,0)),new T.Vector3(1,1,1));o.setMatrixAt(i,m);});o.instanceMatrix.needsUpdate=true;});
}
export type { WorldFloor };
