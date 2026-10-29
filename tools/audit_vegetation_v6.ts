import fs from 'node:fs';
import crypto from 'node:crypto';
import * as T from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { buildRuntimeWorld } from '../tests/world-fixture';
import { geometryArrays } from '../src/walk-world';
import { PLAY_BOUNDS } from '../src/world/terrain';
import { GrowableSurfaceField, campusVegetationVolumes } from '../src/world/growable-surface';
import { grassPlacements } from '../src/render/ground';
import { LANDMARK_IDS, landmarkVegetationVolumes, type Box } from '../src/world/landmarks';

const dir = process.env.VEGETATION_AUDIT_OUT ?? 'artifacts/v6/vegetation'; fs.mkdirSync(dir, { recursive: true });
const started = Date.now();
const { world, structure, terrain, placements } = buildRuntimeWorld();
const [x0, z0, x1, z1] = PLAY_BOUNDS;
// This deliberately accepts a superset of the runtime's worn-lawn/sea mask. The
// geometry proof therefore also covers every runtime candidate within PLAY_BOUNDS.
const field = new GrowableSurfaceField(terrain, { free: (x, z) => x >= x0 && x <= x1 && z >= z0 && z <= z1 });
field.setRoads(structure.context.roads);
field.setVolumes('campus', campusVegetationVolumes(world.display, world.frames.keys()));
const collisions: Record<string, { boxes: Box[] }> = {};
for (const id of LANDMARK_IDS) collisions[id] = JSON.parse(fs.readFileSync(`public/models/landmarks/${id}.collision.json`, 'utf8'));
field.setVolumes('landmarks', landmarkVegetationVolumes(placements, collisions, (x, z) => terrain.heightAt(x, z)));
field.setReady(true);
await RAPIER.init();
const physics = new RAPIER.World({ x: 0, y: 0, z: 0 });
const arrays = geometryArrays(world.collision);
physics.createCollider(RAPIER.ColliderDesc.trimesh(new Float32Array(arrays.positions), new Uint32Array(arrays.indices)));
physics.step();
let accepted = 0, unsupported = 0, maxRootError = 0, overTolerance = 0;
const failures: unknown[] = [];
const centre = { x: (x0 + x1) / 2, z: (z0 + z1) / 2 }, radius = Math.hypot(x1 - x0, z1 - z0) / 2;
for (const candidate of grassPlacements(field, centre, radius)) {
  accepted++;
  const { x, z, surface } = candidate;
  // GPU instance translations are Float32; validate those against real collision triangles.
  const px = Math.fround(x), py = Math.fround(surface.height), pz = Math.fround(z);
  const hit = physics.castRay(new RAPIER.Ray({ x: px, y: py + 1, z: pz }, { x: 0, y: -1, z: 0 }), 2, true);
  if (!hit) { unsupported++; if (failures.length < 30) failures.push({ x, z, y: py, reason: 'no physical ground' }); continue; }
  const error = Math.abs(1 - hit.timeOfImpact); maxRootError = Math.max(maxRootError, error);
  if (error > .01) { overTolerance++; if (failures.length < 30) failures.push({ x, z, y: py, error }); }
}
physics.free();
const inputPaths = ['src/world/growable-surface.ts', 'src/render/ground.ts', 'src/world/landmarks.ts', 'src/world/terrain.ts', 'src/walk/runtime.ts', 'public/data/terrain/terrain.bin', 'public/models/landmarks/placements.json'];
const summary = { createdAt: new Date().toISOString(), elapsedMs: Date.now() - started, surfaceVersion: terrain.surfaceVersion,
  scope: 'All deterministic candidate cells in PLAY_BOUNDS; conservative superset before runtime lawn mask and rendered-GLB exclusions. This is not a browser visual acceptance.',
  accepted, unsupported, overTolerance, maxRootError, toleranceMetres: .01, failures,
  hashes: Object.fromEntries(inputPaths.map(path => [path, crypto.createHash('sha256').update(fs.readFileSync(path)).digest('hex')])) };
fs.writeFileSync(`${dir}/geometry-audit.json`, JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify(summary, null, 2));
if (unsupported || overTolerance) process.exitCode = 1;
