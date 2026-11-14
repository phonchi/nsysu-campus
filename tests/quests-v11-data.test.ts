/** v11 data (WP-D): the official-site link whitelist against the shared fixture, `links` validation, the new math-freshman
 * side quest with 陳老師 (teacher-chen), the 呂老師 rename, the seat registry and the declarative clue unlocks.
 * Runtime behaviour (rendering, seating, clue merge) is Astra's and lives in other tests. */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { QuestEngine, MAX_CONTENT_LINKS, isAllowedLink, questFlags, validateQuests, type ContentLink, type QuestData, type QuestWorld } from '../src/story/quests';
import { validateTrees, type Tree, type Catalog } from '../src/story/dialogue';
import questData from '../public/data/quests.json';
import npcData from '../public/data/npcs.json';
import collection from '../public/data/collection.json';
import chapters from '../public/data/chapters.json';
import zones from '../public/data/story-zones.json';
import campusInfo from '../public/data/campus-info.json';

const data = questData as QuestData;
const cases = JSON.parse(fs.readFileSync('tests/fixtures/link-cases.json', 'utf8')) as { ok: string[]; bad: string[] };
const memory = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); } }; };
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

describe('isAllowedLink (spec-v11 §3)', () => {
  it('accepts every ok case and rejects every bad case of the shared fixture', () => {
    expect(cases.ok.length).toBeGreaterThan(0); expect(cases.bad.length).toBeGreaterThan(0);
    for (const url of cases.ok) expect(isAllowedLink(url), url).toBe(true);
    for (const url of cases.bad) expect(isAllowedLink(url), url).toBe(false);
  });
  it('decides parser-sensitive inputs on the raw string, the same way tools/verify_quests.py does', () => {
    for (const url of ['https://MATH.NSYSU.EDU.TW/', 'https://sites.google.com/math.nsysu.edu.tw/', 'https://sites.google.com/math.nsysu.edu.tw?tab=1', 'https://math.nsysu.edu.tw/p/412-1183-915.php?Lang=zh-tw#top']) expect(isAllowedLink(url), url).toBe(true);
    for (const url of ['https://math.nsysu.edu.tw:443/', ' https://math.nsysu.edu.tw/', 'https://math.nsysu.edu.tw/ ', 'https://sites.google.com/math.nsysu.edu.tw/../x', 'https://sites.google.com/./math.nsysu.edu.tw',
      'https://sites.google.com\\math.nsysu.edu.tw', 'https://sites.google.com/%2e%2e/math.nsysu.edu.tw', 'https://sites.google.com/math.nsysu.edu.tw%2Fx', 'https:///math.nsysu.edu.tw', 'HTTPS://math.nsysu.edu.tw:8443/',
      'https://sites.google.co%6d/math.nsysu.edu.tw', 'https://a%20b.nsysu.edu.tw/', 'https://_x.nsysu.edu.tw/', 'https://math.nsysu.edu.tw./', 
      'https://math.nsysu.edu.tw/頁', 'https://math.nsysu.edu.tw@attacker.com/', 'https://xn--nsysu.edu.tw/', 'https://.nsysu.edu.tw/', 'ftp://math.nsysu.edu.tw/']) expect(isAllowedLink(url), url).toBe(false);
    expect(isAllowedLink(undefined)).toBe(false); expect(isAllowedLink(7)).toBe(false); expect(isAllowedLink(null)).toBe(false);
  });
});

describe('quest and step links', () => {
  it('the authored data carries the five spec §1 pages and nothing else', () => {
    const urls = data.quests.flatMap(q => [...(q.links ?? []), ...q.steps.flatMap(s => s.links ?? [])]).map(l => l.url);
    expect(new Set(urls)).toEqual(new Set(['https://math.nsysu.edu.tw/', 'https://math.nsysu.edu.tw/p/412-1183-915.php?Lang=zh-tw', 'https://sites.google.com/math.nsysu.edu.tw/library', 'https://math.nsysu.edu.tw/p/412-1183-21779.php?Lang=zh-tw', 'https://highschool-math.nsysu.edu.tw/']));
    expect(data.quests.find(q => q.id === 'math-day')?.links).toEqual([{ label: '高中數學人才培育班', url: 'https://highschool-math.nsysu.edu.tw/' }]);
    expect(validateQuests(data)).toEqual([]);
  });
  it('validateQuests limits links to two per quest and per step and rejects bad entries', () => {
    const local = clone(data), q = local.quests.find(q => q.id === 'math-freshman')!;
    const ok: ContentLink = { label: 'x', url: 'https://math.nsysu.edu.tw/' };
    q.links = [ok, ok, ok];
    q.steps[1].links = [{ label: ' ', url: ok.url }, { label: 'x', url: 'http://math.nsysu.edu.tw/' }];
    (q.steps[2] as { links: unknown }).links = ok;
    expect(MAX_CONTENT_LINKS).toBe(2);
    const errors = validateQuests(local);
    expect(errors).toEqual(expect.arrayContaining(['links math-freshman: more than 2', 'links math-freshman/office[0]: needs label and url', 'links math-freshman/office[1]: url not allowed http://math.nsysu.edu.tw/', 'links math-freshman/library: not an array']));
    expect(errors).toHaveLength(4);
  });
});

