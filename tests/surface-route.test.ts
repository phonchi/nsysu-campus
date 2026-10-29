import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { surfaceRouteSegments } from '../src/walk/surface-route';

describe('surface-bound route display', () => {
  it('samples the actual slope without spline overshoot and leaves the source path untouched', () => {
    const path = [new Vector3(0, 0, 0), new Vector3(2, 1, 0), new Vector3(2, 2, 2)];
    const pieces = surfaceRouteSegments(path, { support: (x, z) => (x + z) / 2, clear: () => true });
    expect(pieces).toHaveLength(1);
    expect(pieces[0].length).toBeGreaterThan(6);
    for (const p of pieces[0]) {
      expect(p.x >= 0 && p.x <= 2 && p.z >= 0 && p.z <= 2).toBe(true);
      expect(p.y).toBeCloseTo((p.x + p.z) / 2 + .035, 6);
    }
    expect(path[0].y).toBe(0);
  });
  it('splits unsupported tunnel portals and blocked walls instead of reconnecting retained points', () => {
    const pieces = surfaceRouteSegments([new Vector3(-3, 0, 0), new Vector3(3, 0, 0)], {
      support: x => Math.abs(x) < .7 ? undefined : 0,
      clear: (a, b) => !(a.x < 2 && b.x >= 2),
    });
    expect(pieces.length).toBeGreaterThanOrEqual(2);
    for (const part of pieces) for (let i = 1; i < part.length; i++) {
      expect(part[i].distanceTo(part[i - 1])).toBeLessThan(.36);
      expect(!(part[i - 1].x < 2 && part[i].x >= 2)).toBe(true);
    }
  });
  it('does not project a ground-level fallback onto a high roof or draw vertical floor changes', () => {
    expect(surfaceRouteSegments([new Vector3(), new Vector3(100, 0, 0)], { support: () => 8, clear: () => true })).toEqual([]);
    expect(surfaceRouteSegments([new Vector3(), new Vector3(0, 4, 0)], { support: (_x, _z, y) => y, clear: () => true })).toEqual([]);
    expect(surfaceRouteSegments([], { support: () => 0, clear: () => true })).toEqual([]);
  });
  it('refines a terrain-triangle crease instead of bridging over its raised vertex', () => {
    const support = (x: number) => .2 - Math.abs(x - .175);
    const pieces = surfaceRouteSegments([new Vector3(0, .025, 0), new Vector3(.35, .025, 0)], { support, clear: () => true });
    expect(pieces[0].some(p => Math.abs(p.x - .175) < 1e-6)).toBe(true);
    for (const part of pieces) for (let i = 1; i < part.length; i++) {
      const midpoint = part[i - 1].clone().lerp(part[i], .5);
      expect(Math.abs(midpoint.y - support(midpoint.x) - .035)).toBeLessThanOrEqual(.01);
    }
  });
});
