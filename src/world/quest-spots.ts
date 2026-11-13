import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { toonMaterial } from '../render/toon';
import type { ActorBody } from '../walk/obstacles';

/** Things a side-quest step asks the player to look at. Each exists only while its step is the current one, so an idle
 * campus pays nothing and a step costs one draw call (plus its shadow). Low-poly and built here, reusing the street-prop
 * GLBs where the kind already exists. `stand` is where a walk stops, in front of the object, so that a solid object never
 * sits on the end of a route; +Z of an object faces `stand`. */
export type SpotKind = 'notice' | 'sign' | 'planters' | 'stall' | 'shade' | 'reading' | 'bookmark' | 'drink' | 'leaflets' | 'marks' | 'checkin' | 'viewpoint' | 'ledger' | 'dropbox' | 'board';
export interface QuestSpot { kind: SpotKind; label: string; at: number[]; stand: number[]; /** About where the floor is, where the terrain above is not it: indoors, or in the tunnel under the hill. */ y?: number; /** What a viewpoint looks at. */ face?: number[] }

interface Part { box?: [number, number, number]; cyl?: [number, number, number, number]; ring?: [number, number]; at: [number, number, number]; color: string; ry?: number; rx?: number }
interface PropPart { kind: string; at: [number, number]; ry?: number; s?: number }
interface Recipe { props?: PropPart[]; parts: Part[]; /** Local footprints that stop the player; loose small things have none. */ solid?: [number, number, number][] }

const PAPER = '#f4efe2', WOOD = '#a97c50', DARK = '#3d3a46', GOLD = '#e9b949', SEA = '#2c7f91', BRICK = '#c75f4a';
const table = (h: number, w: number, d: number): Part[] => [{ box: [w, .06, d], at: [0, h, 0], color: WOOD }, ...[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([x, z]): Part => ({ box: [.06, h, .06], at: [x * (w / 2 - .06), h / 2, z * (d / 2 - .06)], color: DARK }))];
const cone = (x: number, z: number): Part[] => [{ box: [.4, .04, .4], at: [x, .02, z], color: DARK }, { cyl: [.03, .17, .62, 8], at: [x, .33, z], color: '#e8743b' }, { cyl: [.09, .125, .12, 8], at: [x, .36, z], color: PAPER }];

