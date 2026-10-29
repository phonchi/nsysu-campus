import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { toonMaterial } from './toon';

/** Stylized trees (art-direction-v4 §3): leaf-card crowns whose normals point out of each crown lobe, so the
 * toon ramp lights a whole tree as one soft volume; wind sway in the vertex shader; one InstancedMesh per
 * family for leaves and one for trunks. Hill forest keeps the cheaper v3 crowns. */
export type Family = 'banyan' | 'flame' | 'almond' | 'coast' | 'hill';

/** Shared uniforms: time (wind), wind strength (sunset sea breeze) and the per-preset leaf tint. */
export const FOLIAGE = { uTime: { value: 0 }, uWind: { value: 1 }, uLeafTint: { value: new T.Color('#ffffff') } };
export const LEAF_TINT = { day: '#ffffff', sunset: '#ffd4b0', night: '#8090c0' } as const;

const RAMPS: Record<Family, [string, string, string]> = {
  banyan: ['#3f8a4c', '#5fae48', '#8fcf62'],
  flame: ['#4d9241', '#6cb347', '#9ad15a'],
  almond: ['#3c7f3e', '#4d9a44', '#7fc156'],
  coast: ['#8fa893', '#a9bba6', '#c9d6c3'],
  hill: ['#3f8343', '#46863f', '#6fa65a'],
};
const TRUNK = '#6e5440';

const rng = (seed: number) => () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };

/** 256² alpha texture, 2×2 variants of a painted leaf clump: shade underneath, mid body, lit top, ink gaps. */
function leafTexture(f: Family) {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d')!, [shade, mid, lit] = RAMPS[f], r = rng(f.length * 97 + 11);
  for (let v = 0; v < 4; v++) {
    const ox = (v % 2) * 128, oy = Math.floor(v / 2) * 128;
    g.save(); g.beginPath(); g.rect(ox, oy, 128, 128); g.clip();
    // Far hill trees are seen at low mip levels where scattered leaves average out to specks: give each clump a
    // solid core so the forest stays a soft canopy at distance.
    if (f === 'hill') { g.fillStyle = shade; g.beginPath(); g.ellipse(ox + 64, oy + 66, 46, 40, 0, 0, Math.PI * 2); g.fill(); }
    const n = f === 'flame' ? 46 : f === 'coast' ? 18 : 26, size = f === 'flame' ? 9 : f === 'almond' ? 12 : f === 'coast' ? 17 : 15;
    for (const [col, k, dy] of [[shade, 1.1, 10], [mid, 1, 0], [lit, .75, -12]] as const) {
      g.fillStyle = col;
      for (let i = 0; i < n; i++) {
        const a = r() * Math.PI * 2, rad = Math.sqrt(r()) * 42;
        const x = ox + 64 + Math.cos(a) * rad, y = oy + 64 + Math.sin(a) * rad * .8 + dy * (col === lit ? (1 - rad / 60) : 1);
        g.beginPath(); g.ellipse(x, y, size * k * (.7 + r() * .5), size * k * (.45 + r() * .3), r() * Math.PI, 0, Math.PI * 2); g.fill();
      }
    }
    // Leaf gaps: thin dark strokes inside the clump.
    g.strokeStyle = shade; g.lineWidth = 2;
    for (let i = 0; i < 10; i++) { const x = ox + 34 + r() * 60, y = oy + 34 + r() * 60; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (r() - .5) * 16, y + 6 + r() * 6); g.stroke(); }
    if (f === 'flame') { g.fillStyle = '#e8452f'; for (let i = 0; i < 9; i++) { const a = r() * Math.PI * 2, rad = 20 + r() * 26; g.beginPath(); g.arc(ox + 64 + Math.cos(a) * rad, oy + 50 + Math.sin(a) * rad * .5, 4 + r() * 3, 0, Math.PI * 2); g.fill(); } }
    g.restore();
  }
  // Opaque trunk swatch in the top-left corner (outside every clump): trunks share the leaf mesh and material.
  g.fillStyle = TRUNK; g.fillRect(0, 0, 16, 16);
  const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace; t.anisotropy = 4; t.generateMipmaps = true;
  return t;
}

