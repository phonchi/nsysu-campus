import * as T from 'three';

/** Grade and bloom settings for one lighting preset (art-direction-v3 §4). */
export interface PostLook {
  exposure: number;
  bloomTight: number; bloomWide: number;
  shadowTint: T.Color; shadowAmt: number;
  highTint: T.Color; highAmt: number;
  saturation: number; contrast: number; lift: number; gain: number;
  vignette: [radius: number, softness: number, strength: number];
}

export const POST_LOOKS: Record<'day' | 'sunset' | 'night', PostLook> = {
  day: { exposure: 1.05, bloomTight: .10, bloomWide: .06, shadowTint: new T.Color('#5c6fa6'), shadowAmt: .12, highTint: new T.Color('#ffd9a3'), highAmt: .10, saturation: 1.08, contrast: 1.06, lift: .02, gain: 1.02, vignette: [.72, .45, .28] },
  sunset: { exposure: 1.0, bloomTight: .18, bloomWide: .16, shadowTint: new T.Color('#6a4f8f'), shadowAmt: .3, highTint: new T.Color('#ffb070'), highAmt: .16, saturation: 1.12, contrast: 1.08, lift: .03, gain: 1.0, vignette: [.70, .45, .36] },
  night: { exposure: .9, bloomTight: .2, bloomWide: .14, shadowTint: new T.Color('#1f2d5c'), shadowAmt: .24, highTint: new T.Color('#ffe3a8'), highAmt: .10, saturation: .8, contrast: 1.02, lift: .03, gain: 1.0, vignette: [.7, .5, .3] },
};

export function lerpLook(a: PostLook, b: PostLook, t: number): PostLook {
  const n = (x: number, y: number) => x + (y - x) * t;
  return {
    exposure: n(a.exposure, b.exposure), bloomTight: n(a.bloomTight, b.bloomTight), bloomWide: n(a.bloomWide, b.bloomWide),
    shadowTint: a.shadowTint.clone().lerp(b.shadowTint, t), shadowAmt: n(a.shadowAmt, b.shadowAmt),
    highTint: a.highTint.clone().lerp(b.highTint, t), highAmt: n(a.highAmt, b.highAmt),
    saturation: n(a.saturation, b.saturation), contrast: n(a.contrast, b.contrast), lift: n(a.lift, b.lift), gain: n(a.gain, b.gain),
    vignette: [n(a.vignette[0], b.vignette[0]), n(a.vignette[1], b.vignette[1]), n(a.vignette[2], b.vignette[2])],
  };
}

const VERT = 'varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}';

const BRIGHT = `uniform sampler2D tSrc;uniform float threshold;uniform float knee;uniform vec2 texel;varying vec2 vUv;
void main(){
  vec3 c=texture2D(tSrc,vUv+texel*vec2(-.5,-.5)).rgb+texture2D(tSrc,vUv+texel*vec2(.5,-.5)).rgb+texture2D(tSrc,vUv+texel*vec2(-.5,.5)).rgb+texture2D(tSrc,vUv+texel*vec2(.5,.5)).rgb;
  c*=.25;float br=max(c.r,max(c.g,c.b));
  float soft=clamp(br-threshold+knee,0.,2.*knee);soft=soft*soft/(4.*knee+1e-4);
  float w=max(soft,br-threshold)/max(br,1e-4);
  gl_FragColor=vec4(c*w,1.);}`;

// Jimenez 13-tap downsample.
const DOWN = `uniform sampler2D tSrc;uniform vec2 texel;varying vec2 vUv;
vec3 s(vec2 o){return texture2D(tSrc,vUv+texel*o).rgb;}
void main(){
  vec3 a=s(vec2(-2,-2)),b=s(vec2(0,-2)),c=s(vec2(2,-2)),d=s(vec2(-1,-1)),e=s(vec2(1,-1)),f=s(vec2(-2,0)),g=s(vec2(0,0)),
       h=s(vec2(2,0)),i=s(vec2(-1,1)),j=s(vec2(1,1)),k=s(vec2(-2,2)),l=s(vec2(0,2)),m=s(vec2(2,2));
  vec3 o=(d+e+i+j)*.125+(a+b+f+g)*.03125+(b+c+g+h)*.03125+(f+g+k+l)*.03125+(g+h+l+m)*.03125;
  gl_FragColor=vec4(o,1.);}`;

// 3x3 tent upsample of the coarser level, added to this level weighted.
const UP = `uniform sampler2D tCoarse;uniform sampler2D tFine;uniform vec2 texel;uniform float weight;varying vec2 vUv;
vec3 s(vec2 o){return texture2D(tCoarse,vUv+texel*o).rgb;}
void main(){
  vec3 t=(s(vec2(-1,-1))+s(vec2(1,-1))+s(vec2(-1,1))+s(vec2(1,1)))*.0625+(s(vec2(0,-1))+s(vec2(-1,0))+s(vec2(1,0))+s(vec2(0,1)))*.125+s(vec2(0))*.25;
  gl_FragColor=vec4(t+texture2D(tFine,vUv).rgb*weight,1.);}`;