export const SPOT_RECIPES: Record<SpotKind, Recipe> = {
  notice: { props: [{ kind: 'notice_board', at: [0, 0] }], solid: [[0, 0, .75]], parts: [{ box: [.42, .56, .012], at: [-.3, 1.2, .1], color: PAPER }, { box: [.42, .3, .012], at: [.3, 1.34, .1], color: GOLD }, { box: [.36, .22, .012], at: [.3, 1.03, .1], color: PAPER }] },
  sign: { props: [{ kind: 'a_board', at: [0, 0] }], solid: [[0, 0, .4]], parts: [{ box: [.46, .14, .03], at: [0, .86, .17], color: SEA }, { box: [.3, .1, .03], at: [0, .62, .2], color: GOLD }] },
  planters: { props: [{ kind: 'planter', at: [-1.35, 0], s: .72 }, { kind: 'planter', at: [1.35, 0], s: .72 }], solid: [[-1.35, 0, .8], [1.35, 0, .8]], parts: [{ box: [1.1, .02, .1], at: [0, .01, 0], color: GOLD }] },
  stall: { props: [{ kind: 'stall', at: [0, 0] }], solid: [[-.5, 0, .5], [.5, 0, .5]], parts: [{ box: [.4, .1, .3], at: [-.45, .83, 0], color: SEA }, { box: [.36, .02, .26], at: [.3, .79, .05], color: PAPER }, { box: [.3, .02, .22], at: [.33, .81, 0], color: GOLD }] },
  shade: { props: [{ kind: 'umbrella_set', at: [0, 0] }], solid: [[-.9, -.2, .55], [.9, -.2, .55]], parts: [{ cyl: [.04, .05, 2.5, 8], at: [0, 1.25, 0], color: DARK }, { cyl: [.06, 1.55, .55, 10], at: [0, 2.45, 0], color: BRICK }] },
  reading: { solid: [[0, 0, .6]], parts: [...table(.5, 1.2, .7), { box: [.3, .05, .22], at: [-.3, .56, 0], color: SEA }, { box: [.28, .05, .2], at: [-.3, .61, .01], color: BRICK }, { box: [.26, .05, .2], at: [-.3, .66, -.01], color: GOLD }, { box: [.42, .02, .3], at: [.26, .54, .05], color: PAPER }] },
  bookmark: { solid: [[0, 0, .35]], parts: [...table(.72, .6, .5), { box: [.34, .05, .26], at: [0, .78, 0], color: BRICK }, { box: [.05, .3, .01], at: [.06, .94, .02], color: '#2f6fd0' }] },
  drink: { solid: [[0, 0, .4]], parts: [...table(.8, .7, .55), { box: [.3, .03, .22], at: [0, .85, 0], color: PAPER }, { cyl: [.06, .045, .15, 10], at: [0, .94, 0], color: PAPER }, { cyl: [.066, .066, .02, 10], at: [0, 1.02, 0], color: DARK }] },
  leaflets: { parts: [{ box: [.6, .28, .46], at: [0, .14, 0], color: WOOD }, { box: [.46, .1, .34], at: [0, .33, 0], color: PAPER }, { box: [.44, .05, .32], at: [.02, .4, .01], color: GOLD, ry: .15 }, { box: [.3, .012, .22], at: [.6, .01, .34], color: PAPER, ry: .5 }, { box: [.3, .012, .22], at: [-.56, .01, .38], color: GOLD, ry: -.7 }, { box: [.3, .012, .22], at: [.05, .01, .72], color: PAPER, ry: 1.1 }] },
  marks: { parts: [...cone(-1.1, -.5), ...cone(1.1, -.5), ...cone(-1.1, .7), ...cone(1.1, .7), { box: [2.2, .012, .1], at: [0, .01, -.5], color: GOLD }, { box: [2.2, .012, .1], at: [0, .01, .7], color: GOLD }] },
  checkin: { solid: [[-.6, 0, .4], [.6, 0, .4]], parts: [...table(.75, 1.7, .6), { box: [.5, .04, .34], at: [-.4, .8, 0], color: PAPER }, { box: [.5, .02, .34], at: [.3, .79, 0], color: GOLD }, { box: [.06, 1.5, .06], at: [.92, .75, -.24], color: DARK }, { box: [.7, .46, .04], at: [.92, 1.5, -.22], color: SEA }] },
  viewpoint: { parts: [{ ring: [.5, .68], at: [0, .03, 0], color: GOLD, rx: -Math.PI / 2 }, { box: [.05, 1.25, .05], at: [0, .62, -.1], color: DARK, rx: -.12 }, { box: [.05, 1.25, .05], at: [-.1, .62, .08], color: DARK, ry: .4 }, { box: [.05, 1.25, .05], at: [.1, .62, .08], color: DARK, ry: -.4 }, { box: [.3, .2, .16], at: [0, 1.32, 0], color: DARK }, { cyl: [.07, .07, .12, 10], at: [0, 1.32, .12], color: SEA, rx: Math.PI / 2 }] },
  // v10 (spec §3): a lost-property ledger on a lectern beside the guardhouse; an open book, a pen and a small bell.
  ledger: { solid: [[0, 0, .35]], parts: [{ box: [.5, .04, .4], at: [0, .02, 0], color: DARK }, { box: [.08, 1, .08], at: [0, .52, 0], color: WOOD }, { box: [.56, .04, .42], at: [0, 1.04, .02], color: WOOD, rx: -.25 }, { box: [.24, .02, .34], at: [-.13, 1.08, .02], color: PAPER, rx: -.25 }, { box: [.24, .02, .34], at: [.13, 1.08, .02], color: PAPER, rx: -.25 }, { cyl: [.012, .012, .16, 6], at: [.08, 1.11, -.04], color: SEA, rx: -.25 }, { cyl: [.05, .04, .06, 10], at: [-.2, 1.1, -.14], color: GOLD }] },
  // A post box for orientation forms at the tunnel mouth: a slot, a sign on top and a folder on the shelf beside it.
  dropbox: { solid: [[0, 0, .35]], parts: [{ box: [.5, .04, .4], at: [0, .02, 0], color: DARK }, { box: [.1, .9, .1], at: [0, .47, 0], color: DARK }, { box: [.46, .5, .3], at: [0, 1.15, 0], color: SEA }, { box: [.3, .03, .04], at: [0, 1.32, .16], color: DARK }, { box: [.4, .14, .02], at: [0, 1.48, .14], color: GOLD }, { box: [.34, .02, .26], at: [.42, .76, 0], color: WOOD }, { box: [.05, .4, .05], at: [.42, .55, 0], color: DARK }, { box: [.26, .04, .2], at: [.42, .8, 0], color: PAPER }] },
  // A corridor feedback board: a slim board on two legs with a row of sticky notes; narrow enough for an indoor corridor.
  board: { solid: [[0, 0, .35]], parts: [{ box: [.05, 1.6, .05], at: [-.6, .8, -.04], color: DARK }, { box: [.05, 1.6, .05], at: [.6, .8, -.04], color: DARK }, { box: [1.3, 1, .03], at: [0, 1.25, 0], color: PAPER }, { box: [1.3, .12, .035], at: [0, 1.8, 0], color: SEA }, ...[-.45, -.15, .15, .45].map((x, i): Part => ({ box: [.2, .2, .012], at: [x, 1.45 - (i % 2) * .05, .02], color: i % 2 ? GOLD : BRICK, ry: 0 })), ...[-.3, 0, .3].map((x): Part => ({ box: [.2, .2, .012], at: [x, 1.05, .02], color: PAPER, rx: 0 })), { box: [.18, .18, .012], at: [.42, 1.02, .02], color: SEA }] },
};

