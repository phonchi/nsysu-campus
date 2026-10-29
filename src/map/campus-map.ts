import './map.css';
import { normalizeProgress } from '../story/engine';

type P = [number, number];
interface MapBuilding { id: string; name: string; kind: string; walkable: boolean; polygon: P[]; storeys?: number }
interface MapData {
  spawn: P; buildings: MapBuilding[]; background: P[][];
  roads: { kind: string; width: number; points: P[] }[];
  water: { kind: string; points: P[] }[];
  sport: { kind: string; polygon: P[] }[];
  base?: { url: string; bounds: [number, number, number, number] };
  landmarks?: Record<string, { centroid: P; note?: string }>;
}
interface Card { name: string; college?: string; summary?: string; facts?: string[]; links?: { label: string; url: string }[] }
interface Chapter { id: string; title: string; objective: string }

export interface MapHooks {
  /** Enter the 3D walk, optionally heading for a building, optionally continuing the story. */
  enter3d(opts: { target?: string; story?: boolean; overview?: boolean }): void;
}

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const KINDS: Record<string, { label: string; color: string }> = {
  teaching: { label: '教學', color: '#c75f4a' },
  admin: { label: '行政・圖書', color: '#e9b949' },
  life: { label: '生活・運動', color: '#4d9a44' },
  scenic: { label: '海景・藝文', color: '#2c7f91' },
};
const STORY_KEY = 'nsysu-story-v3';
/** Places without an OSM footprint, pinned from the landmark placements. */
const POIS = [{ id: 'gate', label: '校門・校碑' }, { id: 'tunnel', label: '西子灣隧道' }, { id: 'seawall', label: '海堤・夕陽' }, { id: 'liberal-arts', label: '文學院' }];
const readStory = (): { done: string[]; active?: string } => { try { return normalizeProgress(JSON.parse(localStorage.getItem(STORY_KEY) ?? 'null')); } catch { return normalizeProgress({}); } };

