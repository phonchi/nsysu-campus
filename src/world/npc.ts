import {configureCharacterCoverage,characterBodyStencil,CHARACTER_BODY_ORDER} from '../render/character-surface';
import {SeatRegistry,ChairPose,seatApproach,withinSeatApproach,type Seat,type SeatSpec} from './seats';
import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { toonify } from '../render/toon';
import { addOutlines } from '../render/outline';
import type { OutdoorRoutes } from '../walk/route';
import type { Terrain } from './terrain';
import { holds, type Facts } from '../story/dialogue';
import type { NpcData, NpcDef, ScheduleOverride } from '../story/talk';
import { recolor, modelFor, type Look } from '../walk/player-look';
import type { ActorBody, SupportAt } from '../walk/obstacles';

/** Sweeps body centres, excluding the named NPC itself. */
export type NpcSweep = (id: string, from: T.Vector3, to: T.Vector3, radius: number, height: number) => number;

/** A short swept step with two lateral alternatives. NPCs yield to nearby players
 * without pushing them, and do not change their scheduled/story-owned destination. */
export function moveNpcSafely(id: string, foot: T.Vector3, desired: T.Vector3, player: T.Vector3, dt: number, radius: number, height: number,
  ground: SupportAt, sweep?: NpcSweep): T.Vector3 {
  const origin = foot.clone(), requested = desired.clone().sub(foot); requested.y = 0;
  const dx = foot.x - player.x, dz = foot.z - player.z, distance = Math.hypot(dx, dz);
  if (Math.abs(foot.y - player.y) < 1.4 && distance < radius + .65) {
    // Start yielding before the player reaches the NPC collider. Stable tie-break if coincident.
    const away = distance > 1e-5 ? new T.Vector3(dx / distance, 0, dz / distance) : new T.Vector3(1, 0, 0);
    requested.addScaledVector(away, Math.min(.08, Math.max(0, dt) * 1.8));
  }
  if (requested.lengthSq() < 1e-10) return origin;
  const from = foot.clone().add(new T.Vector3(0, height / 2 + .025, 0));
  const tryStep = (step: T.Vector3) => {
    const p = origin.clone().add(step), support = ground(p.x, p.z, origin.y);
    if (support === undefined) return undefined;
    p.y = support;
    // Neither climb a cliff nor step off a ledge. Routes may update again next frame.
    if (Math.abs(p.y - origin.y) > .4) return undefined;
    const to = p.clone().add(new T.Vector3(0, height / 2 + .025, 0)), length = from.distanceTo(to);
    const free = sweep?.(id, from, to, radius, height) ?? length;
    if (free + 1e-4 < length) return undefined;
    return p;
  };
  const direct = tryStep(requested); if (direct) return direct;
  // Try both shoulders, then wait. Every alternative is swept against the real world.
  const side = new T.Vector3(-requested.z, 0, requested.x).normalize().multiplyScalar(Math.min(.08, dt * 1.4));
  return tryStep(side) ?? tryStep(side.negate()) ?? origin;
}

/** Bounded, height-aware landing search. Reservations include asynchronous arrivals. */
export function findFreeNpcPlacement(id:string,wanted:T.Vector3,ground:SupportAt,sweep:NpcSweep|undefined,
  occupied:readonly ActorBody[],from?:T.Vector3,radius=.32,height=1.7):T.Vector3|undefined {
  const candidates=[wanted.clone()];
  for(const r of [.75,1.1,1.4])for(let k=0;k<12;k++)candidates.push(wanted.clone().add(new T.Vector3(Math.cos(k*Math.PI/6)*r,0,Math.sin(k*Math.PI/6)*r)));
  const centre=(p:T.Vector3)=>p.clone().add(new T.Vector3(0,height/2+.025,0));
  for(const p of candidates){
    const y=ground(p.x,p.z,wanted.y);if(y===undefined||!Number.isFinite(y)||Math.abs(y-wanted.y)>.4)continue;p.y=y;
    if(occupied.some(b=>b.id!==id&&p.y<b.position.y+b.height&&b.position.y<p.y+height&&Math.hypot(p.x-b.position.x,p.z-b.position.z)<radius+b.radius+.04))continue;
    const at=centre(p);if(sweep&&sweep(id,at,at,radius,height)!==Infinity)continue;
    const start=centre(from??wanted),len=start.distanceTo(at);
    if(sweep&&len>1e-5&&sweep(id,start,at,radius,height)+1e-4<len)continue;
    return p;
  }
  return undefined;
}

/** Opacity from camera distance to the finite vertical body axis. */
export function npcCameraOpacity(camera: T.Vector3, foot: T.Vector3, height: number) {
  const y = Math.max(foot.y, Math.min(foot.y + height, camera.y));
  return T.MathUtils.clamp((Math.hypot(camera.x - foot.x, camera.y - y, camera.z - foot.z) - .55) / .45, 0, 1);
}

type P2 = [number, number];
export interface ZoneSpec { label: string; sub?: string; p: P2; r: number; y?: number; seat?:string }
export interface NpcSpec { model: string; at: string; offset?: P2; activity?: string; seat?:string }
export interface StoryZones { seats?:Record<string,SeatSpec>; zones: Record<string, ZoneSpec>; npcs: Record<string, NpcSpec>; ambient?: { students: string[]; monkeys: number } }

/** Include every scheduled/ambient model even if its anchor is missing or its schedule is absent.
 * Player body swaps and EncounterScene's separately loaded macaque are independent of NPC spawning. */