describe('math-freshman and 陳老師 (spec-v11 §2)', () => {
  const q = data.quests.find(q => q.id === 'math-freshman')!;
  it('has the frozen ids, steps, gate, times, keepsake and mutual recommendation with math-day', () => {
    expect(q.npc).toBe('teacher-chen'); expect(q.zone).toBe('arcade');
    expect(q.steps.map(s => s.id)).toEqual(['leaflet', 'office', 'library', 'lab', 'return']);
    expect(q.steps.map(s => s.target)).toEqual(['npc:teacher-chen', 'dest:SC4010', 'dest:SC4009', 'dest:SC2004', 'spot:sc-courtyard-freshman-sign']);
    expect(q.steps.filter(s => s.links).map(s => s.id)).toEqual(['office', 'library', 'lab']);
    expect(q.accept).toMatchObject({ near: 'npc:teacher-chen', chapterDone: 'c5-arcade', times: ['day', 'sunset'] });
    expect(q.completionRewards).toEqual([{ kind: 'item', itemId: 'item-quest-math-freshman', variantBy: 'return' }]);
    expect(q.works?.[0]).toMatchObject({ spot: 'sc-courtyard-freshman-sign', variants: [{ kind: 'sign-map' }, { kind: 'sign-directions' }] });
    expect(q.next).toEqual(['math-day']);
    expect(data.quests.find(x => x.id === 'math-day')?.next).toEqual(['math-freshman', 'arcade-club']);
    expect(data.spots?.['sc-courtyard-freshman-sign']).toEqual({ kind: 'sign', label: '看中庭的新生指引立牌', at: [-17.5, 106], stand: [-17.5, 103.8], y: 0 });
    expect(data.saveContract?.quests['math-freshman']).toEqual({ steps: ['leaflet', 'office', 'library', 'lab', 'return'], reward: '應數系新生摺頁', gate: 'c5-arcade', choices: { return: ['a', 'b'] } });
    expect(questFlags(data)).toEqual(expect.arrayContaining(['quest.math-freshman.done', 'quest.math-freshman.return.a', 'quest.math-freshman.return.b']));
  });
  it('runs through both endings and shows the sign variant chosen', () => {
    for (const choice of ['a', 'b']) {
      const e = new QuestEngine(data, { storage: memory() });
      const at = (target: string): QuestWorld => ({ distanceTo: t => t === target ? 0 : 1e9, timeOfDay: () => 'day', chapterDone: () => true });
      expect(e.accept(q.id, at(q.accept.near))).toBe(true);
      for (const s of q.steps) expect(s.choices ? e.choose(q.id, choice, at(s.target)) : e.interact(q.id, at(s.target)), s.id).toBe(true);
      expect(e.progress.quests[q.id].status).toBe('completed');
      expect(e.grants).toEqual([expect.objectContaining({ itemId: 'item-quest-math-freshman', variant: choice })]);
      expect(e.worksShown()).toEqual([{ spot: 'sc-courtyard-freshman-sign', kind: choice === 'a' ? 'sign-map' : 'sign-directions' }]);
    }
  });
  it('teacher-chen exists with the agreed look, schedule and a valid talk tree with the two reaction nodes', () => {
    const npcs = npcData as unknown as { npcs: { id: string; name: string; role: string; model: string; schedule: Record<string, unknown>; talk: string }[]; trees: Record<string, Tree> };
    const chen = npcs.npcs.find(n => n.id === 'teacher-chen')!;
    expect(chen).toMatchObject({ name: '陳老師', role: '應數系老師', model: 'npc-teacher', talk: 'teacher-chen' });
    expect(chen.schedule).toEqual({ day: { at: 'arcade', offset: [49.5, -14.5], activity: 'Idle' }, sunset: { at: 'arcade', offset: [49.5, -14.5], activity: 'Idle' }, night: null });
    const tree = npcs.trees['teacher-chen'];
    expect(Object.keys(tree.nodes)).toEqual(expect.arrayContaining(['root', 'menu', 'v11-math-freshman-return-a', 'v11-math-freshman-return-b']));
    expect(tree.nodes.menu.choices?.map(c => c.text)).toContain('「有什麼校園故事？」');
    expect(tree.nodes['v11-stories'].lines.map(l => l.text).join('')).toContain('數理資優班');
    const col = collection as { items: { id: string }[]; stamps: { id: string }[]; achievements: { id: string }[] };
    const ch = chapters as { chapters: { id: string; steps: { then: Record<string, unknown>[] }[] }[]; sideQuests: { id: string }[] };
    const cat: Catalog = { npcs: npcs.npcs.map(n => n.id), items: col.items.map(i => i.id), stamps: col.stamps.map(s => s.id), achievements: col.achievements.map(a => a.id), sideQuests: ch.sideQuests.map(s => s.id), chapters: ch.chapters.map(c => c.id),
      storyFlags: ch.chapters.flatMap(c => c.steps.flatMap(s => s.then.flatMap(a => typeof a.setFlag === 'string' ? [a.setFlag] : []))), sounds: ['echo', 'chime'], questFlags: questFlags(data) };
    expect(validateTrees({ 'teacher-chen': tree }, { 'teacher-chen': 'teacher-chen' }, cat)).toEqual([]);
  });
  it('呂老師 keeps id ta-lin, its flags and spot, and only the words changed', () => {
    const npcs = npcData as unknown as { npcs: { id: string; name: string; role: string }[]; trees: Record<string, Tree> };
    expect(npcs.npcs.find(n => n.id === 'ta-lin')).toMatchObject({ name: '呂老師', role: '應數系老師' });
    expect(Object.keys(npcs.trees['ta-lin'].nodes)).toEqual(expect.arrayContaining(['v10-stories', 'v102-math-day-return-a', 'v102-arcade-coffee-return-b']));
    expect(npcs.trees['ta-lin'].nodes.class.lines[0].text).toBe('看你的課表，不是看我。下一堂是習題課。');
    const blob = JSON.stringify([npcData, questData, collection]);
    expect(blob).not.toMatch(/林老師|林助教|助教/);
    expect(data.spots?.['arcade-lin-desk']?.label).toBe('呂老師的活動桌');
  });
});

