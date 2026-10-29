# 山海之間・美術方向 v3（soft toon 版）

版本 2026-10-19・作者 Fable（art director）。取代 `art-direction.md`（v2，明亮低多邊形）的渲染與角色章節；v2 的道路、道具密度、標籤避讓、小地圖規則仍有效，本文未重述者沿用。史實考證以 `visual-reference.md` 為準，並由另一位研究者持續核對；本文只談「怎麼看起來像」，不新增任何史實主張。

目標畫面：**原神／nccu100 式柔和 toon** —— `MeshToonMaterial` ＋ 256 px 柔邊色階、toon shader 內補 rim light、建築與角色加反向外殼描邊、手寫後處理（MSAA → 兩層 bloom → 冷陰影暖亮部分級 → vignette）、指數阻尼跟隨相機、落地壓扁、塵土粒子、區域名橫幅。三組光照預設（日／西子灣夕陽／夜）保留，手機走自適應畫質。

---

## 0. 先看現況哪裡不對（對照 `artifacts/p2/*.png`）

四張截圖的共同病根只有三個：**沒有 shading 語言**（Standard 材質＋ACES 把一切壓成均勻的灰）、**沒有線**（沒有描邊，所有邊緣靠色差撐）、**沒有尺度錨**（沒有人、沒有家具、沒有海）。逐張：

| 截圖 | 具體問題 | v3 對應 |
|---|---|---|
| `desktop-welcome.png`（鳥瞰） | 標題寫「山海之間」，畫面裡**沒有海**；壽山是一片均勻萊姆綠，樹是同一顆 icosahedron 複製 7k 次，沒有明暗、沒有體積；建築是米色平板加一條紅磚色帶，屋頂全空；畫面左側露出一個灰色半球狀的占位物，沒有任何語意；標籤 14 個擠在同一區，且顏色與場景毫無關係。 | §1 六種樹冠色＋頂點 AO；§2 鳥瞰預設相機改為朝西南，讓海入鏡；§5 屋頂設備與女兒牆；§7 區域橫幅取代擠在一起的藥丸標籤 |
| `desktop-walk.png`（步行） | 角色是方塊積木：無頸、無描邊、全身同一個明度，腳下一團硬邊黑影；草地是一整片 `#9ad46e` 無噪聲；建築 1F 變成一條黑色空洞帶（柱廊沒有天花、沒有地坪色）；窗戶是均勻的深青格子，窗框等寬，讀不出玻璃；天空只有一個藍。 | §3 角色改用骨架化 CC0 人物＋描邊＋柔邊假陰影；§1 草地兩色噪聲＋ toon ramp；§5 長廊天花與地坪；§1 玻璃反射漸層烤進貼圖；§2 天空 dome 三段漸層 |
| `desktop-sunset.png`（夕陽） | 幾乎分不出與日間的差別：陰影方向沒變長、立面沒有被暖光染色、沒有海可以反射夕陽、天空頂還是正午藍。中庭廣場的國徽圖樣在 toon 風格下會像貼紙。 | §2 夕陽預設：太陽仰角 9°、暖 rim、海面高光帶、分級推橘紫；§4 bloom 第二層在夕陽加強 |
| `desktop-night.png`（夜） | 每一扇窗都亮、同一個黃，像一片波浪板；沒有 bloom 光暈、路燈沒有光池、天空是單色深藍；立面在暗處變成純黑噪點。 | §2 夜間 emissive 以 2×2 tile 3 亮 1 暗 ＋ 每棟隨機 35% 整層熄燈；§4 夜間 bloom 強度 ×2；§1 夜空雙色漸層＋星點 |

另外兩個跨截圖的問題：HUD 面板是深墨綠毛玻璃，與場景的黃綠色完全不搭（v3 UI 改成「紙＋墨＋金」，見 §7）；三位角色卡只有文字沒有圖。

---

## 1. 調色盤（token）

> 所有 hex 為線性工作流前的 sRGB albedo。v3 的 tone mapping 移到後處理（§4），曲線仍用 ACES filmic 以沿用 v2「比目標色再飽和一階」的調校；不要同時開 `renderer.toneMapping`，否則會雙重壓縮。
>
> 前置工作（必做）：`walk-art.ts`／`walk-lod.ts` 目前用 `color.getHexString()` 辨識面，換色會靜默失效。v3 所有材質一律以 `mesh.userData.surface` 標記（`wall|trim|glass|roof|ground|grass|pave|sea|foliage|prop|character`），三處查表一次改掉。

### 1.1 Toon ramp（`gradientMap`，256×1，所有 toon 材質共用一張）

| 區段（NdotL 0→1） | 亮度值 | 說明 |
|---|---|---|
| 0.00–0.30 | 0.46 | 陰影帶；不是黑，留顏色 |
| 0.30–0.38 | 0.46 → 0.80 smoothstep | 第一道柔邊，寬 8 px／256 |
| 0.38–0.64 | 0.80 | 中間調（大部分立面落在這裡） |
| 0.64–0.72 | 0.80 → 1.00 smoothstep | 第二道柔邊 |
| 0.72–1.00 | 1.00 | 受光面 |

