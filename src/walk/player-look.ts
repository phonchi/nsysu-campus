import * as T from 'three';
import type { Body } from '../story/collection';

/** Atlas cells written by tools/create_student_v4.py: 4 columns of 32 px cells in a 256 px atlas. */
const ROLES = ['skin', 'hair', 'hair2', 'top', 'top2', 'bottom', 'shoes', 'sole', 'sock', 'bag', 'bag2', 'acc1', 'acc2', 'inner', 'mouth', 'eye'];
const CELL = 32;

export type Look = Partial<Record<'hair' | 'top' | 'top2' | 'bottom' | 'shoes' | 'bag' | 'acc2', string>>;

/** Six presets per body (art-direction-v4 §8.2–8.3); the first is the default. */
export const PALETTES: Record<Body, { name: string; look: Look }[]> = {
  m: [
    { name: '海藍校 T', look: { hair: '#2b2622', top: '#2c7f91', bottom: '#3c4a5c', bag: '#e9b949', shoes: '#fbf6ea' } },
    { name: '米白外出', look: { hair: '#1f1a1a', top: '#efe6d1', bottom: '#3d4a63', bag: '#2a2c4a', shoes: '#fbf6ea' } },
    { name: '夕陽橘', look: { hair: '#4a3326', top: '#e8875a', bottom: '#5c6e8a', bag: '#173e49', shoes: '#f2f2f2' } },
    { name: '森林綠', look: { hair: '#2b2622', top: '#4d9a44', bottom: '#2f3a48', bag: '#efe6d1', shoes: '#fbf6ea' } },
    { name: '夜跑黑', look: { hair: '#1f1a1a', top: '#2a2c4a', bottom: '#6b6f78', bag: '#e04b3a', shoes: '#e9b949' } },
    { name: '淺咖啡', look: { hair: '#6b4a2a', top: '#c9a27a', bottom: '#3c4a5c', bag: '#2c7f91', shoes: '#fbf6ea' } },
  ],
  f: [
    { name: '晴天黃', look: { hair: '#3b2a22', top: '#f2c94c', bottom: '#2f4f6f', bag: '#2a8c99', shoes: '#f2f2f2', acc2: '#e04b3a' } },
    { name: '海風藍', look: { hair: '#3b2a22', top: '#62c8d2', bottom: '#173e49', bag: '#d9a521', shoes: '#fbf6ea', acc2: '#e04b3a' } },
    { name: '米白校 T', look: { hair: '#1f1a1a', top: '#efe6d1', bottom: '#2c4a6e', bag: '#2c7f91', shoes: '#fbf6ea', acc2: '#e9b949' } },
    { name: '櫻花粉', look: { hair: '#5a3c2e', top: '#f0a7b5', bottom: '#3d4a63', bag: '#efe6d1', shoes: '#fbf6ea', acc2: '#2a2c4a' } },
    { name: '薰衣草', look: { hair: '#8a5a3a', top: '#a99be0', bottom: '#2a2c4a', bag: '#e9b949', shoes: '#f2f2f2', acc2: '#62c8d2' } },
    { name: '抹茶綠', look: { hair: '#3b2a22', top: '#8fbf6a', bottom: '#5c4a3a', bag: '#2a2c4a', shoes: '#fbf6ea', acc2: '#e04b3a' } },
  ],
};

export const modelFor = (body: Body) => body === 'f' ? 'student-f' : 'student-m';

/** Repaint the colour cells of a character atlas (one canvas per call). Pass `disposeSource` only when the
 * model was loaded for this call alone (the player); NPC clones share the source map. */
export function recolor(model: T.Object3D, look: Look, disposeSource = false) {
  const done = new Map<T.Texture, T.Texture>();
  model.traverse(o => {
    if (!(o instanceof T.Mesh)) return;
    for (const m of [o.material].flat() as T.MeshToonMaterial[]) {
      const map = m.map;
      if (!map?.image) continue;
      let next = done.get(map);
      if (!next) {
        const img = map.image as CanvasImageSource & { width: number; height: number };
        const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
        const g = c.getContext('2d')!; g.drawImage(img, 0, 0);
        const s = img.width / 256;
        for (const [role, col] of Object.entries(look)) {
          const i = ROLES.indexOf(role); if (i < 0 || !col) continue;
          g.fillStyle = col; g.fillRect((i % 4) * CELL * s, Math.floor(i / 4) * CELL * s, CELL * s, CELL * s);
          if (role === 'hair') { const j = ROLES.indexOf('hair2'); g.fillRect((j % 4) * CELL * s, Math.floor(j / 4) * CELL * s, CELL * s, CELL * s); }
        }
        next = new T.CanvasTexture(c);
        next.flipY = map.flipY; next.colorSpace = map.colorSpace; next.magFilter = map.magFilter; next.minFilter = map.minFilter;
        done.set(map, next); if (disposeSource) map.dispose(); // NPC clones share the source map with other clones
      }
      m.map = next; m.needsUpdate = true;
    }
  });
}