export function characterWarmupModelIds(zones:StoryZones,data?:Pick<NpcData,'npcs'>):string[] {
  return [...new Set([
    ...Object.values(zones.npcs).map(n=>n.model),...(zones.ambient?.students??[]),
    ...(data?.npcs??[]).map(n=>n.model),modelFor('m'),modelFor('f'),'monkey',
  ])].sort();
}
export interface CharacterWarmupVariant {model:string;shader:'source'|'npc-recolored';transparent:boolean}
/** Temporary skinned objects are removed after drawing; only their material references survive.
 * Disposing those materials immediately would evict any program used only by a future character. */
export class CharacterWarmupSamples {
  readonly group=new T.Group();
  readonly modelIds:string[]=[];
  readonly failedModels:string[]=[];
  readonly variants:CharacterWarmupVariant[]=[];
  private materials=new Set<T.Material>();
  private skeletons=new Set<T.Skeleton>();
  constructor(){this.group.name='Character shader warmup';this.group.visible=false;}
  get retainedMaterialCount(){return this.materials.size;}
  add(model:string,source:T.Object3D,recolored:boolean) {
    for(const shader of (recolored?['source','npc-recolored']:['source']) as CharacterWarmupVariant['shader'][])for(const transparent of [false,true]){
      const copy=cloneSkinned(source),variant={model,shader,transparent};
      copy.name=`Warmup ${model} ${shader} ${transparent?'fade':'opaque'}`;copy.userData.characterWarmup=variant;
      // Faded characters hide their hulls, so only the opaque variant needs an outline program.
      if(!transparent)addOutlines(copy,'character');
      const clones=new Map<T.Material,T.Material>();
      copy.traverse(object=>{
        if(object instanceof T.SkinnedMesh)this.skeletons.add(object.skeleton);
        if(!(object instanceof T.Mesh))return;
        const clone=(original:T.Material)=>{
          let material=clones.get(original);if(material)return material;
          material=original.clone();
          // Npc.spawn's recoloring clone currently has the default shader hooks. The raw source,
          // player, encounter and outline paths preserve their custom toon/outline patches.
          if(shader==='source'||object.userData.outlineHull){material.onBeforeCompile=original.onBeforeCompile;material.customProgramCacheKey=original.customProgramCacheKey;}
          material.transparent=original.transparent||transparent;
          material.opacity=original.opacity*(transparent?.5:1);material.depthWrite=original.depthWrite&&!transparent;
          if(!object.userData.outlineHull){configureCharacterCoverage(material);characterBodyStencil(material);object.renderOrder=CHARACTER_BODY_ORDER;}
          clones.set(original,material);this.materials.add(material);return material;
        };
        object.material=Array.isArray(object.material)?object.material.map(clone):clone(object.material);
        if(!object.userData.outlineHull)object.castShadow=true;
      });
      this.group.add(copy);this.variants.push(variant);
    }
    this.modelIds.push(model);
  }
  removeFromScene(){
    this.group.removeFromParent();this.group.clear();
    for(const skeleton of this.skeletons)skeleton.dispose();this.skeletons.clear();
  }
  dispose(){this.removeFromScene();for(const material of this.materials)material.dispose();this.materials.clear();}
}

/** `load` supplies the existing toonified GLB source; geometry/textures remain owned by that cache.
 * Palette recoloring changes texture pixels, not map/UV/fog/gradientMap/skinning shader defines. */
export async function prepareCharacterWarmup(zones:StoryZones,data:Pick<NpcData,'npcs'>|undefined,load:(model:string)=>Promise<T.Object3D>) {
  const samples=new CharacterWarmupSamples(),recolored=new Set((data?.npcs??[]).filter(n=>n.look).map(n=>n.model));
  await Promise.all(characterWarmupModelIds(zones,data).map(async model=>{
    try {samples.add(model,await load(model),recolored.has(model));}catch{samples.failedModels.push(model);}
  }));
  samples.modelIds.sort();samples.failedModels.sort();return samples;
}
export type Preset = 'day' | 'sunset' | 'night';
export type Placement = { at: string | P2; offset?: P2; activity?: string; seat?:string } | null;

/** NPCs whose position the story owns until the tour is complete (spec-v4 §15.1). */
/** Ambient walkers head here. The graph anchors for IL and ACTIVITY sit inside those buildings' solid colliders. */
const AMBIENT_ANCHORS = ['arcade', 'admin', 'library', 'YH', 'SPORT', 'CMSS'];
export const STORY_NPCS = ['guide', 's1', 's2', 's3', 'm1'];

/** Who stays visible, from a list sorted nearest first: those who must (talking, or named in `always`) count first, the rest fill the cap.
 * The goal's person comes on top of the cap: on the lowest tier the story cast nearly fills it, and taking the last place would hide whoever stands beside the player. */
export function npcsWithinCap<N extends { id: string; talking: boolean }>(sorted: readonly N[], cap: number, always: readonly string[], focus?: string) {
  const keep = sorted.filter(n => n.talking || always.includes(n.id));
  for (const n of sorted) if (!keep.includes(n) && keep.length < cap) keep.push(n);
  const wanted = focus === undefined ? undefined : sorted.find(n => n.id === focus);
  if (wanted && !keep.includes(wanted)) keep.push(wanted);
  return keep;
}

/** Where an NPC should be: the story decides for story NPCs until all chapters are done, otherwise the
 * schedule for the current light preset (null = not on campus now). Pure, so it is unit-tested. */
