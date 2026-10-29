# 山海之間 v4 規格書

狀態：草案（S0），待 GPT-6 審查。基線：v3 HEAD `627d504`（`handoffs/*-campus-v3-complete.md`）。決策來源：v4 grill 共識，計畫檔 `~/.claude/plans/bubbly-seeking-wreath.md`。

參考：美術方向 `docs/reference/art-direction-v4.md`（Fable）、NPC 名單與對話樹初稿 `docs/reference/npc-cast-v4.md`（Fable）、技術與校園生活研究 `docs/reference/v4-research-gemini.md`（Gemini）、已查證校史 `docs/reference/nsysu-history-v3.md`。

## 1. 問題與目標

使用者看過 v3 後仍覺得簡陋，指出四點：NPC 與互動太少、畫面美術與光影、內容與玩法、建築與場景細節；並要求「美術參考其他網站再加強」「主角要像學生」「增加 NPC 互動並要有對話框」。

成功的樣子：
- 截圖與 v3 並排時，草地、樹、立面、小物、光影一眼看出升級；主線沿線近看有細節。
- 主角是一眼看得出的卡通大學生（男／女可選、可換色、有暱稱）。
- 校園裡有 15–20 位可以搭話的人，對話有選項，選項會留下後果（支線、收集品、之後台詞改變）。
- 除了六章主線，還有集章、成就、拍照模式、三個小遊戲、依時段變化的 NPC 作息與校園事件。
- HUD 精簡、不重疊；功能收進 Esc 選單。

不做：部署與 push、新的室內區域、好感度數值、LLM 對話、真人照片。

## 2. 現況（v3 截圖證據）

| 問題 | 證據 | v4 處置 |
|---|---|---|
| 草地單色大平面 | `artifacts/v3/T9/screens/desktop-day-admin.png` | §4.2 草叢＋地面材質變化 |
| 樹為粗糙低多邊形球 | 同上、`chapter-4.png` | §4.1 葉片卡片樹冠 |
| 紅磚立面重複、無凹凸 | `chapter-4.png` | §4.4 立面層次 |
| 小物稀少 | `desktop-day-admin.png` | §5 主線沿線小物 |
| 主角像成人 | `desktop-day-admin.png` 前景角色 | §6 學生主角 |
| 5 位 NPC、單線對話、路人不能搭話 | `src/story/ui.ts`、`public/data/story-zones.json` | §7、§8 |
| HUD 擁擠、資訊卡疊在章節卡下 | `chapter-4.png` | §10 |

## 3. 架構變更

```
src/
  render/
    foliage.ts     新：葉片卡片樹冠（球化法線、風擺、instanced）、草叢
    ground.ts      新：地面材質（草地變化、鋪面、沙灘）shader 混色
    ao.ts          新：A 級 SSAO（N8AO）或停用；B/C 用烘焙頂點 AO
    toon.ts        擴充：角色臉部陰影、頭髮高光（matcap 帶）
  world/
    props.ts       新：主線沿線小物佈置（資料驅動，instanced）
    npc.ts         擴充：NPC 資料表、作息、可搭話、事件演出
  story/
    schema.ts      擴充：對話樹、條件、效果
    dialogue.ts    新：對話樹執行器（純邏輯，可測）
    ui.ts          重寫：視覺小說對話框、選項、紀錄、略過
    portraits.ts   新：程序化 SVG 半身立繪＋表情差分
    collection.ts  新：收集品、集章、成就、進度儲存
  games/
    photo.ts       新：拍照模式＋海堤夕陽拍照任務
    macaque.ts     新：獼猴小偷追逐
    quiz.ts        新：校史問答
  walk/
    hud.ts         重寫：精簡 HUD、Esc 選單、彈窗佇列
    avatar.ts      擴充：主角換色、暱稱
public/data/
  npcs.json        新：NPC 名單、位置、作息、對話樹
  collection.json  新：收集品、集章點、成就定義
  quiz.json        新：題庫（每題附 nsysu-history-v3 列號與來源 URL）
  props-v4.json    新：主線沿線小物佈置
public/models/
  characters/student-m.glb, student-f.glb   新主角
  props/*.glb                               新小物
tools/
  create_student_v4.py   Blender：學生主角
  create_props_v4.py     Blender：小物
  verify_dialogue.py     對話樹靜態檢查
```

