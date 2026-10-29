# 山海之間 v3 規格書

狀態：定稿前草案（S0）。來源決策：grill 共識，計畫檔 `~/.claude/plans/bubbly-seeking-wreath.md`。上一版交接：`handoffs/20261019-224500-campus-overhaul-complete.md`（基線 HEAD `ac41637`）。

## 1. 問題與目標

使用者回饋 v2「太簡陋」：人物不斷抖動、無法固定視角、校園與真實差很遠、沒有故事。v3 目標是達到 nccu100（政大 3D 校園）與淡海 3D 校園的完成度，並保留 v2 已驗收的理工八棟室內可走能力。

成功的樣子：
- 走路、撞牆、上下樓梯時人物不抖；相機穩定跟在背後，可鎖定。
- 從鳥瞰看，建築位置、道路、山海關係與官方校園平面圖一致；11 處地標一眼可認。
- 新生可以從校門一路玩完 6 章「新生導覽」，途中遇到 NPC、獼猴與校史支線。
- 首頁是新的互動校園地圖，可一鍵進入 3D。

不做：部署、室內擴充到理工以外、2D 房號搜尋與平面圖檢視、真實 GPS、攝影測量網格。

## 2. 根因（v2 已查證）

| # | 現象 | 位置 | v3 處置 |
|---|---|---|---|
| 1 | 擦牆時合併法線讓 `onGround` 失效 → 彈跳，Jump 動畫反覆 `reset()` | `walk-physics.ts:97-108`、`walkthrough.ts:116-117` | Rapier KCC＋snap-to-ground；動畫狀態機以「離地 > 0.15 s」才進 Jump |
| 2 | 陰影相機逐幀跟隨未對齊 texel | `walk-sky.ts:36` | 依 shadow texel 尺寸量化光源位置 |
| 3 | 第三人稱碰撞距離硬切、最小 0.15 m | `walkthrough.ts:121` | 相機臂阻尼：拉近快、放遠慢；最小 1.0 m，< 1.2 m 淡出角色 |
| 4 | 朝向逐幀瞬轉；動畫速度取自雜訊 | `walkthrough.ts:115-118` | 朝向依輸入方向以 `1-exp(-dt·12)` 平滑；速度取控制器意圖速度 |
| 5 | LOD 無遲滯 | `walk-lod.ts:179-187` | 進入／離開門檻分開（18/22 m、5.2/7 m） |
| 6 | 主執行緒重建碰撞頓挫 | `walk-collision.ts:49-92` | Rapier 啟動時建好分區 trimesh，不再逐區重建 |

## 3. 架構

### 3.1 模組邊界（新）

```
src/
  app/            entry.ts（路由：地圖首頁 ↔ 3D）、design-tokens.css
  map/            互動校園地圖（取代舊 2D）
  walk/
    runtime.ts    組裝與主迴圈（取代 walkthrough.ts 的閉包）
    input.ts      鍵盤、指標、搖桿 → InputState（純資料）
    controller.ts CharacterController 介面＋RapierController 實作
    camera-rig.ts 跟隨／鎖定／第一人稱／鳥瞰相機
    avatar.ts     角色模型、AnimationMixer 狀態機、朝向平滑
    interaction.ts E 鍵優先序（故事 NPC → 支線 → 電梯 → 門）
    hud.ts        DOM HUD、狀態訊息、提示列、世界座標互動提示
    debug.ts      window.campusWalk 驗收掛鉤
  render/
    toon.ts       ramp、rim 補丁、描邊
    post.ts       MSAA RT、雙層 bloom、調色、暈影
    quality.ts    自適應畫質
    batch.ts      chunk 靜態合批、prefab instancing
  world/          沿用 walk-world.ts、walk-art.ts、walk-lod.ts、walk-sky.ts（搬移並改接 toon）
    terrain.ts    DEM 高度圖、平台墊
    landmarks.ts  地標 GLB 載入與替換 OSM 擠出體
    npc.ts        NPC 生成、巡邏、活動
  story/
    engine.ts     任務引擎（條件、動作、進度存檔）
    schema.ts     chapters.json 型別與啟動驗證
    ui.ts         對話框、任務追蹤、任務箭頭、區域 banner、章節卡
  audio/
    sound.ts      WebAudio 環境音與音效，預設靜音
```

