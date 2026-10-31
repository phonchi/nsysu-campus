import * as T from 'three';
import type { WalkWorld, WorldFloor } from '../walk-world';

export const safe = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

/** The walkthrough's DOM shell. Selectors here are relied on by tools/*_qa.py — rename with care. */
export function hudTemplate(asset: (p: string) => string, base: string) {
  return `<div class="walk-canvas"></div>
<div class="walk-topbar"><a class="walk-brand" href="${base}"><img src="${asset('assets/nsysu-logo.svg')}" alt="中山大學"><span><strong>山海之間</strong><small>WALK THROUGH SUN YAT-SEN</small></span></a>
<div class="walk-search"><input type="search" placeholder="找教室、實驗室或大樓，例如 SC2001" aria-label="搜尋可步行房間" autocomplete="off"><div class="walk-results" hidden></div></div>
<div class="walk-toolbar"><button class="walk-button is-active" data-action="walk">步行</button><button class="walk-button" data-action="overview">鳥瞰 M</button><button class="walk-button" data-action="camera">第三人稱 V</button><button class="walk-button" data-action="lock" aria-pressed="false" title="固定視角角度與距離">視角 L</button><button class="walk-button" data-action="sky" aria-label="切換時段">白天 N</button><button class="walk-button" data-action="sound" aria-pressed="false" title="背景音樂、環境音與音效">音樂 關</button><button class="walk-button" data-action="exit">校園地圖 ↗</button></div></div>
<div class="walk-hudbar" aria-label="快捷"><button class="walk-icon" data-action="journal" aria-label="校園手帳（J）" title="校園手帳 J"><svg viewBox="0 0 24 24"><path d="M4 4h13a3 3 0 0 1 3 3v13H7a3 3 0 0 1-3-3zM8 4v16M11 9h6M11 13h6"/></svg></button><button class="walk-icon" data-action="menu" aria-label="選單（Esc）" title="選單 Esc"><svg viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h16"/></svg></button><button class="walk-icon" data-action="sound" aria-label="音樂與音效" title="音樂與音效"><svg viewBox="0 0 24 24"><path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/></svg></button><button class="walk-icon" data-action="photo" aria-label="拍照模式（P）" title="拍照 P"><svg viewBox="0 0 24 24"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg></button><button class="walk-icon" data-action="help" aria-label="操作說明（H）" title="操作說明 H"><span aria-hidden="true">?</span></button></div>
<div class="walk-menu" role="dialog" aria-label="選單" hidden><div class="walk-menu-panel"><header><strong>山海之間</strong><small>Esc 關閉</small><button class="walk-icon" data-action="menu-close" aria-label="關閉選單"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button></header>
<nav class="walk-menu-tabs" role="tablist"><button role="tab" data-tab="play" aria-selected="true">導覽</button><button role="tab" data-tab="album" aria-selected="false">集章冊</button><button role="tab" data-tab="help" aria-selected="false">操作說明</button></nav>
<section data-pane="play"><div class="walk-menu-search"></div><div class="walk-menu-tools"></div><div class="walk-menu-more"><button class="walk-button" data-action="journal">校園手帳 J</button><button class="walk-button" data-action="clear-all">清除全部進度</button><button class="walk-button" data-action="character">換角色／暱稱</button><button class="walk-button" data-action="restart-tour">重新開始導覽</button></div></section>
<section data-pane="album" hidden></section>
<section data-pane="help" hidden>
<h3>移動與視角</h3><dl class="walk-keys"><dt>WASD／方向鍵</dt><dd>移動；Shift 奔跑、Space 跳躍（騎車時不能跳）。自動前往時按任一方向鍵即可中斷。</dd><dt>滑鼠</dt><dd>拖曳畫面轉頭，滾輪拉遠拉近；第一人稱時點一下畫面可鎖定滑鼠，Esc 解除。</dd><dt>V</dt><dd>切換第一人稱／第三人稱。</dd><dt>M</dt><dd>切換鳥瞰：可選大樓並逐層查看，再按一次回到步行。</dd><dt>L</dt><dd>鎖定視角的角度與距離，再按一次解除；對話中改為開關對話紀錄。</dd><dt>N</dt><dd>切換時段：白天→西子灣夕陽→夜晚。有些人物只在特定時段出現。</dd></dl>
<h3>互動與對話</h3><dl class="walk-keys"><dt>E</dt><dd>靠近人物或物件時交談、開門、搭電梯（再點樓層）；對話中按 E 看下一句，Space、Enter 也可以。</dd><dt>R</dt><dd>同一處有多個目標時切換互動對象，確認後再按 E。</dd><dt>1–4</dt><dd>對話中以數字選擇選項；也可用方向鍵或 W／S 移動選項，再按 E 確認。</dd><dt>Tab</dt><dd>對話快轉到下一個選項或結尾（選項不會被跳過）。</dd></dl>
<h3>任務與手帳</h3><dl class="walk-keys"><dt>J</dt><dd>打開校園手帳：查看可接與進行中的任務、事件經過與認識的人物；可追蹤任務或「帶我去找」。</dd><dt>G</dt><dd>自動走到任務地點：優先前往手帳追蹤中的支線，否則前往目前的導覽目標。</dd><dt>接支線</dt><dd>走到 NPC 身旁，出現提示後按 E 就能接下任務；部分支線要先完成對應的導覽章節才會開放。</dd><dt>人物不在</dt><dd>NPC 這個時段不在時，提示會寫他去了哪裡；可在手帳直接切換到他出現的時段。</dd></dl>
<h3>腳踏車與拍照</h3><dl class="walk-keys"><dt>B</dt><dd>上下腳踏車。要先走到校門旁的租車點按 E 租車；只能在戶外騎，進建築會自動停在門口。</dd><dt>P</dt><dd>拍照模式：WASD 移動鏡頭、拖曳轉向、滾輪縮放，Space 或 Enter 拍照並下載，P 或 Esc 離開。</dd><dt>拍照任務</dt><dd>鏡頭在任務指定地點附近（約 4 公尺內）、處於指定時段時拍下一張照片，那一步就算完成。</dd></dl>
<h3>其他</h3><dl class="walk-keys"><dt>/</dt><dd>搜尋教室或大樓，選取後由人物帶路到門口。</dd><dt>Esc</dt><dd>開關選單；帶路、搜尋、偶遇或追逐進行中時，先按一次會停止它。</dd><dt>H／?</dt><dd>打開這份操作說明；右上角的「?」按鈕也可以。</dd></dl>
<h3>手機操作</h3><p class="walk-menu-note">左下搖桿移動，在畫面上拖曳轉頭。右下按鈕：奔跑、互動 E、騎車 B、跳、回到起點，多個目標時會多出「切換目標 R」。右上圖示：校園手帳、選單、音樂、拍照、操作說明。</p></section></div></div>
<div class="walk-location"><strong id="walk-place">中山・理工院區</strong><span class="walk-evidence">理工八棟・虛擬導覽｜部分通道與內裝示意</span></div>
<div class="walk-floor-label"><label><select aria-label="鳥瞰建築" data-building></select></label><label>逐層看 <select aria-label="鳥瞰樓層" data-floor><option value="all">全棟</option></select></label></div>
<canvas class="walk-minimap" width="280" height="220" aria-label="目前樓層小地圖"></canvas>
<div class="walk-help"><span><kbd>WASD</kbd>移動</span><span><kbd>Shift</kbd>奔跑</span><span><kbd>Space</kbd>跳躍</span><span><kbd>E</kbd>互動</span><span><kbd>G</kbd>任務自動前往</span><span><kbd>L</kbd>鎖定視角</span><span><kbd>V</kbd>第一人稱</span><span><kbd>M</kbd>鳥瞰</span><span><kbd>N</kbd>時段</span><span><kbd>H</kbd>說明</span><span>拖曳轉頭・滾輪遠近</span></div>
<div class="walk-lock-badge" hidden>視角已鎖定・按 L 解除</div>
<div class="walk-status" role="status" aria-live="polite"></div>
<div class="walk-attrib">地圖資料 © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors（ODbL）・建築配置與內裝為示意</div>
<div class="walk-lift" role="dialog" aria-label="選擇樓層" hidden></div>
<div class="walk-joystick" aria-label="移動搖桿"><div class="walk-stick"></div></div>
<div class="walk-actions"><button class="walk-button" data-action="run" aria-pressed="false">奔跑 ⇧</button><button class="walk-button" data-action="cycle-target" hidden>切換目標 R</button><button class="walk-button" data-action="door">互動 E</button><button class="walk-button" data-action="bike">騎車 B</button><button class="walk-button" data-action="jump">跳</button><button class="walk-button" data-action="reset">回到起點</button></div>
<div class="walk-welcome"><div class="eyebrow">A CAMPUS YOU CAN WALK INTO</div><h1>山海之間，<br>走進中山。</h1><p>沿長廊穿過中庭，走進下一間教室。<br>自由探索，或搜尋目的地讓人物帶你走。</p>
<div class="walk-chars" aria-label="選擇角色"><div class="walk-bodies" role="radiogroup" aria-label="主角"><button data-body="m" role="radio">男學生</button><button data-body="f" role="radio">女學生</button></div><div class="walk-palettes" role="radiogroup" aria-label="服裝配色"></div><label class="walk-nick">暱稱<input type="text" maxlength="8" placeholder="新生" aria-label="暱稱（對話中使用）" autocomplete="off"></label></div>
<div class="actions"><button class="walk-button primary" data-action="start">開始探索 →</button><button class="walk-button" data-action="overview">先看鳥瞰</button></div>
<small class="meta">理工八棟・樓層探索・室內外連續步行。<br>依公開圖資重建；部分入口、服務梯與內裝為示意。</small></div>
<div class="walk-loading">正在展開中山校園…</div>`;
}

