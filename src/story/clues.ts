/** Campus-history clues for the journal (spec-v7 Lane B): the `story-*` side quests the chapters unlocked,
 * each marked done once the matching campus-info story gem was read (`CampusUi.collectedStoryIds`).
 * Pure: the walk runtime feeds it `engine.progress.sideQuests` and the collected set when it builds the journal. */
import type { JournalClue } from './journal';
import type { SideQuest } from './schema';

/** Unlocked clues in chapter (data) order; ids the data does not know are dropped, duplicates collapse. */
export function campusClues(unlocked: readonly string[], collected: Iterable<string>, data: { sideQuests: readonly SideQuest[] }): JournalClue[] {
  const open = new Set(unlocked), found = new Set(collected);
  return data.sideQuests.filter(q => open.has(q.id)).map(q => ({ id: q.id, title: q.title, hint: q.hint, done: found.has(q.fromCampusInfo) }));
}
