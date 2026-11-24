import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { OutdoorRoutes } from '../src/walk/route';
import { EDGE_LINE_INSET, PROP_RADIUS, TALL_KINDS, planHamasenStreetProps, streetPropKeepClear, type StreetProp } from '../src/walk/hamasen-street-props';
import type { CampusStructure, Point2 } from '../src/walk-types';

// P9 review fixes: sightlines to signs and landmark facades, parked vehicles outside the painted edge line,
// named street plates, and resident walkers off the road centre.
const read = <T>(path: string) => JSON.parse(readFileSync(path, 'utf8')) as T;
const structure = read<CampusStructure>('public/data/walkthrough/campus-structure.json');
const npcs = read<Parameters<typeof streetPropKeepClear>[0] & { ambient: { hamasen: { id: string; route: Point2[] }[] } }>('public/data/npcs.json');
const bus = read<{ stops: Parameters<typeof streetPropKeepClear>[1] }>('public/data/bus-routes.json');
const info = read<{ buildings: Record<string, { name: string; kind?: string; poi?: { position: Point2; approach: number[]; street: string } }> }>('public/data/campus-info.json').buildings;
const pois = Object.values(info).filter(b => b.poi);
const graph = new OutdoorRoutes(read('public/data/walkthrough/outdoor-graph.json'));
const { keep, paths } = streetPropKeepClear(npcs, bus.stops);
const views = pois.map(b => ({ x: b.poi!.position[0], z: b.poi!.position[1], vx: b.poi!.approach[0], vz: b.poi!.approach[2], street: b.kind === 'landmark' ? b.poi!.street : undefined }));
const plan = planHamasenStreetProps({ context: structure.context, keep, paths, pathDistance: (x, z) => graph.edgeDistance(x, z), views });
const roads = structure.context.roads.filter(r => r.district === 'hamasen' && !r.tunnel && !r.bridge && r.points.length > 1);
const carriageways = roads.filter(r => ['tertiary', 'secondary', 'primary', 'residential', 'living_street', 'unclassified', 'service'].includes(r.kind));
const tall = plan.props.filter(p => TALL_KINDS.has(p.kind));

const seg = (x: number, z: number, a: Point2, b: Point2) => {
  const dx = b[0] - a[0], dz = b[1] - a[1], l = dx * dx + dz * dz;
  const t = l ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / l)) : 0;
  return Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t);
};
const lineDistance = (x: number, z: number, pts: readonly Point2[]) => Math.min(...pts.slice(1).map((p, i) => seg(x, z, pts[i], p)));
/** Radius a tall prop reaches at sign height: crowns and parasol canopies, not just the trunk. */
const reach = (p: StreetProp) => p.kind === 'tree' ? 1.2 : p.kind === 'parasol' ? 1.3 : PROP_RADIUS[p.kind];
const where = (p: StreetProp) => `${p.kind} ${p.x.toFixed(1)},${p.z.toFixed(1)}`;

describe('哈瑪星 sightlines', () => {
  it('keeps the line from every card landing (and the camera behind it) to its subject free of tall props', () => {
    expect(pois).toHaveLength(22);
    for (const b of pois) {
      const s = b.poi!.position, [vx, , vz] = b.poi!.approach, l = Math.hypot(vx - s[0], vz - s[1]);
      const camera: Point2 = [vx + (vx - s[0]) / l * 5, vz + (vz - s[1]) / l * 5];
      for (const p of tall) expect(seg(p.x, p.z, s, camera) - reach(p), `${where(p)} hides ${b.name}`).toBeGreaterThan(.9);
    }
  });

  it('keeps the space in front of the 14 shop signs clear', () => {
    let shops = 0;
    for (const b of structure.context.background.filter(b => b.district === 'hamasen')) for (const shop of b.shopfronts ?? []) {
      shops++;
      const poly = b.polygon, a = poly[shop.edge], c = poly[(shop.edge + 1) % poly.length], len = Math.hypot(c[0] - a[0], c[1] - a[1]);
      const tx = (c[0] - a[0]) / len, tz = (c[1] - a[1]) / len, along = Math.min(len, Math.max(0, shop.along));
      const fx = a[0] + tx * along, fz = a[1] + tz * along;
      // Outward normal: towards the shop's own approach.
      let nx = tz, nz = -tx;
      if ((shop.approach[0] - fx) * nx + (shop.approach[1] - fz) * nz < 0) { nx = -nx; nz = -nz; }
      for (const p of tall) {
        const out = (p.x - fx) * nx + (p.z - fz) * nz, side = Math.abs((p.x - fx) * tx + (p.z - fz) * tz);
        // A 10 m deep box as wide as the sign: whoever stands across the street sees the name.
        expect(out > -.2 && out < 10 && side < shop.width / 2 + .3, `${where(p)} in front of ${shop.name}`).toBe(false);
      }
    }
    expect(shops).toBe(14);
  });

  it('keeps the near and far kerb in front of each landmark open, as seen from its street', () => {
    for (const b of pois.filter(b => b.kind === 'landmark')) {
      const [x, z] = b.poi!.position;
      let best: { d: number; p: Point2; width: number } | undefined;
      for (const r of carriageways.filter(r => r.name === b.poi!.street)) for (let i = 1; i < r.points.length; i++) {
        const a = r.points[i - 1], c = r.points[i], dx = c[0] - a[0], dz = c[1] - a[1], l = dx * dx + dz * dz;
        const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / l)), p: Point2 = [a[0] + dx * t, a[1] + dz * t], d = Math.hypot(p[0] - x, p[1] - z);
        if (!best || d < best.d) best = { d, p, width: r.width };
      }
      expect(best, b.name).toBeDefined();
      const ux = (best!.p[0] - x) / best!.d, uz = (best!.p[1] - z) / best!.d;
      const far: Point2 = [best!.p[0] + ux * (best!.width / 2 + 1), best!.p[1] + uz * (best!.width / 2 + 1)];
      // The central five metres either side of the line of sight, across both kerbs. Temple-plaza stalls are
      // placed by their own rule (clear of the hall front and of the card's line of sight, tested above).
      for (const p of tall) if (p.kind !== 'parasol') expect(seg(p.x, p.z, [x, z], far), `${where(p)} in front of ${b.name}`).toBeGreaterThan(5);
    }
  });
});

