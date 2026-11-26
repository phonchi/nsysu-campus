/** Lightweight 3D entrance signs for on-campus dining halls and dormitories (2 draw calls total). */
import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Terrain } from './terrain';
import { NIGHT_MATERIALS } from '../walk-materials';

interface CampusSignSpec {
  id: string;
  title: string;
  sub: string;
  color: string;
  x: number;
  z: number;
  yaw: number;
  width?: number;
  height?: number;
}

const CAMPUS_SIGNS: readonly CampusSignSpec[] = [
  { id: 'shanhai-lou', title: '山海樓饗食廣場', sub: '活動中心 2F・學生餐廳', color: '#b8452d', x: -155.5, z: -167.2, yaw: 0, width: 2.4, height: .96 },
  { id: 'sc-coop', title: '理院福利社（B1）', sub: '週一至五 07:30–17:30', color: '#287659', x: 10.6, z: 108.5, yaw: Math.PI * .5, width: 2.2, height: .88 },
  { id: 'cuiheng-e', title: '翠亨 E 餐廳（E 餐）', sub: '翠亨 E 棟 1F・三餐麵食', color: '#c25232', x: 196.8, z: -186.5, yaw: Math.PI * .15, width: 2.3, height: .92 },
  { id: 'wuling-milo', title: '武嶺米羅餐廳', sub: '武嶺一村・三餐與宵夜', color: '#a8442a', x: -267.2, z: -305.5, yaw: -Math.PI * .5, width: 2.3, height: .92 },
  { id: 'louisa-360', title: 'LOUISA COFFEE 路易莎', sub: '360 藝文空間 1F・07:00–21:00', color: '#6b4630', x: -176.5, z: -70.5, yaw: 0, width: 2.4, height: .92 },
  { id: 'wuling-dorm', title: '武嶺宿舍區（一～四村）', sub: '武嶺服務站・聽濤堂・宿服中心', color: '#5f4c94', x: -268.2, z: -396.5, yaw: Math.PI * .5, width: 2.4, height: .92 },
  { id: 'cuiheng-h', title: '翠亨山莊 H 棟', sub: '1F 萊爾富超商・交誼廳', color: '#5f4c94', x: 169.4, z: -97.6, yaw: 0, width: 2.2, height: .88 },
  { id: 'cuiheng-l', title: '翠亨山莊 L 棟（雨樹）', sub: '雨樹服務站・公共廚房・雨豆屋', color: '#5f4c94', x: 212.5, z: -185.6, yaw: Math.PI, width: 2.4, height: .92 },
];

