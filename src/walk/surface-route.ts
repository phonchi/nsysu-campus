import { Vector3 } from 'three';

export interface RouteSurfaceQuery {
  support(x: number, z: number, referenceY: number): number | undefined;
  clear(from: Vector3, to: Vector3): boolean;
}
/** A route is a sequence of verified short surface segments. Never smooth corners:
 * a spline can leave the floor, cut through a wall or rise across storeys. */
export function surfaceRouteSegments(path: Vector3[], query: RouteSurfaceQuery, spacing = .35): Vector3[][] {
  const pieces: Vector3[][] = []; let current: Vector3[] = [];
  const flush = () => { if (current.length > 1) pieces.push(current); current = []; };
  const join = (a: Vector3, b: Vector3, depth = 0): Vector3[] | undefined => {
    const midpoint = a.clone().lerp(b, .5), height = query.support(midpoint.x, midpoint.z, midpoint.y);
    if (height === undefined || !Number.isFinite(height)) return;
    if (Math.abs(height - midpoint.y) > .01) {
      if (depth >= 6 || Math.hypot(a.x - b.x, a.z - b.z) < .01) return;
      midpoint.y = height;
      const left = join(a, midpoint, depth + 1), right = join(midpoint, b, depth + 1);
      return left && right ? [...left, ...right] : undefined;
    }
    return query.clear(a, b) ? [b] : undefined;
  };
  let previous: Vector3 | undefined;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i], horizontal = Math.hypot(b.x - a.x, b.z - a.z);
    if (horizontal < .001 && Math.abs(b.y - a.y) > .2) { flush(); previous = undefined; continue; }
    const steps = Math.max(1, Math.ceil(horizontal / spacing));
    for (let j = i === 1 ? 0 : 1; j <= steps; j++) {
      const p = a.clone().lerp(b, j / steps), height = query.support(p.x, p.z, p.y);
      if (height === undefined || !Number.isFinite(height) || Math.abs(height - p.y) > .6) { flush(); previous = undefined; continue; }
      p.y = height;
      const links = previous && Math.abs(p.y - previous.y) <= .4 + Math.hypot(p.x - previous.x, p.z - previous.z) ? join(previous, p) : undefined;
      if (previous && !links) flush();
      for (const point of links ?? [p]) current.push(point.clone().add(new Vector3(0, .035, 0)));
      previous = p;
    }
  }
  flush(); return pieces;
}