`runtime.ts` 只做組裝；新功能透過小介面接入（`StoryWorld` 模式），不擴大主迴圈。

## 4. 渲染與美術（依 art-direction-v4.md）

### 4.1 樹
- 樹冠：每棵 3–6 團葉片卡片叢（每團 12–24 張十字交叉的 alpha-test 葉片面），頂點法線改為「指向該團中心」的球化法線，toon ramp 呈現體積。
- 風擺：頂點著色器以世界座標相位的正弦＋高度權重位移，振幅 ≤ 0.12 m。
- 種類：校園闊葉（4 色＋每棵色彩抖動）、鳳凰木（夏季紅花點綴，可關）、海岸椰子／欖仁、山坡遠樹沿用簡化團塊。
- 合批：每種一個 `InstancedMesh`（樹幹一個），合計 ≤ 12 draw calls；遠樹（> 140 m）用現有低面數團塊。
- 陰影：校園樹投影，山坡樹不投影。

### 4.2 草與地面
- 草叢：3–4 頂點草葉 instanced，分 32 m 區塊，只在玩家 60 m 內生成／顯示；頂點高度在 35–55 m 漸縮至 0；顏色採地面色＋根部暗、頂部亮。A 級密度 100%，B 50%，C 關閉。
- 地面：草地 shader 混兩組尺度噪聲（3 m、25 m）與兩色（`grass.a`、`grass.b`），步道邊緣 0.4 m 土色過渡；鋪面依區域改用磚紋（行政前廣場、長廊）或洗石子；沙灘乾濕兩色。
- 貼圖：程序生成（沿用 `patternTexture`），不引入外部貼圖；若改用 CC0（ambientCG／Poly Haven）須記入 `docs/licenses.md`。

### 4.3 AO 與接觸陰影
- A 級：N8AO（`n8ao`，半解析度）接入 `post.ts`；量測幀時間，SwiftShader 下超出預算即預設關閉並記錄。
- 所有級：建築與地標頂點 AO（牆腳 0.7、簷下 0.8，已有樹冠 AO 沿用）；角色與小物腳下圓形接觸陰影貼片（不投即時陰影的 B/C 必要）。

### 4.4 立面
- 紅磚：材質加入大尺度色彩噪聲（約 15 m）與牆腳污漬漸層；每層白色腰帶與窗台凸出 0.12–0.18 m；窗戶內凹（窗框幾何＋暗色玻璃反射帶）。
- 主線地標近看：行政大樓、圖資大樓、理工長廊加招牌、雨遮、冷氣室外機、排水管等細部（Blender 或程序生成）。

### 4.5 天空、雲、海
- 雲：2–3 層程序雲片（billboard 群組，instanced），隨時段變色。
- 海：岸線泡沫改為依「水深＝海面高－地形高」的雙帶泡沫（不需深度貼圖），噪聲擾動；夕陽時太陽方位的金色反光帶。

### 4.6 角色著色
- 臉：臉部材質不受曲面法線影響，只用光源與頭部朝向的夾角決定亮暗（簡化版 Genshin 臉部陰影），避免臉上破碎陰影。
- 頭髮：view-space 法線的橫向高光帶（天使環）。
- 描邊沿用 inverted hull（`_OUTLINENORMAL`）。

## 5. 主線沿線場景精修

六個地點（校門、隧道口、行政大樓前廣場、圖資大樓前、理工長廊、海堤）各自一份小物清單（數量與優先級見 art-direction-v4.md）：路燈、長椅、腳踏車與車架、告示牌與社團海報、花圃、垃圾桶與資源回收、販賣機、校園公車站牌（橘 1／校巴站名依研究資料）、機車停車格、消防栓、交通錐、海堤欄杆與「蘿蔔坑」座位。佈置寫在 `public/data/props-v4.json`（位置、朝向、種類），由 `src/world/props.ts` 以 instancing 生成，並加入碰撞（長椅、販賣機、腳踏車為 box collider；草與花不碰撞）。

驗收：每個地點近景截圖可數出 ≥ 6 種小物；新增碰撞不擋住任何自動帶路路線（`story-walk` 測試、`validateRoutes` 被移除的邊數不增加超過 5%）。

## 6. 學生主角

