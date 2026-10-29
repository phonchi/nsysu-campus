/** Sky dome and lighting presets (art-direction.md §2). Display-only. */
import * as T from 'three';
import { NIGHT_MATERIALS, NIGHT_FADE } from './walk-materials';
import { TOON_UNIFORMS, TOON_PRESETS } from './render/toon';
import { FOLIAGE, LEAF_TINT } from './render/foliage';
import { SEA, SEA_LOOK } from './render/sea';
import { LAWN_LIGHT, LAWN_FLOOR, LAWN_TINT } from './render/ground';
import { CLOUDS, CLOUD_LOOK } from './render/clouds';
import { setOutlineNight } from './render/outline';

export type SkyPreset='day'|'sunset'|'night';
interface Preset {hemiSky:string;hemiGround:string;hemi:number;sun:string;sunI:number;elev:number;azim:number;fog:string;walk:[number,number];bird:[number,number];top:string;horizon:string;exposure:number;ambient:number;glow:number;}
export const PRESETS:Record<SkyPreset,Preset>={
 day:{hemiSky:'#dff2ff',hemiGround:'#8fb46a',hemi:1.15,sun:'#fff4e0',sunI:2.6,elev:55,azim:150,fog:'#cfe9f3',walk:[160,620],bird:[700,1800],top:'#4f9ad8',horizon:'#d7eef7',exposure:1.05,ambient:0,glow:0},
 sunset:{hemiSky:'#ffc08a',hemiGround:'#8a7a9a',hemi:1.18,sun:'#ff9a52',sunI:2.2,elev:9,azim:262,fog:'#f4b98c',walk:[120,520],bird:[600,1800],top:'#4a4f9a',horizon:'#ffb070',exposure:1.0,ambient:0,glow:.7},
 night:{hemiSky:'#4a6aa0',hemiGround:'#2a3630',hemi:.9,sun:'#9fb6e6',sunI:.55,elev:40,azim:300,fog:'#101a28',walk:[90,420],bird:[400,1800],top:'#060b1a',horizon:'#1f3353',exposure:.95,ambient:.6,glow:1.6},
};
export const PRESET_LABEL:Record<SkyPreset,string>={day:'白天',sunset:'西子灣夕陽',night:'夜晚'};

