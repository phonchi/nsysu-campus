import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { ContextBuilding, Point2 } from '../walk-types';
import { projectRoadGeometry } from '../world/road-surface';
import type { Terrain } from '../world/terrain';
import { isHamasenModelFootprint } from '../world/landmarks';

/** Exterior detail from the Hamasen ground photographs. The data footprint
 * provides the alignment. Architectural depths and heights are modelled. */
export function hamasenStationDetails(stations: readonly ContextBuilding[], terrain: Terrain) {
  const group = new T.Group();
  group.name = 'Hamasen station entrance details';
  group.userData.terrainSeated = true;
  const procedural = stations.filter(station =>
    (station.stationExit === 1 || station.stationExit === 2) && !isHamasenModelFootprint(station.id));
  if (!procedural.length) return group;
  const shell = new T.MeshStandardMaterial({ vertexColors: true, roughness: .85, side: T.DoubleSide });
  const glass = new T.MeshStandardMaterial({ vertexColors: true, roughness: .33, metalness: .16, side: T.DoubleSide });
  for (const station of procedural) {
    const face = frontage(station, terrain);
    if (!face) continue;
    const batch = stationBatch(face);
    if (station.stationExit === 1) buildExitOne(face, batch, terrain);
    else buildExitTwo(face, batch);
    for (const [parts, material] of [[batch.opaque, shell], [batch.glazed, glass]] as const) {
      if (!parts.length) continue;
      const model = mergeGeometries(parts);
      for (const part of parts) part.dispose();
      if (!model) continue;
      const mesh = new T.Mesh(model, material);
      mesh.name = `Hamasen Exit ${station.stationExit} ${parts === batch.glazed ? 'glazing' : 'structure'}`;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
  }
  return group;
}

type LocalPoint = [along: number, height: number, outward: number];

function frontage({ polygon, frontage, heightM }: ContextBuilding, terrain: Terrain) {
  if (frontage === undefined || polygon.length < 3) return;
  const a = polygon[frontage.edge], b = polygon[(frontage.edge + 1) % polygon.length];
  if (!a || !b) return;
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (length < 3.5) return;
  const tangent = new T.Vector3((b[0] - a[0]) / length, 0, (b[1] - a[1]) / length);
  const normal = new T.Vector3(-tangent.z, 0, tangent.x);
  const winding = polygon.reduce((area, p, i) => {
    const q = polygon[(i + 1) % polygon.length];
    return area + p[0] * q[1] - p[1] * q[0];
  }, 0);
  if (winding > 0) normal.negate();
  const center = new T.Vector3((a[0] + b[0]) / 2, 0, (a[1] + b[1]) / 2);
  const ground = Math.max(...polygon.map(([x, z]) => terrain.heightAt(x, z)));
  const edgeGround = terrain.heightAt(center.x + normal.x * .16, center.z + normal.z * .16);
  const curb = Math.max(ground, edgeGround), top = ground + (heightM ?? 4.4);
  center.y = curb;
  const at = ([along, height, outward]: LocalPoint) =>
    center.clone().addScaledVector(tangent, along).addScaledVector(normal, outward).add(new T.Vector3(0, height, 0));
  return { length, top: top - curb, fascia: Math.min(3.35, (top - curb) * .8), tangent, at };
}

type Frontage = NonNullable<ReturnType<typeof frontage>>;

function stationBatch(face: Frontage) {
  const opaque: T.BufferGeometry[] = [], glazed: T.BufferGeometry[] = [];
  const up = new T.Vector3(0, 1, 0);
  const append = (geometry: T.BufferGeometry, tone: string, tinted = false) => {
    const flat = geometry.index ? geometry.toNonIndexed() : geometry;
    if (flat !== geometry) geometry.dispose();
    for (const name of Object.keys(flat.attributes)) {
      if (name !== 'position' && name !== 'normal') flat.deleteAttribute(name);
    }
    const color = new T.Color(tone), count = flat.getAttribute('position').count;
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) colors.set([color.r, color.g, color.b], i * 3);
    flat.setAttribute('color', new T.BufferAttribute(colors, 3));
    flat.clearGroups();
    (tinted ? glazed : opaque).push(flat);
  };
  const panel = (along: number, y: number, depth: number, w: number, h: number, d: number, tone: string, tinted = false) => {
    if (w <= 0 || h <= 0 || d <= 0) return;
    const point = face.at([along, y, depth]);
    const geometry = new T.BoxGeometry(w, h, d);
    geometry.rotateY(-Math.atan2(face.tangent.z, face.tangent.x)).translate(point.x, point.y, point.z);
    append(geometry, tone, tinted);
  };
  const beam = (from: LocalPoint, to: LocalPoint, width: number, tone: string, radiusTop?: number) => {
    const a = face.at(from), b = face.at(to), axis = b.clone().sub(a), len = axis.length();
    if (len < .01) return;
    const geometry = radiusTop === undefined ? new T.BoxGeometry(width, len, width) :
      new T.CylinderGeometry(radiusTop, width, len, 10);
    geometry.applyQuaternion(new T.Quaternion().setFromUnitVectors(up, axis.normalize()));
    const midpoint = a.lerp(b, .5);
    append(geometry.translate(midpoint.x, midpoint.y, midpoint.z), tone);
  };
  const surface = (points: LocalPoint[], tone: string, tinted = false) => {
    const vertices = points.map(face.at);
    const triangles = vertices.length === 3 ? [0, 1, 2] : [0, 1, 2, 0, 2, 3];
    const geometry = new T.BufferGeometry();
    geometry.setAttribute('position', new T.Float32BufferAttribute(triangles.flatMap(i => vertices[i].toArray()), 3));
    geometry.computeVertexNormals();
    append(geometry, tone, tinted);
  };
  return { append, panel, beam, surface, opaque, glazed };
}

