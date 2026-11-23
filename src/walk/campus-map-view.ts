import type { MapFrame, MapLabel, MapMarker } from './minimap';

export type MapPoint = readonly [number, number];
export interface MapBounds { x0: number; z0: number; x1: number; z1: number }
export const pointAt = (f: MapFrame, x: number, y: number): MapPoint => [f.x0 + x / f.scale, f.z0 + y / f.scale];
const limit = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Location and guidance are separate: a navigation target must never become the map's location. */
export function actualPlaceText(building: string, floor: string, distance: number, zone?: string): string {
  return distance < 8 ? `${building}・${floor}` : zone ?? (distance < 60 ? '中山・理工校園' : '中山大學・西子灣');
}
export function coalesceMapDraw(draw: () => void, enqueue: (cb: FrameRequestCallback) => number = requestAnimationFrame) {
  let pending = false;
  return () => {
    if (pending) return;
    pending = true;
    enqueue(() => { pending = false; draw(); });
  };
}
export const mapMarkerRadius = (scale: number, selected = false) => scale < .55 ? (selected ? 8 : 6) : (selected ? 13 : 10);
export const MAJOR_MAP_NAMES: Readonly<Record<string, string>> = {
  'building:LA': '文學院', 'building:SC': '理學院', 'building:IL': '圖書館',
  'building:AD': '行政大樓', 'building:MA': '海洋科學學院', 'building:SPORT': '體育館',
  'building:ACTIVITY': '活動中心', 'building:gate': '校門', 'building:tunnel-west': '隧道',
  'building:sea-center': '西子灣／海域中心',
  'building:hamasen-exit-1': '哈瑪星 1 號出口', 'building:hamasen-exit-2': '哈瑪星 2 號出口',
  'building:hamasen-rail-park': '哈瑪星鐵道園區',
};

export interface OutdoorMapGraph {
  nodes: readonly { id: number; p: readonly number[] }[];
  edges: readonly (readonly number[])[];
  anchors?: Readonly<Record<string, { node: number; label?: string }>>;
}
/** Resolve graph IDs, not array indices; project world X/Z without the elevation or edge weight. */
export function graphPathSegments(graph: OutdoorMapGraph): [MapPoint, MapPoint][] {
  const nodes = new Map(graph.nodes.map(node => [node.id, node.p]));
  const segments: [MapPoint, MapPoint][] = [];
  for (const [from, to] of graph.edges) {
    const a = nodes.get(from), b = nodes.get(to);
    if (a && b && from !== to) segments.push([[a[0], a[2]], [b[0], b[2]]]);
  }
  return segments;
}
/** CSS pixels per world metre: invisible at campus scale, fully faded in at local scale. */
export function pathLayerAlpha(scale: number): number {
  return .65 * limit((scale - .55) / .65, 0, 1);
}

