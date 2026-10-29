import * as T from 'three';

/** Stylized sea of 西子灣 (art-direction-v4 §2.2, §4.3–4.4): depth from the DEM height grid gives shallow
 * turquoise near the shore and a double foam line where the water meets sand or the seawall; past the DEM
 * the strait fades to deep blue. A sun glint band follows the sun (strong at sunset). */
export const SEA = {
  uTime: { value: 0 },
  uSun: { value: new T.Vector3(0, 1, 0) },
  uGlint: { value: .35 },
  uGlintColor: { value: new T.Color('#fff4e0') },
  uTint: { value: new T.Color('#ffffff') },
};
export const SEA_LOOK = {
  day: { glint: .35, color: '#fff4e0', tint: '#ffffff' },
  sunset: { glint: 1, color: '#ff8f5a', tint: '#e8b090' },
  night: { glint: .18, color: '#9fb6e6', tint: '#4a5a80' },
} as const;

export interface SeaGrid { origin: [number, number]; cell: number; cols: number; rows: number; heights: Float32Array; seaLevel: number; groundOffset: number }

export function seaMaterial(grid: SeaGrid) {
  // Heights as a half-float texture: R16F is linearly filterable in core WebGL2 (32-bit float is not without
  // OES_texture_float_linear), so the shoreline samples smoothly everywhere.
  const half = new Uint16Array(grid.heights.length);
  for (let i = 0; i < half.length; i++) half[i] = T.DataUtils.toHalfFloat(grid.heights[i]);
  const tex = new T.DataTexture(half, grid.cols, grid.rows, T.RedFormat, T.HalfFloatType);
  tex.magFilter = tex.minFilter = T.LinearFilter; tex.needsUpdate = true;
  const ext = new T.Vector4(grid.origin[0], grid.origin[1], grid.origin[0] + (grid.cols - 1) * grid.cell, grid.origin[1] + (grid.rows - 1) * grid.cell);
  return new T.ShaderMaterial({
    fog: true,
    uniforms: {
      ...T.UniformsLib.fog, ...SEA,
      uHeights: { value: tex }, uExt: { value: ext }, uSeaLevel: { value: grid.seaLevel }, uOffset: { value: grid.groundOffset },
      uShallow: { value: new T.Color('#62c8d2') }, uMid: { value: new T.Color('#2f93a6') }, uDeep: { value: new T.Color('#1f6f86') }, uFoam: { value: new T.Color('#ffffff') },
    },
    vertexShader: `#include <fog_pars_vertex>
varying vec3 vW;
void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vec4 mvPosition = viewMatrix * w; gl_Position = projectionMatrix * mvPosition;
#include <fog_vertex>
}`,
    fragmentShader: `#include <fog_pars_fragment>
uniform sampler2D uHeights; uniform vec4 uExt; uniform float uSeaLevel; uniform float uOffset;
uniform vec3 uShallow; uniform vec3 uMid; uniform vec3 uDeep; uniform vec3 uFoam;
uniform float uTime; uniform vec3 uSun; uniform float uGlint; uniform vec3 uGlintColor; uniform vec3 uTint;
varying vec3 vW;
float sHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float sNoise(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(sHash(i), sHash(i + vec2(1, 0)), u.x), mix(sHash(i + vec2(0, 1)), sHash(i + vec2(1, 1)), u.x), u.y); }
void main() {
  vec2 uv = (vW.xz - uExt.xy) / (uExt.zw - uExt.xy);
  bool inside = all(greaterThan(uv, vec2(0.0))) && all(lessThan(uv, vec2(1.0)));
  float ground = inside ? texture2D(uHeights, uv).r + uOffset : -50.0;
  float depth = uSeaLevel - ground;
  // Distance past the DEM edge pushes the colour to the deep strait.
  vec2 out2 = max(max(uExt.xy - vW.xz, vW.xz - uExt.zw), vec2(0.0));
  float far = smoothstep(0.0, 600.0, length(out2));
  vec3 c = mix(uShallow, uMid, smoothstep(.1, 1.3, depth));
  c = mix(c, uDeep, max(far, inside ? 0.0 : .6));
  // Foam: a solid line at the waterline and a broken second line a little further out, both drifting.
  float n = sNoise(vW.xz * .35 + vec2(uTime * .15, 0.0));
  float line1 = 1.0 - smoothstep(.05, .22 + .08 * n, depth);
  float wave = .5 + .5 * sin(uTime * .9 - depth * 9.0);
  float line2 = smoothstep(.62, .9, wave) * (1.0 - smoothstep(.35, .7, depth)) * step(.35, n);
  c = mix(c, uFoam, clamp(line1 * .9 + line2 * .6, 0.0, 1.0) * (inside ? 1.0 : 0.0));
  // Sun glint: reflected sun on a gently noisy surface.
  vec3 V = normalize(cameraPosition - vW);
  vec3 N = normalize(vec3((sNoise(vW.xz * .08 + uTime * .05) - .5) * .25, 1.0, (sNoise(vW.zx * .08 - uTime * .04) - .5) * .25));
  float g = max(dot(reflect(-V, N), normalize(uSun)), 0.0);
  c += uGlintColor * (pow(g, 220.0) * 1.6 + pow(g, 28.0) * .25) * uGlint;
  c *= uTint;
  gl_FragColor = vec4(c, 1.0);
#include <tonemapping_fragment>
#include <colorspace_fragment>
#include <fog_fragment>
}`,
  });
}
