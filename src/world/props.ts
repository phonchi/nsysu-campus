import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { toonMaterial } from '../render/toon';
import type { Obstacle } from '../walk/obstacles';

/** Street props along the tour route (spec-v4 §5, art-direction-v4 §6). Placement is planned from small
 * per-place recipes and checked against buildings, the walking network and NPC posts; every kind is one
 * merged static mesh per cell. Simple solids are exported beside the display for physics and route clearance. */
export interface PropSpot { kind: string; x: number; z: number; ry: number; s?: number; y?: number }
export interface PropWorld {
  zone(id: string): { x: number; z: number; r: number } | undefined;
  /** False inside buildings and other solid footprints. */
  open(x: number, z: number): boolean;
  /** Distance to the nearest walking-network edge (auto-walk and NPC routes). */
  pathDistance(x: number, z: number): number;
  ground(x: number, z: number): number;
  seaLevel: number;
  /** Points to keep clear (NPC posts, story spots). */
  keepClear: { x: number; z: number; r: number }[];
}

const rng = (seed: number) => () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };

/** Footprint radius per kind, for spacing and path clearance. */
const SIZE: Record<string, number> = {
  lamp: .4, garden_lamp: .3, bench: 1.1, bins: .6, notice_board: 1, a_board: .5, planter: 1.2, vending: .7, booth: 1.6, barrier: 4, bus_stop: .4,
  coffee_cart: 1.4, stall: 1.1, monkey_sign: .5, tetrapod: 1, railing: 1.6, lifebuoy: .5, umbrella_set: 1.6, parasol_table: 1.5, return_box: .6,
  flagpole: .5, bollard: .25, wall_lamp: .2, motorbike: .7,
};

/** Priority per kind (art-direction-v4 §6): tiers keep P1 only (C), P1–P2 (B) or everything (A). */
const PRIORITY: Record<string, 1 | 2 | 3> = {
  lamp: 1, garden_lamp: 1, bench: 1, bins: 1, notice_board: 1, a_board: 1, booth: 1, barrier: 1, coffee_cart: 1, stall: 1, monkey_sign: 1,
  tetrapod: 1, railing: 1, return_box: 1, planter: 2, vending: 2, bus_stop: 2, lifebuoy: 2, umbrella_set: 2, parasol_table: 2, bollard: 2,
  flagpole: 2, motorbike: 3, wall_lamp: 3,
};
// Solid furniture stays visible on every tier: a lower quality must not create invisible barriers.
export const propsForTier = (spots: PropSpot[], level: 1 | 2 | 3) => spots.filter(s => s.kind !== 'wall_lamp' || (PRIORITY[s.kind] ?? 3) <= level);

/** Simplified solids authored from tools/create_props_v4.py (glTF +Y up, +Z front).
 * The broad parts represent usable clearance, not every slat and decorative leaf. */
export function propObstacles(spots: readonly PropSpot[], ground: (x: number, z: number) => number): Obstacle[] {
  const out: Obstacle[] = [];
  spots.forEach((p, i) => {
    const s = p.s ?? 1, y = p.y ?? ground(p.x, p.z), c = Math.cos(p.ry), sn = Math.sin(p.ry);
    const box = (x: number, h: number, z: number, w: number, height: number, d: number, navigation = true) => out.push({ id: `prop:${i}:${p.kind}:${out.length}`, shape: 'box', center: [p.x + (x * c + z * sn) * s, y + h * s, p.z + (-x * sn + z * c) * s], half: [w * s / 2, height * s / 2, d * s / 2], yaw: p.ry, navigation });
    const pole = (radius: number, height: number) => out.push({ id: `prop:${i}:${p.kind}:${out.length}`, shape: 'cylinder', center: [p.x, y + height * s / 2, p.z], half: [radius * s, height * s / 2, radius * s] });
    switch (p.kind) {
      case 'lamp': pole(.09, 3.8); break;
      case 'garden_lamp': pole(.17, 1.35); break;
      case 'bench': box(0, .43, -.06, 1.8, .86, .56); break;
      case 'bins': box(0, .5, 0, 1.1, 1, .52); break;
      case 'notice_board': box(0, .9, 0, 1.65, 1.8, .14); break;
      case 'a_board': box(0, .55, 0, .6, 1.1, .45); break;
      case 'planter': pole(1.1, .95); break;
      case 'vending': box(0, .95, 0, 1, 1.9, .84); break;
      case 'booth': box(0, 1.3, 0, 2.6, 2.6, 2.4); break;
      case 'barrier': box(0, .55, 0, .4, 1.1, .4); box(2, 1, 0, 3.8, .12, .1); break;
      case 'bus_stop': pole(.07, 2.6); box(0, 2.45, 0, .55, .55, .06, false); break;
      case 'coffee_cart': box(0, .65, 0, 2.1, 1.3, 1.05); box(0, 2.15, 0, 2.4, .08, 1.4, false); break;
      case 'stall': box(0, .39, 0, 1.8, .78, .82); break;
      case 'monkey_sign': pole(.06, 1.5); box(0, 1.5, 0, .7, .7, .07); break;
      case 'tetrapod': pole(.65, 1.5); break;
      case 'railing': box(0, .56, 0, 3.1, 1.12, .1); break;
      case 'lifebuoy': pole(.07, 1.4); box(0, 1.15, .08, .8, .7, .16); break;
      case 'umbrella_set': pole(.05, 2.4); for (const x of [-.9, .9]) box(x, .3, -.2, .6, .6, 1.7); break;
      case 'parasol_table': pole(.56, .76); for (const [x, z] of [[-.9, 0], [.9, 0], [0, -.9], [0, .9]]) box(x, .45, z, .45, .9, .45); break;
      case 'return_box': box(0, .65, 0, .8, 1.3, .74); break;
      case 'flagpole': pole(.08, 9); break;
      case 'bollard': pole(.07, 1); break;
      case 'motorbike': box(0, .55, 0, .64, 1.1, 1.7); break;
    }
  });
  return out;
}

