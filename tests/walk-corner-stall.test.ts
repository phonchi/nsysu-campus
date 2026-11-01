/** A wall corner must not freeze the capsule for glancing directions, and a head-on wall must still stop it. */
import { buildRuntimeWorld } from './world-fixture';
import { beforeAll, expect, it } from 'vitest';
import * as T from 'three';
import { RapierController, initPhysics } from '../src/walk/controller';

let physics: RapierController;
beforeAll(async () => { const { world } = buildRuntimeWorld(); await initPhysics(); physics = new RapierController(world.collision); }, 60000);

const moved = (start: T.Vector3, degrees: number) => {
  const dir = new T.Vector3(Math.cos(degrees * Math.PI / 180), 0, Math.sin(degrees * Math.PI / 180));
  physics.teleport(start); physics.step(new T.Vector3(), 1 / 30, false);
  const from = physics.position.clone();
  for (let i = 0; i < 15; i++) physics.step(dir, 1 / 30, false, 3.6);
  return physics.position.distanceTo(from);
};

it('slides past the SC-B1 corner from every glancing direction', () => {
  const corner = new T.Vector3(-20.711139678955078, -3.620487089157104, 121.18700012207031);
  for (let a = -180; a < 180; a += 5) if (a < -115 || a > -65) expect(moved(corner, a), `direction ${a}`).toBeGreaterThan(.2);
  expect(moved(corner, -90)).toBeLessThan(1);
}, 60000);