function paintCampusSignAtlas(specs: readonly CampusSignSpec[]) {
  if (typeof document === 'undefined') return undefined;
  const rowW = 512, rowH = 192;
  const canvas = document.createElement('canvas');
  canvas.width = rowW;
  canvas.height = rowH * specs.length;
  const ctx = canvas.getContext('2d');
  if (!ctx) return undefined;
  specs.forEach((s, i) => {
    const y = i * rowH;
    ctx.fillStyle = '#fbf7ee';
    ctx.fillRect(0, y, rowW, rowH);
    ctx.fillStyle = s.color;
    ctx.fillRect(0, y, rowW, 18);
    ctx.fillRect(0, y + rowH - 12, rowW, 12);
    ctx.strokeStyle = s.color;
    ctx.lineWidth = 6;
    ctx.strokeRect(10, y + 24, rowW - 20, rowH - 42);
    ctx.fillStyle = '#1f282c';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 44px "Noto Sans TC", sans-serif';
    ctx.fillText(s.title, rowW / 2, y + 86, rowW - 44);
    ctx.fillStyle = s.color;
    ctx.font = '600 26px "Noto Sans TC", sans-serif';
    ctx.fillText(s.sub, rowW / 2, y + 140, rowW - 44);
  });
  const tex = new T.CanvasTexture(canvas);
  tex.colorSpace = T.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function colored(geo: T.BufferGeometry, m: T.Matrix4, hex: string) {
  const g = (geo.index ? geo.toNonIndexed() : geo.clone()).applyMatrix4(m);
  const n = g.getAttribute('position').count;
  const c = new T.Color(hex), arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  g.setAttribute('color', new T.BufferAttribute(arr, 3));
  return g;
}

export function campusLifeSigns(terrain?: Terrain): T.Group {
  const group = new T.Group();
  group.name = 'Campus dining and dorm signs';
  group.userData.visualOnly = true;
  group.userData.terrainSeated = true;
  const tex = paintCampusSignAtlas(CAMPUS_SIGNS);
  if (!tex) return group;

  const frames: T.BufferGeometry[] = [];
  const faces: T.BufferGeometry[] = [];
  const postGeo = new T.CylinderGeometry(.045, .055, 1, 6);
  const boxGeo = new T.BoxGeometry(1, 1, 1);
  const rows = CAMPUS_SIGNS.length;

  CAMPUS_SIGNS.forEach((s, i) => {
    const gy = terrain ? terrain.heightAt(s.x, s.z) : -.055;
    const w = s.width ?? 2.2, h = s.height ?? .9;
    const boardY = gy + 1.95;
    const q = new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), s.yaw);
    const right = new T.Vector3(1, 0, 0).applyQuaternion(q);
    const forward = new T.Vector3(0, 0, 1).applyQuaternion(q);
    // Two slender support posts + thin sign housing.
    for (const side of [-1, 1]) {
      const px = s.x + right.x * side * (w * .38), pz = s.z + right.z * side * (w * .38);
      const pm = new T.Matrix4().compose(new T.Vector3(px, gy + 1.15, pz), q, new T.Vector3(1, 2.3, 1));
      frames.push(colored(postGeo, pm, '#465256'));
    }
    const bm = new T.Matrix4().compose(new T.Vector3(s.x, boardY, s.z), q, new T.Vector3(w + .08, h + .08, .09));
    frames.push(colored(boxGeo, bm, s.color));

    // Double-sided UV-mapped sign face pointing front and back.
    const v0 = 1 - (i + 1) / rows, v1 = 1 - i / rows;
    for (const dir of [1, -1]) {
      const p = new T.PlaneGeometry(w, h);
      const uv = p.getAttribute('uv');
      for (let k = 0; k < uv.count; k++) uv.setY(k, uv.getY(k) > .5 ? v1 : v0);
      if (dir < 0) p.rotateY(Math.PI);
      const fm = new T.Matrix4().compose(
        new T.Vector3(s.x + forward.x * .05 * dir, boardY, s.z + forward.z * .05 * dir),
        q,
        new T.Vector3(1, 1, 1),
      );
      const g = (p.index ? p.toNonIndexed() : p).applyMatrix4(fm);
      faces.push(g);
      p.dispose();
    }
  });
  postGeo.dispose();
  boxGeo.dispose();

  const frameMerged = mergeGeometries(frames, false);
  frames.forEach(g => g.dispose());
  if (frameMerged) {
    const m = new T.Mesh(frameMerged, new T.MeshStandardMaterial({ vertexColors: true, roughness: .75 }));
    m.name = 'Campus sign frames'; m.castShadow = true; m.receiveShadow = true;
    group.add(m);
  }
  const faceMerged = mergeGeometries(faces, false);
  faces.forEach(g => g.dispose());
  if (faceMerged) {
    const mat = new T.MeshStandardMaterial({
      name: 'Campus sign faces',
      map: tex,
      emissiveMap: tex,
      emissive: new T.Color('#ffe8c4'),
      emissiveIntensity: 0,
      roughness: .65,
    });
    NIGHT_MATERIALS.add(mat);
    const m = new T.Mesh(faceMerged, mat);
    m.name = 'Campus sign faces';
    group.add(m);
  }
  return group;
}
