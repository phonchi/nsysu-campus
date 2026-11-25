import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import survey from '../../public/data/terrain/hamasen-rail-backdrop.json';
import type { CampusStructure, Point2 } from '../walk-types';
import { inPolygon, type Terrain } from '../world/terrain';

type Context = CampusStructure['context'];
type HeightAt = (x: number, z: number) => number | null;
type RailLine = { id?: string; kind?: string; points: number[][] };

const park = survey.greens as Point2[][];
const { origin, cols, rows, cell, heights } = survey.terrain;
const MAX_SLEEPER_X = 1090;

function surveyedHeight(x: number, z: number) {
 const fx = (x - origin[0]) / cell, fz = (z - origin[1]) / cell;
 if (fx < 0 || fz < 0 || fx > cols - 1 || fz > rows - 1) return null;
 const i = Math.min(cols - 2, Math.floor(fx)), j = Math.min(rows - 2, Math.floor(fz)), u = fx - i, v = fz - j;
 const a = heights[j * cols + i], b = heights[j * cols + i + 1], c = heights[(j + 1) * cols + i], d = heights[(j + 1) * cols + i + 1];
 if (u + v <= 1) return a === null || b === null || c === null ? null : a * (1 - u - v) + b * u + c * v;
 return b === null || c === null || d === null ? null : b * (1 - v) + c * (1 - u) + d * (u + v - 1);
}

function meshFrom(positions: number[], indices?: number[], colours?: number[]) {
 const geometry = new T.BufferGeometry();
 geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
 if (indices) geometry.setIndex(indices);
 geometry.computeVertexNormals();
 if (colours) geometry.setAttribute('color', new T.Float32BufferAttribute(colours, 3));
 return geometry;
}

function landNoise(x: number, z: number) {
 const a = Math.sin(x * 0.071 + z * 0.053), b = Math.cos(x * 0.137 - z * 0.113);
 return 0.5 + 0.28 * a + 0.22 * b;
}