export function planProps(w: PropWorld, seed = 2026): PropSpot[] {
  const r = rng(seed), out: PropSpot[] = [];
  const ok = (kind: string, x: number, z: number) => {
    const s = SIZE[kind] ?? .8;
    if (!w.open(x, z) || !w.open(x + s, z) || !w.open(x - s, z) || !w.open(x, z + s) || !w.open(x, z - s)) return false;
    if (w.pathDistance(x, z) < s + 1.3) return false;
    if (w.keepClear.some(k => Math.hypot(k.x - x, k.z - z) < k.r + s)) return false;
    return !out.some(o => Math.hypot(o.x - x, o.z - z) < (SIZE[o.kind] ?? .8) + s + .4);
  };
  /** n props on a ring around a place, facing its centre (or away), first acceptable angles win. */
  const ring = (zone: string, kind: string, n: number, rad: number, face: 'in' | 'out' | 'tangent' = 'in', jitter = 2) => {
    const c = w.zone(zone); if (!c) return;
    let placed = 0;
    for (let k = 0; k < n * 8 && placed < n; k++) {
      const a = (k / (n * 8)) * Math.PI * 2 * 3 + r() * .3, d = rad + (r() - .5) * jitter;
      const x = c.x + Math.cos(a) * d, z = c.z + Math.sin(a) * d;
      if (!ok(kind, x, z)) continue;
      const toC = Math.atan2(c.x - x, c.z - z);
      out.push({ kind, x, z, ry: face === 'in' ? toC : face === 'out' ? toC + Math.PI : toC + Math.PI / 2 }); placed++;
    }
  };
  /** n props scattered in a disc, random yaw. */
  const scatter = (zone: string, kind: string, n: number, rad: number, s = 1) => {
    const c = w.zone(zone); if (!c) return;
    let placed = 0;
    for (let k = 0; k < n * 20 && placed < n; k++) {
      const a = r() * Math.PI * 2, d = Math.sqrt(r()) * rad, x = c.x + Math.cos(a) * d, z = c.z + Math.sin(a) * d;
      if (!ok(kind, x, z)) continue;
      out.push({ kind, x, z, ry: r() * Math.PI * 2, s }); placed++;
    }
  };
  // Gate: guard booth, barrier, bus stop, lamps, planters, bins, notice boards.
  ring('gate', 'booth', 1, 12); ring('gate', 'barrier', 1, 14, 'tangent'); ring('gate', 'bus_stop', 1, 16, 'out');
  ring('gate', 'lamp', 6, 18, 'in', 4); ring('gate', 'planter', 3, 10); ring('gate', 'bins', 2, 13); ring('gate', 'a_board', 2, 9, 'out'); ring('gate', 'motorbike', 6, 20, 'tangent', 3);
  // Tunnel portal: lamps, benches, a notice board.
  ring('tunnel-west', 'lamp', 2, 9); ring('tunnel-west', 'bench', 2, 11); ring('tunnel-west', 'notice_board', 1, 10, 'out');
  // Administration plaza: registration-season atmosphere.
  ring('admin', 'bench', 6, 15); ring('admin', 'garden_lamp', 10, 18, 'in', 3); ring('admin', 'bins', 3, 16);
  for (const o of out) if (o.kind === 'bins') o.s = .8; ring('admin', 'a_board', 3, 8, 'out');
  ring('admin', 'bollard', 4, 6, 'tangent', 1); ring('admin', 'flagpole', 3, 20, 'in', 1); ring('admin', 'planter', 2, 12); ring('admin', 'vending', 1, 19);
  // Library: return box, reading benches, parasol tables, notice boards.
  ring('library', 'return_box', 1, 9, 'out'); ring('library', 'bench', 4, 13); ring('library', 'parasol_table', 4, 17, 'in', 4); ring('library', 'notice_board', 2, 11, 'out'); ring('library', 'garden_lamp', 8, 15, 'in', 3);
  // Arcade: club stalls, coffee cart, monkey warning signs, bins, boards, benches.
  ring('arcade', 'stall', 4, 10, 'in', 3); ring('arcade', 'coffee_cart', 1, 7); ring('arcade', 'monkey_sign', 2, 15, 'out'); ring('arcade', 'bins', 4, 12);
  ring('arcade', 'notice_board', 3, 14, 'out');
  for (const o of out) if (o.kind === 'bins') o.s = .8; ring('arcade', 'bench', 4, 16); ring('arcade', 'vending', 1, 17);
  // Seawall: lamps, lifebuoys, railings, umbrellas on the sand; tetrapods along the waterline.
  ring('seawall', 'lamp', 8, 16, 'in', 6); ring('seawall', 'lifebuoy', 3, 12, 'out'); ring('seawall', 'railing', 4, 9, 'tangent'); ring('seawall', 'umbrella_set', 4, 24, 'in', 8);
  const sea = w.zone('seawall');
  if (sea) {
    let n = 0;
    for (let k = 0; k < 6000 && n < 160; k++) {
      const x = sea.x - 120 + r() * 240, z = sea.z - 160 + r() * 320, h = w.ground(x, z);
      if (h > w.seaLevel - .15 || h < w.seaLevel - 1.8) continue;
      if (out.some(o => o.kind === 'tetrapod' && Math.hypot(o.x - x, o.z - z) < 1.7)) continue;
      out.push({ kind: 'tetrapod', x, z, ry: r() * Math.PI * 2, s: .9 + r() * .3, y: h - .35 }); n++;
    }
  }
  void scatter;
  return out;
}

