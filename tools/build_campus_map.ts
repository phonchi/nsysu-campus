/** Build public/data/campus-map.json for the 2D campus map from the same world data the 3D walk uses.
 * Run: npm run map:build after changing the campus structure, base map, sea center, or landmark placements. */
import fs from 'node:fs';
import * as T from 'three';
import { buildingFrame } from '../src/walk-world';
import { WALK_BUILDING_IDS } from '../src/walk-nav';
import type { CampusStructure, WalkBuilding } from '../src/walk-types';

type P = [number, number];
const r1 = (v: number) => Math.round(v * 10) / 10;
const structure = JSON.parse(fs.readFileSync('public/data/walkthrough/campus-structure.json', 'utf8')) as CampusStructure;
const info = JSON.parse(fs.readFileSync('public/data/campus-info.json', 'utf8')) as { buildings: Record<string, { name: string; college?: string }> };
const { seaCenter } = JSON.parse(fs.readFileSync('public/data/sea.json', 'utf8')) as { seaCenter?: { id: string; name: string; footprint?: P[] } };
const mapPolygon = (polygon: P[]) => polygon.map(([x, z]): P => [r1(x), r1(z)]);
const placementsPath = 'public/models/landmarks/placements.json';
const landmarkPlacements = fs.existsSync(placementsPath) ? JSON.parse(fs.readFileSync(placementsPath, 'utf8')) as Record<string, { centroid: P; note?: string }> : {};

const buildings: { id: string; name: string; kind: string; walkable: boolean; polygon: P[]; holes?: P[][]; storeys?: number }[] = [];
for (const id of WALK_BUILDING_IDS) {
  const b = JSON.parse(fs.readFileSync(`public/data/walkthrough/${id}.json`, 'utf8')) as WalkBuilding;
  const ground = b.floors.find(f => f.level === 1) ?? b.floors[0];
  const m = buildingFrame(structure, id);
  const polygon = ground.outline.map(([x, z]) => { const v = new T.Vector3(x, 0, z).applyMatrix4(m); return [r1(v.x), r1(v.z)] as P; });
  buildings.push({ id, name: info.buildings[id]?.name ?? b.name, kind: 'teaching', walkable: true, polygon, storeys: b.floors.filter(f => f.level > 0 && f.level < 99).length });
}
const KIND: Record<string, string> = { AD: 'admin', IL: 'admin', ACTIVITY: 'life', BEACH: 'scenic', YH: 'life', SPORT: 'life', GALLERY: 'scenic', KINDER: 'life', STARTUP: 'life', CMSS: 'teaching', ME: 'teaching', MB: 'teaching', IR: 'teaching' };
for (const l of structure.context.landmarks)
  buildings.push({ id: l.id, name: info.buildings[l.id]?.name ?? l.name, kind: KIND[l.id] ?? 'teaching', walkable: false, polygon: mapPolygon(l.polygon), storeys: l.storeys });
const background: P[][] = [];
const backgroundHoles: Record<number, P[][]> = {};
for (const b of structure.context.background) {
  const polygon = mapPolygon(b.polygon);
  if (b.stationExit === 1 || b.stationExit === 2) {
    buildings.push({ id: `hamasen-exit-${b.stationExit}`, name: `哈瑪星站 ${b.stationExit} 號出口`, kind: 'life', walkable: false, polygon, holes: b.holes?.map(mapPolygon), storeys: b.storeys });
  } else if (/^(hamasen-)?osm-435657348$/.test(b.id)) {
    buildings.push({ id: 'hamasen-rail-park', name: '哈瑪星鐵道園區前場', kind: 'scenic', walkable: false, polygon, holes: b.holes?.map(mapPolygon) });
  } else {
    if (b.holes?.length) backgroundHoles[background.length] = b.holes.map(mapPolygon);
    background.push(polygon);
  }
}
if (seaCenter?.footprint) {
  buildings.push({ id: seaCenter.id, name: seaCenter.name, kind: 'scenic', walkable: false, polygon: mapPolygon(seaCenter.footprint) });
}
const roads = structure.context.roads.map(r => ({ kind: r.kind, width: r.width, points: r.points.map(([x, z]) => [r1(x), r1(z)] as P) }));
const water = structure.context.water.map(w => ({ kind: w.kind, points: w.points.map(([x, z]) => [r1(x), r1(z)] as P) }));
const sport = structure.context.sport.map(s => ({ kind: s.kind, polygon: s.polygon.map(([x, z]) => [r1(x), r1(z)] as P) }));
const railways = structure.context.hamasen?.rails?.map(r => ({ kind: r.kind, points: mapPolygon(r.points) })) ?? [];
const basePath = 'public/data/campus-map-base.json';
const base = fs.existsSync(basePath) ? JSON.parse(fs.readFileSync(basePath, 'utf8')) as { url: string; bounds: [number, number, number, number] } : undefined;
const out = { generatedBy: 'tools/build_campus_map.ts', base, frame: 'world metres, x east, z south (north = -z)', spawn: [-69, 119], buildings, background, backgroundHoles, roads, railways, water, sport, landmarks: landmarkPlacements };
fs.writeFileSync('public/data/campus-map.json', JSON.stringify(out) + '\n');
console.log(JSON.stringify({ buildings: buildings.length, background: background.length, roads: roads.length, water: water.length, sport: sport.length, landmarks: Object.keys(landmarkPlacements).length, bytes: fs.statSync('public/data/campus-map.json').size }));
