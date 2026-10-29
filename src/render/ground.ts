import * as T from 'three';
import { toonMaterial } from './toon';
import { FOLIAGE } from './foliage';
import { GrowableSurfaceField, type SoilSurface } from '../world/growable-surface';

/** Lawn and grass tufts (art-direction-v4 §4.1).
 * - Lawn: world-space three-green noise at 6 m and 1.5 m, clover specks, a detail texture that fades out with
 *   distance, and a worn band (grass.worn) beside paths and buildings from a 2 m campus mask.
 * - Tufts: one InstancedMesh of cross-quad tufts refilled around the player on free lawn only. */

export interface GroundMask { texture: T.DataTexture; bounds: [number, number, number, number]; free(x: number, z: number): boolean }

/** Build the mask from an occupancy grid (0 free lawn, >0 building/road/beach): R = worn band, G = blocked. */
export function groundMask(grid: Uint8Array, nx: number, nz: number, x0: number, z0: number, cell: number): GroundMask {
  const data = new Uint8Array(nx * nz * 4), worn = new Float32Array(nx * nz);
  // Worn = closeness to any occupied cell within 3 cells (≈ 6 m), squared falloff.
  const R = 3;
  for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) {
    if (grid[k * nx + i]) { worn[k * nx + i] = 1; continue; }
    let best = R + 1;
    for (let dk = -R; dk <= R; dk++) for (let di = -R; di <= R; di++) {
      const ii = i + di, kk = k + dk; if (ii < 0 || kk < 0 || ii >= nx || kk >= nz) continue;
      const g = grid[kk * nx + ii]; if (!g || g === 4) continue; // beach does not wear the lawn
      best = Math.min(best, Math.hypot(di, dk));
    }
    worn[k * nx + i] = best > R ? 0 : (1 - best / (R + 1)) ** 2;
  }
  for (let p = 0; p < nx * nz; p++) { data[p * 4] = Math.round(worn[p] * 255); data[p * 4 + 1] = grid[p] ? 255 : 0; data[p * 4 + 3] = 255; }
  const texture = new T.DataTexture(data, nx, nz, T.RGBAFormat);
  texture.magFilter = texture.minFilter = T.LinearFilter; texture.wrapS = texture.wrapT = T.ClampToEdgeWrapping; texture.needsUpdate = true;
  const bounds: [number, number, number, number] = [x0, z0, x0 + nx * cell, z0 + nz * cell];
  return { texture, bounds, free: (x, z) => { const i = Math.floor((x - x0) / cell), k = Math.floor((z - z0) / cell); return i >= 0 && k >= 0 && i < nx && k < nz && !grid[k * nx + i] && worn[k * nx + i] < .5; } };
}

/** Per-preset light floor for the lawn: in the low sunset sun the whole quad is in building shadow, and the
 * toon ramp alone leaves it near black (art review v4 P1-2). Set by the sky each frame. */
export const LAWN_LIGHT = { uLawnFloor: { value: .42 }, uLawnTint: { value: new T.Color('#ffffff') } };
export const LAWN_FLOOR = { day: .42, sunset: .62, night: .34 } as const;
/** grassTint (art-direction-v4 §2.2), slightly softened: warm at sunset, cool at night. */
export const LAWN_TINT = { day: '#ffffff', sunset: '#ffd8b4', night: '#a6b4d6' } as const;

export const LAWN = { dark: '#6fb04e', base: '#8fcf66', light: '#b0d872', worn: '#c8bb84', clover: '#f3efb0' };

const NOISE = `
float gHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float gNoise(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(gHash(i), gHash(i + vec2(1, 0)), u.x), mix(gHash(i + vec2(0, 1)), gHash(i + vec2(1, 1)), u.x), u.y); }`;

