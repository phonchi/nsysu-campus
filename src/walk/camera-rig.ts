import { MathUtils, PerspectiveCamera, Vector3 } from 'three';

/** Free distance from `from` toward `to` for a small sphere (the controller's Rapier sweep). */
export type Sweep = (from: Vector3, to: Vector3, radius: number) => number;

export const EYE = 1.55, PIVOT = 1.45;
const PITCH_MIN = -.75, PITCH_MAX = .5;
const damp = (k: number, dt: number) => 1 - Math.exp(-k * dt);
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export interface RigFrame {
  /** Character feet this frame. */
  foot: Vector3;
  running: boolean;
  moving: boolean;
  /** Heading to ease toward while auto-walking a route; undefined leaves the view alone. */
  followHeading?: number;
}

/** Third-person follow camera with a damped pivot, a collision-safe arm and a hard lock.
 * Manual walking never rotates the view; only drags (unlocked) and auto-routes do. */
export class CameraRig {
  yaw = -Math.PI / 2;
  pitch = -.18;
  /** Arm length the player asked for (wheel / pinch). */
  distance = 4.6;
  locked = false;
  firstPerson = false;
  /** Arm length actually used this frame (after occlusion). */
  arm = 4.6;
  /** 1 = avatar fully visible, 0 = hidden because the camera is inside its head. */
  avatarOpacity = 1;
  private pivot = new Vector3();
  private placed = false;
  private fov = 58;
  private readonly look = new Vector3();
  private readonly want = new Vector3();
  private readonly anchor = new Vector3();

  constructor(private camera: PerspectiveCamera, private sweep: Sweep) {}

  /** Direction the camera faces on the ground plane; WASD is relative to this. */
  get forward() { return new Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)); }

  rotate(dx: number, dy: number) {
    if (this.locked) return;
    this.yaw = wrap(this.yaw - dx * .004);
    this.pitch = MathUtils.clamp(this.pitch - dy * .003, PITCH_MIN, PITCH_MAX);
  }

  zoom(delta: number) {
    if (this.locked || this.firstPerson) return;
    this.distance = MathUtils.clamp(this.distance * Math.exp(delta * .001), 2.2, 9);
  }

  toggleLock() { this.locked = !this.locked; return this.locked; }

  /** Snap the pivot after a teleport so the camera does not sweep across the campus. */
  snap(foot: Vector3) { this.pivot.copy(foot).y += PIVOT; this.arm = this.distance; this.placed = true; }

  update(dt: number, f: RigFrame) {
    const cam = this.camera;
    if (!this.placed) this.snap(f.foot);
    // Pivot: quick horizontally, softer vertically so stair steps and landings never jolt the view.
    const kx = damp(14, dt), ky = damp(7, dt);
    this.pivot.x += (f.foot.x - this.pivot.x) * kx;
    this.pivot.z += (f.foot.z - this.pivot.z) * kx;
    this.pivot.y += (f.foot.y + PIVOT - this.pivot.y) * ky;
    // A smoothed pivot can cut across a corner even while the player's capsule is safe.
    // Keep the pivot on the player's side of the wall before sweeping the camera arm.
    this.anchor.copy(f.foot).y += PIVOT;
    const offset = this.want.copy(this.pivot).sub(this.anchor), span = offset.length();
    if (span > 1e-5) {
      const free = Math.max(0, this.sweep(this.anchor, this.pivot, .16) - .01);
      if (free < span) this.pivot.copy(this.anchor).addScaledVector(offset, free / span);
    }
    if (f.followHeading !== undefined && !this.locked) this.yaw = wrap(this.yaw + wrap(f.followHeading - this.yaw) * damp(2, dt));
    this.look.set(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
    const targetFov = f.running && f.moving && !this.firstPerson ? 64 : 58;
    this.fov += (targetFov - this.fov) * damp(4, dt);
    if (Math.abs(cam.fov - this.fov) > .01) { cam.fov = this.fov; cam.updateProjectionMatrix(); }
    if (this.firstPerson) {
      cam.position.set(f.foot.x, this.pivot.y - PIVOT + EYE, f.foot.z);
      const delta = this.want.copy(cam.position).sub(this.anchor), length = delta.length();
      if (length > 1e-5) {
        const free = Math.max(0, this.sweep(this.anchor, cam.position, .16) - .01);
        if (free < length) cam.position.copy(this.anchor).addScaledVector(delta, free / length);
      }
      cam.lookAt(this.want.copy(cam.position).add(this.look));
      this.avatarOpacity = 0;
      return;
    }
    // Arm: pull in instantly to the free distance, ease back out slowly; never through a wall.
    this.want.copy(this.pivot).addScaledVector(this.look, -this.distance);
    const free = Math.max(0, this.sweep(this.pivot, this.want, .2) - .05);
    const eased = this.arm + (this.distance - this.arm) * damp(3, dt);
    this.arm = Math.max(0, Math.min(eased, free, this.distance));
    cam.position.copy(this.pivot).addScaledVector(this.look, -this.arm);
    // Low steps and kerbs have no collider that stops the arm; stay above them and keep the player framed.
    const floor = f.foot.y + .5;
    if (cam.position.y < floor) { cam.position.y = floor; cam.lookAt(this.pivot); }
    else cam.lookAt(this.want.copy(this.pivot).addScaledVector(this.look, 2));
    this.avatarOpacity = MathUtils.clamp((this.arm - .6) / .6, 0, 1);
  }
}
