// Verify v3 landmark GLBs (ticket T4): node tools/verify_landmarks.mjs [--json out.json]
// Loads every public/models/landmarks/*.glb with three's GLTFLoader + MeshoptDecoder and checks, per file:
// triangles ≤ art-direction-v3 §5 limit (and ≤ 25k spec §6), exactly 1 material (≤ 4 spec), albedo + emissive textures,
// `_outlinenormal` attribute on every mesh, collision JSON present with ≥ 1 box, bbox size; total size < 6 MB.
import { readFileSync, readdirSync, statSync, existsSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'public/models/landmarks');
// art-direction-v3 §5 per-landmark triangle limits (kits: per module × modules exported).
const LIMITS = { admin: 4000, library: 6000, 'liberal-arts': 3000, 'sci-eng-arcade': 1600, tunnel: 2500, gate: 2000, 'yatsen-hall': 4000,
  gym: 3000, marine: 3000, 'activity-center': 5000, 'beach-house': 3000, seawall: 1200 };
const TOTAL_LIMIT = 6 * 1024 * 1024;

// Node has no DOM image decoder: textures are counted from the glTF JSON, and the loader is given a stub so it
// does not try to decode PNGs (geometry, materials and attributes are what we measure here).
globalThis.self ??= globalThis;
class StubImageBitmapLoader extends THREE.Loader { load(url, onLoad) { const img = { width: 1, height: 1 }; setTimeout(() => onLoad(img)); return img; } setOptions() { return this; } }

function glbJson(buf) {
  const len = buf.readUInt32LE(12); return JSON.parse(buf.subarray(20, 20 + len).toString('utf8'));
}

async function load(file) {
  const buf = readFileSync(file); const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder);
  const parser = await new Promise((res, rej) => loader.parse(ab, '', res, rej));
  return { gltf: parser, json: glbJson(buf), bytes: buf.length };
}

// Patch GLTFLoader's image path: when createImageBitmap is undefined it uses TextureLoader (DOM). Provide a stub.
globalThis.createImageBitmap ??= async () => ({ width: 1, height: 1, close() {} });
THREE.ImageBitmapLoader.prototype.load = StubImageBitmapLoader.prototype.load;
globalThis.navigator ??= { userAgent: 'node' };

await MeshoptDecoder.ready;
const files = existsSync(DIR) ? readdirSync(DIR).filter(f => f.endsWith('.glb') && (process.env.VERIFY_SMOKE || f !== 'smoke.glb')).sort() : [];
let total = 0, failed = 0; const rows = [];
for (const f of files) {
  const id = f.replace(/\.glb$/, ''); const { gltf, json, bytes } = await load(join(DIR, f)); total += bytes;
  let tris = 0, meshes = 0, outline = true; const mats = new Set();
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse(o => {
    if (!o.isMesh) return; meshes++;
    const g = o.geometry; tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
    (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => mats.add(m.name || m.uuid));
    if (!g.attributes._outlinenormal) outline = false;
  });
  const box = new THREE.Box3().setFromObject(gltf.scene); const size = box.getSize(new THREE.Vector3());
  const mat0 = (json.materials || [])[0] || {};
  const hasAlbedo = !!mat0.pbrMetallicRoughness?.baseColorTexture, hasEmissive = !!mat0.emissiveTexture;
  const meshopt = (json.extensionsUsed || []).includes('EXT_meshopt_compression');
  const colPath = join(DIR, `${id}.collision.json`); const col = existsSync(colPath) ? JSON.parse(readFileSync(colPath, 'utf8')) : null;
  const limit = LIMITS[id] ?? 25000; const problems = [];
  if (tris > limit) problems.push(`tris ${tris} > ${limit}`);
  if (tris > 25000) problems.push('tris > 25k (spec §6)');
  if (mats.size !== 1) problems.push(`materials ${mats.size} ≠ 1`);
  if (!hasAlbedo || !hasEmissive) problems.push('missing albedo/emissive texture');
  if (!outline) problems.push('missing _outlinenormal');
  if (!meshopt) problems.push('not meshopt-compressed');
  if (!col || !col.boxes?.length) problems.push('missing collision json');
  if (problems.length) failed++;
  rows.push({ id, tris, limit, meshes, materials: mats.size, textures: (json.textures || []).length, kb: +(bytes / 1024).toFixed(1),
    bbox: size.toArray().map(v => +v.toFixed(1)), colBoxes: col?.boxes?.length ?? 0, walkable: col?.boxes?.filter(b => b.walkable).length ?? 0,
    status: problems.length ? 'FAIL ' + problems.join('; ') : 'ok' });
}
console.table(rows);
const totalOk = total < TOTAL_LIMIT;
console.log(`total ${(total / 1024 / 1024).toFixed(2)} MB (limit 6 MB) ${totalOk ? 'ok' : 'FAIL'}; ${files.length} GLBs; ${failed} failing`);
const jsonOut = process.argv.indexOf('--json'); if (jsonOut > 0) writeFileSync(process.argv[jsonOut + 1], JSON.stringify({ rows, totalBytes: total }, null, 1));
if (failed || !totalOk || !files.length) process.exit(1);