function addSurveyLand(group: T.Group, terrain: Terrain) {
 // Match LAWN (render/ground.ts) and uHamasenConcrete (world/hamasen-art.ts) so
 // the x = 1000..1040 boundary transitions smoothly without a dark olive step.
 const grassDark = new T.Color('#6db04d'), grassBase = new T.Color('#84c65c'), grassLight = new T.Color('#a4d36c');
 const urban = new T.Color('#a8a7a1'), scratch = new T.Color();
 // Extend one column west to x = 1003.6 so it slides cleanly under DEM terrain far
 // (which stops at x = 1004) and closes the 4 m sea gap at x = 1004..1008.
 const westSeamX = origin[0] - 4.4;
 const totalCols = cols + 1;
 const valid: boolean[] = [];
 const vertices: number[] = [], indices: number[] = [], colours: number[] = [];

 const colourAt = (x: number, z: number, col: number) => {
  const n = landNoise(x, z);
  const g = scratch.copy(n < 0.5 ? grassDark : grassBase).lerp(n < 0.5 ? grassBase : grassLight, n < 0.5 ? n * 2 : (n - 0.5) * 2);
  if (park.some(p => inPolygon([x, z], p))) return g;
  const jitter = Math.sin(z * 0.045) * 8 + Math.cos(z * 0.11) * 4;
  const blend = col <= 0 ? 0 : T.MathUtils.smoothstep(x + jitter, origin[0], origin[0] + cell * 2);
  const wear = 0.96 + 0.06 * n;
  return g.lerp(new T.Color(urban.r * wear, urban.g * wear, urban.b * wear), blend);
 };

 for (let r = 0; r < rows; r++) {
  const z = origin[1] + r * cell;
  const edgeHeight = heights[r * cols];
  const westY = terrain.heightAt(westSeamX, z);
  const westOk = edgeHeight !== null && westY >= terrain.seaLevel - 0.05;
  valid.push(westOk);
  vertices.push(westSeamX, westOk ? westY - 0.025 : terrain.seaLevel - 0.5, z);
  const wc = colourAt(westSeamX, z, -1);
  colours.push(wc.r, wc.g, wc.b);

  for (let c = 0; c < cols; c++) {
   const h = heights[r * cols + c];
   const x = origin[0] + c * cell;
   valid.push(h !== null);
   // Match the existing gameplay DEM along the common render edge at x = 1008.
   vertices.push(x, c === 0 ? terrain.heightAt(x, z) : h ?? 0, z);
   const col = colourAt(x, z, c);
   colours.push(col.r, col.g, col.b);
  }
 }

 for (let r = 0; r < rows - 1; r++) {
  for (let c = 0; c < totalCols - 1; c++) {
   const a = r * totalCols + c, b = a + 1, cc = a + totalCols, d = cc + 1;
   if (valid[a] && valid[b] && valid[cc]) indices.push(a, cc, b);
   if (valid[b] && valid[cc] && valid[d]) indices.push(b, cc, d);
  }
 }

 const geometry = meshFrom(vertices, indices, colours);
 const land = new T.Mesh(geometry, new T.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
 // Include "terrain ground" so toonify suppresses grazing rim glow just like DEM terrain.
 land.name = 'Hamasen · surveyed terrain ground beyond the railway park';
 land.receiveShadow = true;
 group.add(land);
}

function warehouseGableCap(outline: Point2[], roofY: number, roofColour: T.Color, ridgeColour: T.Color) {
 if (outline.length < 3) return null;
 let cx = 0, cz = 0, bestLen = 0, ux = 1, uz = 0;
 for (let i = 0; i < outline.length; i++) {
  const a = outline[i], b = outline[(i + 1) % outline.length];
  cx += a[0]; cz += a[1];
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (len > bestLen) { bestLen = len; ux = (b[0] - a[0]) / len; uz = (b[1] - a[1]) / len; }
 }
 cx /= outline.length; cz /= outline.length;
 const vx = -uz, vz = ux;
 let uMin = Infinity, uMax = -Infinity, vMin = Infinity, vMax = -Infinity;
 for (const [x, z] of outline) {
  const dx = x - cx, dz = z - cz;
  const u = dx * ux + dz * uz, v = dx * vx + dz * vz;
  if (u < uMin) uMin = u; if (u > uMax) uMax = u;
  if (v < vMin) vMin = v; if (v > vMax) vMax = v;
 }
 const halfW = Math.max(1, (vMax - vMin) * 0.5);
 const ridgeH = Math.min(1.5, halfW * 0.24);
 const rMin = uMin * 0.72, rMax = uMax * 0.72;
 const ridgeAt = (s: number): [number, number, number] => {
  const t = T.MathUtils.clamp(s, rMin, rMax);
  return [cx + ux * t, roofY + ridgeH, cz + uz * t];
 };
 const pos: number[] = [], rgb: number[] = [];
 const pushTri = (p0: [number, number, number], p1: [number, number, number], p2: [number, number, number], c0: T.Color, c1: T.Color, c2: T.Color) => {
  const ax = p1[0] - p0[0], ay = p1[1] - p0[1], az = p1[2] - p0[2];
  const bx = p2[0] - p0[0], by = p2[1] - p0[1], bz = p2[2] - p0[2];
  const ny = az * bx - ax * bz;
  const verts: [number, number, number][] = ny < 0 ? [p0, p2, p1] : [p0, p1, p2];
  const cols = ny < 0 ? [c0, c2, c1] : [c0, c1, c2];
  for (let k = 0; k < 3; k++) {
   pos.push(verts[k][0], verts[k][1], verts[k][2]);
   rgb.push(cols[k].r, cols[k].g, cols[k].b);
  }
 };
 for (let i = 0; i < outline.length; i++) {
  const a = outline[i], b = outline[(i + 1) % outline.length];
  const sa = (a[0] - cx) * ux + (a[1] - cz) * uz;
  const sb = (b[0] - cx) * ux + (b[1] - cz) * uz;
  const ra = ridgeAt(sa), rb = ridgeAt(sb);
  const pa: [number, number, number] = [a[0], roofY, a[1]];
  const pb: [number, number, number] = [b[0], roofY, b[1]];
  const ridgeDist = Math.hypot(rb[0] - ra[0], rb[2] - ra[2]);
  if (ridgeDist < 0.05) {
   pushTri(pa, pb, ra, roofColour, roofColour, ridgeColour);
  } else {
   pushTri(pa, pb, rb, roofColour, roofColour, ridgeColour);
   pushTri(pa, rb, ra, roofColour, ridgeColour, ridgeColour);
  }
 }
 if (!pos.length) return null;
 const cap = new T.BufferGeometry();
 cap.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
 cap.computeVertexNormals();
 cap.setAttribute('uv', new T.Float32BufferAttribute(new Float32Array((pos.length / 3) * 2), 2));
 cap.setAttribute('color', new T.Float32BufferAttribute(rgb, 3));
 return cap;
}

function addSkyline(group: T.Group, heightAt: HeightAt) {
 const silhouettes: T.BufferGeometry[] = [];
 const colours = new Map<string, T.Color>([
  ['apartments', new T.Color('#bdb8a8')], ['warehouse', new T.Color('#9c816d')],
  ['office', new T.Color('#bcbaaf')], ['hotel', new T.Color('#a7a39b')],
 ]);
 const fallback = new T.Color('#aca89e'), roof = new T.Color('#929795');
 const warehousePlinth = new T.Color('#776153');
 const warehouseRoof = new T.Color('#7d5646'), warehouseRidge = new T.Color('#8e6451');

 for (const building of survey.buildings) {
  const outline = building.polygon as Point2[];
  const ground = outline.map(([x, z]) => heightAt(x, z)).filter(y => y !== null);
  if (!ground.length) continue;
  const y = Math.min(...ground) - 0.16;
  const isWarehouse = building.kind === 'warehouse';
  const shape = new T.Shape(outline.map(([x, z]) => new T.Vector2(x, -z)));
  const geometry = new T.ExtrudeGeometry(shape, { depth: building.height, bevelEnabled: false, steps: isWarehouse ? 2 : 1 });
  geometry.rotateX(-Math.PI / 2).translate(0, y, 0);
  const wall = colours.get(building.kind) ?? fallback;
  const normals = geometry.getAttribute('normal'), positions = geometry.getAttribute('position'), rgb: number[] = [];
  const waistY = y + building.height * 0.48;
  for (let i = 0; i < normals.count; i++) {
   let colour = normals.getY(i) > 0.5 ? (isWarehouse ? warehouseRoof : roof) : wall;
   if (isWarehouse && normals.getY(i) <= 0.5 && positions.getY(i) < waistY) colour = warehousePlinth;
   rgb.push(colour.r, colour.g, colour.b);
  }
  geometry.setAttribute('color', new T.Float32BufferAttribute(rgb, 3));
  geometry.clearGroups();
  silhouettes.push(geometry);

  if (isWarehouse) {
   const cap = warehouseGableCap(outline, y + building.height, warehouseRoof, warehouseRidge);
   if (cap) silhouettes.push(cap);
  }
 }
 const merged = silhouettes.length ? mergeGeometries(silhouettes) : null;
 for (const geometry of silhouettes) geometry.dispose();
 if (merged) {
  const skyline = new T.Mesh(merged, new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.94 }));
  skyline.name = 'Hamasen · mapped port and Pier-2 silhouettes';
  group.add(skyline);
 }
}