/** Floor-plan minimap of the storey the player stands on (or the one inspected from above). */
export function drawFloorMinimap(ctx: CanvasRenderingContext2D, world: WalkWorld, floorRecord: WorldFloor, foot: T.Vector3, yaw: number, route: T.Vector3[], inverse: T.Matrix4) {
  const floor = floorRecord.data, b = floor.bounds, w = b[2] - b[0], d = b[3] - b[1];
  const scale = Math.min(254 / Math.max(w, 1), 185 / Math.max(d, 1)), cx = (b[0] + b[2]) / 2, cz = (b[1] + b[3]) / 2;
  const path = (pts: [number, number][]) => { ctx.beginPath(); pts.forEach(([x, z], i) => i ? ctx.lineTo(x, z) : ctx.moveTo(x, z)); ctx.closePath(); };
  ctx.clearRect(0, 0, 280, 220); ctx.fillStyle = '#183a40'; ctx.fillRect(0, 0, 280, 220);
  ctx.save(); ctx.translate(140, 108); ctx.scale(scale, scale); ctx.translate(-cx, -cz);
  ctx.fillStyle = '#e4dcca'; path(floor.outline); ctx.fill();
  for (const h of floor.holes ?? []) { ctx.fillStyle = '#34575a'; path(h); ctx.fill(); }
  ctx.strokeStyle = '#596f6c'; ctx.lineWidth = .15;
  for (const room of floor.rooms) { ctx.fillStyle = room.code ? '#b9a18b' : '#a4b5a7'; path(room.polygon); ctx.fill(); ctx.stroke(); }
  if (route.length) {
    ctx.strokeStyle = '#e7c36b'; ctx.lineWidth = .4; ctx.beginPath();
    route.forEach((p, i) => { const l = p.clone().applyMatrix4(inverse); i ? ctx.lineTo(l.x, l.z) : ctx.moveTo(l.x, l.z); });
    ctx.stroke();
  }
  const local = foot.clone().applyMatrix4(inverse), e = world.frames.get(floorRecord.buildingId)!.elements, rotation = Math.atan2(e[8], e[0]);
  ctx.translate(local.x, local.z); ctx.rotate(-(yaw - rotation));
  ctx.fillStyle = '#eecc7d'; ctx.beginPath(); ctx.moveTo(0, -1.4); ctx.lineTo(-.8, 1); ctx.lineTo(.8, 1); ctx.closePath(); ctx.fill();
  ctx.restore(); ctx.font = '12px sans-serif'; ctx.fillStyle = '#faf4de';
  ctx.fillText(`${floorRecord.buildingId} ${floor.label} · 樓層小地圖`, 12, 205);
}

/** Wall sign above a room door, created lazily when the player is near. */
export function makeDoorSign(label: string) {
  const c = document.createElement('canvas'); c.width = 384; c.height = 112;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#264c50'; ctx.fillRect(0, 0, 384, 112); ctx.fillStyle = '#eedcad'; ctx.fillRect(0, 0, 7, 112);
  ctx.font = 'bold 37px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(label.length > 12 ? label.slice(0, 12) : label, 192, 70);
  const texture = new T.CanvasTexture(c); texture.colorSpace = T.SRGBColorSpace;
  return new T.Mesh(new T.PlaneGeometry(1.35, .38), new T.MeshBasicMaterial({ map: texture, side: T.DoubleSide }));
}
