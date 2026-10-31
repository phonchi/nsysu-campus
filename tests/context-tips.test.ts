import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TIPS_KEY, TIP_MS, TipPolicy, type GuideStorage } from '../src/walk/help';
import { campusFacts, loadingTips } from '../src/walk/loading-tips';

const memory = (seed: Record<string, string> = {}): GuideStorage => ({ getItem: k => seed[k] ?? null, setItem: (k, v) => { seed[k] = v; } });

describe('context tips', () => {
  it('shows each tip once and one at a time', () => {
    const p = new TipPolicy(memory());
    expect(p.update(0, false, ['accept', 'bike'])).toBe('accept');
    expect(p.update(100, false, ['accept', 'bike'])).toBeUndefined();
    expect(p.update(TIP_MS, false, ['accept', 'bike'])).toBe('bike');
    expect(p.update(TIP_MS * 2, false, ['accept', 'bike'])).toBeUndefined();
  });
  it('waits while something modal is open', () => {
    const p = new TipPolicy(memory());
    expect(p.update(0, true, ['goal'])).toBeUndefined();
    expect(p.update(1, false, ['goal'])).toBe('goal');
  });
  it('remembers across visits and can be reset', () => {
    const seed = {}, a = new TipPolicy(memory(seed));
    a.update(0, false, ['photo']);
    const b = new TipPolicy(memory(seed));
    expect(b.update(1e6, false, ['photo'])).toBeUndefined();
    b.reset();
    expect(b.update(1e6, false, ['photo'])).toBe('photo');
  });
  it('survives refused or corrupt storage', () => {
    const refused: GuideStorage = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    expect(new TipPolicy(refused).update(0, false, ['goal'])).toBe('goal');
    expect(new TipPolicy(memory({ [TIPS_KEY]: '{not json' })).update(0, false, ['goal'])).toBe('goal');
  });
});

describe('loading tips', () => {
  const chapters = JSON.parse(readFileSync('public/data/chapters.json', 'utf8')), campus = JSON.parse(readFileSync('public/data/campus-info.json', 'utf8'));
  it('takes every fact from sourced data and writes none of its own', () => {
    const facts = campusFacts({ chapters, campus }), raw = JSON.stringify({ chapters, campus });
    expect(facts.length).toBeGreaterThanOrEqual(6);
    for (const fact of facts) expect(raw).toContain(fact.replace(/。$/, ''));
  });
  it('skips stories without a source', () => {
    expect(campusFacts({ campus: { stories: [{ text: '沒有來源。' }, { text: '有來源。第二句', sources: [{}] }] } })).toEqual(['有來源。']);
  });
  it('still has control tips when the data is missing', () => {
    expect(loadingTips([]).length).toBeGreaterThan(0);
  });
});
