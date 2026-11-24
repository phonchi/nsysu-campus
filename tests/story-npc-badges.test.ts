import { expect, it, vi } from 'vitest';
import { StoryUi } from '../src/story/ui';

it('updates a moving NPC badge without rewriting stable text or accessibility attributes', () => {
  let icon = '！';
  const iconWrite = vi.fn((value: string) => { icon = value; });
  const attrs = new Map([['aria-label', '小芸：可接任務']]);
  const badge = {
    hidden: false,
    dataset: {status: 'acceptable'},
    firstElementChild: {
      get textContent() { return icon; },
      set textContent(value: string) { iconWrite(value); },
    },
    style: {transform: ''},
    getAttribute: (name: string) => attrs.get(name) ?? null,
    setAttribute: vi.fn((name: string, value: string) => { attrs.set(name, value); }),
  };
  const ui: StoryUi = Object.assign(Object.create(StoryUi.prototype), {
    npcBadgeEls: new Map([['yun', badge]]),
  });
  const row = {id: 'yun', x: 21, y: 33, status: 'acceptable' as const, name: '小芸'};

  ui.npcBadges([row]);
  ui.npcBadges([{...row, x: 42}]);
  expect(badge.style.transform).toBe('translate(42px,33px) translate(-50%,-100%)');
  expect(iconWrite).toHaveBeenCalledTimes(0);
  expect(badge.setAttribute).toHaveBeenCalledTimes(0);

  ui.npcBadges([{...row, name: '吉他小芸', status: 'deliverable'}]);
  expect(badge.dataset.status).toBe('deliverable');
  expect(icon).toBe('？');
  expect(attrs.get('aria-label')).toBe('吉他小芸：可交付');
  expect(iconWrite).toHaveBeenCalledTimes(1);
  expect(badge.setAttribute).toHaveBeenCalledTimes(1);

  ui.npcBadges([]);
  expect(badge.hidden).toBe(true);
  ui.npcBadges([row]);
  expect(badge.hidden).toBe(false);
  expect(icon).toBe('！');
});
