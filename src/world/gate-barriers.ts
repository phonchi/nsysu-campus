import * as T from 'three';
import type { Obstacle } from '../walk/obstacles';

/** The gate GLB is atlas-batched into one mesh. Recover its disconnected solid parts
 * by shared vertex positions, preserving dimensions from the actual asset. */
function components(mesh: T.Mesh, toGate: T.Matrix4): T.Box3[] {
  const positions = mesh.geometry.attributes.position, index = mesh.geometry.index;
  const vertex = new T.Vector3(), vertices: T.Vector3[] = [], parent: number[] = [], welded = new Map<string, number>(), ids: number[] = [];
  const find = (n: number): number => { while (parent[n] !== n) { parent[n] = parent[parent[n]]; n = parent[n]; } return n; };
  for (let i = 0; i < positions.count; i++) {
    vertex.fromBufferAttribute(positions, i).applyMatrix4(toGate);
    const key = vertex.toArray().map(v => Math.round(v * 1e5)).join(',');
    let id = welded.get(key);
    if (id === undefined) { id = vertices.length; vertices.push(vertex.clone()); parent.push(id); welded.set(key, id); }
    ids.push(id);
  }
  for (let i = 0; i < (index?.count ?? positions.count); i += 3) {
    const a = ids[index ? index.getX(i) : i];
    for (let j = 1; j < 3; j++) parent[find(ids[index ? index.getX(i + j) : i + j])] = find(a);
  }
  const bounds = new Map<number, T.Box3>();
  for (let i = 0; i < vertices.length; i++) { const root = find(i), box = bounds.get(root) ?? new T.Box3(); box.expandByPoint(vertices[i]); bounds.set(root, box); }
  return [...bounds.values()];
}

/** Runtime supplement for the visible boom arms missing from the gate's older static
 * collider file. Dimensions and world transforms come from the rendered GLB; no duplicate
 * gate coordinates are maintained here. Add these to physics and route obstacles together. */
export function gateBarrierObstacles(root: T.Object3D): Obstacle[] {
  root.updateMatrixWorld(true); const out: Obstacle[] = [];
  root.traverse(gate => {
    if (gate.userData.landmark !== 'gate') return;
    const inverse = gate.matrixWorld.clone().invert(), parts: T.Box3[] = [];
    gate.traverse(o => { if (o instanceof T.Mesh && !o.userData.outlineHull) parts.push(...components(o, inverse.clone().multiply(o.matrixWorld))); });
    const size = new T.Vector3();
    // Semantic shape: a long, thin horizontal arm. These are the only such solids
    // in this gate asset; nearby compact solids intersecting an arm are its bases.
    const arms = parts.filter(box => { box.getSize(size); return size.x > 3 && size.y > .04 && size.y < .2 && size.z > .04 && size.z < .2; });
    const bases = parts.filter(box => { box.getSize(size); return size.y > .5 && size.y < 2 && size.x > .2 && size.x < 1 && size.z > .2 && size.z < 1 && arms.some(arm => arm.intersectsBox(box)); });
    const scale = new T.Vector3(), rotation = new T.Quaternion(), translation = new T.Vector3(); gate.matrixWorld.decompose(translation, rotation, scale);
    const yaw = new T.Euler().setFromQuaternion(rotation, 'YXZ').y;
    for (const [i, box] of [...arms, ...bases].entries()) {
      const centre = box.getCenter(new T.Vector3()).applyMatrix4(gate.matrixWorld), half = box.getSize(new T.Vector3()).multiply(scale).multiplyScalar(.5);
      out.push({ id: `landmark:gate:barrier:${i}`, shape: 'box', center: centre.toArray(), half: half.toArray(), yaw, navigation: true });
    }
  });
  return out;
}
