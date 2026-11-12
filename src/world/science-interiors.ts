/** Deterministic SC room layouts. Horizontal coordinates/dimensions are metres in the
 * building's axes; rendering and collision consume the same authored placements. */
import * as T from 'three';
import { furnishScienceItem } from './science-interior-models';
import type { WalkFloor, WalkRoom, Point2 } from '../walk-types';

export type InteriorKind = 'sofa' | 'desk' | 'chair' | 'bookcase' | 'cabinet' | 'computer' | 'lecture-seat' | 'platform' | 'board' | 'screen' | 'counter' | 'table' | 'plant' | 'rug' | 'light' | 'tv' | 'coffee-table' | 'wall-panel' | 'wall-art' | 'desk-accessories' | 'shelf-plant' | 'sofa-back' | 'sofa-wing' | 'plush-cat';
export interface InteriorItem {
  id: string; kind: InteriorKind; x: number; z: number; y: number;
  w: number; d: number; h: number; turn: number; solid: boolean;
}
export interface InteriorLayout {
  roomId: string; code: string; floorId: string; use: string; polygon: Point2[];
  items: InteriorItem[]; exclusions: Point2[][]; protected: { a: Point2; b: Point2; radius: number }[];
  seats: number; rows: number; highestPlatform: number; skipped?: string;
}
const LECTURES = new Set(['SC1005', 'SC1001', 'SC2001', 'SC3001']);
const unit = new T.BoxGeometry(1, 1, 1);
const solidMaterial = new T.MeshBasicMaterial({color:'#35484c'});
export const isDecoratedOffice = (code: string) => /^SC[23]002-[1-7]$/.test(code) || code === 'SC4010';
export function inRoom(p: Point2, polygon: Point2[]) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
function distance(p: Point2, a: Point2, b: Point2) {
  const x = b[0] - a[0], z = b[1] - a[1], t = Math.max(0, Math.min(1, ((p[0] - a[0]) * x + (p[1] - a[1]) * z) / (x * x + z * z || 1)));
  return Math.hypot(p[0] - a[0] - t * x, p[1] - a[1] - t * z);
}
export function itemBounds(item: InteriorItem, pad = 0): [number, number, number, number] {
  const w = item.turn % 2 ? item.d : item.w, d = item.turn % 2 ? item.w : item.d;
  return [item.x - w / 2 - pad, item.z - d / 2 - pad, item.x + w / 2 + pad, item.z + d / 2 + pad];
}
/** Sample edges AND interior: concave source outlines can cut through a rectangle. */
export function footprintFits(item: InteriorItem, poly: Point2[], pad = .13) {
  const [x0, z0, x1, z1] = itemBounds(item, pad), nx = Math.ceil((x1 - x0) / .18), nz = Math.ceil((z1 - z0) / .18);
  for (let i = 0; i <= nx; i++) for (let j = 0; j <= nz; j++) if (!inRoom([x0 + (x1 - x0) * i / nx, z0 + (z1 - z0) * j / nz], poly)) return false;
  return true;
}
export function blocksProtected(item: InteriorItem, paths: InteriorLayout['protected']) {
  const [x0, z0, x1, z1] = itemBounds(item);
  for (const p of paths) {
    const steps = Math.max(1, Math.ceil(Math.hypot(p.b[0] - p.a[0], p.b[1] - p.a[1]) / .08));
    for (let i = 0; i <= steps; i++) {
      const x = p.a[0] + (p.b[0] - p.a[0]) * i / steps, z = p.a[1] + (p.b[1] - p.a[1]) * i / steps;
      if (Math.hypot(Math.max(x0 - x, 0, x - x1), Math.max(z0 - z, 0, z - z1)) < p.radius) return true;
    }
  }
  return false;
}
function overlaps(a: InteriorItem, b: InteriorItem) {
  if (a.y >= b.y + b.h - .015 || b.y >= a.y + a.h - .015) return false;
  const joint=[a.kind,b.kind].every(k=>k==='sofa-back'||k==='sofa-wing');
  const u = itemBounds(a, a.kind === 'platform' || b.kind === 'platform' || joint ? 0 : .025), v = itemBounds(b);
  return u[0] < v[2] && u[2] > v[0] && u[1] < v[3] && u[3] > v[1];
}
export function planScienceInterior(room: WalkRoom, floor: WalkFloor, scale: number): InteriorLayout {
  const poly = room.polygon.map(([x, z]): Point2 => [x * scale, z * scale]);
  const code = room.code ?? '', layout: InteriorLayout = { roomId: room.id, code, floorId: floor.id, use: 'neutral', polygon: poly, items: [], exclusions: [...(floor.holes ?? []), ...(floor.verticalServices ?? []).map(s => s.polygon)].map(p => p.map(([x,z]): Point2 => [x*scale,z*scale])), protected: [], seats: 0, rows: 0, highestPlatform: 0 };
  if (!code || floor.level === 99 || !['room', 'room-candidate'].includes(room.kind)) { layout.skipped = '未編號、屋頂或非一般房間；保留原空間'; return layout; }
  const xs = poly.map(p => p[0]), zs = poly.map(p => p[1]), x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs), W = x1 - x0, D = z1 - z0;
  const portals = floor.access?.portals.filter(p => p.roomIds.includes(room.id)) ?? [];
  for (const p of portals) {
    const door = p.perRoomPosition?.[room.id] ?? p.position, core = p.clearancePositions?.[room.id] ?? door;
    const dx=core[0]-door[0], dz=core[1]-door[1], length=Math.hypot(dx,dz)||1;
    layout.protected.push({ a: [door[0] * scale, door[1] * scale], b: [core[0] * scale + dx/length*.65, core[1] * scale + dz/length*.65], radius: Math.max(.68, p.width * scale / 2 + .2) });
  }
  // Rooms with multiple portals must retain a through route, not isolated clear spots.
  const cores = layout.protected.map(p => p.b);
  for (let i = 1; i < cores.length; i++) layout.protected.push({ a: cores[0], b: cores[i], radius: .65 });
  const add = (kind: InteriorKind, x: number, z: number, w: number, d: number, h: number, turn = 0, y = 0, solid = true) => {
    const item: InteriorItem = { id: `${room.id}:${kind}:${layout.items.length}`, kind, x, z, w, d, h, turn, y, solid };
    const [ax,az,bx,bz]=itemBounds(item,.13);
    const excluded=layout.exclusions.some(p=>p.some(([x,z])=>x>=ax&&x<=bx&&z>=az&&z<=bz)||[[ax,az],[ax,bz],[bx,az],[bx,bz],[(ax+bx)/2,(az+bz)/2]].some(q=>inRoom(q as Point2,p)));
    if (excluded || !footprintFits(item, poly) || solid && (blocksProtected(item, layout.protected) || layout.items.some(other => other.solid && overlaps(item, other)))) return false;
    layout.items.push(item); return true;
  };
  const desk = (x: number, z: number, computer = false, turn = 0, w = 1.45) => add(computer ? 'computer' : 'desk', x, z, w, .72, computer ? 1.25 : .78, turn);
  const chair = (x: number, z: number, turn = 0) => add('chair', x, z, .48, .52, .9, turn);
  const shelf = (x: number, z: number, turn = 0, w = 1.2) => add('bookcase', x, z, w, .34, 1.95, turn);
  if (LECTURES.has(code)) {
    layout.use = 'tiered-lecture';
    // SC1005 is an elongated conference hall: teach across its short end.
    const swap = code === 'SC1005', width = swap ? D : W, depth = swap ? W : D;
    const point = (u: number, v: number): Point2 => swap ? [x0 + v, z1 - u] : [x0 + u, z0 + v];
    const turn = swap ? 1 : 0, place = (kind: InteriorKind, u: number, v: number, w: number, d: number, h: number, y = 0, solid = true) => { const [x, z] = point(u, v); return add(kind, x, z, w, d, h, turn, y, solid); };
    place('board', width / 2, .28, Math.min(4.8, width - 2), .09, 1.15, 1.12, false);
    place('screen', width / 2, .35, Math.min(2.6, width - 3), .05, 1.35, 1.4, false);
    place('desk', width / 2 - 1.5, 1.25, 1.4, .65, .78);
    const side = 1.35, aisle = 1.2, bank = (width - 2 * side - aisle) / 2;
    const columns = Math.max(1, Math.floor(bank / .64)), rows = Math.max(1, Math.min(14, Math.floor((depth - 3.5) / 1.12)));
    const pitch = Math.min(1.35, (depth - 3.5) / rows), rise = Math.min(.13, 1.04 / Math.max(1, rows - 1));
    for (let row = 0; row < rows; row++) {
      const v = 2.65 + row * pitch, h = row * rise;
      // Both outer aisles stay flat, including each authored room-interior target.
      let left = side;
      if (h > 0) {
        while (left < width / 2 - aisle / 2 && !place('platform', (left + width - side) / 2, v + .12, width - side - left, pitch - .004, h)) left += .2;
        if (left >= width / 2 - aisle / 2) continue;
      }
      let count = 0;
      for (const sign of [-1, 1]) for (let col = 0; col < columns; col++) {
        const u = width / 2 + sign * (aisle / 2 + .33 + col * .64);
        if (u - .28 >= left && place('lecture-seat', u, v, .56, .88, .98, h)) count++;
      }
      if (count) { layout.rows++; layout.seats += count; layout.highestPlatform = Math.max(layout.highestPlatform, h); }
    }
  } else if (code === 'SC2002-4') {
    layout.use = 'office-lounge';
    // The U is three solid sections; its centre and both sides of the table remain open.
    const centre=x0+3.15,backZ=z1-.55,wingZ=z1-1.414;
    add('sofa-back',centre,backZ,3.4,.82,.88);
    add('sofa-wing',x0+1.825,wingZ,.90,.75,.88,3);
    add('sofa-wing',x0+4.475,wingZ,.90,.75,.88,1);
    desk(x1-1.22,z0+.62,true,0,1.65);chair(x1-1.22,z0+1.55);
    shelf(x1-.32,z1-.86,3,1.2);
    add('coffee-table',centre,z1-1.35,.66,.40,.46);
    add('tv',centre,z0+.18,1.26,.06,.73,0,1.22);
    add('wall-panel',centre,z0+.15,2.18,.035,2.5,0,.35,false);
    add('rug',centre,z1-1.10,3.7,1.85,.015,0,.012,false);
    add('plant',x0+1.35,z0+.40,.42,.42,1.25);
    add('wall-art',x1-.18,z0+.79,1.05,.06,.72,3,1.62,false);
    // .555 is the rendered cushion TOP, not the sofa collider's overall height.
    add('plush-cat',x0+1.88,wingZ-.07,.42,.56,.38,2,.555,false);
  } else if (code === 'SC2004') {
    layout.use = 'computer-classroom';
    add('board', (x0 + x1) / 2, z0 + .3, 4.3, .1, 1.2, 0, 1.1, false);
    add('screen', (x0 + x1) / 2, z0 + .36, 2.4, .06, 1.35, 0, 1.4, false);
    desk(x0 + 1.4, z0 + 1.4, true);chair(x0 + 1.4, z0 + 2.15);
    for (let z = z0 + 3; z < z1 - 1.5; z += 1.65) for (const sign of [-1, 1]) for (let col = 0; col < 2; col++) {
      const x = (x0 + x1) / 2 + sign * (1.36 + col * 1.45);
      if (desk(x, z, true, 0, 1.3)) { chair(x, z + .75);layout.seats++; }
    }
    add('cabinet', x1 - .55, z0 + 1, .75, .5, 1.4);
  } else if (code === 'SC4009') {
    layout.use = 'math-library';
    for (let z = z0 + 1; z < z1 - 1; z += 1.6) { shelf(x0 + .37, z, 1, 1.4);shelf(x1 - .37, z, 3, 1.4); }
    for (let z = z0 + 1.8; z < z1 - 2; z += 2.8) for (const x of [x0 + 2.65, x1 - 2.65]) {
      if (add('table', x, z, 1.65, .8, .76)) { chair(x, z + .8);chair(x, z - .8, 2);layout.seats += 2; }
    }
    add('computer', x0 + 1.35, z1 - 1, 1.4, .65, 1.25);
  } else if (code === 'SC4010') {
    layout.use = 'department-office';
    add('counter', x0 + 1.6, z0 + 2.1, 2.2, .7, 1.05);
    add('sofa', x1 - .65, z0 + 3.45, 1.8, .8, .88, 1);
    for (let z = z0 + 4.8; z < z1 - 1.5; z += 2.5) for (const x of [x0 + 1.45, x1 - 1.45]) {
      desk(x, z, true);chair(x, z + .8);
    }
    for (let x = x0 + .95; x < x1 - .7; x += 1.25) add('cabinet', x, z1 - .43, 1.1, .5, 1.85, 2);
    add('plant', x0 + .5, z0 + .6, .45, .45, 1.2);
  } else {
    // No unverified department/staff names: neutral work / study furnishings.
    const small = Math.min(W, D) < 4.2;
    layout.use = small ? 'neutral-study' : floor.level === 4 ? 'teaching-study' : 'neutral-study';
    if (small) {
      desk(x1 - 1.05, z0 + .65);chair(x1 - 1.05, z0 + 1.43);
      shelf(x0 + 1.3, z1 - .37, 2);
    } else {
      const cx = (x0 + x1) / 2;
      for (let z = z0 + 2.2; z < Math.min(z1 - 1.5, z0 + 8.5); z += 2.1) for (const x of [cx - 1.55, cx + 1.55]) {
        if (desk(x, z)) { chair(x, z + .82);layout.seats++; }
      }
      add('board', cx, z0 + .3, Math.min(3.6, W - 2), .08, 1.15, 0, 1.1, false);
      shelf(x0 + 1.1, z1 - .38, 2);
    }
    // Irregular outlines: find at least one valid desk rather than furnishing the bounding box blindly.
    if (!layout.items.some(i => i.kind === 'desk')) outer: for (let z = z0 + .8; z < z1 - .8; z += .6) for (let x = x0 + 1; x < x1 - 1; x += .6) if (desk(x, z)) { chair(x, z + .85);break outer; }
  }
  // Office decoration stays on furniture or walls; it creates no floor obstacles.
  if (isDecoratedOffice(code)) {
    for (const furniture of [...layout.items]) {
      if (['desk','computer','counter'].includes(furniture.kind)) {
        const turn=furniture.turn*Math.PI/2,dx=furniture.w/2-.2;
        add('desk-accessories', furniture.x+dx*Math.cos(turn), furniture.z-dx*Math.sin(turn), .32, .54, .4, furniture.turn, furniture.kind==='counter'?1.05:.8, false);
      }
      if (furniture.kind==='bookcase'||furniture.kind==='cabinet') {
        const turn=furniture.turn*Math.PI/2,dx=furniture.w/2-.22;
        add('shelf-plant', furniture.x+dx*Math.cos(turn), furniture.z-dx*Math.sin(turn), .27, .27, .32, 0, furniture.h, false);
      }
    }
    if (code !== 'SC2002-4') {
      const w=Math.min(1.2,W-1.2);
      if (!add('wall-art',(x0+x1)/2,z0+.18,w,.06,.72,0,1.6,false)) add('wall-art',(x0+x1)/2,z1-.18,w,.06,.72,2,1.6,false);
    }
  }
  // Recessed-looking luminaires are emissive geometry, not hundreds of extra lights.
  for (let z = z0 + 1.5; z < z1 - .8; z += 3.2) for (let x = x0 + 1.5; x < x1 - .8; x += 3.5) add('light', x, z, 1.05, .27, .02, 0, 3.17, false);
  if (!layout.items.some(i => i.solid)) layout.skipped = '房間有效輪廓或入口淨空不足，未強塞家具';
  return layout;
}

export function addScienceInterior(layout: InteriorLayout, display: T.Group, collision: T.Group, floorY: number, scale: number) {
  const visual = new T.Group(), solid = new T.Group();visual.name = `Interior ${layout.code}`;solid.name = visual.name;
  for (const g of [visual,solid]) {g.position.y=floorY;g.scale.set(1/scale,1,1/scale);}
  display.add(visual);collision.add(solid);
  for(const item of layout.items) {
    const variant=[...layout.code].reduce((n,c)=>(n*31+c.charCodeAt(0))>>>0,0)%3;
    furnishScienceItem(item,visual,isDecoratedOffice(layout.code),layout.code==='SC2002-4',variant);
    if(item.solid) {const mesh=new T.Mesh(unit,solidMaterial);mesh.position.set(item.x,item.y+item.h/2,item.z);mesh.scale.set(item.w,item.h,item.d);mesh.rotation.y=item.turn*Math.PI/2;solid.add(mesh);}
  }
}