/** Toon lawn material; `detail` is the old painted grass texture (multiplied at 3 m tiling, faded beyond 60 m). */
export function lawnMaterial(mask: GroundMask | undefined, detail?: T.Texture) {
  const m = toonMaterial({ name: 'lawn', color: '#ffffff' }, false);
  const uniforms = {
    uMask: { value: mask?.texture ?? null }, uMaskBounds: { value: new T.Vector4(...(mask?.bounds ?? [0, 0, 1, 1])) }, uHasMask: { value: mask ? 1 : 0 },
    uDetail: { value: detail ?? null }, uHasDetail: { value: detail ? 1 : 0 },
    uDark: { value: new T.Color(LAWN.dark) }, uBase: { value: new T.Color(LAWN.base) }, uLight: { value: new T.Color(LAWN.light) },
    uWorn: { value: new T.Color(LAWN.worn) }, uClover: { value: new T.Color(LAWN.clover) },
  };
  if (detail) { detail.wrapS = detail.wrapT = T.RepeatWrapping; }
  const base = m.onBeforeCompile;
  m.onBeforeCompile = (sh, r) => {
    base.call(m, sh, r);
    Object.assign(sh.uniforms, uniforms, LAWN_LIGHT);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vLawn;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvLawn = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
varying vec3 vLawn;
uniform sampler2D uMask; uniform vec4 uMaskBounds; uniform float uHasMask;
uniform sampler2D uDetail; uniform float uHasDetail;
uniform vec3 uDark; uniform vec3 uBase; uniform vec3 uLight; uniform vec3 uWorn; uniform vec3 uClover; uniform float uLawnFloor; uniform vec3 uLawnTint;
${NOISE}`)
      .replace('#include <opaque_fragment>', 'outgoingLight = max(outgoingLight, diffuseColor.rgb * uLawnFloor);\n#include <opaque_fragment>')
      .replace('#include <color_fragment>', `#include <color_fragment>
{ vec2 p = vLawn.xz;
  float n = .5 + (gNoise(p / 6.0) - .5) * .45 + (gNoise(p / 1.5) - .5) * .7;
  vec3 g = n < .5 ? mix(uDark, uBase, smoothstep(.25, .5, n)) : mix(uBase, uLight, smoothstep(.5, .78, n));
  float dist = length(vLawn - cameraPosition);
  float near = 1.0 - smoothstep(30.0, 60.0, dist);
  if (uHasDetail > .5) g *= mix(vec3(1.0), texture2D(uDetail, p / 3.0).rgb * 1.25, .35 * near);
  vec2 cp = p * 4.0; float clover = step(.93, gHash(floor(cp))) * (1.0 - smoothstep(.06, .1, length(fract(cp) - .5))) * near;
  g = mix(g, uClover, clover * .8);
  if (uHasMask > .5) {
    vec2 mUv = (p - uMaskBounds.xy) / (uMaskBounds.zw - uMaskBounds.xy);
    if (all(greaterThan(mUv, vec2(0.0))) && all(lessThan(mUv, vec2(1.0)))) {
      float w = texture2D(uMask, mUv).r * (.75 + .5 * gNoise(p / 1.2));
      g = mix(g, uWorn, clamp(w, 0.0, 1.0) * .75);
    }
  }
  diffuseColor.rgb *= g * uLawnTint; }`)
  };
  m.customProgramCacheKey = () => 'toon-lawn';
  m.userData.lawn = uniforms;
  return m;
}

/** Attach the campus mask once it exists (the lawn material is created before the occupancy grid). */
export function setLawnMask(m: T.Material, mask: GroundMask) {
  const u = m.userData.lawn; if (!u) return;
  u.uMask.value = mask.texture; u.uMaskBounds.value.set(...mask.bounds); u.uHasMask.value = 1;
}

/** Grass tufts around the player: cross quads with a painted blade texture, rooted on the ground, swaying. */
export interface GrassPlacement { x: number; z: number; scale: number; yaw: number; seed: number; surface: SoilSurface }
/** Deterministic candidates are shared by the renderer and the whole-campus audit. */
export function* grassPlacements(field: GrowableSurfaceField, player: { x: number; z: number }, radius = 55): Generator<GrassPlacement> {
  const cell = 1.6, i0 = Math.floor((player.x - radius) / cell), i1 = Math.ceil((player.x + radius) / cell), k0 = Math.floor((player.z - radius) / cell), k1 = Math.ceil((player.z + radius) / cell);
  for (let k = k0; k <= k1; k++) for (let i = i0; i <= i1; i++) {
    const h = Math.sin(i * 127.1 + k * 311.7) * 43758.5453, r = h - Math.floor(h);
    if (r > .55) continue;
    const x = (i + r * 1.7) * cell, z = (k + ((r * 7.3) % 1)) * cell, scale = .7 + r * .9;
    if (Math.hypot(x - player.x, z - player.z) > radius) continue;
    const surface = field.sample(x, z, scale);
    if (surface) yield { x, z, scale, yaw: r * 40, seed: r, surface };
  }
}

export class GrassTufts {
  readonly mesh: T.InstancedMesh;
  private centre = new T.Vector3(1e9, 0, 1e9);
  private o = new T.Object3D();
  private revision = -1;
  private placements: GrassPlacement[] = [];
  /** Tier budget (≤ count); changing it refills on the next update. */
  get limit() { return this.max; }
  set limit(n: number) { this.max = Math.min(this.count, n); this.centre.set(1e9, 0, 1e9); if (!n) { this.mesh.count = 0; this.placements = []; } }
  private max: number;
  constructor(readonly count: number, private field: GrowableSurfaceField, private radius = 55) {
    const g = new T.BufferGeometry(), pos: number[] = [], uv: number[] = [], idx: number[] = [];
    for (let k = 0; k < 3; k++) {
      const a = k / 3 * Math.PI, cx = Math.cos(a) * .32, cz = Math.sin(a) * .32, b = pos.length / 3;
      pos.push(-cx, 0, -cz, cx, 0, cz, cx, .32, cz, -cx, .32, -cz); uv.push(0, 0, 1, 0, 1, 1, 0, 1);
      idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
    g.setAttribute('normal', new T.Float32BufferAttribute(pos.map((_, i) => i % 3 === 1 ? 1 : 0), 3)); // up: lit like the lawn
    g.setIndex(idx);
    const m = toonMaterial({ name: 'grass tufts', map: bladeTexture(), alphaTest: .5, side: T.DoubleSide }, false);
    const base = m.onBeforeCompile;
    m.onBeforeCompile = (sh, r) => {
      base.call(m, sh, r); Object.assign(sh.uniforms, FOLIAGE);
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime; uniform float uWind;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
{ vec4 wp = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  float d = length(wp.xyz - cameraPosition); float shrink = 1.0 - smoothstep(35.0, 55.0, d);
  transformed *= shrink;
  transformed.xz += sin(uTime * 2.1 + wp.x * .7 + wp.z * .5) * .05 * uWind * uv.y; }`);
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec3 uLeafTint;')
        .replace('#include <opaque_fragment>', 'outgoingLight *= uLeafTint;\n#include <opaque_fragment>');
    };
    m.customProgramCacheKey = () => 'toon-tuft';
    this.mesh = new T.InstancedMesh(g, m, count);
    this.mesh.name = 'Grass tufts'; this.mesh.frustumCulled = false; this.mesh.count = 0; this.mesh.receiveShadow = true;
    this.max = count;
  }

  /** Refill when the player has moved more than 12 m from the last fill centre. */
  update(player: T.Vector3) {
    if (!this.field.ready) { this.mesh.count = 0; this.placements = []; return; }
    if (!this.max || (this.revision === this.field.revision && Math.hypot(player.x - this.centre.x, player.z - this.centre.z) < 12 && Math.abs(player.y - this.centre.y) < 2)) return;
    this.centre.copy(player);
    this.revision = this.field.revision; this.placements = [];
    const c = new T.Color(), up = new T.Vector3(0, 1, 0), yaw = new T.Quaternion(); let n = 0;
    for (const placement of grassPlacements(this.field, player, this.radius)) {
      if (n >= this.max) break;
      const { x, z, scale, seed: r, surface } = placement;
      this.o.position.set(x, surface.height, z);
      this.o.quaternion.setFromUnitVectors(up, surface.normal).multiply(yaw.setFromAxisAngle(up, placement.yaw));
      this.o.scale.setScalar(scale); this.o.updateMatrix();
      this.mesh.setMatrixAt(n, this.o.matrix); c.setHSL(.22 + (r - .3) * .06, .25, .82 + r * .16); this.mesh.setColorAt(n, c); n++;
      this.placements.push(placement);
    }
    this.mesh.count = n; this.mesh.instanceMatrix.needsUpdate = true; if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
  /** Read-only observations of the actual instance transforms, not recomputed ideal roots. */
  get diagnostics() {
    const m = new T.Matrix4(), p = new T.Vector3();
    let illegal = 0, maxRootError = 0;
    const roots = this.placements.map((v, i) => {
      this.mesh.getMatrixAt(i, m); p.setFromMatrixPosition(m);
      const support = this.field.sample(p.x, p.z, v.scale), error = support ? Math.abs(p.y - support.height) : null;
      if (!support) illegal++; else maxRootError = Math.max(maxRootError, error!);
      return { position: p.toArray(), scale: v.scale, surfaceId: v.surface.id, rootError: error };
    });
    return { ready: this.field.ready, surfaceVersion: this.field.surfaceVersion, revision: this.revision, count: this.mesh.count, illegal, maxRootError, roots };
  }
}

function bladeTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d')!;
  const cols = ['#5f9e46', '#7fbf58', '#a6d26a'];
  for (let i = 0; i < 9; i++) {
    const x = 8 + i * 6 + Math.sin(i * 7) * 3, lean = Math.sin(i * 3.1) * 8, h = 34 + (i % 3) * 9;
    g.fillStyle = cols[i % 3]; g.beginPath(); g.moveTo(x - 3, 64); g.quadraticCurveTo(x + lean * .4, 64 - h * .6, x + lean, 64 - h); g.quadraticCurveTo(x + lean * .3, 64 - h * .5, x + 3, 64); g.fill();
  }
  const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace; return t;
}
