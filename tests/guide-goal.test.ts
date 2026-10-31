import { describe, expect, it } from 'vitest';
import { badgeGlyph, beaconFade, trackedTarget } from '../src/story/guide-goal';
import { CAMPUS_VIEW, fitCampusFrame, frameX, frameY, pickMarker, type MapMarker } from '../src/walk/minimap';

describe('tracked side quest guidance', () => {
  const definition = { accept: { near: 'npc:intl-mia' } };
  it('leads to the current step once accepted', () => {
    expect(trackedTarget({ definition, step: { target: 'zone:library' } })).toBe('zone:library');
  });
  it('leads to whoever hands the quest out before it is accepted', () => {
    expect(trackedTarget({ definition })).toBe('npc:intl-mia');
  });
});

describe('beacon fade', () => {
  it('is full from 12 m out and gone by 4 m', () => {
    expect(beaconFade(40)).toBe(1);
    expect(beaconFade(12)).toBe(1);
    expect(beaconFade(4)).toBe(0);
    expect(beaconFade(1)).toBe(0);
  });
  it('never brightens as the player closes in', () => {
    for (let d = 4; d < 12; d += .25) expect(beaconFade(d)).toBeLessThanOrEqual(beaconFade(d + .25));
  });
});

describe('badge glyph', () => {
  it.each([['阿灣', '灣'], ['小禾', '禾'], ['林老師', '林'], ['建宇學長', '建'], ['海伯', '海'], ['Mia', 'M'], ['', '']])('%s reads as %s', (name, glyph) => {
    expect(badgeGlyph(name)).toBe(glyph);
  });
});

describe('campus map', () => {
  const frame = fitCampusFrame(300, 440);
  const marker = (id: string, x: number, z: number): MapMarker => ({ id, kind: 'quest', x, y: 0, z, label: id });
  it('keeps the whole walkable campus on a phone canvas', () => {
    for (const [x, z] of [[CAMPUS_VIEW.x0, CAMPUS_VIEW.z0], [CAMPUS_VIEW.x1, CAMPUS_VIEW.z1]]) {
      expect(frameX(frame, x)).toBeGreaterThanOrEqual(-1e-6); expect(frameX(frame, x)).toBeLessThanOrEqual(300 + 1e-6);
      expect(frameY(frame, z)).toBeGreaterThanOrEqual(-1e-6); expect(frameY(frame, z)).toBeLessThanOrEqual(440 + 1e-6);
    }
  });
  it('a tap picks the nearest marker within reach, or none', () => {
    const a = marker('a', -55, -29), b = marker('b', -40, -29), px = frameX(frame, -55), py = frameY(frame, -29);
    expect(pickMarker([b, a], frame, px, py)?.id).toBe('a');
    expect(pickMarker([a, b], frame, px + 100, py)).toBeUndefined();
  });
});