const COMPOSITE = `uniform sampler2D tScene;uniform sampler2D tTight;uniform sampler2D tWide;
uniform float bloomTight;uniform float bloomWide;uniform float exposure;
uniform vec3 shadowTint;uniform float shadowAmt;uniform vec3 highTint;uniform float highAmt;
uniform float saturation;uniform float contrast;uniform float lift;uniform float gain;uniform vec3 vignette;uniform float aspect;
varying vec2 vUv;
vec3 RRTAndODTFit(vec3 v){vec3 a=v*(v+.0245786)-.000090537;vec3 b=v*(.983729*v+.4329510)+.238081;return a/b;}
vec3 aces(vec3 c){const mat3 i=mat3(vec3(.59719,.07600,.02840),vec3(.35458,.90834,.13383),vec3(.04823,.01566,.83777));
  const mat3 o=mat3(vec3(1.60475,-.10208,-.00327),vec3(-.53108,1.10813,-.07276),vec3(-.07367,-.00605,1.07602));
  c*=exposure/.6;c=i*c;c=RRTAndODTFit(c);c=o*c;return clamp(c,0.,1.);}
vec3 toSRGB(vec3 c){return mix(c*12.92,1.055*pow(c,vec3(1./2.4))-.055,step(.0031308,c));}
void main(){
  vec3 c=texture2D(tScene,vUv).rgb+texture2D(tTight,vUv).rgb*bloomTight+texture2D(tWide,vUv).rgb*bloomWide;
  c=aces(c);
  float l=dot(c,vec3(.2126,.7152,.0722));
  c=mix(c,c*shadowTint*2.,shadowAmt*(1.-smoothstep(.0,.35,l)));
  c=mix(c,c*highTint*1.25,highAmt*smoothstep(.7,1.,l));
  c=mix(vec3(l),c,saturation);
  c=clamp((c-.5)*contrast+.5,0.,1.);
  c=c*(gain-lift)+lift;
  vec2 d=(vUv-.5)*vec2(aspect,1.);float v=smoothstep(vignette.x,vignette.x-vignette.y,length(d)*1.3);
  c=mix(c*mix(shadowTint*1.6,vec3(1.),.5),c,mix(1.,v,vignette.z));
  gl_FragColor=vec4(toSRGB(clamp(c,0.,1.)),1.);}`;

type RT = T.WebGLRenderTarget;

/** Scene → HDR MSAA target → two bloom pyramids → composite with ACES, grade and vignette.
 * Hand-written (no EffectComposer) so every pass and its cost is explicit. */
export class PostPipeline {
  private scene: RT;
  private tight: RT[] = [];
  private wide: RT[] = [];
  private tightUp: RT[] = [];
  private wideUp: RT[] = [];
  private quad = new T.Mesh(new T.PlaneGeometry(2, 2));
  private cam = new T.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private mats: Record<'bright' | 'down' | 'up' | 'composite', T.ShaderMaterial>;
  private width = 1;
  private height = 1;
  /** Number of bloom layers: 2 (desktop), 1 (wide only), 0 (off). */
  bloomLayers = 2;
  look: PostLook = POST_LOOKS.day;

  readonly samples: number;
  constructor(private renderer: T.WebGLRenderer, samples = 4) {
    this.samples = Math.min(samples, renderer.capabilities.maxSamples);
    const opts = { type: T.HalfFloatType, depthBuffer: false, magFilter: T.LinearFilter, minFilter: T.LinearFilter } as const;
    this.scene = new T.WebGLRenderTarget(1, 1, { type: T.HalfFloatType, samples: this.samples });
    for (let i = 0; i < 3; i++) { this.tight.push(new T.WebGLRenderTarget(1, 1, opts)); this.tightUp.push(new T.WebGLRenderTarget(1, 1, opts)); }
    for (let i = 0; i < 5; i++) { this.wide.push(new T.WebGLRenderTarget(1, 1, opts)); this.wideUp.push(new T.WebGLRenderTarget(1, 1, opts)); }
    const mat = (fragmentShader: string, uniforms: Record<string, T.IUniform>) =>
      new T.ShaderMaterial({ vertexShader: VERT, fragmentShader, uniforms, depthTest: false, depthWrite: false });
    this.mats = {
      bright: mat(BRIGHT, { tSrc: { value: null }, threshold: { value: 1 }, knee: { value: .1 }, texel: { value: new T.Vector2() } }),
      down: mat(DOWN, { tSrc: { value: null }, texel: { value: new T.Vector2() } }),
      up: mat(UP, { tCoarse: { value: null }, tFine: { value: null }, texel: { value: new T.Vector2() }, weight: { value: 1 } }),
      composite: mat(COMPOSITE, {
        tScene: { value: null }, tTight: { value: null }, tWide: { value: null }, bloomTight: { value: 0 }, bloomWide: { value: 0 }, exposure: { value: 1 },
        shadowTint: { value: new T.Color() }, shadowAmt: { value: 0 }, highTint: { value: new T.Color() }, highAmt: { value: 0 },
        saturation: { value: 1 }, contrast: { value: 1 }, lift: { value: 0 }, gain: { value: 1 }, vignette: { value: new T.Vector3() }, aspect: { value: 1 },
      }),
    };
    this.quad.frustumCulled = false;
  }