/** Load the prop GLBs and bake every placed prop into one static mesh per 160 m cell (all props share the
 * vertex-colour toon material, so a whole place is a single draw call and still frustum-culls). */
export async function addProps(parent: T.Object3D, spots: PropSpot[], asset: (p: string) => string, ground: (x: number, z: number) => number, alive: () => boolean) {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder), group = new T.Group();
  group.name = 'Route props (v4)'; parent.add(group);
  const kinds = [...new Set(spots.map(s => s.kind))], o = new T.Object3D();
  const geos = new Map<string, T.BufferGeometry>();
  await Promise.all(kinds.map(async kind => {
    const g = await loader.loadAsync(asset(`models/props/${kind}.glb`)).catch(() => undefined);
    if (!g) return;
    g.scene.updateMatrixWorld(true);
    g.scene.traverse(m => {
      if (!(m instanceof T.Mesh) || geos.has(kind)) return;
      const geo = m.geometry.clone().applyMatrix4(m.matrixWorld);
      for (const k of Object.keys(geo.attributes)) if (!['position', 'normal', 'color'].includes(k)) geo.deleteAttribute(k);
      if (geo.attributes.color && geo.attributes.color.itemSize === 4) { // keep RGB only, as float
        const c = geo.attributes.color, rgb = new Float32Array(c.count * 3);
        for (let i = 0; i < c.count; i++) { rgb[i * 3] = c.getX(i); rgb[i * 3 + 1] = c.getY(i); rgb[i * 3 + 2] = c.getZ(i); }
        geo.setAttribute('color', new T.BufferAttribute(rgb, 3));
      }
      geos.set(kind, geo.index ? geo.toNonIndexed() : geo);
    });
    g.scene.traverse(m => { if (m instanceof T.Mesh) { m.geometry.dispose(); for (const mt of [m.material].flat()) mt.dispose(); } });
  }));
  if (!alive()) { for (const g of geos.values()) g.dispose(); return group; }
  const material = toonMaterial({ vertexColors: true, name: 'props' }), CELL = 160;
  const cells = new Map<string, { shadow: T.BufferGeometry[]; flat: T.BufferGeometry[] }>();
  for (const s of spots) {
    const src = geos.get(s.kind); if (!src) continue;
    o.position.set(s.x, s.y ?? ground(s.x, s.z), s.z); o.rotation.set(0, s.ry, 0); o.scale.setScalar(s.s ?? 1); o.updateMatrix();
    const key = `${Math.floor(s.x / CELL)},${Math.floor(s.z / CELL)}`, cell = cells.get(key) ?? cells.set(key, { shadow: [], flat: [] }).get(key)!;
    (s.kind === 'tetrapod' ? cell.flat : cell.shadow).push(src.clone().applyMatrix4(o.matrix));
  }
  for (const [key, c] of cells) for (const [list, shadow] of [[c.shadow, true], [c.flat, false]] as const) {
    if (!list.length) continue;
    const merged = mergeGeometries(list, false); for (const g of list) g.dispose();
    if (!merged) continue;
    const mesh = new T.Mesh(merged, material); mesh.name = `Props ${key}${shadow ? '' : ' (tetrapods)'}`;
    mesh.castShadow = shadow; mesh.receiveShadow = true; group.add(mesh);
  }
  for (const g of geos.values()) g.dispose();
  // Failed assets never leave invisible collision behind. Runtime registers these once loaded.
  group.userData.obstacles = propObstacles(spots.filter(s => geos.has(s.kind)), ground);
  return group;
}