- `tools/create_student_v4.py`（Blender 4.5）：身體以骨架形狀建立 Skin modifier 基礎網格，比例約 5.5–6 頭身；服裝分層（T 恤或外套、長褲或短裙／褲、球鞋、襪）為身體外殼；後背包（掛 spine 骨）、髮型為多片髮束外殼（男：短翹；女：及肩或馬尾）；臉為貼圖（動漫風大眼、眉、口，不同表情供立繪參考）。
- 骨架：沿用 v3 角色的 Quaternius 骨架與動畫（`create_characters_v3.py` 的 `build_clips`），以 automatic weights 綁定；輸出 `public/models/characters/student-m.glb`、`student-f.glb`（meshopt）。
- 換色：衣服、褲、包、髮色走 atlas 色塊 → 執行期以材質 uniform 換色（不重載模型）。
- 開場選角：現有 `.walk-chars` 改成男／女＋3 組配色＋暱稱輸入（1–8 字，存 localStorage；對話中 `{player}` 代入，空白時用「學弟／學妹」）。
- 驗收：近景截圖（正面、側面、背面）；動畫 idle／walk／run／jump／wave 無嚴重穿模（截圖檢查）；`walk_feel_qa` 仍 24/24。

## 7. NPC

### 7.1 資料（`public/data/npcs.json`）
```jsonc
{
  "version": 1,
  "npcs": [{
    "id": "barista",                // ascii kebab
    "name": "咖啡店學姊", "role": "菩提樹廣場咖啡座打工",
    "model": "np2", "tint": { "top": "#…", "hair": "#…" },
    "portrait": { "base": "student", "hair": "#…", "top": "#…", "skin": "#…", "accessory": "apron" },
    "schedule": { "day": { "at": "admin", "offset": [6, -4], "activity": "Idle" },
                  "sunset": { "at": "seawall", "offset": [2, 1], "activity": "Sit" },
                  "night": null },          // null = 不在場
    "talk": "barista",                       // trees 的 key
    "minigame": "quiz"                       // 可選：photo | macaque | quiz
  }],
  "trees": { "barista": { /* §8.1 */ } },
  "events": [{ "id": "sunset-crowd", "when": [{ "timeOfDay": "sunset" }], "spawn": [...], "line": "…" }]
}
```
- 既有的 `story-zones.json` 中 `guide`、`s1`、`s2`、`s3`、`m1` 保留為故事 NPC，並在 `npcs.json` 加上它們的對話樹（主線之外的閒聊）。
- 名單：20 個 id，依 `npc-cast-v4.md` §1（含既有 `guide`／`s1`／`s2`／`s3`／`m1`，性別與 zone 不變）。
- 模型：`create_student_v4.py` 參數化產生，與主角同一骨架與畫風：學生 6 種體型／髮型組合、教職員、櫃台、店員、警衛、志工；換色與配件（帽子、眼鏡、圍裙、背心）以 atlas 色槽與配件網格區分。獼猴沿用 `monkey.glb`，補 `Grab`／`Flee`／`Carry` 動畫。v3 的 np1–np6 等模型在新模型通過驗收後移除。

### 7.2 行為
- 作息：`sky.preset` 改變時，NPC 沿路網走到新時段位置（`NpcManager.moveTo`）；`null` 時走向最近的建築入口後隱藏。
- 搭話：任何具 `talk` 的 NPC 在 3 m 內顯示世界座標提示「E 交談」，按 E 開啟對話樹；說話時 NPC 面向玩家、播 Talk 動畫，玩家停止移動。故事步驟若在同一位 NPC 上需要 E，故事優先。
- 距離與效能：沿用 v3 規則（> 60 m 凍結、> 120 m 隱藏）；同時可見 NPC 上限 A 12／B 8／C 5（夜間 8／6／4），獼猴另計 ≤ 4，超出時最遠的隱藏（故事 NPC 與對話中的 NPC 永不隱藏）。
- 事件：時段觸發的校園事件（例如夕陽時海堤人潮、夜間保全巡邏），以 `events` 資料描述，最多同時一個。

## 8. 對話系統 v2

