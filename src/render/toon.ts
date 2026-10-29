import * as T from 'three';
import { NIGHT_MATERIALS, NIGHT_FADE } from '../walk-materials';

/** Soft cel ramp (art-direction-v3 §1.1): shadow 0.46, mid 0.80, lit 1.0 with smooth 8 px edges. */
function makeRamp() {
  const n = 256, data = new Uint8Array(n * 4);
  const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  for (let i = 0; i < n; i++) {
    const x = i / (n - 1);
    const v = .46 + (.80 - .46) * smooth(.30, .38, x) + (1 - .80) * smooth(.64, .72, x);
    data.set([v * 255, v * 255, v * 255, 255], i * 4);
  }
  const tex = new T.DataTexture(data, n, 1, T.RGBAFormat);
  tex.minFilter = tex.magFilter = T.LinearFilter; tex.generateMipmaps = false; tex.colorSpace = T.NoColorSpace; tex.needsUpdate = true;
  return tex;
}
export const RAMP = makeRamp();

/** Shared per-preset uniforms; the sky lerps them with the lighting preset. */
export const TOON_UNIFORMS = {
  uShadowTint: { value: new T.Color('#b9c6e0') },
  uRimColor: { value: new T.Color('#fff1d6') },
  uRimStrength: { value: .35 },
};

/** Surfaces that never get rim light (art-direction-v3 §1.1): it turns into noise on foliage, grass and water. */
const NO_RIM = /tree|crown|frond|foliage|grass|terrain|sea|strait|beach|sand|road|zebra|ground|hill/i;

// Cool shadow band: tint the ramp's dark end, keep lit areas neutral.
const TOON_CHUNK = T.ShaderChunk.lights_toon_pars_fragment.replace(
  'vec3 irradiance = getGradientIrradiance( geometryNormal, directLight.direction ) * directLight.color;',
  'vec3 irradiance = toonTint( getGradientIrradiance( geometryNormal, directLight.direction ) ) * directLight.color;');
if (TOON_CHUNK === T.ShaderChunk.lights_toon_pars_fragment) console.warn('toon: three shader chunk changed; shadow tint disabled');