/** Illustrated campus map: pan/zoom SVG over the shared world frame (x east, z south). */
export async function mountCampusMap(root: HTMLElement, base: string, hooks: MapHooks) {
  const asset = (p: string) => base + p.replace(/^\//, '');
  root.innerHTML = `<div class="cm">
<header class="cm-top"><a class="cm-brand" href="${base}"><img src="${asset('assets/nsysu-logo.svg')}" alt="國立中山大學"><span><strong>山海之間</strong><small>中山大學・校園探索</small></span></a>
<div class="cm-search"><input type="search" placeholder="找建築，例如 圖資、逸仙館" aria-label="搜尋建築" autocomplete="off"><div class="cm-results" hidden></div></div>
<button class="cm-cta" data-go="walk">走進 3D 校園 →</button></header>
<main class="cm-stage"><svg class="cm-svg" role="img" aria-label="中山大學校園地圖，北方朝上"></svg>
<div class="cm-compass" aria-hidden="true"><span>N</span></div>
<div class="cm-zoom"><button data-zoom="1" aria-label="放大">＋</button><button data-zoom="-1" aria-label="縮小">－</button><button data-zoom="0" aria-label="回到全校" class="cm-zoom-all">全校</button></div>
<div class="cm-scale" aria-hidden="true"><i></i><span>100 m</span></div></main>
<aside class="cm-side">
<section class="cm-hero"><p class="cm-eyebrow">新生導覽・六章</p><h1>山海之間，<br>走進中山。</h1><p class="cm-lead">從校門報到、穿過西子灣隧道，到海堤看夕陽。跟著學姊阿灣，用一個下午認識校園。</p>
<ol class="cm-chapters"></ol><div class="cm-actions"><button class="primary" data-go="story">開始導覽</button><button data-go="overview">先鳥瞰全校</button></div></section>
<section class="cm-filter" aria-label="依類別篩選"><h2>地圖圖例</h2><div class="cm-chips"></div></section>
<section class="cm-card" hidden></section>
<p class="cm-attrib">底圖：OpenStreetMap contributors（ODbL）・建築位置依開放圖資與官方校園平面圖對位，比例為示意。</p>
</aside></div>`;
  const svg = root.querySelector<SVGSVGElement>('.cm-svg')!;
  const card = root.querySelector<HTMLElement>('.cm-card')!;
  const [data, info, story] = await Promise.all([
    fetch(asset('data/campus-map.json')).then(r => r.json() as Promise<MapData>),
    fetch(asset('data/campus-info.json')).then(r => r.json() as Promise<{ buildings: Record<string, Card> }>).catch(() => ({ buildings: {} as Record<string, Card> })),
    fetch(asset('data/chapters.json')).then(r => r.json() as Promise<{ chapters: Chapter[] }>).catch(() => ({ chapters: [] as Chapter[] })),
  ]);

  // ---- chapters progress -------------------------------------------------------------------
  const progress = readStory();
  root.querySelector('.cm-chapters')!.innerHTML = story.chapters.map((c, i) => {
    const state = progress.done.includes(c.id) ? 'done' : progress.active === c.id ? 'active' : '';
    return `<li class="${state}"><b>${i + 1}</b><span>${esc(c.title)}</span></li>`;
  }).join('');
  if (progress.done.length || progress.active) root.querySelector<HTMLElement>('[data-go=story]')!.textContent = progress.done.length === story.chapters.length ? '再玩一次導覽' : '繼續導覽';

  // ---- geometry ----------------------------------------------------------------------------
  const pts = [...data.buildings.flatMap(b => b.polygon), ...POIS.flatMap(p => data.landmarks?.[p.id] ? [data.landmarks[p.id].centroid] : [])];
  const minX = Math.min(...pts.map(p => p[0])) - 160, maxX = Math.max(...pts.map(p => p[0])) + 160;
  const minZ = Math.min(...pts.map(p => p[1])) - 140, maxZ = Math.max(...pts.map(p => p[1])) + 140;
  const full = { x: minX, y: minZ, w: maxX - minX, h: maxZ - minZ };
  // First view frames the built-up campus; zooming out reaches the hillside pins.
  const core = (() => { const q = data.buildings.flatMap(b => b.polygon), xs = q.map(p => p[0]), zs = q.map(p => p[1]); return { x: Math.min(...xs) - 60, y: Math.min(...zs) - 60, w: Math.max(...xs) - Math.min(...xs) + 120, h: Math.max(...zs) - Math.min(...zs) + 120 }; })();
  const path = (p: P[], close = true) => p.map(([x, z], i) => `${i ? 'L' : 'M'}${x} ${z}`).join('') + (close ? 'Z' : '');
  const centroid = (p: P[]) => { let a = 0, cx = 0, cz = 0; for (let i = 0; i < p.length; i++) { const [x0, z0] = p[i], [x1, z1] = p[(i + 1) % p.length], f = x0 * z1 - x1 * z0; a += f; cx += (x0 + x1) * f; cz += (z0 + z1) * f; } return a ? [cx / (3 * a), cz / (3 * a)] as P : p[0]; };
  const area = (p: P[]) => Math.abs(p.reduce((s, [x0, z0], i) => { const [x1, z1] = p[(i + 1) % p.length]; return s + x0 * z1 - x1 * z0; }, 0)) / 2;
  // Label priority: hand-modelled landmarks, then walkable buildings, then the rest.
  const LANDMARK_OSM = ['AD', 'IL', 'YH', 'SPORT', 'ACTIVITY', 'ME', 'BEACH'];
  const rank = (b: MapBuilding) => LANDMARK_OSM.includes(b.id) ? 2 : b.walkable ? 1 : 0;
  const roadW: Record<string, number> = { tertiary: 9, unclassified: 7, residential: 6, living_street: 5, service: 4.5, footway: 2.4, path: 2, steps: 2.4 };
  svg.innerHTML = `<defs>
<pattern id="cm-paper" width="12" height="12" patternUnits="userSpaceOnUse"><rect width="12" height="12" fill="#f6efdd"/><circle cx="3" cy="4" r=".7" fill="#e8dcc0"/><circle cx="9" cy="10" r=".5" fill="#e8dcc0"/></pattern>
<pattern id="cm-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(35)"><line x1="0" y1="0" x2="0" y2="6" stroke="#2a2c4a22" stroke-width="2"/></pattern>
<filter id="cm-wobble"><feTurbulence baseFrequency=".02" numOctaves="2" seed="4"/><feDisplacementMap in="SourceGraphic" scale="3"/></filter></defs>
<rect x="${full.x - 2000}" y="${full.y - 2000}" width="${full.w + 4000}" height="${full.h + 4000}" fill="#e9e1cc"/>
${data.base ? `<image href="${asset(data.base.url)}" x="${data.base.bounds[0]}" y="${data.base.bounds[1]}" width="${data.base.bounds[2] - data.base.bounds[0]}" height="${data.base.bounds[3] - data.base.bounds[1]}" preserveAspectRatio="none"/>` : `<rect x="${full.x}" y="${full.y}" width="${full.w}" height="${full.h}" fill="url(#cm-paper)" rx="40"/>`}
<g class="cm-water">${data.base ? '' : data.water.map(w => `<path d="${path(w.points, w.kind !== 'coastline')}" class="${w.kind}"/>`).join('')}</g>
<g class="cm-sport">${data.sport.map(s => `<path d="${path(s.polygon)}" class="${s.kind}"/>`).join('')}</g>
<g class="cm-roads">${data.roads.map(r => `<path d="${path(r.points, false)}" class="${r.kind}" stroke-width="${roadW[r.kind] ?? 3}"/>`).join('')}</g>
<g class="cm-bg">${data.background.map(p => `<path d="${path(p)}"/>`).join('')}</g>
<g class="cm-buildings">${data.buildings.map(b => `<g class="cm-b" data-id="${esc(b.id)}" data-kind="${b.kind}" tabindex="0" role="button" aria-label="${esc(b.name)}"><path d="${path(b.polygon)}" style="--k:${KINDS[b.kind]?.color ?? '#c75f4a'}"/>${b.walkable ? `<path d="${path(b.polygon)}" class="cm-walk"/>` : ''}</g>`).join('')}</g>
<g class="cm-labels">${[...data.buildings].sort((a, b) => rank(b) - rank(a) || area(b.polygon) - area(a.polygon)).map(b => { const [x, z] = centroid(b.polygon); return `<g class="cm-l" data-id="${esc(b.id)}" transform="translate(${x} ${z})"><text>${esc(b.name.replace(/（.*?）/g, ''))}</text></g>`; }).join('')}</g>
${POIS.filter(p => data.landmarks?.[p.id]).map(p => { const [x, z] = data.landmarks![p.id].centroid; return `<g class="cm-poi" data-poi="${p.id}" transform="translate(${x} ${z})"><path d="M0 0l-7-12a8 8 0 1 1 14 0z"/><text y="-26">${esc(p.label)}</text></g>`; }).join('')}
<g class="cm-you" transform="translate(${data.spawn[0]} ${data.spawn[1]})"><circle r="9"/><text y="-14">起點・理工長廊</text></g>`;

  // ---- pan / zoom --------------------------------------------------------------------------
  const view = { ...full };
  const apply = () => {
    svg.setAttribute('viewBox', `${view.x} ${view.y} ${view.w} ${view.h}`);
    const px = svg.clientWidth / view.w || 1;
    svg.style.setProperty('--px', String(1 / px));
    root.querySelector<HTMLElement>('.cm-scale i')!.style.width = `${100 * px}px`;
    svg.classList.toggle('is-near', view.w < full.w * .55);
    declutter();
  };
  // Hide labels that would overlap a more important one (landmarks and pins first, then by footprint size).
  const declutter = () => {
    const placed: DOMRect[] = [];
    const items = [...svg.querySelectorAll<SVGGElement>('.cm-poi, .cm-l')];
    for (const g of items) g.style.visibility = '';
    for (const g of items) {
      const r = g.getBoundingClientRect();
      if (!r.width) continue;
      if (placed.some(p => r.left < p.right + 2 && r.right > p.left - 2 && r.top < p.bottom + 2 && r.bottom > p.top - 2)) { g.style.visibility = 'hidden'; continue; }
      placed.push(r);
    }
  };
  const zoomAt = (f: number, cx = view.x + view.w / 2, cy = view.y + view.h / 2) => {
    const w = Math.min(Math.max(full.w, core.w) * 1.6, Math.max(120, view.w * f)), h = w * view.h / view.w;
    view.x = cx - (cx - view.x) * (w / view.w); view.y = cy - (cy - view.y) * (h / view.h); view.w = w; view.h = h; apply();
  };
  const fit = () => {
    const ar = (svg.clientWidth || 1) / (svg.clientHeight || 1), f = core;
    if (f.w / f.h > ar) { view.w = f.w; view.h = f.w / ar; view.x = f.x; view.y = f.y - (view.h - f.h) / 2; }
    else { view.h = f.h; view.w = f.h * ar; view.y = f.y; view.x = f.x - (view.w - f.w) / 2; }
    apply();
  };
  const toWorld = (e: { clientX: number; clientY: number }) => { const r = svg.getBoundingClientRect(); return [view.x + (e.clientX - r.left) / r.width * view.w, view.y + (e.clientY - r.top) / r.height * view.h] as P; };
  svg.addEventListener('wheel', e => { e.preventDefault(); const [x, y] = toWorld(e); zoomAt(Math.exp(e.deltaY * .0015), x, y); }, { passive: false });
  const pointers = new Map<number, P>(); let pinch = 0, dragged = false;
  svg.addEventListener('pointerdown', e => { svg.setPointerCapture(e.pointerId); pointers.set(e.pointerId, [e.clientX, e.clientY]); dragged = false; if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinch = Math.hypot(a[0] - b[0], a[1] - b[1]); } });
  svg.addEventListener('pointermove', e => {
    const prev = pointers.get(e.pointerId); if (!prev) return;
    pointers.set(e.pointerId, [e.clientX, e.clientY]);
    if (pointers.size === 2) { const [a, b] = [...pointers.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]); if (pinch) zoomAt(pinch / d); pinch = d; dragged = true; return; }
    const r = svg.getBoundingClientRect(), dx = (e.clientX - prev[0]) / r.width * view.w, dy = (e.clientY - prev[1]) / r.height * view.h;
    if (Math.abs(e.clientX - prev[0]) + Math.abs(e.clientY - prev[1]) > 1) dragged = true;
    view.x -= dx; view.y -= dy; apply();
  });
  const up = (e: PointerEvent) => { pointers.delete(e.pointerId); pinch = 0; };
  svg.addEventListener('pointerup', up); svg.addEventListener('pointercancel', up);
  root.querySelector('.cm-zoom')!.addEventListener('click', e => { const z = (e.target as HTMLElement).closest<HTMLElement>('[data-zoom]')?.dataset.zoom; if (z === '0') fit(); else if (z) zoomAt(z === '1' ? .7 : 1.4); });
  new ResizeObserver(() => fit()).observe(svg);
  fit();

  // ---- filters, selection, cards -----------------------------------------------------------
  const active = new Set(Object.keys(KINDS));
  root.querySelector('.cm-chips')!.innerHTML = Object.entries(KINDS).map(([k, v]) => `<button class="cm-chip is-on" data-kind="${k}" aria-pressed="true"><i style="background:${v.color}"></i>${v.label}</button>`).join('') + '<span class="cm-chip-note"><i class="cm-walk-swatch"></i>可走進室內</span>';
  root.querySelector('.cm-chips')!.addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-kind]'); if (!b) return;
    const k = b.dataset.kind!; if (active.has(k)) active.delete(k); else active.add(k);
    b.classList.toggle('is-on', active.has(k)); b.setAttribute('aria-pressed', String(active.has(k)));
    svg.querySelectorAll<SVGGElement>('.cm-b').forEach(g => g.classList.toggle('is-off', !active.has(g.dataset.kind!)));
  });
  const select = (id: string, focus = false) => {
    const b = data.buildings.find(x => x.id === id); if (!b) return;
    svg.querySelectorAll('.cm-b.is-sel').forEach(g => g.classList.remove('is-sel'));
    svg.querySelector(`.cm-b[data-id="${CSS.escape(id)}"]`)?.classList.add('is-sel');
    const c = info.buildings[id] ?? { name: b.name };
    card.hidden = false;
    card.innerHTML = `<button class="cm-close" aria-label="關閉">×</button><p class="cm-eyebrow" style="color:${KINDS[b.kind]?.color}">${KINDS[b.kind]?.label ?? ''}${b.walkable ? '・可走進室內' : ''}</p>
<h2>${esc(c.name ?? b.name)}</h2>${c.summary ? `<p>${esc(c.summary)}</p>` : ''}${c.facts?.length ? `<ul>${c.facts.map(f => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}
<div class="cm-actions"><button class="primary" data-go="target" data-id="${esc(id)}">在 3D 帶我去 →</button></div>
${c.links?.length ? `<p class="cm-links">${c.links.map(l => `<a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)} ↗</a>`).join('')}</p>` : ''}`;
    if (focus) { const [x, z] = centroid(b.polygon); view.w = Math.min(view.w, full.w * .45); view.h = view.w * svg.clientHeight / Math.max(1, svg.clientWidth); view.x = x - view.w / 2; view.y = z - view.h / 2; apply(); }
    card.scrollTop = 0;
  };
  // Pointer capture retargets the click to the svg, so hit-test the point instead.
  svg.addEventListener('click', e => { if (dragged) return; const g = document.elementFromPoint(e.clientX, e.clientY)?.closest<SVGGElement>('.cm-b'); if (g) select(g.dataset.id!); });
  svg.addEventListener('keydown', e => { const g = (e.target as Element).closest<SVGGElement>('.cm-b'); if (g && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); select(g.dataset.id!); } });
  card.addEventListener('click', e => { if ((e.target as HTMLElement).closest('.cm-close')) { card.hidden = true; svg.querySelectorAll('.cm-b.is-sel').forEach(g => g.classList.remove('is-sel')); } });

  const search = root.querySelector<HTMLInputElement>('.cm-search input')!, results = root.querySelector<HTMLElement>('.cm-results')!;
  search.addEventListener('input', () => {
    const q = search.value.trim(); if (!q) { results.hidden = true; return; }
    const hits = data.buildings.filter(b => (b.name + b.id + (info.buildings[b.id]?.name ?? '')).includes(q) || b.id.toLowerCase() === q.toLowerCase()).slice(0, 8);
    results.innerHTML = hits.length ? hits.map(b => `<button data-pick="${esc(b.id)}">${esc(b.name)}<small>${KINDS[b.kind]?.label ?? ''}</small></button>`).join('') : '<p>找不到這棟建築。</p>';
    results.hidden = false;
  });
  results.addEventListener('click', e => { const id = (e.target as HTMLElement).closest<HTMLElement>('[data-pick]')?.dataset.pick; if (id) { results.hidden = true; search.value = ''; select(id, true); } });

  root.addEventListener('click', e => {
    const go = (e.target as HTMLElement).closest<HTMLElement>('[data-go]'); if (!go) return;
    const kind = go.dataset.go;
    if (kind === 'walk') hooks.enter3d({});
    if (kind === 'story') hooks.enter3d({ story: true });
    if (kind === 'overview') hooks.enter3d({ overview: true });
    if (kind === 'target') hooks.enter3d({ target: go.dataset.id });
  });
  return { refresh() { const p = readStory(); root.querySelectorAll<HTMLElement>('.cm-chapters li').forEach((li, i) => { const id = story.chapters[i].id; li.className = p.done.includes(id) ? 'done' : p.active === id ? 'active' : ''; }); } };
}
