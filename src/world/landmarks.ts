import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { toonify } from '../render/toon';
import { addOutlines } from '../render/outline';
import { NIGHT_MATERIALS } from '../walk-materials';
import type { Terrain } from './terrain';

type P2 = [number, number];
export interface Placement { osmId?: number | null; centroid: P2; yaw: number; elevation?: number | null; path?: P2[]; moduleLength?: number; parts?: string[]; walkableLength?: number; seaOffset?: number }
export interface Box { center: [number, number, number]; size: [number, number, number]; yaw: number; walkable?: boolean }
const TUNNEL_APRON: Box = { center: [0, -.15, 1.5], size: [10, .3, 7], yaw: 0, walkable: true };

/** Hand-modelled landmarks (T4, tools/create_landmarks.py) and the OSM blocks / v2 features they replace. */
export const LANDMARK_IDS = ['admin', 'library', 'liberal-arts', 'tunnel', 'gate', 'seawall', 'yatsen-hall', 'gym', 'marine', 'activity-center', 'beach-house'] as const;
export const REPLACES: Record<string, string> = { admin: 'AD', library: 'IL', 'yatsen-hall': 'YH', gym: 'SPORT', marine: 'ME', 'activity-center': 'ACTIVITY', 'beach-house': 'BEACH' };

export async function loadPlacements(asset: (p: string) => string) {
  const r = await fetch(asset('models/landmarks/placements.json'));
  if (!r.ok) throw Error('地標擺放資料尚未就緒');
  return await r.json() as Record<string, Placement>;
}

/** Ground cut-outs so walkable landmark geometry is not buried in the DEM (the tunnel mouth). */
export function landmarkCarves(placements: Record<string, Placement>): P2[][] {
  const t = placements.tunnel;
  if (!t) return [];
  // Local -Z points into the bore; carve the first walkable stretch plus the portal apron, 10 m wide.
  const len = (t.walkableLength ?? 20) + 2, half = 5, c = Math.cos(t.yaw), s = Math.sin(t.yaw);
  const local: P2[] = [[-half, 2], [half, 2], [half, -len], [-half, -len]];
  return [local.map(([x, z]) => [t.centroid[0] + x * c + z * s, t.centroid[1] - x * s + z * c] as P2)];
}

function boxesToMeshes(boxes: Box[], into: T.Group, matrix: T.Matrix4) {
  for (const b of boxes) {
    const m = new T.Mesh(new T.BoxGeometry(...b.size));
    m.position.set(...b.center); m.rotation.y = b.yaw; m.updateMatrix();
    m.applyMatrix4(matrix); into.add(m);
  }
}

export interface LoadedLandmarks { display: T.Group; collision: T.Group; replacedOsm: string[]; vegetationVolumes: T.Box3[] }

/** Closed occupied volumes, including empty interior air. Tunnel exclusions retain their
 * finite Y range, so a real soil surface above the bore remains eligible for vegetation. */
export function landmarkVegetationVolumes(placements: Record<string, Placement>, collisions: Record<string, { boxes: Box[] }>, ground: (x: number, z: number) => number): T.Box3[] {
  const volumes: T.Box3[] = [];
  for (const id of LANDMARK_IDS) {
    const placement = placements[id], data = collisions[id];
    if (!placement || !data) continue;
    const local = [...data.boxes, ...(id === 'tunnel' ? [TUNNEL_APRON] : [])].map(b => {
      const o = new T.Object3D(); o.position.set(...b.center); o.rotation.y = b.yaw; o.updateMatrix();
      return new T.Box3(new T.Vector3(...b.size).multiplyScalar(-.5), new T.Vector3(...b.size).multiplyScalar(.5)).applyMatrix4(o.matrix);
    });
    if (id === 'tunnel') local.push(new T.Box3(new T.Vector3(-3.9, -.3, -(placement.walkableLength ?? 20) - 2), new T.Vector3(3.9, 6.8, 2)));
    for (const transform of landmarkTransforms(id, placement, ground)) {
      if (id === 'tunnel' || placement.path) volumes.push(...local.map(b => {
        const box = b.clone().applyMatrix4(transform);
        // Soil below a seated wall/hill/plinth is covered too. The finite upper bound
        // still permits real terrain above a tunnel roof, unlike an XZ-only mask.
        box.min.y = -Infinity; return box;
      }));
      else {
        const occupied = local.reduce((box, b) => box.union(b), new T.Box3()).applyMatrix4(transform);
        // The soil under a raised slab or enclosed building is shaded/indoor too;
        // a root below the first wall's collider is not an outdoor planting surface.
        occupied.min.y = -Infinity;
        if (!occupied.isEmpty()) volumes.push(occupied);
      }
    }
  }
  return volumes;
}

