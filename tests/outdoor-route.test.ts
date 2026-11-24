import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { Vector3 } from 'three';
import { importNavMesh, init } from 'recast-navigation';
import { OutdoorRoutes } from '../src/walk/route';
import { followRoute, planRoute } from '../src/walk/autopilot';
import { RIDE_SPEED } from '../src/walk/bike';
import { WalkNavigation } from '../src/walk-nav';

const graph = JSON.parse(fs.readFileSync('public/data/walkthrough/outdoor-graph.json', 'utf8'));
const routes = new OutdoorRoutes(graph);
const length = (p: Vector3[]) => p.slice(1).reduce((s, q, i) => s + Math.hypot(q.x - p[i].x, q.z - p[i].z), 0);

describe('outdoor routes', () => {
  it('stays on the street graph when both ends are east of the tunnel handoff', () => {
    const east = routes.anchor('hamasen-east-link')!, arcade = routes.anchor('arcade')!;
    const from = east.clone().add(new Vector3(4,0,2)), goal = routes.anchor('hamasen-poi-my-warm-day')!;
    const nav = { findPath: (a: Vector3, b: Vector3) => b.equals(arcade) ? [a, b] : [] };
    expect(planRoute(from,goal,nav,routes)).toEqual(routes.path(from,goal));
    const atPortal = east.clone().add(new Vector3(-.5,0,0));
    expect(planRoute(atPortal,goal,nav,routes,()=>true)).toEqual(routes.path(atPortal,goal));
  });
  it('keeps stops on the main network when validation cuts a piece of it off', () => {
    const cut = new OutdoorRoutes(graph), at = new Vector3(-53, 0, -61.5), near = cut.stopsNear(at, 1)[0];
    // Sever everything within 15 m of the place: what is left near it must still join the rest of the campus.
    cut.validate((a, b) => Math.hypot(a.x - near.x, a.z - near.z) > 15 && Math.hypot(b.x - near.x, b.z - near.z) > 15);
    const [stop] = cut.stopsNear(at, 1);
    expect(Math.hypot(stop.x - near.x, stop.z - near.z)).toBeGreaterThan(15);
    expect(cut.path(cut.anchor('arcade')!, stop).length).toBeGreaterThan(1);
  });
  it('offers the stops nearest a place, closest first, none of them cut off from the network', () => {
    const at = new Vector3(-53, 0, -61.5), stops = routes.stopsNear(at, 3);
    expect(stops).toHaveLength(3);
    const d = stops.map(s => Math.hypot(s.x - at.x, s.z - at.z));
    expect(d[0]).toBeLessThanOrEqual(d[1] + 1);
    for (const stop of stops) expect(routes.path(routes.anchor('arcade')!, stop).length).toBeGreaterThan(1);
  });
  it('connects every story anchor to the arcade without using the tunnel', () => {
    const arcade = routes.anchor('arcade')!;
    for (const id of ['gate', 'tunnel-west', 'admin', 'library', 'sunset']) {
      const p = routes.path(arcade, id);
      expect(p.length, id).toBeGreaterThan(2);
      const L = length(p);
      // Within 2.5x of straight-line distance: a real walk, not a detour around the hill.
      expect(L, id).toBeLessThan(Math.max(150, arcade.distanceTo(routes.anchor(id)!) * 2.5));
    }
  });
  it('never routes through the tunnel bore (portal to portal must go around, ~277 m bore)', () => {
    const p = routes.path(routes.anchor('tunnel-west')!, 'tunnel-east');
    expect(p.length).toBeGreaterThan(2);
    expect(length(p)).toBeGreaterThan(277 * 1.3);
  });
});

describe('Hamasen–campus routes on the baked surfaces', () => {
  let nav: WalkNavigation;
  beforeAll(async () => {
    await init();
    const binary = fs.readFileSync('public/data/walkthrough/navmesh.bin');
    nav = new WalkNavigation(importNavMesh(binary).navMesh);
  });
  afterAll(() => nav?.dispose());

  const insideBore = (a: Vector3, b: Vector3) => {
    // Sample a cross-section halfway through the western straight leg.
    const x = 140;
    if ((a.x - x) * (b.x - x) > 0 || a.x === b.x) return false;
    const p = a.clone().lerp(b, (x - a.x) / (b.x - a.x));
    const z = 148.5 + (x - 19.9) * (214.71 - 148.5) / (260.39 - 19.9);
    return Math.abs(p.z - z) < 3.3 && p.y > -1 && p.y < 2;
  };

  it.each(routes.anchorIds.filter(id => id.startsWith('hamasen-poi-')))('uses the tunnel both ways for %s', id => {
    const street = routes.anchor(id)!;
    for (const campusId of ['gate', 'admin', 'YH']) {
      const campus = routes.anchor(campusId)!;
      for (const [direction, from, to] of [['return', street, campus], ['outbound', campus, street]] as const) {
        const path = planRoute(from, to, nav, routes);
        const label = `${campusId} ${direction}`;
        expect(path.some((p, i) => i > 0 && insideBore(path[i - 1], p)), label).toBe(true);
        expect(Math.max(...path.map(p => p.y)), label).toBeLessThan(15);
        expect(path.at(-1)!.distanceTo(to), label).toBeLessThan(.5);
      }
    }
  });
});

describe('followRoute with long frames', () => {
  it('does not hop back and forth over a corner when a frame moves farther than the reach radius', () => {
    const path = [new Vector3(0, 0, 0), new Vector3(-10, 0, -6), new Vector3(-10, 0, -20)], at = path[0].clone(), dir = new Vector3();
    let index = 0, arrived = false;
    for (let f = 0; f < 200 && !arrived; f++) { ({ index, arrived } = followRoute(path, index, at, dir)); at.addScaledVector(dir, .9); }
    expect(arrived).toBe(true);
  });

  it.each([.065, .25])('guides a bike around a corner and stops at the goal with %s s frames', dt => {
    const path = [new Vector3(), new Vector3(3.075, 0, 0), new Vector3(3.075, 0, 3.075)];
    const at = path[0].clone(), direction = new Vector3(), maxFrameDistance = RIDE_SPEED * dt;
    let index = 0, arrived = false;
    for (let frame = 0; frame < 20 && !arrived; frame++) {
      const step = followRoute(path, index, at, direction, .34, maxFrameDistance);
      ({ index, arrived } = step);
      at.addScaledVector(direction, maxFrameDistance * step.speedScale);
      expect(at.x).toBeLessThanOrEqual(path[1].x + 1e-8);
      expect(at.z).toBeLessThanOrEqual(path[2].z + 1e-8);
    }
    expect(arrived).toBe(true);
    expect(at.distanceTo(path[2])).toBeLessThan(.34);
  });
});
