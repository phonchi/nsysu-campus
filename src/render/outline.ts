import * as T from 'three';

/** Screen-constant inverted-hull outlines (art-direction-v3 §3). One shared material per kind. */
export type OutlineKind = 'character' | 'landmark' | 'building';
const SPEC: Record<OutlineKind, { px: number; min: number; max: number; far: number; color: string }> = {
  character: { px: 2.0, min: .006, max: .03, far: 60, color: '#2a2c4a' },
  landmark: { px: 1.5, min: .02, max: .20, far: 220, color: '#3a2f3b' },
  building: { px: 1.3, min: .02, max: .18, far: 160, color: '#3a2f3b' },
};

export const OUTLINE_UNIFORMS = { uViewportH: { value: 900 }, uOutlineScale: { value: 1 } };
const materials = new Map<string, T.MeshBasicMaterial>();

function outlineMaterial(kind: OutlineKind, skinned: boolean) {
  const key = kind + (skinned ? ':s' : '');
  let m = materials.get(key);
  if (m) return m;
  const s = SPEC[kind];
  m = new T.MeshBasicMaterial({ color: s.color, side: T.BackSide, fog: true });
  m.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, OUTLINE_UNIFORMS, { uPx: { value: s.px }, uMin: { value: s.min }, uMax: { value: s.max }, uFar: { value: s.far } });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec3 outlineNormal; uniform float uViewportH; uniform float uOutlineScale; uniform float uPx; uniform float uMin; uniform float uMax; uniform float uFar;`)
      .replace('#include <project_vertex>', `
vec3 oN = outlineNormal;
#ifdef USE_SKINNING
  oN = ( skinMatrix * vec4( oN, 0.0 ) ).xyz;
#endif
vec4 mvPosition = modelViewMatrix * vec4( transformed, 1.0 );
float dist = -mvPosition.z;
// World offset that covers uPx pixels at this distance; hidden beyond uFar.
float w = clamp( uPx * uOutlineScale * dist * 2.0 / ( projectionMatrix[1][1] * uViewportH ), uMin, uMax );
w *= step( dist, uFar );
mvPosition.xyz += normalize( normalMatrix * oN ) * w;
gl_Position = projectionMatrix * mvPosition;`);
  };
  m.customProgramCacheKey = () => 'outline-' + key;
  materials.set(key, m);
  return m;
}

/** Average normals of coincident vertices so hard-edged boxes extrude without cracks at corners. */
export function addOutlineNormals(geometry: T.BufferGeometry) {
  if (geometry.getAttribute('outlineNormal')) return;
  const imported = geometry.getAttribute('_outlinenormal') ?? geometry.getAttribute('_OUTLINENORMAL');
  if (imported) { geometry.setAttribute('outlineNormal', imported); return; }
  if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
  const pos = geometry.getAttribute('position'), nor = geometry.getAttribute('normal');
  const sums = new Map<string, T.Vector3>(), keys: string[] = [];
  const q = (v: number) => Math.round(v * 1000);
  for (let i = 0; i < pos.count; i++) {
    const k = `${q(pos.getX(i))},${q(pos.getY(i))},${q(pos.getZ(i))}`;
    keys.push(k);
    const s = sums.get(k) ?? sums.set(k, new T.Vector3()).get(k)!;
    s.x += nor.getX(i); s.y += nor.getY(i); s.z += nor.getZ(i);
  }
  const out = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const s = sums.get(keys[i])!, l = s.length() || 1;
    out[i * 3] = s.x / l; out[i * 3 + 1] = s.y / l; out[i * 3 + 2] = s.z / l;
  }
  geometry.setAttribute('outlineNormal', new T.BufferAttribute(out, 3));
}

/** Attach an outline hull to every mesh under root (shares geometry; skinned meshes share the skeleton). */
export function addOutlines(root: T.Object3D, kind: OutlineKind) {
  const hulls: T.Mesh[] = [];
  root.traverse(o => {
    if (!(o instanceof T.Mesh) || o.userData.outlineHull || o.userData.noOutline || o instanceof T.InstancedMesh) return;
    addOutlineNormals(o.geometry);
    let hull: T.Mesh;
    if (o instanceof T.SkinnedMesh) { const s = new T.SkinnedMesh(o.geometry, outlineMaterial(kind, true)); s.bind(o.skeleton, o.bindMatrix); hull = s; }
    else hull = new T.Mesh(o.geometry, outlineMaterial(kind, false));
    hull.userData.outlineHull = true; hull.castShadow = false; hull.receiveShadow = false; hull.raycast = () => {};
    hull.name = 'outline';
    hulls.push(hull);
    o.add(hull);
  });
  return hulls;
}

/** Night swaps every outline to the deep night ink. */
export function setOutlineNight(t: number) {
  const night = new T.Color('#141a30');
  for (const [key, m] of materials) {
    const base = new T.Color(SPEC[key.split(':')[0] as OutlineKind].color);
    m.color.copy(base.lerp(night, t));
  }
}
