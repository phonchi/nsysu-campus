# 山海之間・美術方向規格（Art Direction）

版本 2026-10-19・作者 Fable（art director）。目標：把現況「平淡示意沙盤」提升為 **明亮卡通低多邊形（bright cartoon low-poly）**，主色為中山紅磚，參考 nccu100 的厚實造型／斑馬線／人物感，與淡海 3D 校園的乾淨鳥瞰、密集樹木、藥丸形標籤。所有數值以 **世界公尺** 為準（storey = 3.7 m，`campus-structure.json` 的 `floorHeight`）。`docs/reference/visual-reference.md` 撰寫時尚不存在；若日後補上真實立面筆記，以本文件規則為框架、以該文件修正細節。

硬預算：鳥瞰 ≤ 800 draw calls、≤ 400k tris；植栽／道具一律 `InstancedMesh`；遠距建築走 LOD；不出貨任何照片，資產皆為程序生成或 Blender 自製 GLB（`gltf-transform` meshopt 壓縮）。

> 所有 hex 皆為 `material.color` 的 sRGB albedo，依現有 `ACESFilmicToneMapping`、`toneMappingExposure 1.03–1.05` 調校。ACES 會把中飽和度壓灰，因此磚紅、草綠、海藍都**刻意比目標螢幕色再飽和一階**；若日後改 `AgXToneMapping`，整張調色盤需重調，不要逐色修補。

---

## 1. 調色盤

### 1.1 環境與建築

| 用途 | Token | Hex | 備註 |
|---|---|---|---|
| 磚牆・亮 | `brick.light` | `#cf6a55` | 主立面色（受光面） |
| 磚牆・暗 | `brick.dark` | `#a84a3b` | 陰面、底層基座、磚縫間色塊 |
| 磚縫 | `brick.mortar` | `#e8d2c4` | DataTexture 內 1px 線，佔比 ≤ 8% |
| 米白飾帶 | `trim.cream` | `#f1e8d6` | 樓層線飾帶、柱、窗台、簷口 |
| 米白牆（行政／圖資 cream tone） | `wall.cream` | `#efe4cf` | 搭配 `brick.dark` 做基座 |
| 深色屋頂／女兒牆頂 | `roof.dark` | `#8d5a4c` | 斜屋頂（逸仙館、校門亭） |
| 平屋面 | `roof.deck` | `#d9d2c3` | 平頂建築屋面 |
| 屋頂設備 | `roof.equip` | `#b8bdb9` | 水塔、空調箱、電梯機房 |
| 玻璃・日 | `glass.day` | `#7fb3c4` | roughness .35，metalness 0 |
| 玻璃・夜 emissive | `glass.night` | `#ffd37a` | `emissiveIntensity` 日 0 → 夜 1.6 |
| 窗框 | `glass.frame` | `#3e4a50` | 近距 LOD 的實體窗框 |
| 草地・主 | `grass.a` | `#8fcf66` | 大面積草坪 |
| 草地・次 | `grass.b` | `#7cbf58` | 噪聲混合 35%，打破平面 |
| 草地・乾／運動草皮 | `grass.c` | `#a9d46e` | 坡地邊緣、操場內圈 |
| 柏油 | `road.asphalt` | `#6b7380` | 偏藍灰（nccu 式），非純黑 |
| 車道標線・白 | `road.mark` | `#f6f3ea` | |
| 標線・黃 | `road.markYellow` | `#f2c23b` | 中線、禁停格 |
| 斑馬線 | `road.zebra` | `#fbf9f2` | 條寬 0.45 m、間距 0.45 m |
| 人行道 | `pave.walk` | `#e9e1cf` | 磚縫 `#d6cbb6`，格 0.6 m |
| 中庭鋪面 | `pave.plaza` | `#dcd0b8` | 國徽廣場、長廊地坪 |
| 沙灘 | `sand` | `#f0dcb0` | 西子灣 |
| 海・淺 | `sea.shallow` | `#5fc3cf` | 岸邊 0–40 m |
| 海・深 | `sea.deep` | `#2c7f91` | 沿用品牌 `--sea` |
| 浪沫 | `sea.foam` | `#ffffff` | 岸線 1 條 0.8 m 寬動態 UV 帶 |
| 山・近 | `hill.near` | `#5f9e4f` | 壽山近景（0–300 m） |
| 山・中 | `hill.mid` | `#4c8a46` | |
| 山・遠 | `hill.far` | `#6f9f7f` | 略帶霧色，與 fog 融合 |
| 樹冠 1–4 | `tree.1–4` | `#6fbf4f` `#58a845` `#8fcc5a` `#3f8f4c` | 四種 InstancedMesh，隨機分配 |
| 樹幹 | `tree.trunk` | `#8a6243` | |
| 棕櫚葉／幹 | `palm.leaf` `palm.trunk` | `#4f9d4a` `#a08664` | 沿海步道、蓮海路 |