type Batch = ReturnType<typeof stationBatch>;

function buildExitOne(face: Frontage, { append, panel, beam, surface }: Batch, terrain: Terrain) {
  const { length, fascia, top, at } = face;
  const half = length * .48, centerBay = Math.min(half - .28, 2.45);
  const sill = Math.min(.26, fascia * .12);

  // Grey stone, a wide shadowed entrance and glazed wings beneath the orange fan.
  panel(0, (fascia + sill) / 2, .045, half * 2, fascia - sill, .08, '#a4a39b');
  panel(0, (fascia + sill) / 2, .11, centerBay * 2 - .30, fascia - sill - .10, .075, '#354449');
  panel(0, (fascia + sill) / 2, .155, centerBay * 2 - .54, fascia - sill - .20, .045, '#455b60', true);
  for (const side of [-1, 1]) {
    const width = Math.max(1.1, Math.min(3.4, half - centerBay - .28));
    const middle = side * (centerBay + width * .58);
    panel(middle, 1.46, .105, width, 2.37, .06, '#677372');
    panel(middle, 1.44, .148, width - .13, 2.23, .038, '#819295', true);
    panel(middle, 1.47, .179, .08, 2.31, .054, '#d0d0c7');
    panel(side * centerBay, (fascia + sill) / 2, .15, .19, fascia - sill, .25, '#c6c7bc');
    panel(side * centerBay * .48, (fascia + sill) / 2, .19, .068, fascia - sill - .09, .08, '#82908b');
  }
  panel(0, sill / 2, .10, half * 2, sill, .18, '#777a74');
  panel(0, fascia - .17, .15, centerBay * 2 + .32, .16, .20, '#d6d4c8');

  // Stone seams and high ventilation grilles remain visible above the shallow canopy.
  const high = top - fascia;
  if (high > .6) {
    const seams = Math.ceil(length / 1.42);
    for (let i = 1; i < seams; i++) {
      panel(-half + half * 2 * i / seams, fascia + high / 2, .046, .024, high - .15, .025, '#79817d');
    }
    for (const side of [-1, 1]) {
      const width = Math.min(2.9, half * .36), mid = side * (half - width * .61);
      panel(mid, top - high * .42, .072, width, high * .54, .10, '#636d6a');
      for (let i = 1; i <= 5; i++) panel(mid, top - high * (.69 - i * .09), .138, width - .05, .022, .030, '#8d9390');
    }
  }

  // A faceted fan hangs from the stone face. The central fascia is aligned to
  // the station board, and the outer bays widen at the photographed shoulders.
  const eaves = [
    { x: -half, depth: 1.32, rise: .02 },
    { x: -half * .68, depth: 2.68, rise: .17 },
    { x: -centerBay, depth: 2.20, rise: .29 },
    { x: centerBay, depth: 2.20, rise: .29 },
    { x: half * .68, depth: 2.47, rise: .23 },
    { x: half, depth: 1.55, rise: .09 },
  ].sort((a, b) => a.x - b.x);
  for (let i = 1; i < eaves.length; i++) {
    const a = eaves[i - 1], b = eaves[i];
    const rearA: LocalPoint = [a.x, fascia - .16, .02], rearB: LocalPoint = [b.x, fascia - .16, .02];
    const leadingA: LocalPoint = [a.x, fascia + a.rise, a.depth], leadingB: LocalPoint = [b.x, fascia + b.rise, b.depth];
    const drop = (p: LocalPoint): LocalPoint => [p[0], p[1] - .40, p[2]];
    surface([rearA, rearB, leadingB, leadingA], i % 2 ? '#bf7c60' : '#b97459');
    surface([drop(rearA), drop(leadingA), drop(leadingB), drop(rearB)], '#a85f45');
    surface([leadingA, leadingB, drop(leadingB), drop(leadingA)], '#ba7458');
    surface([rearA, leadingA, drop(leadingA), drop(rearA)], '#a4664d');
    beam([a.x, fascia - .52, .04], drop(leadingA), .09, '#924f37');
    if (i === eaves.length - 1) surface([rearB, drop(rearB), drop(leadingB), leadingB], '#a4664d');
  }

  for (const side of [-1, 1]) {
    const x = side * half * .70, depth = 1.80, cap = fascia - .14;
    panel(x, .11, depth, .59, .22, .59, '#93968f');
    beam([x, .19, depth], [x, .87, depth], .19, '#e0e0d5', .137);
    beam([x, .87, depth], [x, cap - .51, depth], .137, '#e0e0d5', .126);
    beam([x, cap - .51, depth], [x, cap, depth], .126, '#e0e0d5', .19);
  }

  // Speckled granite tread bands are seated on the terrain so the route and
  // its ground contact remain continuous in front of the closed entrance.
  const tread = (depth: number, width: number) => Array.from({ length: 13 }, (_, i) => {
    const angle = -Math.PI / 2 + Math.PI * i / 12;
    return at([Math.sin(angle) * width, 0, .25 + Math.cos(angle) * depth]);
  });
  const treads = [tread(3.18, half), tread(2.62, half * .94), tread(2.08, half * .87), tread(1.49, half * .79)];
  for (let j = 1; j < treads.length; j++) {
    const positions: number[] = [];
    const outer = treads[j - 1], inner = treads[j];
    for (let i = 1; i < outer.length; i++) {
      for (const p of [outer[i - 1], outer[i], inner[i], outer[i - 1], inner[i], inner[i - 1]]) positions.push(p.x, 0, p.z);
    }
    const flat = new T.BufferGeometry();
    flat.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
    const projected = projectRoadGeometry(flat, terrain, { offset: .009 + .003 * j });
    flat.dispose();
    append(projected, ['#8b8f85', '#a0a39a', '#b2b2a7'][j - 1]);
  }
}

