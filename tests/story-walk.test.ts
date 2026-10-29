/** Story route acceptance in pure physics: every leg of the six-chapter tour is planned with the runtime planner
 * (navmesh + outdoor network + junction) and walked by the Rapier capsule with runtime door handling and
 * stuck-replanning. Fast replacement for the browser playthrough as a regression check. */
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import * as T from 'three';
import { init, importNavMesh } from 'recast-navigation';
import { WalkNavigation } from '../src/walk-nav';
import { RapierController, initPhysics } from '../src/walk/controller';
import { doorConstraint, animateDoors } from '../src/walk/doors';
import { wouldEnterDoor } from '../src/walk-door';
import { OutdoorRoutes } from '../src/walk/route';
import { planRoute, followRoute, validateRoutes, sightLine } from '../src/walk/autopilot';
import { buildRuntimeWorld } from './world-fixture';

type P2 = [number, number];
let built: ReturnType<typeof buildRuntimeWorld>, physics: RapierController, nav: WalkNavigation, routes: OutdoorRoutes;
const zones = JSON.parse(fs.readFileSync('public/data/story-zones.json', 'utf8')) as { zones: Record<string, { p: P2; r: number; y?: number }>; npcs: Record<string, { at: string; offset?: P2 }> };
const DT = 1 / 30, SPEED = 3.6;
const report: Record<string, unknown> = {};

beforeAll(async () => {
  built = buildRuntimeWorld();
  await init(); await initPhysics();
  nav = new WalkNavigation(importNavMesh(new Uint8Array(fs.readFileSync('public/data/walkthrough/navmesh.bin'))).navMesh);
  physics = new RapierController(built.world.collision);
  physics.constrain = doorConstraint(built.world.doors);
  routes = new OutdoorRoutes(JSON.parse(fs.readFileSync('public/data/walkthrough/outdoor-graph.json', 'utf8')));
  report.blockedEdges = validateRoutes(routes, (a, b, r) => physics.sweep(a, b, r), (x, z) => built.terrain.heightAt(x, z));
}, 120000);
afterAll(() => {
  nav?.dispose(); physics?.dispose();
  fs.mkdirSync('artifacts/v3/T9', { recursive: true });
  fs.writeFileSync('artifacts/v3/T9/story-walk.json', JSON.stringify(report, null, 1) + '\n');
});

const ground = (x: number, z: number) => built.terrain.heightAt(x, z);
const zone = (id: string) => { const [x, z] = zones.zones[id].p; return new T.Vector3(x, zones.zones[id].y ?? ground(x, z), z); };
const npc = (id: string, at = zones.npcs[id].at) => { const [x, z] = zones.zones[at].p, [ox, oz] = zones.npcs[id].offset ?? [0, 0]; return new T.Vector3(x + ox, ground(x + ox, z + oz), z + oz); };
const room = (label: string) => new T.Vector3(...built.world.destinations.find(d => d.label === label)!.position);

/** Walk to `goal` like the runtime auto-walk: plan, follow, open doors on the way, replan around stuck spots. */
function walkTo(goal: T.Vector3, reach: number): string | undefined {
  const dir = new T.Vector3();
  let path = planRoute(physics.position, goal, nav, routes, sightLine((a, b, r) => physics.sweep(a, b, r))), index = 0, replans = 0, since = physics.position.clone();
  routes.avoid.splice(0);
  if (!path.length) return 'no route';
  for (let tick = 0; tick < 30 * 600; tick++) {
    if (Math.hypot(goal.x - physics.position.x, goal.z - physics.position.z) < reach && Math.abs(goal.y - physics.position.y) < 1.2) return undefined;
    const step = followRoute(path, index, physics.position, dir);
    index = step.index;
    if (step.arrived) return Math.hypot(goal.x - physics.position.x, goal.z - physics.position.z) < reach + .5 ? undefined : `route ended ${physics.position.distanceTo(goal).toFixed(1)} m short`;
    for (const d of built.world.doors) if (d.target === 0 && d.position.distanceToSquared(physics.position) < 13 && wouldEnterDoor(d, physics.position, dir, DT, SPEED)) d.target = 1;
    physics.step(dir, DT, false, SPEED);
    animateDoors(built.world.doors, physics.position, DT);
    if (physics.position.y < -20) return 'fell out of the world';
    if (tick % 105 === 104) { // the runtime checks progress every 3.5 s
      if (physics.position.distanceTo(since) < .4) {
        if (replans++ >= 3) return `stuck at ${physics.position.toArray().map(v => v.toFixed(1))}`;
        routes.avoid.push(physics.position.clone().addScaledVector(dir.lengthSq() > 1e-6 ? dir.clone().normalize() : new T.Vector3(), 2.5));
        path = planRoute(physics.position, goal, nav, routes, sightLine((a, b, r) => physics.sweep(a, b, r))); index = 0;
        if (!path.length) return `no route after replanning at ${physics.position.toArray().map(v => v.toFixed(1))}`;
      }
      since.copy(physics.position);
    }
  }
  return 'step budget exhausted';
}

describe('six-chapter tour walked in physics', () => {
  it('every leg arrives', () => {
    const gate = zone('gate');
    physics.teleport(gate.clone().add(new T.Vector3(-6, .2, -6)));
    for (let i = 0; i < 60; i++) physics.step(new T.Vector3(), DT, false);
    const legs: [string, T.Vector3, number][] = [
      ['c1 guide at the gate', npc('guide'), 2.5],
      ['c2 tunnel portal', zone('tunnel-west'), zones.zones['tunnel-west'].r - 1],
      ['c2 inside the tunnel', zone('tunnel-inside'), zones.zones['tunnel-inside'].r - 1],
      ['c3 guide at admin', npc('guide', 'admin'), 2.5],
      ['c3 service desk', npc('s2'), 2.2],
      ['c4 guide at library', npc('guide', 'library'), 2.5],
      ['c4 library desk', npc('s3'), 2.2],
      ['c5 arcade', zone('arcade'), zones.zones.arcade.r - 1],
      ['c5 room SC2001', room('SC2001'), 1.2],
      ['c6 seawall', zone('seawall'), zones.zones.seawall.r - 1],
      ['c6 guide on the seawall', npc('guide', 'seawall'), 2.3],
    ];
    const results: Record<string, string> = {};
    for (const [name, goal, reach] of legs) { const t0 = performance.now(); const e = walkTo(goal, reach); results[name] = (e ?? 'ok') + ` (${((performance.now() - t0) / 1000).toFixed(1)} s cpu)`; }
    report.legs = results;
    expect(Object.entries(results).filter(([, v]) => !v.startsWith('ok'))).toEqual([]);
  }, 1800000);
  it('resuming from the arcade reaches the tunnel through the navmesh, not a detour', () => {
    physics.teleport(new T.Vector3(-69.4, .2, 128.3));
    for (let i = 0; i < 60; i++) physics.step(new T.Vector3(), DT, false);
    const goal = zone('tunnel-west');
    const plan = planRoute(physics.position, goal, nav, routes, sightLine((a, b, r) => physics.sweep(a, b, r)));
    const length = plan.slice(1).reduce((s, q, i) => s + Math.hypot(q.x - plan[i].x, q.z - plan[i].z), 0);
    report.arcadeToTunnel = { points: plan.length, length: Math.round(length) };
    expect(length).toBeLessThan(180);
    expect(walkTo(goal, zones.zones['tunnel-west'].r - 1)).toBeUndefined();
  }, 600000);
});