### 1.2 學院色帶（3D 簷口色帶 + UI 標籤底線）

同一學院需要兩個值：`band` 畫在磚牆上（需與 `#cf6a55` 有對比），`ui` 畫在深色藥丸標籤上（需在 `rgba(23,53,58,.9)` 上可讀）。現行 `walk-art.ts` 的 `#436c62` 系列在磚紅上太沉、在深底上太暗，全部替換。

| 學院 | 建築 id | `band` | `ui` |
|---|---|---|---|
| 理學院 | SC, CH, PH, BI | `#2a8c99` | `#62d0dc` |
| 工學院 | EN, EC, MS, EV | `#2f5fa8` | `#7fa8ea` |
| 管理學院 | CMSS 北半 | `#d9a521` | `#f2c94c` |
| 社會科學院 | CMSS 南半 | `#7b4a8f` | `#c08ad8` |
| 行政／校級 | AD, IL, YH, SPORT, ACTIVITY | `#3d7a4a` | `#7ccf8a` |
| 海洋／其他背景 | ME, MB, IR, BEACH… | `#2c7f91` | `#8fd4e0` |

CMSS 為一棟兩院：以中庭廣場東西軸線為界，北段色帶金、南段紫，接縫處放 1 m 寬 `trim.cream` 斷帶，不做漸層。

### 1.3 既有 hex 比對的遷移表（必讀）

`walk-art.ts`、`walk-lod.ts` 以 `color.getHexString()` 辨識面：`ddd4c0`（牆）、`bca98c/b8a88f`（飾）、`d7d1c2`（地磚）、`d2c4ab`（木）、`c3cfc9`（石）、`9d7352/ad9975/a3937c`（門木）、`647f7f`（玻璃）、`8b9d79`（草地）、`629caa`（海）、`b7b7a8/c6bca5`（鋪面）、`e6e1d4/a27e68`（cutaway）。換色會讓細部與 LOD 靜默失效。建議：**改用 `mesh.userData.surface = 'wall'|'trim'|'glass'|'ground'|…` 標記**，一次改掉三處查表；若暫時仍用 hex，請同步更新 `families`、`contextSurfaceColors`、`groundColor`、`cutawayColors`。

### 1.4 UI token（相容 `src/style.css` 與 `walkthrough.css`）

保留：`--sea #2c7f91`、`--ink #173e49`、`--cream #f8f5ee`、`--route #b5471e`、`--walk-gold #edcc83`、`--walk-panel rgba(16,40,46,.89)`。新增（不改名既有）：

```css
.walkthrough{
 --label-bg:rgba(23,53,58,.90); --label-ink:#faf7eb; --label-radius:999px;
 --accent-sci:#62d0dc; --accent-eng:#7fa8ea; --accent-mgmt:#f2c94c;
 --accent-soc:#c08ad8; --accent-admin:#7ccf8a; --accent-marine:#8fd4e0;
 --kbd-bg:#faf7eb; --kbd-ink:#173e49; --kbd-shadow:0 2px 0 #c9bfa6;
 --card-bg:#fffdf8; --card-ink:#173e49; --card-line:#dbe2da;
 --brick:#cf6a55; --brick-deep:#a84a3b;
 --fs-hud:13px; --fs-label:14px; --fs-label-mobile:13px; --fs-title:28px;
}
```