/** Keep the sheet in view; centre letterboxed axes instead of allowing empty-space panning. */
export function clampFrame(f: MapFrame, bounds: MapBounds): MapFrame {
  const min = Math.min(f.width / (bounds.x1 - bounds.x0), f.height / (bounds.z1 - bounds.z0));
  const scale = limit(f.scale, min, Math.max(4, min * 12));
  const axis = (origin: number, size: number, lo: number, hi: number) => size >= hi - lo ? (lo + hi - size) / 2 : limit(origin, lo, hi - size);
  return { ...f, scale, x0: axis(f.x0, f.width / scale, bounds.x0, bounds.x1), z0: axis(f.z0, f.height / scale, bounds.z0, bounds.z1) };
}
export function zoomFrame(f: MapFrame, factor: number, x: number, y: number, bounds: MapBounds): MapFrame {
  const [wx, wz] = pointAt(f, x, y);
  const scale = clampFrame({ ...f, scale: f.scale * factor }, bounds).scale;
  return clampFrame({ ...f, scale, x0: wx - x / scale, z0: wz - y / scale }, bounds);
}
export function panFrame(f: MapFrame, dx: number, dy: number, bounds: MapBounds): MapFrame {
  return clampFrame({ ...f, x0: f.x0 - dx / f.scale, z0: f.z0 - dy / f.scale }, bounds);
}
export function contentBounds(points: readonly MapPoint[], sheet: MapBounds, padding = 60): MapBounds {
  if (!points.length) return sheet;
  return { x0: Math.max(sheet.x0, Math.min(...points.map(p => p[0])) - padding), z0: Math.max(sheet.z0, Math.min(...points.map(p => p[1])) - padding), x1: Math.min(sheet.x1, Math.max(...points.map(p => p[0])) + padding), z1: Math.min(sheet.z1, Math.max(...points.map(p => p[1])) + padding) };
}
export function polygonCenter(polygon: readonly MapPoint[]): MapPoint {
  return [(Math.min(...polygon.map(p => p[0])) + Math.max(...polygon.map(p => p[0]))) / 2, (Math.min(...polygon.map(p => p[1])) + Math.max(...polygon.map(p => p[1]))) / 2];
}
/** Boundary-inclusive ray casting, including concave building footprints. */
export function pointInPolygon([x, z]: MapPoint, polygon: readonly MapPoint[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [ax, az] = polygon[j], [bx, bz] = polygon[i];
    if (Math.abs((x - ax) * (bz - az) - (z - az) * (bx - ax)) < 1e-7 && x >= Math.min(ax, bx) && x <= Math.max(ax, bx) && z >= Math.min(az, bz) && z <= Math.max(az, bz)) return true;
    if ((az > z) !== (bz > z) && x < (bx - ax) * (z - az) / (bz - az) + ax) inside = !inside;
  }
  return inside;
}
export interface LabelBox { x: number; y: number; width: number; height: number; priority: number; minScale?: number }
export function declutterLabels<T extends LabelBox>(labels: readonly T[], width: number, height: number, scale: number, blocked: readonly LabelBox[] = []): T[] {
  const out: T[] = [], occupied = [...blocked];
  for (const label of [...labels].sort((a, b) => b.priority - a.priority)) {
    if (scale < (label.minScale ?? 0) || label.x < 2 || label.y < 2 || label.x + label.width > width - 2 || label.y + label.height > height - 2) continue;
    if (occupied.some(b => label.x < b.x + b.width + 4 && label.x + label.width + 4 > b.x && label.y < b.y + b.height + 4 && label.y + label.height + 4 > b.y)) continue;
    out.push(label); occupied.push(label);
  }
  return out;
}

export interface PlacedMapLabel extends LabelBox { id: string; label: string; anchorX: number; anchorY: number }
/** Major names may move to nearby clear rows; leader lines keep displaced labels tied to their places. */
export function layoutMapLabels(labels: readonly MapLabel[], frame: MapFrame, measure: (text: string) => number, blocked: readonly LabelBox[]): PlacedMapLabel[] {
  const out: PlacedMapLabel[] = [], occupied = [...blocked];
  const placedIds = new Set<string>(), placedTexts = new Set<string>();
  const ranked = labels.map(l => MAJOR_MAP_NAMES[l.id] ? { ...l, label: MAJOR_MAP_NAMES[l.id], priority: 100 + l.priority, minScale: 0 } : l).sort((a, b) => b.priority - a.priority);
  for (const l of ranked) {
    if (placedIds.has(l.id) || placedTexts.has(l.label)) continue;
    if (frame.scale < (l.minScale ?? 0)) continue;
    const ax = (l.x - frame.x0) * frame.scale, ay = (l.z - frame.z0) * frame.scale;
    if (ax < 0 || ay < 0 || ax > frame.width || ay > frame.height) continue;
    const width = measure(l.label) + 8, height = 20;
    if (width > frame.width - 8) continue;
    const candidates = [[ax - width / 2, ay + 12], [ax + 12, ay - height / 2], [ax - width - 12, ay - height / 2], [ax - width / 2, ay - height - 12]];
    // Use nearby rows and the open space beside the campus, rather than moving a crowded
    // core label far south onto a different building (SC could previously move 168 px).
    if (MAJOR_MAP_NAMES[l.id]) for (const offset of [12, 36, 60, 84, 108, 132]) for (const dy of [0, -24, 24, -48, 48]) {
      candidates.push([ax + offset, ay + dy - height / 2], [ax - width - offset, ay + dy - height / 2]);
    }
    for (const [x, y] of candidates) {
      const candidate = { id: l.id, label: l.label, x: limit(x, 4, frame.width - width - 4), y: limit(y, 4, frame.height - height - 4), width, height, priority: l.priority, anchorX: ax, anchorY: ay };
      if (declutterLabels([candidate], frame.width, frame.height, frame.scale, occupied).length) {
        out.push(candidate); occupied.push(candidate); placedIds.add(l.id); placedTexts.add(l.label); break;
      }
    }
  }
  return out;
}
const BUS_MARKER_SUFFIX: Readonly<Record<string, string>> = {
  'hamasen-orange-stop': '・橘1延', 'hamasen-campus-stop': '・校園公車（位置示意）',
};
export function busStopMarkers(stops: readonly { id?: string; name: string; boardingPoint: readonly [number, number, number] }[]): MapMarker[] {
  const names = new Set<string>();
  return stops.filter(stop => { if (names.has(stop.name)) return false; names.add(stop.name); return true; }).map(stop => {
    const [x, y, z] = stop.boardingPoint;
    const suffix = stop.id ? BUS_MARKER_SUFFIX[stop.id] ?? '' : '';
    return { id: `bus:${stop.name}`, kind: 'bus', label: stop.name + suffix, x, y, z };
  });
}

