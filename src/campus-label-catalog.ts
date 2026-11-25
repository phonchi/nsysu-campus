/** UI inventory stays complete even when hand-modelled assets replace OSM render blocks. */
import { Vector3 } from 'three';
import type { CampusStructure } from './walk-types';
import type { Placement } from './world/landmarks';
import type { CampusLabel } from './walk-labels';
import gateCollision from '../public/models/landmarks/gate.collision.json';
import { hamasenMarkerStyle, type HamasenPlace } from './map/map-landmarks';

export interface LandmarkUiOptions {
  ground?: (x: number, z: number) => number;
  placements?: Record<string, Placement>;
  anchors?: Record<string, Vector3>;
}
export function hamasenUiLabels(places: Record<string,{name:string;poi?:HamasenPlace['poi'];kind?:HamasenPlace['kind'];category?:string}>, options: LandmarkUiOptions = {}): CampusLabel[] {
  return Object.entries(places).flatMap(([id, place]) => {
    if (!place.poi) return [];
    const { position: [x,z], labelHeight, approach: [ax,y,az] } = place.poi;
    const shop = place.kind === 'shop';
    const dining = place.kind === 'dining';
    const dorm = place.kind === 'dorm';
    return [{ id, name: place.name, position: new Vector3(x,(options.ground?.(x,z) ?? y)+labelHeight,z),
      approach: new Vector3(ax,y,az), priority: shop ? 2 : 1, reach: shop ? 6 : (dining || dorm) ? 14 : 10,
      distance: shop ? 25 : dining ? 75 : dorm ? 120 : 95, overviewDistance: shop ? 42 : 260,
      accent: hamasenMarkerStyle(place.category ?? '').color }];
  });
}
export function landmarkUiLabels(structure: CampusStructure, names: Parameters<typeof hamasenUiLabels>[0], options: LandmarkUiOptions = {}): CampusLabel[] {
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
  return [...labels, ...hamasenUiLabels(names, options)];
}

/** Ground-level information interaction; never use roof-height label Y for reach. */
export function nearbyLandmarkUi(labels: readonly CampusLabel[], foot: Vector3, ground: (x:number,z:number)=>number, known: ReadonlySet<string>, walkable: ReadonlySet<string>, reach=28): {id:string;name:string;position:Vector3}|undefined {
  let best: {id:string;name:string;position:Vector3} | undefined, nearest = Infinity;
  for (const l of labels) {
    if ((l.id !== 'GATE' && !known.has(l.id)) || walkable.has(l.id)) continue;
    const {x,z} = l.approach ?? l.position, distance = Math.hypot(foot.x-x,foot.z-z);
    if (distance > (l.reach ?? reach) || distance > nearest || (distance === nearest && best && l.id.localeCompare(best.id) >= 0)) continue;
    const y = ground(x,z);
    if (!Number.isFinite(y) || Math.abs(foot.y-y) > 2.5) continue;
    nearest = distance;
    best = {id:l.id,name:l.name,position:new Vector3(x,y+1.5,z)};
  }
  return best;
}