export function resolveNpcPlacement(id: string, def: NpcDef | undefined, preset: Preset, tourDone: boolean, zones: StoryZones, storyAt: Record<string, string>, overrides: readonly ScheduleOverride[] = [], facts?: Facts): Placement {
  if (STORY_NPCS.includes(id) && !tourDone) {
    const z = zones.npcs[id];
    return { at: storyAt[id] ?? z?.at ?? def?.schedule.day?.at ?? 'gate', offset: z?.offset, activity: z?.activity };
  }
  const override = facts && overrides.find(o => o.npc === id && o.preset === preset && holds(o.if, facts));
  if (override) return { at: override.at, offset: override.offset, activity: override.activity,seat:override.seat };
  const s = def?.schedule[preset];
  return s === undefined ? null : s;
}

/** Simultaneously visible NPCs per quality tier (people; macaques are counted separately), spec §11/§15.1. */
export const NPC_CAP: Record<'A' | 'B' | 'C', { day: number; night: number; monkeys: number }> = {
  A: { day: 12, night: 8, monkeys: 4 }, B: { day: 8, night: 6, monkeys: 3 }, C: { day: 5, night: 4, monkeys: 2 },
};

const damp = (k: number, dt: number) => 1 - Math.exp(-k * dt);

/** Free geometry, materials, textures and skeletons under a loaded (not necessarily attached) object. */
export function disposeObject(root: T.Object3D) {
  const seen = new Set<unknown>();
  root.traverse(o => {
    if (o instanceof T.SkinnedMesh) o.skeleton.dispose();
    if (!(o instanceof T.Mesh)) return;
    if (!seen.has(o.geometry)) { seen.add(o.geometry); o.geometry.dispose(); }
    for (const m of [o.material].flat() as T.Material[]) {
      if (seen.has(m)) continue; seen.add(m);
      for (const v of Object.values(m)) if (v instanceof T.Texture && !seen.has(v)) { seen.add(v); v.dispose(); }
      m.dispose();
    }
  });
}

/** One animated character in the world. Skinned clones share geometry and textures with the loaded GLB. */
class Npc {
  readonly root = new T.Group();
  private mixer: T.AnimationMixer;
  private chair:ChairPose;
  seat?:Seat;
  get seatDiagnostics(){return this.chair.diagnostics;}
  get animationState(){return {clip:this.current?.getClip().name,weight:this.current?.getEffectiveWeight(),time:this.mixer.time,seat:this.seat?.id,seated:!!this.seat&&!this.path.length&&withinSeatApproach(this.seat,this.position),contact:this.seatDiagnostics};}
  private fadeMaterials: { material: T.Material; source: T.Material }[] = [];
  private fade = 1;
  /** Only the qa=1 runtime hook writes this override. */
  qaFade?: number;
  private actions = new Map<string, T.AnimationAction>();
  private current?: T.AnimationAction;
  path: T.Vector3[] = [];
  speed = 1.4;
  heading = 0;
  talking = false;
  /** Activity loop when idle at its post (Idle, Talk, Sit). */
  activity = 'Idle';
  /** Not on campus at this time of day (schedule null). */
  absent = false;
  monkey = false;
  /** Recoloured clones own their materials and canvas textures (the GLB source owns the rest). */
  owned: T.Material[] = [];
  constructor(readonly id: string, private model: T.Object3D, clips: T.AnimationClip[]) {
    model.traverse(o => {
      if (!(o instanceof T.Mesh)) return;
      const clone = (source: T.Material) => {
        const material = source.clone();
        material.onBeforeCompile = source.onBeforeCompile;
        material.customProgramCacheKey = source.customProgramCacheKey;
        if(!o.userData.outlineHull)configureCharacterCoverage(material);
        this.fadeMaterials.push({ material, source });
        return material;
      };
      o.material = Array.isArray(o.material) ? o.material.map(clone) : clone(o.material);
    });
    model.rotation.y = Math.PI; // glTF characters face +Z; headings below assume -Z
    this.root.add(model);this.chair=new ChairPose(model,this.root);
    this.mixer = new T.AnimationMixer(model);
    for (const c of clips) this.actions.set(c.name, this.mixer.clipAction(c));
    this.play('Idle');this.mixer.update(0); // Even a capped/off-screen actor must never expose its bind pose.
  }
  get position() { return this.root.position; }
  play(name: string) {
    const a = this.actions.get(name) ?? (name === 'Run' ? this.actions.get('Walk') : undefined) ?? this.actions.get('Idle');
    if (!a || a === this.current) return;
    a.reset().play();
    if (this.current) this.current.crossFadeTo(a, .25, false);
    this.current = a;
  }
  update(dt: number, ground: SupportAt, player: T.Vector3, near: boolean, sweep?: NpcSweep) {
    this.chair.release();
    if(this.seat&&!this.path.length&&withinSeatApproach(this.seat,this.position)){
      this.heading=this.seat.spec.yaw;this.root.rotation.y=this.heading;
      this.play('Sit');this.mixer.update(dt);this.chair.apply(this.seat,this.position,ground);return;
    }
    const desired = this.root.position.clone();
    if (this.path.length && !this.talking) {
      const next = this.path[0], d = Math.hypot(next.x - this.root.position.x, next.z - this.root.position.z);
      if (d < (this.seat&&this.path.length===1?.08:.4)) this.path.shift();
      else {
        const step = Math.min(d, this.speed * dt);
        desired.x += (next.x - this.root.position.x) / d * step;
        desired.z += (next.z - this.root.position.z) / d * step;
        const want = Math.atan2(-(next.x - this.root.position.x), -(next.z - this.root.position.z));
        this.heading += Math.atan2(Math.sin(want - this.heading), Math.cos(want - this.heading)) * damp(8, dt);
      }
      this.play(this.speed > 2.5 ? 'Run' : 'Walk');
    } else {
      // At the post: face the player when they come close, otherwise keep the activity.
      if (near) {
        const want = Math.atan2(-(player.x - this.root.position.x), -(player.z - this.root.position.z));
        this.heading += Math.atan2(Math.sin(want - this.heading), Math.cos(want - this.heading)) * damp(5, dt);
      }
      this.play(this.talking ? 'Talk' : near && this.activity !== 'Sit' ? 'Wave' : this.activity==='Sit'&&!this.monkey?'Idle':this.activity);
    }
    const radius = this.monkey ? .24 : .32, height = this.monkey ? .65 : 1.7;
    if(!this.talking)this.root.position.copy(moveNpcSafely(this.id, this.root.position, desired, player, dt, radius, height, ground, sweep));
    this.root.rotation.y = this.heading;
    this.mixer.update(dt);
  }
  animateOnly(dt:number,ground:SupportAt){this.chair.release();this.mixer.update(dt);if(this.seat&&!this.path.length)this.chair.apply(this.seat,this.position,ground);}
  updateCamera(camera: T.Vector3) {
    const alpha = this.qaFade ?? (this.talking ? 1 : npcCameraOpacity(camera, this.position, this.monkey ? .65 : 1.7));
    if (alpha === this.fade) return;
    this.fade = alpha;
    this.model.visible = alpha > 0;
    // Without depth writes a hull's dark back faces would paint over the body.
    this.model.traverse(o => { if (o.userData.outlineHull) o.visible = alpha >= .999; });
    for (const { material, source } of this.fadeMaterials) {
      const coverage=material.userData.characterCoverage===true;
      const want = !coverage&&(source.transparent || alpha < .999);
      if (material.transparent !== want) { material.transparent = want; material.needsUpdate = true; }
      material.opacity = source.opacity * alpha; material.depthWrite = coverage||source.depthWrite && alpha >= .999;
    }
  }
  dispose() {
    this.chair.dispose();
    for (const { material } of this.fadeMaterials) material.dispose();
    this.fadeMaterials = [];
    this.mixer.stopAllAction(); this.mixer.uncacheRoot(this.mixer.getRoot());
    for (const m of this.owned) { (m as T.MeshToonMaterial).map?.dispose(); m.dispose(); }
    this.owned = [];
  }
}

