/** Offline: how far each hand-modelled landmark's solid footprint floats above, or sinks into, the terrain under it. */
import { readFileSync } from 'node:fs';
import { loadTerrain } from '../tests/terrain-fixture';
const terrain = loadTerrain(), P = JSON.parse(readFileSync('public/models/landmarks/placements.json', 'utf8'));
const rows = [];
for (const [id, p] of Object.entries<any>(P)) {
  if (!p?.centroid || p.path || id === 'tunnel') continue;
  let boxes: any[]; try { boxes = JSON.parse(readFileSync(`public/models/landmarks/${id}.collision.json`, 'utf8')).boxes; } catch { continue; }
  const seat = p.elevation ?? terrain.heightAt(p.centroid[0], p.centroid[1]), c = Math.cos(p.yaw), s = Math.sin(p.yaw);
  let hover = -Infinity, sink = -Infinity, worstAt: number[] = [], n = 0;
  for (const b of boxes) {
    if (b.center[1] - b.size[1] / 2 > .1) continue;
    const by = Math.cos(b.yaw), bs = Math.sin(b.yaw);
    for (let u = -.5; u <= .5; u += .125) for (let v = -.5; v <= .5; v += .125) {
      const lx = b.center[0] + u * b.size[0] * by + v * b.size[2] * bs, lz = b.center[2] - u * b.size[0] * bs + v * b.size[2] * by;
      const x = p.centroid[0] + lx * c + lz * s, z = p.centroid[1] - lx * s + lz * c, h = terrain.heightAt(x, z); n++;
      if (seat - h > hover) { hover = seat - h; worstAt = [x, z, h]; }
      if (h - seat > sink) sink = h - seat;
    }
  }
  rows.push({ id, seat: +seat.toFixed(2), maxFloat: +hover.toFixed(2), floatAt: worstAt.map(v => +v.toFixed(1)), maxBuried: +sink.toFixed(2), samples: n });
}
console.table(rows);
