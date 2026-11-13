import type { RhythmFrame } from '../audio/rhythm';
import { staySecondsRemaining } from '../walk/interaction-events';
import type { Chapter, Line } from './schema';
import type { Choice, Face, TalkLine } from './dialogue';
import { portraitSvg, type PortraitSpec } from './portraits';
import './story.css';
import { interactionListHtml, type InteractionRow } from '../walk/interaction-list';
import { clampHint } from './hint-position';

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

export interface CastEntry { name: string; portrait: PortraitSpec }
/** Story cast fallback until npcs.json is loaded (colours match the v3 models). */
const STORY_CAST: Record<string, CastEntry> = {
  guide: { name: '阿灣', portrait: { hair: '#4a3326', hairStyle: 'ponytail', top: '#62c8d2', topStyle: 'hoodie', accessory: 'hairclip' } },
  s1: { name: '小禾', portrait: { hair: '#1f1a1a', hairStyle: 'bob', top: '#d9a521', topStyle: 'tee' } },
  s2: { name: '建宇學長', portrait: { hair: '#2b2622', hairStyle: 'short', top: '#2c7f91', topStyle: 'vest', accessory: 'nametag' } },
  s3: { name: '佩蓉學姊', portrait: { hair: '#5a4030', hairStyle: 'long', top: '#7b4a8f', topStyle: 'shirt', accessory: 'glasses' } },
  m1: { name: '獼猴', portrait: { kind: 'monkey' } },
};
const faceOf = (l: TalkLine): Face => l.face ?? 'neutral';

/** Judge a touch on contact, not on release; the following click must not score it twice.
 * detail=0 preserves native keyboard and assistive-technology button activation. */
export function bindRhythmClap(button: HTMLElement, clap: (eventTimestamp?:number) => void) {
  button.addEventListener('pointerdown', e => {
    if (e.button !== 0 || (button as HTMLButtonElement).disabled) return;
    e.preventDefault(); clap(e.timeStamp);
  });
  button.addEventListener('click', e => { if (e.detail === 0 && !(button as HTMLButtonElement).disabled) clap(e.timeStamp); });
}

/** Paper-and-ink story overlay: dialogue, objective, zone banner, chapter card, progress dots, edge arrow. */
export class StoryUi {
  readonly root = document.createElement('div');
  private dialogueEl: HTMLElement;
  private objectiveEl: HTMLElement;
  private dotsEl: HTMLElement;
  private edgeEl: HTMLElement;
  private pointerEl: HTMLElement;
  private badgeEl: HTMLElement;
  private typing = 0;
  private advance?: () => void;
  private picking?: { choices: Choice[]; sel: number; resolve: (i: number) => void };
  private skipping = false;
  private session = 0;
  private log: { name: string; text: string; pick?: boolean }[] = [];
  private logEl: HTMLElement;
  /** Who is who (npcs.json) and how the player looks / is called; set by the director. */
  cast: (who: string) => CastEntry | undefined = who => STORY_CAST[who];
  player: () => { name: string; portrait: PortraitSpec } = () => ({ name: '你', portrait: { hair: '#2b2622', hairStyle: 'messy', top: '#2c7f91' } });
  private bannerCooldown = new Map<string, number>();

