import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { toonify } from '../render/toon';
import { addOutlines } from '../render/outline';
import { NIGHT_MATERIALS } from '../walk-materials';
import type { Terrain } from './terrain';
import { fullTunnelProfile,fullTunnelGeometry,tunnelGroundCuts,tunnelVegetationVolumes } from './tunnel-surface';

type P2 = [number, number];
export interface Placement { osmId?: number | null; centroid: P2; yaw: number; elevation?: number | null; path?: P2[]; moduleLength?: number; parts?: string[]; walkableLength?: number; seaOffset?: number; centerline?: P2[]; eastPortal?: P2 }
export interface Box { center: [number, number, number]; size: [number, number, number]; yaw: number; walkable?: boolean }

/** Hand-modelled landmarks (T4, tools/create_landmarks.py) and the OSM blocks / v2 features they replace. */
export const LANDMARK_IDS = ['admin', 'library', 'liberal-arts', 'tunnel', 'gate', 'seawall', 'yatsen-hall', 'gym', 'marine', 'activity-center', 'beach-house'] as const;
export const REPLACES: Record<string, string> = { admin: 'AD', library: 'IL', 'yatsen-hall': 'YH', gym: 'SPORT', marine: 'ME', 'activity-center': 'ACTIVITY', 'beach-house': 'BEACH' };

export async function loadPlacements(asset: (p: string) => string) {
  const r = await fetch(asset('models/landmarks/placements.json'));
  if (!r.ok) throw Error('地標擺放資料尚未就緒');
  return await r.json() as Record<string, Placement>;
}

/** Ground cut-outs so walkable landmark geometry is not buried in the DEM (the tunnel mouth). */
export function landmarkCarves(placements: Record<string, Placement>,ground?:(x:number,z:number)=>number): P2[][] {
 const t=placements.tunnel;if(!t)return [];
 return tunnelGroundCuts(fullTunnelProfile(t,ground??(()=>0)),ground);
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
    const local = data.boxes.map(b => {
      const o = new T.Object3D(); o.position.set(...b.center); o.rotation.y = b.yaw; o.updateMatrix();
      return new T.Box3(new T.Vector3(...b.size).multiplyScalar(-.5), new T.Vector3(...b.size).multiplyScalar(.5)).applyMatrix4(o.matrix);
    });

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
  if(placements.tunnel) volumes.push(...tunnelVegetationVolumes(fullTunnelProfile(placements.tunnel,ground)));
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
  if(id==='tunnel'&&p.centerline){const tunnel=fullTunnelProfile(p,ground);put(tunnel.west.x,tunnel.west.y,tunnel.west.z,tunnel.westYaw);put(tunnel.east.x,tunnel.east.y,tunnel.east.z,tunnel.eastYaw);return out;}
  const [x, z] = p.centroid;
  // The tunnel floor must meet the road in front of the portal (local +Z), not the hill above the mouth.
  const front = id === 'tunnel' ? [x + Math.sin(p.yaw) * 4, z + Math.cos(p.yaw) * 4] : undefined;
  put(x, p.elevation ?? (front ? Math.min(ground(x, z), ground(front[0], front[1])) : ground(x, z)), z, p.yaw);
  return out;
}

/** Landmarks sit at their centroid's ground height, so on a slope the downhill side would hang in the air.
 * Each ground-level box that floats gets a footing down to the lowest soil under it, shown and solid alike. */
