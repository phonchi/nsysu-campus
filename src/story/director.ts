import * as T from 'three';
import { StoryEngine, loadProgress, type StoryWorld } from './engine';
import { validateStory, type Chapter, type StoryData } from './schema';
import { StoryUi } from './ui';
import type { NpcManager, StoryZones } from '../world/npc';
import type { OutdoorRoutes } from '../walk/route';
import type { WalkDestination } from '../walk-types';
import { surfaceRouteSegments, type RouteSurfaceQuery } from '../walk/surface-route';

export interface DirectorDeps {
  host: HTMLElement;
  scene: T.Scene;
  camera: T.PerspectiveCamera;
  player: () => T.Vector3;
  destinations: WalkDestination[];
  navPath: (from: T.Vector3, to: T.Vector3) => T.Vector3[];
  routeSurface: RouteSurfaceQuery;
  routes?: OutdoorRoutes;
  npcs: NpcManager;
  zones: StoryZones;
  timeOfDay: () => string;
  setSky: (preset: string) => void;
  cue: (id: string) => void;
  say: (text: string, ms?: number) => void;
  teleport: (p: T.Vector3, faceToward?: T.Vector3) => boolean | void;
}

const flat = (a: T.Vector3, b: T.Vector3) => Math.hypot(a.x - b.x, a.z - b.z);

/** Binds the chapter engine to the 3D world: zones, NPCs, guidance arrow and route, banners, E priority. */
export class StoryDirector {
  readonly ui: StoryUi;
  readonly engine: StoryEngine;
  private arrowTarget: string | null = null;
  private route: T.Vector3[] = [];
  private routeAt = 0;
  private routeLine = new T.Group();
  private beacon: T.Mesh;
  private marker: T.Mesh;
  private pointer: T.Mesh;
  private zone?: string;
  private cardOpen = false;
  private tmp = new T.Vector3();

  constructor(private d: DirectorDeps, data: StoryData) {
    const errors = validateStory(data);
    if (errors.length) throw new Error('故事資料錯誤：' + errors.join('; '));
    this.ui = new StoryUi(d.host, data.chapters, data.guide.name);
    const world: StoryWorld = {
      distanceTo: t => this.distanceTo(t),
      inZone: z => this.inZone(z),
      atDestination: code => { const dst = d.destinations.find(x => x.label === code); if (!dst) return false; const p = d.player(); return Math.hypot(dst.position[0] - p.x, dst.position[2] - p.z) < 1.4 && Math.abs(dst.position[1] - p.y) < .8; },
      timeOfDay: () => d.timeOfDay(),
    };
    this.engine = new StoryEngine(data, world, {
      dialogue: (lines, done) => {
        const speaker = lines.find(l => l.who !== 'player')?.who;
        d.npcs.setTalking(speaker); d.cue('page');
        this.ui.dialogue(lines, () => { d.npcs.setTalking(undefined); done(); });
      },
      setObjective: (ch, text) => this.ui.objective(ch, text),
      showArrow: t => { this.arrowTarget = t; this.routeAt = 0; },
      setSky: s => d.setSky(s),
      playSound: s => d.cue(s),
      moveNpc: (n, a) => d.npcs.moveTo(n, a, d.player()),
      chapterStart: ch => { this.ui.dots(ch.id, this.engine?.progress.done ?? []); this.ui.banner(ch.title, `第 ${data.chapters.indexOf(ch) + 1} 章`); },
      chapterComplete: (ch, fact, next) => this.complete(ch, fact, next),
      unlockSideQuest: id => { const q = data.sideQuests.find(x => x.id === id); if (q) d.say(`解鎖支線「${q.title}」：${q.hint}`, 6000); },
    }, loadProgress());
    this.routeLine.name = 'Story route';
    d.scene.add(this.routeLine);
    // Gold light pillar over a near target; flat arrow over the player's head pointing along the route.
    this.beacon = new T.Mesh(new T.CylinderGeometry(.6, .6, 7, 16, 1, true), new T.MeshBasicMaterial({ color: '#e9b949', transparent: true, opacity: .35, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide }));
    this.beacon.visible = false; d.scene.add(this.beacon);
    this.marker = new T.Mesh(new T.OctahedronGeometry(.22), new T.MeshBasicMaterial({ color: '#e9b949' }));
    this.marker.scale.y = 1.5; this.marker.visible = false; d.scene.add(this.marker);
    const shape = new T.Shape([new T.Vector2(0, .55), new T.Vector2(.38, 0), new T.Vector2(.14, 0), new T.Vector2(.14, -.4), new T.Vector2(-.14, -.4), new T.Vector2(-.14, 0), new T.Vector2(-.38, 0)]);
    const g = new T.ExtrudeGeometry(shape, { depth: .06, bevelEnabled: false }); g.rotateX(-Math.PI / 2 + .75); // tilted up toward the camera
    this.pointer = new T.Mesh(g, new T.MeshBasicMaterial({ color: '#e9b949', side: T.DoubleSide, depthTest: false }));
    this.pointer.renderOrder = 10; this.pointer.visible = false; d.scene.add(this.pointer);
  }