function patch(material: T.MeshToonMaterial, rim: boolean, windows = false) {
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, TOON_UNIFORMS);
    if (windows) {
      // Night windows: switch each window on/off by a hash of its world bay and storey, and black out ~1/3 of storeys.
      shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWorldPos;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
varying vec3 vWorldPos;
float winHash(vec3 c) { return fract(sin(dot(c, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
{ vec3 cell = floor(vec3(vWorldPos.x / 3.0, vWorldPos.y / 3.7, vWorldPos.z / 3.0));
  float storeyOff = step(winHash(vec3(floor(vWorldPos.x / 40.0), cell.y, floor(vWorldPos.z / 40.0))), 0.33);
  float on = step(winHash(cell), 0.55) * (1.0 - storeyOff);
  totalEmissiveRadiance *= mix(0.06, 1.0, on) * (0.8 + 0.4 * winHash(cell + 7.0)); }`)
        // Facade variety (art-direction-v4 §5.2): each 6 m bay and each storey band shifts brightness a little,
        // plus a 15 m soft patch, so long brick walls stop reading as one repeated tile.
        .replace('#include <color_fragment>', `#include <color_fragment>
{ float bay = winHash(vec3(floor(vWorldPos.x / 6.0), floor(vWorldPos.y / 3.7), floor(vWorldPos.z / 6.0)));
  vec2 q = vWorldPos.xz / 15.0; vec2 iq = floor(q); vec2 fq = fract(q); fq = fq * fq * (3.0 - 2.0 * fq);
  float patchN = mix(mix(winHash(vec3(iq, 1.0)), winHash(vec3(iq + vec2(1, 0), 1.0)), fq.x), mix(winHash(vec3(iq + vec2(0, 1), 1.0)), winHash(vec3(iq + vec2(1, 1), 1.0)), fq.x), fq.y);
  diffuseColor.rgb *= .93 + .07 * bay + .08 * patchN; }`);
    }
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform vec3 uShadowTint; uniform vec3 uRimColor; uniform float uRimStrength;`)
      // Cool shadow band: tint the ramp's dark end, keep lit areas neutral.
      .replace('#include <lights_toon_pars_fragment>', `
vec3 toonTint( vec3 irradiance ) {
  float r = clamp( ( max( max( irradiance.r, irradiance.g ), irradiance.b ) - 0.46 ) / 0.54, 0.0, 1.0 );
  return irradiance * mix( uShadowTint, vec3( 1.0 ), r );
}
${TOON_CHUNK}`)
      .replace('#include <opaque_fragment>', rim ? `float rimF = pow( 1.0 - saturate( dot( normal, normalize( vViewPosition ) ) ), 3.0 );
outgoingLight += uRimColor * uRimStrength * rimF * diffuseColor.rgb;
#include <opaque_fragment>` : '#include <opaque_fragment>');
  };
  material.customProgramCacheKey = () => (rim ? 'toon-rim' : 'toon') + (windows ? '-win' : '');
}

/** A MeshToonMaterial on the shared ramp with the campus patch. */
export function toonMaterial(params: T.MeshToonMaterialParameters = {}, rim = true, windows = false) {
  const m = new T.MeshToonMaterial({ gradientMap: RAMP, ...params });
  patch(m, rim, windows);
  return m;
}

const converted = new WeakMap<T.Material, T.Material>();

/** Convert a lit standard material to the toon equivalent, keeping colour, maps, emissive and transparency. */
function convert(source: T.Material, rim: boolean): T.Material {
  if (!(source instanceof T.MeshStandardMaterial) || source.userData.keepStandard) return source;
  const hit = converted.get(source);
  if (hit) return hit;
  const m = toonMaterial({
    name: source.name, color: source.color, map: source.map, vertexColors: source.vertexColors,
    emissive: source.emissive, emissiveMap: source.emissiveMap, emissiveIntensity: source.emissiveIntensity,
    normalMap: source.normalMap, alphaMap: source.alphaMap, aoMap: source.aoMap,
    transparent: source.transparent, opacity: source.opacity, side: source.side, alphaTest: source.alphaTest,
    depthWrite: source.depthWrite, polygonOffset: source.polygonOffset, polygonOffsetFactor: source.polygonOffsetFactor,
    polygonOffsetUnits: source.polygonOffsetUnits, clippingPlanes: source.clippingPlanes, clipShadows: source.clipShadows,
    visible: source.visible, fog: source.fog,
  }, rim, !!source.emissiveMap?.name?.includes('night windows'));
  m.userData = { ...source.userData, toonFrom: source.uuid };
  converted.set(source, m);
  // Night lighting registries hold material identities; move them to the replacement.
  if (NIGHT_MATERIALS.has(source as never)) { NIGHT_MATERIALS.delete(source as never); NIGHT_MATERIALS.add(m as never); }
  const fade = NIGHT_FADE.get(source);
  if (fade !== undefined) { NIGHT_FADE.delete(source); NIGHT_FADE.set(m, fade); }
  source.dispose();
  return m;
}

/** Walk a subtree and switch every standard material to soft toon (idempotent; skips flagged meshes). */
export function toonify(root: T.Object3D) {
  root.traverse(o => {
    if (!(o instanceof T.Mesh) || o.userData.keepStandard) return;
    let rim = true;
    for (let p: T.Object3D | null = o; p; p = p.parent) if (p.name && NO_RIM.test(p.name)) { rim = false; break; }
    o.material = Array.isArray(o.material) ? o.material.map(m => convert(m, rim)) : convert(o.material, rim);
  });
}

/** Mixed preset values for the sky's lerp (art-direction-v3 §2). */
export const TOON_PRESETS = {
  day: { shadowTint: '#b9c6e0', rim: '#fff1d6', rimI: .35 },
  sunset: { shadowTint: '#9a7fb8', rim: '#ffb070', rimI: .65 },
  night: { shadowTint: '#6c7eae', rim: '#8fb2ff', rimI: .6 },
} as const;