function buildExitTwo(face: Frontage, { panel, beam, surface }: Batch) {
  const { length, fascia, top } = face;
  const half = length * .46, sill = .52, windowTop = fascia - .53;
  panel(0, sill / 2, .11, half * 2, sill, .20, '#939c9e');
  panel(0, (windowTop + sill) / 2, .077, half * 2, windowTop - sill, .11, '#6f8087');
  const bayWidth = half * 2 / 4;
  for (let bay = 0; bay < 4; bay++) {
    const x = -half + (bay + .5) * bayWidth;
    panel(x, (windowTop + sill) / 2, .155, bayWidth - .10, windowTop - sill - .10, .040, bay % 2 ? '#879da2' : '#93a9ad', true);
    panel(x, (windowTop + sill) / 2, .188, .055, windowTop - sill, .06, '#d0d6d4');
    panel(x, 1.34, .190, bayWidth, .065, .075, '#d0d6d4');
  }
  for (let i = 0; i <= 4; i++) panel(-half + i * bayWidth, (fascia + sill) / 2, .20, .13, fascia - sill, .17, '#dfe1dd');
  panel(0, fascia - .31, .112, half * 2, .36, .13, '#515f64');
  for (let i = 0; i < 6; i++) panel(0, fascia - .46 + i * .056, .196, half * 2 - .05, .023, .032, '#9ba5a5');
  panel(0, fascia - .12, .40, half * 2 + .19, .22, 1.24, '#cbd2d0');

  // The pale entry opening has its own gabled skylight and silver framing.
  const eave = top - .09, ridge = eave + 1.54, overhang = 1.015, rear = -4.65;
  const left: LocalPoint = [-half - .10, eave, overhang], center: LocalPoint = [0, ridge, overhang], right: LocalPoint = [half + .10, eave, overhang];
  const back = ([x, y]: LocalPoint): LocalPoint => [x, y, rear];
  for (const [side, tone] of [[left, '#a4b9bf'], [right, '#b5c7c9']] as const) {
    surface([side, center, back(center), back(side)], tone, true);
    beam(side, back(side), .115, '#c8d0d0');
  }
  beam(center, back(center), .105, '#ced5d3');
  const atDepth = ([x, y]: LocalPoint, depth: number): LocalPoint => [x, y, depth];
  for (const depth of [1.02, .29, -1.02, -2.27, -3.57, -4.63]) {
    beam(atDepth(left, depth), atDepth(center, depth), .072, '#e4e7e1');
    beam(atDepth(center, depth), atDepth(right, depth), .072, '#e4e7e1');
  }
  for (const sign of [-1, 1]) {
    const edge = sign < 0 ? left : right;
    const lower: LocalPoint = [sign * (half + .10), eave, overhang + .01];
    const middle: LocalPoint = [sign * half * .50, (eave + ridge) / 2, overhang + .01];
    const midpoint: LocalPoint = [middle[0], eave, overhang + .01];
    surface([lower, middle, midpoint], '#93a8ad', true);
    surface([[0, eave, overhang + .01], midpoint, middle, [0, ridge, overhang + .01]], '#aabcbe', true);
    beam(midpoint, middle, .084, '#dce1df');
    beam(edge, [0, eave, overhang], .105, '#dce1df');
    beam([sign * half, fascia - .04, overhang - .015], edge, .13, '#e3e6e1');
  }
  beam([0, eave, overhang + .01], [0, ridge, overhang + .01], .075, '#e3e6e1');
}
