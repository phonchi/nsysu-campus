/** Static check of the v4 NPC, collection and quiz data (spec-v4 §8.2, §15.2–§15.5).
 * Run: npx tsx tools/verify_dialogue.ts   (exit 1 on any problem) */
import fs from 'node:fs';
import { validateTrees, MINIGAMES, type Tree, type Cond } from '../src/story/dialogue';

const read = <T>(p: string) => JSON.parse(fs.readFileSync(p, 'utf8')) as T;
type Sched = { at: string | [number, number]; offset?: [number, number]; activity?: string } | null;
interface NpcDef { id: string; name: string; role: string; model: string; look?: Record<string, string>; portrait: Record<string, unknown>; schedule: Record<'day' | 'sunset' | 'night', Sched>; talk?: string; minigame?: string; observe?: boolean }
interface NpcData { version: number; npcs: NpcDef[]; trees: Record<string, Tree>; events: { id: string; when: string; npcs: string[]; banner: string }[] }
interface CollectionData { version: number; items: { id: string; name: string; desc: string }[]; stamps: { id: string; name: string; at: string | [number, number]; r: number; hidden?: boolean; desc: string }[]; achievements: { id: string; name: string; desc: string; rule: Record<string, unknown> }[] }
interface Quiz { version: number; questions: { id: string; q: string; options: string[]; answer: number; row: number; source: string; explain: string }[] }

const errors: string[] = [];
const npcs = read<NpcData>('public/data/npcs.json');
const col = read<CollectionData>('public/data/collection.json');
const quiz = read<Quiz>('public/data/quiz.json');
const chapters = read<{ chapters: { id: string; steps: { then: Record<string, unknown>[] }[] }[]; sideQuests: { id: string }[] }>('public/data/chapters.json');
const zones = read<{ zones: Record<string, unknown>; npcs: Record<string, unknown> }>('public/data/story-zones.json');
const anchors = Object.keys(read<{ anchors?: Record<string, unknown> }>('public/data/walkthrough/outdoor-graph.json').anchors ?? {});

const storyFlags = chapters.chapters.flatMap(c => c.steps.flatMap(s => s.then.filter(a => 'setFlag' in a).map(a => a.setFlag as string)));
const STORY_NPCS = ['guide', 's1', 's2', 's3', 'm1'];
const MODELS = fs.readdirSync('public/models/characters').filter(f => f.endsWith('.glb')).map(f => f.slice(0, -4));
const PLANNED_MODELS = ['npc-guide', 'npc-student-1', 'npc-student-2', 'npc-student-3', 'npc-student-4', 'npc-student-5', 'npc-student-6', 'npc-teacher', 'npc-desk', 'npc-clerk', 'npc-guard', 'npc-volunteer', 'monkey'];
const ids = new Set<string>();

if (npcs.version !== 1) errors.push('npcs.json: version must be 1');
for (const n of npcs.npcs) {
  const at = `npc ${n.id}`;
  if (ids.has(n.id)) errors.push(`${at}: duplicate`); ids.add(n.id);
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(n.id)) errors.push(`${at}: id must be kebab ascii`);
  if (!n.name || !n.role) errors.push(`${at}: name and role required`);
  if (!MODELS.includes(n.model) && !PLANNED_MODELS.includes(n.model)) errors.push(`${at}: unknown model ${n.model}`);
  for (const t of ['day', 'sunset', 'night'] as const) {
    const s = n.schedule?.[t];
    if (s === undefined) errors.push(`${at}: schedule.${t} missing`);
    if (s === null && STORY_NPCS.includes(n.id)) errors.push(`${at}: story NPC must be present at ${t} (spec §15.1)`);
    if (s && typeof s.at === 'string' && !zones.zones[s.at] && !anchors.includes(s.at)) errors.push(`${at}: schedule.${t}.at ${s.at} is neither a zone nor a route anchor`);
    if (s && Array.isArray(s.at) && (s.at.length !== 2 || s.at.some(v => typeof v !== 'number'))) errors.push(`${at}: schedule.${t}.at must be [x, z]`);
  }
  if (!n.observe && !n.talk) errors.push(`${at}: needs a talk tree (or observe: true)`);
  if (n.talk && !npcs.trees[n.talk]) errors.push(`${at}: missing tree ${n.talk}`);
  if (n.minigame && !MINIGAMES.includes(n.minigame as never)) errors.push(`${at}: unknown minigame ${n.minigame}`);
  if (n.talk && !n.observe) {
    const t = npcs.trees[n.talk];
    if (t && !Object.values(t.nodes).some(x => (x.choices?.length ?? 0) >= 2)) errors.push(`${at}: needs at least one node with 2+ choices`);
  }
}
for (const id of STORY_NPCS) if (!ids.has(id)) errors.push(`story NPC ${id} missing from npcs.json`);
for (const g of MINIGAMES) if (!npcs.npcs.some(n => n.minigame === g)) errors.push(`no NPC hosts ${g}`);

