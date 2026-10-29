import { beforeAll, describe, expect, it, vi } from 'vitest';
import { BoxGeometry, Group, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial, Vector3 } from 'three';
import { initPhysics, RapierController } from '../src/walk/controller';
import { ObstacleField, doorCameraObstacles, type Obstacle } from '../src/walk/obstacles';
import { addCampusProps, artObstacles, campusTreeSpots, seatOnTerrain } from '../src/walk-art';
import { moveNpcSafely } from '../src/world/npc';
import type { WalkWorld } from '../src/walk-world';
import type { CampusStructure } from '../src/walk-types';

const V = (x: number, y = 0, z = 0) => new Vector3(x, y, z);
const solid: Obstacle = { id: 'box', shape: 'box', center: [0, 1, 0], half: [.5, 1, .5] };
function physics() {
  const g = new Group(), floor = new Mesh(new BoxGeometry(40, 1, 40)); floor.position.y = -.5; g.add(floor);
  const p = new RapierController(g); p.teleport(V(8, .03, 8)); return p;
}
beforeAll(initPhysics);

describe('reviewed physics edge cases', () => {
  it('can leave a box contact through extra navigation padding without cutting across the box', () => {
    const f = new ObstacleField(); f.add([solid]);
    const a = V(-.801), b = V(-3);
    const route = f.route([a, b], .34, () => true, () => 0);
    expect(route.length).toBeGreaterThan(1); expect(route[0].equals(a)).toBe(true);
    expect(route.at(-1)!.equals(b)).toBe(true);
    expect(f.clear(a, V(3), .34)).toBe(false);
  });
  it('treats a cylinder as a circle and routes out of a diagonal contact', () => {
    const f = new ObstacleField(); f.add([{ ...solid, shape: 'cylinder' }]);
    const d = .81 / Math.sqrt(2), a = V(d, 0, d), b = V(3, 0, 3);
    expect(f.clear(a, b, .30)).toBe(true);
    expect(f.route([a, b], .34, () => true, () => 0).length).toBeGreaterThan(1);
  });
  it('projects a goal inside prop padding to a nearby reachable stop', () => {
    const f = new ObstacleField(); f.add([solid]);
    const goal = V(.7), route = f.route([V(3), goal], .34, () => true, () => 0);
    expect(route.length).toBeGreaterThan(1);
    const end = route.at(-1)!; expect(end.distanceTo(goal)).toBeLessThan(.5); expect(f.clear(end, end, .34)).toBe(true);
  });
  it('does not make a nearby NPC forcibly dismount a stationary rider', () => {
    const p = physics(); p.teleport(V(0, .03)); expect(p.setRiding(true, 0)).toBe(true);
    p.setActors([{ id: 'person', position: V(0, 0, .8), radius: .32, height: 1.7 }]);
    expect(p.setRiding(true, 0)).toBe(true); p.dispose();
  });
  it('a door at 45 degrees does not occlude the empty half of its world AABB', () => {
    const p = physics(), panel = new Group(), mesh = new Mesh(new BoxGeometry(1, 2, .08));
    mesh.position.set(.5, 1, 0); panel.add(mesh); panel.rotation.y = Math.PI / 4;
    p.setCameraObstacles(doorCameraObstacles([{ id: 'hinge', panel, position: V(0) }], V(0)));
    expect(p.sweep(V(.1, 1, -.65), V(-1, 1, -.65), .15)).toBeGreaterThan(1.05);
    expect(p.sweep(V(.35, 1, .5), V(.35, 1, -.8), .15)).toBeLessThan(1);
    p.dispose(); mesh.geometry.dispose();
  });
  it('a far monkey without a registered collider sweeps its own short body above the floor', () => {
    const p = physics();
    expect(p.sweepActor('far-monkey', V(0, .35), V(1, .35), .24, .65)).toBeCloseTo(1);
    p.dispose();
  });
  it('unchanged actors and doors do not repeatedly advance the physics world', () => {
    const p = physics(), bodies = [{ id: 'n', position: V(2), radius: .32, height: 1.7 }], advance = vi.spyOn(p.world, 'step');
    p.setActors(bodies); const initial = advance.mock.calls.length;
    for (let i = 0; i < 20; i++) { p.setActors(bodies); p.setCameraObstacles([]); }
    expect(advance.mock.calls.length).toBe(initial);
    bodies[0].position.x = 3; p.setActors(bodies);
    expect(p.sweepActor('other', V(2, .875), V(4, .875), .32, 1.7)).toBeLessThan(1);
    p.dispose();
  });
  it('uses the requested storey for support, teleport and NPC steps instead of DEM zero', () => {
    const p = physics(), upper = new Group(), floor = new Mesh(new BoxGeometry(12, .2, 12)); floor.position.y = 3.5; upper.add(floor); p.addStatic(upper);
    expect(p.supportAt(0, 0, .1)).toBeCloseTo(0);
    expect(p.supportAt(0, 0, 3.6)).toBeCloseTo(3.6);
    expect(p.supportAt(0, 0, 1.8)).toBeUndefined();
    const npc = moveNpcSafely('upper', V(0, 3.6), V(.04, 3.6), V(8, 3.6, 8), 1 / 60, .32, 1.7,
      (x, z, y) => p.supportAt(x, z, y), (id, a, b, r, h) => p.sweepActor(id, a, b, r, h));
    expect(npc.x).toBeCloseTo(.04); expect(npc.y).toBeCloseTo(3.6);
    expect(p.safeTeleport(V(1, 3.6), 0)).toBe(true); expect(p.position.y).toBeCloseTo(3.625); p.dispose();
  });
  it('uses a long narrow bike footprint through an ordinary straight passage', () => {
    const field = new ObstacleField(); field.add([
      { id: 'left', shape: 'box', center: [-.65, 1, 0], half: [.1, 1, 5] },
      { id: 'right', shape: 'box', center: [.65, 1, 0], half: [.1, 1, 5] },
    ]);
    const route = field.route([V(0, 0, -3), V(0, 0, 3)], { radius: .38, halfLength: .57 }, () => true, () => 0);
    expect(route).toHaveLength(2); expect(field.clear(route[0], route[1], { radius: .38, halfLength: .57 })).toBe(true);
    expect(field.clear(V(-3), V(3), { radius: .38, halfLength: .57 })).toBe(false);
  });
  it('keeps the full physical tree layout on touch devices and seats hill trees exactly once', () => {
    const trees = [{ x: 2, y: 12, z: 1, s: 1 }, { x: 3, y: 14, z: 1, s: 1 }, { x: 4, y: 0, z: 1, s: 1 }];
    vi.stubGlobal('matchMedia', () => ({ matches: false })); const desktop = campusTreeSpots(trees);
    vi.stubGlobal('matchMedia', () => ({ matches: true })); const mobile = campusTreeSpots(trees); vi.unstubAllGlobals();
    expect(mobile).toEqual(desktop); expect(mobile).toHaveLength(trees.length);
    const art = new Group(), g = new BoxGeometry(1, 1, 1), m = new MeshBasicMaterial();
    for (const [name, x, y] of [['Tree crowns hill 0,0', 2, 12], ['Tree crowns almond 0,0', 4, 0]] as const) {
      const instance = new InstancedMesh(g, m, 1); instance.name = name; instance.setMatrixAt(0, new Matrix4().makeTranslation(x, y, 1)); art.add(instance);
    }
    seatOnTerrain(art, { context: { landmarks: [], background: [] } } as unknown as CampusStructure, () => 12);
    const obstacles = artObstacles(art); expect(obstacles).toHaveLength(2);
    for (const o of obstacles) expect(o.center[1] - o.half[1]).toBeCloseTo(12);
    g.dispose(); m.dispose();
  });
  it('exports seated collision for loaded bicycles, cones and monkey props but not boats', async () => {
    const display = new Group(), art = new Group(); art.name = 'Campus art'; display.add(art);
    art.userData.treeSpots = []; art.userData.rackSpots = [[2, 2]]; art.userData.groundAt = () => 2;
    const specs = await addCampusProps({ display } as WalkWorld, async () => {
      const scene = new Group(), g = new BoxGeometry(.5, 1, 1.6); g.translate(0, .5, 0); scene.add(new Mesh(g, new MeshStandardMaterial())); return { scene };
    }, p => p, () => true, (_x, _z, y) => y);
    for (const name of ['Parked bicycles', 'Traffic cones', 'Formosan macaques']) {
      const part = specs.filter(o => o.id.includes(name)); expect(part.length).toBeGreaterThan(0);
      for (const o of part) expect(o.center[1] - o.half[1]).toBeCloseTo(2);
    }
    expect(specs.some(o => o.id.includes('Sailboat'))).toBe(false);
    const p = physics(); p.addObstacles(specs);
    const cone = specs.find(o => o.id.includes('Traffic cones'))!;
    const start = V(cone.center[0] - 2, cone.center[1], cone.center[2]);
    expect(p.sweep(start, V(cone.center[0] + 2, cone.center[1], cone.center[2]), .28)).toBeLessThan(2);
    p.dispose();
  });
});