function pushQuad(out: number[], cols: number[] | undefined, a: number[], b: number[], c: number[], d: number[], colour?: T.Color) {
 out.push(...a, ...b, ...c, ...a, ...c, ...d);
 if (cols && colour) {
  for (let k = 0; k < 6; k++) cols.push(colour.r, colour.g, colour.b);
 }
}

function strip(out: number[], points: Point2[], width: number, heightAt: HeightAt, raise: number, shift = 0, cols?: number[], colourAt?: (x: number, z: number) => T.Color) {
 for (let i = 1; i < points.length; i++) {
  const [x, z] = points[i - 1], [u, v] = points[i], dist = Math.hypot(u - x, v - z);
  if (dist < 0.03) continue;
  const nx = (z - v) / dist, nz = (u - x) / dist, step = Math.ceil(dist / 12);
  for (let j = 0; j < step; j++) {
   const f = j / step, g = (j + 1) / step;
   const vertex = (t: number, side: number) => {
    const a = T.MathUtils.lerp(x, u, t) + nx * (shift + width / 2 * side), b = T.MathUtils.lerp(z, v, t) + nz * (shift + width / 2 * side);
    const y = heightAt(a, b); return y === null ? null : [a, y + raise, b];
   };
   const a = vertex(f, 1), b = vertex(g, 1), c = vertex(g, -1), d = vertex(f, -1);
   if (a && b && c && d) {
    out.push(...a, ...b, ...c, ...a, ...c, ...d);
    if (cols && colourAt) {
     for (const pt of [a, b, c, a, c, d]) {
      const col = colourAt(pt[0], pt[2]);
      cols.push(col.r, col.g, col.b);
     }
    }
   }
  }
 }
}

