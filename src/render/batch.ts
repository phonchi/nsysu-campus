import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** Merge the static meshes under `group` into one mesh per material (geometry baked into group space).
 * Skips instanced, skinned and flagged meshes. Returns draws before/after. */
export function mergeStatic(group: T.Object3D): [number, number] {
  group.updateWorldMatrix(true, true);
  const inverse = group.matrixWorld.clone().invert();
  const buckets = new Map<T.Material, { geos: T.BufferGeometry[]; meshes: T.Mesh[]; cast: boolean; receive: boolean }>();
  let before = 0;
  group.traverse(o => {
    if (!(o instanceof T.Mesh) || o instanceof T.InstancedMesh || o instanceof T.SkinnedMesh || Array.isArray(o.material) || o.userData.keepSeparate) return;
    before++;
    const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    g.applyMatrix4(new T.Matrix4().multiplyMatrices(inverse, o.matrixWorld));
    for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(name)) g.deleteAttribute(name);
    const b = buckets.get(o.material) ?? buckets.set(o.material, { geos: [], meshes: [], cast: false, receive: false }).get(o.material)!;
    b.geos.push(g); b.meshes.push(o); b.cast ||= o.castShadow; b.receive ||= o.receiveShadow;
  });
  let after = 0;
  for (const [material, b] of buckets) {
    if (b.meshes.length < 2) { after += b.meshes.length; b.geos.forEach(g => g.dispose()); continue; }
    // Attribute sets must match; split by signature.
    const bySig = new Map<string, number[]>();
    b.geos.forEach((g, i) => { const sig = Object.keys(g.attributes).sort().join(); (bySig.get(sig) ?? bySig.set(sig, []).get(sig)!).push(i); });
    for (const idx of bySig.values()) {
      const merged = idx.length > 1 ? mergeGeometries(idx.map(i => b.geos[i])) : null;
      if (!merged) { after += idx.length; idx.forEach(i => b.geos[i].dispose()); continue; }
      const mesh = new T.Mesh(merged, material);
      mesh.name = `${group.name} (merged)`; mesh.castShadow = b.cast; mesh.receiveShadow = b.receive;
      group.add(mesh); after++;
      for (const i of idx) { const m = b.meshes[i]; m.removeFromParent(); m.geometry.dispose(); b.geos[i].dispose(); }
    }
  }
  return [before, after];
}
