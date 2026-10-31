import { describe, expect, it } from 'vitest';
import { GUIDE_KEY, GuidePolicy, guideKeyAction, helpShortcut, readGuideSeen, writeGuideSeen, type GuideStorage } from '../src/walk/help';

const memory = (seed: Record<string, string> = {}): GuideStorage & { data: Record<string, string> } => {
  const data = { ...seed };
  return { data, getItem: k => data[k] ?? null, setItem: (k, v) => { data[k] = v; } };
};
const broken = (): GuideStorage => ({ getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('quota'); } });
const idle = { walking: true, blocked: false };

describe('first-run guide policy', () => {
  it('shows once at the first walking tick and remembers the dismissal', () => {
    const store = memory(), policy = new GuidePolicy(store);
    expect(policy.update({ walking: false, blocked: false })).toBe(false); // welcome card / loading
    expect(policy.update(idle)).toBe(true);
    expect(policy.open).toBe(true);
    expect(policy.update(idle)).toBe(false); // already open: no second show
    expect(policy.dismiss()).toBe(true);
    expect(policy.dismiss()).toBe(false); // hidden exactly once
    expect(store.data[GUIDE_KEY]).toBe('1');
    expect(policy.update(idle)).toBe(false);
    expect(policy.settled).toBe(true);
    const reloaded = new GuidePolicy(store); // next visit (reload)
    expect(reloaded.settled).toBe(true);
    expect(reloaded.update(idle)).toBe(false);
  });

  it('reads the real storage key when none is injected', () => {
    // The DOM wrapper falls back to localStorage; in node there is none, so the policy must still construct and show once.
    const policy = new GuidePolicy(undefined);
    expect(policy.settled).toBe(false);
    expect(policy.update(idle)).toBe(true);
  });

  it('defers while a dialogue, card, menu, journal, quiz or photo mode is up', () => {
    const policy = new GuidePolicy(memory());
    expect(policy.update({ walking: true, blocked: true })).toBe(false);
    expect(policy.update({ walking: true, blocked: true })).toBe(false);
    expect(policy.update(idle)).toBe(true);
  });

  it('never interrupts a visit that already dismissed it, even when storage refuses to remember', () => {
    const policy = new GuidePolicy(broken());
    expect(policy.update(idle)).toBe(true); // read failure counts as "not seen"
    expect(() => policy.dismiss()).not.toThrow();
    expect(policy.open).toBe(false);
    for (let i = 0; i < 5; i++) expect(policy.update(idle)).toBe(false);
  });

  it('runs without any storage at all', () => {
    const policy = new GuidePolicy(undefined);
    expect(policy.update(idle)).toBe(true);
    expect(policy.dismiss()).toBe(true);
    expect(policy.update(idle)).toBe(false);
  });

  it('storage helpers swallow failures and report them', () => {
    expect(readGuideSeen(broken())).toBe(false);
    expect(writeGuideSeen(broken())).toBe(false);
    expect(readGuideSeen(undefined)).toBe(false);
    expect(writeGuideSeen(undefined)).toBe(true);
    const store = memory({ [GUIDE_KEY]: '1' });
    expect(readGuideSeen(store)).toBe(true);
    expect(readGuideSeen(memory({ [GUIDE_KEY]: 'yes' }))).toBe(false);
  });
});

describe('help keys', () => {
  it('guide: Esc and E dismiss, H continues into the full help, movement keys do nothing', () => {
    expect(guideKeyAction('escape')).toBe('dismiss');
    expect(guideKeyAction('e')).toBe('dismiss');
    expect(guideKeyAction('h')).toBe('help');
    for (const k of ['w', 'a', 's', 'd', 'arrowup', ' ', 'enter', 'tab', 'g', 'j', 'p', '1']) expect(guideKeyAction(k)).toBe('none');
  });

  it('H and the ? icon open the help tab, and close the menu only when that tab is already showing', () => {
    expect(helpShortcut(false, false)).toBe('open');
    expect(helpShortcut(true, false)).toBe('open'); // menu on another tab: switch tabs
    expect(helpShortcut(true, true)).toBe('close');
  });
});