---

## 2. 光照預設

三組預設共用同一個 `DirectionalLight`（陰影 2048²，桌面 `PCFSoftShadowMap`／手機維持 `PCFShadowMap` 1024²，`normalBias .06`）與 `HemisphereLight`；切換用 1.2 s lerp。天空以 **BackSide 半球 dome**（r 2,500 m，`fog:false`，256×1 `CanvasTexture` 垂直漸層或頂點色）實作，地平線才會隨相機俯仰移動；`scene.background` 貼圖只允許用於鳥瞰模式。

| 參數 | 日（預設 10:30） | 西子灣夕陽 | 夜 |
|---|---|---|---|
| Hemi sky / ground / intensity | `#dff2ff` / `#8fb46a` / 1.15 | `#ffc08a` / `#7a6a5a` / 0.9 | `#223a5c` / `#1a2420` / 0.55 |
| Sun color / intensity | `#fff4e0` / 2.6 | `#ff9a52` / 2.2 | `#9fb6e6`（月光）/ 0.7 |
| Sun elevation / azimuth | 55° / 150°（東南偏南） | 9° / 262°（西，落海） | 40° / 300° |
| Fog color / near / far（步行） | `#cfe9f3` / 160 / 620 | `#f4b98c` / 120 / 520 | `#101a28` / 90 / 420 |
| Fog（鳥瞰） | 同色 / 600 / 1800 | 同色 / 500 / 1500 | 同色 / 400 / 1300 |
| 天空頂 / 地平 | `#4f9ad8` / `#d7eef7` | `#4a4f9a` / `#ffb070` | `#060b1a` / `#1f3353` |
| Exposure | 1.05 | 1.0 | 0.9 |
| AmbientLight | 移除（改由 hemi 提供） | 移除 | `#1c2a44` 0.25 |

夜間發光機制（不加任何 PointLight）：窗戶用與日間相同的窗格貼圖當 `emissiveMap`，`emissive = glass.night`，`emissiveIntensity` 0 → 1.6，每 2×2 窗格 tile 內固定 3 亮 1 暗造成變化；路燈燈罩 `emissive #ffd79a`、強度 2.0，並在燈下放一片 1.6 m 直徑的 `InstancedMesh` 平面光暈（`AdditiveBlending`、alpha 0.35），地面不另算光照。夕陽預設把 `sea.deep` 的 material 換成 `#d8714f` 高光帶（UV 滾動），海面 roughness 0.25。

---

## 3. 程序建築立面語言

**模組**：bay 寬 3.0 m，storey 3.7 m。窗 1.8 m 寬 × 1.5 m 高，窗台 0.9 m、窗頂 2.4 m；相鄰窗間留 1.2 m 磚柱。角落（距轉角 < 1.5 m）不開窗。

**磚與米白分帶**：每層樓板線放 0.6 m 高 `trim.cream` 水平帶（y = n·3.7 ± 0.3）；1F 基座 1.2 m 高用 `brick.dark`；頂部 1.1 m 女兒牆為 `brick.light`，其下 0.3 m 學院 `band` 簷口（取代現有 `#436c62` 系列），色帶上下各加 0.1 m `trim.cream` 鑲邊，確保金、紫等低對比色在磚紅上仍清楚。所有這些高度以 **world Y** 定義。EN 與 SC 兩個 placement 的 `scale` 不同（1.257 vs 1.399），若以 local 座標疊帶會錯位，必須在世界座標計算。