export class CampusSky {
 readonly dome:T.Mesh;readonly hemi=new T.HemisphereLight();readonly ambient=new T.AmbientLight('#1c2a44',0);
 private readonly uniforms={top:{value:new T.Color()},horizon:{value:new T.Color()},ground:{value:new T.Color('#9fbf8a')},stars:{value:0}};
 private from:Preset=PRESETS.day;private to:Preset=PRESETS.day;private t=1;preset:SkyPreset='day';
 readonly sunDir=new T.Vector3();
 constructor(private readonly scene:T.Scene,private readonly sun:T.DirectionalLight,private readonly renderer:T.WebGLRenderer){
  const material=new T.ShaderMaterial({side:T.BackSide,depthWrite:false,fog:false,uniforms:this.uniforms,
   vertexShader:'varying vec3 vDir;void main(){vDir=normalize(position);vec4 p=modelViewMatrix*vec4(position,1.);gl_Position=projectionMatrix*p;gl_Position.z=gl_Position.w;}',
   fragmentShader:'uniform vec3 top;uniform vec3 horizon;uniform vec3 ground;uniform float stars;varying vec3 vDir;float hash(vec3 p){return fract(sin(dot(p,vec3(12.9898,78.233,45.164)))*43758.5453);}void main(){float h=vDir.y;vec3 c=h>0.?mix(horizon,top,pow(clamp(h,0.,1.),.55)):mix(horizon,ground,clamp(-h*6.,0.,1.));vec3 q=floor(normalize(vDir)*380.);float s=step(.9975,hash(q))*smoothstep(.17,.4,h)*stars;c+=vec3(s);vec3 m=normalize(vec3(.35,.55,-.76));c+=vec3(1.,.97,.86)*smoothstep(.9993,.9997,dot(normalize(vDir),m))*stars;gl_FragColor=vec4(c,1.);}'});
  this.dome=new T.Mesh(new T.SphereGeometry(2400,32,16),material);this.dome.name='Sky dome';this.dome.frustumCulled=false;this.dome.renderOrder=-1;
  scene.add(this.dome,this.hemi,this.ambient);scene.background=null;this.apply(PRESETS.day,PRESETS.day,1,false);
 }
 /** Preset being left and blend progress, for post-processing looks that follow the lighting. */
 fromPreset:SkyPreset='day';
 get progress(){return this.t;}
 set(preset:SkyPreset,instant=false){if(preset===this.preset&&this.t>=1)return;this.from=this.current();this.to=PRESETS[preset];this.fromPreset=this.t>=1?this.preset:this.fromPreset;this.preset=preset;this.t=instant?1:0;}
 private snapshot?:Preset;
 /** World size of one shadow-map texel; set by the runtime when it resizes the shadow frustum. */
 shadowTexel=0;
 private snapped=new T.Vector3();private tmpF=new T.Vector3();private tmpR=new T.Vector3();private tmpU=new T.Vector3();private up=new T.Vector3(0,1,0);
 private current():Preset{return this.snapshot??this.to;}
 /** Call each frame; centre is the camera/player position used for the sun and dome. */
 update(dt:number,centre:T.Vector3,overview:boolean){
  if(this.t<1)this.t=Math.min(1,this.t+dt/1.2);
  FOLIAGE.uTime.value+=dt;SEA.uTime.value+=dt;CLOUDS.uTime.value+=dt;
  this.dome.position.copy(centre);this.apply(this.from,this.to,this.t,overview);
  const e=T.MathUtils.degToRad(T.MathUtils.lerp(this.from.elev,this.to.elev,this.t)),a=T.MathUtils.degToRad(T.MathUtils.lerp(this.from.azim,this.to.azim,this.t));
  // Azimuth measured from north (-z) clockwise toward east (+x).
  this.sunDir.set(Math.sin(a)*Math.cos(e),Math.sin(e),-Math.cos(a)*Math.cos(e));
  // Snap the shadow frustum to whole shadow texels in light space so shadow edges never crawl while walking.
  const c=this.snapped.copy(centre);if(this.shadowTexel>0){const fwd=this.tmpF.copy(this.sunDir).negate(),right=this.tmpR.crossVectors(fwd,this.up).normalize(),up=this.tmpU.crossVectors(right,fwd);const r=c.dot(right),u=c.dot(up),q=this.shadowTexel;c.addScaledVector(right,Math.round(r/q)*q-r).addScaledVector(up,Math.round(u/q)*q-u);}
  this.sun.target.position.copy(c);this.sun.position.copy(c).addScaledVector(this.sunDir,overview?320:160);
 }
 private apply(a:Preset,b:Preset,t:number,overview:boolean){
  const c=(x:string,y:string)=>new T.Color(x).lerp(new T.Color(y),t),n=(x:number,y:number)=>x+(y-x)*t;
  this.hemi.color.copy(c(a.hemiSky,b.hemiSky));this.hemi.groundColor.copy(c(a.hemiGround,b.hemiGround));this.hemi.intensity=n(a.hemi,b.hemi);
  this.sun.color.copy(c(a.sun,b.sun));this.sun.intensity=n(a.sunI,b.sunI);this.ambient.intensity=n(a.ambient,b.ambient);
  this.uniforms.top.value.copy(c(a.top,b.top));this.uniforms.horizon.value.copy(c(a.horizon,b.horizon));this.uniforms.ground.value.copy(c(a.hemiGround,b.hemiGround)).lerp(this.uniforms.horizon.value,.5);
  const fog=this.scene.fog;if(fog instanceof T.Fog){fog.color.copy(c(a.fog,b.fog));const [near,far]=overview?[n(a.bird[0],b.bird[0]),n(a.bird[1],b.bird[1])]:[n(a.walk[0],b.walk[0]),n(a.walk[1],b.walk[1])];fog.near=near;fog.far=far;}
  this.renderer.toneMappingExposure=n(a.exposure,b.exposure);this.renderer.setClearColor(fog instanceof T.Fog?fog.color:'#cfe9f3');
  const ta=TOON_PRESETS[this.fromPreset],tb=TOON_PRESETS[this.preset];TOON_UNIFORMS.uShadowTint.value.copy(c(ta.shadowTint,tb.shadowTint));TOON_UNIFORMS.uRimColor.value.copy(c(ta.rim,tb.rim));TOON_UNIFORMS.uRimStrength.value=n(ta.rimI,tb.rimI);
  { const sa=SEA_LOOK[this.fromPreset],sb=SEA_LOOK[this.preset];SEA.uGlint.value=n(sa.glint,sb.glint);SEA.uGlintColor.value.copy(c(sa.color,sb.color));SEA.uTint.value.copy(c(sa.tint,sb.tint));SEA.uSun.value.copy(this.sunDir);
    const ca=CLOUD_LOOK[this.fromPreset],cb=CLOUD_LOOK[this.preset];CLOUDS.uBottom.value.copy(c(ca.bottom,cb.bottom));CLOUDS.uTop.value.copy(c(ca.top,cb.top));CLOUDS.uAlpha.value=n(ca.alpha,cb.alpha); }
  LAWN_LIGHT.uLawnFloor.value=n(LAWN_FLOOR[this.fromPreset],LAWN_FLOOR[this.preset]);LAWN_LIGHT.uLawnTint.value.copy(c(LAWN_TINT[this.fromPreset],LAWN_TINT[this.preset]));
  FOLIAGE.uLeafTint.value.copy(c(LEAF_TINT[this.fromPreset],LEAF_TINT[this.preset]));FOLIAGE.uWind.value=n(this.fromPreset==='sunset'?1.4:1,this.preset==='sunset'?1.4:1);
  const glow=n(a.glow,b.glow);setOutlineNight(T.MathUtils.clamp((glow-.7)/.9,0,1)*.9);for(const m of NIGHT_MATERIALS)m.emissiveIntensity=glow;for(const [m,o] of NIGHT_FADE){m.opacity=o*glow/1.6;m.visible=glow>.05;}this.uniforms.stars.value=T.MathUtils.clamp((glow-.8)/.8,0,1);
  if(t>=1)this.snapshot={...b};else this.snapshot=undefined;
 }
 dispose(){this.dome.geometry.dispose();(this.dome.material as T.Material).dispose();this.scene.remove(this.dome,this.hemi,this.ambient);}
}
