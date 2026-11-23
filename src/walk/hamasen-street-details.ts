import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { CampusStructure, Point2 } from '../walk-types';
import { geometryFootprints, projectRoadGeometry, roadRibbon, surfaceCutters } from '../world/road-surface';
import { inPolygon, type Terrain } from '../world/terrain';
import type { TunnelProfile } from '../world/tunnel-surface';

/** East lintel from the documented right-to-left inscription on the historic plaque. */
export function hamasenEastPortalDetails(profile:TunnelProfile,landmarks:T.Group){
 const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=166;
 const ink=canvas.getContext('2d')!;
 ink.fillStyle='#292c2a';ink.fillRect(0,0,canvas.width,canvas.height);
 ink.strokeStyle='#8d7654';ink.lineWidth=3;ink.strokeRect(8,8,1008,150);
 ink.fillStyle='#dfc184';ink.font='bold 112px serif';ink.textAlign='center';ink.textBaseline='middle';
 [...'道隧灣子西'].forEach((glyph,i)=>ink.fillText(glyph,192+i*160,84));
 const texture=new T.CanvasTexture(canvas);texture.colorSpace=T.SRGBColorSpace;
 const plaque=new T.Mesh(new T.PlaneGeometry(6.18,.89),new T.MeshBasicMaterial({map:texture}));
 const outward=new T.Vector3(Math.sin(profile.eastYaw),0,Math.cos(profile.eastYaw));
 plaque.name='西子灣隧道東口門額';plaque.rotation.y=profile.eastYaw;
 plaque.position.copy(profile.east).addScaledVector(outward,.205).add(new T.Vector3(0,7.74,0));
 landmarks.add(plaque);

 // The portal is shaded by the hill. Blend the lighting back to the existing
 // tunnel palette before the first bend. Geometry and collision stay shared.
 landmarks.getObjectByName('Full Sisihwan tunnel')?.traverse(object=>{
  if(!(object instanceof T.Mesh)||Array.isArray(object.material))return;
  const position=object.geometry.getAttribute('position'),color=new Float32Array(position.count*3);
  for(let i=0;i<position.count;i++){
   const depth=(profile.east.x-position.getX(i))*outward.x+(profile.east.z-position.getZ(i))*outward.z;
   const shadow=T.MathUtils.smoothstep(depth,-.25,7)*(1-T.MathUtils.smoothstep(depth,28,55));
   const light=1-.66*shadow;
   color.set([light,light,light],i*3);
  }
  object.geometry.setAttribute('color',new T.BufferAttribute(color,3));
  object.material.vertexColors=true;object.material.needsUpdate=true;
 });
 const lampDistances=[7,13,19,25];
 const lamps=new T.InstancedMesh(new T.CircleGeometry(.12,12),new T.MeshBasicMaterial({color:'#f1dfa9'}),lampDistances.length);
 const fixture=new T.Object3D();fixture.rotation.x=Math.PI/2;
 for(const [i,depth] of lampDistances.entries()){
  const section=profile.sections.reduce((a,b)=>Math.abs(b.distance-profile.length+depth)<Math.abs(a.distance-profile.length+depth)?b:a);
  fixture.position.copy(section.position);fixture.position.y+=profile.height-.045;
  fixture.updateMatrix();lamps.setMatrixAt(i,fixture.matrix);
 }
 lamps.name='Hamasen east vault lights';lamps.computeBoundingSphere();landmarks.add(lamps);
}

export function hamasenStationBoard(exit:number,width:number,height:number){
 const canvas=document.createElement('canvas');canvas.width=768;canvas.height=146;
 const context=canvas.getContext('2d')!;
 context.fillStyle='#deded4';context.fillRect(0,0,768,146);
 context.fillStyle='#49565a';context.fillRect(0,94,768,52);
 context.fillStyle='#c37735';context.beginPath();context.arc(56,61,29,0,Math.PI*2);context.fill();
 context.textAlign='center';context.textBaseline='middle';
 context.fillStyle='#fff4e4';context.font='bold 25px sans-serif';context.fillText('O1',56,62);
 context.fillStyle='#243539';context.font='bold 64px sans-serif';context.fillText('哈瑪星站',370,55);
 context.fillStyle='#f3f2ec';context.font='bold 31px sans-serif';context.fillText('Hamasen Station',370,121);
 context.fillStyle='#d8a62d';context.font='bold 109px sans-serif';context.fillText(String(exit),703,70);
 const texture=new T.CanvasTexture(canvas);texture.colorSpace=T.SRGBColorSpace;
 const material=new T.MeshBasicMaterial({map:texture});
 return new T.Mesh(new T.PlaneGeometry(width,height),material);
}