/** Pointer capture keeps touch panning/pinching on the map. Six CSS pixels still count as a tap. */
export function bindMapGestures(canvas: HTMLCanvasElement, hooks: { frame(): MapFrame; bounds(): MapBounds; change(f: MapFrame): void; pick(x: number, y: number): void }) {
  const pointers = new Map<number, MapPoint>();
  let start: MapPoint | undefined, dragged = false, suppressClick = false;
  const local = (e: MouseEvent): MapPoint => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  canvas.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    const p = local(e); pointers.set(e.pointerId, p);
    if (pointers.size === 1) { start = p; dragged = false; suppressClick = false; }
    else { dragged = true; suppressClick = true; }
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', e => {
    const old = pointers.get(e.pointerId); if (!old) return;
    const next = local(e), other = [...pointers].find(([id]) => id !== e.pointerId)?.[1];
    pointers.set(e.pointerId, next);
    if (other) {
      const before = Math.hypot(old[0] - other[0], old[1] - other[1]), after = Math.hypot(next[0] - other[0], next[1] - other[1]);
      let f = hooks.frame();
      if (before > 1 && after > 1) f = zoomFrame(f, after / before, (old[0] + other[0]) / 2, (old[1] + other[1]) / 2, hooks.bounds());
      hooks.change(panFrame(f, (next[0] - old[0]) / 2, (next[1] - old[1]) / 2, hooks.bounds()));
    } else if (start && (dragged || Math.hypot(next[0] - start[0], next[1] - start[1]) > 6)) {
      const from = dragged ? old : start;
      dragged = true; suppressClick = true;
      hooks.change(panFrame(hooks.frame(), next[0] - from[0], next[1] - from[1], hooks.bounds()));
    }
  });
  const end = (e: PointerEvent) => {
    if (!pointers.has(e.pointerId)) return;
    if (e.type === 'pointercancel') suppressClick = true;
    pointers.delete(e.pointerId);
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('lostpointercapture', end);
  canvas.addEventListener('click', e => { if (!suppressClick) hooks.pick(...local(e)); suppressClick = false; });
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const delta = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? canvas.clientHeight : 1);
    hooks.change(zoomFrame(hooks.frame(), Math.exp(-limit(delta, -400, 400) * .002), ...local(e), hooks.bounds()));
  }, { passive: false });
}

export function bindMinimapOpen(minimap: HTMLElement, open: () => void) {
  minimap.addEventListener('click', open);
  minimap.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
}
