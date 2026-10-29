// Verify v3 character GLBs (T5): clips, triangles, bones, rest height, outline attribute, size.
// Usage: node tools/verify_characters.mjs [public/models/characters]
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

// Node has no DOM image decoding; textures are irrelevant for these checks.
globalThis.self ??= globalThis;
globalThis.createImageBitmap ??= async () => ({ width: 1, height: 1, close() {} });
THREE.ImageBitmapLoader.prototype.load = function (url, onLoad) { const b = { width: 1, height: 1, close() {} }; queueMicrotask(() => onLoad?.(b)); return b; };
THREE.TextureLoader.prototype.load = function (url, onLoad) { const t = new THREE.Texture(); queueMicrotask(() => onLoad?.(t)); return t; };

const REQUIRED = ['Idle', 'Walk', 'Run', 'Jump', 'Wave', 'Talk', 'Sit'];
const MONKEY = ['Idle', 'Walk', 'Sit'];
const dir = resolve(process.argv[2] ?? 'public/models/characters');
const files = readdirSync(dir).filter(f => f.endsWith('.glb')).sort();
await MeshoptDecoder.ready;
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);

let failed = 0, total = 0;
const fail = (id, msg) => { failed++; console.log(`  FAIL ${id}: ${msg}`); };
for (const f of files) {
  const id = f.replace('.glb', ''), path = join(dir, f), size = statSync(path).size; total += size;
  const buf = readFileSync(path);
  const gltf = await loader.parseAsync(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '');
  const scene = gltf.scene; scene.updateMatrixWorld(true);
  let tris = 0, prims = 0; const mats = new Set(), bones = new Set(); let outline = null, dotMean = null;
  scene.traverse(o => {
    if (!o.isMesh) return;
    prims++; const g = o.geometry; tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
    (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => mats.add(m.uuid));
    if (o.isSkinnedMesh) o.skeleton.bones.forEach(b => bones.add(b.uuid));
    const on = g.attributes._outlinenormal, n = g.attributes.normal;
    if (on && n) {
      outline = '_outlinenormal'; let s = 0; const a = new THREE.Vector3(), b = new THREE.Vector3();
      for (let i = 0; i < n.count; i++) { a.fromBufferAttribute(on, i).normalize(); b.fromBufferAttribute(n, i).normalize(); s += a.dot(b); }
      dotMean = s / n.count;
    }
  });
  const box = new THREE.Box3().setFromObject(scene, true); const h = box.max.y - box.min.y;
  const clips = gltf.animations.map(c => `${c.name}:${c.duration.toFixed(2)}s`);
  const isMonkey = id === 'monkey';
  console.log(`${id}  ${(size / 1024).toFixed(1)} KB  tris=${tris}  bones=${bones.size}  meshes=${prims}  materials=${mats.size}  height=${h.toFixed(3)} m  footY=${box.min.y.toFixed(3)}  outline=${outline ?? 'none'}${dotMean !== null ? ` (mean dot with NORMAL ${dotMean.toFixed(2)})` : ''}`);
  console.log(`  clips: ${clips.join(' ')}`);
  for (const c of isMonkey ? MONKEY : REQUIRED) if (!gltf.animations.some(a => a.name === c)) fail(id, `missing clip ${c}`);
  if (isMonkey ? (h < 0.25 || h > 0.9) : (h < 1.4 || h > 1.7)) fail(id, `height ${h.toFixed(3)} out of range`);
  if (tris > 6000) fail(id, `${tris} triangles > 6000`);
  if (mats.size !== 1) fail(id, `${mats.size} materials`);
  if (bones.size > 32) console.log(`  note ${id}: ${bones.size} bones > 32`);
  if (dotMean !== null && dotMean < 0.6) fail(id, `outline normals disagree with NORMAL (axis bug?)`);
  // In-place check: root/hips horizontal drift over Walk and Run.
  const mixer = new THREE.AnimationMixer(scene); const hips = scene.getObjectByName('Hips') ?? scene.getObjectByName('Body');
  if (hips) for (const name of ['Walk', 'Run']) {
    const clip = gltf.animations.find(a => a.name === name); if (!clip) continue;
    mixer.stopAllAction(); const act = mixer.clipAction(clip).play();
    const p = []; for (const t of [0, clip.duration * 0.999]) { act.time = t; mixer.update(0); scene.updateMatrixWorld(true); p.push(hips.getWorldPosition(new THREE.Vector3())); }
    const d = Math.hypot(p[1].x - p[0].x, p[1].z - p[0].z);
    if (d > 0.05) fail(id, `${name} root drift ${d.toFixed(3)} m`);
  }
}
console.log(`TOTAL ${files.length} files, ${(total / 1024 / 1024).toFixed(2)} MB`);
if (total > 4 * 1024 * 1024) fail('all', 'total size > 4 MB');
if (failed) { console.log(`${failed} failure(s)`); process.exit(1); }
console.log('OK');