  constructor(host: HTMLElement, private chapters: Chapter[], private guideName: string) {
    this.root.className = 'q-layer';
    const coarse = typeof matchMedia === 'function' && matchMedia('(pointer:coarse)').matches;
    this.root.innerHTML = `<div class="q-objective" hidden role="group" aria-label="目前目標"><div class="q-lines" role="group" aria-label="切換主線與支線"><button type="button" data-line="main">主線</button><button type="button" data-line="side">支線</button>${coarse ? '' : '<kbd>Q</kbd>'}</div><small></small><strong></strong><span class="q-dist"></span><i class="q-other"></i><em>${coarse ? '點此帶路' : 'G 自動前往'}</em></div>
<ol class="q-dots" aria-label="新生導覽進度">${chapters.map(c => `<li title="${esc(c.title)}"></li>`).join('')}</ol>
<div class="q-badge" hidden aria-hidden="true"><b></b><small></small></div>
<div class="q-pointer" hidden aria-hidden="true"><svg viewBox="0 0 40 40"><path d="M6 20h22m-9-10 10 10-10 10" stroke="#2a2c4a" stroke-width="7" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M6 20h22m-9-10 10 10-10 10" stroke="#e9b949" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
<div class="q-edge" hidden aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M4 12h13m-5-6 6 6-6 6" stroke="#2a2c4a" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
<div class="q-dialog" role="dialog" aria-live="polite" hidden><div class="portrait"></div><div class="q-body"><span class="name"></span><p class="text"></p><ol class="q-choices" hidden></ol></div><div class="q-tools"><button type="button" data-q="log">紀錄 L</button><button type="button" data-q="skip">快轉 Tab</button></div><span class="next">E／點擊 繼續</span></div>
<div class="q-safe-insets" aria-hidden="true"></div><div class="q-hint" hidden></div>
<div class="q-log" role="dialog" aria-label="對話紀錄" hidden><h3>對話紀錄</h3><ol></ol><button type="button" data-q="log-close">關閉 Esc</button></div>`;
    host.append(this.root);
    window.addEventListener('resize', this.forgetHintBox);
    this.dialogueEl = this.root.querySelector('.q-dialog')!;
    this.objectiveEl = this.root.querySelector('.q-objective')!;
    this.dotsEl = this.root.querySelector('.q-dots')!;
    this.edgeEl = this.root.querySelector('.q-edge')!;
    this.pointerEl = this.root.querySelector('.q-pointer')!;
    this.badgeEl = this.root.querySelector('.q-badge')!;
    this.logEl = this.root.querySelector('.q-log')!;
    this.root.querySelector('.q-hint')!.addEventListener('click',e=>{
      const id=(e.target as HTMLElement).closest<HTMLElement>('[data-interaction]')?.dataset.interaction;
      if(id) { e.stopPropagation(); this.hintSelect?.(id); }
    });
    this.dialogueEl.addEventListener('click', e => {
      const t = e.target as HTMLElement, q = t.closest<HTMLElement>('[data-q]')?.dataset.q, c = t.closest<HTMLElement>('[data-choice]');
      if (q === 'log') { this.toggleLog(); return; }
      if (q === 'skip') { this.skip(); return; }
      if (c) { this.pick(Number(c.dataset.choice)); return; }
      this.next();
    });
    this.logEl.addEventListener('click', e => { if ((e.target as HTMLElement).closest('[data-q=log-close]')) this.toggleLog(false); });
  }

  get objectiveText() { return this.main.text; }
  /** Clicking the objective card asks to be walked there; its 主線｜支線 buttons switch the line instead. */
  onObjectiveClick(fn: () => void, line: (which: 'main' | 'side') => void) {
    this.objectiveEl.addEventListener('click', e => {
      const which = (e.target as HTMLElement).closest<HTMLElement>('[data-line]')?.dataset.line as 'main' | 'side' | undefined;
      if (which) line(which); else fn();
    });
    this.objectiveEl.title = '點擊或按 G：自動走到目前的目標';
  }

  get dialogueOpen() { return !this.dialogueEl.hidden || this.session > 0; }

  /** Story dialogue (chapters.json lines): one self-contained talk. */
  dialogue(lines: Line[], done: () => void) { this.begin(); void this.say(lines).then(() => { this.end(); done(); }); }

  /** Keep the box open across several say()/choose() calls (one NPC conversation). */
  begin() { if (this.session++ === 0) { this.log = []; this.skipping = false; } }
  end() { if (this.session > 0 && --this.session === 0) { this.dialogueEl.hidden = true; this.skipping = false; this.toggleLog(false); } }

