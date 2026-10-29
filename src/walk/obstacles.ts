import { Box3, BoxGeometry, CylinderGeometry, Euler, Group, Matrix4, Mesh, Object3D, Quaternion, Vector3 } from 'three';

/** Metres in world space. The same simple shapes drive physics and path clearance;
 * render meshes (including their leaves, signs and merged cells) never become navigation input. */
export interface Obstacle {
  id: string;
  shape: 'box' | 'cylinder';
  center: [number, number, number];
  half: [number, number, number];
  yaw?: number;
  /** Overhead decoration can occlude a camera without blocking a walking route. */
  navigation?: boolean;
}

export interface ActorBody { id: string; position: Vector3; radius: number; height: number }
export type RouteFootprint = number | { radius: number; halfLength: number };
export type SupportAt = (x: number, z: number, referenceY: number) => number | undefined;
const footprint = (f: RouteFootprint) => typeof f === 'number' ? { radius: f, halfLength: 0 } : f;

/** Camera-only oriented bounds for the actual swinging door panel. Refresh after
 * door animation; its walking rule remains with doorConstraint. Only nearby panels matter. */
export function doorCameraObstacles(doors: readonly { id: string; panel: Object3D; position: Vector3 }[], near: Vector3, reach = 16): Obstacle[] {
  const out: Obstacle[] = [], bounds = new Box3(), part = new Box3(), center = new Vector3(), half = new Vector3();
  const inverse = new Matrix4(), relative = new Matrix4(), scale = new Vector3(), rotation = new Quaternion(), yaw = new Euler(0, 0, 0, 'YXZ');
  for (const d of doors) {
    if (d.position.distanceToSquared(near) > reach * reach) continue;
    d.panel.updateWorldMatrix(true, true); inverse.copy(d.panel.matrixWorld).invert(); bounds.makeEmpty();
    d.panel.traverse(m => {
      if (!(m instanceof Mesh)) return;
      if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
      if (!m.geometry.boundingBox) return;
      relative.multiplyMatrices(inverse, m.matrixWorld);
      bounds.union(part.copy(m.geometry.boundingBox).applyMatrix4(relative));
    });
    if (bounds.isEmpty()) continue;
    d.panel.matrixWorld.decompose(center, rotation, scale); yaw.setFromQuaternion(rotation, 'YXZ');
    bounds.getCenter(center).applyMatrix4(d.panel.matrixWorld); bounds.getSize(half).multiply(scale).multiplyScalar(.5);
    out.push({ id: `door:${d.id}`, shape: 'box', center: center.toArray(), half: [Math.max(.02, Math.abs(half.x)), Math.max(.02, Math.abs(half.y)), Math.max(.02, Math.abs(half.z))], yaw: yaw.y, navigation: false });
  }
  return out;
}

/** Explicit geometry is useful for debug rendering and an offline nav bake. */
export function obstacleGeometry(obstacles: readonly Obstacle[]) {
  const root = new Group(); root.name = 'Simple world obstacles';
  for (const o of obstacles) {
    const [x, y, z] = o.half;
    const mesh = new Mesh(o.shape === 'cylinder' ? new CylinderGeometry(x, x, y * 2, 12) : new BoxGeometry(x * 2, y * 2, z * 2));
    mesh.name = o.id; mesh.position.set(...o.center); mesh.rotation.y = o.yaw ?? 0; root.add(mesh);
  }
  return root;
}

const extent = (o: Obstacle) => Math.hypot(o.half[0], o.half[2]);
const local = (o: Obstacle, p: Vector3) => {
  const c = Math.cos(o.yaw ?? 0), s = Math.sin(o.yaw ?? 0), x = p.x - o.center[0], z = p.z - o.center[2];
  return [x * c - z * s, x * s + z * c];
};

function pointSegment(x: number, z: number, a: number[], b: number[]) {
  const dx = b[0] - a[0], dz = b[1] - a[1], len = dx * dx + dz * dz;
  const t = len ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / len)) : 0;
  return Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t);
}

/** Exact 2D distance from a segment to a circle/rotated box. Box inflation has rounded
 * corners, just like a capsule, instead of incorrectly treating every corner as square. */