設定要點：`gradientMap.minFilter = gradientMap.magFilter = LinearFilter`（three.js toon 範例用 `NearestFilter`，那是硬邊卡通，不是我們要的）；`colorSpace = NoColorSpace`；`generateMipmaps = false`。陰影帶再乘以 §2 各預設的 `shadowTint`（在 `onBeforeCompile` 把 `diffuseColor.rgb *= mix(shadowTint, vec3(1), ramp)` 插在 `#include <lights_toon_pars_fragment>` 之後），這就是「冷陰影」的第一層；分級是第二層。

Rim light（同一段 patch）：`rim = pow(1.0 - saturate(dot(normal, viewDir)), 3.0) * rimStrength`，加到 `outgoingLight`，顏色與強度見 §2。只對 `character`、`wall`、`prop` 開；`foliage`、`grass`、`sea` 不加 rim（樹太多會變成一圈白邊噪點）。

### 1.2 環境與建築

| Token | Hex | 用途／備註 |
|---|---|---|
| `brick.base` | `#c75f4a` | 主立面色。toon 陰影帶會乘 0.46，所以比 v2 略亮 |
| `brick.shade` | `#a8493a` | 頂點色塗在基座、簷下、長廊內側；不是另一個材質 |
| `brick.mortar` | `#e6d2c2` | 貼圖內 1 px 線，面積 ≤ 8% |
| `trim.cream` | `#f3ebdb` | 樓層帶、柱、簷口、女兒牆壓頂 |
| `wall.cream` | `#efe6d1` | 行政大樓、圖資裙樓 |
| `stone.portal` | `#cfcbbe` | 隧道口仿石拱、海堤、行政大樓階梯；頂石 `#8d8677` |
| `roof.deck` | `#d6cfbe` | 平屋面 |
| `roof.dark` | `#8d5a4c` | 逸仙館、校門警衛亭斜頂 |
| `roof.equip` | `#b8bdb9` | 水塔、空調箱 |
| `glass.day` | `#86b7c8` | 基底；貼圖內上 40% 混入 `#dcedf4`（反射天空），下 60% 混入 `#3e6572`，一張貼圖就有「玻璃感」 |
| `glass.night` | `#ffd37a` | emissive；強度 0 → 1.4；夜間另加 `#ffb15c` 亮 1 暗 3 的第二組 |
| `glass.frame` | `#3b3a36` | 深古銅窗框（近距 LOD 實體） |
| `grass.a`／`grass.b` | `#86c45c`／`#6fb04e` | 兩色噪聲（頂點色，Perlin 6 m 週期，混 40%）；不要再出現單色草皮 |
| `grass.dry` | `#a3c96a` | 坡地邊緣、操場 |
| `road.asphalt` | `#6e7686` | 偏藍灰 |
| `pave.walk`／`pave.plaza` | `#e9e1cf`／`#dccfb6` | 人行道／廣場 |
| `sand` | `#e8d5ad` | 西子灣沙灘；濕沙線 `#c9b48c` 寬 2 m |
| `sea.shallow`／`sea.mid`／`sea.deep` | `#62c8d2`／`#2f93a6`／`#1f6f86` | 依離岸距離 0–30／30–120／120+ m 頂點色；toon 不接 ramp，改用 `MeshBasicMaterial` ＋ 捲動的法線噪聲亮帶 |
| `sea.foam` | `#ffffff` | 岸線 0.8 m 浪沫帶，UV 捲動 |
| `sea.sunGlint` | `#ff8f5a` | 夕陽預設海面高光帶（§2） |
| `hill.near`／`hill.mid`／`hill.far` | `#4f9a46`／`#3f8343`／`#6b9c86` | 壽山；遠層混霧 |
| `foliage.1–6` | `#5fae48` `#4d9a44` `#7fc156` `#3f8a4c` `#6a9e3e` `#8fa893` | 六種 InstancedMesh 樹冠；第六種是白水木銀綠，只種海岸；每棵再乘頂點 AO（底部 0.72 → 頂部 1.0）才有體積 |
| `foliage.flame` | `#e04b3a` | 鳳凰木花冠，4% 的行道樹換成這種（萬壽路坡道多一點） |
| `tree.trunk`／`palm.trunk`／`palm.leaf` | `#8a6243`／`#a08664`／`#4f9d4a` | |
| `bronze` | `#435249` | 銅獅、孫中山像；高光帶 `#6f8070` |
| `wood.deck` | `#7a5230` | 菩提樹木棧平台 |

### 1.3 學院色帶

沿用 v2 §1.2 的 `band`／`ui` 兩組值（理 `#2a8c99`／`#62d0dc`、工 `#2f5fa8`／`#7fa8ea`、管 `#d9a521`／`#f2c94c`、社 `#7b4a8f`／`#c08ad8`、校級 `#3d7a4a`／`#7ccf8a`、海洋 `#2c7f91`／`#8fd4e0`），但在 toon 下色帶 **不接 ramp**（用 `MeshBasicMaterial`），否則陰面的金、紫會變髒。

### 1.4 描邊色

| Token | Hex | 用在 |
|---|---|---|
| `outline.char` | `#2a2c4a` | 角色、獼猴（nccu100 同值） |
| `outline.build` | `#3a2f3b` | 建築、地標；比角色暖一點，貼磚紅不會發青 |
| `outline.night` | `#141a30` | 夜間兩者皆換成這個 |

### 1.5 UI token（擴充 `.walkthrough`，不改既有名稱）

