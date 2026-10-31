/** Which goal the guidance shows, and how its markers read; DOM-free so it runs in node tests. */

export interface TrackedGoalView { step?: { target: string }; definition: { accept: { near: string } } }

/** A tracked side quest leads to its current step, or to whoever hands it out before it has been accepted. */
export const trackedTarget = (v: TrackedGoalView) => v.step?.target ?? v.definition.accept.near;

/** Pillar opacity scale: full from 12 m out, gone by 4 m so it never stands between the camera and the goal. */
export function beaconFade(distance: number) {
  const t = Math.min(1, Math.max(0, (distance - 4) / 8));
  return t * t * (3 - 2 * t);
}

/** The one character on a person's badge: 阿灣 reads as 灣, 小禾 as 禾, 林老師 as 林, Mia as M. */
export function badgeGlyph(name: string) {
  const stem = /^[阿小]./u.test(name) ? name.slice(1) : name;
  return [...stem][0]?.toLocaleUpperCase() ?? '';
}