/** Story NPCs (guide, students at their posts, the macaque) plus ambient students strolling the path network. */
export class NpcManager {
  readonly group = new T.Group();
  readonly seats:SeatRegistry;
  private npcs = new Map<string, Npc>();
  private ambient: Npc[] = [];
  private loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  private sources = new Map<string, Promise<{ scene: T.Object3D; animations: T.AnimationClip[] }>>();
  private disposed = false;
  private defs = new Map<string, NpcDef>();
  private placed = new Map<string, string>();
  private gameReserved=new Set<string>();
  reserveForGame(id:string,reserved:boolean) { if(reserved)this.gameReserved.add(id);else{this.gameReserved.delete(id);this.placed.delete(id);} }
  private borrowed = new Map<string,{speed:number;activity:string}>();
  isBorrowed(id:string) { return this.borrowed.has(id); }
  get borrowedMoving() { return [...this.borrowed.keys()].some(id=>!!this.npcs.get(id)?.path.length||!!this.recovery.get(id)?.yield); }
  /** Runtime supplies a validated path starting at the live footpoint. Reject unconnected
   * projected starts instead of snapping to them. No teleport fallback, including off-screen. */
  borrowPath(id:string,path:T.Vector3[]):boolean {
    const npc=this.npcs.get(id);
    if(!npc || npc.absent || npc.talking || this.gameReserved.has(id) || path.length<2 || path[0].distanceTo(npc.position)>1e-6 || path.some(p=>!p.toArray().every(Number.isFinite)))return false;
    if(!this.borrowed.has(id))this.borrowed.set(id,{speed:npc.speed,activity:npc.activity});
    if(npc.seat)this.seats.release(npc.seat.id,id);npc.seat=undefined;this.recovery.delete(id);
    npc.path=path.map(p=>p.clone());npc.speed=npc.monkey?1.6:1.4;npc.activity='Idle';
    this.targets.set(id,path[path.length-1].clone());return true;
  }
  /** Release only after the requested path has finished. Caller then reapplies the current schedule. */
  releaseBorrowed(id:string):boolean {
    const saved=this.borrowed.get(id),npc=this.npcs.get(id);
    if(!saved || !npc || npc.path.length || this.recovery.get(id)?.yield)return false;
    npc.speed=saved.speed;npc.activity=saved.activity;this.borrowed.delete(id);this.placed.delete(id);return true;
  }
  cancelBorrowedMoves() { for(const id of this.borrowed.keys()){const npc=this.npcs.get(id);if(npc)npc.path=[];this.recovery.delete(id);} }
  releaseAllBorrowed() { this.cancelBorrowedMoves();for(const id of [...this.borrowed.keys()])this.releaseBorrowed(id); }
  private sweep?: NpcSweep;
  private support?: SupportAt;
  private actorChanged?:(body:ActorBody)=>void;
  private replan?:(id:string,from:T.Vector3,to:T.Vector3)=>T.Vector3[];
  private reservations=new Map<string,ActorBody>();
  private recovery=new Map<string,{next?:T.Vector3;best:number;stalled:number;cooldown:number;attempts:number;yield?:{back:T.Vector3;side:T.Vector3;goal:T.Vector3;other:string}}>();
  private body(n:Npc):ActorBody{return {id:n.id,position:n.position.clone(),radius:n.monkey?.24:.32,height:n.monkey?.65:1.7};}
  private occupied(player?:T.Vector3):ActorBody[]{return [...this.reservations.values(),...[...this.npcs.values(),...this.ambient].filter(n=>!n.absent).map(n=>this.body(n)),...(player?[{id:'player',position:player,radius:.3,height:1.7}]:[])];}
  private landing(n:Npc,dest:T.Vector3,player?:T.Vector3,from?:T.Vector3){
    return findFreeNpcPlacement(n.id,dest,this.movementGround,this.sweep,this.occupied(player),from,n.monkey?.24:.32,n.monkey?.65:1.7);
  }
  private place(n:Npc,dest:T.Vector3,player?:T.Vector3){
    const free=this.landing(n,dest,player);if(!free||n.seat&&!withinSeatApproach(n.seat,free))return false;
    n.root.position.copy(free);n.path=[];this.recovery.delete(n.id);this.reservations.set(n.id,this.body(n));this.actorChanged?.(this.body(n));return true;
  }
  private recover(n:Npc,dt:number,player:T.Vector3){
    if(n.talking||this.gameReserved.has(n.id))return;
    let r=this.recovery.get(n.id);
    if(!r){r={best:Infinity,stalled:0,cooldown:0,attempts:0};this.recovery.set(n.id,r);}
    r.cooldown=Math.max(0,r.cooldown-dt);
    const radius=n.monkey?.24:.32,height=n.monkey?.65:1.7;
    const clear=(a:T.Vector3,b:T.Vector3)=>{const from=a.clone().add(new T.Vector3(0,height/2+.025,0)),to=b.clone().add(new T.Vector3(0,height/2+.025,0));return !this.sweep||this.sweep(n.id,from,to,radius,height)+1e-4>=from.distanceTo(to);};
    if(r.yield&&!n.path.length){
      const y=r.yield,other=this.npcs.get(y.other);
      if(r.cooldown===0&&r.attempts<3&&(!other||other.position.distanceTo(y.back)>1.1&&clear(n.position,y.back))){
        r.attempts++;r.cooldown=3;
        const path=this.replan?.(n.id,y.back,y.goal)??this.routes?.path(y.back,y.goal)??[y.goal];
        if(!path.length||path.at(-1)!.distanceTo(y.goal)>.4)return;
        n.path=[y.back.clone(),...path.map(p=>p.clone())];r.yield=undefined;r.next=undefined;r.best=Infinity;r.stalled=0;
      }
      return;
    }
    const next=n.path[0];if(!next){this.recovery.delete(n.id);return;}
    if(next!==r.next){r.next=next;r.best=n.position.distanceTo(next);r.stalled=0;}
    const distance=n.position.distanceTo(next);
    if(distance<r.best-.08){r.best=distance;r.stalled=0;r.attempts=0;}else r.stalled+=dt;
    if(r.stalled<1||r.cooldown>0||r.yield)return;
    r.cooldown=r.stalled<2.5?1.5:3;
    const goal=n.path[n.path.length-1];
    if(!n.seat&&!this.borrowed.has(n.id)&&n.position.distanceTo(goal)<1.5){
      const free=this.landing(n,goal,player,n.position);
      if(free){n.path=[free];r.next=undefined;r.best=Infinity;r.stalled=0;return;}
    }
    const other=[...this.npcs.values(),...this.ambient].find(o=>o!==n&&!o.absent&&o.path.length&&!this.recovery.get(o.id)?.yield&&Math.abs(o.position.y-n.position.y)<1&&o.position.distanceTo(n.position)<1.4);
    if(other&&n.id>other.id){
      const away=n.position.clone().sub(other.position).setY(0).normalize(),side=new T.Vector3(-away.z,0,away.x);
      // Retreat along a clear segment until there is space to step aside; never teleport or change the final goal.
      for(let back=.5;back<=6;back+=.5)for(const sign of [1,-1]){
        const a=n.position.clone().addScaledVector(away,back),b=a.clone().addScaledVector(side,.85*sign);
        const ay=this.movementGround(a.x,a.z,n.position.y),by=this.movementGround(b.x,b.z,n.position.y);
        if(ay===undefined||by===undefined||Math.abs(ay-n.position.y)>.4||Math.abs(by-n.position.y)>.4)continue;a.y=ay;b.y=by;
        if(clear(n.position,a)&&clear(a,b)){
          r.yield={back:a,side:b,goal:goal.clone(),other:other.id};n.path=[a,b];r.next=undefined;return;
        }
      }
    }
    if(r.stalled>=2.5&&r.attempts<3){
      r.attempts++;
      const path=this.replan?.(n.id,n.position,goal)??this.routes?.path(n.position,goal);
      if(path?.length&&path[0].distanceTo(n.position)<.4)n.path=path.map(p=>p.clone());
    }
  }
  /** Where each scheduled NPC is heading (for QA and the minimap). */
  readonly targets = new Map<string, T.Vector3>();
  /** Visible-people cap (set from the quality tier). */
  cap = NPC_CAP.A;
  preset: Preset = 'day';