規則：
- `walk/runtime.ts` 只組裝；每個模組有 `update(dt)` 與 `dispose()`，不互相 import 對方內部狀態，靠 runtime 傳入。
- 模組之間只交換純資料或明確介面；`controller.ts` 不 import three 的場景物件以外的東西，方便 vitest。
- 沿用 `walk-world.ts`、`walk-nav.ts`、`walk-door.ts`、`walk-types.ts`、`walk-labels.ts`。`walk-physics.ts`／`walk-collision.ts` 在 T1 驗收通過後移除。

### 3.2 CharacterController 介面

```ts
interface CharacterController {
  readonly position: Vector3;        // 膠囊底部（腳底）
  readonly onGround: boolean;
  readonly velocity: Vector3;        // 實際位移速度（平滑前）
  readonly intendedSpeed: number;    // 輸入意圖速度，動畫用
  teleport(p: Vector3): void;
  step(direction: Vector3, dt: number, jump: boolean, speed: number): void;
  dispose(): void;
}
```

- 介面與 `WalkPhysics` 相容，讓 `tests/walk-manual.test.ts` 只換建構式。
- Rapier 實作：膠囊半徑 0.28、總高 1.7；`KinematicCharacterController(offset 0.02)`，`enableAutostep(0.35, 0.2, true)`、`enableSnapToGround(0.4)`、`setMaxSlopeClimbAngle(50°)`、`setMinSlopeSlideAngle(55°)`；固定步長 1/120 s 子步。
- 碰撞來源：`world.collision` 依 48 m 格分區轉成 trimesh collider，啟動時一次建立。門板不進碰撞，沿用 `walk-door.ts` 的方向修正。
- 地形（T3）以 heightfield 或 trimesh 加入。
- vitest：`await RAPIER.init()` 於 `beforeAll`。

### 3.3 相機 rig

| 模式 | 行為 |
|---|---|
| 跟隨（預設） | 目標點＝腳底 +1.45 m，以 `1-exp(-dt·10)` 阻尼；距離 4.5 m（滾輪 2.5–8 m）；拖曳轉 yaw/pitch，放開維持；行走時若玩家 1.5 s 未手動轉向，yaw 以 `1-exp(-dt·1.5)` 緩慢回到角色背後（可在設定關閉）。 |
| 鎖定（L） | 相機相對角色的 yaw、pitch、距離全部固定；拖曳無效；再按 L 解除。HUD 顯示鎖頭圖示。 |
| 第一人稱（V） | 眼高 1.55 m，拖曳或 pointer lock（點擊畫面進入，Esc 離開）。 |
| 鳥瞰（M） | OrbitControls（或 `camera-controls`），可在鳥瞰中按 WASD 平移視點，不再強制切回步行。 |

遮擋：從目標點對相機做 sphere-cast（Rapier `castShape`，半徑 0.2），命中則立即拉近到命中點 −0.25 m，無命中時以 `1-exp(-dt·3)` 放遠；最小距離 1.0 m；距離 < 1.2 m 時角色透明淡出。樹冠遮擋以 dither 淡出（材質 `alphaHash`）。

帶路時相機自動轉向改為時間制（`1-exp(-dt·2)`），可由設定關閉。

### 3.4 角色與動畫

