import { afterAll, beforeAll, expect, it } from 'vitest';
import fs from 'node:fs';
import { Vector3 } from 'three';
import { init, importNavMesh } from 'recast-navigation';
import { buildRuntimeWorld } from './world-fixture';
import { RapierController, initPhysics } from '../src/walk/controller';
import { WalkNavigation } from '../src/walk-nav';
import { followRoute, sightLine } from '../src/walk/autopilot';

let physics: RapierController, nav: WalkNavigation;
beforeAll(async () => {
  await initPhysics(); await init();
  physics = new RapierController(buildRuntimeWorld().world.collision);
  nav = new WalkNavigation(importNavMesh(new Uint8Array(fs.readFileSync('public/data/walkthrough/navmesh.bin'))).navMesh);
}, 30000);
afterAll(() => { physics?.dispose(); nav?.dispose(); });

it('rejects a supported but disconnected tunnel shuttle stop, then physically walks from a connected candidate into the bore', () => {
  // Actual failure captured by the full browser tour: the terrain is inside the portal's thick wall.
  const stop = new Vector3(19.1, 1.6, 154.4), goal = new Vector3(28.6, .982722, 151);
  expect(nav.findPath(stop, goal)).toEqual([]);
  const clear = sightLine((a, b, r) => physics.sweep(a, b, r));
  expect(physics.safeTeleport(stop, 4, candidate => {
    const path = nav.findPath(candidate, goal);
    return path.length > 0 && clear(candidate, path[0]);
  })).toBe(true);
  const path = nav.findPath(physics.position, goal), direction = new Vector3();
  expect(path.length).toBeGreaterThan(1); expect(physics.position.distanceTo(stop)).toBeGreaterThan(.5);
  let index = 0;
  for (let tick = 0; tick < 1800 && physics.position.distanceTo(goal) > .5; tick++) {
    index = followRoute(path, index, physics.position, direction).index;
    physics.step(direction, 1 / 30, false, 3.6);
  }
  expect(physics.position.distanceTo(goal)).toBeLessThan(.5);
}, 30000);

it('leaves the current position unchanged when every landing candidate is rejected', () => {
  const before = physics.position.clone();
  expect(physics.safeTeleport(new Vector3(19.1, 1.6, 154.4), 4, () => false)).toBe(false);
  expect(physics.position.equals(before)).toBe(true);
});