### 8.1 對話樹格式
```jsonc
{
  "entries": [                           // 由上而下第一個條件成立者為起點
    { "if": { "flag": "barista.met" }, "node": "again" },
    { "node": "first" }
  ],
  "nodes": {
    "first": {
      "lines": [{ "who": "barista", "face": "smile", "text": "新生嗎？{player}，要不要來杯咖啡？" }],
      "effects": [{ "setFlag": "barista.met" }],
      "choices": [
        { "text": "好啊，推薦哪一杯？", "next": "menu" },
        { "text": "我在找圖書館。", "next": "library", "effects": [{ "unlockSideQuest": "story-library" }] },
        { "text": "（考考我中山的事）", "if": { "notFlag": "quiz.done" }, "next": "quiz",
          "effects": [{ "startMinigame": "quiz" }] }
      ]
    },
    "menu": { "lines": [ … ], "next": "end" }
  }
}
```
- Line：`who`（npc id、`player`、`narrator`）、`text`（`{player}` 代入暱稱）、可選 `face`（`neutral` `smile` `surprised` `troubled`）。
- 節點：`lines` 必填；`choices`（2–4 個）或 `next` 二擇一；都沒有表示結束；`next: "end"` 亦表示結束。
- 條件（choice 的 `if`、entry 的 `if`）：`flag`、`notFlag`、`hasItem`、`stamps`（已取得集章數 ≥ n）、`chapterDone`、`timeOfDay`、`all`、`any`。「只播一次」以 entry 的 `notFlag`＋節點 `setFlag` 表達。
- 台詞長度沿用 v3 說話規則：一句 ≤ 28 字、一段 ≤ 2 句（`npc-cast-v4.md` §0.3）。
- 效果：`setFlag`、`giveItem`（物品 id，冪等）、`stamp`（集章 id，冪等）、`achievement`、`unlockSideQuest`、`startMinigame`（`{ "startMinigame": "quiz", "win": "after-win", "lose": "after-lose" }`，結束後回到同一 NPC 的指定節點）、`playSound`。效果在該節點的台詞全部播完後套用，選項效果在選擇時套用。
- 主線章節的 `dialogues` 保持 `Line[]`（可加 `face`），由同一 UI 播放；故事引擎不變。

### 8.2 靜態檢查（`tools/verify_dialogue.py` ＋ vitest）
- 所有 `next`、`entries.node` 指到存在節點；所有節點從某個 entry 可達；從任一節點都能走到結束（無死迴圈）。
- 引用的 flag 要嘛被某處 `setFlag`，要嘛是故事 flag；`give`／`stamp`／`achievement`／`startMinigame`／`unlockSideQuest` id 存在。
- 每位可對話 NPC 至少 1 個有 2+ 選項的節點（觀察型 `m2-mother` 除外）；每條台詞 ≤ 28 字；字型子集涵蓋所有字元（`build_font_subset.py`）。
- vitest 以對話執行器窮舉每位 NPC 每個選項路徑（在多組 flag 狀態下），斷言都能結束。

### 8.3 視覺小說 UI
- 底部全寬對話框（桌機最大寬 960 px，高約 28% 視窗；手機全寬、高 38%），左側半身立繪（隨 `face` 切換），名牌、打字機文字，右下「E／點擊 繼續」。
- 選項：2–4 個按鈕，數字鍵 1–4、方向鍵＋E／Enter、點擊皆可選。
- 紀錄（Backlog）：L 鍵或按鈕開啟，顯示本次對話全部台詞與所選選項（對話中 L 不切換視角鎖定）。
- 略過：Tab 或按鈕快轉至下一個選項或結尾（不略過選項）。
- 對話中鏡頭緩移到玩家與 NPC 之間的過肩構圖（可在設定關閉），結束後恢復。
- 立繪：`src/story/portraits.ts` 程序化 SVG 半身（頭、髮型 6 種、上衣 6 種、配件、四種表情），配色取自 NPC 的 `portrait`；風格與 3D 一致（扁平、深藍描邊）。不用照片、不畫真人。

## 9. 收集、成就、拍照、小遊戲

### 9.1 進度（`src/story/collection.ts`）
- 新 localStorage key `nsysu-campus-v4`：`{ items[], stamps[], achievements[], flags[], talked[], games: { photo?, macaque?, quiz? }, player: { body, palette, nickname } }`，讀取時逐欄正規化（同 `normalizeProgress`）。故事 flag 仍存在故事進度內；對話樹 flag 存這裡；條件判斷時兩者合併。
- 集章：每個集章點（11 處地標＋隧道內＋海堤蘿蔔坑等約 14 處）走進範圍即蓋章（有動畫與音效）。
- 成就：約 12 項（完成主線、蓋滿章、和 10 位 NPC 說過話、三個小遊戲、夜間散步、看夕陽、找到所有校史支線等）。
- 集章冊頁：Esc 選單內，顯示章戳格、收集品、成就；章戳為原創 SVG。