function pushBox(out: number[], cols: number[], cx: number, cy: number, cz: number, tx: number, tz: number, nx: number, nz: number, len: number, height: number, width: number, colour: T.Color) {
 const hl = len * 0.5, hw = width * 0.5, y0 = cy, y1 = cy + height;
 const p = (s: number, w: number, y: number) => [cx + tx * s + nx * w, y, cz + tz * s + nz * w];
 const b0 = p(-hl, -hw, y0), b1 = p(hl, -hw, y0), b2 = p(hl, hw, y0), b3 = p(-hl, hw, y0);
 const t0 = p(-hl, -hw, y1), t1 = p(hl, -hw, y1), t2 = p(hl, hw, y1), t3 = p(-hl, hw, y1);
 pushQuad(out, cols, t0, t1, t2, t3, colour);
 pushQuad(out, cols, b0, b1, t1, t0, colour);
 pushQuad(out, cols, b1, b2, t2, t1, colour);
 pushQuad(out, cols, b2, b3, t3, t2, colour);
 pushQuad(out, cols, b3, b0, t0, t3, colour);
}

function pointSegDist(px: number, pz: number, ax: number, az: number, bx: number, bz: number) {
 const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
 if (l2 < 1e-6) return Math.hypot(px - ax, pz - az);
 const t = T.MathUtils.clamp(((px - ax) * dx + (pz - az) * dz) / l2, 0, 1);
 return Math.hypot(px - (ax + t * dx), pz - (az + t * dz));
}

function addSleepersAlong(out: number[], cols: number[], points: Point2[], heightAt: HeightAt, spacing: number, raise: number, colour: T.Color, maxX: number) {
 let made = 0;
 for (let i = 1; i < points.length; i++) {
  const [x, z] = points[i - 1], [u, v] = points[i], length = Math.hypot(u - x, v - z);
  if (length < 0.05) continue;
  if (x > maxX && u > maxX) { made = 0; continue; }
  for (; made < length; made += spacing) {
   const f = made / length, cx = T.MathUtils.lerp(x, u, f), cz = T.MathUtils.lerp(z, v, f);
   if (cx > maxX) continue;
   const nx = (z - v) / length, nz = (u - x) / length;
   strip(out, [[cx - nx * 0.97, cz - nz * 0.97], [cx + nx * 0.97, cz + nz * 0.97]], 0.22, heightAt, raise, 0, cols, () => colour);
  }
  made -= length;
 }
}

