import * as T from 'three';

/** Photo mode (spec-v4 §9.2): HUD hidden, a free camera that orbits a pivot the player can move within 15 m
 * of where they stood (never below the ground), time-of-day buttons, a shutter that saves a watermarked PNG.
 * `onShot` lets a mini-game judge the frame (sunset photo). */
export interface PhotoDeps {
  host: HTMLElement;
  camera: T.PerspectiveCamera;
  canvas: HTMLCanvasElement;
  ground(x: number, z: number): number;
  setSky(p: 'day' | 'sunset' | 'night'): void;
  sky(): string;
  cue(id: string): void;
  saved(): void;
  /** Snapshot at shutter time; commit only after an image was successfully encoded. */
  recordShot?(): () => void;
  /** Called after each shot with the camera used; return a message to show (mini-game feedback). */
  onShot?: (camera: T.PerspectiveCamera) => string | undefined;
  exited(): void;
}

export class PhotoMode {
  active = false;
  private pivot = new T.Vector3();
  private origin = new T.Vector3();
  yaw = 0;
  pitch = -.15;
  private dist = 4.5;
  private bar: HTMLElement;
  private pending = false;
  private vignette = true;
  private watermark = true;
  goal?: string;
  /** Mini-game hooks (sunset photo): judge each shot; told when the player leaves photo mode. */
  onShot?: (camera: T.PerspectiveCamera) => string | undefined;
  onExit?: () => void;

  constructor(private d: PhotoDeps) {
    this.bar = document.createElement('div');
    this.bar.className = 'photo-bar'; this.bar.hidden = true;
    this.bar.innerHTML = `<div class="photo-goal" hidden></div><div class="photo-row">
<button data-photo="day">白天</button><button data-photo="sunset">夕陽</button><button data-photo="night">夜晚</button>
<button data-photo="vignette" aria-pressed="true">暗角</button><button data-photo="mark" aria-pressed="true">浮水印</button>
<button class="photo-shutter" data-photo="shot" aria-label="拍照（Space）"><span></span></button>
<button data-photo="exit">離開 Esc</button></div><p class="photo-help">拖曳轉動・滾輪遠近・WASD 移動鏡頭（限 15 m 內）</p>`;
    d.host.append(this.bar);
    this.bar.addEventListener('click', e => {
      const a = (e.target as HTMLElement).closest<HTMLElement>('[data-photo]')?.dataset.photo;
      if (a === 'day' || a === 'sunset' || a === 'night') { d.setSky(a); this.mark(); }
      else if (a === 'vignette') { this.vignette = !this.vignette; this.mark(); }
      else if (a === 'mark') { this.watermark = !this.watermark; this.mark(); }
      else if (a === 'shot') this.shoot();
      else if (a === 'exit') this.exit();
    });
  }

  private mark() {
    this.bar.querySelectorAll<HTMLElement>('[data-photo]').forEach(b => {
      const a = b.dataset.photo!;
      if (['day', 'sunset', 'night'].includes(a)) b.setAttribute('aria-pressed', String(this.d.sky() === a));
      if (a === 'vignette') b.setAttribute('aria-pressed', String(this.vignette));
      if (a === 'mark') b.setAttribute('aria-pressed', String(this.watermark));
    });
    this.d.host.classList.toggle('photo-vignette', this.active && this.vignette);
  }

  /** Enter around the player's head, looking the way the camera looked. */
  enter(player: T.Vector3, yaw: number, goal?: string) {
    this.active = true; this.goal = goal;
    this.origin.copy(player); this.pivot.copy(player).add(new T.Vector3(0, 1.3, 0));
    this.yaw = yaw; this.pitch = -.12; this.dist = 4.5;
    this.bar.hidden = false; this.d.host.classList.add('is-photo');
    const g = this.bar.querySelector<HTMLElement>('.photo-goal')!; g.hidden = !goal; g.textContent = goal ?? '';
    this.mark();
  }
  exit() {
    if (!this.active) return;
    this.active = false; this.goal = undefined; this.bar.hidden = true;
    this.d.host.classList.remove('is-photo', 'photo-vignette');
    this.d.exited();
    this.onExit?.();
  }