  constructor(private zones: StoryZones, private routes: OutdoorRoutes | undefined, private terrain: Terrain | undefined, private asset: (p: string) => string, private data?: NpcData) {
    for (const d of data?.npcs ?? []) this.defs.set(d.id, d);
    this.group.name = 'NPCs';
    this.seats=new SeatRegistry(zones.seats??{},(x,z,y)=>this.movementGround(x,z,y),(x,z)=>this.terrain?.heightAt(x,z)??-.055);
  }

  private ground = (x: number, z: number, referenceY = this.terrain ? this.terrain.heightAt(x, z) : -.055) => this.support?.(x, z, referenceY) ?? referenceY;
  private movementGround: SupportAt = (x, z, y) => this.support ? this.support(x, z, y) : this.ground(x, z);

  private source(model: string) {
    let s = this.sources.get(model);
    if (!s) {
      s = this.loader.loadAsync(this.asset(`models/characters/${model}.glb`)).then(g => { toonify(g.scene); return { scene: g.scene, animations: g.animations }; });
      this.sources.set(model, s);
    }
    return s;
  }

  /** Reuse each cached GLB promise; sample preparation runs alongside ordinary NPC spawning. */
  prepareWarmupSamples() {
    return prepareCharacterWarmup(this.zones,this.data,async model=>{
      const source=await this.source(model);if(this.disposed)throw new Error('npc manager disposed');return source.scene;
    });
  }