/**
 * Linhai 2nd Road has narrow concrete frontage strips and a curbside signal
 * at Shoushan Street in the ground photograph used for the district survey.
 * Sidewalk offsets use the OSM centreline and modelled road width.
 */
export function hamasenStreetDetails(context:CampusStructure['context'],terrain:Terrain){
 const group=new T.Group();group.name='Hamasen Linhai curb details';group.userData.terrainSeated=true;
 const district=context.hamasen?.polygon;
 if(!district)return group;
 const streets=context.roads.filter(road=>road.district==='hamasen'&&!road.bridge&&!road.tunnel);
 const frontages=streets.filter(road=>road.name==='臨海二路'&&!road.sidewalk);
 const pavementCuts=streets.flatMap(road=>{
  const ribbon=roadRibbon(road.points,road.width);
  const ring=geometryFootprints(ribbon);ribbon.dispose();return ring;
 });
 const cutters=surfaceCutters([...pavementCuts,...context.background.filter(b=>b.district==='hamasen').map(b=>b.polygon)]);
 const offset=(points:Point2[],amount:number)=>points.map((p,i):Point2=>{
  const before=points[Math.max(0,i-1)],after=points[Math.min(points.length-1,i+1)];
  const dx=after[0]-before[0],dz=after[1]-before[1],length=Math.hypot(dx,dz)||1;
  return [p[0]-dz/length*amount,p[1]+dx/length*amount];
 });
 const stripe=(lines:Point2[][],width:number,height:number,color:string)=>{
  const geometry=lines.map(points=>{
   const flat=roadRibbon(points,width);
   const mesh=projectRoadGeometry(flat,terrain,{offset:height,cutters,accept:(x,z)=>inPolygon([x,z],district)});
   flat.dispose();return mesh;
  });
  const visible=geometry.filter(g=>g.getAttribute('position').count>0);
  if(visible.length){
   const merged=mergeGeometries(visible);
   if(merged){
    const mesh=new T.Mesh(merged,new T.MeshStandardMaterial({color,roughness:.96}));
    mesh.receiveShadow=true;group.add(mesh);
   }
  }
  for(const part of geometry)part.dispose();
 };
 const roadEdges=(margin:number)=>frontages.flatMap(r=>[-1,1].map(side=>offset(r.points,side*(r.width/2+margin))));
 stripe(roadEdges(.92),1.8,.009,'#b6b3a9');
 stripe(roadEdges(.105),.19,.015,'#888b86');

 // Signal and luminaires photographed at Linhai 2nd Road × Shoushan Street.
 const corner:Point2=[417.85,306.68];
 const ground=terrain.heightAt(...corner);
 const metal=new T.MeshStandardMaterial({color:'#7a898a',roughness:.82});
 const dark=new T.MeshStandardMaterial({color:'#3a494b',roughness:.81});
 const steel=(a:T.Vector3,b:T.Vector3,width:number)=>{
  const axis=b.clone().sub(a),beam=new T.Mesh(new T.CylinderGeometry(width,width,axis.length(),6),metal);
  beam.position.copy(a).lerp(b,.5);beam.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),axis.normalize());
  group.add(beam);
 };
 const at=(x:number,y:number,z:number)=>new T.Vector3(corner[0]+x,ground+y,corner[1]+z);
 steel(at(0,0,0),at(0,6.2,0),.105);
 steel(at(0,4.72,0),at(2.1,4.77,-3.42),.048);
 steel(at(0,5.8,0),at(1.34,6.21,-2.18),.035);
 const lamp=new T.Mesh(new T.BoxGeometry(.26,.105,.61),metal);
 lamp.position.copy(at(1.37,6.19,-2.25));lamp.rotation.y=-.54;group.add(lamp);
 const signal=new T.Mesh(new T.BoxGeometry(.23,.27,1.07),dark);
 signal.position.copy(at(2.08,4.65,-3.37));signal.rotation.y=-.54;group.add(signal);
 for(let i=-1;i<=1;i++){
  const lens=new T.Mesh(new T.CylinderGeometry(.075,.078,.10,9),dark);
  lens.rotation.z=Math.PI/2;lens.rotation.y=-.54;
  lens.position.copy(at(2.19+.14*i,4.65,-3.36-.22*i));group.add(lens);
 }
 return group;
}
