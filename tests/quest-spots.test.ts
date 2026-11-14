import { describe, expect, it } from 'vitest';
import * as T from 'three';
import { QuestSpotField, SPOT_RECIPES, activeSpotIds, baseKind, spotGeometry, type QuestSpot, type SpotKind } from '../src/world/quest-spots';
import { npcsWithinCap } from '../src/world/npc';
import authored from '../public/data/quests.json';

const spots = (authored as unknown as { spots: Record<string, QuestSpot> }).spots;
const settle = () => new Promise(resolve => setTimeout(resolve, 0));
const prop = async () => new T.BoxGeometry(1, 1, 1).toNonIndexed();
const field = () => new QuestSpotField({ spots, support: () => 0, terrain: () => 0, alive: () => true, loadProp: async () => { const g = await prop(); const n = g.attributes.position.count; g.setAttribute('color', new T.BufferAttribute(new Float32Array(n * 3), 3)); return g; } }, () => new T.MeshBasicMaterial({ vertexColors: true }));

describe('quest spots', () => {
  it('every kind builds one merged low-poly mesh', () => {
    for (const kind of Object.keys(SPOT_RECIPES) as SpotKind[]) {
      const g = spotGeometry(kind, () => undefined);
      expect(g.attributes.position.count).toBeGreaterThan(0);
      expect(g.attributes.position.count / 3).toBeLessThan(600);
    }
  });
  it('an object appears with its step and goes with it, freeing its geometry', async () => {
    const f = field();
    f.sync(['gate-notice']); await settle(); await settle();
    expect(f.shown).toEqual(['gate-notice']);
    expect(f.group.children).toHaveLength(1);
    let freed = false; f.mesh('gate-notice')!.geometry.addEventListener('dispose', () => { freed = true; });
    f.sync([]);
    expect(f.shown).toEqual([]); expect(f.group.children).toHaveLength(0); expect(freed).toBe(true);
  });
  it('nothing on show costs nothing: no meshes, no colliders', () => {
    const f = field();
    expect(f.group.children).toHaveLength(0); expect(f.bodies()).toEqual([]);
  });
  it('a solid object stops the player only while it is there', async () => {
    const f = field();
    f.sync(['gate-notice']); await settle(); await settle();
    expect(f.bodies().map(b => b.id)).toEqual(['spot:gate-notice:0']);
    f.sync([]);
    expect(f.bodies()).toEqual([]);
  });
  it('a step that finishes before its props load never shows up', async () => {
    const f = field();
    f.sync(['gate-notice']); f.sync([]); await settle(); await settle();
    expect(f.shown).toEqual([]);
  });
  it('walks end on the stand point, in reach of the object; the object is what the marker points at', () => {
    const f = field();
    for (const [id, s] of Object.entries(spots)) {
      expect(f.point(id)!.toArray()).toEqual([s.at[0], 0, s.at[1]]);
      expect(f.stand(id)!.toArray()).toEqual([s.stand[0], 0, s.stand[1]]);
      expect(Math.hypot(s.at[0] - s.stand[0], s.at[1] - s.stand[1])).toBeLessThan(3);
      // A collider must not cover the point the walk ends on (player radius .3).
      for (const [x, z, r] of SPOT_RECIPES[s.kind].solid ?? []) expect(Math.hypot(s.at[0] - s.stand[0], s.at[1] - s.stand[1]) - Math.hypot(x, z)).toBeGreaterThan(r + .3);
    }
  });
  it('finds the spots the current steps need, once each, and ignores people and places', () => {
    expect(activeSpotIds([{ step: { target: 'spot:a' } }, { step: { target: 'spot:a' } }, { step: { target: 'npc:x' } }, {}, { step: { target: 'spot:b' } }])).toEqual(['a', 'b']);
  });
});

describe('quest works (v10.2)', () => {
  it('every variant kind extends its base and names a base that exists', () => {
    for (const kind of Object.keys(SPOT_RECIPES) as SpotKind[]) {
      const base = baseKind(kind);
      expect(SPOT_RECIPES[base], kind).toBeDefined();
      if (kind !== base) expect(SPOT_RECIPES[kind].parts.length + (SPOT_RECIPES[kind].props?.length ?? 0)).toBeGreaterThan(SPOT_RECIPES[base].parts.length + (SPOT_RECIPES[base].props?.length ?? 0) - 2);
    }
    expect(baseKind('planters-edge')).toBe('planters'); expect(baseKind('viewpoint')).toBe('viewpoint');
  });
  it('a finished work stays in its variant, is rebuilt when the variant changes, and its colliders follow the built kind', async () => {
    const f = field();
    f.sync([], [{ spot: 'admin-planters', kind: 'planters-row' }]); await settle(); await settle();
    expect(f.shown).toEqual(['admin-planters']); expect(f.kindOf('admin-planters')).toBe('planters-row');
    expect(f.bodies()).toHaveLength(3);
    const first = f.mesh('admin-planters')!;
    f.sync([], [{ spot: 'admin-planters', kind: 'planters-row' }]); await settle();
    expect(f.mesh('admin-planters')).toBe(first);
    f.sync([], [{ spot: 'admin-planters', kind: 'planters-edge' }]); await settle(); await settle();
    expect(f.kindOf('admin-planters')).toBe('planters-edge'); expect(f.mesh('admin-planters')).not.toBe(first); expect(f.bodies()).toHaveLength(2);
    f.sync([]); expect(f.shown).toEqual([]); expect(f.bodies()).toEqual([]);
  });
  it('a variant change while props load shows only the final kind; a step on the same spot beats a work', async () => {
    const f = field();
    f.sync([], [{ spot: 'gate-notice', kind: 'notice-claim' }]); f.sync([], [{ spot: 'gate-notice', kind: 'notice' }]);
    await settle(); await settle(); await settle();
    expect(f.shown).toEqual(['gate-notice']); expect(f.kindOf('gate-notice')).toBe('notice'); expect(f.group.children).toHaveLength(1);
    f.sync(['gate-notice'], [{ spot: 'gate-notice', kind: 'notice-claim' }, { spot: 'gate-lost-ledger', kind: 'ledger-entry' }]); await settle(); await settle();
    expect(f.kindOf('gate-notice')).toBe('notice'); expect(f.kindOf('gate-lost-ledger')).toBe('ledger-entry');
    expect(f.shown.sort()).toEqual(['gate-lost-ledger', 'gate-notice']);
  });
});

describe('NPC keep list', () => {
  const n = (id: string, talking = false) => ({ id, talking });
  const people = ['a', 'b', 'c', 'd'].map(id => n(id));
  it('the cap keeps the nearest', () => { expect(npcsWithinCap(people, 2, []).map(x => x.id)).toEqual(['a', 'b']); });
  it('a focused target is kept however far down the list, on top of the cap, so nobody nearby is squeezed out', () => {
    expect(npcsWithinCap(people, 2, [], 'd').map(x => x.id).sort()).toEqual(['a', 'b', 'd']);
    expect(npcsWithinCap(people, 2, ['a', 'b'], 'd').map(x => x.id).sort()).toEqual(['a', 'b', 'd']);
    expect(npcsWithinCap(people, 2, [], 'a').map(x => x.id)).toEqual(['a', 'b']);
  });
  it('the one talking and story NPCs always stay', () => {
    expect(npcsWithinCap([n('a'), n('b'), n('c', true)], 1, []).map(x => x.id)).toEqual(['c']);
    expect(npcsWithinCap(people, 0, ['c', 'd']).map(x => x.id).sort()).toEqual(['c', 'd']);
  });
});