```css
.walkthrough{
 /* 既有：--walk-panel --walk-gold --walk-paper --walk-ink --walk-muted --walk-line */
 --ui-paper:#fbf6ea;        /* 對話框、章節卡底 */
 --ui-paper-2:#f1e9d6;      /* 卡片次底、分隔 */
 --ui-ink:#1d2a3a;          /* 主文字 */
 --ui-ink-soft:#56657a;
 --ui-line:#2a2c4a;         /* 卡片 2px 描邊，與角色描邊同色 */
 --ui-gold:#e9b949;         /* 任務箭頭、進度、強調 */
 --ui-gold-deep:#b98422;
 --ui-sea:#2c7f91; --ui-brick:#c75f4a; --ui-leaf:#4d9a44;
 --ui-shadow:0 6px 0 #2a2c4a22, 0 14px 32px #1d2a3a2e;
 --ui-radius:18px; --ui-radius-sm:10px;
 --fs-dialog:16px; --fs-dialog-mobile:15px; --fs-objective:14px; --fs-banner:30px;
}
```

---

## 2. 光照、天空與三組預設

共用：一盞 `DirectionalLight`（桌面陰影 2048² `PCFSoftShadowMap`、手機 1024² `PCFShadowMap`，`normalBias .05`，陰影相機跟著玩家走 120 m 框）＋一盞 `HemisphereLight`。toon 材質下 hemi 只補陰影帶的顏色，不補亮度，所以強度比 v2 低。天空為 BackSide 半球 dome（r 2,500 m，`fog:false`），三段漸層：`top` → `mid`（在仰角 18°）→ `horizon`；太陽位置另加一個 `Sprite` 日輪（r 40 m 視覺尺寸，加 `AdditiveBlending`），bloom 會自己把它暈開。切換 1.2 s lerp。

| 參數 | 日（10:30） | 西子灣夕陽 | 夜 |
|---|---|---|---|
| Sun color／intensity | `#fff4e0`／2.2 | `#ff9a52`／1.9 | `#9fb6e6`／0.6 |
| Sun elevation／azimuth | 55°／150° | 9°／262°（落進海裡） | 40°／300°（月） |
| Hemi sky／ground／強度 | `#dff2ff`／`#8fb46a`／0.6 | `#ffc08a`／`#7a6a5a`／0.5 | `#223a5c`／`#1a2420`／0.35 |
| `shadowTint`（§1.1） | `#b9c6e0` | `#9a7fb8` | `#5c6e9e` |
| Rim color／strength | `#fff1d6`／0.35 | `#ffb070`／0.65 | `#8fb2ff`／0.45 |
| Sky top／mid／horizon | `#3f8fd6`／`#8ec3ea`／`#dcecf4` | `#3d3f8c`／`#d86a63`／`#ffb070` | `#050a19`／`#101d3a`／`#1f3353` |
| 日輪 color／size | `#fff6dc`／1.0 | `#ffb060`／1.6 | `#e8eefc`／0.6（月） |
| Fog color／步行 near-far／鳥瞰 | `#cfe9f3`／160–620／600–1400 | `#f4b98c`／120–520／500–1500 | `#101a28`／90–420／400–1300 |
| 海面 | `sea.*` 原色＋白色閃點 | `sea.mid` 混 `#d8714f` 40%、`sea.sunGlint` 高光帶寬 25 m 指向太陽 | 整體乘 0.35，閃點改 `#9fb6e6` |
| 窗 emissive 強度 | 0 | 0.5（只有 1F 商店、走廊） | 1.4，整層隨機 35% 熄燈 |
| 路燈 emissive／光池 | 0 | 1.0／alpha .2 | 2.0／alpha .4，光池 r 2.4 m `#ffd79a` |
| 星點 | — | — | 1,200 個 `Points`，size 1.6 px，`#dfe8ff`，只在 dome 上半 |

鳥瞰預設相機：從西子灣外海上空朝東北看回校園（yaw 45°、pitch −38°、距中庭約 520 m），海在前景佔畫面下緣 25%，紅磚校舍居中，壽山當背景；歡迎畫面必須看得到海。

---

## 3. 描邊規則（反向外殼）

- 技術：每個要描邊的 mesh 複製一份，`side: BackSide`、`MeshBasicMaterial({color: outline.*})`、頂點沿「平滑法線」外推。硬邊盒子（程序建築）的 `normal` 是面法線，直接外推會在轉角裂縫；**必須另存一組平均法線 attribute `aOutlineNormal`**（程序幾何在生成時算，GLB 在 Blender 以 Data Transfer 烤到 custom attribute 匯出）。
- 寬度為螢幕常數：`offset = targetPx × dist × 2·tan(fov/2) / viewportHeight`，再 `clamp(offset, min, max)`。

| 對象 | targetPx（桌面／手機） | clamp（m） | 關閉距離 |
|---|---|---|---|
| 角色、獼猴 | 2.0／1.6 | 0.006–0.03 | 60 m |
| 地標 GLB | 1.5／1.2 | 0.02–0.20 | 220 m |
| 程序建築 | 1.3／— | 0.02–0.18 | 160 m（手機不描） |
| 樹、道具、海、地面 | **不描邊** | — | 7k 棵樹描邊是 7k 個額外 draw，而且遠看全黑 |

