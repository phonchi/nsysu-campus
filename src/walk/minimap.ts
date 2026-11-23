import type { Vector3 } from 'three';
import { contentBounds, layoutMapLabels, mapMarkerRadius, graphPathSegments, pathLayerAlpha, pointAt, pointInPolygon, polygonCenter, type MapBounds, type MapPoint, type OutdoorMapGraph } from './campus-map-view';

type P = [number, number];
export interface MapLabel { id: string; label: string; x: number; z: number; priority: number; minScale?: number }
export interface MapBuilding { id: string; name: string; kind: string; walkable: boolean; polygon: P[]; holes?: P[][] }
interface MapData { base?: { url: string; bounds: [number, number, number, number] }; buildings: MapBuilding[]; background: P[][]; backgroundHoles?: Record<number,P[][]>; roads: { kind: string; width: number; points: P[] }[]; railways?: { points: P[] }[] }
const KIND: Record<string, string> = { teaching: '#c75f4a', admin: '#e9b949', life: '#4d9a44', scenic: '#2c7f91' };

/** The label sources used by the overview, shared with actual-data uniqueness checks. */
export function collectMapLabels(buildings: readonly MapBuilding[], places: readonly MapLabel[], markers: readonly MapMarker[], graphLabels: readonly MapLabel[], selected?: string): MapLabel[] {
  return [...graphLabels, ...places, ...buildings.filter(b => !places.some(p => p.id === `building:${b.id}`)).map(b => {
    const [x, z] = polygonCenter(b.polygon);
    return { id: `building:${b.id}`, label: b.name, x, z, priority: b.walkable ? 4 : 2, minScale: b.walkable ? .35 : .65 };
  }), ...markers.map(m => ({ ...m, priority: m.id === selected ? 20 : 1, minScale: m.id === selected ? 0 : .8 }))];
}

export type MapMarkerKind = 'quest' | 'bike' | 'stamp' | 'bus' | 'restroom' | 'place' | 'building';
export interface MapMarker { id: string; kind: MapMarkerKind; x: number; y: number; z: number; label: string; buildingId?: string }
export interface MapFrame { x0: number; z0: number; scale: number; width: number; height: number }
/** Full base-sheet fallback; the overview derives its initial extent from loaded content. */
export const CAMPUS_VIEW = { x0: -900, z0: -1100, x1: 1008, z1: 752 };
export const MARKER_STYLE: Record<MapMarkerKind, { color: string; glyph: string }> = { quest: { color: '#e9b949', glyph: '任' }, bike: { color: '#2c7f91', glyph: '車' }, stamp: { color: '#c75f4a', glyph: '章' }, bus: { color: '#4d9a44', glyph: '公' }, restroom: { color: '#2a2c4a', glyph: '廁' }, place: { color: '#2c7f91', glyph: '地' }, building: { color: '#c75f4a', glyph: '樓' } };

/** Fits the campus into a width × height canvas, centred, north up. */
export function fitCampusFrame(width: number, height: number, view = CAMPUS_VIEW): MapFrame {
  const scale = Math.min(width / (view.x1 - view.x0), height / (view.z1 - view.z0));
  return { x0: view.x0 - (width / scale - (view.x1 - view.x0)) / 2, z0: view.z0 - (height / scale - (view.z1 - view.z0)) / 2, scale, width, height };
}
export const frameX = (f: MapFrame, x: number) => (x - f.x0) * f.scale;
export const frameY = (f: MapFrame, z: number) => (z - f.z0) * f.scale;

/** The marker a tap means: nearest within reach, so overlapping markers still resolve to one. */
export function pickMarker(markers: readonly MapMarker[], frame: MapFrame, px: number, py: number, reach = 24) {
  let best: MapMarker | undefined, bestD = reach;
  for (const m of markers) {
    const d = Math.hypot(frameX(frame, m.x) - px, frameY(frame, m.z) - py);
    if (d <= bestD) { best = m; bestD = d; }
  }
  return best;
}

/** Whole-campus minimap: the DEM base map with roads and buildings, pre-rendered once at 1 px per metre,
 * then cropped around the player (north up) with the quest goal marked. */
export class CampusMinimap {
  private sheet?: HTMLCanvasElement;
  private paths?: Path2D;
  private graphLabels: MapLabel[] = [];
  buildings: readonly MapBuilding[] = [];
  destinationMarkers: readonly MapMarker[] = [];
  private background: readonly MapPoint[] = [];
  private bounds: [number, number, number, number] = [0, 0, 1, 1];