  private async spawn(id: string, model: string, x: number, z: number, look?: Look, referenceY?: number) {
    const src = await this.source(model);
    if (this.disposed) throw new Error('npc manager disposed');
    const copy = cloneSkinned(src.scene);
    const owned: T.Material[] = [];
    if (look) { copy.traverse(o => { if (o instanceof T.Mesh) { o.material = (o.material as T.Material).clone(); owned.push(o.material); } }); recolor(copy, look); }
    addOutlines(copy, 'character');
    const npc = new Npc(id, copy, src.animations);
    npc.owned = owned;npc.monkey=model==='monkey';
    const wanted=new T.Vector3(x,this.ground(x,z,referenceY),z);
    const free=findFreeNpcPlacement(id,wanted,this.movementGround,this.sweep,this.occupied());
    npc.root.position.copy(free??wanted);npc.absent=!free;
    if(free)this.reservations.set(id,{id,position:free.clone(),radius:model==='monkey'?.24:.32,height:model==='monkey'?.65:1.7});
    npc.root.name = `NPC ${id}`;
    this.group.add(npc.root);
    return npc;
  }

  anchorPoint(anchor: string | P2, offset: P2 = [0, 0]) {
    if (Array.isArray(anchor)) { const p = new T.Vector3(anchor[0] + offset[0], 0, anchor[1] + offset[1]); p.y = this.ground(p.x, p.z); return p; }
    const z = this.zones.zones[anchor];
    const p = z ? new T.Vector3(z.p[0], 0, z.p[1]) : this.routes?.anchor(anchor);
    if (!p) return undefined;
    p.x += offset[0]; p.z += offset[1]; p.y = this.ground(p.x, p.z, z?.y);
    return p;
  }

  async load() {
    if (this.disposed) return;
    await Promise.all(Object.entries(this.zones.npcs).map(async ([id, s]) => {
      const p = this.anchorPoint(s.at, s.offset);
      if (!p) return;
      const def = this.defs.get(id);
      const npc = await this.spawn(id, def?.model ?? s.model, p.x, p.z, def?.look, p.y);
      npc.activity = s.activity ?? 'Idle';
      npc.monkey = (def?.model ?? s.model) === 'monkey';
      if (npc.monkey) npc.speed = 1.1;
      this.npcs.set(id, npc);
    }));
    // Campus cast from npcs.json (spec-v4 §7): placed by schedule once the preset is known.
    await Promise.all([...this.defs.values()].filter(d => !this.npcs.has(d.id)).map(async d => {
      const first = d.schedule.day ?? d.schedule.sunset ?? d.schedule.night;
      const p = first ? this.anchorPoint(first.at, first.offset) : undefined;
      if (!p) return;
      const npc = await this.spawn(d.id, d.model, p.x, p.z, d.look, p.y);
      npc.activity = first?.activity ?? 'Idle';
      npc.monkey = d.model === 'monkey';
      if (npc.monkey) npc.speed = 1.1;
      this.npcs.set(d.id, npc);
    }));
    // Ambient students wander between anchors along real paths.
    const anchors = this.routes ? AMBIENT_ANCHORS.filter(a => this.routes!.anchor(a)) : [];
    const students = this.zones.ambient?.students ?? [];
    await Promise.all(students.map(async (model, i) => {
      if (!anchors.length) return;
      const start = this.anchorPoint(anchors[i % anchors.length]) ?? this.routes!.anchor(anchors[i % anchors.length])!;
      const npc = await this.spawn(`amb${i}`, model, start.x + (i - 2) * 2, start.z + 3);
      npc.speed = .9 + (i % 3) * .2;
      this.ambient.push(npc);
    }));
    for (let i = 0; i < (this.zones.ambient?.monkeys ?? 0); i++) {
      const base = this.anchorPoint('library', [12 + i * 5, -10 - i * 4]);
      if (!base) continue;
      const npc = await this.spawn(`mk${i}`, 'monkey', base.x, base.z);
      npc.activity = i % 2 ? 'Sit' : 'Idle';
      this.ambient.push(npc);
    }
  }

