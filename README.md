網站：[山海之間 · 中山校園導覽](https://phonchi.github.io/nsysu-campus/)

> 公開快照的內容範圍、建置與驗證說明請見 [PUBLICATION.md](PUBLICATION.md)。完整本機驗證輸出未上傳。

# 山海之間 · 中山校園導覽

國立中山大學的互動校園地圖＋可步行 3D 校園。首頁是依開放圖資與真實地形繪製的校園地圖；按「走進 3D 校園」或「開始導覽」進入 3D，跟著學姊阿灣完成六章「新生導覽」：校門報到 → 西子灣隧道 → 行政大樓 → 圖資大樓 → 理工長廊進室內找 SC2001 → 海堤看夕陽。

- 理工八棟（SC、EN、BI、PH、CH、EC、MS、EV，60 層、877 間房）可走進室內，含樓梯、電梯與跨棟走廊。
- 11 處地標依實景照片以 Blender 手工建模（行政大樓、圖資大樓、文學院、西子灣隧道、校門校碑、海堤、逸仙館、體育館、海科院、活動中心、沙灘會館）；其餘建築依 OpenStreetMap 輪廓生成。
- 地形為內政部 20 m 數值地形模型（壽山、海岸、西子灣）。
- v4：Blender 自製的卡通大學生主角（男／女、6 組配色、暱稱）；20 位可搭話的師生、店員、警衛、志工與獼猴，分支對話以視覺小說式對話框呈現；集章、成就、拍照模式；三個小遊戲（海堤夕照、獼猴小偷追逐、校史問答）；依時段變化的 NPC 作息與校園事件；校門租腳踏車、章節間搭校園公車直達；葉片卡樹冠、草叢、依地形水深的海面、雲層與立面變化。

## v6 接地、騎乘與校園手帳

v6 修正道路／標線與地形不同高、坡下隱形平板、洞內植被、導航線、騎姿握把／踏板及坡面鞋底；導航已依新版表面重建。實際數值、畫面、覆蓋限制與原始失敗見 `artifacts/v6/verification.md`。

按 **J** 或 Esc 選單開啟校園手帳：接受／追蹤 12 條支線，查看事件經過與人物見聞；G 前往目前追蹤目標，靠近按 E 互動；重疊目標可按 R 或點選提示切換，提示與 E 共用同一目標。拍照任務需用 P 開啟相機、Space 真正拍照，快門當刻須符合任務地點與時段。任務、選擇與紀念章保存在本機瀏覽器。

六類隨機偶遇包含猴子搶點心、偷帽子、風吹傳單、滾球、臨時合奏與合照。可參與或放棄；猴子只搶事件專用物品，不扣既有收藏。偶遇不在主線對話、手帳、遊戲或自動帶路期間插入。

重開主線保留收藏和手帳；清除全部進度另需確認。實作範圍見 `docs/spec-v5.md`，初版驗證見 `artifacts/v5/verification.md`；Fable／Opus 審查後的修正、實際驗證與限制見 `artifacts/v5-fixes/verification.md`。

地標可從首頁搜尋「校碑」或「行政大樓」，進入 3D 後可用資訊卡「查看全貌」辨識完整模型。隧道到達時會面向入口，可沿洞內通道走至另一端。

## 操作

| 按鍵 | 功能 |
|---|---|
| WASD／方向鍵 | 移動（相對於相機方向） |
| Shift | 奔跑 |
| Space | 跳躍；對話中為下一句；拍照模式為快門 |
| E | 互動：故事 → 小遊戲 → 租車 → NPC 交談 → 地標資訊 → 電梯 → 開關門 |
| 1–4／↑↓ | 對話選項；L 對話紀錄；Tab 快轉 |
| B | 上下腳踏車（先在校門旁租車點按 E 租） |
| G／點任務卡 | 自動走（或騎車）到目前任務地點，卡住時自動改道 |
| P | 拍照模式（拖曳轉、滾輪遠近、WASD 移鏡頭、Space 拍照存 PNG） |
| J | 校園手帳：支線任務、事件經過、人物見聞（選單內也可開啟） |
| R | 切換同位置的互動目標，手機可點提示切換 |
| L | 鎖定視角（角度與距離完全固定） |
| V | 第一人稱（點畫面鎖定滑鼠，Esc 解除） |
| M | 鳥瞰 |
| N | 時段：白天／西子灣夕陽／夜晚（NPC 依時段換位置） |
| Esc | 選單：搜尋教室、視角與時段、校園地圖、集章冊與成就、換角色、操作說明 |
| / | 搜尋教室（如 SC2001），自動帶路 |

手機：左下搖桿移動、右側拖曳轉頭、按鈕奔跑／互動／騎車／跳躍；對話選項直接點選。音效預設關閉，可在右上角開啟。章節完成卡可選「搭校園公車直達」下一站。

## 本機執行

需要 Node.js 22.12 以上（本機以 Node 24 驗證）。

```sh
npm ci
npm run dev        # 開啟終端機顯示的網址
npm test           # vitest（含 877 房實走驗收，約 2 分鐘）
npm run build      # 資料完整性、步行資料、故事資料、tsc、Vite
```

瀏覽網站不需 API key、帳號或付費服務；圖資、字型（Noto Sans TC 子集，OFL）、校徽均由本機提供。`?quality=A|B|C` 可強制畫質等級（預設依裝置自動並在掉幀時降級）。

## 架構

| 目錄 | 內容 |
|---|---|
| `src/app/` | 入口：地圖首頁，`?view=walk[&target=ID][&story=1]` 開啟 3D |
| `src/map/` | 互動校園地圖（SVG＋DEM 底圖） |
| `src/walk/` | 步行執行層：Rapier 角色控制器、相機 rig、角色動畫、輸入、互動、路線規劃 |
| `src/render/` | 柔和卡通渲染：toon ramp＋rim、描邊、後處理（bloom／調色／暈影）、畫質分級、合批；v4 葉片卡樹冠、草地與草叢、依水深的海面、雲 |
| `src/world/` | 地形、地標、NPC（資料驅動、作息、可見上限）、主線沿線道具 |
| `src/story/` | 故事引擎、NPC 對話樹（`dialogue.ts`）、視覺小說對話框與立繪、收集／集章／成就、與 3D 世界的整合 |
| `src/games/` | 拍照模式、三個小遊戲（海堤夕照、獼猴追逐、校史問答） |
| `src/audio/` | WebAudio 合成環境音與音效 |
| `src/walk-*.ts` | 世界建構（樓層、樓梯、電梯、門）、美術裝飾、LOD、天空 |

規格與決策：`docs/spec-v4.md`（含 GPT-6 審查修正 §15）、`docs/tickets-v4/`；v3：`docs/spec-v3.md`、`docs/tickets-v3/`。v4 美術方向與 NPC 名單：`docs/reference/art-direction-v4.md`、`npc-cast-v4.md`；參考研究：`docs/reference/v4-research-gemini.md`。美術與故事：`docs/reference/art-direction-v3.md`、`story-draft-v3.md`；校史查證表：`docs/reference/nsysu-history-v3.md`；地標照片研究：`docs/reference/landmarks/`。

## 資料管線

```sh
python3 tools/build_terrain.py          # DEM → public/data/terrain/
python3 tools/build_outdoor_graph.py    # OSM 步道 → public/data/walkthrough/outdoor-graph.json
python3 tools/align_campus_map.py       # 官方平面圖對位報告（artifacts/v3/T3/）
npx tsx tools/bake_walk_nav.ts          # Recast 導航（輸入含地形，雜湊鎖定）
python3 tools/build_map_base.py && npx tsx tools/build_campus_map.ts   # 地圖底圖與資料
python3 tools/build_font_subset.py      # 新增文案後重做字型子集
"$(cat tools/blender-path.txt)" --background --python tools/create_landmarks.py        # 地標 GLB
"$(cat tools/blender-path.txt)" --background --python tools/create_student_v4.py      # 學生主角與 NPC 原型 GLB
"$(cat tools/blender-path.txt)" --background --python tools/create_props_v4.py        # 主線沿線道具 GLB
python3 tools/verify_chapters.py        # 故事資料檢查
npx tsx tools/verify_dialogue.ts        # NPC 對話樹、集章、成就、題庫檢查（題目只能出自查證表 ✅ 列）
```

## 驗收（v4，2026-10-20，均實際執行）

| 項目 | 結果 | 證據 |
|---|---|---|
| 六章新生導覽，瀏覽器只用玩家輸入（G 自動前往、E、按鈕；從校門開始） | 6/6，15.3 分鐘 | `artifacts/v3/T9/story-playthrough.json`（`tools/story_playthrough_qa.py`） |
| v4 玩法（換角色、19 位 NPC 搭話、三個小遊戲經主持 NPC 過關、拍照存 PNG、章戳 ≥ 3、成就 ≥ 3、三時段作息就位） | 30/30 | `artifacts/v4/U9/play-qa.json`（`tools/v4_play_qa.py`） |
| NPC 對話資料（DAG、邊、旗標命名空間、題目只出自 ✅ 列、字型涵蓋）＋全部分支可走完 | 20 位 NPC、19 棵樹、20 章戳、14 成就、14 題；0 錯誤 | `tools/verify_dialogue.ts`、`tests/dialogue.test.ts` |
| vitest | 59/59（含 877 房實走、六章物理實走、NPC 位置所有權） | `npm test` |
| 手感（真鍵盤：不彈跳、不離地、相機不自轉、L 鎖定） | 24/24 | `artifacts/v3/T1/walk-feel.json` |
| 真鍵鼠自動帶路上樓、開門進 SC2001 | 10/10 | `artifacts/campus-walkthrough-qa.json` |
| 互動校園地圖（桌機＋390×844） | 16/16 | `artifacts/v3/T7/campus-map-qa.json` |
| 效能（含陰影等所有 pass） | 桌機步行 104–363 draw calls、0.60–1.46 M 三角形；鳥瞰 315／1.22 M；手機 B 94／0.66 M、C 49／0.38 M（硬門檻 < 500 calls、A < 1.6 M） | `artifacts/v4/screens/stats.json` |
| 截圖與 v3 並排 | 12 組同機位對照＋v4 地點、對話框、選單、集章冊、手機對話 | `artifacts/v4/comparison/`、`artifacts/v4/screens/` |
| 審查 | GPT-6 spec（6 P1 全處置）與 code review（無 P1，11 項全修）、Fable 美術審查（夜晚／夕陽回歸已修，其餘處置見檔）、Gemini 事實查核（1 項修正） | `reviews/results/40-*`～`43-*` |

v3 的驗收結果見 git 歷史（`627d504` 的 README）。

## 限制與已知差異

- 全部效能數字來自 SwiftShader 軟體渲染，非真機 GPU 認證。
- 官方校園平面圖為示意插畫（對位 LOO RMS 47.7 m），建築位置以 OSM 為準；校門位置採平面圖對位（±40 m），與 OSM「校門」節點相差約 140 m，待現地確認。
- 理工八棟的室內樓層高度沿用平地假設；電資大樓實際在坡上（約 +24 m），旁邊山坡因此較陡。
- 理工長廊依照片為平頂柱廊（半圓拱廊在文學院）；地標細部、樓梯梯段、電梯位置為示意。
- 文學院位置以藝術大樓推估（±60 m）；隧道依既有 OSM 中心線提供約 273 m 可通行示意段，兩端各有 8 m 接地銜接；非現地測繪保證。
- 故事只使用查得到一手來源的校史；查證表中 ❌ 的說法不出現在網站。NPC 台詞、題庫與集章說明經 Gemini 事實查核（`reviews/results/42-*`）。店家、社團與 NPC 皆為原創虛構。
- v5 道具與樹幹加入簡化碰撞，室內既有 navmesh 另搭配共用障礙繞行層；碰撞採簡化體，並非逐三角形貼合外觀。
- 腳踏車採步行膠囊接地加水平車身膠囊掃掠，騎乘時不能跳，狹窄處提示下車，進建築或上樓自動停車。
- 理工長廊 1F 的夜間亮板與白天實心填充、海岸地形的三角硬邊、遠景無窗量體沿用 v3（Fable 審查 `reviews/results/43-*` 已記錄）；海堤「蘿蔔坑」座位與沙灘乾濕、路緣石未做。
- 執行中自動降級只調整草叢與雲；樹的葉片密度與道具組合在載入時依初始畫質決定。
- 官方樓層平面圖與校園平面圖不在網站上提供（只保留於 `data/official-plans/` 作為房間資料來源，不會發布）。

## 授權

地圖資料 © OpenStreetMap contributors（ODbL）；地形：內政部 20 m DTM（政府資料開放授權條款 v1.0）；角色骨架與基礎動作：Quaternius Animated Men/Women（CC0，`docs/licenses.md`），v4 角色網格、貼圖、立繪、道具與地標皆由本專案程式生成；字型：Noto Sans TC（OFL）。未使用照片。