- 角色：Quaternius CC0 骨架角色（或同等 CC0 包），3 位可選主角＋學生 NPC 換色；獼猴沿用 v2 GLB 並加骨架或保持剛體動畫。
- 狀態機：Idle／Walk／Run／Jump／Fall／Land／Wave／Talk。Jump 只在按下跳躍時播一次；離地 > 0.15 s 才進 Fall；落地播 Land（≤0.2 s）並做 squash 與塵土粒子。
- 動畫速度：以 `intendedSpeed` 與實際水平速度的較小值，平滑 `1-exp(-dt·8)`。
- 朝向：取輸入方向（相機座標轉世界），`1-exp(-dt·12)` 插值；後退時角色轉身走，不瞬轉 180°（插值處理）。

## 4. 渲染

- 材質：`MeshToonMaterial`＋256 px 柔和色階 ramp；`onBeforeCompile` 加 rim light（強度 0.35，顏色依時段）。
- 描邊：inverted hull（BackSide、沿法線外擴 0.02–0.04 m，依距離不變），**只套建築外殼、地標、角色、NPC**；樹木與道具不描邊。
- 後處理：MSAA 4× RenderTarget → 亮度門檻 → ½、¼ 解析度可分離高斯 bloom → 合成（飽和 ×1.1、陰影偏冷高光偏暖、柔和 tonemap、暈影）。數值以 `docs/reference/art-direction-v3.md` 為準。
- 自適應畫質 `quality.ts`：起始 DPR = min(devicePixelRatio, 觸控 1.5／桌機 2)；連續 2.5 s p50 幀時 > 33 ms 降一級：DPR −0.25（下限 0.75）→ 關 bloom → 陰影 PCF 1024 → 關陰影；10 s 穩定 < 20 ms 回升一級。
- 合批：靜態不透明單色網格依 48 m chunk 合併為頂點色幾何；重複道具（樹、燈、長椅）用 InstancedMesh。合批先於描邊與後處理完成。
- 陰影：光源位置量化到 shadow texel；步行時 shadow 範圍 ±70 m，鳥瞰 ±240 m。

## 5. 世界與地形

- 對位基準：官方全校平面圖 `https://www.nsysu.edu.tw/static/file/0/1000/img/440826181.jpg`（下載到 `data/sources/`，記 SHA256、日期、來源頁）＋OSM（ODbL）。學院平面圖參考 `https://oaa.nsysu.edu.tw/p/412-1003-27076.php?Lang=zh-tw` 與 `https://safety-oga.nsysu.edu.tw/p/405-1296-286323,c18978.php`。
- 對位工具：`tools/align_campus_map.py` 用 ≥6 個控制點（校門、行政大樓、圖資、理工、隧道口、體育館）求平面圖 ↔ 世界座標相似轉換，輸出殘差；外圍建築與道路位置以平面圖為準，OSM 輪廓為形狀來源。
- 地形：`tools/build_terrain.py` 讀 20 m DEM（data.gov.tw 165890 或 TGOS，若取不到或不含鼓山區則手工塑形並註明），產生 `public/data/terrain/heightmap.png`＋`terrain.json`（範圍、原點、高度比例、來源）。
  - 可走八棟與其入口外 6 m 的平台墊固定在現有 `floorY`，墊外以 12 m 平滑過渡到 DEM。
  - 壽山以 DEM 為主並加遠景山脊；海岸線、西子灣沙灘、海堤、防波堤依 OSM coastline。
- T3 完成後立即重跑 `npm run walk:bake` 與 `walk-manual`。

## 6. 地標（11 處）

| id | 名稱 | 可進入 |
|---|---|---|
| `admin` | 行政大樓 | 否 |
| `library` | 圖資大樓 | 否 |
| `liberal-arts` | 文學院 | 否 |
| `sci-eng-arcade` | 理工長廊外觀（照片確認為平頂紅磚柱廊；模組已建，本輪未替換既有程式化外殼） | 是（室內沿用程式化） |
| `tunnel` | 西子灣隧道口 | 可穿越 |
| `gate` | 校門＋校碑 | 可穿越 |
| `yatsen-hall` | 逸仙館 | 否 |
| `gym` | 體育館 | 否 |
| `marine` | 海科院 | 否 |
| `activity-center` | 學生活動中心 | 否 |
| `beach-house` | 西子灣沙灘會館／海堤 | 否（海堤可走） |

