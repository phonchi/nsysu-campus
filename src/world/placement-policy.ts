import type {Terrain} from './terrain';
import type {V12Data} from '../walk/v12-data';
import {inside,nearestOnPolygon} from '../walk/v12-geometry';
import type {Point2} from '../walk-types';
/** One dry-ground policy for trees, grass and ordinary props. Marine structures
 * (buoys/boats and revetment tetrapods) have their own authored water placement. */
export function placementPolicy(terrain:Terrain,data:V12Data){
 const polygons:Point2[][]=[...(data.sea?.waterBodies.map(w=>w.polygon)??[]),...(data.sea?.routes.map(r=>r.corridor)??[]),...(data.sea?.surfZone?[data.sea.surfZone.polygon]:[]),...(data.sea?.hazards?.map(h=>h.polygon)??[]),...(data.bus?.forecourt?[data.bus.forecourt.polygon]:[]),...(data.sports?.facilities.filter(f=>!f.id.includes('candidate')).map(f=>f.polygon)??[])];
 return (x:number,z:number,radius=0)=>{
  for(const poly of polygons){if(inside([x,z],poly))return false;if(radius){const p=nearestOnPolygon([x,z],poly);if(Math.hypot(x-p[0],z-p[1])<=radius)return false;}}
  for(const [dx,dz] of [[0,0],[radius,0],[-radius,0],[0,radius],[0,-radius]]){
   const px=x+dx,pz=z+dz,s=terrain.surfaceAt(px,pz);
   if(!s||s.height<terrain.seaLevel+.05)return false;
   // The rendered beach has an authored straight seaward edge at x=-330.
   if(pz>=40&&pz<=258&&px<=-330)return false;
  }return true;
 };
}
