import { beforeAll, describe, expect, it } from 'vitest';
import { BoxGeometry, Group, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, Vector3 } from 'three';
import { initPhysics, RapierController } from '../src/walk/controller';
import { ObstacleField, doorCameraObstacles, type Obstacle } from '../src/walk/obstacles';
import { propObstacles, propsForTier } from '../src/world/props';
import { artObstacles } from '../src/walk-art';
import { moveNpcSafely } from '../src/world/npc';

const DT = 1 / 60, idle = new Vector3(), right = new Vector3(1, 0, 0);
const ground = () => { const g = new Group(), floor = new Mesh(new BoxGeometry(80, 1, 80)); floor.position.y = -.5; g.add(floor); return g; };
function player() { const p = new RapierController(ground()); p.teleport(new Vector3(0, .1, 0)); for (let i = 0; i < 20; i++) p.step(idle, DT, false); return p; }
const cabinet = (id = 'cabinet'): Obstacle => ({ id, shape: 'box', center: [2, 1, 0], half: [.5, 1, .5] });
beforeAll(initPhysics);

describe('shared world obstacles', () => {
  it('blocks the actual player at a rotated vending machine and retains solids on low quality', () => {
    const spots = [{ kind: 'vending', x: 2, z: 0, ry: Math.PI / 2 }];
    expect(propsForTier(spots, 1)).toEqual(spots);
    const specs = propObstacles(spots, () => 0), p = player(); p.addObstacles(specs);
    for (let i = 0; i < 90; i++) p.step(right, DT, false, 9.5);
    expect(p.position.x).toBeLessThan(1.4); expect(p.position.x).toBeGreaterThan(1.1);
    p.dispose();
  });

  it('uses the seated instanced tree trunk, not its canopy or an origin-only mesh', () => {
    const art = new Group(), trees = new InstancedMesh(new BoxGeometry(8, 8, 8), new MeshBasicMaterial(), 1);
    trees.name = 'Tree crowns banyan 0,0'; trees.setMatrixAt(0, new Matrix4().makeTranslation(2, 0, 0)); art.add(trees);
    const specs = artObstacles(art); expect(specs).toHaveLength(1); expect(specs[0].half[0]).toBe(.45);
    const p = player(); p.addObstacles(specs);
    for (let i = 0; i < 90; i++) p.step(right, DT, false);
    expect(p.position.x).toBeLessThan(1.3); expect(p.position.x).toBeGreaterThan(1.1);
    p.dispose(); trees.geometry.dispose(); (trees.material as MeshBasicMaterial).dispose();
  });

  it('blocks players against NPCs, removes absent actors, and does not pull the camera toward people', () => {
    const p = player(); p.setActors([{ id: 'student', position: new Vector3(2, 0, 0), radius: .32, height: 1.7 }]);
    expect(p.sweep(new Vector3(0, 1, 0), new Vector3(4, 1, 0))).toBeCloseTo(4);
    for (let i = 0; i < 60; i++) p.step(right, DT, false);
    expect(p.position.x).toBeLessThan(1.45);
    p.setActors([]); for (let i = 0; i < 30; i++) p.step(right, DT, false);
    expect(p.position.x).toBeGreaterThan(2); p.dispose();
  });

  it('camera-only door panels follow their swing without adding a second walking barrier', () => {
    const p = player(), panel = new Group(), mesh = new Mesh(new BoxGeometry(1, 2, .08));
    mesh.position.set(.5, 1, 0); panel.add(mesh); panel.position.set(1, 0, 0);
    const doors = [{ id: 'door', panel, position: panel.position }], from = new Vector3(1.5, 1, -2), to = new Vector3(1.5, 1, 2);
    p.setCameraObstacles(doorCameraObstacles(doors, p.position));
    expect(p.sweep(from, to)).toBeLessThan(2);
    panel.rotation.y = Math.PI / 2; p.setCameraObstacles(doorCameraObstacles(doors, p.position));
    expect(p.sweep(from, to)).toBeCloseTo(4);
    for (let i = 0; i < 60; i++) p.step(right, DT, false);
    expect(p.position.x).toBeGreaterThan(2); p.dispose(); mesh.geometry.dispose();
  });

  it('NPC movement sweeps a body, yields to the player, and cannot cross a prop', () => {
    const p = player(); p.addObstacles([cabinet()]);
    let npc = new Vector3(.7, 0, 0);
    const sweep = (id: string, a: Vector3, b: Vector3, r: number) => p.sweepActor(id, a, b, r);
    p.setActors([{ id: 'n', position: npc, radius: .32, height: 1.7 }]);
    const yielded = moveNpcSafely('n', npc, npc, p.position, DT, .32, 1.7, () => 0, sweep);
    expect(yielded.x).toBeGreaterThan(npc.x);
    // Narrow motion against the wall may slide sideways, but never enters the cabinet.
    for (let i = 0; i < 90; i++) {
      p.setActors([{ id: 'n', position: npc, radius: .32, height: 1.7 }]);
      npc = moveNpcSafely('n', npc, npc.clone().addScaledVector(right, .025), new Vector3(-10, 0, 0), DT, .32, 1.7, () => 0, sweep);
      const outside = Math.hypot(Math.max(Math.abs(npc.x - 2) - .5, 0), Math.max(Math.abs(npc.z) - .5, 0));
      expect(outside).toBeGreaterThanOrEqual(.319); // capsule clearance, including rounded corners
    }
    p.dispose();
  });

  it('checks bike length and width before mounting and sweeps at riding speed', () => {
    const p = player(); p.addObstacles([{ id: 'front', shape: 'box', center: [0, 1, .8], half: [2, 1, .05] }]);
    expect(p.setRiding(true, 0)).toBe(false); // person fits; front wheel would be inside the wall
    expect(p.setRiding(true, Math.PI / 2)).toBe(true);
    for (let i = 0; i < 60; i++) p.step(new Vector3(0, 0, 1), DT, false, 9.5);
    expect(p.position.z).toBeLessThan(.38); p.dispose();
    const narrow = player(); narrow.addObstacles([{ id: 'left', shape: 'box', center: [-.39, 1, 0], half: [.05, 1, 3] }, { id: 'right', shape: 'box', center: [.39, 1, 0], half: [.05, 1, 3] }]);
    expect(narrow.setRiding(true, 0)).toBe(false); narrow.dispose();
  });

  it('allows riding on a gentle slope without a flat-bottom chassis intersecting the road', () => {
    const g = ground(), ramp = new Mesh(new BoxGeometry(16, .2, 4)); ramp.position.set(0, 1, 0); ramp.rotation.z = Math.atan(.1); g.add(ramp);
    const p = new RapierController(g); p.teleport(new Vector3(0, 1.3, 0));
    for (let i = 0; i < 60; i++) p.step(idle, DT, false);
    expect(p.setRiding(true, Math.PI / 2)).toBe(true);
    for (let i = 0; i < 60; i++) p.step(right, DT, false, 4);
    expect(p.position.x).toBeGreaterThan(3.5); expect(p.position.y).toBeGreaterThan(1.3); p.dispose();
  });

  it('recovers a recent supported point and refuses an obstructed teleport', () => {
    const p = player(); for (let i = 0; i < 60; i++) p.step(right, DT, false, 3);
    p.teleport(new Vector3(3, -30, 0)); expect(p.recoverSafe()).toBe(true);
    expect(p.position.x).toBeGreaterThan(2); expect(p.position.y).toBeGreaterThan(0);
    p.addObstacles([cabinet()]); expect(p.safeTeleport(new Vector3(2, 0, 0), 0)).toBe(false);
    expect(p.safeTeleport(new Vector3(2, 0, 0))).toBe(true);
    expect(Math.abs(p.position.x - 2) > .75 || Math.abs(p.position.z) > .75).toBe(true); p.dispose();
  });

  it('safe teleport searches for ground beside a low prop rather than standing on it', () => {
    const p = player(); p.addObstacles([{ id: 'bin', shape: 'box', center: [2, .4, 0], half: [.5, .4, .5] }]);
    expect(p.safeTeleport(new Vector3(2, .15, 0), 0)).toBe(false);
    expect(p.safeTeleport(new Vector3(2, .15, 0))).toBe(true); expect(p.position.y).toBeLessThan(.1); p.dispose();
  });

  it('repairs a blocked nav segment around shared solids and rejects detours through walls', () => {
    const p = player(), o = cabinet(), field = new ObstacleField(); p.addObstacles([o]); field.add([o]);
    const path = [new Vector3(0, 0, 0), new Vector3(4, 0, 0)];
    const clear = (a: Vector3, b: Vector3) => { const start = a.clone().add(new Vector3(0, .9, 0)), end = b.clone().add(new Vector3(0, .9, 0)); return p.sweep(start, end, .34) >= start.distanceTo(end) - .01; };
    const route = field.route(path, .34, clear, () => 0);
    expect(route.length).toBeGreaterThan(2); expect(route.at(-1)!.equals(path[1])).toBe(true);
    for (let i = 1; i < route.length; i++) { expect(field.clear(route[i - 1], route[i])).toBe(true); expect(clear(route[i - 1], route[i])).toBe(true); }
    expect(field.route(path, .34, () => false)).toEqual([]); p.dispose();
  });
});