describe('哈瑪星 parked vehicles', () => {
  const corners = (p: StreetProp): Point2[] => {
    const [hl, hw] = p.kind === 'car' ? [2.1, .86] : [.86, .32];
    const cx = Math.cos(p.yaw), cz = -Math.sin(p.yaw);
    return [[1, 1], [1, -1], [-1, 1], [-1, -1]].map(([u, v]) => [p.x + cx * hl * u - cz * hw * v, p.z + cz * hl * u + cx * hw * v] as Point2);
  };
  it('stand wholly outside the painted edge lines, never in a traffic lane', () => {
    const vehicles = plan.props.filter(p => p.kind === 'scooter' || p.kind === 'car');
    expect(vehicles.filter(p => p.kind === 'scooter').length).toBeGreaterThan(600);
    for (const p of vehicles) for (const [x, z] of corners(p)) for (const r of carriageways) {
      // Inner edge of the painted line: the lane a car or bus drives in.
      const lane = r.width / 2 - r.width * (EDGE_LINE_INSET + 1.5 / 128);
      expect(lineDistance(x, z, r.points), `${where(p)} in the lane of ${r.name ?? r.id}`).toBeGreaterThan(lane - .02);
    }
  });
});

describe('哈瑪星 street-name plates', () => {
  it('name every signal plate after a street that meets it, with no blank plates', () => {
    const signals = plan.props.filter(p => p.kind === 'signal');
    expect(signals.length).toBeGreaterThan(10);
    const named = new Set(roads.map(r => r.name).filter(Boolean));
    for (const s of signals) {
      expect(s.label, where(s)).toBeTruthy();
      expect(named.has(s.label!), `${s.label} is a street in the district data`).toBe(true);
      const near = roads.filter(r => r.name === s.label).some(r => lineDistance(s.x, s.z, r.points) < 12);
      expect(near, `${s.label} meets the junction at ${where(s)}`).toBe(true);
    }
    expect(new Set(signals.map(s => s.label)).size).toBeGreaterThan(5);
  });
});

describe('哈瑪星 resident walkers', () => {
  it('walk by the kerb, not down the middle of the road', () => {
    const walkers = npcs.ambient.hamasen;
    expect(walkers).toHaveLength(6);
    for (const w of walkers) for (let i = 1; i < w.route.length; i++) {
      const a = w.route[i - 1], b = w.route[i];
      if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 2) continue; // a short step across a side-street mouth
      for (const t of [.25, .5, .75]) {
        const x = a[0] + (b[0] - a[0]) * t, z = a[1] + (b[1] - a[1]) * t;
        const lx = (b[0] - a[0]) / Math.hypot(b[0] - a[0], b[1] - a[1]), lz = (b[1] - a[1]) / Math.hypot(b[0] - a[0], b[1] - a[1]);
        for (const r of carriageways) for (let k = 1; k < r.points.length; k++) {
          // Only the street the leg runs along (crossing a side street's mouth is fine).
          const p = r.points[k - 1], q = r.points[k], sl = Math.hypot(q[0] - p[0], q[1] - p[1]);
          if (sl < 1e-6 || Math.abs(((q[0] - p[0]) * lx + (q[1] - p[1]) * lz) / sl) < .9) continue;
          const t = ((x - p[0]) * (q[0] - p[0]) + (z - p[1]) * (q[1] - p[1])) / (sl * sl);
          if (t < 0 || t > 1) continue;
          // Centre-lined roads (7 m and wider): beside the edge line; narrow lanes: off the crown.
          const clear = r.width >= 7 ? r.width / 2 - .75 : .7;
          expect(seg(x, z, p, q), `${w.id} leg ${i} along ${r.name ?? r.id}`).toBeGreaterThan(clear);
        }
      }
    }
  });
});