interface Lobe { c: T.Vector3; r: T.Vector3 }
/** Crown lobes per family, in tree-local metres (origin at the trunk foot). */
function lobes(f: Family): Lobe[] {
  const L = (x: number, y: number, z: number, rx: number, ry: number, rz: number) => ({ c: new T.Vector3(x, y, z), r: new T.Vector3(rx, ry, rz) });
  switch (f) {
    case 'banyan': return [L(0, 4.6, 0, 3.4, 1.7, 3.2), L(-1.6, 5.4, .8, 1.9, 1.3, 1.8), L(1.5, 5.6, -.6, 2, 1.3, 1.9), L(.2, 6.1, -.2, 1.6, 1, 1.6)];
    case 'flame': return [L(0, 4.4, 0, 4.2, 1, 4), L(-1.8, 4.8, 1.2, 2.2, .7, 2), L(1.9, 4.9, -1, 2.2, .7, 2.1)];
    case 'almond': return [L(0, 3.2, 0, 2.6, .55, 2.6), L(0, 5, 0, 2.1, .5, 2.1), L(0, 6.7, 0, 1.5, .45, 1.5), L(0, 8.1, 0, .9, .45, .9)];
    case 'coast': return [L(0, .9, 0, 1.2, .8, 1.1), L(.6, 1.2, .3, .8, .6, .8)];
    case 'hill': return [L(0, 3.6, 0, 2.4, 1.9, 2.4)];
  }
}

/** Leaf cards scattered in the lobes: cross quads facing random directions, UV to one of four variants,
 * normals = direction from the lobe centre (smooth volume), colour = baked AO (underside darker). */
export function crownGeometry(f: Family, density = 1) {
  const r = rng(f.length * 31 + 7), pos: number[] = [], nor: number[] = [], uv: number[] = [], col: number[] = [], idx: number[] = [];
  const counts: Record<Family, number> = { banyan: 24, flame: 20, almond: 22, coast: 6, hill: 4 };
  const ls = lobes(f), total = Math.max(4, Math.round(counts[f] * density)), top = Math.max(...ls.map(l => l.c.y + l.r.y)), bottom = Math.min(...ls.map(l => l.c.y - l.r.y));
  const tmp = new T.Vector3(), n = new T.Vector3(), q = new T.Quaternion(), e = new T.Euler();
  const vol = ls.map(l => l.r.x * l.r.y * l.r.z), sum = vol.reduce((a, b) => a + b, 0);
  for (let k = 0; k < total; k++) {
    let pick = r() * sum, li = 0; while (pick > vol[li] && li < ls.length - 1) pick -= vol[li++];
    const l = ls[li];
    // Point inside the lobe, biased to the surface so the silhouette stays full.
    const a = r() * Math.PI * 2, b = Math.acos(2 * r() - 1), s = .55 + .45 * Math.cbrt(r());
    const c = new T.Vector3(Math.sin(b) * Math.cos(a) * l.r.x * s, Math.cos(b) * l.r.y * s, Math.sin(b) * Math.sin(a) * l.r.z * s).add(l.c);
    const size = (f === 'coast' ? 1.1 : f === 'hill' ? 3.6 : 1.7) * (.8 + r() * .5);
    const variant = Math.floor(r() * 4), u0 = (variant % 2) * .5, v0 = Math.floor(variant / 2) * .5;
    e.set((r() - .5) * 1.2, r() * Math.PI, (r() - .5) * 1.2); q.setFromEuler(e);
    for (const turn of [0, Math.PI / 2]) {
      const base = pos.length / 3, qt = q.clone().multiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), turn));
      for (const [x, y, u, v] of [[-1, -1, 0, 0], [1, -1, .5, 0], [1, 1, .5, .5], [-1, 1, 0, .5]]) {
        tmp.set(x * size / 2, y * size / 2, 0).applyQuaternion(qt).add(c);
        pos.push(tmp.x, tmp.y, tmp.z);
        n.copy(tmp).sub(l.c).divide(l.r).normalize(); n.y += .25; n.normalize(); // slightly up: tops catch the sun
        nor.push(n.x, n.y, n.z);
        uv.push(u0 + u, 1 - (v0 + .5 - v));
        const ao = .66 + .34 * T.MathUtils.smoothstep(tmp.y, bottom, top);
        col.push(ao, ao, ao);
      }
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new T.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new T.Float32BufferAttribute(col, 3));
  g.setIndex(idx); g.computeBoundingSphere();
  g.userData.height = top;
  return g;
}