- 描邊在主場景之後、透明物之前渲染；`depthWrite: true`，避免被自己的樹冠遮出鋸齒。
- LOD ≥ 350 m 的合併 mesh 不帶外殼；鳥瞰靠分級的邊緣對比就夠。
- 夜間所有描邊色換 `outline.night`，並把 alpha 降到 0.8（否則黑線在暗底會糊成塊）。

---

## 4. 後處理（手寫，不用 EffectComposer）

流程：`scene → RT_A（HalfFloat，MSAA）→ 亮度萃取 → bloom 金字塔 → 合成＋分級＋vignette → sRGB 輸出`。Tier A／B：`renderer.toneMapping = NoToneMapping`，曲線在合成 pass 裡算（ACES filmic，exposure 日 1.05／夕 1.0／夜 0.9）。Tier C 沒有合成 pass，必須把 `renderer.toneMapping` 設回 `ACESFilmicToneMapping`（同一組 exposure）直出，跳過分級與 vignette；切換 Tier 時這個旗標要跟著切，否則 C 會變成一張沒壓縮的線性灰片。

| 項目 | 桌面（Tier A） | 手機高（Tier B） | 手機低（Tier C） |
|---|---|---|---|
| RT 取樣 | MSAA 4 | MSAA 2 | 不走 RT，`antialias:true` 直出 |
| DPR 上限 | 1.65 | 1.3 | 1.0 |
| Bloom | 兩層 | 一層（寬層） | 無 |
| 描邊 | 全部 | 角色＋地標（≤120 m） | 角色 |
| 陰影 | 2048 PCFSoft | 1024 PCF | 關；角色用假陰影 |
| 樹 draw 上限 | 6（六色） | 4 | 3，坡地樹減半 |

Tier 自動降級：連續 1 s 平均 frame time > 24 ms 降一級，> 40 ms 再降；不自動升級（避免抖動）。初始值：`pointer:coarse` 且 `deviceMemory ≤ 4` → C，否則 B；桌面 A。`docs/spec-v3.md` §4 的細階梯（DPR −0.25 → 關 bloom → 陰影 1024 → 關陰影、10 s 穩定回升）可視為同一組 Tier 的實作版本；兩者衝突時以 spec 的量測門檻為準、以本文的「每級保留哪些效果」為準。

### 4.1 Bloom（兩層）

| | 第一層（緊，窗、燈、日輪） | 第二層（寬，氣氛） |
|---|---|---|
| 起算解析度 | 1/2 | 1/4 |
| 亮度閾值／knee | 0.85／0.15 | 0.55／0.30 |
| 金字塔層數 | 3 | 5 |
| 混合權重（由細到粗） | 0.5／0.3／0.2 | 0.30／0.25／0.2／0.15／0.1 |
| 最終混入（日／夕／夜） | 0.10／0.18／0.35 | 0.06／0.16／0.22 |

Downsample 用 13-tap（Jimenez），upsample 用 3×3 tent；不要用 `UnrealBloomPass` 的預設，那個在 toon 上會把米白牆整片糊掉。

### 4.2 分級（合成 pass）

| 參數 | 日 | 夕陽 | 夜 |
|---|---|---|---|
| 陰影染色（luma < 0.35） | `#5c6fa6` × 12% | `#6a4f8f` × 18% | `#1f2d5c` × 24% |
| 亮部染色（luma > 0.7） | `#ffd9a3` × 10% | `#ffb070` × 16% | `#ffe3a8` × 10% |
| 飽和度 | 1.08 | 1.12 | 0.92 |
| 對比（S 曲線中點 0.5） | 1.06 | 1.08 | 1.04 |
| Lift／Gain | 0.02／1.02 | 0.03／1.0 | 0.0／0.98 |

### 4.3 Vignette

`v = smoothstep(radius, radius − softness, length(uv − 0.5) × 1.3)`，顏色不是黑，是乘向該預設的陰影染色：日 radius 0.72／softness 0.45／強度 0.28；夕陽 0.70／0.45／0.36；夜 0.68／0.5／0.42。對話框開啟時強度再 +0.1，視線自然收到中央。

---

## 5. 地標建模簡報（11 件，Blender GLB）

通則：
- 原點底面中心、+Y 上、+Z 朝北；meshopt 壓縮；每件 **1 個材質**：512 px albedo（平塗色塊＋烤進去的磚線、窗框、飾帶）＋ 512 px emissive（夜窗、招牌，黑底）；要描邊的件另帶 `aOutlineNormal`。
- **烤貼圖 vs 做幾何的分界**：在 15 m 閱讀距離下，凸出 < 0.25 m 且不影響剪影的（磚縫、窗框、飾帶、文字）→ 貼圖；會改變剪影或會被描邊勾到的（柱、簷、階梯、女兒牆、皇冠、拱心石、雨遮）→ 幾何。
- 立面節奏用 v2 §3 的模組：bay 3.0 m、storey 3.7 m、窗 1.8×1.5 m、角落 1.5 m 內不開窗。
- 平面位置以 `src/world-layout.json` 的 `anchor`／`rects` 為準；標註「無 placement」者需要先在 layout 補位置才可放。
- 史實標記：下表「已有來源」的數字可直接用；其餘屬【建模推論】，建完後交給研究者對照；不確定的細節寫【待查證】，不要在模型上「畫得很肯定」。

