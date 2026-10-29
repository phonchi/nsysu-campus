import RAPIER from '@dimforge/rapier3d-compat';
import { Mesh, Object3D, Vector3 } from 'three';
import type { ActorBody, Obstacle } from './obstacles';

/** Foot-anchored character movement; the interface the runtime, tests and story steer through. */
export interface CharacterController {
  readonly position: Vector3;
  readonly velocity: Vector3;
  readonly onGround: boolean;
  /** Speed the input asked for (m/s); animation uses it instead of noisy displacement. */
  readonly intendedSpeed: number;
  teleport(position: Vector3): void;
  step(direction: Vector3, dt: number, jump: boolean, speed?: number): void;
  dispose(): void;
}

/** Called before every sub-step with the foot position and the horizontal velocity it may bend (doors). */
export type StepConstraint = (position: Vector3, velocity: Vector3, h: number) => void;

let ready: Promise<void> | undefined;
/** Rapier's WASM must be initialised once before any world is built (also in vitest). */
export const initPhysics = () => (ready ??= RAPIER.init());

const RADIUS = .28, HEIGHT = 1.7, OFFSET = .02, HALF = (HEIGHT - 2 * RADIUS) / 2;
const CHUNK = 48, LARGE = 48, MAX_PER_COLLIDER = 60000;
const GRAVITY = 24, JUMP = 6, SUBSTEP = 1 / 120, PRESS = 1, STEP = .3;
// Static geometry uses Rapier's default membership; actors and camera-only doors get
// distinct memberships. Native query groups avoid a JS callback on every physics sweep.
const MOVE_GROUPS = 0x00010005, CAMERA_GROUPS = 0x00010003;
const STATIC_GROUPS = 0x00010001;
const ACTOR_GROUPS = 0x0004ffff, DOOR_CAMERA_GROUPS = 0x0002ffff;

export interface PhysicsStats { triangles: number; colliders: number; buildMs: number }

/** Static world triangles: bucketed by centroid into CHUNK-metre trimeshes; oversized triangles share one collider. */
function addStaticTriangles(world: RAPIER.World, root: Object3D): PhysicsStats {
  const t0 = performance.now();
  root.updateWorldMatrix(true, true);
  const buckets = new Map<string, number[]>();
  const a = new Vector3(), b = new Vector3(), c = new Vector3();
  let triangles = 0, colliders = 0;
  root.traverse(o => {
    if (!(o instanceof Mesh)) return;
    const pos = o.geometry.attributes.position, index = o.geometry.index, n = index?.count ?? pos.count;
    for (let k = 0; k < n; k += 3) {
      const at = (j: number) => index ? index.getX(k + j) : k + j;
      a.fromBufferAttribute(pos, at(0)).applyMatrix4(o.matrixWorld);
      b.fromBufferAttribute(pos, at(1)).applyMatrix4(o.matrixWorld);
      c.fromBufferAttribute(pos, at(2)).applyMatrix4(o.matrixWorld);
      const large = Math.max(a.distanceTo(b), b.distanceTo(c), c.distanceTo(a)) > LARGE;
      const key = large ? 'large' : `${Math.floor((a.x + b.x + c.x) / 3 / CHUNK)},${Math.floor((a.z + b.z + c.z) / 3 / CHUNK)}`;
      let v = buckets.get(key);
      if (!v) buckets.set(key, v = []);
      v.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
      triangles++;
    }
  });
  for (const v of buckets.values()) {
    for (let s = 0; s < v.length; s += MAX_PER_COLLIDER * 9) {
      const part = new Float32Array(v.slice(s, s + MAX_PER_COLLIDER * 9));
      const idx = new Uint32Array(part.length / 3).map((_, i) => i);
      world.createCollider(RAPIER.ColliderDesc.trimesh(part, idx, RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES));
      colliders++;
    }
  }
  return { triangles, colliders, buildMs: performance.now() - t0 };
}

/** Rapier kinematic capsule (1.7 m, r 0.28). Position is the capsule bottom (the feet).
 * Gravity, jumping and sub-stepping are ours. Each sub-step moves horizontally and vertically in
 * separate controller passes, so a wall contact can never swallow the ground support query.
 */
