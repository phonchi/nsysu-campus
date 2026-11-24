import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { bindMapGestures, bindMinimapOpen, busStopMarkers, clampFrame, contentBounds, declutterLabels, panFrame, pointAt, pointInPolygon, zoomFrame } from '../src/walk/campus-map-view';
import { CAMPUS_VIEW, CampusMinimap, fitCampusFrame, frameX, frameY } from '../src/walk/minimap';
import { WalkInput } from '../src/walk/input';
import { hudTemplate } from '../src/walk/hud';
import bus from '../public/data/bus-routes.json';
import campus from '../public/data/campus-map.json';
import sports from '../public/data/sports.json';
import sea from '../public/data/sea.json';
import placements from '../public/models/landmarks/placements.json';

const bounds = CAMPUS_VIEW;
afterEach(() => vi.unstubAllGlobals());
describe('map camera', () => {
  it('zooms about the cursor without moving its world point, until an edge clamps', () => {
    const f = { x0: -300, z0: -400, width: 600, height: 400, scale: 1 };
    const next = zoomFrame(f, 2, 90, 170, bounds);
    expect(pointAt(next, 90, 170)).toEqual(pointAt(f, 90, 170));
    expect(zoomFrame(next, .5, 90, 170, bounds)).toEqual(f);
  });
  it('clamps extreme zoom and pan, centring axes where the sheet is smaller than the viewport', () => {
    const fit = fitCampusFrame(960, 400, bounds), min = clampFrame({ ...fit, scale: .00001, x0: 10000, z0: -10000 }, bounds);
    expect(min).toEqual(fit);
    const max = zoomFrame(fit, 1e9, 480, 200, bounds);
    expect(max.scale).toBe(4);
    const pan = panFrame(max, 1e8, -1e8, bounds);
    expect(pan.x0).toBe(bounds.x0); expect(pan.z0 + pan.height / pan.scale).toBe(bounds.z1);
  });
  it.each([[920, 340], [370, 500]])('fits the campus, sea and Hamasen street blocks at %s × %s', (w, h) => {
    expect(campus.buildings.filter(b => b.id.startsWith('hamasen-exit-')).map(b => b.id).sort()).toEqual(['hamasen-exit-1', 'hamasen-exit-2']);
    // Visual-only waterfront buildings extend south of the map sheet.
    const background = campus.background.flat().filter(([x,z]) => x >= bounds.x0 && x <= bounds.x1 && z >= bounds.z0 && z <= bounds.z1);
    const points: [number, number][] = [...background, ...campus.buildings.flatMap(b => b.polygon), ...campus.hamasenPlaces.map(p => p.poi.position), ...sports.facilities.flatMap(f => f.polygon), ...sea.waterBodies.flatMap(b => b.polygon), ...sea.waterRoutes.flatMap(r => r.corridor), ...bus.stops.map(s => [s.boardingPoint[0], s.boardingPoint[2]]), placements['liberal-arts'].centroid, placements.gate.centroid, placements.tunnel.centroid] as [number, number][];
    const view = contentBounds(points, CAMPUS_VIEW), f = clampFrame(fitCampusFrame(w, h, view), bounds);
    for (const [x, z] of points) {
      expect(frameX(f, x)).toBeGreaterThanOrEqual(-1e-6); expect(frameX(f, x)).toBeLessThanOrEqual(w + 1e-6);
      expect(frameY(f, z)).toBeGreaterThanOrEqual(-1e-6); expect(frameY(f, z)).toBeLessThanOrEqual(h + 1e-6);
    }
  });
});
describe('map picking and labels', () => {
  const polygon: [number, number][] = [[0, 0], [10, 0], [10, 3], [3, 3], [3, 10], [0, 10]];
  it('hits concave polygons and boundaries, but excludes cutouts and nearby empty space', () => {
    expect(pointInPolygon([1, 8], polygon)).toBe(true); expect(pointInPolygon([8, 8], polygon)).toBe(false);
    expect(pointInPolygon([3, 6], polygon)).toBe(true); expect(pointInPolygon([-1, 6], polygon)).toBe(false);
    const sheet = new CampusMinimap(); sheet.buildings = [{ id: 'a', name: 'A', polygon, kind: 'teaching', walkable: true }];
    const f = { x0: -10, z0: -20, scale: 5, width: 300, height: 300 };
    expect(sheet.pickBuilding(f, 55, 140)?.id).toBe('a'); expect(sheet.pickBuilding(f, 90, 140)).toBeUndefined();
  });
  it('uses priority, zoom thresholds, viewport bounds and marker exclusion boxes', () => {
    const low = { id: 'low', x: 10, y: 10, width: 50, height: 20, priority: 1 };
    const high = { ...low, id: 'high', x: 30, priority: 5 };
    const detail = { ...low, id: 'detail', x: 100, minScale: 1 };
    const off = { ...low, id: 'off', x: 180 };
    expect(declutterLabels([low, high, detail, off], 200, 100, .5).map(l => l.id)).toEqual(['high']);
    expect(declutterLabels([low, high, detail], 200, 100, 2).map(l => l.id)).toEqual(['high', 'detail']);
    expect(declutterLabels([high], 200, 100, 2, [high])).toEqual([]);
  });
  it('deduplicates real bus stops by name and uses the first boarding point, not the sign or berth', () => {
    const stops = bus.stops.map(s => ({ id: s.id, name: s.name, boardingPoint: s.boardingPoint as [number, number, number] }));
    const markers = busStopMarkers(stops);
    expect(markers).toHaveLength(new Set(stops.map(s => s.name)).size);
    for (const m of markers) expect([m.x, m.y, m.z]).toEqual(stops.find(s => `bus:${s.name}` === m.id)!.boardingPoint);
    expect(busStopMarkers([{ id: 'hamasen-campus-stop', name: '哈瑪星站 2 號出口', boardingPoint: [0, 0, 0] }])[0].label).toBe('哈瑪星站 2 號出口・校園公車（位置示意）');
  });
});

