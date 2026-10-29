import { describe, it, expect } from 'vitest';
import * as T from 'three';
import { loadRideAsset } from '../tools/ride-assets';
import { gateBarrierObstacles } from '../src/world/gate-barriers';
import { RapierController, initPhysics } from '../src/walk/controller';

describe('visible gate barrier collision', () => {
  it('derives both arms and their bases from the shipped merged GLB and follows its transform', async () => {
    const { scene } = await loadRideAsset('public/models/landmarks/gate.glb');
    scene.position.set(10, 3, 20); scene.rotation.y = Math.PI / 2; scene.updateMatrixWorld(true);
    const boxes = gateBarrierObstacles(scene), arms = boxes.filter(b => Math.max(b.half[0], b.half[2]) > 2);
    expect(boxes).toHaveLength(4); expect(arms).toHaveLength(2);
    for (const box of arms) {
      expect(box.half[0]).toBeCloseTo(2.3, 2);
      expect(box.half[1]).toBeCloseTo(.06, 2);
      expect(box.half[2]).toBeCloseTo(.06, 2);
      expect(box.center[1]).toBeCloseTo(3.96, 2);
      expect(box.center[2]).toBeCloseTo(17.1, 2);
      expect(box.yaw).toBeCloseTo(Math.PI / 2, 5);
    }
  });
  it('blocks mounting inside a boom and stops a moving rider before the visible arm', async () => {
    await initPhysics();
    const { scene } = await loadRideAsset('public/models/landmarks/gate.glb');
    const ground = new T.Group(), floor = new T.Mesh(new T.BoxGeometry(30, 1, 30)); floor.position.y = -.5; ground.add(floor);
    const physics = new RapierController(ground);
    physics.addObstacles(gateBarrierObstacles(scene));
    expect(physics.sweep(new T.Vector3(2.9, .96, -3), new T.Vector3(2.9, .96, -2), .04)).toBeLessThan(.5);
    physics.teleport(new T.Vector3(2.9, 0, -2.5));
    expect(physics.setRiding(true, Math.PI)).toBe(false);
    physics.teleport(new T.Vector3(2.9, .02, -5));
    for (let i = 0; i < 30; i++) physics.step(new T.Vector3(), 1 / 60, false);
    expect(physics.setRiding(true, Math.PI)).toBe(true);
    for (let i = 0; i < 120; i++) physics.step(new T.Vector3(0, 0, 1), 1 / 60, false, 9.5);
    expect(physics.position.z).toBeLessThan(-3.1);
    physics.dispose();
  });
});