export class RapierController implements CharacterController {
  readonly position = new Vector3();
  readonly velocity = new Vector3();
  onGround = false;
  intendedSpeed = 0;
  constrain?: StepConstraint;
  readonly world: RAPIER.World;
  readonly stats: PhysicsStats;
  private body: RAPIER.Collider;
  private kcc: RAPIER.KinematicCharacterController;
  private vy = 0;
  private jumpHeld = false;
  private airTime = 0;
  private wish = new Vector3();
  private sub = new Vector3();
  private groundNormal = new Vector3(0, 1, 0);
  private staticIds = new Set<string>();
  private obstacleHandles = new Set<number>();
  private actors = new Map<string, RAPIER.Collider>();
  private actorPoses = new Map<string, string>();
  private actorHandles = new Set<number>();
  private cameraOnly = new Map<string, RAPIER.Collider>();
  private cameraPoses = new Map<string, string>();
  private cameraHandles = new Set<number>();
  private riding = false;
  private bodyYaw = 0;
  private readonly bikeShape = new RAPIER.Capsule(.57, .38);
  private safe: Vector3[] = [];
  private readonly identity = { x: 0, y: 0, z: 0, w: 1 };
  private readonly staticFilter = (c: RAPIER.Collider) => !this.actorHandles.has(c.handle) && !this.cameraHandles.has(c.handle);
  private queryDirty = false;

  /** Batch actor, player and door changes until the next actual query. */
  private flushQueries() { if (this.queryDirty) { this.world.step(); this.queryDirty = false; } }
  private actorShape(radius: number, height: number) {
    return height < radius * 2 ? new RAPIER.Cylinder(height / 2, radius) : new RAPIER.Capsule(height / 2 - radius, radius);
  }

  constructor(root: Object3D) {
    this.world = new RAPIER.World({ x: 0, y: -GRAVITY, z: 0 });
    this.stats = addStaticTriangles(this.world, root);
    this.body = this.world.createCollider(RAPIER.ColliderDesc.capsule(HALF, RADIUS).setTranslation(0, HALF + RADIUS + OFFSET, 0));
    this.kcc = this.world.createCharacterController(OFFSET);
    this.kcc.setUp({ x: 0, y: 1, z: 0 });
    this.kcc.enableAutostep(.35, .05, false);
    this.kcc.enableSnapToGround(.4);
    this.kcc.setMaxSlopeClimbAngle(50 * Math.PI / 180);
    this.kcc.setMinSlopeSlideAngle(55 * Math.PI / 180);
    this.kcc.setSlideEnabled(true);
    this.world.step();
  }

  /** Diagnostics: contacts a horizontal move of (dx, dz) would hit, without moving. */
  probe(dx: number, dz: number) {
    this.flushQueries();
    this.kcc.computeColliderMovement(this.body, { x: dx, y: 0, z: dz });
    const m = this.kcc.computedMovement(), out: { normal: number[]; at: number[] }[] = [];
    for (let i = 0; i < this.kcc.numComputedCollisions(); i++) { const c = this.kcc.computedCollision(i)!; out.push({ normal: [c.normal1.x, c.normal1.y, c.normal1.z], at: [c.witness1.x, c.witness1.y, c.witness1.z] }); }
    return { moved: [m.x, m.y, m.z], contacts: out };
  }

  /** Add more static geometry after construction (landmarks loaded later). */
  addStatic(root: Object3D) { const s = addStaticTriangles(this.world, root); this.world.step(); return s; }

  /** Register simplified props/trunks, once per stable id. Never ingest render cells. */
  addObstacles(specs: readonly Obstacle[]) {
    for (const o of specs) {
      if (this.staticIds.has(o.id)) continue;
      this.staticIds.add(o.id); this.obstacleHandles.add(this.world.createCollider(this.obstacleDesc(o)).handle);
    }
    this.world.step();
  }

  private obstacleDesc(o: Obstacle) {
    const d = o.shape === 'cylinder' ? RAPIER.ColliderDesc.cylinder(o.half[1], o.half[0]) : RAPIER.ColliderDesc.cuboid(...o.half);
    const yaw = (o.yaw ?? 0) / 2;
    return d.setTranslation(...o.center).setRotation({ x: 0, y: Math.sin(yaw), z: 0, w: Math.cos(yaw) });
  }

  /** Nearby visible NPC capsules. Call once after NPC motion (and once on initial placement).
   * They block characters, while camera sweeps ignore them to avoid camera pops. */
  setActors(bodies: readonly ActorBody[]) {
    const keep = new Set(bodies.map(b => b.id));
    for (const [id, c] of this.actors) if (!keep.has(id)) { this.actorHandles.delete(c.handle); this.world.removeCollider(c, false); this.actors.delete(id); this.actorPoses.delete(id); this.queryDirty = true; }
    for (const b of bodies) {
      const key = `${b.position.x},${b.position.y},${b.position.z},${b.radius},${b.height}`;
      if (this.actorPoses.get(b.id) === key) continue;
      let c = this.actors.get(b.id);
      if (!c) {
        c = this.world.createCollider(RAPIER.ColliderDesc.capsule(Math.max(0, b.height / 2 - b.radius), b.radius).setCollisionGroups(ACTOR_GROUPS));
        this.actors.set(b.id, c); this.actorHandles.add(c.handle);
      }
      c.setShape(this.actorShape(b.radius, b.height));
      c.setTranslation({ x: b.position.x, y: b.position.y + b.height / 2 + OFFSET, z: b.position.z });
      this.actorPoses.set(b.id, key); this.queryDirty = true;
    }
  }

