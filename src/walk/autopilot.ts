import { Vector3 } from 'three';
import type { OutdoorRoutes } from './route';

/** Indoor/core navmesh queries (Recast). */
export interface NavQuery { findPath(from: Vector3, to: Vector3): Vector3[] }

/** One planner for every auto-walk: a few steps away → straight; the navmesh where it reaches; otherwise the
 * outdoor path network to the arcade junction (inside the navmesh) and Recast from there; otherwise outdoor only. */
export function planRoute(from: Vector3, to: Vector3, nav?: NavQuery, routes?: OutdoorRoutes, clear?: (a: Vector3, b: Vector3) => boolean): Vector3[] {
  // Straight shortcut only when close and nothing solid stands in between.
  if (Math.hypot(to.x - from.x, to.z - from.z) < 30 && Math.abs(to.y - from.y) < 1.5 && (!clear || clear(from, to))) return [from.clone(), to.clone()];
  const direct = nav?.findPath(from, to) ?? [];
  if (direct.length) return direct;
  if (!routes) return [];
  const junction = routes.anchor('arcade');
  const tail = junction && nav ? nav.findPath(junction, to) : [];
  if (junction && tail.length) { const head = routes.path(from, junction); if (head.length) return [...head.slice(0, -1), ...tail]; }
  // Leaving the navmesh: Recast to the junction, then the path network.
  const exit = junction && nav ? nav.findPath(from, junction) : [];
  if (junction && exit.length) { const rest = routes.path(junction, to); if (rest.length) return [...exit.slice(0, -1), ...rest.slice(1)]; }
  return routes.path(from, to);
}

/** Advance along a route: returns the next corner index and the horizontal direction to walk (zero on arrival).
 * A corner counts as reached when the walker is within reach of it or has already passed it (long frames move
 * the walker farther than the reach radius, which would otherwise make it hop back and forth over the corner). */
export function followRoute(path: Vector3[], index: number, at: Vector3, out: Vector3) {
  const passed = (i: number) => {
    if (i === 0) return false;
    const p = path[i], q = path[i - 1], ex = p.x - q.x, ez = p.z - q.z;
    return Math.hypot(p.x - at.x, p.z - at.z) < 1.5 && (at.x - p.x) * ex + (at.z - p.z) * ez > 0;
  };
  const reached = (i: number, r: number) => Math.abs(path[i].y - at.y) < .7 && (Math.hypot(path[i].x - at.x, path[i].z - at.z) < r || passed(i));
  while (index < path.length - 1 && reached(index, .36)) index++;
  const target = path[index];
  out.copy(target).sub(at); out.y = 0;
  const arrived = index === path.length - 1 && reached(index, .34);
  if (arrived) out.set(0, 0, 0); else if (out.lengthSq() > 1e-8) out.normalize();
  return { index, arrived };
}

/** Line of sight at body height for a walker (sphere sweep), used to allow straight shortcuts. */
export function sightLine(sweep: (a: Vector3, b: Vector3, r: number) => number) {
  const a = new Vector3(), b = new Vector3();
  return (p: Vector3, q: Vector3) => { a.copy(p).y += .9; b.copy(q).y += .9; const d = a.distanceTo(b); return d < .05 || sweep(a, b, .3) >= d - .05; };
}

/** Remove outdoor path edges a walker cannot follow: sweep a body-height sphere along each edge, sampled every
 * ≤2 m on the ground (terrain, or the node height where the path runs above it), so slopes never read as walls. */
export function validateRoutes(routes: OutdoorRoutes, sweep: (a: Vector3, b: Vector3, r: number) => number, ground: (x: number, z: number) => number) {
  const a = new Vector3(), b = new Vector3();
  const at = (p: Vector3, q: Vector3, t: number, out: Vector3) => { out.lerpVectors(p, q, t); out.y = Math.max(out.y, ground(out.x, out.z)) + .9; return out; };
  return routes.validate((p, q) => {
    const n = Math.max(1, Math.ceil(Math.hypot(q.x - p.x, q.z - p.z) / 2));
    for (let i = 0; i < n; i++) { at(p, q, i / n, a); at(p, q, (i + 1) / n, b); const d = a.distanceTo(b); if (d > .05 && sweep(a, b, .25) < d - .05) return false; }
    return true;
  });
}