  private speaker(who: string) {
    if (who === 'player') return { ...this.player(), right: true };
    const c = this.cast(who) ?? STORY_CAST[who];
    return { name: who === 'guide' ? this.guideName : c?.name ?? who, portrait: c?.portrait ?? {}, right: false };
  }
  private fill(text: string) { return text.replaceAll('{player}', this.player().name); }

  /** Typewriter lines. E, Space or a click advances (and first completes a line still typing). With `hold`,
   * the last line stays up and the promise resolves as soon as it is fully shown (choices follow). */
  say(lines: TalkLine[], hold = false) {
    return new Promise<void>(resolve => {
      if (!lines.length) { resolve(); return; }
      let i = 0;
      const el = this.dialogueEl, text = el.querySelector<HTMLElement>('.text')!;
      const show = () => {
        const l = lines[i], who = this.speaker(l.who), full = this.fill(l.text), last = i === lines.length - 1;
        el.hidden = false; el.classList.toggle('is-player', who.right); el.classList.remove('is-choosing');
        el.querySelector<HTMLElement>('.portrait')!.innerHTML = portraitSvg(who.portrait, faceOf(l));
        el.querySelector<HTMLElement>('.name')!.textContent = who.name;
        el.querySelector<HTMLElement>('.q-choices')!.hidden = true;
        this.log.push({ name: who.name, text: full });
        let shown = 0;
        clearInterval(this.typing);
        text.textContent = '';
        const finished = () => { if (hold && last) { this.advance = undefined; resolve(); } };
        if (this.skipping) { text.textContent = full; } else this.typing = window.setInterval(() => {
          shown = Math.min(full.length, shown + 1); text.textContent = full.slice(0, shown);
          if (shown >= full.length) { clearInterval(this.typing); finished(); }
        }, 1000 / 28);
        this.advance = () => {
          if (text.textContent !== full) { clearInterval(this.typing); text.textContent = full; finished(); return; }
          i++;
          if (i < lines.length) show();
          else { this.advance = undefined; if (!this.session) el.hidden = true; resolve(); }
        };
        if (this.skipping) { if (hold && last) finished(); else window.setTimeout(() => this.advance?.(), 40); }
      };
      show();
    });
  }

  /** Show choices under the current line; resolves with the picked index. */
  choose(choices: Choice[]) {
    this.skipping = false;
    return new Promise<number>(resolve => {
      const list = this.dialogueEl.querySelector<HTMLElement>('.q-choices')!;
      this.picking = { choices, sel: 0, resolve };
      list.innerHTML = choices.map((c, i) => `<li><button type="button" data-choice="${i}"><kbd>${i + 1}</kbd>${esc(this.fill(c.text))}</button></li>`).join('');
      list.hidden = false; this.dialogueEl.classList.add('is-choosing');
      this.mark();
    });
  }
  private mark() { this.dialogueEl.querySelectorAll('[data-choice]').forEach((b, i) => b.classList.toggle('is-sel', i === this.picking?.sel)); }
  private pick(i: number) {
    const p = this.picking; if (!p || i < 0 || i >= p.choices.length) return;
    this.picking = undefined;
    this.log.push({ name: this.player().name, text: this.fill(p.choices[i].text), pick: true });
    this.dialogueEl.querySelector<HTMLElement>('.q-choices')!.hidden = true; this.dialogueEl.classList.remove('is-choosing');
    p.resolve(i);
  }

  /** Fast-forward to the next choice or the end of the talk (choices are never skipped). */
  skip() {
    if (this.picking || !this.advance) return;
    this.skipping = true; clearInterval(this.typing);
    this.advance(); // completes a half-typed line…
    if (this.advance && !this.picking) this.advance(); // …then keeps going (skipping auto-advances until a choice)
  }