  seatPropsReady(ready:boolean){this.seats.enabled=ready;this.placed.clear();const s=this.lastSchedule;if(s)this.schedule(s.preset,s.tourDone,s.storyAt,s.player,s.facts);}
  get(id: string) { return this.npcs.get(id); }
  displayName(id: string) { return this.defs.get(id)?.name; }
  setCollision(sweep: NpcSweep, support?: SupportAt, actorChanged?:(body:ActorBody)=>void, replan?:(id:string,from:T.Vector3,to:T.Vector3)=>T.Vector3[]) { this.sweep = sweep; this.support = support;this.actorChanged=actorChanged;this.replan=replan; }
  /** Culling never leaves invisible solid people. Only local visible actors enter physics. */
  bodies(player: T.Vector3): ActorBody[] {
    return [...this.npcs.values(), ...this.ambient].filter(n => !n.absent && n.root.visible && n.position.distanceToSquared(player) < 50 * 50)
      .map(n => ({ id: n.id, position: n.position.clone(), radius: n.monkey ? .24 : .32, height: n.monkey ? .65 : 1.7 }));
  }
  ids() { return [...this.npcs.keys()]; }
  isAbsent(id: string) { return this.npcs.get(id)?.absent ?? true; }

  /** Re-resolve every NPC's place (on load, preset change and chapter completion; spec §15.1). Walks along
   * the path network when the player can see it, otherwise moves directly. */
  private lastSchedule?: { preset: Preset; tourDone: boolean; storyAt: Record<string, string>; player?: T.Vector3; facts?: Facts };
  schedule(preset: Preset, tourDone: boolean, storyAt: Record<string, string>, player?: T.Vector3, facts?: Facts) {
    this.lastSchedule = { preset, tourDone, storyAt, player, facts };
    this.preset = preset;
    for (const [id, npc] of this.npcs) {
      if (this.borrowed.has(id) || this.gameReserved.has(id) || npc.talking) continue;
      const def = this.defs.get(id);
      if (!def && !STORY_NPCS.includes(id)) continue;
      const place = resolveNpcPlacement(id, def, preset, tourDone, this.zones, storyAt, this.data?.scheduleOverrides, facts);
      const key = place ? JSON.stringify([place,this.seats.enabled]) : 'absent';
      if (this.placed.get(id) === key) continue;
      this.recovery.delete(id);this.placed.set(id, key);
      if (!place) { if(npc.seat)this.seats.release(npc.seat.id,id);npc.seat=undefined;npc.absent = true; npc.path = [];this.reservations.delete(id); continue; }
      npc.activity = place.activity ?? 'Idle';
      const seat=this.seats.enabled&&place.seat?this.seats.get(place.seat):undefined;
      if(npc.seat?.id!==seat?.id){if(npc.seat)this.seats.release(npc.seat.id,id);npc.seat=undefined;}
      if(seat&&!npc.monkey){if(!this.seats.claim(seat.id,id)){this.placed.delete(id);continue;}npc.seat=seat;}
      const dest = npc.seat?seatApproach(npc.seat):this.anchorPoint(place.at, place.offset);
      if (!dest) continue;
      this.targets.set(id, dest.clone());
      // Back on campus after being absent: they simply arrive at their spot (unless the player is watching it).
      const returning = npc.absent;
      npc.absent = false; // before the early out below: someone back at the very spot they left was never marked present again
      if(returning){if(!this.place(npc,dest,player)){npc.absent=true;this.placed.delete(id);}continue;}
      if (Math.hypot(dest.x - npc.position.x, dest.z - npc.position.z) < 2) { if(!this.place(npc,dest,player))this.placed.delete(id); continue; }
      const far = !player || (npc.position.distanceTo(player) > 60 && dest.distanceTo(player) > 60);
      const path = !far && !(returning && dest.distanceTo(player!) > 30) && this.routes ? this.routes.path(npc.position, dest) : [];
      const length = path.reduce((s, q, i) => i ? s + q.distanceTo(path[i - 1]) : 0, 0);
      // Long walks are jogged so a time-of-day change settles within about a minute.
      // Very long trips happen off screen: skip straight to the spot unless the player is near where they go.
      const offscreen = length > 90 && (!player || dest.distanceTo(player) > 40);
      if (path.length && !offscreen) { npc.path = path; npc.speed = npc.monkey ? 1.6 : length > 70 ? 3 : 1.4; } else if(!this.place(npc,dest,player))this.placed.delete(id);
    }
  }

  /** Walk an NPC to an anchor along the path network; teleport if the route is unknown or it is far off-screen. */
  moveTo(id: string, anchor: string, player?: T.Vector3) {
    const npc = this.npcs.get(id), dest = this.anchorPoint(anchor, this.zones.npcs[id]?.offset);
    if (!npc || !dest || npc.talking || this.borrowed.has(id) || this.gameReserved.has(id)) return;
    if(npc.seat)this.seats.release(npc.seat.id,id);npc.seat=undefined;
    this.targets.set(id,dest.clone());this.recovery.delete(id);
    const far = player && npc.position.distanceTo(player) > 60 && dest.distanceTo(player) > 60;
    const path = !far && this.routes ? this.routes.path(npc.position, dest) : [];
    if (path.length) { npc.path = path; npc.speed = 3.2; }
    else if(!this.place(npc,dest,player))this.placed.delete(id);
  }

