import fs from 'node:fs';
import { buildWalkWorld } from '../src/walk-world';
import { WALK_BUILDING_IDS } from '../src/walk-nav';
import { landmarkCarves, landmarkLevels, landmarkCollision, LANDMARK_IDS, REPLACES, type Box, type Placement } from '../src/world/landmarks';
import type { CampusStructure, FloorAccess, WalkBuilding } from '../src/walk-types';
import { loadTerrain } from './terrain-fixture';
import {placementPolicy} from '../src/world/placement-policy';
import {prepareV12Terrain,buildV12Surfaces} from '../src/world/v12-surfaces';
import {parseV12,type V12Data} from '../src/walk/v12-data';

/** The walk world exactly as the runtime builds it (terrain + carves, replaced OSM blocks removed, landmark
 * collision included), for the navmesh bake and node-side walking tests. */
export function buildRuntimeWorld() {
  const access = JSON.parse(fs.readFileSync('public/data/walkthrough/access-plan.json', 'utf8')) as { floors: Record<string, FloorAccess> };
  const raw = JSON.parse(fs.readFileSync('public/data/walkthrough/campus-structure.json', 'utf8')) as CampusStructure;
  const placements = JSON.parse(fs.readFileSync('public/models/landmarks/placements.json', 'utf8')) as Record<string, Placement>;
  const collisions: Record<string, { boxes: Box[] }> = {};
  for (const id of LANDMARK_IDS) collisions[id] = JSON.parse(fs.readFileSync(`public/models/landmarks/${id}.collision.json`, 'utf8'));
  const gone = new Set(Object.keys(placements).map(id => REPLACES[id]).filter(Boolean));
  const structure: CampusStructure = { ...raw, context: { ...raw.context, landmarks: raw.context.landmarks.filter(l => !gone.has(l.id)) } };
  const data = WALK_BUILDING_IDS.map(id => { const b = JSON.parse(fs.readFileSync(`public/data/walkthrough/${id}.json`, 'utf8')) as WalkBuilding; for (const f of b.floors) f.access = access.floors[f.id]; return b; });
  const terrain = loadTerrain();
  terrain.carves = landmarkCarves(placements,(x,z)=>terrain.heightAt(x,z));
  terrain.levels.push(...landmarkLevels(placements));
  const v12:V12Data={issues:[]};for(const [kind,file] of Object.entries({sea:'sea.json',bus:'bus-routes.json',sports:'sports.json',fitness:'interiors/fitness.json'}))Object.assign(v12,{[kind]:parseV12(kind as 'sea'|'bus'|'sports'|'fitness',JSON.parse(fs.readFileSync('public/data/'+file,'utf8')))});
  prepareV12Terrain(terrain,v12);
  const world = buildWalkWorld(data, structure, terrain);
  world.display.userData.placementAllowed=placementPolicy(terrain,v12);
  world.display.userData.sportsPolygons=[...(v12.sports?.facilities??[]).filter(f=>!f.id.includes('candidate')).map(f=>f.polygon),...(v12.bus?.forecourt?[v12.bus.forecourt.polygon]:[])];
  const surfaces=buildV12Surfaces(terrain,v12);world.display.add(surfaces.display);world.collision.add(surfaces.collision);
  world.collision.add(landmarkCollision(placements, collisions, (x, z) => terrain.heightAt(x, z)));
  return { world, structure, data, terrain, placements };
}

/** Inputs the runtime world depends on (hashed by the navmesh bake). */
export const RUNTIME_WORLD_INPUTS = ['public/models/landmarks/placements.json', ...LANDMARK_IDS.map(id => `public/models/landmarks/${id}.collision.json`), 'src/world/landmarks.ts', 'src/world/tunnel-surface.ts', 'tests/world-fixture.ts','src/world/placement-policy.ts','src/walk-art.ts','src/world/hamasen-art.ts','src/world/props.ts','src/world/v12-surfaces.ts','src/world/sports-field.ts','src/walk/v12-data.ts','src/walk/v12-geometry.ts','public/data/sea.json','public/data/bus-routes.json','public/data/sports.json','public/data/interiors/fitness.json'];
