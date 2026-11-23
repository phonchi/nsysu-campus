import { afterEach, describe, expect, it, vi } from 'vitest';
import { Vector3 } from 'three';
import graph from '../public/data/walkthrough/outdoor-graph.json';
import campusMap from '../public/data/campus-map.json';
import { graphPathSegments, pathLayerAlpha, pointInPolygon } from '../src/walk/campus-map-view';
import { CampusMinimap } from '../src/walk/minimap';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('zoomed-in campus path layer', () => {
  it('resolves noncontiguous node IDs and projects X/Z, ignoring elevation and edge weight', () => {
    expect(graphPathSegments({ nodes: [{ id: 42, p: [10, 90, -20] }, { id: 7, p: [30, 120, -50] }], edges: [[7, 42, 200], [42, 42, 0], [42, 99, 30]] })).toEqual([[[30, -50], [10, -20]]]);
  });

  it('includes all real graph links and the hill connections at the LA anchor', () => {
    const segments = graphPathSegments(graph), nodes = new Map(graph.nodes.map(n => [n.id, n.p]));
    expect(segments).toHaveLength(graph.edges.filter(([a, b]) => a !== b).length);
    const hillEdges = graph.edges.filter(([a, b]) => a === graph.anchors.LA.node || b === graph.anchors.LA.node);
    expect(hillEdges.length).toBeGreaterThan(0);
    for (const [a, b] of hillEdges) {
      const p = nodes.get(a)!, q = nodes.get(b)!;
      expect(segments).toContainEqual([[p[0], p[2]], [q[0], q[2]]]);
    }
  });

  it('is invisible through .55 px/m and fades continuously to .65 alpha at 1.2 px/m', () => {
    for (const scale of [0, .2, .55]) expect(pathLayerAlpha(scale)).toBe(0);
    expect(pathLayerAlpha(.875)).toBeCloseTo(.325);
    expect(pathLayerAlpha(1.2)).toBeCloseTo(.65);
    expect(pathLayerAlpha(4)).toBe(.65);
    for (let scale = .55; scale < 1.3; scale += .025) expect(pathLayerAlpha(scale)).toBeLessThanOrEqual(pathLayerAlpha(scale + .025));
  });

  function fixture(graphOk = true, exits = false) {
    const buildings = exits ? [{ id: 'hamasen-exit-2', name: '哈瑪星站 2 號出口', kind: 'life', walkable: false, polygon: [[908, 543], [926, 543], [926, 570], [908, 570]] }] : [];
    const base = { base: { url: 'base.webp', bounds: [-900, -1100, 960, 700] }, roads: [], buildings, background: [] };
    const outdoors = { nodes: [{ id: 1, p: [-604, 49, -881] }, { id: 2, p: [-590, 45, -860] }, { id: 78, p: [916.9, -.31, 540.95] }], edges: [[1, 2, 30]], anchors: { 'hamasen-exit-2': { node: 78 } } };
    const fetchMock = vi.fn(async (url: string) => ({ ok: graphOk || !url.endsWith('outdoor-graph.json'), status: 503, json: async () => url.endsWith('outdoor-graph.json') ? outdoors : base }));
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('Image', class { src = ''; async decode() {} });
    const paths: { moveTo: ReturnType<typeof vi.fn>; lineTo: ReturnType<typeof vi.fn> }[] = [];
    vi.stubGlobal('Path2D', class {
      moveTo = vi.fn(); lineTo = vi.fn();
      constructor() { paths.push(this); }
    });
    const ctx = Object.assign(Object.fromEntries(['drawImage', 'translate', 'scale', 'save', 'restore', 'fillRect', 'beginPath', 'arc', 'fill', 'stroke', 'rotate', 'moveTo', 'lineTo', 'closePath', 'fillText'].map(k => [k, vi.fn()])), { measureText: () => ({ width: 20 }) });
    vi.stubGlobal('document', { createElement: () => ({ getContext: () => ctx }) });
    return { fetchMock, paths, ctx };
  }

  it('fetches/builds the cached path once and reuses it only for zoomed-in overview draws', async () => {
    const { fetchMock, paths, ctx } = fixture(), map = new CampusMinimap();
    await map.load(p => `/assets/${p}`);
    expect(fetchMock).toHaveBeenCalledWith('/assets/data/walkthrough/outdoor-graph.json');
    expect(paths).toHaveLength(1);
    expect(paths[0].moveTo).toHaveBeenCalledExactlyOnceWith(-604, -881);
    expect(paths[0].lineTo).toHaveBeenCalledExactlyOnceWith(-590, -860);
    const frame = { x0: -700, z0: -1000, scale: .3, width: 370, height: 500 }, canvas = ctx as unknown as CanvasRenderingContext2D;
    map.drawOverview(canvas, frame, [], undefined, new Vector3(), 0);
    expect(ctx.stroke).not.toHaveBeenCalledWith(paths[0]);
    map.drawOverview(canvas, { ...frame, scale: 1 }, [], undefined, new Vector3(), 0);
    map.drawOverview(canvas, { ...frame, scale: 2 }, [], undefined, new Vector3(), 0);
    expect((ctx.stroke as ReturnType<typeof vi.fn>).mock.calls.filter(args => args[0] === paths[0])).toHaveLength(2);
    expect(paths[0].lineTo).toHaveBeenCalledTimes(1); expect(fetchMock).toHaveBeenCalledTimes(2);
    (ctx.stroke as ReturnType<typeof vi.fn>).mockClear();
    map.draw(canvas, new Vector3(), 0);
    expect(ctx.stroke).not.toHaveBeenCalledWith(paths[0]);
  });

  it('keeps the base map ready when the optional graph request fails', async () => {
    const { paths } = fixture(false), warn = vi.spyOn(console, 'warn').mockImplementation(() => {}), map = new CampusMinimap();
    await map.load(p => p);
    expect(map.ready).toBe(true); expect(paths).toHaveLength(0); expect(warn).toHaveBeenCalledWith('minimap paths', expect.any(Error));
  });

  it('puts the station marker at its walking anchor outside the exterior footprint', async () => {
    fixture(true, true);
    const map = new CampusMinimap();
    await map.load(p => p);
    expect(map.destinationMarkers).toEqual([{ id: 'building:hamasen-exit-2', buildingId: 'hamasen-exit-2', kind: 'place', label: '哈瑪星站 2 號出口', x: 916.9, y: -.31, z: 540.95 }]);
    expect(map.defaultView().x1).toBe(960);
  });

  it('puts the railway park goal by the actual platform, on a path outside its footprint', () => {
    const park=campusMap.buildings.find(b=>b.id==='hamasen-rail-park')!;
    const anchor=(graph.anchors as Record<string,{node:number}>)['hamasen-rail-park'];
    const [x,,z]=graph.nodes[anchor.node].p;
    expect(park.polygon.some(([east])=>east>952)).toBe(true);
    expect(pointInPolygon([x,z],park.polygon as [number,number][])).toBe(false);
    expect(graph.edges.some(([a,b])=>a===anchor.node||b===anchor.node)).toBe(true);
  });
});