  /** Lets an ambient walker that reached its goal pick a new one. */
  private wander(npc: Npc) {
    if (npc.path.length || !this.routes || npc.id.startsWith('mk')) return;
    if (Math.random() > .004) return;
    const ids = AMBIENT_ANCHORS;
    const goal = this.routes.anchor(ids[Math.floor(Math.random() * ids.length)]);
    if (goal) npc.path = this.routes.path(npc.position, goal).slice(1, -1);
  }

  /** Camera fading changes only the visual model, never culling, actors or interaction reach. */
  updateCamera(camera: T.Vector3) {
    for (const n of this.npcs.values()) n.updateCamera(camera);
    for (const n of this.ambient) n.updateCamera(camera);
  }

  /** The person the current goal is about: never squeezed out by the visible cap. */
  private focusNpc?: string;
  private eventFocus:readonly string[]=[];
  setFocus(id: string | undefined,events:readonly string[]=[]) { this.focusNpc = id;this.eventFocus=events; }

  setTalking(id: string | undefined) {
    for (const n of this.npcs.values()) n.talking = n.id === id;
    // Re-evaluate deferred choices only after the conversation relinquishes its NPC.
    const s = this.lastSchedule;
    if (s) this.schedule(s.preset, s.tourDone, s.storyAt, s.player, s.facts);
  }

  update(dt: number, player: T.Vector3, borrowedPaused=false) {
    // Visible cap: nearest people first (talking and story NPCs always count), macaques separately.
    const night = this.preset === 'night', people: [number, Npc][] = [], monkeys: [number, Npc][] = [];
    for (const n of [...this.npcs.values(), ...this.ambient]) if (!n.absent) (n.monkey ? monkeys : people).push([n.position.distanceTo(player), n]);
    const keep = new Set<Npc>();
    for (const [list, cap] of [[people, night ? this.cap.night : this.cap.day], [monkeys, this.cap.monkeys]] as const) {
      list.sort((a, b) => a[0] - b[0]);
      for (const n of npcsWithinCap(list.map(([, n]) => n), cap, [...STORY_NPCS,...this.eventFocus,...list.filter(([,n])=>n.root.userData.qaInspected).map(([,n])=>n.id)], this.focusNpc)) keep.add(n);
    }
    for (const n of [...this.npcs.values(), ...this.ambient]) {
      const d = n.position.distanceTo(player);
      // Far characters freeze (no mixer) and very far ones hide (spec §7).
      n.root.visible = !n.absent && d < 120 && (keep.has(n) || this.gameReserved.has(n.id) || this.borrowed.has(n.id) || (this.npcs.has(n.id) && d <= 4));
      // Hidden walkers skip to where they were going, so schedules settle even off screen.
      if(this.gameReserved.has(n.id)){n.animateOnly?.(dt,this.movementGround);this.actorChanged?.(this.body(n));continue;}
      if (this.borrowed.has(n.id) && borrowedPaused) continue;
      if (!n.root.visible && !this.borrowed.has(n.id) && !this.gameReserved.has(n.id)) { if (n.path.length) this.place(n,n.path[n.path.length-1],player); continue; }
      if (d > 60 && !n.path.length) continue;
      if (this.ambient.includes(n)) this.wander(n); // story NPCs only move when the story sends them
      this.recover(n,dt,player);
      const liveSweep:NpcSweep=(id,from,to,radius,height)=>{
        for(const b of this.occupied(player)){
          if(b.id===id||Math.abs(from.y-(b.position.y+b.height/2+.025))>=(height+b.height)/2)continue;
          const dx=to.x-from.x,dz=to.z-from.z,length=dx*dx+dz*dz;
          const t=length?T.MathUtils.clamp(((b.position.x-from.x)*dx+(b.position.z-from.z)*dz)/length,0,1):0;
          const near=Math.hypot(from.x+dx*t-b.position.x,from.z+dz*t-b.position.z),start=Math.hypot(from.x-b.position.x,from.z-b.position.z);
          if(near<radius+b.radius+.01 && (start>=radius+b.radius+.01||Math.hypot(to.x-b.position.x,to.z-b.position.z)<=start))return 0;
        }
        return this.sweep?.(id,from,to,radius,height)??from.distanceTo(to);
      };
      n.update(dt, this.movementGround, player, d < 4, liveSweep);
      this.reservations.delete(n.id);this.actorChanged?.(this.body(n));
    }
  }

  /** All present NPCs in reach, including people sharing the same interaction area. */
  nearby(player: T.Vector3, reach = 3): string[] {
    return [...this.npcs].filter(([,n]) => !n.absent && n.position.distanceTo(player) <= reach)
      .sort(([a,x],[b,y]) => x.position.distanceTo(player)-y.position.distanceTo(player) || a.localeCompare(b)).map(([id]) => id);
  }
  nearest(player: T.Vector3, reach = 3) { return this.nearby(player,reach)[0]; }

  distanceTo(id: string, player: T.Vector3) { const n = this.npcs.get(id); return n ? n.position.distanceTo(player) : Infinity; }

  /** Stops mixers and frees the shared GLB sources (clones share their geometry, materials and textures). */
  dispose() {
    this.disposed = true;
    for (const n of [...this.npcs.values(), ...this.ambient]) n.dispose();
    this.group.removeFromParent(); this.group.clear();
    for (const p of this.sources.values()) void p.then(src => disposeObject(src.scene)).catch(() => {});
    this.sources.clear();
  }
}
