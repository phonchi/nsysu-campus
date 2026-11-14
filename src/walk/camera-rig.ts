import { MathUtils, PerspectiveCamera, Vector3 } from 'three';
import type { SeatView } from '../world/seats';
import { isForwardMove, type MoveAxes } from './input';

/** Free distance from `from` toward `to` for a small sphere (the controller's Rapier sweep). */
export type Sweep = (from: Vector3, to: Vector3, radius: number) => number;

export const EYE = 1.55, PIVOT = 1.45;
const PITCH_MIN = -.75, PITCH_MAX = .5;
const damp = (k: number, dt: number) => 1 - Math.exp(-k * dt);
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export type CameraMode = 'follow' | 'free' | 'firstPerson';
export const CAMERA_MODE_KEY = 'nsysu-walk-camera-mode-v11';
export const CAMERA_MODE_LABEL: Record<CameraMode,string> = {follow:'跟隨',free:'自由',firstPerson:'第一人稱'};
export interface CameraStorage { getItem(key:string):string|null; setItem(key:string,value:string):void }
function defaultStorage(): CameraStorage | undefined {
  try { return typeof localStorage === 'undefined' ? undefined : localStorage; } catch { return {getItem(){throw Error('Storage unavailable');},setItem(){throw Error('Storage unavailable');}}; }
}
export function readCameraMode(storage:CameraStorage|undefined):CameraMode {
  try { const mode=storage?.getItem(CAMERA_MODE_KEY); return mode==='free'||mode==='firstPerson'?mode:'follow'; } catch { return 'follow'; }
}
export const nextCameraMode=(mode:CameraMode):CameraMode=>mode==='follow'?'free':mode==='free'?'firstPerson':'follow';
export interface CameraFollowTarget { yaw:number; source:'manual'|'route' }
/** Runtime uses raw intent and measured movement, never the already-turned avatar to infer W/S. */
export function cameraFollowTarget(f:{mode:CameraMode;axes:MoveAxes;speed:number;heading:number;route:boolean;blocked:boolean}):CameraFollowTarget|undefined {
  if(f.blocked||f.mode==='free')return undefined;
  if(f.route)return {yaw:f.heading,source:'route'};
  if(f.mode==='follow'&&isForwardMove(f.axes,f.speed))return {yaw:f.heading,source:'manual'};
  return undefined;
}

export interface RigFrame {
  /** Character feet this frame. */
  foot: Vector3;
  running: boolean;
  moving: boolean;
  /** Heading to ease toward while auto-walking a route; undefined leaves the view alone. */
  followHeading?: number;
  follow?: CameraFollowTarget;
  gait?: 'walk'|'run'|'ride';
  blocked?: boolean;
}

/** Third-person follow camera with a damped pivot, a collision-safe arm and a hard lock.
 * Every automatic turn shares mode, lock, posture and recent-manual-input guards. */
export class CameraRig {
  seated = false;
  private seatedHeading?:number;
  setSeated(seated:boolean,heading?:number){
    if(this.seated&&!seated)this.protect();
    this.seated=seated;this.seatedHeading=seated?heading:undefined;
  }
  /** Pose-derived eye/pivot; the physical foot never receives a second height offset. */
  poseView?:SeatView;
  private get pivotHeight(){return this.seated&&this.poseView?this.poseView.pivotHeight:PIVOT;}
  private get eyeHeight(){return this.seated&&this.poseView?this.poseView.eyeHeight:EYE;}
  yaw = -Math.PI / 2;
  pitch = -.18;
  /** Arm length the player asked for (wheel / pinch). */
  distance = 4.6;
  locked = false;
  private _mode: CameraMode;
  get mode(){return this._mode;}
  get firstPerson(){return this._mode==='firstPerson';}
  setMode(mode:CameraMode){
    try { this.storage?.setItem(CAMERA_MODE_KEY,mode);this._mode=mode; }
    catch { this._mode='follow'; }
    return this._mode;
  }
  cycleMode(){return this.setMode(nextCameraMode(this.mode));}
  private manualUntil=0;
  protect(){this.manualUntil=this.now()+1500;}
  canAutoTurn(source:'manual'|'route', allowSeated=false){
    return !this.locked && (!this.seated||allowSeated) && this.now()>=this.manualUntil &&
      (this.mode==='follow'||(this.firstPerson&&source==='route'));
  }
  /** Route arrivals use this too, so free/lock/drag cannot be bypassed. */
  faceRoute(yaw:number){if(!this.canAutoTurn('route'))return false;this.yaw=wrap(yaw);return true;}
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