| # | 地標 | 量體（m）與 tris 上限 | 屋頂 | 立面節奏 | 簽名細節（幾何） | 烤進貼圖 | 來源／標記 |
|---|---|---|---|---|---|---|---|
| 1 | 行政大樓 AD | 45×39，B1–7F ≈ 26 m；≤ 4,000 | 平頂、`trim.cream` 壓頂 1.1 m、電梯機房中央 | 水平帶狀窗：每層一條 `trim.cream` 樑帶 0.6 m 夾深色窗帶；垂直紅磚壁柱每 2 bay 一支 | 正面 3 層高門廊 4 根方柱（0.8 m）；12 m 寬大階梯 7 階；兩尊銅獅（各 ≤ 500 tris，`bronze`）各站 1.2 m 基座；正門前無障礙坡道 | 帶狀窗玻璃漸層、樑帶陰影線、1F 基座 `brick.shade` | 7F、1984、陳志慈銅獅：已有來源。「坐南朝北、對稱、微凹字形」屬【建模推論】 |
| 2 | 圖資大樓 IL | 50×60，B2–12F ≈ 45 m；≤ 6,000 | 11–12F 外挑＋多角斜頂「皇冠」（八角、坡 30°、`roof.dark` 折板＋`trim.cream` 邊框）；皇冠夜間 emissive `#ffd37a` 0.8 | 1–4F 裙樓 `wall.cream` 方柱迴廊；5–10F 塔樓 `brick.base` 垂直長窗（窄高 0.9×2.6 m）＋深遮陽框 0.4 m | 2F 大階梯（寬 20 m，與中庭相接）、迴廊方柱 0.6 m、皇冠；裙樓中央天井挖空（鳥瞰可見） | 長窗遮陽框內側陰影、裙樓柱間欄杆 | 12F、1989、陳其寬：已有來源。皇冠的角數與坡度屬【建模推論】；【待查證：皇冠是否八角、折板材質】 |
| 3 | 文學院 | 【待查證：量體、樓層、所在位置】；暫列 40×30，4F；≤ 3,000 | 【待查證】 | 磚紅＋米白帶，沿用模組 | 坡道入口、鳳凰木環繞 | — | **無 placement**；`visual-reference.md` 關於文學院位置的敘述與領事館混寫，不採用。只做一版「可替換」的通用院館，等研究者確認後再改 |
| 4 | 理工長廊（紅磚拱廊，模組套件） | 每模組 4.5 m 長×4.5 m 寬×4.0 m 淨高；每模組 ≤ 400；全線 120–150 m | 平頂 `trim.cream` 厚 0.5 m，每 3 模組一盞壁燈 | 外側：紅磚方柱 0.5 m 或圓柱 r 0.3（兩種交替，依段）；內側：半高欄杆 1.1 m `trim.cream` | 柱、頂蓋、欄杆、海報看板（每 2 模組 1 面 1.8×1.2 m，貼圖內容為原創社團海報色塊）、長椅 | 磚縫、海報、地坪 `pave.plaza` 格線 | 「半戶外有頂、串聯各館、海報與擺攤」已有來源；來源描述為平頂柱廊，所以本文建議拱只做在柱頂一道 0.3 m 的淺弧飾，**不做成羅馬拱**。⚠ 這與 brief 寫的「紅磚拱廊」不同，待使用者確認：要「像照片」就照本文，要「像插畫」就做半圓拱（每模組 +120 tris） |
| 5 | 西子灣隧道口 | 洞口 6 m 寬 × 5 m 高（來源數字）、拱圈外框 10×8，壁厚 1.5；隧道體 20 m 深後以霧色封；≤ 2,500 | 山體 mound 覆蓋，爬藤與榕樹氣根（幾何 6 條垂帶） | 仿石砌拱圈：13 塊拱石各自為幾何（描邊會勾出來）；兩側壁柱、水平飾帶 | 拱心石、扁額框（文字烤貼圖，內容「西子灣隧道」；【待查證：扁額實際題字】）、隧道內暖黃燈帶 emissive、人行分道欄杆 | 石塊斑駁、藤葉 | 1928、260×6×5 m：已有來源。洞內目前只做 20 m stub，第 ② 章劇情以「抵達洞口」為準（見 story-draft-v3） |
| 6 | 校門＋校碑 | 校碑 21.2 m 高（來源數字）、底 3.6×2.2 階梯狀三柱（高 21.2／16／11）；警衛亭 3×3×3.2；≤ 2,000 | 校碑無頂；警衛亭 `roof.dark` 斜頂 | 校碑純磚，磚層 0.4 m 烤貼圖 | 直書「國立中山大學」立體字（幾何，0.08 m 厚，`#d4af37`，夜間 emissive 0.5）、圓形校徽位置留一個 r 0.9 m 的圓盤（**不放真實校徽圖樣**，以同心圓＋12 道線的原創紋樣代替）、車牌柵欄、斑馬線 | 磚縫、警衛亭窗 | 21.2 m、直書字樣、鄰海堤：已有來源。三柱階梯狀與比例屬【建模推論】 |
| 7 | 逸仙館 YH | 50×50（舞台高塔另加 18×22×22）；B1–3F；≤ 4,000 | 主體平頂折線女兒牆；舞台太子樓無窗紅磚方盒 | 兩側幾乎無窗（劇場）；四周外迴廊：`trim.cream` 方柱 0.6 m、間距 4.5 m | 正面大階梯（20 m 寬、直上 2F）、2F 落地玻璃門廳、外迴廊、右側草坪蔣中正立像基座（像本體 ≤ 400 tris） | 迴廊天花、磚縫 | 1,370 席、外迴廊、大階梯、銅像遷移：已有來源；太子樓尺寸屬【建模推論】 |
| 8 | 體育館 SPORT | 依 layout rect 30×20 px（≈ 60×40 m），2 層挑高 ≈ 14 m；≤ 3,000 | 淺弧屋面（矢高 2 m）、`roof.deck` | 下半磚、上半 `trim.cream` 帶狀高窗 | 入口雨遮、側邊戶外樓梯、外露排風罩 | 高窗、磚縫 | 【待查證：體育館實際形式、樓層】；layout 註明為示意位置 |
| 9 | 海科院 | 【待查證：量體、位置】；暫列 60×25，5F；≤ 3,000 | 平頂 | 臨海側加寬遮陽板 1.0 m（抗鹽霧的視覺理由） | 碼頭／小艇棚、海堤接續 | — | **無 placement**；campus-info.json 無此棟。位置應在蓮海路北段臨海側，先與研究者確認 |
| 10 | 學生活動中心 ACTIVITY | L 形 120×60，B1–6F，階梯狀；≤ 5,000 | 每 2 層退一階 3 m；露台遮陽棚 | 2F 餐廳層大面玻璃＋招牌（**原創店名色塊，不用真實商標**）；4–6F 密格窗 | 戶外直上 2F 大階梯、半圓形廣場（同心弧階 r 12 m、5 階）、機車停車場畫線 | 招牌、玻璃、窗格 | 6F、2F 餐廳／3F 演藝廳、半圓形廣場：已有來源；L 形與退階屬【建模推論】 |
| 11 | 西子灣沙灘會館＋海堤 | 會館 30×18，2F；≤ 3,000。海堤為模組：每段 6 m 長、女兒牆 1.1 m、每 1.8 m 一個 0.8 m 寬內凹座（蘿蔔坑）；每段 ≤ 300 | 會館 `roof.dark` 緩坡；海堤壓頂 `stone.portal` | 會館白牆 `#f5f1e6`＋木百葉；海堤外側消波塊 `#5c5e60` 群（InstancedMesh） | 蘿蔔坑（幾何，描邊會勾出鋸齒剪影）、沙灘遮陽傘、救生台、防波堤燈 | 木百葉、消波塊面 | 蘿蔔坑、海堤與校碑相鄰：已有來源；會館量體屬【待查證】；**無 placement** |

