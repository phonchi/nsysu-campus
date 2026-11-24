import { afterEach, expect, it, vi } from 'vitest';
import { Box3, Vector3 } from 'three';
import { grassPlacements, GrassTufts } from '../src/render/ground';
import { GrowableSurfaceField } from '../src/world/growable-surface';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('keeps the old grass during a budgeted refill and publishes the same roots as a full scan', () => {
  const context = {
    fillRect() {}, beginPath() {}, moveTo() {}, quadraticCurveTo() {}, fill() {},
  };
  vi.stubGlobal('document', { createElement: () => ({ getContext: () => context }) });
  let clock = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => clock += .25);
  const field = new GrowableSurfaceField({
    surfaceVersion: 'test',
    surfaceAt: () => ({ id: 'soil', height: 2, normal: new Vector3(0, 1, 0), kind: 'terrain', layer: 'ground' }),
  }, { free: () => true });
  field.setReady(true);
  const grass = new GrassTufts(24, field, 15);
  const home = new Vector3();
  const next = new Vector3(13, 0, 0);
  const complete = (at: Vector3, version: number) => {
    for (let frame = 0; frame < 200 && grass.mesh.instanceMatrix.version === version; frame++) grass.update(at);
    expect(grass.mesh.instanceMatrix.version).toBe(version + 1);
    const expected = [...grassPlacements(field, at, 15)].slice(0, grass.limit);
    const roots = grass.diagnostics.roots.map(root => root.position);
    expect(roots).toEqual(expected.map(({ x, z }) => [Math.fround(x), 2, Math.fround(z)]));
    expect(grass.diagnostics.illegal).toBe(0);
  };

  grass.update(home);
  expect(grass.mesh.count).toBe(0);
  complete(home, 0);
  const originalRoots = grass.diagnostics.roots;
  grass.update(next);
  expect(grass.mesh.instanceMatrix.version).toBe(1);
  expect(grass.diagnostics.roots).toEqual(originalRoots);
  complete(next, 1);

  field.setVolumes('blocker', [new Box3(new Vector3(0, 0, -16), new Vector3(24, 5, -3))]);
  grass.update(next);
  expect(grass.mesh.count).toBe(0);
  complete(next, 2);
  grass.limit = 0;
  expect(grass.mesh.count).toBe(0);
  grass.update(next);
  expect(grass.mesh.instanceMatrix.version).toBe(3);
});