規格：
- `tools/create_landmarks.py`（Blender 4.5，`tools/blender-path.txt`），一棟一函式；每棟函式上方註明參考照片 URL（`docs/reference/landmarks/<id>.md`）。不擷取 Google 3D 網格。
- 位置、旋轉、比例由腳本讀 `public/data/walkthrough/campus-structure.json` placements 與對位結果產生，不手擺。
- 輸出 `public/models/landmarks/<id>.glb`（meshopt），每棟 ≤ 25k 三角形，材質 ≤ 4 個（磚、牆、玻璃、屋頂），窗戶以貼圖或頂點色呈現。
- 理工外觀 GLB 只是立面外殼：門洞對齊 `access-plan.json` 入口；碰撞維持程式化；驗收「每個入口從外走進去不穿模、不被外殼擋住」。
- 不可進入地標的碰撞用簡化盒（腳本同時輸出 `<id>.collision.json`）。
- 其他建築：程式化立面升級（屋頂型式、窗型節奏、拱廊、女兒牆、貼圖），沿用 OSM 輪廓。

## 7. NPC

- 學長姐嚮導（主線 NPC）、6–12 位學生 NPC（活動：走路、坐著讀書、講手機、揮手、跑步）、2–4 隻獼猴（在圖資大樓與文學院附近活動，靠近時提示「不要餵食」——此規則待查證後才寫）。
- NPC 沿預設路徑點巡邏，用簡單轉向與避讓玩家；不參與物理碰撞，只做半徑 0.4 m 的推開。
- 距離 > 60 m 停止 mixer 更新；> 120 m 隱藏。

## 8. 故事系統

### 8.1 資料（`public/data/chapters.json`）

```jsonc
{
  "version": 1,
  "guide": {"id":"guide","name":"…","model":"guide"},
  "chapters": [
    {
      "id": "c1-gate",
      "title": "校門報到",
      "zone": "gate",                       // 觸發區域 id（zones 定義於 world/zones.json）
      "objective": "到校門找學長姐報到",
      "start": {"when": [{"chapterDone":"prologue"}]},
      "steps": [
        {"id":"talk","when":[{"near":"npc:guide","r":3},{"press":"E"}],
         "then":[{"dialogue":"c1-talk"},{"setFlag":"c1.talked"}]},
        {"id":"done","when":[{"flag":"c1.talked"}],
         "then":[{"completeChapter":"c1-gate"},{"moveNpc":["guide","tunnel-north"]}]}
      ],
      "sources": ["https://…"]               // 本章用到的校史事實出處
    }
  ],
  "dialogues": {"c1-talk":[{"who":"guide","text":"…"}]},
  "sideQuests": [{"id":"story-…","fromCampusInfo":"<story id>"}]
}
```

- 條件：`near`、`press`、`flag`、`chapterDone`、`inZone`、`atDestination`（室內教室門口，接 `walk-nav` 帶路）、`timeOfDay`。
- 動作：`dialogue`、`setFlag`、`completeChapter`、`moveNpc`、`setObjective`、`showArrow`、`setSky`、`playSound`、`unlockSideQuest`。
- 啟動時以 `story/schema.ts` 驗證（未知條件或動作、懸空 id 即報錯並停用故事，不影響步行）。
- 進度存 `localStorage['nsysu-story-v3']`，讀寫皆 try/catch；提供「重新開始導覽」。

### 8.2 六章

①校門報到 ②穿過西子灣隧道 ③行政大樓辦手續 ④圖資大樓借書 ⑤理工長廊進室內找教室（SC2001，使用既有 3D 帶路） ⑥西子灣看夕陽（切換 sunset 預設）。台詞與章節細節以 `docs/reference/story-draft-v3.md`（Fable 初稿）為底，所有校史事實須在 `docs/reference/nsysu-history-v3.md`（Gemini 研究）有出處；無出處者刪除或改寫為非事實性台詞。

