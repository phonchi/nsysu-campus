import type { Vector3 } from 'three';
import { occupiesDoor } from '../walk-door';
import type { WalkWorld, WorldDoor, WorldLift } from '../walk-world';

export interface LiftStopRef { lift: WorldLift; stop: WorldLift['stops'][number] }

/** Nearest door within reach of the E key (2.15 m). */
export function nearestDoor(world: WalkWorld, foot: Vector3): WorldDoor | undefined {
  let door: WorldDoor | undefined, best = 2.15;
  for (const d of world.doors) { const dd = d.position.distanceTo(foot); if (dd < best) { door = d; best = dd; } }
  return door;
}

/** Lift stop on this storey within a car's reach, if any. */
export function nearestLift(world: WalkWorld, foot: Vector3): LiftStopRef | undefined {
  for (const lift of world.lifts) {
    const reach = (world.scales.get(lift.buildingId) ?? 1) * 1.9 + .35;
    for (const stop of lift.stops)
      if (Math.abs(stop.position.y - foot.y) < .6 && Math.hypot(stop.position.x - foot.x, stop.position.z - foot.z) < reach) return { lift, stop };
  }
  return undefined;
}

/** E priority after stories and NPCs: the lift wins only when standing in the car or nearer to it than to any door. */
export function liftWins(world: WalkWorld, foot: Vector3): LiftStopRef | undefined {
  const near = nearestLift(world, foot);
  if (!near) return undefined;
  const d = nearestDoor(world, foot), toLift = Math.hypot(near.stop.position.x - foot.x, near.stop.position.z - foot.z);
  const inside = toLift < (world.scales.get(near.lift.buildingId) ?? 1) + .2;
  return inside || !d || toLift < d.position.distanceTo(foot) ? near : undefined;
}

export type DoorResult = { kind: 'opened' | 'closed'; door: WorldDoor } | { kind: 'blocked'; door: WorldDoor } | { kind: 'none' };

/** Toggle the nearest door; refuses to close it on someone standing in the doorway. */
export function toggleDoor(world: WalkWorld, foot: Vector3): DoorResult {
  return toggleDoorById(world, foot, nearestDoor(world, foot)?.id ?? '');
}

/** Execute the named door only, rechecking reach and doorway occupancy. */
export function toggleDoorById(world: WalkWorld, foot: Vector3, doorId: string, expectedTarget?: number): DoorResult {
  const d = world.doors.find(d => d.id === doorId);
  if (!d || d.position.distanceTo(foot) >= 2.15 || (expectedTarget !== undefined && d.target !== expectedTarget)) return { kind: 'none' };
  if (d.target && occupiesDoor(d, foot)) return { kind: 'blocked', door: d };
  d.target = d.target ? 0 : 1;
  return { kind: d.target ? 'opened' : 'closed', door: d };
}

/** Consecutive steps at the same target remain one conversation, but never skip a photo,
 * repeat an unchanged step, or bypass its current distance/time requirements. */
export function continueQuestAtTarget(previous: import('../story/quests').QuestStep, next: import('../story/quests').QuestStep | undefined, world: import('../story/quests').QuestWorld): boolean {
  return !!next && next.id!==previous.id && next.target===previous.target && next.kind!=='photo'
    && world.distanceTo(next.target)<=(next.radius??4) && (!next.when || next.when===world.timeOfDay());
}

/** Future availability is the authored schedule, independent of story placement or culling now. */
export function npcPresentAt(definitions: readonly import('../story/talk').NpcDef[], id:string, time:string): boolean {
  const npc=definitions.find(n=>n.id===id);
  return !!npc && (time==='day'||time==='sunset'||time==='night') && npc.schedule[time]!=null;
}