程序建築（EN、CH、PH、BI、MS、EV、EC、CM、SS、SW、IR 等）沿用 v2 §3 立面語言，另外三件改進：（a）1F 長廊必須有天花與地坪，不可以再是黑洞；（b）每棟隨機 1–2 面牆加一條垂直雨水管（`#8c9296`，幾何）與 3–6 台空調室外機（貼圖貼花）打破重複；（c）女兒牆內退 0.3 m 加一圈 `trim.cream` 壓頂，描邊會勾出屋頂輪廓。

---

## 6. 角色與 NPC

### 6.1 基底

- 使用 CC0 骨架化人物（Quaternius 系列，授權以實際下載包的 LICENSE 為準，入 repo 時把授權檔放 `public/assets/characters/LICENSE`）。比例目標：**約 4 頭身、身高 1.55 m**（比 v2 的 2.6 頭身拉長，才不會「積木」；比寫實矮，門高 2.1 m 的尺度感仍在）。
- 單一材質 toon；貼圖 256 px 色塊圖重畫（不用原包貼圖），眼睛兩點＋嘴一筆畫在貼圖上；描邊 `outline.char`。
- 骨架 ≤ 32 bones；需要的 clip：`Idle`（2.4 s loop，含呼吸）、`Walk`（0.9 s，步幅 0.7 m）、`Run`（0.6 s）、`Jump`（one-shot：蹲 0.15／空 0.4／落 0.2）、`Wave`、`Talk`（1.6 s loop，點頭＋手勢，NPC 對話用）、`Sit`。缺哪個就在 Blender 自己補，不假設下載包一定有。
- 落地壓扁：落地瞬間 root scale `(1.18, 0.82, 1.18)` 在 0.12 s 內 spring 回 `(1,1,1)`（stiffness 220、damping 14）；同時在腳下噴 6 顆塵土 billboard（`#e4d8c0`，0.4 s 內 scale 0.2→0.8、alpha 0.6→0）。
- 假陰影：腳下 r 0.45 m 柔邊圓 `#2a2c4a` alpha 0.22（取代截圖裡的硬邊黑塊），Tier C 唯一的陰影。

### 6.2 配色（NSYSU 調色盤 recolour）

