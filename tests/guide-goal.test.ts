import { describe, expect, it } from 'vitest';
import { badgeGlyph, beaconFade, nextCorner, routeDue, routeProgress, trackedTarget, ROUTE_RETRY_MS, ROUTE_THROTTLE_MS } from '../src/story/guide-goal';
import { acceptPriority, destinationDistance, findDestination, floorLabel, nextFocus, questPriority, storyPriority, walkResumes, AT_DESTINATION } from '../src/story/focus';
import { selectInteraction } from '../src/walk/interaction-choice';
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
  it.each([['阿灣', '灣'], ['小禾', '禾'], ['呂老師', '呂'], ['建宇學長', '建'], ['海伯', '海'], ['Mia', 'M'], ['', '']])('%s reads as %s', (name, glyph) => {
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

describe('main and side focus', () => {
  it('cycles main, then each side quest in progress, then main', () => {
    expect(nextFocus(['a', 'b'])).toBe('a');
    expect(nextFocus(['a', 'b'], 'a')).toBe('b');
    expect(nextFocus(['a', 'b'], 'b')).toBeUndefined();
  });
  it('stays on the main story with nothing on the side, and treats a stale focus as main', () => {
    expect(nextFocus([])).toBeUndefined();
    expect(nextFocus([], 'a')).toBeUndefined();
    expect(nextFocus(['b'], 'gone')).toBe('b');
  });
  it('E follows the focus: the focused line beats the other one, either way round', () => {
    expect(questPriority('spot:x', true)).toBeGreaterThan(storyPriority(true));
    expect(storyPriority(false)).toBeGreaterThan(questPriority('npc:x', false));
    expect(acceptPriority(true)).toBeGreaterThan(storyPriority(true));
    expect(storyPriority(true, true)).toBe(100); // an open dialogue always comes first
  });
  it('a quest step on the ground beats doors and landmarks even out of focus', () => {
    for (const target of ['spot:x', 'dest:SC1005', 'zone:gate']) expect(questPriority(target, false)).toBeGreaterThan(50);
    const door = { id: 'door:1', priority: 50, distance: 0 }, step = { id: 'quest:a', priority: questPriority('spot:x', false), distance: 2 };
    expect(selectInteraction([door, step])?.id).toBe('quest:a');
  });
});

describe('story route replanning', () => {
  const base = { now: 100000, at: 100000 - ROUTE_THROTTLE_MS - 1, dirty: false, empty: false, goalMoved: false, offRoute: false };
  const line = [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 10 }];
  it('stays quiet standing on a good route, however long it has been', () => {
    expect(routeDue({ ...base, at: 0 })).toBe(false);
  });
  it('replans at once for a new target', () => { expect(routeDue({ ...base, dirty: true, at: base.now })).toBe(true); });
  it('replans when the goal moved or the player left the line, throttled', () => {
    expect(routeDue({ ...base, goalMoved: true })).toBe(true);
    expect(routeDue({ ...base, offRoute: true })).toBe(true);
    expect(routeDue({ ...base, offRoute: true, at: base.now - 100 })).toBe(false);
  });
  it('retries a failed plan slowly', () => {
    expect(routeDue({ ...base, empty: true })).toBe(false);
    expect(routeDue({ ...base, empty: true, at: base.now - ROUTE_RETRY_MS - 1 })).toBe(true);
  });
  it('measures how far off the line the player is, on the nearest stretch', () => {
    expect(routeProgress(line, { x: 5, z: 2 })).toEqual({ segment: 0, offset: 2 });
    expect(routeProgress(line, { x: 12, z: 6 })).toEqual({ segment: 1, offset: 2 });
    expect(routeProgress([], { x: 0, z: 0 }).offset).toBe(Infinity);
  });
  it('aims ahead of the player, never back at a corner already passed', () => {
    expect(nextCorner(line, { x: 1, z: 0 })).toEqual({ x: 10, z: 0 });
    expect(nextCorner(line, { x: 9, z: 0 })).toEqual({ x: 10, z: 10 });
    expect(nextCorner(line, { x: 10, z: 8 })).toBeUndefined();
  });
});

describe('room targets', () => {
  const rooms = [{ label: 'SC1005', floorId: 'SC-1F' }, { label: 'SC2001 高中人才培育班教室', floorId: 'SC-2F' }, { label: 'SC2001A', floorId: 'SC-2F' }];
  it('finds a room by its code, named or not, and never a longer code', () => {
    expect(findDestination(rooms, 'SC1005')?.label).toBe('SC1005');
    expect(findDestination(rooms, 'SC2001')?.label).toBe('SC2001 高中人才培育班教室');
    expect(findDestination(rooms, 'SC4010')).toBeUndefined();
  });
  it('counts as there only on the same floor, like atDestination', () => {
    expect(destinationDistance([3, 4, 4], { x: 0, y: 4.2, z: 0 })).toBe(5);
    expect(destinationDistance([0, 4, 0], { x: 0, y: 8, z: 0 })).toBe(Infinity);
    expect(destinationDistance([1, 0, 0], { x: 0, y: 0, z: 0 })).toBeLessThan(AT_DESTINATION);
  });
  it('names the floor for the card', () => { expect(floorLabel('SC-4F')).toBe('4F'); });
});

describe('walking on with G', () => {
  const closed = { wasBlocking: true, blocking: false, follow: true, walking: false };
  it('carries on when a dialogue closes', () => { expect(walkResumes(closed)).toBe(true); });
  it('not while one is open, nor without a dialogue having happened', () => {
    expect(walkResumes({ ...closed, blocking: true })).toBe(false);
    expect(walkResumes({ ...closed, wasBlocking: false })).toBe(false);
  });
  it('not once called off, and not over a walk under way', () => {
    expect(walkResumes({ ...closed, follow: false })).toBe(false);
    expect(walkResumes({ ...closed, walking: true })).toBe(false);
  });
});