  /** Moving door panels occlude the camera; the existing door constraint owns walking. */
  setCameraObstacles(specs: readonly Obstacle[]) {
    const keep = new Set(specs.map(o => o.id));
    for (const [id, c] of this.cameraOnly) if (!keep.has(id)) { this.cameraHandles.delete(c.handle); this.world.removeCollider(c, false); this.cameraOnly.delete(id); this.cameraPoses.delete(id); this.queryDirty = true; }
    for (const o of specs) {
      const key = `${o.shape},${o.center.join(',')},${o.half.join(',')},${o.yaw ?? 0}`;
      if (this.cameraPoses.get(o.id) === key) continue;
      let c = this.cameraOnly.get(o.id);
      if (!c) { c = this.world.createCollider(this.obstacleDesc(o).setCollisionGroups(DOOR_CAMERA_GROUPS)); this.cameraOnly.set(o.id, c); this.cameraHandles.add(c.handle); }
      else {
        c.setTranslation({ x: o.center[0], y: o.center[1], z: o.center[2] });
        c.setShape(o.shape === 'cylinder' ? new RAPIER.Cylinder(o.half[1], o.half[0]) : new RAPIER.Cuboid(...o.half));
        c.setRotation({ x: 0, y: Math.sin((o.yaw ?? 0) / 2), z: 0, w: Math.cos((o.yaw ?? 0) / 2) });
      }
      this.cameraPoses.set(o.id, key); this.queryDirty = true;
    }
  }

  private bikeRotation(yaw = this.bodyYaw) {
    const c = Math.cos(yaw / 2) * Math.SQRT1_2, s = Math.sin(yaw / 2) * Math.SQRT1_2;
    return { x: c, y: s, z: -s, w: c }; // upright capsule axis Y -> horizontal Z, then heading
  }
  private bikeCenter() { const t = this.body.translation(); return { x: t.x, y: t.y - HEIGHT / 2 - OFFSET + .65, z: t.z }; }

  /** A 0.76 x 1.9 m swept bike footprint supplements the standing capsule. Its
   * rounded undercarriage clears gentle slopes; the standing capsule still owns ground support.
   * Reject mounting/turning where that footprint does not fit; runtime parks it. */
  setRiding(riding: boolean, yaw = this.bodyYaw): boolean {
    if (!riding && !this.riding) return true;
    this.flushQueries();
    // People are moving obstacles, not a reason to evict a rider. Movement still sweeps them.
    if (riding && this.world.intersectionWithShape(this.bikeCenter(), this.bikeRotation(yaw), this.bikeShape, undefined, STATIC_GROUPS, this.body)) return false;
    this.bodyYaw = yaw; this.riding = riding; return true;
  }

  /** Capsule clearance from a proposed foot position. The small bottom gap ignores its floor. */
  private freeFoot(p: Vector3) {
    this.flushQueries();
    return !this.world.intersectionWithShape({ x: p.x, y: p.y + HEIGHT / 2 + OFFSET + .01, z: p.z }, this.identity,
      new RAPIER.Capsule(HALF, RADIUS), undefined, MOVE_GROUPS, this.body);
  }

  /** Actual supporting surface near the requested floor. The bounded vertical window
   * prevents jumping to an upper storey or a roof; props and people never become ground. */
  supportAt(x: number, z: number, referenceY: number): number | undefined {
    if (![x, z, referenceY].every(Number.isFinite)) return undefined;
    this.flushQueries();
    const ray = new RAPIER.Ray({ x, y: referenceY + .65, z }, { x: 0, y: -1, z: 0 });
    const hit = this.world.castRayAndGetNormal(ray, 2.15, true, undefined, STATIC_GROUPS, this.body, undefined,
      c => !this.obstacleHandles.has(c.handle));
    return hit && hit.normal.y >= .64 ? referenceY + .65 - hit.timeOfImpact : undefined;
  }

