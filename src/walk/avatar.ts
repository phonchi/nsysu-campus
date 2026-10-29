import * as T from 'three';
import { RideRig, soleSide, type RideDiagnostics } from './ride-rig';

export type AvatarState = 'idle' | 'walk' | 'run' | 'jump' | 'fall' | 'land' | 'wave' | 'talk' | 'ride';

/** Clip names tried per state, first match wins (our Blender rigs and the CC0 packs differ). */
const CLIPS: Record<AvatarState, string[]> = {
  idle: ['Idle', 'Idle_Neutral', 'Idle_Loop'],
  walk: ['Walk', 'Walk_Loop', 'Walking'],
  run: ['Run', 'Run_Loop', 'Running', 'Sprint'],
  jump: ['Jump', 'Jump_Start', 'Jump_Idle'],
  fall: ['Fall', 'Jump_Idle', 'Jump_Loop', 'Jump'],
  land: ['Land', 'Jump_Land'],
  wave: ['Wave', 'Wave_Loop'],
  talk: ['Talk', 'Talking', 'Idle'],
  ride: ['Ride'],
};
const ONE_SHOT: AvatarState[] = ['jump', 'land', 'wave'];
const damp = (k: number, dt: number) => 1 - Math.exp(-k * dt);
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export interface AvatarInput {
  foot: T.Vector3;
  onGround: boolean;
  /** Seconds airborne (controller); short gaps over seams never show a fall pose. */
  airborneFor: number;
  /** Horizontal speed actually achieved this frame. */
  speed: number;
  /** Speed the input asked for. */
  intendedSpeed: number;
  /** World-space movement direction the input asked for (unnormalised is fine). */
  heading?: T.Vector3;
  jumped: boolean;
  runSpeed: number;
  surfaceHeight?: number;
  rideContacts?: { front:number; rear:number };
  supportAt?: (x:number,z:number,referenceY:number)=>number|undefined;
}

/** The visible character: animation state machine, smoothed facing and smoothed visual height.
 * It only reads controller state; nothing here feeds back into physics. */
export class Avatar {
  readonly root = new T.Group();
  state: AvatarState = 'idle';
  constructor(){this.root.rotation.order='YXZ';}
  private mixer?: T.AnimationMixer;
  private actions = new Map<AvatarState, T.AnimationAction>();
  private current?: T.AnimationAction;
  private facing = 0;
  private visualY?: number;
  private animSpeed = 0;
  private wasGround = true;
  private oneShotLeft = 0;
  private materials: T.Material[] = [];
  private squash = 0;
  private model?: T.Object3D;
  private vehicle?: T.Object3D;
  private rideRig?: RideRig;
  private wasRiding=false;
  private lastFrame?: AvatarInput;
  /** On the rental bike: seated pose, raised onto the saddle, the bike drawn under the avatar. */
  riding = false;
  /** Saddle height above the feet for the seated clip. */
  seatLift = .42;