/** Spots the current steps need: each appears for its step and goes with it. Pure, so the lifecycle runs in node tests. */
export const activeSpotIds = (quests: readonly { step?: { target: string } }[]) => [...new Set(quests.flatMap(v => v.step?.target.startsWith('spot:') ? [v.step.target.slice(5)] : []))];

const flatYaw = (from: readonly number[], to: readonly number[]) => Math.atan2(to[0] - from[0], to[1] - from[1]);
const local = (p: readonly number[], ry: number, x: number, z: number) => [p[0] + x * Math.cos(ry) + z * Math.sin(ry), p[1] - x * Math.sin(ry) + z * Math.cos(ry)];

function partGeometry(p: Part) {
  const g = p.box ? new T.BoxGeometry(...p.box) : p.cyl ? new T.CylinderGeometry(p.cyl[0], p.cyl[1], p.cyl[2], p.cyl[3]) : new T.RingGeometry(p.ring![0], p.ring![1], 18);
  if (p.rx) g.rotateX(p.rx);
  if (p.ry) g.rotateY(p.ry);
  g.translate(...p.at);
  return colored(g.index ? g.toNonIndexed() : g, new T.Color(p.color));
}
function colored(g: T.BufferGeometry, color: T.Color) {
  const n = g.attributes.position.count, data = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) data.set([color.r, color.g, color.b], i * 3);
  g.setAttribute('color', new T.BufferAttribute(data, 3));
  return plain(g);
}
/** The attributes every part shares, as floats, so any two merge. */
function plain(g: T.BufferGeometry) {
  const out = new T.BufferGeometry();
  for (const name of ['position', 'normal', 'color']) {
    const a = g.attributes[name], data = new Float32Array(a.count * 3);
    for (let i = 0; i < a.count; i++) data.set([a.getX(i), a.getY(i), a.getZ(i)], i * 3);
    out.setAttribute(name, new T.BufferAttribute(data, 3));
  }
  g.dispose();
  return out;
}

/** One merged geometry for a spot, its origin on the floor. A prop whose GLB failed stands in as a plain block, so the step still shows something. */
export function spotGeometry(kind: SpotKind, prop: (kind: string) => T.BufferGeometry | undefined) {
  const recipe = SPOT_RECIPES[kind], list = recipe.parts.map(partGeometry);
  for (const p of recipe.props ?? []) {
    const source = prop(p.kind);
    const g = source ? plain(source.clone()) : partGeometry({ box: [.9, 1.1, .5], at: [0, .55, 0], color: WOOD });
    if (p.s) g.scale(p.s, p.s, p.s);
    if (p.ry) g.rotateY(p.ry);
    g.translate(p.at[0], 0, p.at[1]);
    list.push(g);
  }
  const merged = mergeGeometries(list, false);
  for (const g of list) g.dispose();
  if (!merged) throw new Error(`quest spot ${kind}: parts do not merge`);
  merged.computeBoundingSphere();
  return merged;
}

export interface QuestSpotDeps {
  spots: Record<string, QuestSpot>;
  /** Floor under a point. */
  support(x: number, z: number, referenceY: number): number | undefined;
  terrain(x: number, z: number): number;
  /** Street-prop geometry by kind; undefined when its GLB is missing. */
  loadProp(kind: string): Promise<T.BufferGeometry | undefined>;
  alive(): boolean;
}