  toggleLog(open = this.logEl.hidden) {
    this.logEl.hidden = !open;
    if (open) this.logEl.querySelector('ol')!.innerHTML = this.log.map(l => `<li class="${l.pick ? 'pick' : ''}"><b>${esc(l.name)}</b>${esc(l.text)}</li>`).join('');
  }

  /** Keys while a dialogue is open (input mode "dialogue"); returns true when used. */
  key(k: string) {
    if (!this.logEl.hidden) { if (k === 'escape' || k === 'l') this.toggleLog(false); return true; }
    if (this.picking) {
      const n = Number(k);
      if (n >= 1 && n <= this.picking.choices.length) { this.pick(n - 1); return true; }
      if (k === 'arrowdown' || k === 's') { this.picking.sel = (this.picking.sel + 1) % this.picking.choices.length; this.mark(); return true; }
      if (k === 'arrowup' || k === 'w') { this.picking.sel = (this.picking.sel + this.picking.choices.length - 1) % this.picking.choices.length; this.mark(); return true; }
      if (k === 'e' || k === ' ' || k === 'enter') { this.pick(this.picking.sel); return true; }
      if (k === 'l') { this.toggleLog(true); return true; }
      return true;
    }
    if (k === 'e' || k === ' ' || k === 'enter') return this.next();
    if (k === 'tab') { this.skip(); return true; }
    if (k === 'l') { this.toggleLog(true); return true; }
    return true;
  }

  /** Advance the dialogue; returns true if a dialogue consumed the key. */
  next() { if (this.picking) return true; if (!this.advance) return !this.dialogueEl.hidden; this.advance(); return true; }

  objective(chapter: Chapter, text: string) {
    const idx = this.chapters.indexOf(chapter) + 1;
    this.main = { small: `第 ${'①②③④⑤⑥⑦⑧'[idx - 1] ?? idx} 章・${chapter.title}`, text };
    this.renderCard();
    this.dots(chapter.id);
  }

  private main = { small: '', text: '' };
  private side?: { title: string; text: string };
  private sideSummary = '';
  private cardKey = '';
  /** Which line the card speaks for: a side quest, or the main story when `side` is undefined. `summary` names what waits on the side. */
  focusLine(side: { title: string; text: string } | undefined, summary = '') {
    this.side = side; this.sideSummary = summary;
    this.renderCard();
  }
  private renderCard() {
    const s = this.side, small = s ? `支線・${s.title}` : this.main.small || '新生導覽', text = s ? s.text : this.main.text || '導覽已完成，自由探索校園吧';
    const other = s ? (this.main.text ? `主線暫停：${this.main.text}` : '') : this.sideSummary ? `支線：${this.sideSummary}` : '';
    const key = [small, text, other, !!s, !s && !this.main.text && !this.sideSummary].join('|');
    if (key === this.cardKey) return;
    this.cardKey = key;
    this.objectiveEl.hidden = !s && !this.main.text && !this.sideSummary;
    this.objectiveEl.querySelector('small')!.textContent = small;
    this.objectiveEl.querySelector('strong')!.textContent = text;
    this.objectiveEl.querySelector('.q-other')!.textContent = other;
    this.objectiveEl.classList.toggle('is-side', !!s);
    this.objectiveEl.querySelectorAll<HTMLElement>('[data-line]').forEach(b => b.setAttribute('aria-pressed', String((b.dataset.line === 'side') === !!s)));
  }

  private distanceText = '';
  distance(m: number | string | undefined) {
    const text = m === undefined ? '' : typeof m === 'string' ? m : `${Math.round(m)} m`;
    if (text !== this.distanceText) this.objectiveEl.querySelector<HTMLElement>('.q-dist')!.textContent = this.distanceText = text;
  }

  dots(activeId: string | undefined, done: string[] = []) {
    this.dotsEl.querySelectorAll('li').forEach((li, i) => {
      const id = this.chapters[i].id;
      li.className = done.includes(id) ? 'done' : id === activeId ? 'active' : '';
    });
  }