  /** Start or resume the tour; with `place`, put the player where the tour is (gate, or the current goal). */
  start(place: boolean) {
    const p = this.engine.progress;
    if (p.active) this.engine.resume(); else this.engine.update();
    this.ui.dots(p.active, p.done);
    if (!place) return;
    // No chapter finished yet: start at the school gate beside 阿灣. A tour under way resumes a few metres short
    // of the current goal, so nobody walks back across campus to pick up where they left off.
    if (!p.done.length) {
      const gate = this.zonePoint('gate'), guide = this.d.npcs.get('guide');
      if (gate) this.d.teleport(gate.clone().add(new T.Vector3(-6, 0, -6)), guide?.position);
    } else {
      if (!this.goal()) this.engine.update(); // a save without the chapter's arrow step yet: set the goal first
      if (this.goal()) { this.ride(); this.d.say(`回到導覽進度：第 ${p.done.length + 1} 章`, 3500); }
    }
  }

  /** Zone centre on the ground (terrain height), so navmesh queries find it on slopes such as the tunnel apron. */
  private zonePoint(id: string) {
    const z = this.d.zones.zones[id];
    return z ? this.d.npcs.anchorPoint(id) : this.d.routes?.anchor(id);
  }

  private distanceTo(target: string) {
    const [kind, id] = target.split(':');
    const p = this.d.player();
    if (kind === 'npc') return this.d.npcs.distanceTo(id, p);
    const z = this.zonePoint(id);
    return z ? flat(z, p) : Infinity;
  }

  private inZone(id: string) {
    const z = this.d.zones.zones[id];
    return !!z && Math.hypot(z.p[0] - this.d.player().x, z.p[1] - this.d.player().z) < z.r;
  }

  private targetPoint(t: string): T.Vector3 | undefined {
    const [kind, id] = t.split(':');
    // A walking NPC is a moving target: head for where they are going, not where they happen to be.
    if (kind === 'npc') { const n = this.d.npcs.get(id); return n ? (n.path.at(-1) ?? n.position).clone() : undefined; }
    if (kind === 'dest') { const dst = this.d.destinations.find(x => x.label === id); return dst ? new T.Vector3(...dst.position) : undefined; }
    return this.zonePoint(id);
  }

  /** The arrow's real goal: once a chapter's zone is reached, an indoor destination step takes over. */
  private effectiveTarget(): string | null {
    const ch = this.engine.active;
    if (!this.arrowTarget || !ch) return this.arrowTarget;
    const fired = this.engine.progress.fired[ch.id] ?? [];
    for (const s of ch.steps) {
      if (fired.includes(s.id)) continue;
      const dest = s.when.find(c => 'atDestination' in c) as { atDestination: string } | undefined;
      const ready = s.when.every(c => !('flag' in c) || this.engine.progress.flags.includes(c.flag));
      if (dest && ready) return `dest:${dest.atDestination}`;
    }
    return this.arrowTarget;
  }

  private complete(ch: Chapter, fact: string | undefined, next: Chapter | undefined) {
    this.d.cue('fanfare');
    this.cardOpen = true;
    void this.ui.chapterCard(ch, fact, !!next, ch.sources[ch.sources.length - 1]).then(how => {
      this.cardOpen = false;
      this.ui.dots(undefined, this.engine.progress.done);
      if (!next) { this.ui.objective(ch, '導覽完成！自由探索校園吧'); this.d.say('新生導覽完成。地圖首頁會記住你的進度。', 6000); }
      this.engine.update();
      if (how === 'bus') this.ride();
    });
  }

  /** Campus shuttle: drop the player a few metres short of the next chapter's goal, facing it. */
  private ride() {
    const g = this.goal(); if (!g) return;
    const p = this.d.player(), dx = p.x - g.x, dz = p.z - g.z, L = Math.hypot(dx, dz) || 1;
    const stop = new T.Vector3(g.x + dx / L * 6, g.y, g.z + dz / L * 6);
    if (this.d.teleport(stop, g) === false) return;
    this.d.cue('chime');
    this.d.say('搭校園公車抵達下一站。', 3500);
  }

  /** E / Space handling; returns true when the story consumed the key. */
  press() {
    if (this.ui.dialogueOpen) return this.ui.next();
    if (this.cardOpen) return true;
    return this.engine.press();
  }