### 8.3 UI

對話框（底部、角色名、逐字顯示可跳過、E／點擊下一句）、任務追蹤（右上目標文字）、任務箭頭（世界座標地面箭頭＋畫面邊緣指示）、區域 banner（進入新區域時置中淡入 2 s）、章節完成卡（標題＋插畫色塊＋校史小知識）。v2 的 8 則故事轉為支線收集，保留寶石但改為「校史徽章」。

## 9. 互動校園地圖（首頁）

- 取代 `src/main.ts`、`scene.ts`、`layout.ts`、`buildings.ts`、`routing.ts` 與 `style.css` 的舊 2D 介面。
- 內容：風格化全校俯視（以 3D 場景正交俯視渲染一張底圖，或 SVG 由 OSM 與對位結果產生），建築分類篩選（教學、行政、生活、景點），點建築開資訊卡（`campus-info.json`），章節進度，「在 3D 帶我去」按鈕（以 URL 參數 `?walk=<buildingId>` 進入 3D 並自動帶路）。
- 移除 2D 房號搜尋與平面圖檢視介面；`public/data/rooms.json`、`floors.json` 等資料與 `tools/verify_data.py` 保留。
- `tools/verify_layout.py` 驗 `src/world-layout.json`：若 `world-layout.json` 隨舊介面移除，build 腳本同步移除該步驟並在 README 記錄。
- 3D 內保留房號搜尋＋自動帶路（第 5 章使用）。

## 10. 音效

- WebAudio 合成為主（海浪噪音濾波、蟬鳴、腳步依地面材質、任務完成和弦、對話提示），必要時用 CC0 音檔並記錄授權。
- 預設靜音，HUD 喇叭鈕切換，狀態存 localStorage。

## 11. 效能預算

| 項目 | 桌機 | 手機模式 |
|---|---|---|
| Draw calls（步行，理工區） | < 400 | < 300 |
| 三角形 | < 1.2 M | < 600 k |
| 首次可互動 | < 6 s（本機） | — |
| 新增資源總量 | 地標 GLB 合計 < 6 MB；角色＋NPC < 4 MB |

## 12. 驗收標準

1. `npx vitest run` 全過，新增：
   - 斜向撞牆、沿牆走、柱間穿行、上下樓梯各 120 步：y 抖動 < 1 mm（平地段）、`onGround` 不中斷、無 Jump 狀態。
   - 相機臂：沿牆走 300 幀，相機距離逐幀變化 < 0.15 m（拉近除外的單調性檢查）。
   - 移植後 `walk-manual`：877/877 房、樓梯、跨棟、電梯、E 選門 0 錯誤。
   - `story/schema.ts` 對 `chapters.json` 驗證通過；引擎單元測試涵蓋每種條件與動作。
2. Playwright：6 章主線自動通關腳本（以真實輸入路徑與帶路，不瞬移）；`walk:qa` 真鍵鼠；逐幀記錄 y、相機位置無振盪（頻譜或符號變化次數門檻）。
3. `npm run build` 通過。
4. 截圖：桌機／手機各模式；地標與參考照片並排 `artifacts/v3/comparison/`；鳥瞰 vs 官方平面圖疊圖。
5. 效能符合第 11 節，stats JSON 存證。
6. GPT-6 code review 與 Fable 美術審查後無未處理 P1。

限制照實記錄：SwiftShader 軟體渲染非真手機 GPU；地標為依照片示意建模；DEM 精度 20 m。

## 13. 工具與授權

- 新增 npm：`@dimforge/rapier3d-compat@0.21.0`（2026-09-25 發布）。
- 外部素材：CC0 角色包（下載至獨立目錄，授權記錄 `docs/licenses.md`）、DEM（政府資料開放授權）、官方平面圖（僅作對位參考，不再散佈原圖於網站，除非已確認可公開）。