  /** Replace the model; animations are optional (a static fallback figure still turns and bobs). */
  setModel(model: T.Object3D, clips: T.AnimationClip[] = []) {
    this.disposeModel();
    this.root.add(model); this.model = model;
    model.traverse(o => {
      if (o instanceof T.Mesh) {
        o.castShadow = true;
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) this.materials.push(m);
      }
    });
    if (clips.length) {
      this.mixer = new T.AnimationMixer(model);
      for (const [state, names] of Object.entries(CLIPS) as [AvatarState, string[]][]) {
        const clip = names.map(n => clips.find(c => c.name === n)).find(Boolean);
        if (!clip) continue;
        const action = this.mixer.clipAction(clip);
        if (ONE_SHOT.includes(state)) { action.setLoop(T.LoopOnce, 1); action.clampWhenFinished = true; }
        this.actions.set(state, action);
      }
    }
    this.current = undefined;
    this.play(this.state, 0);
    this.mixer?.update(0);this.rebuildRide();
  }

  get rideReady() { return this.rideRig?.ready ?? false; }
  get rideDiagnostics(): RideDiagnostics | undefined { return this.rideRig?.diagnostics; }
  private rebuildRide() { this.rideRig?.reset();this.mixer?.stopAllAction();const idle=this.actions.get('idle');idle?.reset().play();this.mixer?.update(0);this.current=idle;this.rideRig = this.model && this.vehicle ? new RideRig(this.model,this.vehicle,this.root) : undefined;if(this.riding){idle?.stop();this.current=undefined;} }

  get footDiagnostics() {
    this.root.updateMatrixWorld(true);const points:{L:T.Vector3[];R:T.Vector3[]}={L:[],R:[]};
    this.model?.traverse(o=>{if(!(o instanceof T.SkinnedMesh)||o.userData.outlineHull)return;o.skeleton.update();const uv=o.geometry.attributes.uv;if(!uv)return;for(let i=0;i<uv.count;i++){if(Math.abs(uv.getX(i)-.4375)>.004||Math.abs(uv.getY(i)-.1875)>.004)continue;const side=soleSide(o,i);if(side)points[side].push(o.getVertexPosition(i,new T.Vector3()).applyMatrix4(o.matrixWorld));}});
    return {onGround:this.lastFrame?.onGround??false,state:this.state,feet:Object.entries(points).filter(([,ps])=>ps.length).map(([name,ps])=>{
      const centre=ps.reduce((a,b)=>a.add(b),new T.Vector3()).divideScalar(ps.length);
      const samples=ps.map(v=>{const support=this.lastFrame?.supportAt ? this.lastFrame.supportAt(v.x,v.z,this.lastFrame.foot.y) : this.lastFrame?.surfaceHeight;return {position:v.toArray(),support,clearance:support===undefined?undefined:v.y-support};});
      const known=samples.filter((s):s is {position:T.Vector3Tuple;support:number;clearance:number}=>s.support!==undefined&&s.clearance!==undefined).sort((a,b)=>a.clearance-b.clearance);
      const contact=known[0];
      return {name,centre:centre.toArray(),sole:contact?.position??centre.toArray(),support:contact?.support,clearance:contact?.clearance,minVertexClearance:contact?.clearance,vertexClearances:samples.map(s=>s.clearance),vertexSamples:samples};
    })};
  }

  get hasAnimations() { return this.actions.size > 0; }
  get heading() { return this.facing; }

  /** Instantly face a direction (after teleports or cut-scenes). */
  face(angle: number) { this.facing = angle; this.root.rotation.y = angle; }

  /** Play a gesture (wave/talk) until movement resumes. */
  gesture(state: 'wave' | 'talk') { this.setState(state); }

  setOpacity(alpha: number) {
    this.root.visible = alpha > .02;
    for (const m of this.materials) {
      const want = alpha < .999;
      if (m.transparent !== want) { m.transparent = want; m.needsUpdate = true; }
      m.opacity = alpha;
      m.depthWrite = !want;
    }
  }

  update(dt: number, f: AvatarInput) {
    this.rideRig?.releaseGround();
    this.lastFrame=f;
    // Visual height: follows the feet closely, but filters millimetre contact noise and stair-step pops.
    // The grounded capsule can retain a small collision offset above its support.
    // Place the visible feet on that support instead of pulling the animated torso
    // down separately on whichever swing foot happens to be lowest this frame.
    const targetY=f.onGround&&f.surfaceHeight!==undefined&&Math.abs(f.foot.y-f.surfaceHeight)<.15?f.surfaceHeight:f.foot.y;
    if (this.visualY === undefined || !f.onGround || Math.abs(targetY - this.visualY) > .6) this.visualY = targetY;
    else this.visualY += (targetY - this.visualY) * damp(30, dt);
    if(f.surfaceHeight!==undefined&&f.onGround)this.visualY=Math.max(this.visualY,f.surfaceHeight);
    this.root.position.set(f.foot.x, this.visualY, f.foot.z);

    // Facing: toward the requested direction, never snapping (S turns the character around smoothly).
    if (f.heading && f.heading.x * f.heading.x + f.heading.z * f.heading.z > 1e-6 && f.intendedSpeed > .05) {
      const target = Math.atan2(-f.heading.x, -f.heading.z);
      this.facing = wrap(this.facing + wrap(target - this.facing) * damp(12, dt));
    }
    this.root.rotation.y = this.facing;

    // State machine.
    const moving = Math.min(f.speed, f.intendedSpeed) > .25;
    if(this.riding&&!this.rideReady)this.riding=false;
    if(this.riding){
      if(!this.wasRiding){this.mixer?.stopAllAction();this.current=undefined;this.rideRig?.reset();}
      this.state='ride';this.root.scale.set(1,1,1);
      let contacts=f.rideContacts;
      if(f.supportAt){const dx=-Math.sin(this.facing)*.52,dz=-Math.cos(this.facing)*.52,front=f.supportAt(f.foot.x+dx,f.foot.z+dz,f.foot.y),rear=f.supportAt(f.foot.x-dx,f.foot.z-dz,f.foot.y);if(front===undefined||rear===undefined){this.riding=false;this.rideRig?.reset();if(this.vehicle)this.vehicle.visible=false;return;}contacts={front,rear};}
      if(contacts){const pitch=Math.atan2(contacts.front-contacts.rear,1.04);this.root.position.y=(contacts.front+contacts.rear)/2+.365-.35*Math.cos(pitch);}
      if(!this.rideRig?.apply(f.foot,contacts)){this.riding=false;this.rideRig?.reset();if(this.vehicle)this.vehicle.visible=false;return;}this.wasRiding=true;this.wasGround=f.onGround;if(this.vehicle)this.vehicle.visible=true;return;
    }
    if(this.wasRiding){this.rideRig?.reset();this.wasRiding=false;this.current=undefined;this.root.rotation.x=0;}
    if(this.vehicle)this.vehicle.visible=false;
    if(this.model)this.model.position.y=0;
    if (f.jumped) this.setState('jump');
    else if (!f.onGround && f.airborneFor > .15 && this.state !== 'jump') this.setState('fall');
    else if (f.onGround && !this.wasGround && f.airborneFor === 0 && (this.state === 'fall' || this.state === 'jump')) {
      this.setState(moving ? (f.intendedSpeed > f.runSpeed * .8 ? 'run' : 'walk') : 'land');
      this.squash = 1;
    } else if ((f.onGround || (f.airborneFor <= .15 && this.state !== 'jump')) && !(this.oneShotLeft > 0 && !moving) && !((this.state === 'talk' || this.state === 'wave') && !moving)) {
      this.setState(moving ? (f.intendedSpeed > f.runSpeed * .8 ? 'run' : 'walk') : 'idle');
    }
    this.wasGround = f.onGround;
    this.oneShotLeft -= dt;

    // Landing squash (procedural, independent of clips).
    this.squash = Math.max(0, this.squash - dt * 6);
    const s = Math.sin(this.squash * Math.PI) * .08;
    this.root.scale.set(1 + s * .5, 1 - s, 1 + s * .5);

    // Playback speed from the intended speed, smoothed, so wall-sliding never flickers the gait.
    this.animSpeed += (Math.min(f.speed + .3, f.intendedSpeed) - this.animSpeed) * damp(8, dt);
    const walk = this.actions.get('walk'), run = this.actions.get('run');
    if (walk) walk.timeScale = T.MathUtils.clamp(this.animSpeed / 3.6, .7, 1.5);
    if (run) run.timeScale = T.MathUtils.clamp(this.animSpeed / f.runSpeed, .8, 1.3);
    this.mixer?.update(dt);
    if(f.onGround&&f.supportAt)this.rideRig?.groundFeet(f.supportAt,f.foot.y,!moving,dt);
  }

  /** Attach the bike (shown only while riding); wheels named /wheel/i spin with speed. */
  setVehicle(bike: T.Object3D) { this.vehicle?.removeFromParent(); this.vehicle = bike; bike.visible = this.riding; this.root.add(bike); this.rebuildRide(); }
  private spinWheels(speed: number, dt: number) {
    this.vehicle?.traverse(o => { if (/wheel/i.test(o.name)) o.rotation.x -= speed * dt / .34; });
  }

  private setState(next: AvatarState) {
    if (next === this.state && this.current) return;
    this.state = next;
    this.play(next, ONE_SHOT.includes(next) ? .12 : .2);
  }

  private play(state: AvatarState, fade: number) {
    const action = this.actions.get(state) ?? (state === 'land' || state === 'wave' || state === 'talk' ? this.actions.get('idle') : undefined);
    this.oneShotLeft = ONE_SHOT.includes(state) && action ? action.getClip().duration * .9 : 0;
    if (!action || action === this.current) return;
    action.reset().setEffectiveWeight(1).play();
    if (this.current && fade > 0) this.current.crossFadeTo(action, fade, false);
    else this.current?.stop();
    this.current = action;
  }

  private disposeModel() {
    this.rideRig?.reset();this.rideRig=undefined;
    this.mixer?.stopAllAction();
    if (this.mixer) this.mixer.uncacheRoot(this.mixer.getRoot());
    this.mixer = undefined; this.actions.clear(); this.current = undefined; this.materials = [];
    // Only the character model is ours to free; the bike (shared with the rental stand) stays attached.
    this.model?.traverse(o => {
      if (o instanceof T.Mesh) {
        o.geometry.dispose();
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) { (m as T.MeshStandardMaterial).map?.dispose(); m.dispose(); }
      }
    });
    for (const c of [...this.root.children]) if (c !== this.vehicle) this.root.remove(c);
    this.model = undefined;
  }

  dispose() { this.disposeModel(); }
}