  /** Find a supported point near a spawn/teleport without moving through an obstacle.
   * The vertical search stays near the requested floor, never jumps to a roof. */
  safeTeleport(wanted: Vector3, radius = 4, accept?: (candidate: Vector3) => boolean): boolean {
    const tries = [wanted.clone()];
    for (let r = .5; r <= radius; r += .5) for (let k = 0; k < 16; k++) tries.push(new Vector3(wanted.x + Math.cos(k * Math.PI / 8) * r, wanted.y, wanted.z + Math.sin(k * Math.PI / 8) * r));
    for (const p of tries) {
      const support = this.supportAt(p.x, p.z, wanted.y);
      if (support === undefined) continue;
      p.y = support + .025;
      if (!this.freeFoot(p)) continue;
      // A supported patch can still be isolated from the walking network (e.g. beside a
      // tunnel portal). Callers with a destination validate connectivity before committing.
      if (accept && !accept(p.clone())) continue;
      this.setRiding(false); this.teleport(p); return true;
    }
    return false;
  }

  /** Recent grounded positions, nearest first; an unsupported teleport never replaces them. */
  recoverSafe(): boolean {
    const near = [...this.safe].reverse().map(p => p.clone()).sort((a, b) => Math.hypot(a.x - this.position.x, a.z - this.position.z) - Math.hypot(b.x - this.position.x, b.z - this.position.z));
    for (const p of near) if (this.safeTeleport(p, 0)) return true;
    return false;
  }

  /** Actor sweeps include the player and other NPCs, but exclude that actor itself. */
  sweepActor(id: string, from: Vector3, to: Vector3, radius = .32, height = 1.7): number {
    this.flushQueries();
    const dir = to.clone().sub(from), len = dir.length(), own = this.actors.get(id);
    const shape = own?.shape ?? this.actorShape(radius, height);
    if (len < 1e-6) return this.world.intersectionWithShape(from, this.identity, shape, undefined, MOVE_GROUPS, own) ? 0 : Infinity;
    dir.divideScalar(len);
    const hit = this.world.castShape(from, this.identity, dir, shape, 0, len, false, undefined, MOVE_GROUPS, own);
    return hit ? hit.time_of_impact : len;
  }

  /** Seconds the character has been airborne; the avatar waits before showing a fall pose. */
  get airborneFor() { return this.airTime; }

  teleport(p: Vector3): void {
    this.position.copy(p);
    this.body.setTranslation({ x: p.x, y: p.y + HALF + RADIUS + OFFSET, z: p.z });
    this.velocity.set(0, 0, 0);
    this.vy = 0; this.onGround = false; this.jumpHeld = false; this.airTime = 0;
    this.groundNormal.set(0, 1, 0);
    this.queryDirty = true;
  }

