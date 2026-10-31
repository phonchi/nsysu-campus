/** Offline measurement only: sample animated skin vertices, never change the physics capsule. */
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { AnimationMixer, LoopOnce, SkinnedMesh, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const output = process.env.V7_SKIN_OUT ?? resolve(root, 'artifacts/v7/clip/body/skin-audit.json');
const radius = .28, sampleHz = 60;
const report: Record<string, unknown> = {
  status: 'running', createdAt: new Date().toISOString(), radius, sampleHz,
  method: 'GLTFLoader + MeshoptDecoder; SkinnedMesh.getVertexPosition transformed to scene/world space; horizontal distance from scene origin vertical axis. All authored clips sampled, including runtime Idle/Walk/Run/Jump/Wave/Talk and NPC Sit.',
  limitations: 'Discrete 60 Hz sampling, not a continuous bound. No crossfades, procedural RideRig, avatar squash/bob, shader outlines or physics changes. No three-mesh-bvh used.',
  models: [],
};

/** Node has no image decoder and geometry does not need textures, so drop them from the GLB's JSON chunk. */
function withoutTextures(bytes: Buffer): ArrayBuffer {
  const length = bytes.readUInt32LE(12), json = JSON.parse(bytes.subarray(20, 20 + length).toString('utf8'));
  delete json.images; delete json.textures; delete json.samplers;
  for (const m of json.materials ?? []) {
    delete m.normalTexture; delete m.occlusionTexture; delete m.emissiveTexture;
    if (m.pbrMetallicRoughness) { delete m.pbrMetallicRoughness.baseColorTexture; delete m.pbrMetallicRoughness.metallicRoughnessTexture; }
  }
  let text = Buffer.from(JSON.stringify(json));
  if (text.length % 4) text = Buffer.concat([text, Buffer.alloc(4 - text.length % 4, 0x20)]);
  const rest = bytes.subarray(20 + length), out = Buffer.alloc(20 + text.length + rest.length);
  bytes.copy(out, 0, 0, 12); out.writeUInt32LE(out.length, 8); out.writeUInt32LE(text.length, 12); out.writeUInt32LE(0x4e4f534a, 16);
  text.copy(out, 20); rest.copy(out, 20 + text.length);
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer;
}

try {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const models: unknown[] = [];
  for (const name of ['student-m', 'student-f']) {
    const path = `public/models/characters/${name}.glb`, bytes = await readFile(resolve(root, path));
    const gltf = await loader.parseAsync(withoutTextures(bytes), '');
    gltf.scene.rotation.y = Math.PI;
    const meshes: SkinnedMesh[] = [];
    gltf.scene.traverse(o => { if (o instanceof SkinnedMesh) meshes.push(o); });
    if (!meshes.length) throw new Error(`${name}: no SkinnedMesh`);
    const mixer = new AnimationMixer(gltf.scene), point = new Vector3();
    const animations = [];
    for (const clip of gltf.animations) {
      mixer.stopAllAction();
      const action = mixer.clipAction(clip).reset().setLoop(LoopOnce, 1);
      action.clampWhenFinished = true; action.play();
      const steps = Math.max(1, Math.ceil(clip.duration * sampleHz));
      let worst = { radius: -1, time: 0, mesh: '', vertex: -1, bone: '', boneWeight: 0, position: [0, 0, 0] };
      for (let frame = 0; frame <= steps; frame++) {
        const time = clip.duration * frame / steps;
        mixer.setTime(time); gltf.scene.updateMatrixWorld(true);
        for (const mesh of meshes) {
          mesh.skeleton.update();
          const positions = mesh.geometry.attributes.position;
          const indices = mesh.geometry.attributes.skinIndex, weights = mesh.geometry.attributes.skinWeight;
          for (let vertex = 0; vertex < positions.count; vertex++) {
            mesh.getVertexPosition(vertex, point).applyMatrix4(mesh.matrixWorld);
            const distance = Math.hypot(point.x, point.z);
            if (distance <= worst.radius) continue;
            const w = [weights.getX(vertex), weights.getY(vertex), weights.getZ(vertex), weights.getW(vertex)];
            const b = [indices.getX(vertex), indices.getY(vertex), indices.getZ(vertex), indices.getW(vertex)];
            const strongest = w.indexOf(Math.max(...w));
            worst = { radius: distance, time, mesh: mesh.name, vertex,
              bone: mesh.skeleton.bones[b[strongest]]?.name ?? '', boneWeight: w[strongest], position: point.toArray() };
          }
        }
      }
      const result = { animation: clip.name, duration: clip.duration, samples: steps + 1, ...worst,
        exceedsCapsuleBy: worst.radius - radius, capsuleRatio: worst.radius / radius };
      animations.push(result); console.log(`${name} ${clip.name}: ${worst.radius.toFixed(6)} m, ${worst.bone}, t=${worst.time.toFixed(4)} s`);
    }
    mixer.stopAllAction(); mixer.uncacheRoot(gltf.scene);
    models.push({ name, path, sha256: createHash('sha256').update(bytes).digest('hex'),
      skinnedMeshes: meshes.length, vertices: meshes.reduce((n, m) => n + m.geometry.attributes.position.count, 0), animations });
    report.models = models;
  }
  report.status = 'complete';
} catch (error) {
  report.status = 'failed'; report.error = error instanceof Error ? error.stack : String(error);
  console.error(report.error); process.exitCode = 1;
} finally {
  await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  console.log(`Report: ${output}`);
}