## 14. GPT-6 spec 審查修正（job `b5b2f807-fb07-4d91-915b-7b4bd20a83ec`）

以下條文優先於前文衝突處。

### 14.1 全校帶路（P1-1）
- Recast navmesh 維持只涵蓋理工區（全校 bake 已知失敗）。新增**室外路網圖**：`tools/build_outdoor_graph.py` 由 OSM 道路／步道＋對位後的手動補邊產生 `public/data/walkthrough/outdoor-graph.json`（節點 [x,y,z]、邊、地標入口節點）。`src/walk/route.ts` 以 A* 在路網找路；目的地在理工區時，路網終點接到 navmesh 範圍內的接合節點，再交給 Recast。
- 每個地標與章節目標有 `entranceNode`；六章所有路段由 T3 驗收以控制器實走（不瞬移）。

### 14.2 地形與舊地板（P1-2）
- T3 以地形網格**取代** `walk-world.ts` 的 `CAMPUS_GROUND` 平地（顯示與碰撞皆換）；地形網格保留地下樓梯開孔（沿用 `groundHoles`）。理工八棟平台墊（含入口外 6 m）高度＝0（現有 `floorY(1)` 地面），墊外 12 m 線性→平滑過渡；地形高度以 1 m 解析度重取樣，坡度上限 35°（陡於此只出現在不可走的壽山遠景，另設不可走邊界）。
- 渲染、Rapier 碰撞、Recast bake 共用同一份 `public/data/terrain/terrain.bin`，其 SHA256 記錄在 `terrain.json` 並由 `walk:verify` 檢查。DEM 垂直基準（TWVD2001）換算為「理工地面＝0」的相對高度。

### 14.3 控制器細節（P1-3）
- 已實作於 `src/walk/controller.ts`：子步 1/120 s；重力 24 m/s²、跳躍初速 6 m/s；接地時每子步帶 −1 m/s 垂直意圖讓 snap 生效；ceiling 命中歸零上升速度；`teleport` 直接設定 collider 位置（KCC 每次查詢以當下 collider 位置計算）。
- 坡度：爬坡 50°、滑落 55°，皆以弧度設定；Recast `walkableSlopeAngle` 為 45°，因此任何 navmesh 路段控制器都能走。測試涵蓋實際梯坡、平台接縫、樓層邊護欄。

### 14.4 相機最小距離（P1-4）
- 碰撞安全優先：命中時相機距離可低於 1 m（下限 0.35 m），低於 1.2 m 起角色淡出、低於 0.6 m 隱藏。sphere-cast 從目標點出發、排除玩家 collider；初始即重疊時直接採最小距離。阻尼後的距離再以本幀命中距離截斷，確保永不穿牆。

### 14.5 舊 2D 遷移清單（P1-5）
T7 必須一次處理：`index.html` 入口改 `src/app/entry.ts`；移除 `src/main.ts`、`scene.ts`、`layout.ts`、`buildings.ts`、`routing.ts`、`types.ts`（如無他人使用）、`style.css`、`src/world-layout.json`；移除 `tests/routing.test.ts`、`tools/verify_layout.py` 與 `package.json` 的 `data:layout`、build 中對應步驟、`tools/browser_qa.py`（舊 2D QA）；保留 `tools/verify_data.py`、`public/data/*` 與 `data/sources/`。README 記錄淘汰項與替代覆蓋（新地圖 Playwright QA）。執行前以 `grep` 確認無其他引用。

### 14.6 驗收 harness（P1-6）
- `tests/walk-manual.test.ts` 改用 `RapierController`，移除 `WalkCollisionIndex` 與 `collision.update()`；門控制流程抽到 `src/walk/doors.ts`，runtime 與測試共用同一函式。舊 `walk-physics.ts`、`walk-collision.ts` 與其測試在新 harness 全過後才刪。

