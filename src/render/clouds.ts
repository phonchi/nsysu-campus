import * as T from 'three';

/** Painted cloud puffs (art-direction-v4 §2.2): camera-facing instanced cards on a wide ring, drifting
 * slowly, lit bottom-to-top with per-preset colours. One draw call; fog off so they stay readable. */
export const CLOUDS = { uTime: { value: 0 }, uBottom: { value: new T.Color('#d7e6f0') }, uTop: { value: new T.Color('#ffffff') }, uAlpha: { value: 1 } };
export const CLOUD_LOOK = {
  day: { bottom: '#d7e6f0', top: '#ffffff', alpha: .95 },
  sunset: { bottom: '#9a6a8a', top: '#ffc9a0', alpha: .95 },
  night: { bottom: '#1a2540', top: '#3b4a6e', alpha: .6 },
} as const;

function puffTexture() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 128;
  const g = c.getContext('2d')!;
  let seed = 7; const r = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  // White blobs for the shape; the shader colours bottom → top from the card's v coordinate.
  for (let i = 0; i < 14; i++) {
    const x = 40 + r() * 176, y = 70 - Math.sin((x - 40) / 176 * Math.PI) * 26 + r() * 14, rad = 16 + r() * 22;
    const gr = g.createRadialGradient(x, y, rad * .55, x, y, rad);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, rad, 0, Math.PI * 2); g.fill();
  }
  const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace; return t;
}

export function buildClouds(count: number, centre: T.Vector3) {
  const geo = new T.PlaneGeometry(1, .5);
  const mat = new T.ShaderMaterial({
    transparent: true, depthWrite: false, fog: false,
    uniforms: { ...CLOUDS, uMap: { value: puffTexture() } },
    vertexShader: `uniform float uTime; varying vec2 vUv;
void main() { vUv = uv;
  vec4 c = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  float s = length(instanceMatrix[0].xyz);
  c.x += sin(uTime * .02 + c.z * .01) * 40.0; // slow sway, never wraps
  vec4 mv = viewMatrix * vec4(c.xyz, 1.0);
  mv.xy += position.xy * vec2(s, s);
  gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform sampler2D uMap; uniform vec3 uBottom; uniform vec3 uTop; uniform float uAlpha; varying vec2 vUv;
void main() { vec4 t = texture2D(uMap, vUv); float a = t.a * smoothstep(.0, .3, vUv.y); if (a < .02) discard;
  gl_FragColor = vec4(mix(uBottom, uTop, smoothstep(.15, .8, vUv.y)), a * uAlpha);
  #include <colorspace_fragment>
}`,
  });
  const mesh = new T.InstancedMesh(geo, mat, count), o = new T.Object3D();
  let seed = 11; const r = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < count; i++) {
    const a = r() * Math.PI * 2, d = 420 + r() * 520;
    o.position.set(centre.x + Math.cos(a) * d, 110 + r() * 90, centre.z + Math.sin(a) * d); o.scale.setScalar(120 + r() * 140); o.updateMatrix();
    mesh.setMatrixAt(i, o.matrix);
  }
  mesh.name = 'Clouds'; mesh.frustumCulled = false; mesh.renderOrder = -1;
  return mesh;
}