  /** Zone name banner, at most once per zone every 90 s. */
  banner(title: string, sub = '') {
    const now = performance.now(), last = this.bannerCooldown.get(title) ?? -1e9;
    if (now - last < 90000) return;
    this.bannerCooldown.set(title, now);
    const el = document.createElement('div');
    el.className = 'q-banner'; el.innerHTML = `${esc(title)}${sub ? `<small>${esc(sub)}</small>` : ''}`;
    this.root.append(el); setTimeout(() => el.remove(), 2700);
  }

  /** Chapter completion card with the verified history note; resolves when the player continues: 'walk' to go
   * on foot (or by bike), 'bus' to ride the campus shuttle straight to the next chapter's place. */
  chapterCard(chapter: Chapter, fact: string | undefined, hasNext: boolean, source?: string) {
    return new Promise<'walk' | 'bus'>(resolve => {
      const idx = this.chapters.indexOf(chapter) + 1;
      const card = document.createElement('div');
      card.className = 'q-chapter'; card.setAttribute('role', 'dialog');
      card.innerHTML = `<div class="q-chapter-art" aria-hidden="true"><span>${idx}</span></div>
<h2>第 ${idx} 章完成</h2><p class="sub">${esc(chapter.title)}</p>
${fact ? `<p class="fact"><b>校史小知識</b>${esc(fact)}${source ? ` <a href="${esc(source)}" target="_blank" rel="noopener">出處</a>` : ''}</p>` : ''}
<div class="q-actions"><button class="primary" data-q="next">${hasNext ? '下一章 →' : '完成導覽'}</button>${hasNext ? '<button data-q="bus" title="直接移到下一章的地點">搭校園公車直達</button>' : ''}</div>`;
      for (let i = 0; i < 18; i++) {
        const p = document.createElement('i'); p.className = 'q-confetti';
        p.style.setProperty('--x', `${Math.random() * 300 - 150}px`); p.style.setProperty('--d', `${.5 + Math.random() * .5}s`);
        p.style.background = ['#e9b949', '#c75f4a', '#2c7f91'][i % 3]; card.append(p);
      }
      const veil = document.createElement('div'); veil.className = 'q-chapter-veil';
      this.root.append(veil, card);
      const close = (how: 'walk' | 'bus') => { card.remove(); veil.remove(); resolve(how); };
      card.querySelector('[data-q=next]')!.addEventListener('click', () => close('walk'));
      card.querySelector('[data-q=bus]')?.addEventListener('click', () => close('bus'));
      (card.querySelector('[data-q=next]') as HTMLElement).focus();
    });
  }

  /** Screen-edge pointer when the target is off screen; angle in radians (0 = right), null hides it. */
  edge(angle: number | null) {
    this.edgeEl.hidden = angle === null;
    if (angle === null) return;
    const r = Math.min(innerWidth, innerHeight) / 2 - 40, x = innerWidth / 2 + Math.cos(angle) * (innerWidth / 2 - 40), y = innerHeight / 2 + Math.sin(angle) * r;
    this.edgeEl.style.transform = `translate(${x - 18}px,${y - 18}px) rotate(${angle}rad)`;
  }

  /** Guidance arrow above the character's head; angle in screen radians (0 = right). */
  /** The tracked person's name badge, held at a constant screen size over their head. */
  badge(b: { x: number; y: number; text: string; distance: number } | null) {
    this.badgeEl.hidden = !b;
    if (!b) return;
    this.badgeEl.style.transform = `translate(${Math.round(b.x)}px,${Math.round(b.y)}px) translate(-50%,-100%)`;
    const head = this.badgeEl.firstElementChild!, foot = this.badgeEl.lastElementChild!, meters = `${Math.round(b.distance)} m`;
    if (head.textContent !== b.text) head.textContent = b.text;
    if (foot.textContent !== meters) foot.textContent = meters;
  }