### 14.7 門（P2-7）
- `RapierController.step` 接受選用 `constrain(position, delta)` 回呼，**每個子步**在 KCC 計算前修正位移；門禁約束（`slidePastClosedDoor` 的子步版）透過它作用，涵蓋滑牆、奔跑、跳躍。測試加斜向擦門、奔跑撞門、關門佔位。

### 14.8 碰撞分區（P2-8）
- 三角形依重心分到 48 m 格，不裁切；任一邊 > 48 m 的大三角形放入獨立的 `large` collider；單一 collider 上限 60k 三角形，超出再切分。記錄初始化時間與 collider 數於 `campusWalk.physicsStats`。

### 14.9 合批與描邊（P2-9）
- 合批鍵＝(chunk, 材質, LOD 群組, outline 資格)；描邊只用於「外殼／地標／角色」群組；外殼用平滑法線副本產生描邊，skinned 角色描邊使用同一 skeleton。驗收檢查室內不漏描邊、硬邊無裂縫。

### 14.10 效能量測（P2-10）
- 固定配置：桌機 1440×900、手機 390×844 DPR 3 模擬；路線＝出生點沿理工長廊走 60 s；統計所有 render passes 的 calls／triangles 加總；p95 幀時門檻（SwiftShader 參考值，記錄但不作為真機承諾）。
- MSAA 降級 4→2→0，先檢查 `renderer.capabilities.maxSamples`。
- 相機振盪門檻：平地直走 5 s 內相機距離二階差分符號變化 ≤ 4 次。接地測試排除跳躍與合法落差。

### 14.12 T1 實作後修訂
- 自動回正：WASD 以相機為基準，若手動行走時相機自動轉到角色背後會造成繞圈，故**只在自動帶路時**回正（`1-exp(-dt·2)`）；手動行走相機永不自行轉動（瀏覽器 QA 量測 yaw 變化 0）。
- 抖動門檻：控制器原始接觸雜訊 ≤ 2 mm（vitest），角色視覺高度經 `avatar.ts` 平滑後 < 1 mm；瀏覽器以「> 0.5 mm 的上下反轉次數 ≤ 1」判定，緩坡與路緣為單調變化不計。
- 控制器：每子步水平與垂直分兩次 KCC 查詢（牆面接觸不會吞掉地面支撐）；水平只往坡上瞄準、不往下；autostep 失效（牆角旁路緣）時以「抬升 0.3 m—平移—落下」備援。

### 14.11 依賴與故事語意（P2-11）
- 依賴：T1 介面 → T2、T5；T3 座標與地形 → T4 → 最終碰撞與導航 → T6、T7；T8 接 story/runtime 事件介面；T9 整合。
- 參考文件責任：`docs/reference/nsysu-history-v3.md`（Gemini 研究，Opus 整理）、`docs/reference/story-draft-v3.md`、`docs/reference/art-direction-v3.md`（Fable）。
- 故事語意：初始章節 `c1-gate` 在新存檔時自動開始；`when` 陣列為 AND，`{"any":[…]}` 表 OR；每個 step 只觸發一次（完成後記錄於進度）；`dialogue` 動作阻塞後續動作直到對話結束；章節完成後自動開始下一章。

### 14.13 實作後修訂（T3–T9）
- 官方平面圖為示意插畫，對位 LOO RMS 47.7 m，無任何建築修正達顯著門檻：位置以 OSM 為準（取代 §5「外圍以平面圖為準」）。
- 校門採平面圖對位 (-84, 596)±40 m；OSM 節點「國立中山大學校門」在 (-28, 726)，超出 DEM 範圍，待確認。
- 平台墊外地形為 DEM（顯示＋碰撞），墊內保留原地面與地下樓梯開口；隧道口以 carve 挖除地形，由地標碰撞提供可走地面。
- 理工長廊：照片確認為平頂柱廊；GLB 模組已建，但未替換既有可走建築外殼（避免影響 877 房驗收），列為後續。
- 故事：step 動作全部完成才提交；NPC 位置持久化；新增 G／點任務卡自動前往。