### 9.2 拍照模式（`src/games/photo.ts`）
- P 鍵或選單進入：隱藏 HUD、相機改自由環繞（限制在玩家 15 m 內、不穿牆），滑桿調時段與景深感（暗角），快門存 PNG（`canvas.toBlob` 下載），可選加浮水印「山海之間」。

### 9.3 海堤夕陽拍照
- 由海堤 NPC 發起；需在 `sunset` 時段、海堤範圍內、拍照模式下讓太陽與指定目標（燈塔／防波堤／船）落在畫面中央 60% 內且不被遮擋（射線檢查）；完成給章與成就。

### 9.4 獼猴小偷追逐
- 由文學院或圖書館附近 NPC 觸發：獼猴搶走 NPC 的便當，沿路網逃跑（速度略低於玩家奔跑），玩家在 90 秒內靠近 2 m 按 E 取回（獼猴丟下便當跑開，不做攻擊或傷害獼猴的動作）。結束對話傳達官方三原則「食物不外露、不餵食、不接觸」，並附總務處宣導連結（研究 Part B #23，用前核對）。
- 失敗可重試；不會卡主線。

### 9.5 校史問答
- 由咖啡座或圖書館 NPC 發起：從 `quiz.json` 抽 5 題（每題 3 選 1），題目只用 `nsysu-history-v3.md` 標 ✅ 的條目，每題記錄列號與來源 URL，答後顯示出處；答對 4 題以上給章。

## 10. HUD

- 常駐：左上任務卡（章節＋目標＋距離，點擊或 G 自動前往）；右上小地圖（可縮放兩段）；右上小圖示列（選單、音效、拍照）；畫面中下互動提示（世界座標標籤「E 交談」「E 開門」）；左下手機搖桿、右下手機動作鈕（行動版才顯示）。
- 收進 Esc 選單：鳥瞰、第一人稱、視角鎖定、時段、搜尋教室、校園地圖、集章冊與成就、換角色／暱稱、操作說明、回到起點。
- 彈窗佇列：章節卡、資訊卡、蓋章、成就、小遊戲結果共用一個佇列，同時最多一個置中卡片＋一個角落 toast；對話開啟時其他彈窗等待。
- 操作說明：首次進入顯示一次的精簡說明卡，之後在選單內。
- 保留 `tools/*_qa.py` 依賴的選取器，若必須改名則同步更新工具。

## 11. 效能預算

| 項目 | A（桌機） | B | C（手機） |
|---|---|---|---|
| draw calls（步行視角） | 目標 ≤ 300，驗收 < 500 | < 260 | 目標 ≤ 120，驗收 < 160 |
| draw calls（鳥瞰） | 目標 ≤ 480，驗收 < 500 | — | — |
| 三角形 | < 1.6 M | < 0.8 M | < 0.5 M |
| 草叢 | 開 | 半密度 | 關 |
| N8AO | 依量測 | 關 | 關 |
| 同時可見 NPC（不含獼猴） | 12 | 8 | 5 |

量測沿用 `tools/v3_screens.py` 的 stats（SwiftShader）；`quality.ts` 自動降級規則不變。

## 12. 驗收

1. v3 回歸：`npm test` 全過（含 877 房）、`walk_feel_qa` 24/24、`story_playthrough_qa` 6/6、`campus_map_qa` 全過、`npm run build` 通過。
2. 對話：`verify_dialogue.py` 0 錯誤；vitest 窮舉所有 NPC 選項路徑皆可結束；瀏覽器自動化與每位 NPC 搭話（E 開啟、選項可選、結束後 flag 正確）。
3. 玩法：Playwright 自動完成三個小遊戲、蓋至少 3 個章、觸發至少 3 個成就、拍照模式存出 PNG。
4. 作息：三個時段下截圖並記錄每位 NPC 位置符合 schedule。
5. 效能：§11 表格（stats JSON）。
6. 截圖：`artifacts/v4/comparison/` 桌機與手機、三時段，與 v3 同角度並排。
7. 審查：GPT-6 code review、Fable 美術審查，無未處理 P1。

