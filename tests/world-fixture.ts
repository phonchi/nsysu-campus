import fs from 'node:fs';
import { buildWalkWorld } from '../src/walk-world';
import { WALK_BUILDING_IDS } from '../src/walk-nav';
import { landmarkCarves, landmarkCollision, LANDMARK_IDS, REPLACES, type Box, type Placement } from '../src/world/landmarks';
import type { CampusStructure, FloorAccess, WalkBuilding } from '../src/walk-types';
import { loadTerrain } from './terrain-fixture';

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
  terrain.carves = landmarkCarves(placements);
  const world = buildWalkWorld(data, structure, terrain);
  world.collision.add(landmarkCollision(placements, collisions, (x, z) => terrain.heightAt(x, z)));
  return { world, structure, data, terrain, placements };
}

/** Inputs the runtime world depends on (hashed by the navmesh bake). */
export const RUNTIME_WORLD_INPUTS = ['public/models/landmarks/placements.json', ...LANDMARK_IDS.map(id => `public/models/landmarks/${id}.collision.json`), 'src/world/landmarks.ts', 'tests/world-fixture.ts'];