  private eventObjectiveEl?: HTMLElement;
  private eventCancel?:()=>void;
  private eventGo?:()=>void;
  /** Nonmodal event objective; the main/side objective reappears when cleared or paused. */
  eventObjective(text?:string,cancel?:()=>void) {
    this.eventCancel=cancel;
    if(!this.eventObjectiveEl && text) {
      const el=document.createElement('div');el.className='q-objective q-event-objective';
      el.innerHTML='<small>校園活動</small><strong></strong><span class="q-stay-progress" role="status" hidden></span><button type="button" data-event-go hidden>G 自動前往</button><button type="button" data-event-cancel>先離開</button>';
      el.querySelector('[data-event-go]')!.addEventListener('click',()=>this.eventGo?.());
      el.querySelector('[data-event-cancel]')!.addEventListener('click',()=>this.eventCancel?.());this.root.append(el);this.eventObjectiveEl=el;
    }
    this.root.classList.toggle('has-event-objective',!!text);
    if(this.eventObjectiveEl){this.eventObjectiveEl.hidden=!text;if(text)this.eventObjectiveEl.querySelector('strong')!.textContent=text;}
  }
  eventGuidance(go?:()=>void,following=false,arrived=false) {
    this.eventGo=go;
    const button=this.eventObjectiveEl?.querySelector<HTMLButtonElement>('[data-event-go]');if(!button)return;
    button.hidden=!go;button.disabled=arrived;
    const text=arrived?'已抵達':following?'停止帶路':'G 自動前往';
    if(button.textContent!==text)button.textContent=text;
  }
  stayProgress(progress?:{held:number;hold:number}) {
    const el=this.eventObjectiveEl?.querySelector<HTMLElement>('.q-stay-progress');if(!el)return;
    el.hidden=!progress;
    if(progress){const text=`還有 ${staySecondsRemaining(progress)} 秒 · 移動會重新計時`;if(el.textContent!==text)el.textContent=text;}
  }
  private rhythmEl?:HTMLElement;
  private rhythmClap?:(eventTimestamp?:number)=>void;
  /** Fixed screen-space cue and touch button, independent of world-anchored hints. */
  rhythm(frame:RhythmFrame|null,clap?:(eventTimestamp?:number)=>void) {
    this.rhythmClap=clap;
    if(!this.rhythmEl && frame) {
      const el=document.createElement('div');el.className='q-rhythm';el.setAttribute('role','group');el.setAttribute('aria-label','跟著吉他拍手');
      el.innerHTML='<div class="q-rhythm-cue" aria-hidden="true"><i class="q-rhythm-target"></i><i class="q-rhythm-ring"></i><b>拍</b></div><p class="q-rhythm-count"></p><p class="q-rhythm-feedback" role="status"></p><div class="q-rhythm-actions"><button type="button" data-rhythm="clap">拍手<span class="q-rhythm-key"> E</span></button></div>';
      bindRhythmClap(el.querySelector<HTMLElement>('[data-rhythm=clap]')!,at=>this.rhythmClap?.(at));
      this.root.append(el);this.rhythmEl=el;
    }
    if(!this.rhythmEl)return;this.rhythmEl.hidden=!frame;if(!frame)return;
    const el=this.rhythmEl,ring=el.querySelector<HTMLElement>('.q-rhythm-ring')!;
    el.dataset.feedback=frame.feedback;
    ring.style.transform=`scale(${1+frame.ring*1.8})`;ring.style.visibility=frame.visible?'visible':'hidden';
    const count=`第 ${frame.cue}／${frame.cues} 拍 · 已拍中 ${frame.hits} 拍`;
    const countEl=el.querySelector('.q-rhythm-count')!;if(countEl.textContent!==count)countEl.textContent=count;
    const feedback=frame.paused?'已暫停':frame.feedback==='hit'?'拍中了！':frame.feedback==='miss'?'這一拍錯過了':frame.feedback==='offbeat'?'等光圈合上再拍':'光圈合上時拍手';
    const feedbackEl=el.querySelector('.q-rhythm-feedback')!;if(feedbackEl.textContent!==feedback)feedbackEl.textContent=feedback;
    (el.querySelector('[data-rhythm=clap]') as HTMLButtonElement).disabled=frame.paused||frame.done;
  }

