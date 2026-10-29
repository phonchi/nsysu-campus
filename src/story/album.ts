import type * as T from 'three';
import type { Campus } from './collection';
import type { CollectionData, NpcData } from './talk';

/** Stamps, achievements and the album page (spec-v4 §9.1). Place stamps are pressed by walking into their
 * spot; the others are given by NPC dialogue. Achievements are re-checked whenever progress changes. */
export interface AlbumWorld {
  place(at: string | [number, number]): { x: number; z: number } | undefined;
  chaptersDone(): number;
  toast(kind: 'stamp' | 'achievement' | 'item', title: string, sub?: string): void;
  cue(id: string): void;
  storiesFound(): { found: number; total: number };
}

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

export class Album {
  private placeStamps: { id: string; x: number; z: number; r: number }[] = [];
  private checked = 0;

  constructor(private data: CollectionData, npcs: NpcData | undefined, private campus: Campus, private world: AlbumWorld) {
    const given = new Set<string>();
    for (const t of Object.values(npcs?.trees ?? {})) for (const n of Object.values(t.nodes)) for (const e of [...(n.effects ?? []), ...(n.choices ?? []).flatMap(c => c.effects ?? [])]) if ('stamp' in e) given.add(e.stamp);
    for (const s of data.stamps) {
      if (given.has(s.id)) continue;
      const p = world.place(s.at);
      if (p) this.placeStamps.push({ id: s.id, x: p.x, z: p.z, r: s.r });
    }
    campus.on((kind, id) => {
      if (kind === 'stamp') { const s = data.stamps.find(x => x.id === id); if (s) { world.toast('stamp', `蓋章：${s.name}`, s.desc); world.cue('stamp'); } }
      if (kind === 'achievement') { const a = data.achievements.find(x => x.id === id); if (a) { world.toast('achievement', `成就解鎖：${a.name}`, a.desc); world.cue('fanfare'); } }
      if (kind !== 'player') this.evaluate();
    });
  }

  /** Called every frame; checks place stamps twice a second. */
  update(time: number, player: T.Vector3) {
    if (time - this.checked < 500) return;
    this.checked = time;
    for (const s of this.placeStamps) if (Math.hypot(player.x - s.x, player.z - s.z) < s.r && !this.campus.progress.stamps.includes(s.id)) this.campus.stamp(s.id);
  }

  /** Award every achievement whose rule now holds (manual ones only come from dialogue). */
  evaluate() {
    const p = this.campus.progress, visible = this.data.stamps.filter(s => !s.hidden).map(s => s.id);
    for (const a of this.data.achievements) {
      if (p.achievements.includes(a.id)) continue;
      const r = a.rule as Record<string, unknown>;
      let ok = false;
      if ('stamps' in r) ok = p.stamps.filter(s => visible.includes(s)).length >= Number(r.stamps);
      else if ('talked' in r) ok = p.talked.length >= Number(r.talked);
      else if ('chapters' in r) ok = this.world.chaptersDone() >= Number(r.chapters);
      else if ('games' in r) ok = (r.games as string[]).every(g => (p.games[g]?.wins ?? 0) > 0);
      else if ('flag' in r) ok = p.flags.includes(String(r.flag));
      else if ('count' in r) ok = (p.counters[String(r.count)] ?? 0) >= Number(r.gte);
      else if ('items' in r) ok = p.items.length >= Number(r.items);
      else if ('photo' in r) ok = (p.counters['photo.saved'] ?? 0) >= Number(r.photo);
      if (ok) this.campus.achieve(a.id);
    }
  }

  /** Album page HTML for the Esc menu. */
  html() {
    const p = this.campus.progress, stories = this.world.storiesFound();
    const stamp = (s: CollectionData['stamps'][number]) => {
      const got = p.stamps.includes(s.id), secret = s.hidden && !got;
      return `<li class="${got ? 'got' : ''}${s.hidden ? ' hidden-stamp' : ''}" title="${esc(secret ? '隱藏章' : s.desc)}"><span class="seal">${got ? esc(s.name.slice(0, 2)) : '？'}</span><small>${esc(secret ? '？？？' : s.name)}</small></li>`;
    };
    const main = this.data.stamps.filter(s => !s.hidden), hidden = this.data.stamps.filter(s => s.hidden);
    return `<div class="album">
<h3>集章 <b>${p.stamps.filter(s => main.some(m => m.id === s)).length}／${main.length}</b></h3><ol class="stamps">${main.map(stamp).join('')}</ol>
<h3>隱藏章 <b>${p.stamps.filter(s => hidden.some(m => m.id === s)).length}／${hidden.length}</b></h3><ol class="stamps">${hidden.map(stamp).join('')}</ol>
<h3>成就 <b>${p.achievements.length}／${this.data.achievements.length}</b></h3><ul class="achv">${this.data.achievements.map(a => `<li class="${p.achievements.includes(a.id) ? 'got' : ''}"><strong>${esc(a.name)}</strong><small>${esc(a.desc)}</small></li>`).join('')}</ul>
<h3>背包 <b>${p.items.length}</b></h3><ul class="items">${p.items.length ? p.items.map(id => { const i = this.data.items.find(x => x.id === id); return `<li><strong>${esc(i?.name ?? id)}</strong><small>${esc(i?.desc ?? '')}</small></li>`; }).join('') : '<li class="empty">還沒有東西。跟校園裡的人聊聊吧。</li>'}</ul>
<h3>校史故事 <b>${stories.found}／${stories.total}</b></h3><p class="album-note">在校園裡找發光的寶石，或聽 NPC 提起的地方。</p>
<h3>認識的人 <b>${p.talked.length}</b></h3></div>`;
  }
}
