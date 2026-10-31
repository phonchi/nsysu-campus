import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { Vector3 } from 'three';
import { OutdoorRoutes } from '../src/walk/route';
import { followRoute } from '../src/walk/autopilot';

const graph = JSON.parse(fs.readFileSync('public/data/walkthrough/outdoor-graph.json', 'utf8'));
const routes = new OutdoorRoutes(graph);
const length = (p: Vector3[]) => p.slice(1).reduce((s, q, i) => s + Math.hypot(q.x - p[i].x, q.z - p[i].z), 0);

describe('outdoor routes', () => {
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

describe('followRoute with long frames', () => {
  it('does not hop back and forth over a corner when a frame moves farther than the reach radius', () => {
    const path = [new Vector3(0, 0, 0), new Vector3(-10, 0, -6), new Vector3(-10, 0, -20)], at = path[0].clone(), dir = new Vector3();
    let index = 0, arrived = false;
    for (let f = 0; f < 200 && !arrived; f++) { ({ index, arrived } = followRoute(path, index, at, dir)); at.addScaledVector(dir, .9); }
    expect(arrived).toBe(true);
  });
});