  private npcSpeechEls=new Map<string,HTMLElement>();
  npcSpeech(bubbles:readonly {id:string;text:string;x:number;y:number}[]) {
    const ids=new Set(bubbles.map(b=>b.id));
    for(const [id,el] of this.npcSpeechEls)if(!ids.has(id))el.hidden=true;
    for(const b of bubbles) {
      let el=this.npcSpeechEls.get(b.id);
      if(!el){el=document.createElement('div');el.className='q-npc-speech';el.setAttribute('role','status');this.root.append(el);this.npcSpeechEls.set(b.id,el);}
      el.hidden=false;if(el.textContent!==b.text)el.textContent=b.text;
      el.style.transform=`translate(${Math.round(b.x)}px,${Math.round(b.y)}px) translate(-50%,-100%)`;
    }
  }

  private npcBadgeEls = new Map<string,HTMLElement>();
  npcBadges(badges:readonly {id:string;x:number;y:number;status:'acceptable'|'deliverable';name:string}[]) {
    const visible=new Set(badges.map(b=>b.id));
    for(const [id,el] of this.npcBadgeEls) if(!visible.has(id))el.hidden=true;
    for(const b of badges) {
      let el=this.npcBadgeEls.get(b.id);
      if(!el) { el=document.createElement('div');el.className='q-badge q-npc-badge';el.innerHTML='<b></b>';this.root.append(el);this.npcBadgeEls.set(b.id,el); }
      el.hidden=false;el.dataset.status=b.status;
      el.setAttribute('aria-label',`${b.name}：${b.status==='deliverable'?'可交付':'可接任務'}`);
      el.firstElementChild!.textContent=b.status==='deliverable'?'？':'！';
      el.style.transform=`translate(${Math.round(b.x)}px,${Math.round(b.y)}px) translate(-50%,-100%)`;
    }
  }

  pointer(p: { x: number; y: number; angle: number } | null) {
    this.pointerEl.hidden = !p;
    if (p) this.pointerEl.style.transform = `translate(${p.x - 20}px,${p.y - 20}px) rotate(${p.angle}rad)`;
  }

  private toasts: { kind: string; title: string; sub?: string }[] = [];
  private toastBusy = false;
  /** Corner toast (stamp / achievement / item), one at a time; waits while a dialogue is open. */
  toast(kind: 'stamp' | 'achievement' | 'item', title: string, sub?: string) {
    this.toasts.push({ kind, title, sub });
    if (!this.toastBusy) this.nextToast();
  }
  private nextToast() {
    const t = this.toasts.shift();
    if (!t) { this.toastBusy = false; return; }
    if (this.dialogueOpen) { this.toasts.unshift(t); this.toastBusy = true; window.setTimeout(() => this.nextToast(), 500); return; }
    this.toastBusy = true;
    const el = document.createElement('div');
    el.className = `q-toast q-toast-${t.kind}`; el.setAttribute('role', 'status');
    el.innerHTML = `<span class="q-toast-seal" aria-hidden="true">${t.kind === 'stamp' ? '章' : t.kind === 'achievement' ? '★' : '＋'}</span><div><strong>${esc(t.title)}</strong>${t.sub ? `<small>${esc(t.sub)}</small>` : ''}</div>`;
    this.root.append(el);
    window.setTimeout(() => { el.classList.add('out'); window.setTimeout(() => { el.remove(); this.nextToast(); }, 300); }, 3200);
  }

