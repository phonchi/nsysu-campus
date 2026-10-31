import { describe, expect, it } from 'vitest';
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, type Object3D, PerspectiveCamera, Vector3 } from 'three';
import { addOutlines } from '../src/render/outline';
import { Avatar } from '../src/walk/avatar';
import * as npcModule from '../src/world/npc';
import { PhotoMode } from '../src/games/photo';
import { CameraRig, EYE } from '../src/walk/camera-rig';
import type { Sweep } from '../src/walk/camera-rig';

const figure = (material = new MeshBasicMaterial()) => {
  const model = new Group(); model.add(new Mesh(new BoxGeometry(.5, 1.7, .4), material)); return model;
};

describe('v7 camera actor fading', () => {
  it('fades by distance to the finite foot-to-head axis', () => {
    const opacity = (npcModule as unknown as { npcCameraOpacity: (camera: Vector3, foot: Vector3, height: number) => number }).npcCameraOpacity;
    expect(opacity(new Vector3(.4, 1, 0), new Vector3(), 1.7)).toBe(0);
    expect(opacity(new Vector3(.8, 1, 0), new Vector3(), 1.7)).toBeCloseTo(5 / 9);
    expect(opacity(new Vector3(1.5, 1, 0), new Vector3(), 1.7)).toBe(1);
    expect(opacity(new Vector3(0, 3.2, 0), new Vector3(), 1.7)).toBe(1);
  });
  it('keeps hidden NPCs interactive, isolates materials and restores the speaker', async () => {
    const manager = new npcModule.NpcManager({ zones: {}, npcs: {} }, undefined, undefined, p => p);
    const shared = new MeshBasicMaterial(), model = figure(shared);
    const internal = manager as unknown as { source: () => Promise<{ scene: Group; animations: [] }>; spawn: (id: string, model: string, x: number, z: number) => Promise<{ root: Group; talking: boolean }>; npcs: Map<string, unknown>; updateCamera: (camera: Vector3) => void };
    internal.source = async () => ({ scene: model, animations: [] });
    const npc = await internal.spawn('guide', 'student', 0, 0); internal.npcs.set('guide', npc);
    const neighbour = await internal.spawn('s1', 'student', 4, 0); internal.npcs.set('s1', neighbour);
    internal.updateCamera(new Vector3(.4, 1, 0));
    expect(npc.root.visible).toBe(true);
    expect(npc.root.children[0].visible).toBe(false);
    expect(manager.nearest(new Vector3(0, 0, 0))).toBe('guide');
    expect(manager.distanceTo('guide', new Vector3())).toBeCloseTo(.055);
    expect(manager.bodies(new Vector3()).map(n => n.id)).toContain('guide');
    expect(shared.opacity).toBe(1);
    expect(neighbour.root.children[0].visible).toBe(true);
    internal.updateCamera(new Vector3(.8, 1, 0));
    const faded = npc.root.children[0].children[0] as Mesh;
    expect((faded.material as MeshBasicMaterial).opacity).toBeCloseTo(5 / 9);
    expect((faded.children[0] as Mesh).material).not.toBe((neighbour.root.children[0].children[0].children[0] as Mesh).material);
    expect(shared.opacity).toBe(1);
    expect(faded.children[0].visible).toBe(false);
    expect(neighbour.root.children[0].children[0].children[0].visible).toBe(true);
    internal.updateCamera(new Vector3(3, 1, 0));
    expect(faded.children[0].visible).toBe(true);
    npc.talking = true; internal.updateCamera(new Vector3(.4, 1, 0));
    expect(npc.root.children[0].visible).toBe(true);
    manager.dispose();
  });
  it('hides the rider and bicycle outline hulls while they fade', () => {
    const avatar = new Avatar(), model = figure(), bike = figure();
    addOutlines(model, 'character'); addOutlines(bike, 'character');
    avatar.setModel(model); avatar.riding = true; avatar.setVehicle(bike);
    const hulls: Object3D[] = [];
    avatar.root.traverse(o => { if (o.userData.outlineHull) hulls.push(o); });
    expect(hulls.length).toBeGreaterThanOrEqual(2);
    avatar.setOpacity(.8);
    expect(hulls.every(h => !h.visible)).toBe(true);
    avatar.setOpacity(1);
    expect(hulls.every(h => h.visible)).toBe(true);
    avatar.dispose();
  });
  it('fades the bicycle along with the rider without changing a shared material', () => {
    const avatar = new Avatar(), shared = new MeshBasicMaterial(), bike = figure(shared);
    avatar.setModel(figure()); avatar.riding = true; avatar.setVehicle(bike);
    avatar.setOpacity(.4);
    expect((bike.children[0] as Mesh).material).not.toBe(shared);
    expect(((bike.children[0] as Mesh).material as MeshBasicMaterial).opacity).toBe(.4);
    expect(shared.opacity).toBe(1);
    avatar.setOpacity(1);
    expect(((bike.children[0] as Mesh).material as MeshBasicMaterial).opacity).toBe(1);
    avatar.dispose();
  });
});