| 角色 | 身分 | 髮 | 上身 | 下身 | 鞋 | 配件 |
|---|---|---|---|---|---|---|
| 阿海（可操作） | 海科系男生 | `#3b2a22` 亂髮 | 防風外套 `#2a8c99`、內搭白 | 米白短褲 `#efe6d1` | 橘拖鞋 `#f27a2c` | 浮潛鏡掛頸 |
| 小嵐（可操作） | 管院女生 | `#1f1a1a` 短髮＋髮夾 `#e04b3a` | 芥黃針織 `#d9a521` | 深藍百褶裙 `#173e49` | 白球鞋 | 筆電包 `#2a2c4a` |
| 阿拓（可操作） | 理工研究生 | `#2b2622` | 白袍開襟＋ `#7b4a8f` T | 灰褲 `#6b6f78` | 黑鞋 | 黑框眼鏡、背包 `#3f8f4c` |
| 阿灣（導覽學姊，見 story-draft-v3） | 海科系大三 | `#4a3326` 單馬尾 | 淺青外套 `#62c8d2`、內搭 `#fbf6ea` | 深藍工裝褲 `#2c4a6e` | 橘拖鞋 `#f27a2c` | 收起的傘（防猴兼防曬）、貼滿貼紙的水壺 `#e9b949` |
| 路人 NPC（6 款循環） | 學生 | 4 色隨機 | 上衣 8 色池：`#2a8c99 #2f5fa8 #d9a521 #7b4a8f #3d7a4a #e04b3a #fbf6ea #6b6f78` | 2 色：`#173e49 #efe6d1` | 2 色 | 30% 背包、15% 撐傘、10% 拿飲料 |
| 獼猴 | 壽山 | 身 `#7d6b5d`、腹 `#a89686`、臉臀 `#d97f76` | — | — | — | 三姿勢（坐、走、吊）＋ `Idle` 搔頭；全校 18 隻 |

路人 NPC 行為：沿 `nav.*` 路徑 0.9 m/s 走動，到端點停 2–6 s `Idle` 再折返；長廊與中庭各最多 8 人、全校 ≤ 36 人（同一 `SkinnedMesh` 不能 instance，手機 Tier C 減到 12 人）；離玩家 < 1.5 m 時播 `Wave` 一次（冷卻 20 s）。

### 6.3 相機

第三人稱跟隨：目標點 = 角色頭頂 +0.3 m；相機位置以 `pos += (target − pos) × (1 − exp(−dt × 6.5))` 指數阻尼；跑步時拉遠 0.6 m、FOV 55→60；進室內 FOV 回 55 並把距離縮到 2.6 m。相機與建築碰撞走 raycast 縮短距離，過渡 0.15 s。

---

## 7. UI 視覺語言（紙、墨、金）

總原則：遊戲內 UI 看起來像**貼在畫面上的紙卡**，有 2 px `--ui-line` 描邊和硬陰影，與場景描邊同語彙；不再用毛玻璃墨綠面板（`--walk-panel` 保留給 topbar 與設定，玩戲時的元件一律紙卡）。字體沿用 `Noto Sans TC`。所有元件 `position:fixed`，進場動畫走 `cubic-bezier(.2,.75,.3,1)`，手機最小字 15 px、觸控 44 px。

### 7.1 對話框 `.q-dialog`

```css
.q-dialog{position:fixed;left:50%;bottom:max(24px,env(safe-area-inset-bottom));transform:translateX(-50%);
 width:min(720px,calc(100vw - 32px));display:grid;grid-template-columns:96px 1fr;gap:16px;
 padding:16px 20px 18px;background:var(--ui-paper);color:var(--ui-ink);
 border:2px solid var(--ui-line);border-radius:var(--ui-radius);box-shadow:var(--ui-shadow);
 font-size:var(--fs-dialog);line-height:1.7;pointer-events:auto;
 animation:q-in .22s cubic-bezier(.2,.75,.3,1) both}
@keyframes q-in{from{opacity:0;transform:translate(-50%,12px)}}
.q-dialog .portrait{width:96px;height:96px;border-radius:14px;border:2px solid var(--ui-line);
 background:var(--ui-paper-2) url(portrait.svg) center/cover}   /* SVG 半身像，不即時渲染 3D */
.q-dialog .name{display:inline-block;margin-bottom:4px;padding:2px 10px;border-radius:999px;
 background:var(--ui-gold);color:var(--ui-ink);font-size:13px;font-weight:700;letter-spacing:1px}
.q-dialog .text{min-height:3.4em}                               /* 兩行高度，打字機 28 字/秒 */
.q-dialog .next{position:absolute;right:18px;bottom:10px;font-size:13px;color:var(--ui-ink-soft)}
.q-dialog .next::after{content:'▼';margin-left:6px;animation:q-bob 1s infinite}
@keyframes q-bob{50%{transform:translateY(3px)}}
@media (max-width:759px){.q-dialog{grid-template-columns:64px 1fr;font-size:var(--fs-dialog-mobile)}
 .q-dialog .portrait{width:64px;height:64px}}
```

行為：Space／點擊推進；打字中點擊直接顯示全句；選項（最多 3 個）以 `.q-choice` 列在文字下方，藥丸樣式、選中金底。

### 7.2 任務目標與箭頭