  /** Mini-game timer pill (top centre) with an optional give-up button (touch), or null to hide. */
  timer(text: string | null, giveUp?: () => void) {
    let el = this.root.querySelector<HTMLElement>('.q-timer');
    if (!el) {
      el = document.createElement('div'); el.className = 'q-timer'; el.setAttribute('role', 'timer');
      el.innerHTML = '<span></span><button type="button">放棄 Esc</button>'; this.root.append(el);
      el.querySelector('button')!.addEventListener('click', () => this.giveUp?.());
    }
    this.giveUp = giveUp;
    el.hidden = !text; const span = el.querySelector('span')!; if (text && span.textContent !== text) span.textContent = text;
  }
  private giveUp?: () => void;

  private hintSelect?: (id:string)=>void;
  private hintContent = '';
  private hintSelected?: string;
  private hintBox?: { width: number; height: number; rootWidth: number; rootHeight: number; insets: { top: number; right: number; bottom: number; left: number } };
  private forgetHintBox = () => { this.hintBox = undefined; };
  /** World-anchored interaction hint ("E 交談・阿凱"), or null to hide. */
  hint(p: { x: number; y: number; text: string; choices?:readonly InteractionRow[]; selectedId?:string; onSelect?:(id:string)=>void } | null) {
    const el = this.root.querySelector<HTMLElement>('.q-hint')!;
    el.hidden = !p;
    this.hintSelect=p?.onSelect;
    if (!p) return;
    const multi=!!p.choices?.length;
    el.classList.toggle('has-choices',multi);
    const content=multi?interactionListHtml(p.choices!,p.selectedId!):p.text;
    if(this.hintContent!==content) {
      const rows=el.querySelector('.q-interaction-rows'), scroll=rows?.scrollTop??0;
      const focused=(document.activeElement as HTMLElement | null)?.dataset.interaction;
      if(multi) el.innerHTML=content; else el.textContent=content;
      this.hintContent=content; this.hintBox=undefined;
      const nextRows=el.querySelector<HTMLElement>('.q-interaction-rows');
      if(nextRows) {
        nextRows.scrollTop=scroll;
        const buttons=[...nextRows.querySelectorAll<HTMLButtonElement>('button')];
        if(focused) buttons.find(b=>b.dataset.interaction===focused)?.focus({preventScroll:true});
        if(this.hintSelected!==p.selectedId) {
          const active=buttons.find(b=>b.dataset.interaction===p.selectedId);
          if(active) { const top=active.offsetTop-nextRows.offsetTop; if(top<nextRows.scrollTop)nextRows.scrollTop=top; else if(top+active.offsetHeight>nextRows.scrollTop+nextRows.clientHeight)nextRows.scrollTop=top+active.offsetHeight-nextRows.clientHeight; }
        }
      }
      this.hintSelected=p.selectedId;
    }
    // Measure only when the text or the window changed: reading layout every frame forces a reflow every frame.
    if (!this.hintBox) {
      const safe=getComputedStyle(this.root.querySelector<HTMLElement>('.q-safe-insets')!);
      this.hintBox={width:el.offsetWidth,height:el.offsetHeight,rootWidth:this.root.clientWidth,rootHeight:this.root.clientHeight,insets:{top:parseFloat(safe.paddingTop)||0,right:parseFloat(safe.paddingRight)||0,bottom:parseFloat(safe.paddingBottom)||0,left:parseFloat(safe.paddingLeft)||0}};
    }
    const box=this.hintBox;
    const bounds=clampHint(p.x,p.y,box.width,box.height,box.rootWidth,box.rootHeight,box.insets);
    el.style.transform = `translate(${Math.round(bounds.x)}px,${Math.round(bounds.y)}px)`;
  }

  dispose() { clearInterval(this.typing); window.removeEventListener('resize', this.forgetHintBox); this.root.remove(); }
}
