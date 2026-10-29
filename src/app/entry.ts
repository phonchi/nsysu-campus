import './app.css';
import { mountCampusMap } from '../map/campus-map';

/** Landing: the interactive campus map. `?view=walk` (optionally `&target=<id>`, `&story=1`) opens the 3D walk on top. */
const base = import.meta.env.BASE_URL;
const app = document.querySelector<HTMLElement>('#app')!;

export interface WalkOptions { target?: string; story?: boolean; overview?: boolean }

function hasWebGL() {
  try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') ?? c.getContext('webgl')); } catch { return false; }
}

async function enter3d(opts: WalkOptions, push = true) {
  if (!hasWebGL()) {
    const note = document.createElement('p'); note.className = 'no-webgl'; note.setAttribute('role', 'status');
    note.textContent = '這個瀏覽器無法啟動 3D（WebGL 不可用），請改用地圖瀏覽建築資訊。';
    document.body.append(note); setTimeout(() => note.remove(), 6000); return;
  }
  if (push) {
    const url = new URL(location.href); url.searchParams.set('view', 'walk');
    for (const [k, v] of Object.entries({ target: opts.target, story: opts.story ? '1' : undefined, overview: opts.overview ? '1' : undefined }))
      v ? url.searchParams.set(k, v) : url.searchParams.delete(k);
    history.pushState(null, '', url);
  }
  const { openWalkthrough } = await import('../walk/runtime');
  await openWalkthrough(opts);
}

const map = await mountCampusMap(app, base, { enter3d: o => void enter3d(o) });
window.addEventListener('walkthrough-exit', () => {
  map.refresh();
  const url = new URL(location.href);
  for (const k of ['view', 'target', 'story', 'overview']) url.searchParams.delete(k);
  history.replaceState(null, '', url);
});
const params = new URLSearchParams(location.search);
if (params.get('view') === 'walk')
  void enter3d({ target: params.get('target') ?? undefined, story: params.get('story') === '1', overview: params.get('overview') === '1' }, false);
