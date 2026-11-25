import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { OutdoorRoutes } from '../src/walk/route';
import { PLAY_BOUNDS } from '../src/world/terrain';
import { hamasenUiLabels } from '../src/campus-label-catalog';
import { hamasenCardCategory, hamasenMarkerStyle, type HamasenMapPlace, type HamasenPlace } from '../src/map/map-landmarks';

const read = <T>(path: string) => JSON.parse(readFileSync(path, 'utf8')) as T;
const info = read<{ buildings: Record<string, HamasenPlace & { summary: string; facts: string[]; links: { label: string; url: string }[] }> }>('public/data/campus-info.json').buildings;
const map = read<{ hamasenPlaces: HamasenMapPlace[]; campusPlaces: HamasenMapPlace[]; buildings: { id: string; name: string; kind: string }[] }>('public/data/campus-map.json');
const routes = new OutdoorRoutes(read('public/data/walkthrough/outdoor-graph.json'));

const EXPECTED_DINING = [
  'campus-poi-shanhai-lou',
  'campus-poi-sc-coop',
  'campus-poi-cuiheng-e-canteen',
  'campus-poi-wuling-milo',
  'campus-poi-louisa-coffee',
] as const;

const EXPECTED_DORMS = [
  'campus-dorm-wuling-1',
  'campus-dorm-wuling-2',
  'campus-dorm-wuling-3',
  'campus-dorm-wuling-4',
  'campus-dorm-cuiheng-ag',
  'campus-dorm-cuiheng-h',
  'campus-dorm-cuiheng-l',
] as const;

describe('NSYSU on-campus dining and dormitory POIs', () => {
  it('registers all five dining spots and seven dorm entries without disturbing the 22 Hamasen POIs', () => {
    expect(map.hamasenPlaces).toHaveLength(22);
    expect(map.campusPlaces).toHaveLength(EXPECTED_DINING.length + EXPECTED_DORMS.length);
    for (const id of [...EXPECTED_DINING, ...EXPECTED_DORMS]) {
      const card = info[id];
      expect(card, id).toBeDefined();
      expect(card.summary.length, `${id} summary`).toBeGreaterThan(20);
      expect(card.facts.length, `${id} facts`).toBeGreaterThanOrEqual(2);
      expect(card.links.length, `${id} links`).toBeGreaterThanOrEqual(1);
      const [x, z] = card.poi.position;
      expect(x >= PLAY_BOUNDS[0] && x <= PLAY_BOUNDS[2], `${id} x`).toBe(true);
      expect(z >= PLAY_BOUNDS[1] && z <= PLAY_BOUNDS[3], `${id} z`).toBe(true);
      expect(map.campusPlaces.some(p => p.id === id), `${id} in campusPlaces`).toBe(true);
      const style = hamasenMarkerStyle(card.category);
      expect(style.glyph.length).toBeGreaterThan(0);
      expect(hamasenCardCategory(card.kind, card.category)).toBeTruthy();
    }
    expect(info.ACTIVITY.summary).toContain('山海樓');
    expect(info.GALLERY.summary).toContain('路易莎咖啡');
    expect(info.SC.facts.some(f => f.includes('理院福利社'))).toBe(true);
  });

  it('provides 3D UI labels and walkable outdoor routes from SC to every dining and dorm anchor', () => {
    const labels = hamasenUiLabels(info);
    const start = routes.anchor('SC-1F') ?? routes.anchor('SC') ?? routes.anchor('ACTIVITY')!;
    expect(start).toBeDefined();
    for (const id of [...EXPECTED_DINING, ...EXPECTED_DORMS]) {
      expect(labels.some(l => l.id === id), `${id} UI label`).toBe(true);
      const goal = routes.anchor(id);
      expect(goal, `${id} outdoor anchor`).toBeDefined();
      const path = routes.path(start, goal!);
      expect(path.length, `route to ${id}`).toBeGreaterThanOrEqual(2);
    }
  });
});
