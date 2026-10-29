/** UI inventory stays complete even when hand-modelled assets replace OSM render blocks. */
import { Vector3 } from 'three';
import type { CampusStructure } from './walk-types';
import type { Placement } from './world/landmarks';
import type { CampusLabel } from './walk-labels';
import gateCollision from '../public/models/landmarks/gate.collision.json';

export interface LandmarkUiOptions {
  ground?: (x: number, z: number) => number;
  placements?: Record<string, Placement>;
  anchors?: Record<string, Vector3>;
}
export function landmarkUiLabels(structure: CampusStructure, names: Record<string, {name: string}>, options: LandmarkUiOptions = {}): CampusLabel[] {
  const labels: CampusLabel[] = [];
  for (const l of structure.context.landmarks) {
    if (!l.polygon.length) continue;
    const [x,z] = l.polygon.reduce(([x,z], p) => [x + p[0]/l.polygon.length,z + p[1]/l.polygon.length], [0,0]);
    const base = options.ground?.(x,z) ?? 0;
    labels.push({id:l.id,name:names[l.id]?.name ?? l.name,position:options.anchors?.[l.id]?.clone() ?? new Vector3(x,base+l.storeys*3.6+5,z),priority:names[l.id]?1:2});
  }
  const gate = options.placements?.gate;
  if (gate) {
    // The tallest gate collision component identifies the actual stele, not the booth/combined asset centroid.
    const tower = gateCollision.boxes.reduce((a,b) => b.size[1] > a.size[1] ? b : a);
    const [x,z]=gate.centroid,c=Math.cos(gate.yaw),s=Math.sin(gate.yaw),[lx,ly,lz]=tower.center;
    labels.push({id:'GATE',name:'校門・校碑',sub:'地標',position:options.anchors?.GATE?.clone() ?? new Vector3(x+lx*c+lz*s,(gate.elevation ?? options.ground?.(x,z) ?? 0)+ly+tower.size[1]/2+2,z-lx*s+lz*c),priority:1,faculty:'admin'});
  }
  return labels;
}

/** Ground-level information interaction; never use roof-height label Y for reach. */
export function nearbyLandmarkUi(labels: readonly CampusLabel[], foot: Vector3, ground: (x:number,z:number)=>number, known: ReadonlySet<string>, walkable: ReadonlySet<string>, reach=28): {id:string;name:string;position:Vector3}|undefined {
  return labels.filter(l=>(l.id==='GATE'||known.has(l.id))&&!walkable.has(l.id)).map(l=>{
    const y=ground(l.position.x,l.position.z);
    return {id:l.id,name:l.name,position:new Vector3(l.position.x,y+1.5,l.position.z),ground:y,distance:Math.hypot(foot.x-l.position.x,foot.z-l.position.z)};
  }).filter(l=>Number.isFinite(l.ground)&&l.distance<=reach&&Math.abs(foot.y-l.ground)<=2.5).sort((a,b)=>a.distance-b.distance||a.id.localeCompare(b.id)).map(({id,name,position})=>({id,name,position}))[0];
}