/** Load every landmark GLB, seat it on the terrain, and return display + collision groups. */
/** Where each landmark (or each module of a kit) sits: wrapper transforms only, no GLB node transforms. */
export function landmarkTransforms(id: string, p: Placement, ground: (x: number, z: number) => number): T.Matrix4[] {
  const out: T.Matrix4[] = [], o = new T.Object3D();
  const put = (x: number, y: number, z: number, yaw: number) => { o.position.set(x, y, z); o.rotation.set(0, yaw, 0); o.updateMatrix(); out.push(o.matrix.clone()); };
  if (p.path && p.parts?.length) {
    const step = p.moduleLength ?? 6;
    for (let i = 1; i < p.path.length; i++) {
      const [ax, az] = p.path[i - 1], [bx, bz] = p.path[i], L = Math.hypot(bx - ax, bz - az);
      // Short kinks of the OSM line would put a parapet across the road: only lay modules on full-length runs.
      if (L < step) continue;
      const yaw = -Math.atan2(bz - az, bx - ax);
      // The OSM line is the road on top of the seawall; the parapet belongs at its sea edge (module local -Z).
      const sea = new T.Vector3(0, 0, -1).applyAxisAngle(new T.Vector3(0, 1, 0), yaw).multiplyScalar(p.seaOffset ?? 3.5);
      for (let t = step / 2; t + step / 2 <= L; t += step) {
        const x = ax + (bx - ax) * t / L + sea.x, z = az + (bz - az) * t / L + sea.z;
        put(x, ground(x, z), z, yaw);
      }
    }
    return out;
  }
  const [x, z] = p.centroid;
  // The tunnel floor must meet the road in front of the portal (local +Z), not the hill above the mouth.
  const front = id === 'tunnel' ? [x + Math.sin(p.yaw) * 4, z + Math.cos(p.yaw) * 4] : undefined;
  put(x, p.elevation ?? (front ? Math.min(ground(x, z), ground(front[0], front[1])) : ground(x, z)), z, p.yaw);
  return out;
}

/** Collision boxes for every landmark, as meshes in one group. Pure (no GLB): shared by the runtime, the navmesh
 * bake and node-side tests so all three see the same world. */
export function landmarkCollision(placements: Record<string, Placement>, collisions: Record<string, { boxes: Box[] }>, ground: (x: number, z: number) => number) {
  const group = new T.Group();
  group.name = 'Landmark collision';
  for (const id of LANDMARK_IDS) {
    const p = placements[id], col = collisions[id];
    if (!p || !col) continue;
    // The terrain carve starts 2 m outside the portal; an apron slab bridges it so nobody drops through the mouth.
    const extra: Box[] = id === 'tunnel' ? [TUNNEL_APRON] : [];
    for (const m of landmarkTransforms(id, p, ground)) boxesToMeshes([...col.boxes, ...extra], group, m);
  }
  group.updateMatrixWorld(true);
  return group;
}

export async function loadLandmarks(asset: (p: string) => string, placements: Record<string, Placement>, terrain?: Terrain): Promise<LoadedLandmarks> {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const display = new T.Group();
  display.name = 'Landmarks (hand-modelled)';
  const ground = (x: number, z: number) => terrain ? terrain.heightAt(x, z) : -.055;
  const replaced: string[] = [], collisions: Record<string, { boxes: Box[] }> = {};
  const visualVolumes: T.Box3[] = [];
  await Promise.all(LANDMARK_IDS.map(async id => {
    const p = placements[id];
    if (!p) return;
    const [gltf, col] = await Promise.all([
      loader.loadAsync(asset(`models/landmarks/${id}.glb`)),
      fetch(asset(`models/landmarks/${id}.collision.json`)).then(r => r.ok ? r.json() as Promise<{ boxes: Box[] }> : { boxes: [] }).catch(() => ({ boxes: [] as Box[] })),
    ]);
    collisions[id] = col;
    const root = gltf.scene;
    // Name the window glow so the toon shader switches windows per bay/storey at night like the procedural facades.
    root.traverse(o => { if (o instanceof T.Mesh) for (const m of [o.material].flat() as T.MeshStandardMaterial[]) if (m.emissiveMap) m.emissiveMap.name = `${id} night windows`; });
    toonify(root);
    root.traverse(o => {
      if (!(o instanceof T.Mesh)) return;
      o.castShadow = true; o.receiveShadow = true;
      for (const m of [o.material].flat() as T.MeshToonMaterial[]) if (m.emissiveMap) { m.emissiveIntensity = 0; NIGHT_MATERIALS.add(m as never); }
    });
    const transforms = landmarkTransforms(id, p, ground);
    if (p.path && p.parts?.length) {
      // Kit: one wrapper per module; the GLB node keeps its own transform (meshopt stores a scale there).
      const part = root.getObjectByName(p.parts[0]) ?? root.children[0];
      for (const m of transforms) { const module = new T.Group(); module.add(part.clone()); m.decompose(module.position, module.quaternion, module.scale); display.add(module); }
    } else {
      transforms[0].decompose(root.position, root.quaternion, root.scale);
      display.add(root);
      // The rendered asset can extend beyond its simplified collision (porches, plinths).
      // Tunnel walls/hills have separate finite-volume exclusions from their collision kit.
      if (id !== 'tunnel') { const box = new T.Box3().setFromObject(root); box.min.y = -Infinity; visualVolumes.push(box); }
    }
    if (REPLACES[id]) replaced.push(REPLACES[id]);
  }));
  addOutlines(display, 'landmark');
  display.updateMatrixWorld(true);
  return { display, collision: landmarkCollision(placements, collisions, ground), replacedOsm: replaced,
    vegetationVolumes: [...landmarkVegetationVolumes(placements, collisions, ground), ...visualVolumes] };
}