  step(direction: Vector3, dt: number, jump: boolean, speed = 4): void {
    this.flushQueries();
    const pressed = jump && !this.jumpHeld;
    this.jumpHeld = jump;
    if (!Number.isFinite(dt) || dt <= 0) return;
    speed = Number.isFinite(speed) ? Math.max(0, speed) : 0;
    this.wish.set(Number.isFinite(direction.x) ? direction.x : 0, 0, Number.isFinite(direction.z) ? direction.z : 0);
    if (this.wish.lengthSq() > 1) this.wish.normalize();
    this.wish.multiplyScalar(speed);
    this.intendedSpeed = this.wish.length();
    if (pressed && this.onGround) { this.vy = JUMP; this.onGround = false; }
    const start = this.position.clone(), total = Math.min(dt, .25);
    let remaining = total;
    while (remaining > 1e-8) {
      const h = Math.min(remaining, SUBSTEP);
      this.vy = this.onGround && this.vy <= 0 ? -PRESS : this.vy - GRAVITY * h;
      this.sub.copy(this.wish);
      if (this.constrain) { this.readFoot(); this.constrain(this.position, this.sub, h); }
      if (this.sub.lengthSq() > 0) {
        // Aim up a supporting slope so climbing keeps the full horizontal pace. Never aim down here:
        // a downward sweep catches slab seams; descending is the vertical pass and snapping's job.
        const n = this.groundNormal, along = this.onGround ? Math.max(0, -(n.x * this.sub.x + n.z * this.sub.z) / n.y) : 0;
        const dx = this.sub.x * h, dz = this.sub.z * h;
        let m = this.move(dx, along * h, dz, false);
        // Grazing the end of a parallel wall can zero the sweep: back off the contact and retry once.
        if (m.x * dx + m.z * dz < .1 * (dx * dx + dz * dz)) {
          let nx = 0, nz = 0;
          for (let i = 0; i < this.kcc.numComputedCollisions(); i++) { const c = this.kcc.computedCollision(i); if (c && Math.abs(c.normal1.y) < .3) { nx += c.normal1.x; nz += c.normal1.z; } }
          const l = Math.hypot(nx, nz);
          // Only for grazing contacts (normal nearly perpendicular to the motion); head-on walls stay solid.
          const d = Math.hypot(dx, dz), graze = l > 1e-6 && Math.abs((nx * dx + nz * dz) / (l * d)) < .3;
          if (graze) { this.move(nx / l * .015, 0, nz / l * .015, false); m = this.move(dx, along * h, dz, false); }
        }
        // Fallback step-up (lift, move, settle) for kerbs beside a wall corner, where autostep gives up.
        if (this.onGround && m.x * dx + m.z * dz < .5 * (dx * dx + dz * dz)) this.stepUp(dx, dz, m.x * dx + m.z * dz);
      }
      const m = this.move(0, this.vy * h, 0, true);
      const grounded = this.kcc.computedGrounded();
      // A ceiling hit while rising stops the jump.
      if (this.vy > 0 && m.y < this.vy * h * .5) this.vy = 0;
      if (grounded && this.vy <= 0) { this.vy = 0; this.onGround = true; this.airTime = 0; }
      else { this.onGround = false; this.airTime += h; }
      remaining -= h;
    }
    this.readFoot();
    this.velocity.copy(this.position).sub(start).divideScalar(total);
    if (this.position.distanceToSquared(start) > 1e-12) this.queryDirty = true;
    // The KCC has already established support. Record sparse candidates without a second
    // triangle-overlap query every frame; recoverSafe revalidates against the current world.
    if (this.onGround && (!this.safe.length || this.position.distanceToSquared(this.safe[this.safe.length - 1]) > .75 * .75)) {
      this.safe.push(this.position.clone()); if (this.safe.length > 120) this.safe.shift();
    }
  }

  /** Swept sphere from `from` toward `to`; returns the free distance (camera occlusion). */
  sweep(from: Vector3, to: Vector3, radius = .2): number {
    this.flushQueries();
    const dir = to.clone().sub(from), len = dir.length();
    if (len < 1e-6) return 0;
    dir.divideScalar(len);
    const hit = this.world.castShape(from, { x: 0, y: 0, z: 0, w: 1 }, dir, new RAPIER.Ball(radius), 0, len, true,
      undefined, CAMERA_GROUPS, this.body);
    return hit ? hit.time_of_impact : len;
  }

  dispose(): void { this.world.free(); }

  private readFoot() { const t = this.body.translation(); this.position.set(t.x, t.y - HALF - RADIUS - OFFSET, t.z); }

  private stepUp(dx: number, dz: number, progress: number) {
    const t0 = this.body.translation(), back = { x: t0.x, y: t0.y, z: t0.z };
    const up = this.move(0, STEP, 0, false).y;
    const m = this.move(dx, 0, dz, false);
    const down = this.move(0, -(up + .05), 0, false);
    const landed = this.kcc.computedGrounded() && up + down.y < STEP + 1e-3 && up + down.y > .02;
    if (!landed || m.x * dx + m.z * dz <= progress + 1e-6) this.body.setTranslation(back);
  }

  private move(x: number, y: number, z: number, support: boolean) {
    const t = this.body.translation();
    if (this.riding && (Math.abs(x) > 1e-8 || Math.abs(z) > 1e-8)) {
      const len = Math.hypot(x, y, z), dir = { x: x / len, y: y / len, z: z / len };
      const hit = this.world.castShape(this.bikeCenter(), this.bikeRotation(), dir, this.bikeShape, 0, len, false, undefined, MOVE_GROUPS, this.body);
      if (hit) { const fraction = Math.max(0, hit.time_of_impact - .005) / len; x *= fraction; y *= fraction; z *= fraction; }
    }
    this.kcc.computeColliderMovement(this.body, { x, y, z }, undefined, MOVE_GROUPS);
    const m = this.kcc.computedMovement();
    this.body.setTranslation({ x: t.x + m.x, y: t.y + m.y, z: t.z + m.z });
    if (support) {
      this.groundNormal.set(0, 1, 0);
      for (let i = 0, best = -1; i < this.kcc.numComputedCollisions(); i++) {
        const c = this.kcc.computedCollision(i);
        if (c && c.normal1.y >= .64 && c.normal1.y > best) { best = c.normal1.y; this.groundNormal.set(c.normal1.x, c.normal1.y, c.normal1.z); }
      }
    }
    return m;
  }
}
