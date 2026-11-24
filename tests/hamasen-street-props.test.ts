import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { OutdoorRoutes } from '../src/walk/route';
import { PROP_RADIUS, planHamasenStreetProps, streetPropKeepClear, type StreetPropInput, type StreetPropKind } from '../src/walk/hamasen-street-props';
import { PROP_TIERS, STREET_TREE_DENSITY, STREET_TREE_FAMILIES, streetKits } from '../src/walk/hamasen-street-details';
import { treeGeometry } from '../src/render/foliage';
import type { CampusStructure, Point2 } from '../src/walk-types';

const read = <T>(path: string) => JSON.parse(readFileSync(path, 'utf8')) as T;
const structure = read<CampusStructure>('public/data/walkthrough/campus-structure.json');
const npcs = read<Parameters<typeof streetPropKeepClear>[0]>('public/data/npcs.json');
const bus = read<{ stops: Parameters<typeof streetPropKeepClear>[1]; routes: { legs: { path: number[][] }[] }[] }>('public/data/bus-routes.json');
const busLegs = bus.routes.flatMap(r => r.legs.map(l => l.path.map(q => [q[0], q[2]] as Point2))).filter(l => l.some(p => p[0] > 250));
const { keep, paths } = streetPropKeepClear(npcs, bus.stops);
// Same inputs as the runtime: the walking graph keeps shop and landmark approaches clear.
const walkingGraph = new OutdoorRoutes(read('public/data/walkthrough/outdoor-graph.json'));
const info = read<{ buildings: Record<string, { kind?: string; poi?: { position: Point2; approach: number[]; street: string } }> }>('public/data/campus-info.json').buildings;
const views = Object.values(info).flatMap(b => b.poi ? [{ x: b.poi.position[0], z: b.poi.position[1], vx: b.poi.approach[0], vz: b.poi.approach[2], street: b.kind === 'landmark' ? b.poi.street : undefined }] : []);
const input: StreetPropInput = { context: structure.context, keep, paths, pathDistance: (x, z) => walkingGraph.edgeDistance(x, z), views };
const plan = planHamasenStreetProps(input);
const district = structure.context.hamasen!.polygon;
const buildings = structure.context.background.filter(b => b.district === 'hamasen');

const seg = (x: number, z: number, a: Point2, b: Point2) => {
  const dx = b[0] - a[0], dz = b[1] - a[1], l = dx * dx + dz * dz;
  const t = l ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / l)) : 0;
  return Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t);
};
const inside = (x: number, z: number, poly: readonly Point2[]) => {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c;
  }
  return c;
};
const ringDistance = (x: number, z: number, poly: readonly Point2[]) => Math.min(...poly.map((p, i) => seg(x, z, p, poly[(i + 1) % poly.length])));
const lineDistance = (x: number, z: number, pts: readonly Point2[]) => Math.min(...pts.slice(1).map((p, i) => seg(x, z, pts[i], p)));

