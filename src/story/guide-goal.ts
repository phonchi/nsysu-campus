/** Which goal the guidance shows, and how its markers read; DOM-free so it runs in node tests. */

export interface TrackedGoalView { step?: { target: string }; definition: { accept: { near: string } } }

/** A tracked side quest leads to its current step, or to whoever hands it out before it has been accepted. */
export const trackedTarget = (v: TrackedGoalView) => v.step?.target ?? v.definition.accept.near;

/** Pillar opacity scale: full from 12 m out, gone by 4 m so it never stands between the camera and the goal. */
export function beaconFade(distance: number) {
  const t = Math.min(1, Math.max(0, (distance - 4) / 8));
  return t * t * (3 - 2 * t);
}

/** The one character on a person's badge: 阿灣 reads as 灣, 小禾 as 禾, 呂老師 as 呂, Mia as M. */
export function badgeGlyph(name: string) {
  const stem = /^[阿小]./u.test(name) ? name.slice(1) : name;
  return [...stem][0]?.toLocaleUpperCase() ?? '';
}

export interface FlatPoint { x: number; z: number }

/** Which stretch of a route the player is nearest, and how far off it they are. An empty route is infinitely far. */
export function routeProgress(route: readonly FlatPoint[], p: FlatPoint) {
  let segment = 0, offset = Infinity;
  if (route.length === 1) offset = Math.hypot(route[0].x - p.x, route[0].z - p.z);
  for (let i = 0; i < route.length - 1; i++) {
    const a = route[i], b = route[i + 1], ex = b.x - a.x, ez = b.z - a.z, L = ex * ex + ez * ez;
    const t = L > 1e-9 ? Math.min(1, Math.max(0, ((p.x - a.x) * ex + (p.z - a.z) * ez) / L)) : 0;
    const d = Math.hypot(a.x + ex * t - p.x, a.z + ez * t - p.z);
    if (d < offset) { offset = d; segment = i; }
  }
  return { segment, offset };
}

/** The corner the head arrow aims at: the first one past the stretch underfoot and over `reach` metres away. */
export function nextCorner<P extends FlatPoint>(route: readonly P[], p: FlatPoint, reach = 3): P | undefined {
  for (let i = routeProgress(route, p).segment + 1; i < route.length; i++) if (Math.hypot(route[i].x - p.x, route[i].z - p.z) > reach) return route[i];
  return undefined;
}

export const ROUTE_THROTTLE_MS = 1200;
export const ROUTE_RETRY_MS = 5000;

/** The planner runs on the main thread and costs real frames on a long route, so it runs only when the answer could
 * change: a new target (`dirty`), a goal that moved or a player who left the line; a failed plan retries slowly. */
export function routeDue(o: { now: number; at: number; dirty: boolean; empty: boolean; goalMoved: boolean; offRoute: boolean }) {
  if (o.dirty) return true;
  if (o.empty) return o.now - o.at > ROUTE_RETRY_MS;
  return (o.goalMoved || o.offRoute) && o.now - o.at > ROUTE_THROTTLE_MS;
}