## 13. 既有資料修正

- `chapters.json` 的 `c1-done` 旁白對齊校方原文措辭：「民國 68 年（1979）核定在高雄西子灣設籌備處，翌年 7 月正式建校。」（`nsysu-history-v3.md` 第 12 列的 ⚠ 只針對措辭）。`c2-done` 年份已核實，維持。
- 若 `nsysu-history-v3.md` 有列狀態由 ✅ 改為其他，對應台詞與題目同步下架（`verify_dialogue.py` 檢查題庫列號仍為 ✅）。

## 14. 工具、授權與限制

- Blender 4.5（`tools/blender-path.txt`）、Node 24、Playwright 皆已安裝。新增 npm 依賴：`n8ao`（若量測通過才保留）。
- 新增素材全部原創或 CC0，記入 `docs/licenses.md`；不使用照片與真人肖像；研究中的參考照片不進 repo。
- 校園生活事實（店家、時刻、社團）只用 Gemini 研究中附官方來源者，寫進台詞前點開核對；無法核對者改為泛稱（「學餐」「便利商店」）。
- 限制照實記錄：SwiftShader 非真機；建模與佈置為示意。

## 15. GPT-6 spec 審查修正（job `e7c35e79-dcc1-4e40-bc98-596ca426d22b`，原文 `reviews/results/40-gpt6-spec-v4.md`）

本節優先於前文；與前文衝突處以本節為準。

### 15.1 主線 NPC 位置所有權（P1-1）
- 故事 NPC（`guide`、`s1`、`s2`、`s3`、`m1`）在六章未全部完成前**不受作息控制**：位置只由故事（`moveNpc`／`npcAt`）決定，三時段都在場。主線完成後才套用 `npcs.json` 的 schedule。
- 其他 NPC 的 schedule 可為 `null`；故事 NPC 的 schedule 不得為 `null`（verify 檢查）。
- 位置在三個時點重新解析：載入存檔、切換時段、完成章節。測試：三時段 × 讀檔中途，故事 NPC 位置等於故事位置（vitest，純邏輯 `resolveNpcPlacement`）。

### 15.2 對話控制流（P1-2）
- 終止：節點沒有 `choices` 也沒有 `next` 即結束。不使用 `"end"` 字串；所有 `next`、`win`、`lose`、`entries.node` 都必須指到存在節點。
- `startMinigame` 只能出現在**終止節點**的 `effects`（台詞播完才開遊戲），格式 `{ "startMinigame": "history-quiz", "win": "after-win", "lose": "after-lose" }`；遊戲結束後以同一棵樹的 `win`／`lose` 節點重開對話。選項上不得放 `startMinigame`。
- 對話圖必須無循環（DAG）；「再聊一次」以下一次按 E 從 entries 重新進入表達。verify 檢查：所有邊（`next`、choice `next`、`win`、`lose`）合法、無循環、每個節點自某 entry 可達、最後一個 entry 無條件。

### 15.3 狀態儲存契約（P1-3）
- 故事進度維持 key `nsysu-story-v3` 與格式不變（舊存檔照常可讀）。v4 新 key `nsysu-campus-v4` 存：`flags`、`items`、`stamps`、`achievements`、`counters`、`talked`、`games`、`player`。
- 讀取介面 `Facts`：`flag(x)` = 故事 flags ∪ v4 flags；對話的 `setFlag` 只寫 v4 庫，且 flag 名稱必須以 NPC id 或 `v4.` 開頭（verify 檢查），因此不會改寫故事 flag。
- 對話的 `unlockSideQuest` 呼叫故事引擎新的公開方法 `engine.unlockSideQuest(id)`（寫故事庫，沿用既有存檔）。
- 「重新開始導覽」清除兩個 key；`story_playthrough_qa.py` 等工具清除兩個 key。驗收含「只有 v3 舊存檔」與「兩庫都有」兩種讀檔案例。