export function landmarkFootings(placements: Record<string, Placement>, collisions: Record<string, { boxes: Box[] }>, ground: (x: number, z: number) => number): Box[] {
  const out: Box[] = [];
  for (const id of LANDMARK_IDS) {
    const p = placements[id], col = collisions[id];
    if (!p || !col || id === 'tunnel' || p.path) continue;
    const seat = new T.Vector3().setFromMatrixPosition(landmarkTransforms(id, p, ground)[0]).y, c = Math.cos(p.yaw), s = Math.sin(p.yaw);
    for (const b of col.boxes) {
      if (b.center[1] - b.size[1] / 2 > .1) continue;
      const by = Math.cos(b.yaw), bs = Math.sin(b.yaw), at = (u: number, v: number): P2 => {
        const lx = b.center[0] + u * b.size[0] * by + v * b.size[2] * bs, lz = b.center[2] - u * b.size[0] * bs + v * b.size[2] * by;
        return [p.centroid[0] + lx * c + lz * s, p.centroid[1] - lx * s + lz * c];
      };
      let low = Infinity;
      for (let u = -.5; u <= .5; u += .25) for (let v = -.5; v <= .5; v += .25) low = Math.min(low, ground(...at(u, v)));
      if (seat - low <= .25) continue;
      const [x, z] = at(0, 0), bottom = low - .1;
      out.push({ center: [x, (seat + bottom) / 2, z], size: [b.size[0], seat - bottom, b.size[2]], yaw: p.yaw + b.yaw });
    }
  }
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
    const extra: Box[] = [];
    for (const m of landmarkTransforms(id, p, ground)) boxesToMeshes([...col.boxes, ...extra], group, m);
  }
  boxesToMeshes(landmarkFootings(placements, collisions, ground), group, new T.Matrix4());
  if(placements.tunnel){const profile=fullTunnelProfile(placements.tunnel,ground),geometry=fullTunnelGeometry(profile);for(const [kind,g]of Object.entries(geometry)){const mesh=new T.Mesh(g,new T.MeshBasicMaterial());mesh.name=`Tunnel ${kind} collision`;mesh.userData.surfaceKind='tunnel';group.add(mesh);}}
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
    const root = gltf.scene;root.userData.landmarkId=id;
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
      for(let i=0;i<transforms.length;i++){const portal=i===0?root:root.clone(true);transforms[i].decompose(portal.position,portal.quaternion,portal.scale);portal.userData.landmarkId=id;if(id==='tunnel')portal.userData.portal=i?'east':'west';display.add(portal);}
      // The rendered asset can extend beyond its simplified collision (porches, plinths).
      // Tunnel walls/hills have separate finite-volume exclusions from their collision kit.
      if (id !== 'tunnel') { const box = new T.Box3().setFromObject(root); box.min.y = -Infinity; visualVolumes.push(box); }
    }
    if (REPLACES[id]) replaced.push(REPLACES[id]);
  }));
  if(placements.tunnel){const geometry=fullTunnelGeometry(fullTunnelProfile(placements.tunnel,ground));const corridor=new T.Group();corridor.name='Full Sisihwan tunnel';corridor.userData.landmarkId='tunnel';corridor.userData.portal='interior';for(const [kind,g]of Object.entries(geometry)){const material=new T.MeshStandardMaterial({color:kind==='floor'?0x96918b:0xd0ccc1,roughness:.95,side:T.DoubleSide,emissive:kind==='floor'?0x171716:0x242421,emissiveIntensity:.45});const mesh=new T.Mesh(g,material);mesh.name=`Full tunnel ${kind}`;mesh.receiveShadow=true;corridor.add(mesh);}toonify(corridor);display.add(corridor);}
  const footings = landmarkFootings(placements, collisions, ground);
  if (footings.length) {
    const group = new T.Group(); group.name = 'Landmark footings';
    boxesToMeshes(footings, group, new T.Matrix4());
    const merged = mergeGeometries(group.children.map(o => { const m = o as T.Mesh; m.updateMatrix(); return m.geometry.applyMatrix4(m.matrix); }));
    const footing = new T.Mesh(merged, new T.MeshStandardMaterial({ color: '#b9ae9c' })); footing.name = 'Landmark footings';
    toonify(footing); footing.castShadow = true; footing.receiveShadow = true; display.add(footing);
  }
  addOutlines(display, 'landmark');
  display.updateMatrixWorld(true);
  return { display, collision: landmarkCollision(placements, collisions, ground), replacedOsm: replaced,
    vegetationVolumes: [...landmarkVegetationVolumes(placements, collisions, ground), ...visualVolumes] };
}
