/** Main story or side quest: which line has the player's attention, and what that means for E. DOM-free, runs in node tests.
 * `tracked` in the quest save is the focus; undefined means the main story. */

/** Q cycles main → each side quest in `lines` → main. Off the list (a quest just completed elsewhere) counts as main. */
export function nextFocus(lines: readonly string[], current?: string): string | undefined {
  if (!lines.length) return undefined;
  const at = current === undefined ? -1 : lines.indexOf(current);
  return at < 0 ? lines[0] : lines[at + 1];
}

/** E follows the focus. The line in focus outranks everything but an open dialogue; the other line stays one R away,
 * and any quest step, on the ground or not, outranks doors (50) and landmark cards (40). */
export const FOCUSED = 110;
export const questPriority = (target: string, focused: boolean) => focused ? FOCUSED : target.startsWith('npc:') ? 80 : 60;
export const acceptPriority = (focused: boolean) => focused ? FOCUSED : 80;
export const storyPriority = (sideFocused: boolean, blocking = false) => sideFocused && !blocking ? 70 : 100;

/** Standing at a room's door: the main story's atDestination rule, as a distance a quest step can compare with its radius. */
export const AT_DESTINATION = 1.4;
export function destinationDistance(position: readonly number[], p: { x: number; y: number; z: number }) {
  return Math.abs(position[1] - p.y) < .8 ? Math.hypot(position[0] - p.x, position[2] - p.z) : Infinity;
}
/** `dest:SC1005` finds the room by its code, with or without a name after it on the label. */
export function findDestination<D extends { label: string }>(list: readonly D[], code: string) {
  return list.find(d => d.label === code) ?? list.find(d => d.label.startsWith(`${code} `) || d.label.startsWith(`${code}・`));
}
/** The floor a code's room is on, for the card, when it is not the one underfoot. */
export const floorLabel = (floorId: string) => floorId.split('-').at(-1) ?? floorId;

/** G's walk carries on when a dialogue or chapter card closes, unless it was called off meanwhile. */
export const walkResumes = (o: { wasBlocking: boolean; blocking: boolean; follow: boolean; walking: boolean }) => o.wasBlocking && !o.blocking && o.follow && !o.walking;