  /** Current guidance goal in world space (for auto-walking the quest), if any. */
  goal() { const t = this.effectiveTarget(); return t ? this.targetPoint(t) : undefined; }
  get objectiveText() { return this.ui.objectiveText; }

  /** Label of the named place the player stands in, if any. */
  get zoneLabel() { return this.zone ? this.d.zones.zones[this.zone].label : undefined; }

  get canInteract() { return this.blocking || this.engine.canPress(); }

  get blocking() { return this.ui.dialogueOpen || this.cardOpen; }

  private drawRoute(path: T.Vector3[]) {
    this.routeLine.traverse(o => { if (o instanceof T.Mesh || o instanceof T.Line) { o.geometry.dispose(); (o.material as T.Material).dispose(); } });
    this.routeLine.clear();
    if (path.length < 2) return;
    for (const points of surfaceRouteSegments(path, this.d.routeSurface)) {
      this.routeLine.add(new T.Line(new T.BufferGeometry().setFromPoints(points), new T.LineBasicMaterial({ color: '#e9b949', transparent: true, opacity: .85, depthTest: true, depthWrite: false })));
    }
  }

  update(time: number, dt: number) {
    if (!this.blocking) this.engine.update();
    // Zone banners on entry.
    let inside: string | undefined;
    for (const [id, z] of Object.entries(this.d.zones.zones)) if (id !== 'tunnel-inside' && this.inZone(id)) { inside = id; break; }
    if (inside && inside !== this.zone) { const z = this.d.zones.zones[inside]; this.ui.banner(z.label, z.sub); this.d.cue('chime'); }
    this.zone = inside;
    // Guidance.
    const target = this.effectiveTarget(), goal = target ? this.targetPoint(target) : undefined, p = this.d.player();
    if (!goal) { this.pointer.visible = this.beacon.visible = this.marker.visible = false; this.ui.edge(null); this.ui.pointer(null); this.ui.distance(undefined); if (this.route.length) { this.route = []; this.drawRoute([]); } return; }
    if (time - this.routeAt > 1200) {
      this.routeAt = time;
      const path = this.d.navPath(p, goal);
      this.route = path; this.drawRoute(path);
    }
    const dist = flat(goal, p);
    this.ui.distance(dist);
    // Beacon at the goal when close; pointer over the head aims at the next route corner.
    // Pillar marks places; a person gets a small diamond over the head instead (the pillar would hide them).
    const person = target!.startsWith('npc:');
    this.beacon.visible = !person && dist < 40;
    this.beacon.position.set(goal.x, goal.y + 3.5, goal.z);
    this.marker.visible = person && dist < 60;
    this.marker.position.set(goal.x, goal.y + 2.35 + Math.sin(time * .005) * .08, goal.z); this.marker.rotation.y = time * .002;
    (this.beacon.material as T.MeshBasicMaterial).opacity = .25 + .1 * Math.sin(time * .004);
    let next = goal;
    for (const q of this.route) if (flat(q, p) > 3) { next = q; break; }
    // Screen-space pointer over the head, aimed at the next route corner as seen on screen (never edge-on).
    this.pointer.visible = false;
    const head = this.tmp.set(p.x, p.y + 2.3, p.z).project(this.d.camera), hx = head.x, hy = head.y, hz = head.z;
    const ahead = this.tmp.set(next.x, p.y + 2.3, next.z).project(this.d.camera);
    let ang = Math.atan2(-(ahead.y - hy), ahead.x - hx);
    if (ahead.z > 1) ang += Math.PI; // behind the camera
    this.ui.pointer(dist > 4 && hz < 1 ? { x: (hx + 1) / 2 * innerWidth, y: (1 - hy) / 2 * innerHeight - Math.sin(time * .004) * 3, angle: ang } : null);
    // Screen-edge indicator when the goal is off screen.
    this.tmp.copy(goal).project(this.d.camera);
    const off = Math.abs(this.tmp.x) > .95 || Math.abs(this.tmp.y) > .95 || this.tmp.z > 1;
    this.ui.edge(off ? Math.atan2(-this.tmp.y * (this.tmp.z > 1 ? -1 : 1), this.tmp.x * (this.tmp.z > 1 ? -1 : 1)) : null);
    void dt;
  }

  dispose() {
    this.ui.dispose(); this.drawRoute([]);
    for (const m of [this.beacon, this.pointer, this.marker]) { m.geometry.dispose(); (m.material as T.Material).dispose(); m.removeFromParent(); }
    this.routeLine.removeFromParent();
  }
  get routeDiagnostics() {
    return this.routeLine.children.filter((o): o is T.Line => o instanceof T.Line).map(line => {
      const p = line.geometry.attributes.position;
      return Array.from({ length: p.count }, (_, i) => [p.getX(i), p.getY(i), p.getZ(i)]);
    });
  }
}
