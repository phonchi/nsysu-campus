import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { resolveNpcPlacement, STORY_NPCS, type StoryZones } from '../src/world/npc';
import type { NpcDef } from '../src/story/talk';

const zones = JSON.parse(fs.readFileSync('public/data/story-zones.json', 'utf8')) as StoryZones;
const def = (id: string, night: NpcDef['schedule']['night']): NpcDef => ({ id, name: id, role: '', model: 'npc-student-1', portrait: {},
  schedule: { day: { at: 'admin' }, sunset: { at: 'seawall', activity: 'Sit' }, night }, talk: id });

describe('NPC placement ownership (spec-v4 §15.1)', () => {
  it('the story owns story NPCs in every preset until the tour is done', () => {
    for (const id of STORY_NPCS) for (const preset of ['day', 'sunset', 'night'] as const) {
      const p = resolveNpcPlacement(id, def(id, null), preset, false, zones, { guide: 'library' });
      expect(p, `${id} ${preset}`).not.toBeNull();
      expect(p!.at).toBe(id === 'guide' ? 'library' : zones.npcs[id].at);
    }
  });
  it('after the tour, story NPCs follow their schedule', () => {
    expect(resolveNpcPlacement('s2', def('s2', { at: 'admin' }), 'sunset', true, zones, {})!.at).toBe('seawall');
  });
  it('other NPCs follow their schedule and may be absent', () => {
    expect(resolveNpcPlacement('coffee', def('coffee', null), 'night', false, zones, {})).toBeNull();
    expect(resolveNpcPlacement('coffee', def('coffee', null), 'sunset', false, zones, {})).toEqual({ at: 'seawall', activity: 'Sit' });
  });
});