function distance(o: Obstacle, a: Vector3, b: Vector3) {
  const p = local(o, a), q = local(o, b);
  if (o.shape === 'cylinder') return Math.max(0, pointSegment(0, 0, p, q) - o.half[0]);
  let lo = 0, hi = 1;
  for (let k = 0; k < 2; k++) {
    const h = o.half[k === 0 ? 0 : 2], d = q[k] - p[k];
    if (Math.abs(d) < 1e-8) { if (Math.abs(p[k]) > h) { lo = 2; break; } continue; }
    const t1 = (-h - p[k]) / d, t2 = (h - p[k]) / d;
    lo = Math.max(lo, Math.min(t1, t2)); hi = Math.min(hi, Math.max(t1, t2));
    if (lo > hi) break;
  }
  if (lo <= hi) return 0;
  const hx = o.half[0], hz = o.half[2];
  return Math.min(...[p, q].map(v => Math.hypot(Math.max(0, Math.abs(v[0]) - hx), Math.max(0, Math.abs(v[1]) - hz))),
    ...[[-hx, -hz], [-hx, hz], [hx, -hz], [hx, hz]].map(([x, z]) => pointSegment(x, z, p, q)));
}

const relevant = (o: Obstacle, a: Vector3, b: Vector3) => o.navigation !== false && o.center[1] + o.half[1] >= Math.min(a.y, b.y) + .12 && o.center[1] - o.half[1] <= Math.max(a.y, b.y) + 1.7;

function blocks(o: Obstacle, a: Vector3, b: Vector3, f: RouteFootprint, escape = false) {
  if (!relevant(o, a, b)) return false;
  const { radius, halfLength } = footprint(f), direction = b.clone().sub(a).setY(0).normalize();
  const start = a.clone().addScaledVector(direction, -halfLength), end = b.clone().addScaledVector(direction, halfLength);
  if (distance(o, start, end) >= radius - 1e-5) return false;
  if (escape && a.distanceToSquared(b) > 1e-8) {
    const nose = a.clone().addScaledVector(direction, halfLength), initial = distance(o, start, nose);
    // Only leave extra planning padding, never escape through the actual capsule or solid.
    const physical = typeof f === 'number' ? Math.min(radius, .30) : radius;
    const epsilon = direction.clone().multiplyScalar(.001);
    const after = distance(o, start.clone().add(epsilon), nose.clone().add(epsilon));
    if (initial >= physical - 1e-4 && after >= initial - 1e-7) return false;
  }
  return true;
}

/** Small spatial index for thousands of tree trunks. Static obstacles are never tied to
 * camera visibility, frustum culling, or a temporary NPC position. */
export class ObstacleField {
  readonly obstacles: Obstacle[] = [];
  private cells = new Map<string, Set<Obstacle>>();
  private ids = new Set<string>();
  private readonly cell = 12;

  add(specs: readonly Obstacle[]) {
    for (const o of specs) {
      if (this.ids.has(o.id)) continue;
      this.ids.add(o.id); this.obstacles.push(o);
      const r = extent(o);
      for (let x = Math.floor((o.center[0] - r) / this.cell); x <= Math.floor((o.center[0] + r) / this.cell); x++) {
        for (let z = Math.floor((o.center[2] - r) / this.cell); z <= Math.floor((o.center[2] + r) / this.cell); z++) {
          const key = `${x},${z}`, set = this.cells.get(key) ?? new Set<Obstacle>(); set.add(o); this.cells.set(key, set);
        }
      }
    }
  }