function photoFixture(sweep?: Sweep) {
  const camera = new PerspectiveCamera();
  const photo = Object.assign(Object.create(PhotoMode.prototype), {
    active: true, pivot: new Vector3(0, 1.3, 0), origin: new Vector3(), yaw: 0, pitch: -.12, dist: 4.5,
    previous: new Vector3(), delta: new Vector3(),
    d: { camera, ground: () => 0, sweep },
  }) as PhotoMode;
  return { photo, camera, pivot: (photo as unknown as { pivot: Vector3 }).pivot };
}
const wallSweep: Sweep = (a, b, radius) => {
  const length = a.distanceTo(b);
  if (b.z < a.z && b.z < -2 + radius) return Math.max(0, length * (a.z + 2 - radius) / (a.z - b.z));
  if (b.z > a.z && b.z > 2 - radius) return Math.max(0, length * (2 - radius - a.z) / (b.z - a.z));
  return length;
};
it('sweeps every small photo pivot step and the outgoing camera arm', () => {
  const { photo, camera, pivot } = photoFixture(wallSweep);
  photo.update(1 / 60, new Set());
  expect(camera.position.z).toBeLessThanOrEqual(1.85);
  for (let i = 0; i < 540; i++) photo.update(1 / 60, new Set(['w']));
  expect(pivot.z).toBeGreaterThanOrEqual(-1.85);
  photo.yaw = Math.PI;
  photo.update(1 / 60, new Set());
  expect(camera.position.z).toBeGreaterThanOrEqual(-1.85);
});
it('preserves photo movement without a sweep', () => {
  const { photo, pivot } = photoFixture();
  for (let i = 0; i < 540; i++) photo.update(1 / 60, new Set(['w']));
  expect(pivot.z).toBeCloseTo(-15);
});
it('keeps the third person camera above feet and aimed at its pivot', () => {
  const camera = new PerspectiveCamera(), foot = new Vector3(0, 3, 0);
  const rig = new CameraRig(camera, (a, b) => a.distanceTo(b));
  rig.pitch = .5;
  rig.update(1 / 60, { foot, running: false, moving: false });
  expect(camera.position.y).toBeGreaterThanOrEqual(foot.y + .5);
  const aim = new Vector3(0, foot.y + 1.45, 0).sub(camera.position).normalize();
  expect(camera.getWorldDirection(new Vector3()).distanceTo(aim)).toBeLessThan(1e-6);
  rig.firstPerson = true;
  rig.update(1 / 60, { foot, running: false, moving: false });
  expect(camera.position.y).toBeCloseTo(foot.y + EYE - .01);
});

describe('landmark footings', () => {
  const place = { lm: { centroid: [0, 0] as [number, number], yaw: 0 } };
  it('fills the gap under a box on a slope, and adds nothing on flat ground', async () => {
    const { landmarkFootings, LANDMARK_IDS } = await import('../src/world/landmarks');
    const id = LANDMARK_IDS[0], placements = { [id]: place.lm }, collisions = { [id]: { boxes: [{ center: [0, 2, 0] as [number, number, number], size: [10, 4, 10] as [number, number, number], yaw: 0 }] } };
    expect(landmarkFootings(placements, collisions, () => 0)).toEqual([]);
    const [f] = landmarkFootings(placements, collisions, x => x < 0 ? 0 : 3);
    expect(f.center[1] - f.size[1] / 2).toBeCloseTo(-.1);
    expect(f.center[1] + f.size[1] / 2).toBeCloseTo(3);
  });
});