**長廊（NSYSU 覆蓋廊道）**：1F 外側退縮 3.0 m 形成拱廊；柱 0.5×0.5 m、間距 4.5 m（= 1.5 bay）、淨高 3.2 m；柱色 `trim.cream`，廊底天花 `#f6efe0`，廊地坪 `pave.plaza`。每 3 根柱放 1 張長椅或 1 個垃圾桶（見 §5）。

**理工梳形長樓讀成一棟**：EN+SC 共享同一條簷口帶高度、同一色帶（工學院藍在 EN 段、理學院青在 SC 段，接縫處同 CMSS 做 1 m cream 斷帶）；外牆 DataTexture 的 UV 原點用世界座標（`worldUV` 已有，確認磚紋在 EN/SC 接縫連續）；梳齒之間的小中庭放同一組 4 棵樹 + 1 盞燈，重複節奏即是「一棟」的視覺證據。

**貼圖（128 px DataTexture，每棟一張、全校 ≤ 6 張）**：一張 tile 覆蓋 2 bay × 2 storey（6.0 × 7.4 m），UV repeat = (寬/6, 高/7.4)。內容：磚場（`brick.light` 底、磚層高 **0.4 m（約 7 px／行，不要沿用舊貼圖的 24 px）**、隨機 ±6 明度、1px `mortar` 縫）、4 個窗矩形（`glass.day`，各 38×26 px）、2 條 `trim.cream` 樓層帶（10 px）。夜間發光另做**第二張同尺寸 DataTexture 作 `emissiveMap`**（黑底、窗格白矩形，RGB 寫入；three.js 不讀 base map 的 alpha），搭配 `emissive = glass.night`。

**LOD**：相機 < 90 m：牆面 + `InstancedMesh` 窗框（`glass.frame` 外框 + 內縮 0.12 m 的玻璃板，每棟 2 draws）+ 柱 + 色帶；≥ 90 m：僅貼圖牆面（窗已烤進貼圖）+ 色帶；≥ 350 m 或鳥瞰：單一合併 mesh。屋頂設備：每 400 m² 屋面放 1 水塔（圓柱 r 1.2 m h 2 m，`roof.equip`）+ 2 空調箱（1.2×1×0.8 m），全校一個 InstancedMesh。

---

## 4. 地標建模簡報（Blender GLB，低多邊形，可辨剪影）

每件 ≤ 1,500 tris（圖資大樓 ≤ 2,500），單一材質、頂點色或 256 px 色塊貼圖，meshopt 壓縮，原點在底面中心、+Z 朝北（匯入時依 `axes` 轉換）。

| 地標 | 尺寸（約） | 剪影重點 |
|---|---|---|
| 行政大樓 AD | 45 × 39 m，7F ≈ 26 m | `wall.cream` 主體、`brick.dark` 1F 基座、正面 3 層高門廊 4 根方柱、中央大階梯 12 m 寬；頂層退縮 2 m 加 `band` 行政綠 |
| 圖資大樓 IL | 50 × 60 m，12F ≈ 45 m | 校園最高點。下 2 層裙樓（cream）＋上 10 層塔樓（磚紅）；頂部「皇冠」：四角 3 m 高米白立柱 + 內縮 1.5 m 的深色機房，夜間皇冠 emissive `#ffd37a` 0.8。鳥瞰時的定位錨 |
| 逸仙館 YH | 50 × 50 m，3F ≈ 16 m | 禮堂：大面磚牆無窗、正面米白柱廊 8 柱、`roof.dark` 淺斜屋頂（坡 12°）、入口前 20 m 寬階梯廣場 |
| 學生活動中心 ACTIVITY | L 形約 120 × 60 m，6F | 磚紅階梯狀量體（每 2 層退一階 3 m），屋頂露台放遮陽棚；面海側全高玻璃帶 |
| 校門（大門） | 門柱 2 根 1.2×1.2×6 m，橫梁無 | 右柱頂「國立中山大學」**直式**招牌：米白板 0.9 × 5.4 m，字 `#173e49`，夜間 emissive 0.6；左側警衛亭 3×3×3.2 m 斜頂；前方蓮海路斑馬線 + 2 個橘色三角錐 |
| 隧道口（西子灣隧道） | 拱 8 m 寬 × 6.5 m 高，壁厚 1.5 m | 石砌拱（`#bfb6a3`，頂石 `#8d8677`），上方爬藤綠帶，內部 20 m 後以 `fog` 顏色黑板收尾；門額小牌 |
| 國徽廣場 | 圓 r 7 m | 平面圓台 0.15 m 高 `pave.plaza`，12 道放射縫，中央 2 m 青天白日簡化圖樣（12 道光芒，`#2f5fa8`+白）；環繞 8 支旗桿 7 m、2 排長椅 |
| 海濱元素 | — | 防波堤（條狀 `#bfb6a3` 2×2 m 斷面）、燈塔遠景（旗津高雄燈塔：白色八角塔 r 2 m h 15 m，距岸 900 m，僅 LOD 剪影 ≤ 120 tris）、沙灘遮陽傘 3 色、救生台 |