function addRailYard(group: T.Group, context: Context, heightAt: HeightAt) {
 const ballast: number[] = [], ballastCols: number[] = [], rails: number[] = [], sleepers: number[] = [], sleeperCols: number[] = [];
 const ballastWest = new T.Color('#88867b'), ballastEast = new T.Color('#958d79'), ballastMix = new T.Color();
 const timber = new T.Color('#6b5a48'), concrete = new T.Color('#8b8a82');
 const iron = new T.Color('#4a4e52'), bufferBeam = new T.Color('#c44d3c');

 for (const line of survey.rails) {
  const points = line.points as Point2[];
  strip(ballast, points, line.kind === 'light_rail' ? 2.05 : 1.9, heightAt, 0.013, 0, ballastCols, x =>
   ballastMix.copy(ballastWest).lerp(ballastEast, T.MathUtils.smoothstep(x, 996, 1020)));
  const gauge = line.kind === 'light_rail' ? 0.7175 : 0.5335;
  for (const side of [-1, 1]) strip(rails, points, 0.1, heightAt, 0.04, side * gauge);
  if (line.kind === 'disused' || line.kind === 'rail') {
   addSleepersAlong(sleepers, sleeperCols, points, heightAt, 2.5, 0.024, line.kind === 'rail' ? concrete : timber, MAX_SLEEPER_X);
  }
 }

 const parkRails = (context.hamasen?.rails ?? []).filter(line => line.kind === 'disused' || line.kind === 'rail');
 for (const line of parkRails) {
  // Inside hamasen.polygon (x <= 994) rails sit at +0.018 above +0.002 trackbed, so seat sleepers at +0.010.
  const isPlatformHistoric = /^hamasen-rail-124768819[57]-/.test(line.id);
  const colour = line.kind === 'rail' && !isPlatformHistoric ? concrete : timber;
  addSleepersAlong(sleepers, sleeperCols, line.points, heightAt, 1.0, 0.010, colour, 994);
 }

 // Place simple buffer stops at interior dead-end rail termini.
 const allRails: RailLine[] = [...parkRails, ...(survey.rails as RailLine[]).filter(r => r.kind === 'disused' || r.kind === 'rail')];
 for (let ri = 0; ri < parkRails.length; ri++) {
  const line = parkRails[ri];
  if (line.points.length < 2) continue;
  for (const [endIdx, adjIdx] of [[0, 1], [line.points.length - 1, line.points.length - 2]] as const) {
   const [px, pz] = line.points[endIdx], [qx, qz] = line.points[adjIdx];
   if (px >= 993.5 || pz >= 743.5) continue;
   let connected = false;
   for (let rj = 0; rj < allRails.length && !connected; rj++) {
    if (rj === ri) continue;
    const pts = allRails[rj].points;
    for (let k = 1; k < pts.length; k++) {
     if (pointSegDist(px, pz, pts[k - 1][0], pts[k - 1][1], pts[k][0], pts[k][1]) < 1.5) {
      connected = true;
      break;
     }
    }
   }
   if (connected) continue;
   const y = heightAt(px, pz);
   if (y === null) continue;
   const len = Math.hypot(qx - px, qz - pz);
   if (len < 0.05) continue;
   const tx = (qx - px) / len, tz = (qz - pz) / len, nx = -tz, nz = tx;
   for (const side of [-0.5335, 0.5335]) {
    pushBox(sleepers, sleeperCols, px + nx * side, y + 0.01, pz + nz * side, tx, tz, nx, nz, 0.22, 0.78, 0.12, iron);
   }
   pushBox(sleepers, sleeperCols, px + tx * 0.08, y + 0.56, pz + tz * 0.08, tx, tz, nx, nz, 0.16, 0.24, 1.52, bufferBeam);
  }
 }

 if (ballast.length) {
  const mesh = new T.Mesh(meshFrom(ballast, undefined, ballastCols), new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }));
  mesh.name = 'Hamasen · trackbed ground continuation';
  mesh.receiveShadow = true;
  group.add(mesh);
 }
 if (rails.length) {
  const mesh = new T.Mesh(meshFrom(rails), new T.MeshStandardMaterial({ color: '#626360', roughness: 0.94 }));
  mesh.name = 'Hamasen · surveyed rail continuation';
  group.add(mesh);
 }
 if (sleepers.length) {
  const mesh = new T.Mesh(meshFrom(sleepers, undefined, sleeperCols), new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.92 }));
  mesh.name = 'Hamasen · railway sleepers on terrain';
  mesh.receiveShadow = true;
  group.add(mesh);
 }
}

export function hamasenRailDetails(context: Context, terrain: Terrain): T.Group {
 const group = new T.Group();
 group.name = 'Hamasen railway · surveyed backdrop';
 group.userData.visualOnly = true;
 group.userData.terrainSeated = true;
 const ground: HeightAt = (x, z) => x <= origin[0] ? terrain.surfaceAt(x, z)?.height ?? null : surveyedHeight(x, z);
 addSurveyLand(group, terrain);
 addSkyline(group, ground);
 addRailYard(group, context, ground);
 return group;
}