  constructor(private camera: PerspectiveCamera, private sweep: Sweep,
    private storage:CameraStorage|undefined=defaultStorage(),private now:()=>number=()=>performance.now()) {
    this._mode=readCameraMode(storage);
  }

  /** Direction the camera faces on the ground plane; WASD is relative to this. */
  get forward() { return new Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)); }

  rotate(dx: number, dy: number) {
    if (this.locked || (!dx && !dy)) return;
    this.protect();
    this.seatedHeading=undefined; // A deliberate camera drag takes over after sitting down.
    this.yaw = wrap(this.yaw - dx * .004);
    this.pitch = MathUtils.clamp(this.pitch - dy * .003, PITCH_MIN, PITCH_MAX);
  }

  zoom(delta: number) {
    if (this.locked || this.firstPerson) return;
    this.distance = MathUtils.clamp(this.distance * Math.exp(delta * .001), 2.2, 9);
  }

  toggleLock() { this.locked = !this.locked; if(!this.locked)this.protect(); return this.locked; }

  /** Snap the pivot after a teleport so the camera does not sweep across the campus. */
  snap(foot: Vector3) { this.pivot.copy(foot).y += this.pivotHeight; this.arm = this.distance; this.placed = true; }

  update(dt: number, f: RigFrame) {
    const cam = this.camera;
    if(this.seated&&this.poseView)f={...f,foot:f.foot.clone().add(new Vector3(this.poseView.offsetX,0,this.poseView.offsetZ))};
    if (!this.placed) this.snap(f.foot);
    // Pivot: quick horizontally, softer vertically so stair steps and landings never jolt the view.
    const kx = damp(14, dt), ky = damp(7, dt);
    this.pivot.x += (f.foot.x - this.pivot.x) * kx;
    this.pivot.z += (f.foot.z - this.pivot.z) * kx;
    this.pivot.y += (f.foot.y + this.pivotHeight - this.pivot.y) * ky;
    // A smoothed pivot can cut across a corner even while the player's capsule is safe.
    // Keep the pivot on the player's side of the wall before sweeping the camera arm.
    this.anchor.copy(f.foot).y += this.pivotHeight;
    const offset = this.want.copy(this.pivot).sub(this.anchor), span = offset.length();
    if (span > 1e-5) {
      const free = Math.max(0, this.sweep(this.anchor, this.pivot, .16) - .01);
      if (free < span) this.pivot.copy(this.anchor).addScaledVector(offset, free / span);
    }
    const follow=f.follow??(f.followHeading===undefined?undefined:{yaw:f.followHeading,source:'route' as const});
    if(!f.blocked && this.seated && this.seatedHeading!==undefined && this.canAutoTurn('route',true))
      this.yaw=wrap(this.yaw+wrap(this.seatedHeading-this.yaw)*damp(6,dt));
    else if(!f.blocked && follow && this.canAutoTurn(follow.source)) {
      const gait=f.gait??(f.running?'run':'walk');
      const [k,limit]=follow.source==='route'?[2,Infinity]:gait==='ride'?[4,150]:gait==='run'?[3.5,110]:[2.5,90];
      const delta=wrap(follow.yaw-this.yaw);
      if(Math.abs(delta)>MathUtils.degToRad(3)) {
        const step=MathUtils.clamp(delta*damp(k,dt),-MathUtils.degToRad(limit)*dt,MathUtils.degToRad(limit)*dt);
        this.yaw=wrap(this.yaw+step);
      }
    }
    this.look.set(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
    const targetFov = f.running && f.moving && !this.firstPerson ? 64 : 58;
    this.fov += (targetFov - this.fov) * damp(4, dt);
    if (Math.abs(cam.fov - this.fov) > .01) { cam.fov = this.fov; cam.updateProjectionMatrix(); }
    if (this.firstPerson) {
      cam.position.set(f.foot.x, this.pivot.y - this.pivotHeight + this.eyeHeight, f.foot.z);
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
    // Pressed against a door or wall the wide ball starts overlapping it and reports no room at all; a thin one still finds the way back.
    const wide = this.sweep(this.pivot, this.want, .2), free = Math.max(0, (wide > .001 ? wide : this.sweep(this.pivot, this.want, .1)) - .05);
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