describe('seats and clues (spec-v11 §1 坐姿、線索解鎖)', () => {
  it('every human Sit names a seat of the registry with finite SeatSpec numbers; the two activity zones name player seats', () => {
    const z = zones as unknown as { zones: Record<string, { p: number[]; r: number; seat?: string }>; seats: Record<string, { foot: number[]; yaw: number; pose: string; surfaceHeight: number; approachRadius: number; prop: { kind: string; offset: number[]; yaw: number } }> };
    for (const [id, s] of Object.entries(z.seats)) {
      expect([...s.foot, s.yaw, s.surfaceHeight, s.approachRadius, s.prop.yaw, ...s.prop.offset].every(Number.isFinite), id).toBe(true);
      expect(s.pose, id).toBe('chair'); expect(s.prop.kind, id).toBe('bench'); expect(s.surfaceHeight).toBe(0.475);
    }
    expect(z.zones['seawall-seat'].seat).toBe('seawall-player'); expect(z.zones['arcade-seat'].seat).toBe('arcade-player');
    const npcs = npcData as unknown as { npcs: { id: string; model: string; schedule: Record<string, { activity?: string; seat?: string } | null> }[]; scheduleOverrides: { activity?: string; seat?: string }[] };
    for (const n of npcs.npcs) for (const [t, s] of Object.entries(n.schedule)) if (s?.activity === 'Sit' && n.model !== 'monkey') expect(s.seat && z.seats[s.seat], `${n.id}/${t}`).toBeTruthy();
    for (const o of npcs.scheduleOverrides) if (o.activity === 'Sit') expect(o.seat && z.seats[o.seat]).toBeTruthy();
  });
  it('the five v10 stories now declare unlockAfter on an existing chapter; categories are the four known ones', () => {
    const ch = chapters as { chapters: { id: string }[]; sideQuests: { id: string; unlockAfter?: string }[] };
    const ids = new Set(ch.chapters.map(c => c.id));
    const after = Object.fromEntries(ch.sideQuests.filter(s => s.unlockAfter).map(s => [s.id, s.unlockAfter]));
    expect(after).toMatchObject({ 'story-tunnel-drama': 'c2-tunnel', 'story-macaque-subsidy': 'c5-arcade', 'story-yu-dean': 'c4-library', 'story-macaque-jacks': 'c5-arcade', 'story-macaque-burger': 'c5-arcade', 'story-art-building-tales': 'c6-sunset' });
    for (const s of ch.sideQuests) if (s.unlockAfter) expect(ids.has(s.unlockAfter), s.id).toBe(true);
    // The eight v3 clues are unlocked by chapter actions; everything added since (v10 five, v11 fifteen) declares unlockAfter.
    expect(ch.sideQuests.filter(s => !s.unlockAfter).map(s => s.id)).toEqual(['story-sunset', 'story-tunnel', 'story-lions', 'story-zoo', 'story-bodhi', 'story-library', 'story-monkeys', 'story-gallery']);
    const stories = (campusInfo as { stories: { id: string; category?: string; text: string; sources: { url: string }[]; y?: number }[] }).stories;
    expect(stories).toHaveLength(28);
    for (const s of stories) expect(['history', 'news', 'legend', 'lore', undefined], s.id).toContain(s.category);
    for (const s of stories) { expect(s.sources.length, s.id).toBeGreaterThan(0); for (const l of s.sources) expect(l.url, s.id).toMatch(/^https:\/\//); }
    expect(stories.filter(s => s.category === 'lore').map(s => s.id)).toEqual(['art-building-tales']);
    for (const s of stories) if (s.category === 'lore') expect(s.text.startsWith('校園口傳：'), s.id).toBe(true);
    expect(stories.filter(s => s.y !== undefined).map(s => [s.id, s.y])).toEqual([['tunnel-starry', 1], ['tunnel-dispositif', 1]]);
  });
});
