/** The same ordered choices drive the visible list, touch, number keys and E. */
export interface InteractionChoice { id: string; priority: number; distance: number; disabled?: boolean }
export interface InteractionAction extends InteractionChoice { targetId: string; actionId: string }
export function orderInteractions<T extends InteractionChoice>(choices: readonly T[]): T[] {
  return [...choices].sort((a,b) => b.priority-a.priority || a.distance-b.distance || a.id.localeCompare(b.id));
}
/** The highlight follows the top-priority row; only a row the player picked by hand (R, arrows) stays highlighted.
 * Otherwise a landmark that came into range first would keep E when the quest person is reached. */
export function selectInteraction<T extends InteractionChoice>(choices: readonly T[], selected?: string, manual = true): T | undefined {
  const enabled = choices.filter(c => !c.disabled);
  return (manual ? enabled.find(c => c.id === selected) : undefined) ?? orderInteractions(enabled)[0];
}
export function cycleInteraction<T extends InteractionChoice>(choices: readonly T[], selected?: string, direction = 1): T | undefined {
  const ordered = orderInteractions(choices.filter(c => !c.disabled)), current = selectInteraction(ordered,selected);
  return ordered[(ordered.findIndex(c=>c.id===current?.id)+direction+ordered.length)%ordered.length];
}
/** Never replace a stale displayed action with whatever happens to be closest now. */
export function revalidateInteraction<T extends InteractionAction>(choices: readonly T[], shown: InteractionAction): T | undefined {
  if (shown.disabled) return undefined;
  return choices.find(c => !c.disabled && c.id === shown.id && c.targetId === shown.targetId && c.actionId === shown.actionId);
}
/** At most four numbered shortcuts, following the highlighted row. All rows remain in the scrollable list. */
export function numberedInteractions<T extends InteractionChoice>(ordered: readonly T[], selected?: string): readonly T[] {
  ordered = ordered.filter(c => !c.disabled);
  const index=Math.max(0,ordered.findIndex(c=>c.id===selected)), start=Math.floor(index/4)*4;
  return ordered.slice(start,start+4);
}
export const interactionPriority = {
  tracked:110, newlyUnlocked:100, acceptable:90, active:85, talk:80, other:40,
} as const;
export const encounterReach = (phase: 'offered' | 'active') => phase === 'offered' ? 4 : 1.5;