export class QuestSpotField {
  readonly group = new T.Group();
  private meshes = new Map<string, T.Mesh>();
  private wanted = new Set<string>();
  private floors = new Map<string, number>();
  private material?: T.Material;
  private cached = new Map<string, Promise<T.BufferGeometry | undefined>>();
  constructor(private d: QuestSpotDeps, private makeMaterial: () => T.Material = () => toonMaterial({ vertexColors: true, name: 'quest-spots' })) { this.group.name = 'Quest spots'; }

  has(id: string) { return !!this.d.spots[id]; }
  label(id: string) { return this.d.spots[id]?.label; }
  /** Ids on show right now (objects still loading their GLB are not on show yet). */
  get shown() { return [...this.meshes.keys()]; }
  mesh(id: string) { return this.meshes.get(id); }

  /** The object and the stand point each have their own floor: a route compares heights, and a slope is enough to miss. */
  private floor(id: string, x: number, z: number) {
    const key = `${id}:${x},${z}`, known = this.floors.get(key);
    if (known !== undefined) return known;
    const set = this.d.spots[id].y, ref = set ?? this.d.terrain(x, z) + 1;
    const y = this.d.support(x, z, ref) ?? set ?? this.d.terrain(x, z);
    this.floors.set(key, y);
    return y;
  }
  /** The object itself: what the marker, the distance and the camera aim at. */
  point(id: string) { const s = this.d.spots[id]; return s ? new T.Vector3(s.at[0], this.floor(id, s.at[0], s.at[1]), s.at[1]) : undefined; }
  /** Where a walk ends, in front of the object. */
  stand(id: string) { const s = this.d.spots[id]; return s ? new T.Vector3(s.stand[0], this.floor(id, s.stand[0], s.stand[1]), s.stand[1]) : undefined; }
  /** What to look at on arrival. */
  look(id: string) { const s = this.d.spots[id]; if (!s) return undefined; const p = s.face ?? s.at; return new T.Vector3(p[0], this.floor(id, s.at[0], s.at[1]), p[1]); }

  /** Show exactly these spots: new ones appear, finished ones leave and free their geometry. Safe to call on every change. */
  sync(ids: readonly string[]) {
    this.wanted = new Set(ids.filter(id => this.d.spots[id]));
    for (const [id, mesh] of this.meshes) if (!this.wanted.has(id)) { mesh.geometry.dispose(); mesh.removeFromParent(); this.meshes.delete(id); }
    for (const id of this.wanted) if (!this.meshes.has(id)) void this.build(id);
  }

  private building = new Set<string>();
  private async build(id: string) {
    if (this.building.has(id)) return;
    this.building.add(id);
    try {
      const s = this.d.spots[id], kinds = (SPOT_RECIPES[s.kind].props ?? []).map(p => p.kind);
      const props = new Map(await Promise.all(kinds.map(async k => [k, await this.prop(k)] as const)));
      if (!this.d.alive() || !this.wanted.has(id)) return;
      const mesh = new T.Mesh(spotGeometry(s.kind, k => props.get(k)), this.material ??= this.makeMaterial());
      mesh.name = `Quest spot ${id}`; mesh.castShadow = true; mesh.receiveShadow = true;
      mesh.position.copy(this.point(id)!);
      mesh.rotation.y = s.kind === 'viewpoint' ? flatYaw(s.at, s.face ?? s.stand) : flatYaw(s.at, s.stand);
      this.meshes.set(id, mesh); this.group.add(mesh);
    } finally { this.building.delete(id); }
  }
  private prop(kind: string) { let p = this.cached.get(kind); if (!p) { p = this.d.loadProp(kind).catch(() => undefined); this.cached.set(kind, p); } return p; }

  /** Colliders for what is on show: they come and go with the object, so a finished step leaves no invisible wall. */
  bodies(): ActorBody[] {
    const out: ActorBody[] = [];
    for (const [id, mesh] of this.meshes) {
      const s = this.d.spots[id];
      (SPOT_RECIPES[s.kind].solid ?? []).forEach(([x, z, radius], i) => {
        const [wx, wz] = local(s.at, mesh.rotation.y, x, z);
        out.push({ id: `spot:${id}:${i}`, position: new T.Vector3(wx, mesh.position.y, wz), radius, height: 1.8 });
      });
    }
    return out;
  }

  dispose() {
    for (const mesh of this.meshes.values()) mesh.geometry.dispose();
    this.meshes.clear(); this.wanted.clear(); this.group.removeFromParent(); this.material?.dispose();
    for (const p of this.cached.values()) void p.then(g => g?.dispose());
  }
}