  look(dx: number, dy: number) { this.yaw -= dx * .005; this.pitch = Math.max(-1.2, Math.min(.6, this.pitch - dy * .004)); }
  zoom(delta: number) { this.dist = Math.max(1.2, Math.min(14, this.dist * (1 + delta * .001))); }
  key(k: string) { if (k === 'escape' || k === 'p') this.exit(); else if (k === ' ' || k === 'enter') this.shoot(); }

  /** Move the pivot with WASD (camera-relative), clamp to 15 m and above ground; place the camera. */
  update(dt: number, keys: Set<string>) {
    const f = (keys.has('w') || keys.has('arrowup') ? 1 : 0) - (keys.has('s') || keys.has('arrowdown') ? 1 : 0);
    const r = (keys.has('d') || keys.has('arrowright') ? 1 : 0) - (keys.has('a') || keys.has('arrowleft') ? 1 : 0);
    const speed = (keys.has('shift') ? 6 : 3) * dt, fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    this.pivot.x += (fx * f - fz * r) * speed; this.pivot.z += (fz * f + fx * r) * speed;
    const off = new T.Vector2(this.pivot.x - this.origin.x, this.pivot.z - this.origin.z);
    if (off.length() > 15) { off.setLength(15); this.pivot.x = this.origin.x + off.x; this.pivot.z = this.origin.z + off.y; }
    this.pivot.y = Math.max(this.pivot.y, this.d.ground(this.pivot.x, this.pivot.z) + .6);
    const cam = this.d.camera, cp = Math.cos(this.pitch);
    cam.position.set(this.pivot.x + Math.sin(this.yaw) * cp * this.dist, this.pivot.y - Math.sin(this.pitch) * this.dist, this.pivot.z + Math.cos(this.yaw) * cp * this.dist);
    cam.position.y = Math.max(cam.position.y, this.d.ground(cam.position.x, cam.position.z) + .3);
    cam.lookAt(this.pivot);
  }

  shoot() { if (this.active) this.pending = true; }

  /** Call right after the frame was rendered (the drawing buffer is still valid in the same task). */
  afterRender() {
    if (!this.pending) return;
    this.pending = false;
    const src = this.d.canvas, c = document.createElement('canvas'); c.width = src.width; c.height = src.height;
    const g = c.getContext('2d')!; g.drawImage(src, 0, 0);
    if (this.vignette) {
      const v = g.createRadialGradient(c.width / 2, c.height / 2, Math.min(c.width, c.height) * .35, c.width / 2, c.height / 2, Math.max(c.width, c.height) * .72);
      v.addColorStop(0, 'rgba(20,24,40,0)'); v.addColorStop(1, 'rgba(20,24,40,.45)'); g.fillStyle = v; g.fillRect(0, 0, c.width, c.height);
    }
    if (this.watermark) {
      const s = Math.max(14, Math.round(c.height / 40));
      g.font = `700 ${s}px "Noto Sans TC",sans-serif`; g.textAlign = 'right'; g.textBaseline = 'bottom';
      g.fillStyle = 'rgba(0,0,0,.35)'; g.fillText('山海之間・走進中山', c.width - s + 2, c.height - s * .8 + 2);
      g.fillStyle = '#fbf6ea'; g.fillText('山海之間・走進中山', c.width - s, c.height - s * .8);
    }
    this.d.cue('shutter');
    this.d.host.classList.add('photo-flash'); window.setTimeout(() => this.d.host.classList.remove('photo-flash'), 160);
    const commitShot = this.d.recordShot?.();
    const note = (this.onShot ?? this.d.onShot)?.(this.d.camera);
    c.toBlob(b => {
      if (!b) return;
      const a = document.createElement('a'), t = new Date(), pad = (n: number) => String(n).padStart(2, '0');
      a.href = URL.createObjectURL(b); a.download = `nsysu-${t.getFullYear()}${pad(t.getMonth() + 1)}${pad(t.getDate())}-${pad(t.getHours())}${pad(t.getMinutes())}${pad(t.getSeconds())}.png`;
      a.dataset.size = `${c.width}x${c.height}`; a.click(); window.setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      this.d.saved(); commitShot?.();
    }, 'image/png');
    if (note) { const g2 = this.bar.querySelector<HTMLElement>('.photo-goal')!; g2.hidden = false; g2.textContent = note; }
  }

  dispose() { this.bar.remove(); }
}
