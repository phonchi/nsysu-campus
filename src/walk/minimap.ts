import type { Vector3 } from 'three';

type P = [number, number];
interface MapData { base?: { url: string; bounds: [number, number, number, number] }; buildings: { kind: string; walkable: boolean; polygon: P[] }[]; background: P[][]; roads: { kind: string; width: number; points: P[] }[] }
const KIND: Record<string, string> = { teaching: '#c75f4a', admin: '#e9b949', life: '#4d9a44', scenic: '#2c7f91' };

/** Whole-campus minimap: the DEM base map with roads and buildings, pre-rendered once at 1 px per metre,
 * then cropped around the player (north up) with the quest goal marked. */
export class CampusMinimap {
  private sheet?: HTMLCanvasElement;
  private bounds: [number, number, number, number] = [0, 0, 1, 1];

  async load(asset: (p: string) => string) {
    const data = await fetch(asset('data/campus-map.json')).then(r => r.json() as Promise<MapData>);
    if (!data.base) return;
    const img = new Image(); img.src = asset(data.base.url); await img.decode();
    const [x0, z0, x1, z1] = this.bounds = data.base.bounds;
    const c = document.createElement('canvas'); c.width = Math.round(x1 - x0); c.height = Math.round(z1 - z0);
    const g = c.getContext('2d')!;
    g.drawImage(img, 0, 0, c.width, c.height);
    g.translate(-x0, -z0); g.lineJoin = g.lineCap = 'round';
    for (const r of data.roads) {
      g.strokeStyle = /footway|path|steps/.test(r.kind) ? '#efe2c6' : '#fffaf0'; g.lineWidth = Math.max(2, r.width);
      g.beginPath(); r.points.forEach(([x, z], i) => i ? g.lineTo(x, z) : g.moveTo(x, z)); g.stroke();
    }
    const poly = (p: P[]) => { g.beginPath(); p.forEach(([x, z], i) => i ? g.lineTo(x, z) : g.moveTo(x, z)); g.closePath(); };
    g.lineWidth = 1.5; g.strokeStyle = '#2a2c4a';
    for (const p of data.background) { poly(p); g.fillStyle = '#e1d5bd'; g.fill(); g.stroke(); }
    for (const b of data.buildings) { poly(b.polygon); g.fillStyle = KIND[b.kind] ?? '#c75f4a'; g.fill(); g.stroke(); }
    this.sheet = c;
  }

  get ready() { return !!this.sheet; }

  draw(ctx: CanvasRenderingContext2D, foot: Vector3, yaw: number, goal?: Vector3, W = 280, H = 220) {
    if (!this.sheet) return false;
    const zoom = 1.4, [x0, z0] = this.bounds;
    ctx.save();
    ctx.fillStyle = '#e9e1cc'; ctx.fillRect(0, 0, W, H);
    ctx.translate(W / 2, H / 2); ctx.scale(zoom, zoom); ctx.translate(-(foot.x - x0), -(foot.z - z0));
    ctx.drawImage(this.sheet, 0, 0);
    ctx.restore();
    if (goal) {
      // Goal: gold pin, clamped to the edge when far away.
      let gx = W / 2 + (goal.x - foot.x) * zoom, gy = H / 2 + (goal.z - foot.z) * zoom;
      const m = 12, out = gx < m || gy < m || gx > W - m || gy > H - m;
      gx = Math.min(W - m, Math.max(m, gx)); gy = Math.min(H - m, Math.max(m, gy));
      ctx.fillStyle = '#e9b949'; ctx.strokeStyle = '#2a2c4a'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(gx, gy, out ? 6 : 8, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
    ctx.save(); ctx.translate(W / 2, H / 2); ctx.rotate(-yaw);
    ctx.fillStyle = '#173e49'; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(0, -9); ctx.lineTo(-6, 6); ctx.lineTo(6, 6); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();
    ctx.fillStyle = 'rgba(23,62,73,.9)'; ctx.beginPath(); ctx.arc(W - 22, 22, 13, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#f2c94c'; ctx.font = '700 13px "Noto Sans TC",sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('N', W - 22, 22);
    ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic'; ctx.font = '12px "Noto Sans TC",sans-serif'; ctx.fillStyle = '#1d2a3a';
    ctx.fillText('全校地圖・北朝上', 10, H - 10);
    return true;
  }
}