describe('哈瑪星 street furniture plan', () => {
  it('is deterministic and covers every requested kind', () => {
    const again = planHamasenStreetProps(input);
    expect(again.props).toEqual(plan.props);
    expect(again.wires).toEqual(plan.wires);
    for (const kind of ['scooter', 'car', 'pole', 'lamp', 'signal', 'tree', 'planter', 'parasol', 'box'] as StreetPropKind[])
      expect(plan.stats[kind] ?? 0, kind).toBeGreaterThan(0);
    expect(plan.wires.length).toBeGreaterThan(20);
  });

  it('keeps every prop inside the district and out of building footprints', () => {
    for (const p of plan.props) {
      expect(inside(p.x, p.z, district), `${p.kind} ${p.x},${p.z}`).toBe(true);
      for (const b of buildings) {
        if (Math.abs(b.polygon[0][0] - p.x) > 80 || Math.abs(b.polygon[0][1] - p.z) > 80) continue;
        expect(inside(p.x, p.z, b.polygon), `${p.kind} in ${b.id}`).toBe(false);
        expect(ringDistance(p.x, p.z, b.polygon), `${p.kind} at ${b.id}`).toBeGreaterThan(PROP_RADIUS[p.kind]);
      }
    }
  });

  it('stays off lane centres, footways, shop doors, residents and bus stops', () => {
    const carriage = structure.context.roads.filter(r => r.district === 'hamasen' && !r.tunnel && !r.bridge && ['tertiary', 'residential', 'living_street', 'service'].includes(r.kind));
    const foot = structure.context.roads.filter(r => r.district === 'hamasen' && !r.tunnel && !r.bridge && ['footway', 'steps', 'path', 'cycleway'].includes(r.kind));
    const shops = buildings.flatMap(b => b.shopfronts ?? []);
    const residents = (npcs?.npcs ?? []).flatMap(n => Object.values(n.schedule ?? {}).flatMap(s => Array.isArray(s?.at) ? [s.at as Point2] : []));
    const stops = (bus.stops ?? []).flatMap(s => [s.sign, s.boardingPoint, ...s.alightingPoints]);
    for (const p of plan.props) {
      const r = PROP_RADIUS[p.kind], where = `${p.kind} ${p.x.toFixed(1)},${p.z.toFixed(1)}`;
      for (const road of carriage) expect(lineDistance(p.x, p.z, road.points), `${where} on ${road.name ?? road.id}`).toBeGreaterThan(r + .9);
      for (const road of foot) expect(lineDistance(p.x, p.z, road.points) - road.width / 2, `${where} on footway ${road.id}`).toBeGreaterThan(r + .5);
      for (const shop of shops) expect(Math.hypot(p.x - shop.approach[0], p.z - shop.approach[1]), `${where} at ${shop.name}`).toBeGreaterThan(2);
      for (const at of residents) expect(Math.hypot(p.x - at[0], p.z - at[1]), `${where} at resident`).toBeGreaterThan(2);
      for (const at of stops) expect(Math.hypot(p.x - at[0], p.z - at[2]), `${where} at bus stop`).toBeGreaterThan(2.5);
      // Kerbside trunks and poles stand at arm's length from a walker; bulkier props keep a metre clear.
      if (!(p.kind === 'box' && (p.sy ?? 1) < .1)) for (const route of paths) expect(lineDistance(p.x, p.z, route), `${where} on walker route`).toBeGreaterThan(r + (['pole', 'lamp', 'tree'].includes(p.kind) ? .4 : 1));
      // Parked vehicles reach up to 0.9 m from their centre; a bus is 2.5 m wide.
      for (const leg of busLegs) expect(lineDistance(p.x, p.z, leg) - Math.max(r, p.kind === 'scooter' || p.kind === 'car' ? .9 : 0), `${where} on bus path`).toBeGreaterThan(1.25 + .3);
    }
  });

  it('leaves the outdoor walking graph clear', () => {
    const graph = new OutdoorRoutes(read('public/data/walkthrough/outdoor-graph.json'));
    for (const p of plan.props) {
      if (p.kind === 'box' && (p.sy ?? 1) < .1) continue; // flush tree pits and table tops are under foot or knee height
      expect(graph.edgeDistance(p.x, p.z) - PROP_RADIUS[p.kind], `${p.kind} ${p.x.toFixed(1)},${p.z.toFixed(1)}`).toBeGreaterThan(.4);
    }
  });

  it('drops props that a newly added building covers, and leaves the rest alone', () => {
    const victim = plan.props.find(p => p.kind === 'scooter')!;
    const block: Point2[] = [[victim.x - 3, victim.z - 3], [victim.x + 3, victim.z - 3], [victim.x + 3, victim.z + 3], [victim.x - 3, victim.z + 3]];
    const edited = planHamasenStreetProps({ ...input, context: { ...structure.context, background: [...structure.context.background, { id: 'test-new-house', name: null, polygon: block, storeys: 3, district: 'hamasen' }] } });
    for (const p of edited.props) expect(inside(p.x, p.z, block) || ringDistance(p.x, p.z, block) < PROP_RADIUS[p.kind], `${p.kind} under new building`).toBe(false);
    const far = (p: { x: number; z: number }) => Math.hypot(p.x - victim.x, p.z - victim.z) > 40;
    expect(edited.props.filter(far).length).toBe(plan.props.filter(far).length);
  });

  it('fits the tier C triangle and draw-call budget anywhere in the district', () => {
    const kits = streetKits();
    const tris = Object.fromEntries(Object.entries(kits).map(([k, g]) => [k, g.getAttribute('position').count / 3])) as Record<StreetPropKind, number>;
    for (const [kind, n] of Object.entries(tris)) expect(n, kind).toBeLessThanOrEqual(kind === 'car' || kind === 'scooter' || kind === 'signal' ? 120 : 60);
    // Street trees use the campus leaf-card crowns (largest family counted for every tree); plates and lamp lens/pool add a few.
    tris.tree = Math.max(...STREET_TREE_FAMILIES.map(([f]) => { const g = treeGeometry(f, STREET_TREE_DENSITY); const n = g.index!.count / 3; g.dispose(); return n; }));
    expect(tris.tree).toBeLessThanOrEqual(180);
    tris.signal += 4; tris.lamp += 2 + 16;
    const worst = (tier: 'A' | 'C') => {
      let best = 0;
      for (let x = 260; x < 1000; x += 10) for (let z = 150; z < 745; z += 10) {
        if (!inside(x, z, district)) continue;
        let t = 0;
        for (const p of plan.props) {
          const [radius, share] = PROP_TIERS[tier][p.kind];
          if (p.rank < share && (p.x - x) ** 2 + (p.z - z) ** 2 < radius * radius) t += tris[p.kind];
        }
        best = Math.max(best, t);
      }
      return best;
    };
    expect(worst('C')).toBeLessThanOrEqual(25000);
    expect(worst('A')).toBeLessThanOrEqual(40000);
    // One instanced draw per kind (two tree families), the street-name plates, lamp lenses and light pools, plus the wire lines.
    const families = new Set(STREET_TREE_FAMILIES.map(([f]) => f)).size;
    expect(Object.keys(kits).length - 1 + families + 3 + 1).toBeLessThanOrEqual(15);
  });
});