---

## 5. 道具表與密度規則

全部 `InstancedMesh`，每種道具一個 draw（含 4 種樹冠共 ≤ 20 draws）。Tri 預算為單一實例。

| 道具 | 規格 | 密度／擺放 |
|---|---|---|
| 行道樹（闊葉） | 冠：IcosahedronGeometry(1,1) 兩球疊（大 r 2.2、小 r 1.4 偏移），幹 r .18 h 3.2；≤ 120 tris；樹冠 4 色隨機、scale 0.85–1.25、隨機 yaw | 沿 `roads` 中 `kind ∈ {residential, living_street, service}` 兩側距路緣 1.5 m，**每 9 m 一棵**；斑馬線前後 6 m 內不種 |
| 坡地樹 | 同上但 scale 1.0–1.6，只用 `tree.2/.4` 深色 | 壽山坡面高度 > 8 m 處，Poisson 取樣間距 7 m，密度隨坡高遞增；鳥瞰目標 ≈ 2,500 棵（4 draws） |
| 棕櫚 | 幹 r .25 h 7 彎 6°，8 片扇葉 plane；≤ 180 tris | 蓮海路臨海側、沙灘後緣，每 12 m；國徽廣場外環 8 棵 |
| 灌木／花叢 | r 0.7 二十面體，`#58a845` + 紅 `#e04b3a` 小球 6 顆 | 建築入口兩側、長廊柱基每 2 柱 1 叢 |
| 路燈 | 桿 .1 × 4.5 m，`#395950`；燈罩 .3 × .25 m `#ffd79a` emissive；≤ 60 tris | 道路每 25 m 單側交錯；長廊每 9 m 一盞壁燈（簡化方盒） |
| 長椅 | 1.8 × .45 × .9 m，木 `#936d48` + 鐵 `#395950`；≤ 80 tris | 長廊每 3 柱 1 張；廣場每 20 m 周長 1 張；面向海或中庭 |
| 垃圾桶 | 圓柱 r .3 h .9 `#4b6b63`，蓋 `#edcc83` | 每 2 張長椅 1 個、每棟入口 1 個 |
| 自行車架＋車 | 架：5 槽 2.5 m；車：≤ 200 tris，車身 5 色（`#2f5fa8 #e04b3a #f2c94c #173e49 #ffffff`），佔用率 60% 隨機 | 每棟主入口 1 架；宿舍、活動中心 3 架 |
| 斑馬線／標線 | 貼圖烤進道路 mesh（§1.1 尺寸）；「慢」字 6 × 3 m 貼花 | 每個路口 4 向；校門、行政大樓前、體育館前必有 |
| 三角錐／護欄 | 錐 .35 × .7 m `#f27a2c` 白環；≤ 40 tris | 校門、停車場入口各 3 個 |
| 獼猴 | 靜態姿勢 3 種（坐、走、吊）；≤ 400 tris；`#8a6a4a` 身、`#e8c9a8` 臉 | 壽山坡腳樹下、圖資大樓後方、翠亨道：全校 18 隻；可作為故事收集觸發點 |
| 帆船 | 船身 6 m 白、帆 `#ffffff` 與 `#e04b3a` 條；≤ 150 tris | 西子灣外海 5 艘，沿橢圓路徑 0.8 m/s 漂移；旗津方向 2 艘貨輪剪影（120 × 20 m 板狀） |
| 布旗（banner） | 0.6 × 1.8 m 雙面 plane，掛路燈桿 2.2 m 高；內容為原創校園活動字樣（不用校徽） | 蓮海路與中庭主軸每盞路燈 1 面，學院色底 + 米白字 |

