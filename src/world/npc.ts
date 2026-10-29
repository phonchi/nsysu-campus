import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { toonify } from '../render/toon';
import { addOutlines } from '../render/outline';
import type { OutdoorRoutes } from '../walk/route';
import type { Terrain } from './terrain';
import type { NpcData, NpcDef } from '../story/talk';
import { recolor, type Look } from '../walk/player-look';
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

type P2 = [number, number];
export interface ZoneSpec { label: string; sub?: string; p: P2; r: number; y?: number }
export interface NpcSpec { model: string; at: string; offset?: P2; activity?: string }
export interface StoryZones { zones: Record<string, ZoneSpec>; npcs: Record<string, NpcSpec>; ambient?: { students: string[]; monkeys: number } }
export type Preset = 'day' | 'sunset' | 'night';
export type Placement = { at: string | P2; offset?: P2; activity?: string } | null;

/** NPCs whose position the story owns until the tour is complete (spec-v4 §15.1). */
export const STORY_NPCS = ['guide', 's1', 's2', 's3', 'm1'];

/** Where an NPC should be: the story decides for story NPCs until all chapters are done, otherwise the
 * schedule for the current light preset (null = not on campus now). Pure, so it is unit-tested. */
export function resolveNpcPlacement(id: string, def: NpcDef | undefined, preset: Preset, tourDone: boolean, zones: StoryZones, storyAt: Record<string, string>): Placement {
  if (STORY_NPCS.includes(id) && !tourDone) {
    const z = zones.npcs[id];
    return { at: storyAt[id] ?? z?.at ?? def?.schedule.day?.at ?? 'gate', offset: z?.offset, activity: z?.activity };
  }
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
  constructor(readonly id: string, model: T.Object3D, clips: T.AnimationClip[]) {
    model.rotation.y = Math.PI; // glTF characters face +Z; headings below assume -Z
    this.root.add(model);
    this.mixer = new T.AnimationMixer(model);
    for (const c of clips) this.actions.set(c.name, this.mixer.clipAction(c));
    this.play('Idle');
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
    const desired = this.root.position.clone();
    if (this.path.length && !this.talking) {
      const next = this.path[0], d = Math.hypot(next.x - this.root.position.x, next.z - this.root.position.z);
      if (d < .4) this.path.shift();
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
      this.play(this.talking ? 'Talk' : near && this.activity !== 'Sit' ? 'Wave' : this.activity);
    }
    const radius = this.monkey ? .24 : .32, height = this.monkey ? .65 : 1.7;
    this.root.position.copy(moveNpcSafely(this.id, this.root.position, desired, player, dt, radius, height, ground, sweep));
    this.root.rotation.y = this.heading;
    this.mixer.update(dt);
  }
  dispose() {
    this.mixer.stopAllAction(); this.mixer.uncacheRoot(this.mixer.getRoot());
    for (const m of this.owned) { (m as T.MeshToonMaterial).map?.dispose(); m.dispose(); }
    this.owned = [];
  }
}

/** Story NPCs (guide, students at their posts, the macaque) plus ambient students strolling the path network. */
export class NpcManager {
  readonly group = new T.Group();
  private npcs = new Map<string, Npc>();
  private ambient: Npc[] = [];
  private loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  private sources = new Map<string, Promise<{ scene: T.Object3D; animations: T.AnimationClip[] }>>();
  private disposed = false;
  private defs = new Map<string, NpcDef>();
  private placed = new Map<string, string>();
  private sweep?: NpcSweep;
  private support?: SupportAt;
  /** Where each scheduled NPC is heading (for QA and the minimap). */
  readonly targets = new Map<string, T.Vector3>();
  /** Visible-people cap (set from the quality tier). */
  cap = NPC_CAP.A;
  preset: Preset = 'day';