  async load(asset: (p: string) => string) {
    const data = await fetch(asset('data/campus-map.json')).then(r => r.json() as Promise<MapData>);
    this.buildings = data.buildings;
    this.background = data.background.flat();
    if (!data.base) return;
    const img = new Image(); img.src = asset(data.base.url); await img.decode();
    const [x0, z0, x1, z1] = this.bounds = data.base.bounds;
    const c = document.createElement('canvas'); c.width = Math.round(x1 - x0); c.height = Math.round(z1 - z0);
    const g = c.getContext('2d')!;
    g.drawImage(img, 0, 0, c.width, c.height);
    g.translate(-x0, -z0); g.lineJoin = g.lineCap = 'round';
    for (const r of data.roads) {
      g.strokeStyle = /footway|path|steps/.test(r.kind) ? '#efe2c6' : '#fffaf0'; g.lineWidth = Math.max(2, r.width);
      g.beginPath(); r.points.forEach(([x, z], i) => i ? g.lineTo(x, z) : g.moveTo(x, z)); g.stroke();
    }
    for(const r of data.railways??[]){
      g.strokeStyle='#78736a';g.lineWidth=1;
      g.beginPath();r.points.forEach(([x,z],i)=>i?g.lineTo(x,z):g.moveTo(x,z));g.stroke();
    }
    const poly = (p: P[],holes: P[][] = []) => {
      g.beginPath();
      for(const ring of [p,...holes]){ring.forEach(([x,z],i)=>i?g.lineTo(x,z):g.moveTo(x,z));g.closePath();}
    };
    g.lineWidth = 1.5; g.strokeStyle = '#2a2c4a';
    data.background.forEach((p,i)=>{poly(p,data.backgroundHoles?.[i]);g.fillStyle='#e1d5bd';g.fill('evenodd');g.stroke();});
    for(const b of data.buildings){poly(b.polygon,b.holes);g.fillStyle=KIND[b.kind]??'#c75f4a';g.fill('evenodd');g.stroke();}
    this.sheet = c;
    // Build once from the navigation graph, including the hill links absent from the OSM roads.
    // The base map remains available if this optional overlay cannot be fetched.
    try {
      const response = await fetch(asset('data/walkthrough/outdoor-graph.json'));
      if (!response.ok) throw new Error(`Outdoor map paths: HTTP ${response.status}`);
      const graph: OutdoorMapGraph = await response.json(), paths = new Path2D();
      // The marine-sciences building has a graph anchor but no footprint in campus-map.json.
      const marine = graph.nodes.find(node => node.id === graph.anchors?.MA?.node);
      if (marine) this.graphLabels = [{ id: 'building:MA', label: '海洋科學學院', x: marine.p[0], z: marine.p[2], priority: 8 }];
      this.destinationMarkers = this.buildings.filter(b => /^hamasen-exit-[12]$/.test(b.id) || b.id === 'hamasen-rail-park').flatMap(b => {
        const node = graph.nodes.find(n => n.id === graph.anchors?.[b.id]?.node);
        if (!node) return [];
        const [x, y, z] = node.p;
        return [{ id: `building:${b.id}`, buildingId: b.id, kind: 'place', label: b.name, x, y, z }];
      });
      for (const [a, b] of graphPathSegments(graph)) {
        paths.moveTo(a[0], a[1]); paths.lineTo(b[0], b[1]);
      }
      this.paths = paths;
    } catch (error) { console.warn('minimap paths', error); }
  }

  get sheetBounds(): MapBounds {
    const [x0, z0, x1, z1] = this.bounds;
    return this.sheet ? { x0, z0, x1, z1 } : CAMPUS_VIEW;
  }
  defaultView(extra: readonly MapPoint[] = []) {
    return contentBounds([...this.background, ...this.buildings.flatMap(b => b.polygon), ...this.graphLabels.map(p => [p.x, p.z] as const), ...this.destinationMarkers.map(m => [m.x, m.z] as const), ...extra], this.sheetBounds);
  }
  pickBuilding(frame: MapFrame, px: number, py: number) {
    const point=pointAt(frame,px,py);
    return this.buildings.find(b=>pointInPolygon(point,b.polygon)&&!b.holes?.some(h=>pointInPolygon(point,h)));
  }
  get ready() { return !!this.sheet; }