  private candidates(a: Vector3, b: Vector3, pad: number) {
    const found = new Set<Obstacle>();
    // Sample cells along the segment instead of visiting its entire diagonal bounding box.
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / (this.cell / 2))), reach = Math.ceil(pad / this.cell) + 1;
    for (let i = 0; i <= n; i++) {
      const x = Math.floor((a.x + (b.x - a.x) * i / n) / this.cell), z = Math.floor((a.z + (b.z - a.z) * i / n) / this.cell);
      for (let dx = -reach; dx <= reach; dx++) for (let dz = -reach; dz <= reach; dz++) for (const o of this.cells.get(`${x + dx},${z + dz}`) ?? []) found.add(o);
    }
    return [...found];
  }

  clear(a: Vector3, b: Vector3, f: RouteFootprint = .34) { return this.segmentClear(a, b, f); }
  private segmentClear(a: Vector3, b: Vector3, f: RouteFootprint, escape = false) {
    const { radius, halfLength } = footprint(f);
    return !this.candidates(a, b, radius + halfLength).some(o => blocks(o, a, b, f, escape));
  }

  private fits(at: Vector3, direction: Vector3, f: RouteFootprint) {
    const { radius, halfLength } = footprint(f), a = at.clone().addScaledVector(direction, -halfLength), b = at.clone().addScaledVector(direction, halfLength);
    return this.clear(a, b, radius);
  }

  /** Nearby stand-off goal; never claim the obstructed NPC/prop centre itself is reachable. */
  private projectGoal(goal: Vector3, from: Vector3, f: RouteFootprint, support?: SupportAt) {
    const direction = goal.clone().sub(from).setY(0).normalize();
    if (this.fits(goal, direction, f)) return goal.clone();
    const toward = Math.atan2(from.z - goal.z, from.x - goal.x);
    for (let r = .08; r <= 2; r += .08) for (let k = 0; k < 24; k++) {
      const angle = toward + k * Math.PI / 12, p = new Vector3(goal.x + Math.cos(angle) * r, goal.y, goal.z + Math.sin(angle) * r);
      if (support) { const y = support(p.x, p.z, goal.y); if (y === undefined || Math.abs(y - goal.y) > .65) continue; p.y = y; }
      if (this.fits(p, p.clone().sub(from).setY(0).normalize(), f)) return p;
    }
    return undefined;
  }

  /** Repair only obstructed segments of an existing terrain/navmesh route. A bounded
   * visibility graph goes around local props; it never invents a route through a building.
   * `clearWorld` must validate newly introduced edges against the full collision world.
   * Empty means no safe repair, so the caller stops instead of repeatedly walking into it. */
  route(path: readonly Vector3[], f: RouteFootprint = .34, clearWorld?: (a: Vector3, b: Vector3) => boolean, ground?: SupportAt): Vector3[] {
    if (path.length < 2) return path.map(p => p.clone());
    const { radius, halfLength } = footprint(f);
    const out = [path[0].clone()];
    for (let i = 1; i < path.length; i++) {
      const a = out[out.length - 1], projected = this.projectGoal(path[i], a, f, ground);
      if (!projected) return [];
      const b = projected, movedGoal = b.distanceToSquared(path[i]) > 1e-8;
      if (this.segmentClear(a, b, f, i === 1) && (!movedGoal || clearWorld?.(a, b))) { out.push(b); continue; }
      // No lateral step away from an elevated stair flight or across floors.
      if (!clearWorld || Math.abs(a.y - b.y) > 1.5) return [];
      const nearby = this.candidates(a, b, 5).filter(o => relevant(o, a, b) && pointSegment(o.center[0], o.center[2], [a.x, a.z], [b.x, b.z]) < extent(o) + radius + halfLength + 4);
      nearby.sort((p, q) => pointSegment(p.center[0], p.center[2], [a.x, a.z], [b.x, b.z]) - pointSegment(q.center[0], q.center[2], [a.x, a.z], [b.x, b.z]));
      const nodes = [a, b.clone()], dx = b.x - a.x, dz = b.z - a.z, len2 = dx * dx + dz * dz;
      for (const o of nearby.slice(0, 20)) {
        const c = Math.cos(o.yaw ?? 0), s = Math.sin(o.yaw ?? 0), hx = o.half[0] + radius + halfLength + .12, hz = o.half[2] + radius + halfLength + .12;
        const corners = o.shape === 'cylinder' ? Array.from({ length: 8 }, (_, k) => [Math.cos(k * Math.PI / 4) * hx, Math.sin(k * Math.PI / 4) * hx]) : [[-hx, -hz], [-hx, hz], [hx, -hz], [hx, hz]];
        for (const [x, z] of corners) {
          const p = new Vector3(o.center[0] + x * c + z * s, a.y, o.center[2] - x * s + z * c);
          const t = len2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / len2)) : 0;
          p.y = a.y + (b.y - a.y) * t;
          if (ground) { const y = ground(p.x, p.z, p.y); if (y === undefined || Math.abs(y - p.y) > .65) continue; p.y = y; }
          if (this.clear(p, p, radius)) nodes.push(p);
        }
      }
      const dist = nodes.map(() => Infinity), prev = nodes.map(() => -1), done = new Set<number>(); dist[0] = 0;
      const edges = new Map<string, boolean>(); let checked = 0;
      while (done.size < nodes.length) {
        let u = -1, best = Infinity;
        for (let j = 0; j < nodes.length; j++) { const cost = dist[j] + nodes[j].distanceTo(b); if (!done.has(j) && cost < best) { best = cost; u = j; } }
        if (u < 0 || u === 1) break;
        done.add(u);
        for (let v = 1; v < nodes.length; v++) {
          if (done.has(v) || v === u) continue;
          const cost = dist[u] + nodes[u].distanceTo(nodes[v]);
          if (cost >= dist[v]) continue;
          const key = `${Math.min(u, v)},${Math.max(u, v)}`; let clear = edges.get(key);
          if (clear === undefined) {
            if (++checked > 3000) return [];
            clear = this.segmentClear(nodes[u], nodes[v], f, u === 0 && i === 1) && clearWorld(nodes[u], nodes[v]); edges.set(key, clear);
          }
          if (!clear) continue;
          dist[v] = cost; prev[v] = u;
        }
      }
      if (!Number.isFinite(dist[1])) return [];
      const detour: Vector3[] = [];
      for (let j = 1; j !== 0; j = prev[j]) detour.push(nodes[j].clone());
      out.push(...detour.reverse());
    }
    return out;
  }
}
