import { MathUtils, Vector3 } from 'three';
import { occupiesDoor, slidePastClosedDoor } from '../walk-door';
import type { WorldDoor } from '../walk-world';
import type { StepConstraint } from './controller';

const near = (d: WorldDoor, foot: Vector3) =>
  Math.abs(d.position.y - foot.y) <= 2.3 && d.position.distanceToSquared(foot) <= 13;

/** Closed or half-open door panels have no collider; this bends every physics sub-step around them.
 * Shared by the runtime and the acceptance tests so both block movement identically. */
export function doorConstraint(doors: readonly WorldDoor[]): StepConstraint {
  const dir = new Vector3();
  return (foot, velocity, h) => {
    const speed = Math.hypot(velocity.x, velocity.z);
    if (speed < 1e-8) return;
    for (const d of doors) {
      if (d.open >= .7 || !near(d, foot)) continue;
      dir.set(velocity.x / speed, 0, velocity.z / speed);
      slidePastClosedDoor(d, foot, dir, h, speed);
      velocity.set(dir.x * speed, 0, dir.z * speed);
    }
  };
}

/** Swing panels toward their target; a panel never closes onto someone standing in the doorway. */
export function animateDoors(doors: readonly WorldDoor[], foot: Vector3, dt: number): void {
  for (const d of doors) {
    if (Math.abs(d.open - d.target) < .0005) { d.open = d.target; continue; }
    if (!d.target && d.open > .05 && occupiesDoor(d, foot)) d.target = 1;
    d.open = MathUtils.damp(d.open, d.target, 9, dt);
    d.panel.rotation.y = -d.open * Math.PI * .52;
  }
}
