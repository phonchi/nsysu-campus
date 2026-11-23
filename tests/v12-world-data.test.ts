/** v12.1 資料面（WP-D2）：sea.json、bus-routes.json、sports.json、interiors/fitness.json 與 npcs.json 新增內容的形狀。
 * 用 runtime 自己的函式（inPolygon、OutdoorRoutes、validateEvents）再確認一次，行為測試屬於 Astra。
 * 詳細規則在 tools/verify_v12_world.py（build 會跑）與 tests/verify_v12_world_test.py。 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { runInNewContext } from 'node:vm';
import { Vector3 } from 'three';
import { OutdoorRoutes } from '../src/walk/route';
import { PLAY_BOUNDS, inPolygon } from '../src/world/terrain';
import { validateEvents, type CampusEventDefinition } from '../src/story/campus-events';
// The public snapshot ships without data/sources (official PDFs stay in the development repo); there only the path format is checked.
const HAS_SOURCES = fs.existsSync('data/sources');

type P2 = [number, number];
type P3 = [number, number, number];
// 資料檔由 tools/apply_v12_*.py 產生；這裡只檢查形狀，所以用寬鬆的型別。
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
const read = (name: string): Json => JSON.parse(fs.readFileSync(`public/data/${name}`, 'utf8'));
const sea = read('sea.json'), bus = read('bus-routes.json'), sports = read('sports.json'), fitness = read('interiors/fitness.json');
const npcs = read('npcs.json'), zones = read('story-zones.json'), graph = read('walkthrough/outdoor-graph.json'), registry = read('v12-sources.json');
const inBounds = (x: number, z: number) => x >= PLAY_BOUNDS[0] && x <= PLAY_BOUNDS[2] && z >= PLAY_BOUNDS[1] && z <= PLAY_BOUNDS[3];
const approved = new Set<string>(registry.sources.filter((s: Json) => s.url).map((s: Json) => s.url));
const sourceIds = new Set<string>(registry.sources.map((s: Json) => s.id));

// Verbatim loader from v12/astra 9c7850c. No runtime src edits or external
// checkout dependency: execute its parser against the actual generated data.
const loaderSource = fs.readFileSync('tests/fixtures/v12-data-9c7850c.ts.txt', 'utf8');
const parseV12 = runInNewContext(stripTypeScriptTypes(loaderSource).replace(/^export /gm, '') + '\nparseV12;');
it('9c7850c loader retains every facility, portal, water route and interior scene', () => {
  const s = parseV12('sea', sea), b = parseV12('bus', bus), p = parseV12('sports', sports), f = parseV12('fitness', fitness);
  expect(s.waterBodies).toHaveLength(3); expect(s.routes).toHaveLength(2);
  expect(s.buoys).toHaveLength(sea.buoys.length); expect(s.viewingPoint).toEqual(sea.sailingViewPoint.position);
  expect(b.routes).toHaveLength(2); expect(b.stops).toHaveLength(16);
  expect(p.facilities).toHaveLength(17); expect(p.courses).toHaveLength(2); expect(p.portals).toHaveLength(1);
  expect(p.equipment).toHaveLength(6); expect(f.scenes).toHaveLength(1);
  expect(f.scenes[0].id).toBe(p.portals[0].interiorSceneId);
  expect(f.scenes[0].floorY).toBe(p.portals[0].interiorSpawn[1]);
  const ids = [...p.equipment, ...f.scenes.flatMap((x: Json) => x.equipment)].map((e: Json) => e.id);
  expect(new Set(ids).size).toBe(ids.length);
});

describe('v12.1 來源', () => {
  it('登錄 S1–S14，資料裡的 sources 與 sourceIds 都在登錄內', () => {
    expect([...sourceIds].sort()).toEqual(Array.from({ length: 14 }, (_, i) => `S${i + 1}`).sort());
    const visit = (node: Json, where: string) => {
      if (Array.isArray(node)) { node.forEach((v, i) => visit(v, `${where}[${i}]`)); return; }
      if (!node || typeof node !== 'object') return;
      for (const url of node.sources ?? []) expect(approved.has(url), `${where}: ${url}`).toBe(true);
      for (const id of node.sourceIds ?? []) expect(sourceIds.has(id), `${where}: ${id}`).toBe(true);
      for (const file of node.sourceFiles ?? []) { expect(file, where).toMatch(/^data\/sources\//); if (HAS_SOURCES) expect(fs.existsSync(file), `${where}: ${file}`).toBe(true); }
      for (const [k, v] of Object.entries(node)) visit(v, `${where}.${k}`);
    };
    visit(sea, 'sea'); visit(bus, 'bus'); visit(sports, 'sports'); visit(fitness, 'fitness');
  });
});

describe('sea.json', () => {
  const swim = sea.waterBodies.find((b: Json) => b.id === 'sea-swim');
  it('有游泳區與兩座泳池，泳池水面比池邊低 0.15 m', () => {
    expect(sea.waterBodies.map((b: Json) => b.id).sort()).toEqual(['pool-main', 'pool-small', 'sea-swim']);
    for (const b of sea.waterBodies) {
      expect(b.polygon.length, b.id).toBeGreaterThanOrEqual(4);
      for (const [x, z] of b.polygon as P2[]) expect(inBounds(x, z), `${b.id} ${x},${z}`).toBe(true);
      if (b.kind === 'pool') expect(b.surfaceY, b.id).toBeCloseTo(b.deckY - 0.15, 6);
      expect(b.entryPoints.length, b.id).toBeGreaterThan(0);
    }
    expect(sea.wave.algorithm).toBe('daily-wave-v1');
  });
  it('入水點在岸上，浮球在游泳區邊界上', () => {
    for (const p of swim.entryPoints as P3[]) expect(inPolygon([p[0], p[2]], swim.polygon), `${p}`).toBe(false);
    expect(sea.buoys.length).toBeGreaterThanOrEqual(8);
  });
  it('SUP 與獨木舟各一條，航點在 corridor 內、在游泳區外', () => {
    expect(sea.waterRoutes.map((r: Json) => r.craft).sort()).toEqual(['kayak', 'sup']);
    for (const r of sea.waterRoutes) for (const p of r.waypoints as P2[]) {
      expect(inPolygon(p, r.corridor), `${r.id} ${p}`).toBe(true);
      expect(inPolygon(p, swim.polygon), `${r.id} ${p}`).toBe(false);
    }
  });
  it('帆船賽 8 艘、兩隊各 4 艘，航線在游泳區外側，標明情境重現', () => {
    const boats = sea.sailingShow.boats as { id: string; team: string; path: P3[]; startProgress: number }[];
    expect(boats).toHaveLength(8);
    expect(boats.filter(b => b.team === 'nsysu')).toHaveLength(4);
    expect(boats.filter(b => b.team === 'osaka')).toHaveLength(4);
    expect(new Set(boats.map(b => b.id)).size).toBe(8);
    for (const b of boats) {
      expect(b.startProgress).toBeGreaterThanOrEqual(0); expect(b.startProgress).toBeLessThan(1);
      for (const [x, , z] of b.path) { expect(inBounds(x, z), `${b.id}`).toBe(true); expect(inPolygon([x, z], swim.polygon), `${b.id} ${x},${z}`).toBe(false); }
    }
    expect(`${sea.sailingShow.title}${sea.sailingShow.label}`).toContain('情境重現');
    expect(zones.zones[sea.sailingShow.viewingAnchorId]).toBeTruthy();
    expect(sea.seaCenter.basis).toBe('schematic');
  });
});

describe('bus-routes.json', () => {
  const stops = new Map<string, Json>(bus.stops.map((s: Json) => [s.id, s]));
  const expected: Record<string, string[]> = {
    'campus-bus': ['gate', 'admin', 'dorm-h', 'activity', 'wuling', 'liberal-arts', 'wuling', 'activity', 'dorm-h', 'gate', 'hamasen-campus-stop'],
    'orange-1-ext': ['gate', 'admin', 'dorm-h', 'activity', 'wuling', 'liberal-arts', 'marine-sci', 'marine-eng', 'dorm-h', 'activity', 'admin', 'gate', 'hamasen-orange-stop'],
  };
  const edges = new Map<string, string>();
  (graph.edges as [number, number, number][]).forEach(([a, b], i) => { const k = `${Math.min(a, b)}-${Math.max(a, b)}`; if (!edges.has(k)) edges.set(k, graph.edgeKind[i]); });
  const drivable = ['tertiary', 'residential', 'unclassified', 'living_street', 'service'];

  it('兩條線的站序與 spec 一致', () => {
    expect(bus.routes.map((r: Json) => r.id).sort()).toEqual(['campus-bus', 'orange-1-ext']);
    for (const r of bus.routes) expect(r.stopOccurrences.map((o: Json) => stops.get(o.stopId)?.group), r.id).toEqual(expected[r.id]);
  });
  it('每段路徑連續、在界內，sourceEdgeIds 是 graph 上相連的可行車邊', () => {
    for (const r of bus.routes) {
      let end: P3 | undefined, last: string | undefined;
      for (const [k, leg] of (r.legs as Json[]).entries()) {
        const departure = (leg.departurePath ?? leg.path) as P3[];
        if (end) expect(Math.hypot(end[0] - departure[0][0], end[2] - departure[0][2]), `${r.id}#${k} 起點`).toBeLessThan(0.05);
        end = leg.path.at(-1);
        if (leg.departurePath) expect(leg.osmAlignment.path.some(([x, z]: P2) => !inBounds(x, z))).toBe(true);
        const samples = leg.departurePath ? [[departure, leg.departureSourceEdgeIds], [leg.path, leg.sourceEdgeIds]] : [[leg.path, leg.sourceEdgeIds]];
        for (const [i, [path, trace]] of samples.entries()) {
          if (i > 0) last = undefined;
          expect(path.length, `${r.id}#${k}`).toBeGreaterThanOrEqual(2);
          for (const [x, y, z] of path as P3[]) { expect(Number.isFinite(y)).toBe(true); expect(inBounds(x, z), `${r.id}#${k} ${x},${z}`).toBe(true); }
          expect(trace.length, `${r.id}#${k}`).toBeGreaterThan(0);
          for (const e of trace as string[]) {
            expect(drivable, `${r.id}#${k} ${e}`).toContain(edges.get(e));
            if (last) expect(e.split('-').some(n => last!.split('-').includes(n)), `${r.id}#${k} ${last} → ${e}`).toBe(true);
            last = e;
          }
        }
      }
      expect(r.graphRevision).toBe(graph.v12.revision);
      expect(r.schedule).toMatchObject({ kind: 'schematic', gameSecondsPerRealSecond: 5, minDwellRealSeconds: 6 });
      expect(r.vehicle.minTurnRadiusM).toBeGreaterThanOrEqual(9);
    }
  });
  it('文學院迴轉圈半徑至少 9 m，新增的節點接在步行路網上', () => {
    expect(bus.forecourt.turnRadiusM).toBeGreaterThanOrEqual(9);
    expect(bus.graphRevision).toBe(graph.v12.revision);
    const routes = new OutdoorRoutes(graph), berth = graph.nodes[bus.forecourt.berthNode].p as P3;
    const path = routes.path(routes.anchor('LA')!, new Vector3(berth[0], berth[1], berth[2]));
    expect(path.length).toBeGreaterThan(2);
  });
  it('每個站有站牌、停靠位、上下車點與步行接點', () => {
    for (const s of bus.stops) {
      for (const p of [s.sign, s.berth.position, s.boardingPoint, ...s.alightingPoints] as P3[]) expect(inBounds(p[0], p[2]), s.id).toBe(true);
      expect(s.pedestrianAnchorId, s.id).toMatch(/^node:\d+$/);
      expect(Number(s.pedestrianAnchorId.slice(5))).toBeLessThan(graph.nodes.length);
    }
  });
});

describe('sports.json 與 interiors/fitness.json', () => {
  it('場地齊全，球場數與描圖一致', () => {
    const venues = new Map<string, Json>(sports.facilities.map((v: Json) => [v.id, v]));
    for (const id of ['track', 'infield', 'basketball-w', 'basketball-e', 'volleyball-n', 'volleyball-s', 'tennis-outdoor', 'tennis-covered', 'baseball', 'rink', 'grandstand', 'jump-runway', 'pool-building']) expect(venues.has(id), id).toBe(true);
    expect(venues.get('basketball-w').courts).toHaveLength(4); expect(venues.get('basketball-e').courts).toHaveLength(3);
    expect(venues.get('volleyball-n').courts.length + venues.get('volleyball-s').courts.length).toBe(4);
    for (const v of sports.facilities) for (const [x, z] of v.polygon as P2[]) expect(inBounds(x, z), v.id).toBe(true);
    expect(sports.provenance.imagery).toContain('內政部國土測繪中心');
  });
  it('跑圈 4 個 gate 依序回到起點，一圈約 399 m；泳池 50 m 來回', () => {
    const run = sports.courses.find((c: Json) => c.mode === 'run'), swim = sports.courses.find((c: Json) => c.mode === 'swim');
    expect(run.gates).toHaveLength(4);
    expect(run.requiredGateSequence).toHaveLength(5); expect(run.requiredGateSequence[0]).toBe(run.requiredGateSequence[4]);
    expect(Math.abs(run.lapLengthM - 399)).toBeLessThanOrEqual(3);
    for (const c of [run, swim]) for (const g of c.gates) {
      expect(Math.hypot(g.direction[0], g.direction[1]), `${c.id}/${g.id}`).toBeCloseTo(1, 3);
      expect(inPolygon([(g.a[0] + g.b[0]) / 2, (g.a[2] + g.b[2]) / 2], c.corridor), `${c.id}/${g.id}`).toBe(true);
    }
    expect(swim.waterId).toBe('pool-main'); expect(swim.requiredGateSequence).toEqual(['start', 'turn', 'finish']);
    const pool = sea.waterBodies.find((b: Json) => b.id === 'pool-main').polygon as P2[];
    for (const p of swim.corridor as P2[]) expect(pool.some(q => Math.abs(q[0] - p[0]) < 0.01) || inPolygon(p, pool), `${p}`).toBe(true);
  });
  it('體適能入口接到示意室內，器材只有跑步機與健身車且都在房間裡', () => {
    expect(sports.portals[0].interiorSceneId).toBe(fitness.id);
    const [ox, oy, oz] = fitness.origin as P3, room = fitness.room.polygon as P2[];
    const inside = (p: P3) => inPolygon([p[0] - ox, p[2] - oz], room) && Math.abs(p[1] - oy) < 0.01;
    expect(inside(sports.portals[0].interiorSpawn)).toBe(true);
    expect([...new Set(sports.equipment.map((e: Json) => e.kind))].sort()).toEqual(['stationary-bike', 'treadmill']);
    for (const e of sports.equipment) for (const p of [e.position, e.approach, ...e.exitPoints] as P3[]) expect(inside(p), e.id).toBe(true);
    expect(sports.fitnessCenters.find((c: Json) => c.id === 'fitness-2').name).toContain('示意');
  });
});

describe('npcs.json 的 v12.1 內容', () => {
  const events = npcs.events as CampusEventDefinition[];
  it('事件定義通過 validateEvents', () => { expect(validateEvents(events)).toEqual([]); });
  it('衝浪課用帶 presentation:surf 的 rhythm 步驟，帆船觀看事件指到 sailingShow', () => {
    const surf = events.find(e => e.id === 'ev-surf-class')!, rhythm = surf.activity!.steps.filter(s => s.kind === 'rhythm') as Json[];
    expect(rhythm.length).toBeGreaterThan(0);
    for (const s of rhythm) expect(s.presentation).toBe('surf');
    const regatta = events.find(e => e.id === 'ev-sail-regatta') as Json;
    expect(regatta.show).toBe(sea.sailingShow.id); expect(`${regatta.banner}${regatta.title}`).toContain('情境重現');
    for (const e of [surf, regatta as CampusEventDefinition]) expect(zones.zones[e.anchor.slice(5)], e.id).toBeTruthy();
  });
  it('新 NPC 都在，台詞每句不超過 28 字且沒有半形標點', () => {
    const ids = ['lifeguard-sea', 'marine-clerk', 'surf-coach', 'sail-student', 'bus-driver-campus', 'bus-driver-orange', 'runner-1', 'swimmer-1', 'swimmer-2', 'gym-1', 'gym-2'];
    for (const id of ids) {
      const npc = npcs.npcs.find((n: Json) => n.id === id);
      expect(npc, id).toBeTruthy();
      for (const node of Object.values(npcs.trees[npc.talk].nodes) as Json[]) for (const line of node.lines) {
        expect([...line.text].length, line.text).toBeLessThanOrEqual(28);
        expect(line.text, line.text).not.toMatch(/[,.!?:;()]/);
      }
    }
    for (const r of bus.routes) expect(ids).toContain(r.announcements.speaker);
  });
});