const owner: Record<string, string> = {};
for (const n of npcs.npcs) if (n.talk) owner[n.talk] = n.id;
errors.push(...validateTrees(npcs.trees, owner, {
  npcs: [...ids], items: col.items.map(i => i.id), stamps: col.stamps.map(s => s.id), achievements: col.achievements.map(a => a.id),
  sideQuests: chapters.sideQuests.map(q => q.id), chapters: chapters.chapters.map(c => c.id), storyFlags,
  sounds: ['chime', 'page', 'fanfare', 'echo', 'stamp', 'shutter', 'monkey', 'pop'],
}));
const usedTrees = new Set(npcs.npcs.map(n => n.talk).filter(Boolean));
for (const t of Object.keys(npcs.trees)) if (!usedTrees.has(t)) errors.push(`tree ${t} is not used by any NPC`);
for (const e of npcs.events ?? []) {
  if (!['day', 'sunset', 'night'].includes(e.when)) errors.push(`event ${e.id}: when must be day|sunset|night`);
  for (const n of e.npcs) if (!ids.has(n)) errors.push(`event ${e.id}: unknown npc ${n}`);
}

// Collection.
const uniq = (list: { id: string }[], what: string) => { const s = new Set<string>(); for (const x of list) { if (s.has(x.id)) errors.push(`${what} ${x.id}: duplicate`); s.add(x.id); } };
uniq(col.items, 'item'); uniq(col.stamps, 'stamp'); uniq(col.achievements, 'achievement');
for (const s of col.stamps) {
  if (typeof s.at === 'string' && !zones.zones[s.at] && !anchors.includes(s.at)) errors.push(`stamp ${s.id}: at ${s.at} unknown`);
  if (!(s.r > 0)) errors.push(`stamp ${s.id}: r must be > 0`);
}
const RULES = ['stamps', 'talked', 'chapters', 'games', 'flag', 'count', 'manual', 'items', 'photo', 'night'];
for (const a of col.achievements) {
  const k = Object.keys(a.rule ?? {});
  if (k.length < 1 || !RULES.includes(k[0])) errors.push(`achievement ${a.id}: rule must be one of ${RULES.join('/')}`);
}

// Quiz: only ✅ rows of the verified history table.
const history = fs.readFileSync('docs/reference/nsysu-history-v3.md', 'utf8').split('\n');
for (const q of quiz.questions) {
  const at = `quiz ${q.id}`;
  if (q.options?.length !== 4) errors.push(`${at}: needs 4 options`);
  if (!(q.answer >= 0 && q.answer < 4)) errors.push(`${at}: answer index`);
  const row = history[q.row - 1] ?? '';
  if (!row.includes('✅')) errors.push(`${at}: row ${q.row} of nsysu-history-v3.md is not a ✅ row`);
  if (!/^https?:\/\//.test(q.source) || !row.includes(q.source)) errors.push(`${at}: source must be the URL on row ${q.row}`);
}
if (quiz.questions.length < 8) errors.push('quiz: need at least 8 questions');

// Every dialogue/quiz character must be in the font subset.
const glyphs = (s: string) => [...s].filter(c => c.charCodeAt(0) > 0x2e7f);
const text = JSON.stringify(npcs) + JSON.stringify(col) + JSON.stringify(quiz);
const subsetList = fs.existsSync('data/sources/fonts/subset-chars.txt') ? fs.readFileSync('data/sources/fonts/subset-chars.txt', 'utf8') : '';
const missing = subsetList ? [...new Set(glyphs(text))].filter(c => !subsetList.includes(c)) : [];
if (missing.length) console.warn(`font subset: ${missing.length} characters not yet covered (run tools/build_font_subset.py): ${missing.slice(0, 30).join('')}`);

void ({} as Cond);
if (errors.length) { console.error(errors.join('\n')); console.error(`\n${errors.length} problem(s)`); process.exit(1); }
console.log(`dialogue data OK: ${npcs.npcs.length} NPCs, ${Object.keys(npcs.trees).length} trees, ${col.stamps.length} stamps, ${col.achievements.length} achievements, ${quiz.questions.length} quiz questions`);