/** Trunk (and branches / aerial roots) per family, tree-local metres. */
export function trunkGeometry(f: Family) {
  const parts: T.BufferGeometry[] = [];
  const limb = (a: T.Vector3, b: T.Vector3, r0: number, r1: number) => {
    const d = b.clone().sub(a), g = new T.CylinderGeometry(r1, r0, d.length(), r0 > .2 ? 6 : 4, 1, true);
    g.applyQuaternion(new T.Quaternion().setFromUnitVectors(new T.Vector3(0, 1, 0), d.clone().normalize()));
    g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2); parts.push(g);
  };
  const V = (x: number, y: number, z: number) => new T.Vector3(x, y, z);
  switch (f) {
    case 'banyan':
      limb(V(0, 0, 0), V(0, 3.4, 0), .45, .32);
      for (const [x, z] of [[1.6, .4], [-1.4, .9], [.3, -1.7], [-.8, -1.2]]) limb(V(x, 0, z), V(x * .9, 3.6, z * .9), .05, .04); // aerial roots
      for (const [x, z] of [[1.4, .3], [-1.3, .7], [.2, -1.4]]) limb(V(0, 3, 0), V(x, 4.4, z), .2, .12);
      break;
    case 'flame':
      limb(V(0, 0, 0), V(0, 2.6, 0), .28, .2);
      for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2 + .3; limb(V(0, 2.4, 0), V(Math.cos(a) * 2.8, 4.1, Math.sin(a) * 2.8), .14, .06); }
      break;
    case 'almond':
      limb(V(0, 0, 0), V(0, 8.2, 0), .22, .1);
      for (const [y, rr] of [[3.1, 2.2], [4.9, 1.8], [6.6, 1.3]]) for (let i = 0; i < 2; i++) { const a = i / 2 * Math.PI * 2 + y; limb(V(0, y - .3, 0), V(Math.cos(a) * rr, y, Math.sin(a) * rr), .06, .03); }
      break;
    case 'coast': limb(V(0, 0, 0), V(0, .5, 0), .12, .08); break;
    case 'hill': limb(V(0, 0, 0), V(0, 2, 0), .18, .12); break;
  }
  const g = parts.length > 1 ? mergeAll(parts) : parts[0];
  return g;
}
function mergeAll(gs: T.BufferGeometry[]) {
  let n = 0, i = 0; for (const g of gs) { n += g.attributes.position.count; i += g.index!.count; }
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), idx: number[] = []; let o = 0;
  for (const g of gs) { pos.set(g.attributes.position.array as Float32Array, o * 3); nor.set(g.attributes.normal.array as Float32Array, o * 3); for (const k of g.index!.array) idx.push(k + o); o += g.attributes.position.count; g.dispose(); }
  const m = new T.BufferGeometry(); m.setAttribute('position', new T.BufferAttribute(pos, 3)); m.setAttribute('normal', new T.BufferAttribute(nor, 3)); m.setIndex(idx); void i;
  return m;
}

/** Leaf material: toon ramp, alpha-tested cards, no rim; wind sway grows with height in the crown. */
export function leafMaterial(f: Family) {
  const m = toonMaterial({ map: leafTexture(f), alphaTest: .5, side: T.DoubleSide, vertexColors: true, name: `leaf ${f}` }, false);
  const base = m.onBeforeCompile;
  m.onBeforeCompile = (sh, r) => {
    base.call(m, sh, r);
    Object.assign(sh.uniforms, FOLIAGE);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime; uniform float uWind;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
{ vec4 wp = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
  wp = instanceMatrix * wp;
  #endif
  float h = clamp(transformed.y / 8.0, 0.0, 1.0);
  float w = sin(uTime * 1.3 + wp.x * .35 + wp.z * .2) + .5 * sin(uTime * 2.7 + wp.x * .9);
  transformed.xz += vec2(w, w * .6) * .06 * uWind * h * 1.8; }`);
    // Beyond ~450 m trees are fog-coloured specks on the ridge line: dither them out (the fogged hill stays).
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec3 uLeafTint;')
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
{ float far = smoothstep(420.0, 520.0, length(vViewPosition));
  if (far > 0.0 && fract(sin(dot(floor(gl_FragCoord.xy), vec2(12.9898, 78.233))) * 43758.5453) < far) discard; }`)
      .replace('#include <opaque_fragment>', 'outgoingLight *= uLeafTint;\n#include <opaque_fragment>');
  };
  m.customProgramCacheKey = () => 'toon-leaf';
  return m;
}

export interface TreeSpot { x: number; y: number; z: number; s: number; f: Family; yaw?:number }
export interface TreeBore { inverse:T.Matrix4; bounds:T.Box3 }

