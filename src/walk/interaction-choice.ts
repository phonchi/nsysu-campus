/** The same selection drives the hint, touch action and E key. */
export interface InteractionChoice { id: string; priority: number; distance: number }
export function selectInteraction<T extends InteractionChoice>(choices: readonly T[], selected?: string): T | undefined {
  return choices.find(c => c.id === selected) ?? [...choices].sort((a,b) => b.priority-a.priority || a.distance-b.distance || a.id.localeCompare(b.id))[0];
}
export function cycleInteraction<T extends InteractionChoice>(choices: readonly T[], selected?: string): T | undefined {
  const ordered = [...choices].sort((a,b) => b.priority-a.priority || a.distance-b.distance || a.id.localeCompare(b.id));
  const current = selectInteraction(ordered,selected);
  return ordered[(ordered.findIndex(c=>c.id===current?.id)+1)%ordered.length];
}
export const encounterReach = (phase: 'offered' | 'active') => phase === 'offered' ? 4 : 1.5;