  constructor(private zones: StoryZones, private routes: OutdoorRoutes | undefined, private terrain: Terrain | undefined, private asset: (p: string) => string, private data?: NpcData) {
    for (const d of data?.npcs ?? []) this.defs.set(d.id, d);
    this.group.name = 'NPCs';
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

  private async spawn(id: string, model: string, x: number, z: number, look?: Look, referenceY?: number) {
    const src = await this.source(model);
    if (this.disposed) throw new Error('npc manager disposed');
    const copy = cloneSkinned(src.scene);
    const owned: T.Material[] = [];
    if (look) { copy.traverse(o => { if (o instanceof T.Mesh) { o.material = (o.material as T.Material).clone(); owned.push(o.material); } }); recolor(copy, look); }
    addOutlines(copy, 'character');
    const npc = new Npc(id, copy, src.animations);
    npc.owned = owned;
    npc.root.position.set(x, this.ground(x, z, referenceY), z);
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
    const anchors = this.routes ? ['arcade', 'admin', 'library', 'ACTIVITY', 'YH', 'SPORT', 'IL', 'CMSS'].filter(a => this.routes!.anchor(a)) : [];
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

  get(id: string) { return this.npcs.get(id); }
  setCollision(sweep: NpcSweep, support?: SupportAt) { this.sweep = sweep; this.support = support; }
  /** Culling never leaves invisible solid people. Only local visible actors enter physics. */
  bodies(player: T.Vector3): ActorBody[] {
    return [...this.npcs.values(), ...this.ambient].filter(n => !n.absent && n.root.visible && n.position.distanceToSquared(player) < 50 * 50)
      .map(n => ({ id: n.id, position: n.position.clone(), radius: n.monkey ? .24 : .32, height: n.monkey ? .65 : 1.7 }));
  }
  ids() { return [...this.npcs.keys()]; }
  isAbsent(id: string) { return this.npcs.get(id)?.absent ?? true; }

  /** Re-resolve every NPC's place (on load, preset change and chapter completion; spec §15.1). Walks along
   * the path network when the player can see it, otherwise moves directly. */
  schedule(preset: Preset, tourDone: boolean, storyAt: Record<string, string>, player?: T.Vector3) {
    this.preset = preset;
    for (const [id, npc] of this.npcs) {
      const def = this.defs.get(id);
      if (!def && !STORY_NPCS.includes(id)) continue;
      const place = resolveNpcPlacement(id, def, preset, tourDone, this.zones, storyAt);
      const key = place ? JSON.stringify(place) : 'absent';
      if (this.placed.get(id) === key) continue;
      this.placed.set(id, key);
      if (!place) { npc.absent = true; npc.path = []; continue; }
      npc.activity = place.activity ?? 'Idle';
      const dest = this.anchorPoint(place.at, place.offset);
      if (!dest) continue;
      this.targets.set(id, dest.clone());
      if (Math.hypot(dest.x - npc.position.x, dest.z - npc.position.z) < 2) { npc.path = []; npc.root.position.copy(dest); continue; }
      // Back on campus after being absent: they simply arrive at their spot (unless the player is watching it).
      const returning = npc.absent, far = !player || (npc.position.distanceTo(player) > 60 && dest.distanceTo(player) > 60);
      npc.absent = false;
      const path = !far && !(returning && dest.distanceTo(player!) > 30) && this.routes ? this.routes.path(npc.position, dest) : [];
      const length = path.reduce((s, q, i) => i ? s + q.distanceTo(path[i - 1]) : 0, 0);
      // Long walks are jogged so a time-of-day change settles within about a minute.
      // Very long trips happen off screen: skip straight to the spot unless the player is near where they go.
      const offscreen = length > 90 && (!player || dest.distanceTo(player) > 40);
      if (path.length && !offscreen) { npc.path = path; npc.speed = npc.monkey ? 1.6 : length > 70 ? 3 : 1.4; } else { npc.path = []; npc.root.position.copy(dest); }
    }
  }

  /** Walk an NPC to an anchor along the path network; teleport if the route is unknown or it is far off-screen. */
  moveTo(id: string, anchor: string, player?: T.Vector3) {
    const npc = this.npcs.get(id), dest = this.anchorPoint(anchor, this.zones.npcs[id]?.offset);
    if (!npc || !dest) return;
    const far = player && npc.position.distanceTo(player) > 60 && dest.distanceTo(player) > 60;
    const path = !far && this.routes ? this.routes.path(npc.position, dest) : [];
    if (path.length) { npc.path = path; npc.speed = 3.2; }
    else { npc.path = []; npc.root.position.copy(dest); }
  }

  /** Lets an ambient walker that reached its goal pick a new one. */
  private wander(npc: Npc) {
    if (npc.path.length || !this.routes || npc.id.startsWith('mk')) return;
    if (Math.random() > .004) return;
    const ids = ['arcade', 'admin', 'library', 'ACTIVITY', 'YH', 'SPORT', 'IL', 'CMSS'];
    const goal = this.routes.anchor(ids[Math.floor(Math.random() * ids.length)]);
    if (goal) npc.path = this.routes.path(npc.position, goal).slice(1, -1);
  }

  setTalking(id: string | undefined) { for (const n of this.npcs.values()) n.talking = n.id === id; }

  update(dt: number, player: T.Vector3) {
    // Visible cap: nearest people first (talking and story NPCs always count), macaques separately.
    const night = this.preset === 'night', people: [number, Npc][] = [], monkeys: [number, Npc][] = [];
    for (const n of [...this.npcs.values(), ...this.ambient]) if (!n.absent) (n.monkey ? monkeys : people).push([n.position.distanceTo(player), n]);
    const keep = new Set<Npc>();
    for (const [list, cap] of [[people, night ? this.cap.night : this.cap.day], [monkeys, this.cap.monkeys]] as const) {
      list.sort((a, b) => a[0] - b[0]);
      // Story NPCs and the one talking always count first; the rest fill the budget nearest first.
      let used = 0;
      for (const [, n] of list) if (n.talking || STORY_NPCS.includes(n.id)) { keep.add(n); used++; }
      for (const [, n] of list) if (!keep.has(n) && used < cap) { keep.add(n); used++; }
    }
    for (const n of [...this.npcs.values(), ...this.ambient]) {
      const d = n.position.distanceTo(player);
      // Far characters freeze (no mixer) and very far ones hide (spec §7).
      n.root.visible = d < 120 && keep.has(n);
      // Hidden walkers skip to where they were going, so schedules settle even off screen.
      if (!n.root.visible) { if (n.path.length) { n.root.position.copy(n.path[n.path.length - 1]); n.root.position.y = this.ground(n.root.position.x, n.root.position.z, n.root.position.y); n.path = []; } continue; }
      if (d > 60 && !n.path.length) continue;
      if (this.ambient.includes(n)) this.wander(n); // story NPCs only move when the story sends them
      n.update(dt, this.movementGround, player, d < 4, this.sweep);
    }
  }

  /** Nearest visible NPC within reach (for E). */
  nearest(player: T.Vector3, reach = 3) {
    let best: string | undefined, d = reach;
    for (const [id, n] of this.npcs) { if (n.absent || !n.root.visible) continue; const dd = n.position.distanceTo(player); if (dd < d) { d = dd; best = id; } }
    return best;
  }

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