/** Assign the existing family/cell random orientation before removing any spots. */
export function assignTreeYaw(spots:readonly TreeSpot[]):TreeSpot[]{
 const output=spots.map(t=>({...t})),r=rng(2027);
 for(const f of ['banyan','flame','almond','coast','hill'] as Family[]){const cells=new Map<string,TreeSpot[]>();for(const t of output.filter(t=>t.f===f)){const key=`${Math.floor(t.x/320)},${Math.floor(t.z/320)}`;(cells.get(key)??cells.set(key,[]).get(key)!).push(t);}
  for(const list of cells.values())for(const t of list){const yaw=r()*Math.PI*2;if(t.yaw===undefined)t.yaw=yaw;r();r();r();}
 }return output;
}
/** Same indexed triangles as the render mesh; texture construction is intentionally separate. */
export function treeGeometry(f:Family,density=1){
 const crown=crownGeometry(f,density),trunk=trunkGeometry(f),n=trunk.attributes.position.count;trunk.setAttribute('uv',new T.Float32BufferAttribute(new Array(n).fill(0).flatMap(()=>[8/256,1-8/256]),2));trunk.setAttribute('color',new T.Float32BufferAttribute(new Array(n*3).fill(.9),3));const g=mergeGeometries([crown,trunk],false)!;crown.dispose();trunk.dispose();return g;
}
/** Actual triangle/OBB intersection, with the maximum leaf-wind travel included. */
export function treeBoreTriangles(spot:TreeSpot,bore:TreeBore,geometry:T.BufferGeometry,windMargin=.24):number{
 const matrix=new T.Matrix4().compose(new T.Vector3(spot.x,spot.y,spot.z),new T.Quaternion().setFromAxisAngle(new T.Vector3(0,1,0),spot.yaw??0),new T.Vector3(spot.s,spot.s,spot.s)).premultiply(bore.inverse);
 geometry.computeBoundingBox();const bounds=geometry.boundingBox!.clone().applyMatrix4(matrix),box=bore.bounds.clone().expandByScalar(windMargin*spot.s);if(!bounds.intersectsBox(box))return 0;
 const pos=geometry.attributes.position,index=geometry.index,count=index?.count??pos.count,triangle=new T.Triangle();let hits=0;
 for(let i=0;i<count;i+=3){for(const [point,k] of [[triangle.a,0],[triangle.b,1],[triangle.c,2]] as const)point.fromBufferAttribute(pos,index?index.getX(i+k):i+k).applyMatrix4(matrix);if(box.intersectsTriangle(triangle))hits++;}return hits;
}
/** Filter before instancing: removed trees can leave neither a visible mesh nor a trunk collider. */
export function filterTreeSpots(spots:readonly TreeSpot[],bores:readonly TreeBore[],soilAt?:(x:number,z:number)=>unknown):TreeSpot[]{
 const geometries=new Map<Family,T.BufferGeometry>();
 const kept=spots.filter(t=>{if(soilAt&&!soilAt(t.x,t.z))return false;
  for(const bore of bores){let g=geometries.get(t.f);if(!g){g=treeGeometry(t.f,1);geometries.set(t.f,g);}if(treeBoreTriangles(t,bore,g)>0)return false;}return true;
 });for(const g of geometries.values())g.dispose();return kept;
}

/** Build the instanced trees for a list of spots: per family and per 320 m cell one leaf mesh and one trunk
 * mesh, so frustum culling (camera and shadow passes) skips whole cells instead of drawing every tree. */
export function buildTrees(spots: TreeSpot[], density = 1, shadow = true) {
  const group = new T.Group(); group.name = 'Campus trees (foliage)';
  const r = rng(2027), o = new T.Object3D(), c = new T.Color(), CELL = 320;
  for (const f of ['banyan', 'flame', 'almond', 'coast', 'hill'] as Family[]) {
    const all = spots.filter(s => s.f === f);
    if (!all.length) continue;
    // Crown and trunk in one geometry (the trunk samples the texture's opaque swatch): one draw per family per cell.
    const geo = treeGeometry(f,density);
    const mat = leafMaterial(f);
    const cells = new Map<string, TreeSpot[]>();
    for (const t of all) { const k = `${Math.floor(t.x / CELL)},${Math.floor(t.z / CELL)}`; (cells.get(k) ?? cells.set(k, []).get(k)!).push(t); }
    for (const [key, list] of cells) {
      const leaves = new T.InstancedMesh(geo, mat, list.length);
      leaves.name = `Tree crowns ${f} ${key}`;
      list.forEach((t, i) => {
        const generatedYaw=r()*Math.PI*2;o.position.set(t.x, t.y, t.z); o.rotation.set(0, t.yaw??generatedYaw, 0); o.scale.setScalar(t.s); o.updateMatrix();
        leaves.setMatrixAt(i, o.matrix);
        c.setHSL(0, 0, 1); c.offsetHSL((r() - .5) * .035, (r() - .5) * .1, (r() - .5) * .14); leaves.setColorAt(i, c);
      });
      leaves.instanceColor!.needsUpdate = true;
      leaves.castShadow = shadow && f !== 'hill'; leaves.receiveShadow = true; leaves.computeBoundingSphere(); group.add(leaves);
    }
  }
  return group;
}

/** Pick a family for a tree spot: street rows mostly almond with flame every fourth, lawns banyan-led,
 * coast shrubs by the sea; at most two of one kind in a row along a street. */
export function familyFor(kind: 'street' | 'lawn' | 'coast', index: number, rand: () => number): Family {
  if (kind === 'coast') return 'coast';
  if (kind === 'street') return (['almond', 'almond', 'flame', 'banyan'] as Family[])[index % 4]; // never 3 alike in a row
  const k = rand();
  return k < .55 ? 'banyan' : k < .78 ? 'flame' : 'almond';
}
