import { Vector3 } from 'three';
import { GROUND_Y } from '../world/terrain';

interface Graph { nodes: { id: number; p: [number, number, number] }[]; edges: [number, number, number][]; edgeKind: string[]; anchors: Record<string, { node: number; label: string }> }

/** Walkable outdoor path network (OSM ways on the DEM, tools/build_outdoor_graph.py) with A* search.
 * Tunnel edges are excluded: only the campus-side portal segment exists as walkable geometry. */
export class OutdoorRoutes {
  private adj: { to: number; w: number }[][] = [];
  private pos: Vector3[] = [];

  constructor(private graph: Graph) {
    this.pos = graph.nodes.map(n => new Vector3(n.p[0], n.p[1] + GROUND_Y, n.p[2]));
    this.adj = graph.nodes.map(() => []);
    graph.edges.forEach(([a, b, w], i) => {
      if (graph.edgeKind[i] === 'tunnel') return;
      this.adj[a].push({ to: b, w }); this.adj[b].push({ to: a, w });
    });
  }

  static async load(url: string) {
    const r = await fetch(url); if (!r.ok) throw Error('室外路網尚未就緒');
    return new OutdoorRoutes(await r.json() as Graph);
  }

  anchor(id: string) { const a = this.graph.anchors[id]; return a ? this.pos[a.node].clone() : undefined; }
  get anchorIds() { return Object.keys(this.graph.anchors); }
  label(id: string) { return this.graph.anchors[id]?.label.replace(/\s*\(.*\)$/, '') ?? id; }

  nearest(p: Vector3, maxDist = Infinity) {
    let best = -1, d = maxDist;
    for (let i = 0; i < this.pos.length; i++) {
      if (!this.adj[i].length) continue;
      const q = this.pos[i], dd = Math.hypot(q.x - p.x, q.z - p.z) + Math.abs(q.y - p.y) * 2;
      if (dd < d) { d = dd; best = i; }
    }
    return best;
  }

  /** Drop every edge a walker could not actually follow: `clear(a, b)` sweeps the real collision world
   * (buildings, walls, landmark models) at body height. Returns the number of removed edges. */
  validate(clear: (a: Vector3, b: Vector3) => boolean) {
    this.clear = clear;
    let removed = 0;
    const keep = new Map<string, boolean>();
    for (let a = 0; a < this.adj.length; a++) this.adj[a] = this.adj[a].filter(({ to }) => {
      const key = a < to ? `${a}-${to}` : `${to}-${a}`;
      let ok = keep.get(key);
      if (ok === undefined) { ok = clear(this.pos[a], this.pos[to]); keep.set(key, ok); if (!ok) removed++; }
      return ok;
    });
    this.components();
    return removed;
  }

  private clear?: (a: Vector3, b: Vector3) => boolean;
  private comp = new Int32Array(0);

  /** Connected component id per node (after edges were removed), so start and goal are joined on one network. */
  private components() {
    this.comp = new Int32Array(this.pos.length).fill(-1);
    let id = 0;
    for (let i = 0; i < this.pos.length; i++) {
      if (this.comp[i] >= 0 || !this.adj[i].length) continue;
      const stack = [i]; this.comp[i] = id;
      while (stack.length) { const u = stack.pop()!; for (const { to } of this.adj[u]) if (this.comp[to] < 0) { this.comp[to] = id; stack.push(to); } }
      id++;
    }
  }

  /** Network nodes a walker at `p` can step onto directly (validated straight line), nearest first. */
  private entries(p: Vector3, component = -1, max = 16) {
    const c: [number, number][] = [];
    for (let i = 0; i < this.pos.length; i++) {
      if (!this.adj[i].length || (component >= 0 && this.comp[i] !== component)) continue;
      const q = this.pos[i]; c.push([Math.hypot(q.x - p.x, q.z - p.z) + Math.abs(q.y - p.y) * 2, i]);
    }
    c.sort((a, b) => a[0] - b[0]);
    const out: number[] = [];
    for (const [, i] of c.slice(0, max)) if (!this.clear || this.clear(p, this.pos[i])) out.push(i);
    return out;
  }

  /** Horizontal distance from (x, z) to the nearest remaining network edge. */
  edgeDistance(x: number, z: number) {
    let best = Infinity;
    for (let a = 0; a < this.adj.length; a++) for (const { to } of this.adj[a]) {
      if (to < a) continue;
      const p = this.pos[a], q = this.pos[to], dx = q.x - p.x, dz = q.z - p.z, L = dx * dx + dz * dz;
      const t = L ? Math.max(0, Math.min(1, ((x - p.x) * dx + (z - p.z) * dz) / L)) : 0;
      best = Math.min(best, Math.hypot(x - p.x - dx * t, z - p.z - dz * t));
    }
    return best;
  }

  /** Blockages to route around: points just ahead of where a walker got stuck. */
  readonly avoid: Vector3[] = [];

  path(from: Vector3, to: Vector3 | string): Vector3[] {
    const goal = typeof to === 'string' ? this.anchor(to) : to;
    if (!goal) return [];
    // Join both ends to the same connected network with links a walker can actually follow; otherwise no route.
    const s = this.entries(from)[0] ?? -1;
    if (s < 0) return [];
    const t = this.entries(goal, this.comp.length ? this.comp[s] : -1)[0] ?? -1;
    if (t < 0) return [];
    const n = this.pos.length, g = new Float64Array(n).fill(Infinity), prev = new Int32Array(n).fill(-1), closed = new Uint8Array(n);
    const heap: [number, number][] = [];
    const push = (f: number, i: number) => { heap.push([f, i]); let k = heap.length - 1; while (k > 0) { const p = (k - 1) >> 1; if (heap[p][0] <= heap[k][0]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; } };
    const pop = () => { const top = heap[0], last = heap.pop()!; if (heap.length) { heap[0] = last; let k = 0; for (;;) { const l = 2 * k + 1, r = l + 1; let m = k; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === k) break; [heap[m], heap[k]] = [heap[k], heap[m]]; k = m; } } return top; };
    const h = (i: number) => this.pos[i].distanceTo(this.pos[t]);
    g[s] = 0; push(h(s), s);
    while (heap.length) {
      const [, u] = pop();
      if (closed[u]) continue; closed[u] = 1;
      if (u === t) break;
      for (const { to: v, w } of this.adj[u]) {
        // Avoid points mark the blockage just ahead of where a walker got stuck (never the start/goal nodes).
        if (v !== t && v !== s && this.avoid.some(a => Math.hypot(this.pos[v].x - a.x, this.pos[v].z - a.z) < 6)) continue;
        const ng = g[u] + w;
        if (ng < g[v]) { g[v] = ng; prev[v] = u; push(ng + h(v), v); }
      }
    }
    if (!closed[t]) return [];
    const out: Vector3[] = [];
    for (let i = t; i >= 0; i = prev[i]) out.push(this.pos[i].clone());
    out.reverse();
    return [from.clone(), ...out, goal.clone()];
  }
}
