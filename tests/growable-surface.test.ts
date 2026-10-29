import { describe, expect, it } from 'vitest';
import { Box3, Vector3 } from 'three';
import { GrowableSurfaceField } from '../src/world/growable-surface';
import { landmarkVegetationVolumes } from '../src/world/landmarks';

const soil = (height = 0) => ({ id: 'soil:0', height, normal: new Vector3(0, 1, 0), kind: 'terrain' as const, layer: 'ground' as const });
const source = (height = 0) => ({ surfaceVersion: 'fixture:1', surfaceAt: (_x: number, _z: number) => soil(height) });
const free = { free: () => true };

describe('growable surface selection', () => {
  it('waits for exclusions, rejects absent ground, and roots only on the explicit soil layer', () => {
    const field = new GrowableSurfaceField({ ...source(), surfaceAt: (x: number, _z: number) => x > 4 ? undefined : soil(2) }, free);
    expect(field.sample(0, 0, 1)).toBeUndefined();
    field.setReady(true);
    expect(field.sample(0, 0, 1)?.height).toBe(2);
    expect(field.sample(5, 0, 1)).toBeUndefined();
  });
  it('excludes the entire wind-swept tuft at a road or building edge, including indoor empty space', () => {
    const field = new GrowableSurfaceField(source(), free);
    field.setRoads([{ points: [[-10, 0], [10, 0]], width: 4 }]);
    field.setVolumes('building', [new Box3(new Vector3(4, -1, 5), new Vector3(8, 8, 9))]);
    field.setReady(true);
    expect(field.sample(0, 2.2, 1.6)).toBeUndefined(); // root outside, blades over asphalt
    expect(field.sample(0, 4, 1.6)).toBeDefined();
    expect(field.sample(6, 7, 1)).toBeUndefined(); // enclosed air counts too
    expect(field.sample(3.8, 7, 1.6)).toBeUndefined(); // leaf/ wind overlap
  });
  it('keeps soil above a tunnel, blocks the bore and invalidates an existing generation when geometry changes', () => {
    const field = new GrowableSurfaceField(source(12), free);
    field.setRoads([{ points: [[-10, 0], [10, 0]], width: 7, tunnel: true }]);
    field.setVolumes('tunnel', [new Box3(new Vector3(-10, -1, -5), new Vector3(10, 7, 5))]);
    field.setReady(true);
    expect(field.sample(0, 0, 1)).toBeDefined();
    const revision = field.revision;
    field.setVolumes('new-building', [new Box3(new Vector3(-1, 10, -1), new Vector3(1, 20, 1))]);
    expect(field.revision).toBeGreaterThan(revision);
    expect(field.sample(0, 0, 1)).toBeUndefined();
    const bore = new GrowableSurfaceField(source(1), free);
    bore.setVolumes('tunnel', [new Box3(new Vector3(-10, -1, -5), new Vector3(10, 7, 5))]);
    bore.setReady(true);
    expect(bore.sample(0, 0, 1)).toBeUndefined();
  });
  it('rejects a tuft whose root has soil but whose blades span a carved cell', () => {
    const field = new GrowableSurfaceField({ ...source(), surfaceAt: (x: number) => x >= 0 ? soil() : undefined }, free);
    field.setReady(true);
    expect(field.sample(.2, 0, 1)).toBeUndefined();
    expect(field.sample(2, 0, 1)).toBeDefined();
  });
  it('excludes a raised tunnel apron and its underside while retaining soil above the bore', () => {
    const volumes = landmarkVegetationVolumes({ tunnel: { centroid: [0, 0], yaw: 0, elevation: 1 } }, { tunnel: { boxes: [] } }, () => 0);
    const apron = new GrowableSurfaceField(source(0), free);
    apron.setVolumes('tunnel', volumes); apron.setReady(true);
    expect(apron.sample(0, 4, 1)).toBeUndefined();
    const above = new GrowableSurfaceField(source(10), free);
    above.setVolumes('tunnel', volumes); above.setReady(true);
    expect(above.sample(0, -10, 1)).toBeDefined();
  });
});