  /** The menu's full map: drawn on demand from the existing sheet, so it adds one small canvas and no 3D work. */
  drawOverview(ctx: CanvasRenderingContext2D, frame: MapFrame, markers: readonly MapMarker[], selected: string | undefined, foot: Vector3, yaw: number, goal?: Vector3, places: readonly MapLabel[] = []) {
    if (!this.sheet) return false;
    const [bx, bz] = this.bounds;
    ctx.fillStyle = '#e9e1cc'; ctx.fillRect(0, 0, frame.width, frame.height);
    ctx.drawImage(this.sheet, (bx - frame.x0) * frame.scale, (bz - frame.z0) * frame.scale, this.sheet.width * frame.scale, this.sheet.height * frame.scale);
    const pathAlpha = pathLayerAlpha(frame.scale);
    if (this.paths && pathAlpha > 0) {
      ctx.save();
      ctx.translate(-frame.x0 * frame.scale, -frame.z0 * frame.scale); ctx.scale(frame.scale, frame.scale);
      ctx.globalAlpha = pathAlpha; ctx.strokeStyle = '#2c7f91'; ctx.lineWidth = 1.25 / frame.scale;
      ctx.lineJoin = ctx.lineCap = 'round'; ctx.stroke(this.paths);
      ctx.restore();
    }
    const selectedBuilding = this.buildings.find(b => `building:${b.id}` === selected);
    if (selectedBuilding) {
      ctx.beginPath();
      for(const ring of [selectedBuilding.polygon,...(selectedBuilding.holes??[])]){
        ring.forEach(([x,z],i)=>i?ctx.lineTo(frameX(frame,x),frameY(frame,z)):ctx.moveTo(frameX(frame,x),frameY(frame,z)));ctx.closePath();
      }
      ctx.fillStyle = '#e9b94966'; ctx.fill('evenodd'); ctx.strokeStyle = '#173e49'; ctx.lineWidth = 3; ctx.stroke();
    }
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = '700 12px "Noto Sans TC",sans-serif';
    const blocked = [...markers.map(m => { const r = mapMarkerRadius(frame.scale, m.id === selected) + 2; return { x: frameX(frame, m.x) - r, y: frameY(frame, m.z) - r, width: r * 2, height: r * 2, priority: 0 }; }), { x: frameX(frame, foot.x) - 19, y: frameY(frame, foot.z) - 19, width: 38, height: 38, priority: 0 }];
    const labels = collectMapLabels(this.buildings, places, markers, this.graphLabels, selected);
    for (const m of markers) {
      const x = frameX(frame, m.x), y = frameY(frame, m.z), r = mapMarkerRadius(frame.scale, m.id === selected);
      ctx.fillStyle = MARKER_STYLE[m.kind].color; ctx.strokeStyle = '#2a2c4a'; ctx.lineWidth = m.id === selected ? 3 : 1.5;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      if (frame.scale >= .55) { ctx.fillStyle = m.kind === 'quest' ? '#2a2c4a' : '#fff'; ctx.fillText(MARKER_STYLE[m.kind].glyph, x, y + .5); }
    }
    for (const l of layoutMapLabels(labels, frame, text => ctx.measureText(text).width, blocked)) {
      const ex = Math.max(l.x, Math.min(l.x + l.width, l.anchorX)), ey = Math.max(l.y, Math.min(l.y + l.height, l.anchorY));
      ctx.strokeStyle = '#2a2c4a80'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(l.anchorX, l.anchorY); ctx.lineTo(ex, ey); ctx.stroke();
      ctx.fillStyle = '#fbf6eaf0'; ctx.fillRect(l.x, l.y, l.width, l.height);
      ctx.fillStyle = '#1d2a3a'; ctx.fillText(l.label, l.x + l.width / 2, l.y + l.height / 2);
    }
    if (goal) {
      ctx.strokeStyle = '#e9b949'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(frameX(frame, goal.x), frameY(frame, goal.z), 16, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.save(); ctx.translate(frameX(frame, foot.x), frameY(frame, foot.z));
    ctx.fillStyle = '#ffffffbb'; ctx.beginPath(); ctx.arc(0, 0, 18, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#173e4980'; ctx.lineWidth = 3; ctx.stroke(); ctx.rotate(-yaw);
    ctx.fillStyle = '#173e49'; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, -11); ctx.lineTo(-7, 7); ctx.lineTo(7, 7); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();
    ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic';
    return true;
  }

  draw(ctx: CanvasRenderingContext2D, foot: Vector3, yaw: number, goal?: Vector3, W = 280, H = 220) {
    if (!this.sheet) return false;
    const zoom = 1.4, [x0, z0] = this.bounds;
    ctx.save();
    ctx.fillStyle = '#e9e1cc'; ctx.fillRect(0, 0, W, H);
    ctx.translate(W / 2, H / 2); ctx.scale(zoom, zoom); ctx.translate(-(foot.x - x0), -(foot.z - z0));
    ctx.drawImage(this.sheet, 0, 0);
    ctx.restore();
    if (goal) {
      // Goal: gold pin, clamped to the edge when far away.
      let gx = W / 2 + (goal.x - foot.x) * zoom, gy = H / 2 + (goal.z - foot.z) * zoom;
      const m = 12, out = gx < m || gy < m || gx > W - m || gy > H - m;
      gx = Math.min(W - m, Math.max(m, gx)); gy = Math.min(H - m, Math.max(m, gy));
      ctx.fillStyle = '#e9b949'; ctx.strokeStyle = '#2a2c4a'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(gx, gy, out ? 6 : 8, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
    ctx.save(); ctx.translate(W / 2, H / 2); ctx.rotate(-yaw);
    ctx.fillStyle = '#173e49'; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(0, -9); ctx.lineTo(-6, 6); ctx.lineTo(6, 6); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();
    ctx.fillStyle = 'rgba(23,62,73,.9)'; ctx.beginPath(); ctx.arc(W - 22, 22, 13, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#f2c94c'; ctx.font = '700 13px "Noto Sans TC",sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('N', W - 22, 22);
    ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic'; ctx.font = '12px "Noto Sans TC",sans-serif'; ctx.fillStyle = '#1d2a3a';
    ctx.fillText('全校地圖・北朝上', 10, H - 10);
    return true;
  }
}