---

## 6. 角色簡報（3 位原創學生）

比例：**2.6 頭身、身高 1.40 m**（頭 r 0.27 m），短腿粗手、大鞋、無頸；臉部僅兩點眼 + 一筆嘴（貼圖 128 px），不做鼻。≤ 3,000 tris、單材質 512 px 貼圖、骨架 ≤ 24 bones。門高 2.1 m 與 3.7 m 樓層維持建築尺度感。

| 角色 | 設定 | 配色 |
|---|---|---|
| 阿海 | 海科系男生，愛衝浪 | 青綠防風外套 `#2a8c99`、米白短褲、橘拖鞋 `#f27a2c`、深棕亂髮 |
| 小嵐 | 管院女生，帶筆電 | 芥黃針織 `#d9a521`、深藍百褶裙 `#173e49`、白球鞋、黑短髮配髮夾 `#e04b3a` |
| 阿拓 | 理工研究生，背大背包 | 白實驗袍開襟、內搭 `#7b4a8f` T 恤、灰褲、黑框眼鏡、背包 `#3f8f4c` |

動畫 clip（30 fps，root motion 關閉，由物理驅動）：`Idle`（loop，2.4 s，呼吸 + 每 6 s 眨眼變體）、`Walk`（loop，0.9 s，步幅 0.7 m）、`Run`（loop，0.6 s，步幅 1.3 m，身體前傾 12°）、`Jump`（one-shot，0.75 s：蹲 0.15 s → 騰空 0.4 s → 落地 0.2 s，支援中途 blend 回 Walk）。選配：`Wave`（one-shot 1.2 s，收集故事時播放）。腳底放 r 0.45 m 的柔邊圓形假陰影 plane（`#000` alpha .28）補 PCF 陰影在手機上的缺失。

---

## 7. UI 方向

**建築標籤（screen-space HTML）**：`position:fixed` 的藥丸，背景 `--label-bg`、文字 `--label-ink`、`padding:5px 14px 7px`、`border-radius:999px`、`font-weight:600`、桌面 `14px`／手機 `13px`、`letter-spacing:.3px`、底部 3 px 學院色底線用 `::after` 實作（`position:absolute;left:10px;right:10px;bottom:0;height:3px;border-radius:2px;background:var(--accent-*)`），左右內縮 10 px 是重點，不用 `box-shadow`。錨點在建築頂面中心上方 4 m；用 `camera.project()` 每幀更新 `transform:translate3d`。**避讓**：按重要度（地標 > 學院主樓 > 其他）排序，貪婪檢查 AABB 重疊（膨脹 6 px），衝突者先嘗試垂直上移 1 階（22 px），仍衝突則隱藏；桌面最多 14 個、手機 8 個；距相機 > 450 m 或被相機背對者 `opacity:0` 並 `pointer-events:none`。步行模式只顯示最近 4 個。

**HUD 最小字級 13px**：現行 `walkthrough.css` 在 ≤759px 使用 8–11px（`.walk-help`、`.walk-button`、`.walk-brand small`），一律提升至 `--fs-hud:13px`；裝飾性 eyebrow 可用 11px 但需 `letter-spacing:1.5px` 且非操作資訊。按鈕最小觸控 44 × 44。