function canvasFixture() {
  const captures = new Set<number>();
  const canvas = Object.assign(new EventTarget(), { getBoundingClientRect: () => ({ left: 0, top: 0 }), clientHeight: 400,
    setPointerCapture: (id: number) => captures.add(id), hasPointerCapture: (id: number) => captures.has(id), releasePointerCapture: (id: number) => captures.delete(id) }) as unknown as HTMLCanvasElement;
  let f = { x0: -300, z0: -400, width: 600, height: 400, scale: 1 };
  const pick = vi.fn(), change = vi.fn(next => { f = next; });
  bindMapGestures(canvas, { frame: () => f, bounds: () => bounds, pick, change });
  const event = (type: string, x: number, y: number, pointerId = 1, extra = {}) => { const e = Object.assign(new Event(type, { cancelable: true }), { clientX: x, clientY: y, pointerId, button: 0, ...extra }); canvas.dispatchEvent(e); return e; };
  return { event, pick, change, frame: () => f };
}
describe('map gestures', () => {
  it('accepts jitter as a click and suppresses the click after a drag', () => {
    const c = canvasFixture(); c.event('pointerdown', 100, 100); c.event('pointermove', 104, 103); c.event('pointerup', 104, 103); c.event('click', 104, 103);
    expect(c.pick).toHaveBeenCalledExactlyOnceWith(104, 103); expect(c.change).not.toHaveBeenCalled();
    c.event('pointerdown', 100, 100); c.event('pointermove', 120, 100); c.event('pointerup', 120, 100); c.event('click', 120, 100);
    expect(c.frame().x0).toBe(-320); expect(c.pick).toHaveBeenCalledTimes(1);
  });
  it('pinches around the moving midpoint without selecting a marker on release', () => {
    const c = canvasFixture(), center = pointAt(c.frame(), 150, 100);
    c.event('pointerdown', 100, 100, 1); c.event('pointerdown', 200, 100, 2); c.event('pointermove', 300, 100, 2);
    expect(c.frame().scale).toBe(2); expect(pointAt(c.frame(), 200, 100)).toEqual(center);
    c.event('pointerup', 100, 100, 1); c.event('pointerup', 300, 100, 2); c.event('click', 300, 100); expect(c.pick).not.toHaveBeenCalled();
  });
  it('cancels taps and uses the wheel cursor as the zoom anchor', () => {
    const c = canvasFixture(); c.event('pointerdown', 100, 100); c.event('pointercancel', 100, 100); c.event('click', 100, 100); expect(c.pick).not.toHaveBeenCalled();
    const before = pointAt(c.frame(), 90, 120);
    expect(c.event('wheel', 90, 120, 1, { deltaY: -100, deltaMode: 0 }).defaultPrevented).toBe(true);
    const after = pointAt(c.frame(), 90, 120); expect(after[0]).toBeCloseTo(before[0]); expect(after[1]).toBeCloseTo(before[1]);
  });
});

it('routes K through WalkInput, opens by minimap click/keyboard, and preserves M', () => {
  let minimapFocused = false;
  const win = Object.assign(new EventTarget(), { matches: (selector: string) => minimapFocused && selector === '.walk-minimap' }), doc = Object.assign(new EventTarget(), { pointerLockElement: null });
  vi.stubGlobal('window', win); vi.stubGlobal('document', doc);
  const el = () => Object.assign(new EventTarget(), { style: {}, classList: { remove: () => {} }, setPointerCapture: () => {} }) as unknown as HTMLElement;
  let open = false; const press = vi.fn(k => { if (k === 'k') open = true; }); const modal = vi.fn(k => { if (k === 'k') open = false; });
  const input = new WalkInput(el(), el(), el(), { press, modal, moveStarted() {}, look() {}, zoom() {}, canLook: () => false });
  const key = (key: string) => { const e = Object.assign(new Event('keydown', { cancelable: true }), { key, repeat: false }); win.dispatchEvent(e); return e; };
  expect(key('K').defaultPrevented).toBe(true); expect(open).toBe(true);
  input.mode = 'menu'; key('k'); expect(open).toBe(false); expect(modal).toHaveBeenCalledWith('k', 'menu');
  input.mode = 'walk'; key('m'); expect(press).toHaveBeenLastCalledWith('m');
  const mini = el(); bindMinimapOpen(mini, () => { open = true; }); mini.dispatchEvent(new Event('click')); expect(open).toBe(true);
  open = false; mini.dispatchEvent(Object.assign(new Event('keydown'), { key: 'Enter' })); expect(open).toBe(true);
  bindMinimapOpen(win as unknown as HTMLElement, () => { open = true; });
  minimapFocused = true; open = false; key(' '); expect(open).toBe(true); expect(input.jump).toBe(false); input.dispose();
  const runtime = readFileSync(new URL('../src/walk/runtime.ts', import.meta.url), 'utf8');
  expect(runtime).toContain("if (k === 'k') { setMenu(true, 'map'); return; }");
  expect(runtime).toContain("setMenu(k === 'k' && !menu.classList.contains('is-map'), 'map')");
  expect(runtime).toMatch(/bindMinimapOpen\(minimap,[\s\S]*?setMenu\(true, 'map'\)/);
  const html = hudTemplate(p => p, '/');
  for (const kind of ['quest', 'stamp', 'bike', 'bus', 'restroom']) expect(html).toContain(`data-map-kind="${kind}"`);
  expect(html.match(/data-pane="map"/g)).toHaveLength(1); expect(html).toContain('開啟校園大地圖（K）');
});
