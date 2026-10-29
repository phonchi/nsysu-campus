/** Full shipped-road audit. Writes independent v6 evidence, never modifies inputs. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import * as T from 'three';
import { loadTerrain } from '../tests/terrain-fixture';
import { buildRoadLayers,roadRibbon,clippedRoadPaths,projectRoadGeometry,buildCrosswalkGeometry,crosswalkStripes } from '../src/world/road-surface';
import { PLAY_BOUNDS,GROUND_Y } from '../src/world/terrain';
import type { CampusStructure } from '../src/walk-types';
const out='artifacts/v6/surfaces';fs.mkdirSync(`${out}/comparison`,{recursive:true});
const terrain=loadTerrain(),structure=JSON.parse(fs.readFileSync('public/data/walkthrough/campus-structure.json','utf8')) as CampusStructure;
const placements=JSON.parse(fs.readFileSync('public/models/landmarks/placements.json','utf8'));
const tunnel=placements.tunnel,c=Math.cos(tunnel.yaw),s=Math.sin(tunnel.yaw),len=(tunnel.walkableLength??20)+2;
terrain.carves=[[[-5,2],[5,2],[5,-len],[-5,-len]].map(([x,z])=>[tunnel.centroid[0]+x*c+z*s,tunnel.centroid[1]-x*s+z*c])];
const exclude=structure.context.landmarks.concat(structure.context.background).map(b=>b.polygon);
for(const [id,p] of Object.entries(structure.placements)){
 const data=JSON.parse(fs.readFileSync(`public/data/walkthrough/${id}.json`,'utf8'));
 const f=data.floors.find((f:{level:number})=>f.level===1);const c=Math.cos(p.rotation),s=Math.sin(p.rotation);
 exclude.push(f.outline.map(([x,z]:[number,number])=>[p.x+p.scale*(x*c+z*s),p.z+p.scale*(-x*s+z*c)]));
}
function oldHeight(x:number,z:number){
 const {origin,cell,cols,rows}=terrain.meta,fx=Math.max(0,Math.min(cols-1.001,(x-origin[0])/cell)),fz=Math.max(0,Math.min(rows-1.001,(z-origin[1])/cell)),i=Math.floor(fx),j=Math.floor(fz),u=fx-i,v=fz-j,h=terrain.heights;
 return (h[j*cols+i]*(1-u)+h[j*cols+i+1]*u)*(1-v)+(h[(j+1)*cols+i]*(1-u)+h[(j+1)*cols+i+1]*u)*v+GROUND_Y;
}
const before:string[]=['road,x,z,visualY,terrainTriangleY,visualMinusTerrain'],after:string[]=['road,layer,x,z,visualY,terrainTriangleY,offset,error'];
let beforeMax=-Infinity,beforeMin=Infinity,beforeCount=0,above15=0,above50=0,maxError=0,afterCount=0,totalTriangles=0;
const worst:{id:string;x:number;z:number;visual:number;ground:number;delta:number}[]=[];
const probes:[[number,number],string][]=[[[62.813,-150.950],'osm-226268238'],[[23.412,211.781],'osm-232777683'],[[151.638,-56.895],'osm-417499971']];
const samples=[[1/3,1/3],[.25,.25],[.25,.5],[.5,.25],[.5,0],[0,.5],[.5,.5]];
for(const r of structure.context.roads.filter(r=>!r.tunnel))for(const points of clippedRoadPaths(r.points,PLAY_BOUNDS)){
 const g=roadRibbon(points,r.width),p=g.attributes.position,ix=g.index!;const offset=['footway','path','steps','pedestrian','cycleway'].includes(r.kind)?.015:.021;
 const heights=Array.from({length:p.count},(_,i)=>oldHeight(p.getX(i),p.getZ(i))+offset);
 for(let k=0;k<ix.count;k+=3)for(const [u,v] of samples){const ids=[ix.getX(k),ix.getX(k+1),ix.getX(k+2)],w=[1-u-v,u,v],x=ids.reduce((s,i,j)=>s+p.getX(i)*w[j],0),z=ids.reduce((s,i,j)=>s+p.getZ(i)*w[j],0),visual=ids.reduce((s,i,j)=>s+heights[i]*w[j],0),ground=terrain.heightAt(x,z),delta=visual-ground;before.push([r.id,x,z,visual,ground,delta].join(','));beforeCount++;beforeMax=Math.max(beforeMax,delta);beforeMin=Math.min(beforeMin,delta);if(delta>.15)above15++;if(delta>.5)above50++;worst.push({id:r.id,x,z,visual,ground,delta});}g.dispose();
}
const t0=performance.now(),layers=buildRoadLayers(structure.context.roads,terrain,PLAY_BOUNDS,exclude),buildMs=performance.now()-t0;
for(const layer of layers)for(const [name,g,offset] of [['road',layer.base,.006],['markings',layer.markings,.012]] as const){
 if(!g)continue;const p=g.attributes.position;totalTriangles+=p.count/3;
 for(let k=0;k<p.count;k+=3)for(const [u,v] of samples){const w=[1-u-v,u,v],x=w.reduce((s,w,j)=>s+p.getX(k+j)*w,0),z=w.reduce((s,w,j)=>s+p.getZ(k+j)*w,0),visual=w.reduce((s,w,j)=>s+p.getY(k+j)*w,0),ground=terrain.heightAt(x,z),error=Math.abs(visual-ground-offset);after.push([layer.id,name,x,z,visual,ground,offset,error].join(','));afterCount++;maxError=Math.max(maxError,error);}
}
const zebra=buildCrosswalkGeometry(structure.context.roads,terrain,PLAY_BOUNDS,exclude),zp=zebra.attributes.position;let zebraError=0;
for(let k=0;k<zp.count;k+=3)for(const [u,v] of samples){const w=[1-u-v,u,v],x=w.reduce((s,w,j)=>s+zp.getX(k+j)*w,0),z=w.reduce((s,w,j)=>s+zp.getZ(k+j)*w,0),y=w.reduce((s,w,j)=>s+zp.getY(k+j)*w,0);zebraError=Math.max(zebraError,Math.abs(y-terrain.heightAt(x,z)-.018));}
const representative=probes.map(([p,id])=>{let beforeY:number|undefined,afterY:number|undefined;
 const bary=(x:number,z:number,a:T.Vector3,b:T.Vector3,c:T.Vector3)=>{const d=(b.z-c.z)*(a.x-c.x)+(c.x-b.x)*(a.z-c.z);if(Math.abs(d)<1e-10)return;const u=((b.z-c.z)*(x-c.x)+(c.x-b.x)*(z-c.z))/d,v=((c.z-a.z)*(x-c.x)+(a.x-c.x)*(z-c.z))/d;if(u>=-1e-6&&v>=-1e-6&&u+v<=1.000001)return [u,v,1-u-v];};
 const road=structure.context.roads.find(r=>r.id===id)!;const original=roadRibbon(road.points,road.width),pos=original.attributes.position,ix=original.index!;
 for(let k=0;k<ix.count;k+=3){const ids=[0,1,2].map(j=>ix.getX(k+j)),v=ids.map(i=>new T.Vector3(pos.getX(i),oldHeight(pos.getX(i),pos.getZ(i))+.021,pos.getZ(i))),w=bary(...p,v[0],v[1],v[2]);if(w)beforeY=w.reduce((s,w,j)=>s+w*v[j].y,0);}
 for(const layer of layers){const g=layer.base,pos=g.attributes.position;for(let k=0;k<pos.count;k+=3){const v=[0,1,2].map(j=>new T.Vector3().fromBufferAttribute(pos,k+j)),w=bary(...p,v[0],v[1],v[2]);if(w)afterY=w.reduce((s,w,j)=>s+w*v[j].y,0);}}
 original.dispose();return {id,x:p[0],z:p[1],ground:terrain.heightAt(...p),beforeY,afterY,beforeGap:(beforeY??NaN)-terrain.heightAt(...p),afterGap:afterY===undefined?null:afterY-terrain.heightAt(...p)};
});
fs.writeFileSync(`${out}/comparison/before.csv`,before.join('\n')+'\n');fs.writeFileSync(`${out}/comparison/after.csv`,after.join('\n')+'\n');
const inputs=['src/world/terrain.ts','src/world/road-surface.ts','src/walk-art.ts','src/walk-world.ts','public/data/terrain/terrain.bin','public/data/terrain/terrain.json','public/data/walkthrough/campus-structure.json'];
const report={surfaceVersion:terrain.surfaceVersion,method:'Every shipped road overlay triangle sampled at seven barycentric locations; offsets relative to actual terrain triangle planes. Complete sample CSVs retained.',before:{samples:beforeCount,maxAbove:beforeMax,maxBelow:beforeMin,above15cm:above15,above50cm:above50,worst:worst.sort((a,b)=>b.delta-a.delta).slice(0,30)},after:{layers:layers.length,triangles:totalTriangles,samples:afterCount,maxError,buildMs,zebraTriangles:zp.count/3,zebraMaxError:zebraError,crossingStripes:crosswalkStripes(structure.context.roads).length},representative,inputs:Object.fromEntries(inputs.map(p=>[p,createHash('sha256').update(fs.readFileSync(p)).digest('hex')]))};
fs.writeFileSync(`${out}/comparison/report.json`,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({before:report.before,after:report.after,representative},null,2));
for(const layer of layers){layer.base.dispose();layer.markings?.dispose();}
zebra.dispose();
if(zebraError>.0001||maxError>.0001||representative.some(p=>p.afterGap===null||Math.abs(p.afterGap-.006)>.0001))throw Error('Road surface audit failed');