**小地圖**：全校範圍（含西子灣、壽山坡腳），桌面 220 × 170、手機 128 × 100；紙底 `#f4ecd8`、建築 `#cf6a55`、草 `#a9d46e`、海 `#5fc3cf`、路 `#ffffff` 1.5px、玩家箭頭 `--route #b5471e` 帶 18 px 視野扇形；右上角 N 羅盤 18 px，固定北朝上，點擊展開為 420 px 大地圖。

**建築資訊卡**：320 × auto，底 `--card-bg`、`border-radius:14px`、陰影 `0 12px 40px #173e4926`；頂部 72 px 學院色塊內放程序生成的立面 swatch（canvas 畫 3 bay × 2 storey）；內容：名稱 20px/600、英文 12px `--muted`、學院 chip（學院 `ui` 色底、`#173e49` 字）、樓層數、主要單位 2–3 行、按鈕「帶我去 →」（`--walk-gold` 底）。手機改為底部 sheet，高度 ≤ 42vh。

**校園故事卡**：右上計數 chip「校園故事 3 / 12」（同 nccu 位置，`--walk-gold` 圓點 + 數字 15px/700）；收集時彈出 360 px 卡：左 96 px 原創 SVG 插圖（猴子、浪、燈塔…）、標題 18px、2–3 行 14px、「收下」按鈕；進場 `translateY(12px)` 220 ms。收集點在世界中為 1 m 浮動發光書本（`InstancedMesh`，emissive `--walk-gold`，上下漂浮 0.15 m）。

**歡迎畫面**：沿用左側墨綠面板，但加入角色選擇列：3 張 92 × 120 卡（`--card-bg`，選中加 3 px `--walk-gold` 外框與角色名 13px），卡內放 SVG 半身像（不即時渲染 3D，省 draw）。按鍵提示改為 chip：`kbd{background:var(--kbd-bg);color:var(--kbd-ink);border-radius:6px;padding:2px 7px;font:700 13px/1.4 inherit;box-shadow:var(--kbd-shadow)}`，右側說明 13px；底部提示列與 nccu 相同改成白底圓角條 `rgba(250,247,235,.92)`、字 `--ink`，高度 36 px。

---

## 8. 優先順序：視覺收益最大先做（Top 10）

1. **天空漸層 + 霧色 + 日間光照預設**（§2）— 0 draw call，整體氣氛立即從灰綠變明亮。
2. **磚紅調色盤 + 遷移 hex 查表到 `userData.surface`**（§1.1、§1.3）— 建築主色翻新，順便移除靜默失效風險。
3. **screen-space HTML 藥丸標籤 + 避讓**（§7）— 取代現有 Sprite 標籤，可讀性與「淡海感」最大來源。
4. **InstancedMesh 行道樹／坡地樹 ≈ 3,000 棵**（§5）— 4–5 draws 填滿畫面空白。
5. **道路貼圖：柏油 + 標線 + 斑馬線 + 人行道**（§1.1、§5）— 從 `roads` 折線生成帶 UV 的帶狀 mesh。
6. **立面模組：樓層 cream 帶、1F 基座、學院色簷口、窗格貼圖 + 夜間 emissive**（§3）。
7. **路燈／長椅／單車／垃圾桶道具層**（§5）— 人的尺度感。
8. **圖資大樓皇冠 + 行政大樓門廊 + 校門直式招牌 GLB**（§4）— 三個最容易辨認的錨點。
9. **西子灣：淺／深海 + 沙灘 + 帆船 + 遠景燈塔**（§1.1、§4、§5）。
10. **夕陽／夜間預設 + 角色選擇 + 故事收集 UI**（§2、§6、§7）。

驗收：每項完成後以 `artifacts/` 既有截圖位（welcome / walk / room）重拍對照，並記錄 `renderer.info.render.calls` 與 `triangles`（鳥瞰 ≤ 800 / ≤ 400k）。