- 目標卡 `.q-objective`：`position:fixed;top:108px;left:28px;padding:10px 14px 10px 12px;background:var(--ui-paper);border:2px solid var(--ui-line);border-left:6px solid var(--ui-gold);border-radius:var(--ui-radius-sm);box-shadow:var(--ui-shadow);font-size:var(--fs-objective);font-weight:600`。左上小字「第 ③ 章・行政大樓」13 px `--ui-ink-soft`，下方目標文字 ≤ 16 字，右側距離「120 m」等寬數字。取代現有 `.walk-location` 的位置（`.walk-location` 下移 64 px）。
- 世界箭頭：角色頭頂前方 1.2 m 一個扁平金色箭頭（`#e9b949`，描邊 `--ui-line`，≤ 60 tris，`MeshBasicMaterial` 不受光），永遠指向目標的導航路徑下一個轉折點（用既有 `walk-nav` 路徑，不是直線），上下漂浮 0.08 m、yaw 以阻尼轉向；目標 < 6 m 時箭頭改成目標點上方的「光柱」（r 0.6 m、高 6 m、`AdditiveBlending`、alpha 0.35，bloom 會接手）。
- 螢幕邊緣指示：目標在畫面外時，在畫面邊緣 32 px 內顯示同色 2D 箭頭（SVG，24 px）。

### 7.3 區域名橫幅 `.q-banner`

進入新區域（校門、隧道口、中庭、理工區、圖資前、海堤）時出現一次（每區冷卻 90 s）：

```css
.q-banner{position:fixed;left:0;right:0;top:22vh;text-align:center;pointer-events:none;
 font-size:var(--fs-banner);font-weight:700;letter-spacing:6px;color:var(--ui-paper);
 text-shadow:0 0 0 #000, 2px 2px 0 var(--ui-line), -1px -1px 0 var(--ui-line), 0 6px 18px #1d2a3a66;
 animation:q-banner 2.6s cubic-bezier(.2,.75,.3,1) both}
.q-banner small{display:block;margin-top:6px;font-size:14px;letter-spacing:3px;color:var(--ui-gold)}
.q-banner::before,.q-banner::after{content:'';display:block;width:120px;height:2px;margin:10px auto;background:var(--ui-gold)}
@keyframes q-banner{0%{opacity:0;transform:translateY(10px);letter-spacing:12px}15%,75%{opacity:1;transform:none;letter-spacing:6px}100%{opacity:0}}
```

### 7.4 章節完成卡 `.q-chapter`

畫面中央 420×auto 紙卡，`border-radius:22px`，頂部 96 px 區塊放該章的原創 SVG 插圖（線稿＋兩色平塗，線色 `--ui-line`），標題 22 px／700「第 ③ 章完成」，副標 15 px，底部兩個按鈕（「下一章 →」金底、「先逛逛」紙底描邊）。進場：卡片 `scale(.92)→1` 0.28 s，同時從卡片中心噴 18 顆紙屑粒子（CSS，`--ui-gold`／`--ui-brick`／`--ui-sea` 三色，0.9 s 落下）；背景 vignette +0.1。章節進度在 topbar 右側以 6 個圓點顯示（完成金、目前描邊空心、未到 `--ui-paper-2`）。

### 7.5 既有元件調整

- 建築藥丸標籤：換成紙卡語彙（`--ui-paper` 底、`--ui-ink` 字、2 px `--ui-line` 描邊、學院色底線 3 px 保留），步行模式最多 3 個，鳥瞰最多 10 個；距離 > 300 m 不顯示。
- 故事寶石卡（`.walk-story`）：同 7.4 語彙，左側 96 px 原創 SVG 插圖；寶石本體改為金色八面體＋描邊，已收集變半透明。
- 歡迎畫面：左側面板改紙卡；三張角色卡各放 SVG 半身像；背景鳥瞰必須有海（§2）。

---

## 8. 避免清單

1. 不要在樹、草、海上用描邊或 rim；不要對 InstancedMesh 做反向外殼。
2. 不要讓 `renderer.toneMapping` 與後處理曲線同時開。
3. 不要用 `NearestFilter` 的 toon ramp（會變成硬邊三色卡通，與「原神感」相反）。
4. 不要有純黑：最深的顏色是 `outline.night #141a30`；陰影帶是染色，不是乘 0。
5. 不要放真實校徽、真實商標（全家、郵局、YouBike）；用原創色塊代替，形狀與配色可以「像」，字與圖樣不可以。
6. 不要做羅馬拱的理工長廊、不要幫圖資皇冠加上沒有來源的裝飾；不確定的做法先做素的，標【待查證】。
7. 不要再出現均勻亮窗的夜景；不要出現沒有天花的 1F。
8. 不要用照片貼圖；所有貼圖為手繪色塊或程序生成。
9. UI 不要毛玻璃＋深墨綠（遊戲中）；不要小於 13 px 的操作文字。
10. 手機不要嘗試跑兩層 bloom 或程序建築描邊；先保 30 fps。

---

## 9. 驗收（視覺）

每個里程碑重拍 `artifacts/` 同四個機位（welcome／walk／sunset／night）＋ 一個手機 walk，並記錄 `renderer.info.render.calls`、`triangles`、Tier。通過條件：鳥瞰 ≤ 900 draws、≤ 450k tris（含描邊外殼）；步行 Tier A ≥ 55 fps、Tier B ≥ 30 fps；夜景截圖中可數出至少 3 種窗亮度；夕陽截圖中海面高光帶與長陰影肉眼可辨；任一截圖沒有純黑像素區塊（直方圖 < 0.5%）。
