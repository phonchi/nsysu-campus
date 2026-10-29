/** chapters.json types and the load-time validator (spec §8.1, §14.11). */
export type Condition =
  | { near: string; r?: number }
  | { press: 'E' }
  | { flag: string }
  | { chapterDone: string }
  | { inZone: string }
  | { atDestination: string }
  | { timeOfDay: string }
  | { any: Condition[] };

export type Action =
  | { dialogue: string }
  | { setFlag: string }
  | { completeChapter: string }
  | { moveNpc: [string, string] }
  | { setObjective: string }
  | { showArrow: string | null }
  | { setSky: string }
  | { playSound: string }
  | { unlockSideQuest: string };

export interface Step { id: string; when: Condition[]; then: Action[] }
export interface Chapter { id: string; title: string; zone: string; objective: string; start: { when: Condition[] }; steps: Step[]; sources: string[] }
export interface Line { who: string; text: string }
export interface SideQuest { id: string; fromCampusInfo: string; title: string; hint: string }
export interface StoryData {
  version: number;
  guide: { id: string; name: string; model?: string };
  chapters: Chapter[];
  dialogues: Record<string, Line[]>;
  sideQuests: SideQuest[];
}

const CONDITIONS = ['near', 'press', 'flag', 'chapterDone', 'inZone', 'atDestination', 'timeOfDay', 'any'];
const ACTIONS = ['dialogue', 'setFlag', 'completeChapter', 'moveNpc', 'setObjective', 'showArrow', 'setSky', 'playSound', 'unlockSideQuest'];

/** Returns a list of problems; an empty list means the story can run. */
export function validateStory(d: StoryData): string[] {
  const errors: string[] = [];
  if (d?.version !== 1) errors.push('version must be 1');
  const ids = new Set<string>();
  const checkCond = (c: Condition, where: string) => {
    const keys = Object.keys(c).filter(k => k !== 'r');
    if (keys.length !== 1 || !CONDITIONS.includes(keys[0])) errors.push(`${where}: unknown condition ${JSON.stringify(c)}`);
    if ('any' in c) c.any.forEach(x => checkCond(x, where));
    if ('chapterDone' in c && !d.chapters.some(ch => ch.id === c.chapterDone)) errors.push(`${where}: unknown chapter ${c.chapterDone}`);
  };
  for (const ch of d?.chapters ?? []) {
    if (ids.has(ch.id)) errors.push(`duplicate chapter ${ch.id}`);
    ids.add(ch.id);
    ch.start?.when?.forEach(c => checkCond(c, `${ch.id}.start`));
    const stepIds = new Set<string>();
    for (const s of ch.steps) {
      if (stepIds.has(s.id)) errors.push(`${ch.id}: duplicate step ${s.id}`);
      stepIds.add(s.id);
      s.when.forEach(c => checkCond(c, `${ch.id}.${s.id}`));
      for (const a of s.then) {
        const keys = Object.keys(a);
        if (keys.length !== 1 || !ACTIONS.includes(keys[0])) errors.push(`${ch.id}.${s.id}: unknown action ${JSON.stringify(a)}`);
        if ('dialogue' in a && !d.dialogues[a.dialogue]) errors.push(`${ch.id}.${s.id}: missing dialogue ${a.dialogue}`);
        if ('completeChapter' in a && a.completeChapter !== ch.id) errors.push(`${ch.id}.${s.id}: completes another chapter`);
      }
    }
  }
  return errors;
}
