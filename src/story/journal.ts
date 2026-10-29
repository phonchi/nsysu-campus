import './journal.css';
const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
export interface JournalCard { id: string; title: string; subtitle: string; text: string; meta?: string; actions?: { id: string; label: string }[] }
export interface JournalModel { tasks: JournalCard[]; events: JournalCard[]; people: JournalCard[]; notice?: string }
/** One accessible modal: no world-input handlers while reading the notebook. */
export class JournalView {
  readonly root = document.createElement('div');
  private tab: 'tasks' | 'events' | 'people' = 'tasks';
  private selected = '';
  private previous: HTMLElement | null = null;
  private model: JournalModel = { tasks: [], events: [], people: [] };
  constructor(host: HTMLElement, private action: (id: string, action: string) => void, private changed: (open: boolean) => void) {
    this.root.addEventListener('keydown', e => {
      if (e.key !== 'Tab') return;
      e.preventDefault(); e.stopPropagation();
      const buttons = [...this.root.querySelectorAll<HTMLElement>('button:not([disabled])')];
      const i = buttons.indexOf(document.activeElement as HTMLElement);
      buttons[(i + (e.shiftKey ? -1 : 1) + buttons.length) % buttons.length]?.focus();
    });
    this.root.className = 'campus-journal'; this.root.hidden = true; host.append(this.root);
    this.root.addEventListener('click', e => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-journal]');
      if (e.target === this.root || b?.dataset.journal === 'close') { this.close(); return; }
      if (!b) return;
      if (b.dataset.journal === 'tab') { this.tab = b.dataset.id as 'tasks' | 'events' | 'people'; this.selected = ''; this.render(); }
      else if (b.dataset.journal === 'select') { this.selected = b.dataset.id!; this.render(); }
      else this.action(b.dataset.id!, b.dataset.journal!);
    });
  }
  get open() { return !this.root.hidden; }
  show(model: JournalModel) { this.previous = document.activeElement as HTMLElement; this.model = model; this.root.hidden = false; this.render(); this.changed(true); this.root.querySelector<HTMLElement>('[data-journal=close]')?.focus(); }
  update(model: JournalModel) { this.model = model; if (this.open) this.render(); }
  close() { if (!this.open) return; this.root.hidden = true; this.changed(false); this.previous?.focus(); }
  key(key: string) {
    if (key === 'escape' || key === 'j') this.close();

  }
  private render() {
    const focused = document.activeElement as HTMLElement;
    const focusAction = focused?.dataset.journal, focusId = focused?.dataset.id;
    const rows = this.model[this.tab];
    const item = rows.find(x => x.id === this.selected) ?? rows[0]; this.selected = item?.id ?? '';
    this.root.innerHTML = `<section class="journal-book" role="dialog" aria-modal="true" aria-label="校園手帳"><header><div><small>山海之間 · CAMPUS NOTES</small><h2>校園手帳</h2></div><button data-journal="close" aria-label="關閉校園手帳">收起手帳 ×</button></header><nav aria-label="手帳分類">${([['tasks','任務'],['events','事件經過'],['people','人物見聞']] as const).map(([id,label]) => `<button data-journal="tab" data-id="${id}" aria-pressed="${id === this.tab}">${label}<small>${this.model[id].length}</small></button>`).join('')}</nav>${this.model.notice ? `<p class="journal-notice" role="status">${esc(this.model.notice)}</p>` : ''}<div class="journal-pages"><aside aria-label="條目清單">${rows.length ? rows.map(x => `<button data-journal="select" data-id="${esc(x.id)}" aria-current="${x.id === item?.id}"><strong>${esc(x.title)}</strong><small>${esc(x.subtitle)}</small></button>`).join('') : '<p>這一頁還空著。走進校園，讓故事慢慢填滿。</p>'}</aside><article>${item ? `<small class="journal-kicker">${esc(item.subtitle)}</small><h3>${esc(item.title)}</h3><p class="journal-copy">${esc(item.text)}</p>${item.meta ? `<p class="journal-meta">${esc(item.meta)}</p>` : ''}<div class="journal-actions">${(item.actions ?? []).map(a => `<button data-journal="${esc(a.id)}" data-id="${esc(item.id)}">${esc(a.label)}</button>`).join('')}</div>` : '<h3>今天想往哪裡走？</h3><p>任務與偶遇都會留在這裡，重新開啟網站也能繼續。</p>'}</article></div><footer>J 開啟手帳 · Esc 收起 · 進度只保存在這個瀏覽器</footer></section>`;
    if (focusAction) [...this.root.querySelectorAll<HTMLElement>('[data-journal]')].find(b => b.dataset.journal === focusAction && b.dataset.id === focusId)?.focus();
  }
  dispose() { this.root.remove(); }
}