### 15.4 輸入模式與 E 仲裁（P1-4）
- `src/walk/input.ts` 新增集中模式 `mode: 'walk' | 'dialogue' | 'menu' | 'photo' | 'game'` 與單一 keydown 分派：非 `walk` 模式時，不擷取移動鍵、不觸發 runtime 快捷鍵（L、M、V、N、G、P、/），按鍵交給目前模式的處理器並 `preventDefault`；進入非 walk 模式時釋放所有移動狀態。
- 各模式按鍵：dialogue（E／Space／Enter 繼續、1–4 與 ↑↓ 選項、L 紀錄、Tab 快轉、Esc 關紀錄）；menu（↑↓／Enter／Esc）；photo（WASD 與拖曳移相機、Space 快門、Esc 離開）；game（walk 的移動＋E 取回、Esc 放棄）。
- walk 模式 E 順序（單次消耗）：故事步驟 → 追逐中取回 → NPC 閒聊 → 地標資訊卡 → 電梯 → 門。

### 15.5 名單與資料模型一致（P1-5）
- 小遊戲 id 一律 `sunset-photo`、`monkey-chase`、`history-quiz`；題目 4 選 1，抽 5 題，答對 ≥ 4 得章。
- 計數：v4 庫 `counters`；效果 `{ "count": "coffee-kai.buy" }`（+1），條件 `{ "count": "coffee-kai.buy", "gte": 3 }`。拍照存檔張數記為 `counters["photo.saved"]`。名單中「跨時段交談」以 flag 記錄（`<npc>.met.day` 等），由對話效果設定。
- `npc-cast-v4.md` 中無法以上述模型表達的需求，實作時刪減並在名單文件註明。

### 15.6 唯一效能驗收表（P1-6）
- 硬門檻：§11 表的「驗收」欄（A 步行與鳥瞰 < 500、C < 160）。`art-direction-v4.md` §12 的 300／480／120 為改善目標，不作為失敗條件。三角形門檻：A < 1.6 M、C < 0.5 M。

### 15.7 骨架與動畫（P2-7）
- 不改來源骨架的 rest pose（不做 v3 的 `enlarge_head`）：頭部以較大的體積圍繞原 Head 關節建模，比例由網格決定，因此 v3 的 `build_clips` 原樣適用；背包與肩帶以 automatic weights 後再強制全權重給 `Torso`。
- 驗收：每個 clip 的 Blender 預覽（正、側、背、走路影格）＋瀏覽器內 idle／walk／run／jump／wave 截圖，檢查肩、髖、膝的穿模與衣物撕裂。

### 15.8 分級的幾何預算（P2-8）
`quality.ts` 每級一份 `detail` 設定，生成時讀取（切級時重建草與道具）：

| | A | B | C |
|---|---|---|---|
| 葉片卡倍率 | 1 | 0.5 | 0.3 |
| 草（單一 InstancedMesh，以玩家為中心 60 m 重新填充） | 6000 | 2000 | 0 |
| 窗凹幾何 | L0 全部 | L0 3 棟 | 關 |
| 雲 | 24 | 12 | 6 |
| 道具 | P1–P3 | P1–P2 | P1 |
| N8AO | 開（降級即關） | 關 | 關 |

### 15.9 碰撞與作息測試（P2-9）
- 道具碰撞由純函式 `propColliders(data)` 產生，runtime 與 `tests/world-fixture.ts` 共用；`story-walk` 測試因此包含新碰撞。
- 新增 vitest：切換三時段時故事 NPC 不動（§15.1）；作息 NPC 在 60 s 內抵達 schedule 點 3 m 內，或在無路時瞬移（玩家 60 m 外）／隱藏。

### 15.10 QA 工具（P2-10）
- 搜尋、時段、鳥瞰等收進 Esc 選單後，`walkthrough_qa.py`、`campus_visual_qa.py`、`walk_feel_qa.py` 改為「開啟選單 → 點選」的真實操作，選取器保留。

### 15.11 可重現驗收（P2-11）
- 截圖機位：`tools/v4_screens.py` 固定清單（`art-direction-v4.md` §14 的 12 機位＋ `desktop-dialog`、`desktop-esc`、`mobile-B-walk`、`mobile-dialog`），每張記錄 tier、時段、draw calls、三角形到 `artifacts/v4/screens/stats.json`。
- 作息：每時段等待 60 s，記錄每位 NPC 與 schedule 點的距離（≤ 3 m 或 hidden 為通過）。
- 對話窮舉：flag 狀態集合 = 空集合、主線全完成、每位 NPC 的 `*.met` 已設定三種；DAG 保證有界。
- 拍照：PNG 尺寸等於畫布、非單色（像素標準差 > 5）。