  setSize(w: number, h: number) {
    this.width = Math.max(1, Math.floor(w)); this.height = Math.max(1, Math.floor(h));
    this.scene.setSize(this.width, this.height);
    this.tight.forEach((rt, i) => { const d = 2 ** (i + 1); rt.setSize(Math.ceil(this.width / d), Math.ceil(this.height / d)); this.tightUp[i].setSize(Math.ceil(this.width / d), Math.ceil(this.height / d)); });
    this.wide.forEach((rt, i) => { const d = 2 ** (i + 2); rt.setSize(Math.ceil(this.width / d), Math.ceil(this.height / d)); this.wideUp[i].setSize(Math.ceil(this.width / d), Math.ceil(this.height / d)); });
  }

  private pass(material: T.ShaderMaterial, target: RT | null) {
    this.quad.material = material;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.quad, this.cam);
  }

  /** Bright-pass then pyramid down/up; returns the accumulated full-resolution-of-level-0 result. */
  private pyramid(levels: RT[], ups: RT[], threshold: number, knee: number, weights: number[]) {
    const { bright, down, up } = this.mats;
    bright.uniforms.tSrc.value = this.scene.texture; bright.uniforms.threshold.value = threshold; bright.uniforms.knee.value = knee;
    bright.uniforms.texel.value.set(1 / this.width, 1 / this.height);
    this.pass(bright, levels[0]);
    for (let i = 1; i < levels.length; i++) {
      down.uniforms.tSrc.value = levels[i - 1].texture;
      down.uniforms.texel.value.set(1 / levels[i - 1].width, 1 / levels[i - 1].height);
      this.pass(down, levels[i]);
    }
    let coarse = levels[levels.length - 1];
    for (let i = levels.length - 2; i >= 0; i--) {
      up.uniforms.tCoarse.value = coarse.texture; up.uniforms.tFine.value = levels[i].texture;
      up.uniforms.texel.value.set(1 / coarse.width, 1 / coarse.height); up.uniforms.weight.value = weights[i] / weights[i + 1];
      this.pass(up, ups[i]);
      coarse = ups[i];
    }
    return coarse;
  }

  render(scene: T.Scene, camera: T.Camera) {
    const r = this.renderer, toneMapping = r.toneMapping;
    r.toneMapping = T.NoToneMapping;
    r.setRenderTarget(this.scene);
    r.render(scene, camera);
    const look = this.look, c = this.mats.composite.uniforms;
    c.tScene.value = this.scene.texture;
    if (this.bloomLayers >= 2) c.tTight.value = this.pyramid(this.tight, this.tightUp, .85, .15, [.5, .3, .2]).texture;
    if (this.bloomLayers >= 1) c.tWide.value = this.pyramid(this.wide, this.wideUp, .55, .30, [.30, .25, .2, .15, .1]).texture;
    c.bloomTight.value = this.bloomLayers >= 2 ? look.bloomTight : 0;
    c.bloomWide.value = this.bloomLayers >= 1 ? look.bloomWide : 0;
    if (!c.tTight.value) c.tTight.value = this.scene.texture;
    if (!c.tWide.value) c.tWide.value = this.scene.texture;
    c.exposure.value = look.exposure; c.shadowTint.value.copy(look.shadowTint); c.shadowAmt.value = look.shadowAmt;
    c.highTint.value.copy(look.highTint); c.highAmt.value = look.highAmt; c.saturation.value = look.saturation;
    c.contrast.value = look.contrast; c.lift.value = look.lift; c.gain.value = look.gain;
    c.vignette.value.set(...look.vignette); c.aspect.value = this.width / this.height;
    this.pass(this.mats.composite, null);
    r.toneMapping = toneMapping;
  }

  dispose() {
    this.scene.dispose();
    for (const rt of [...this.tight, ...this.tightUp, ...this.wide, ...this.wideUp]) rt.dispose();
    for (const m of Object.values(this.mats)) m.dispose();
    this.quad.geometry.dispose();
  }
}
