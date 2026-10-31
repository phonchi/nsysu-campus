/** Rotating lines on the loading screen: controls, then campus facts already sourced in the story and campus data. */

export const LOADING_TIP_MS = 4000;
const CONTROL_TIPS = ['靠近人物按 E 交談，有人可能正需要你幫忙。', '迷路時按 G，人物會自動走到目標。', '有些人只在特定時段出現，按 N 切換白天、夕陽與夜晚。', '按 ? 隨時可以看操作說明。'];
const FACT_MARK = '【校史小知識】';

interface LoadingSources {
  chapters?: { dialogues?: Record<string, { text: string }[]> };
  campus?: { stories?: { text: string; sources?: unknown[] }[] };
}

/** Only sentences that already carry a source in the data files; nothing is written here. */
export function campusFacts({ chapters, campus }: LoadingSources) {
  const facts = Object.values(chapters?.dialogues ?? {}).flat().filter(l => l.text.startsWith(FACT_MARK)).map(l => l.text.slice(FACT_MARK.length));
  for (const story of campus?.stories ?? []) if (story.sources?.length) facts.push(story.text.split('。')[0] + '。');
  return facts;
}

/** Controls and facts take turns so a short load still teaches something. */
export function loadingTips(facts: readonly string[]) {
  const tips: string[] = [];
  for (let i = 0; i < Math.max(CONTROL_TIPS.length, facts.length); i++) {
    if (i < CONTROL_TIPS.length) tips.push(CONTROL_TIPS[i]);
    if (i < facts.length) tips.push(facts[i]);
  }
  return tips;
}

/** Rotates a <small> under the loading text; returns a stop function. */
export function startLoadingTips(host: HTMLElement, load: () => Promise<LoadingSources>) {
  const line = document.createElement('small');
  host.append(line);
  let tips = loadingTips([]), index = 0;
  const show = () => { line.textContent = tips[index % tips.length]; index++; };
  show();
  const timer = setInterval(show, LOADING_TIP_MS);
  // Building the world can starve the timer, so a fact goes up as soon as the data arrives; a different one each visit.
  void load().then(sources => {
    const facts = campusFacts(sources);
    tips = loadingTips(facts);
    if (facts.length && line.isConnected) { index = 2 * Math.floor(Math.random() * Math.min(facts.length, CONTROL_TIPS.length)) + 1; show(); }
  }).catch(() => { /* controls alone are fine */ });
  return () => { clearInterval(timer); line.remove(); };
}
