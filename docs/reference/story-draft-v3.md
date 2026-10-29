# 新生導覽・故事草稿 v3

版本 2026-10-19・作者 Fable（narrative）。搭配 `art-direction-v3.md`。本稿只負責「誰說什麼、在哪裡觸發、完成後發生什麼」；史實一律沿用 `public/data/campus-info.json` 已附來源的句子，新的事實主張以【待查證：…】標記，交由研究者核對後再決定要不要留。角色全為原創，不影射真實人物。

座標說明：`pos` 為世界座標（與 `campus-info.json` 的 `stories[].pos` 同一座標系；x 向東、z 向南）。下表「觸發位置」給的是**既有故事寶石的座標或相對描述**，實際章節觸發點請在場景裡用 `window.campusWalk` 讀玩家位置後填入 JSON，標【待定位】者尚未有可用座標。

---

## 1. 導覽 NPC：阿灣

| 項目 | 設定 |
|---|---|
| 名字 | **阿灣**（本名汪子灣，大家只叫她阿灣；名字是爸媽在西子灣約會取的，她自己覺得很俗但也懶得改） |
| 身分 | 海洋科學系大三學姊、新生輔導志工 |
| 外型 | 單馬尾、淺青外套、深藍工裝褲、橘拖鞋；手上永遠拿一把收起來的傘（她說是防曬，其實是防猴）；水壺貼滿貼紙 |
| 個性 | 熱情、話多、路痴過一次之後把全校走到會背；愛講冷笑話，講完自己先笑；怕猴子但嘴硬；講到海就安靜下來 |
| 口頭禪 | 「跟我走就對了。」「這個我考過，不要問。」「先別急，這裡要看一下。」 |
| 說話規則 | 一句 ≤ 28 字、一段 ≤ 2 句；用「你」稱呼玩家、不叫名字（三位可操作角色共用台詞）；不用英文縮寫、不用網路梗；史實句子只念 campus-info.json 裡的版本，不加形容詞 |
| 動畫 | `Idle`／`Talk`／`Wave`／`Walk`；每章開頭她站在觸發點旁 `Wave`，對話中 `Talk`，結束後 `Walk` 走向下一章（玩家看得到她離開的方向，等於第二個箭頭） |
| 聲音 | 無配音；對話框打字機音效用短「噠」（每 3 字一次） |

可操作角色（阿海、小嵐、阿拓）在對話中只有一句回應，語氣相同，不分角色寫差異版（成本考量）。

---

## 2. 六章

通用結構：**到達觸發點 → 阿灣對話（3–6 句）→ 目標文字出現 → 玩家完成動作 → 章節完成卡 → 阿灣指出寶石或下一章**。每章完成時：章節卡＋紙屑、進度圓點亮一顆、該章綁定的故事寶石開始脈動（**不自動收集**，玩家要走過去按 E，8／8 的計數邏輯不變）。

### 第 ① 章・校門報到

| 項目 | 內容 |
|---|---|
| 觸發位置 | 校碑前 6 m 內。暫以既有故事 `sunset` 的 `pos: [-226, 178]` 為錨，實際觸發點在校碑面向蓮海路的一側【待定位】。遊戲在此出生 |
| 目標文字 | 「到校碑前找阿灣報到」→ 完成後「跟著阿灣走到隧道口」 |
| 對話 | 阿灣：「新生？看你東張西望就知道。歡迎來到山海之間。」 |
| | 阿灣：「我是阿灣，今天帶你走一圈。跟我走就對了。」 |
| | 阿灣：「先抬頭。這根紅磚柱是校碑，二十一點二公尺高。」 |
| | 阿灣：「後面那片是海。以後心情不好，來這裡坐一下就好了。」 |
| | 玩家：「……報到是在這裡嗎？」 |
| | 阿灣：「不是，報到在行政大樓。但先走一段路，才知道學校長什麼樣。」 |
| 完成條件 | 對話結束（本章沒有動作，是教學） |
| 獎勵／flavour | 章節卡插圖：校碑＋海。副標「第一天，從海邊開始。」解鎖側任務「蘿蔔坑看夕陽」的寶石脈動（但 ⑥ 章前收集也可以） |
| 側拍 | 校碑旁停一台單車，阿灣：「不是我的。我的被猴子坐過，不想騎了。」（純趣味，不涉史實） |
| 史實使用 | 21.2 m：campus-info `sunset` 已有來源 |

### 第 ② 章・穿過西子灣隧道

| 項目 | 內容 |
|---|---|
| 觸發位置 | 隧道西口（校園側）拱圈前 8 m，錨點既有故事 `tunnel` 的 `pos: [24, 150]` |
| 目標文字 | 「走到西子灣隧道口」→ 到達後「走進洞口聽回音」 |
| 對話 | 阿灣：「到了。這是西子灣隧道，另一邊是哈瑪星。」 |
| | 阿灣：「它前身叫壽山洞，一九二八年貫通，全長兩百六十公尺。」 |
| | 阿灣：「岩壁裡面還有二戰時期的防空洞，不過今天不進去。」 |
| | 玩家：「我們要走到另一頭嗎？」 |
| | 阿灣：「今天不用。走進去十步，喊一聲，聽回音就好。」 |
| | 阿灣：「這個我考過，不要問回音幾秒。」 |
| 完成條件 | 玩家進入洞口內 10 m 的體積（`enter`，r 4 m）再回到洞口外 |
| 獎勵／flavour | 進洞時播放 2 s 的回音音效＋畫面變暗（vignette +0.15），出洞時橫幅「西子灣隧道」。章節卡副標「山的那一邊，先放著。」`tunnel` 寶石脈動 |
| 側拍 | 若玩家在洞內停留 > 8 s，阿灣：「不要在裡面蹲太久，我會以為你迷路。」 |
| 史實使用 | 壽山洞、1928、260 m、防空洞：campus-info `tunnel` 已有來源 |
| **實作限制** | 現況隧道只做 20 m 的 stub 後以霧封口（art-direction §5 #5），所以本章目標是「到洞口＋進去一小段」，**不是穿越**。若日後做成可通行隧道（連到哈瑪星側的出生點），再把完成條件換成「從東口出來」，JSON 已預留 `altThen` |

### 第 ③ 章・行政大樓辦手續

| 項目 | 內容 |
|---|---|
| 觸發位置 | 行政大樓正門階梯下、兩尊銅獅之間，錨點既有故事 `lions` 的 `pos: [-70, 96]` |
| 目標文字 | 「到行政大樓前的銅獅報到」→ 到達後「走上階梯領學生證」 |
| 對話 | 阿灣：「行政大樓。報到、辦證、請假、投訴，都在這裡。」 |
| | 阿灣：「門口這兩隻是銅獅，雕塑家陳志慈做的，守了四十多年。」 |
| | 阿灣：「十二月的時候學校會幫牠們戴聖誕帽。我每年都來拍。」 |
| | 玩家：「牠們看起來有點兇。」 |
| | 阿灣：「摸一下頭就不兇了。好，上去，門口桌子有人等你。」 |
| 完成條件 | 玩家走到階梯頂的門廊（`enter` r 3 m，y > 階梯高）；觸發一個無名職員 NPC 的單句「學生證，拿好。」＋ UI 顯示「取得：學生證」 |
| 獎勵／flavour | 道具「學生證」（UI 圖示，紙卡語彙，姓名欄顯示所選角色名）。章節卡副標「正式成為中山人。」`lions` 寶石脈動 |
| 側拍 | 玩家在銅獅旁按 E：銅獅發出一聲極短的「嗯」。阿灣：「你聽到了嗎？沒有，你沒有。」 |
| 史實使用 | 陳志慈、聖誕帽：campus-info `lions` 已有來源。「四十多年」沿用該條原文 |

### 第 ④ 章・圖資大樓借書

| 項目 | 內容 |
|---|---|
| 觸發位置 | 中庭廣場北端、圖資大樓大階梯下，錨點既有故事 `library` 的 `pos: [-66, -60]` |
| 目標文字 | 「到圖資大樓前借第一本書」→ 到達後「走上大階梯到二樓入口」 |
| 對話 | 阿灣：「圖資大樓，十二層。迷路就抬頭找它的皇冠。」 |
| | 阿灣：「一九八九年蓋好的，建築師是陳其寬。」 |
| | 阿灣：「余光中寫過一首〈高樓對海〉，就是從這裡的長窗看出去。」 |
| | 玩家：「可以上去看嗎？」 |
| | 阿灣：「今天先借書。上二樓，櫃台借一本，什麼都好。」 |
| | 阿灣：「先別急，這裡要看一下——回頭，中庭整個在你腳下。」 |
| 完成條件 | 玩家到達 2F 入口平台（`enter` r 3 m）；觸發櫃台 NPC 單句「第一本書，好好看。」＋「取得：一本書」（不提借期等真實規定） |
| 獎勵／flavour | 道具「一本書」（封面只有色塊與「山海」二字，原創）。章節卡副標「高樓對海，先借一本。」`library` 寶石脈動。本章完成後 topbar 的「校園故事」計數旁多一個小書本圖示 |
| 側拍 | 在大階梯中段回頭時觸發橫幅「中庭・菩提樹廣場」（若尚未觸發過） |
| 史實使用 | 12 層、1989、陳其寬、余光中詩題：campus-info `IL`／`library` 已有來源。**不要**念詩句以外的內容；「皇冠」是本專案對外形的暱稱，保留在阿灣口中即可 |

### 第 ⑤ 章・理工長廊找教室

| 項目 | 內容 |
|---|---|
| 觸發位置 | 理工長廊南端入口（行政大樓東側與理學院交界的長廊起點）【待定位】 |
| 目標文字 | 「走理工長廊，找到 SC2001」 |
| 對話 | 阿灣：「這條是理工長廊，沿著中庭東側把各館串起來。」 |
| | 阿灣：「下雨不用傘、社團擺攤、海報牆，全在這裡。」 |
| | 阿灣：「你的第一堂課在 SC2001。理學院二樓。」 |
| | 玩家：「SC 是哪一棟？」 |
| | 阿灣：「上面搜尋框打 SC2001，路會自己亮起來。這次我不帶，你自己走。」 |
| | 阿灣：「食物收好。長廊有猴學長巡邏。」 |
| 完成條件 | 玩家所在房間 `code === "SC2001"`（`rooms.json` 內 `SC-2F` 的 `oaa-02Room_COS_1-p1-28`），停留 2 s。使用既有的室內路徑尋找（搜尋框→亮路）；本章不另做箭頭，箭頭改為「指向搜尋框」的一次性 UI 提示 |
| 獎勵／flavour | 章節卡副標「找得到教室，就找得到路。」教室內黑板出現一行粉筆字「歡迎」（emissive 貼圖切換）。`monkeys` 寶石脈動（位置在 `[82, 62]`，長廊東側） |
| 側拍 | 長廊中段固定站一隻獼猴 NPC；玩家靠近 < 2 m 時牠跳上欄杆，阿灣（遠端廣播，無頭像）：「不要對視。走你的。」 |
| 史實使用 | 「理工長廊沿中庭東側串連各館」：campus-info `SC.facts`；猴子與食物：campus-info `monkeys`。「社團擺攤、海報牆」：`visual-reference.md` §1 有來源（學務處場地要點），但 campus-info 尚未收錄 →【待查證：是否納入 campus-info 的 facts，否則刪這句】 |

### 第 ⑥ 章・西子灣看夕陽

| 項目 | 內容 |
|---|---|
| 觸發位置 | 完成 ⑤ 後自動開啟；目標在海堤蘿蔔坑（校碑旁），錨點 `sunset` 的 `pos: [-226, 178]`，實際坐點在海堤女兒牆上【待定位】 |
| 目標文字 | 「回到海堤，坐進蘿蔔坑」→ 坐下後「等夕陽」 |
| 對話（到達時） | 阿灣：「回來了。今天走的路，以後四年會走幾百次。」 |
| | 阿灣：「海堤這排凹進去的位子，一格剛好坐兩個人，大家叫蘿蔔坑。」 |
| | 阿灣：「坐。按 N 可以把時間調到傍晚，但我比較喜歡等。」 |
| | 玩家：「等多久？」 |
| | 阿灣：「等到你不想看手機為止。」 |
| 完成條件 | 玩家在蘿蔔坑座位體積內按 E 進入 `Sit`（角色與阿灣並坐，相機拉到側後方 4 m 看海），且 `preset === "sunset"`（玩家按 N，或坐下 10 s 後自動以 20 s 慢轉到夕陽） |
| 獎勵／flavour | 夕陽到位時：日輪落到海平線、海面高光帶、bloom 加強、橫幅「西子夕照」；阿灣最後一句（無對話框，字幕式浮在畫面下方）：「好，導覽結束。明天開始，路你自己走。」接最終章節卡「導覽完成」＋六顆金點＋「繼續探索」／「回到校門」。`sunset` 寶石脈動（若還沒收）。之後解鎖「自由模式」：阿灣常駐蘿蔔坑旁 `Idle`，靠近可重聽任一章對話（選單） |
| 側拍 | 坐下後若切到夜：阿灣：「夜景也可以。但不要太晚，猴子睡了，警衛沒睡。」 |
| 史實使用 | 蘿蔔坑、兩人座、校碑鄰海堤：campus-info `sunset` 已有來源。「西子夕照」為既有稱呼，`visual-reference.md` 提及「高雄八景」→【待查證：是否納入；橫幅只寫「西子夕照」四字不提八景】 |

---

## 3. 既有 8 則故事 → 側任務

決定：**章節不自動收集寶石**。章節完成只讓對應寶石脈動並在小地圖上標金點；玩家仍需走到寶石按 E，`campusWalk` 的 8／8 計數與 `localStorage` 邏輯不改。這樣章節是「主線」、寶石是「回頭再撿」，避免兩套進度互相吞掉。

| 故事 id | 標題 | 與章節關係 | 側任務名稱（寶石卡 chip） | 觸發／提示 |
|---|---|---|---|---|
| `sunset` | 蘿蔔坑看夕陽 | ① 開場解鎖脈動、⑥ 的終點 | 「海堤的兩人座」 | 出生點 30 m 內，第一顆最容易撿到的寶石，等於教學 |
| `tunnel` | 西子灣隧道「壽山洞」 | ② 完成後脈動 | 「洞口的回音」 | 寶石放拱圈左側壁柱旁 |
| `lions` | 行政大樓銅獅 | ③ 完成後脈動 | 「摸獅頭」 | 寶石在左獅基座；收集時銅獅播一次 0.4 s 的抬頭（骨骼或 morph，可省略） |
| `zoo` | 西子灣的動物園 | 自由側任務，建議 ③ 後 | 「動物園搬走以後」 | `pos [-20,120]` 行政大樓與體育館之間；名稱只用 campus-info 已有的「1978 創立、1986 遷走」語意，不提猛獸共學；阿灣在 ③ 結束走路時丟一句「對了，這附近以前有動物園，去找找。」 |
| `bodhi` | 菩提樹廣場的公投 | 自由側任務，建議 ④ 前後 | 「留孫移蔣」 | `pos [-67,-27]` 中庭；靠近老菩提樹木棧平台 |
| `library` | 戴著皇冠的知識燈塔 | ④ 完成後脈動 | 「高樓對海」 | 寶石在 2F 入口平台欄杆邊 |
| `monkeys` | 壽山的「猴學長」 | ⑤ 側拍解鎖脈動 | 「猴學長的規矩」 | `pos [82,62]` 長廊東側；旁邊固定那隻獼猴 |
| `gallery` | 從溫浴館到行館 | 自由側任務，最遠的一顆 | 「海邊的溫浴館」 | `pos [-181,-70]` 西子灣行館；全部六章完成後阿灣提示「還有一顆在海邊很遠的地方，去過的人不多。」 |

側任務完成全 8 顆：寶石卡顯示「校園故事 8／8」＋一張額外紙卡「山海之間・全收集」（插圖：校碑、皇冠、拱圈、獅子四個小圖示），無其他獎勵。

---

## 4. JSON 形狀建議（擴充 `campus-info.json`，不另開檔）

原則：保留既有 `buildings`／`stories` 欄位與型別；新增 `guide`、`chapters`；`stories[]` 只加可選欄位。條件與動作都是小型可列舉的 tagged union，方便在 `walk-campus-ui.ts` 旁邊寫一個 ~150 行的 `walk-quest.ts` 解讀。

```jsonc
{
 "guide": {
  "id": "awan", "name": "阿灣", "portrait": "/assets/ui/portrait-awan.svg",
  "model": "/assets/characters/student-f.glb", "recolor": "awan",   // 對應 art-direction-v3 §6.2
  "idlePos": [-224, 176]                                              // 自由模式常駐點【待定位】
 },
 "chapters": [
  {
   "id": "ch1-gate", "index": 1, "title": "校門報到", "banner": "校門・校碑",
   "requires": [],                                   // 前置章節 id；空＝可立即開始
   "guideAt": [-224, 176],                           // 阿灣站位【待定位】
   "start": { "when": { "type": "enter", "pos": [-226, 178], "r": 6 } },
   "objective": "到校碑前找阿灣報到",
   "dialogue": [
    { "who": "guide", "text": "新生？看你東張西望就知道。歡迎來到山海之間。" },
    { "who": "guide", "text": "我是阿灣，今天帶你走一圈。跟我走就對了。" },
    { "who": "guide", "text": "先抬頭。這根紅磚柱是校碑，二十一點二公尺高。", "fact": "sunset" },
    { "who": "guide", "text": "後面那片是海。以後心情不好，來這裡坐一下就好了。" },
    { "who": "player", "text": "……報到是在這裡嗎？" },
    { "who": "guide", "text": "不是，報到在行政大樓。但先走一段路，才知道學校長什麼樣。" }
   ],
   "complete": { "when": { "type": "dialogueDone" } },
   "then": [
    { "type": "banner", "text": "校門・校碑" },
    { "type": "pulseStory", "id": "sunset" },
    { "type": "chapterCard", "subtitle": "第一天，從海邊開始。", "illustration": "gate" },
    { "type": "guideWalkTo", "pos": [24, 150] }
   ],
   "sideBeat": { "when": { "type": "interact", "target": "prop:gate-bike", "r": 2 },
                 "say": "不是我的。我的被猴子坐過，不想騎了。" }
  },
  {
   "id": "ch2-tunnel", "index": 2, "title": "穿過西子灣隧道", "banner": "西子灣隧道",
   "requires": ["ch1-gate"],
   "start": { "when": { "type": "enter", "pos": [24, 150], "r": 8 } },
   "objective": "走到西子灣隧道口",
   "objectiveAfterDialogue": "走進洞口聽回音",
   "dialogue": [ /* 見 §2 ② */ ],
   "complete": { "when": { "type": "all", "of": [
     { "type": "enter", "pos": [30, 150], "r": 4, "id": "tunnel-inside" },      // 洞內 10 m【待定位】
     { "type": "exit",  "pos": [30, 150], "r": 4, "after": "tunnel-inside" }
   ] } },
   "altThen": { "note": "隧道可穿越後改用", "when": { "type": "enter", "pos": [0, 0], "r": 6 } },
   "then": [ { "type": "sfx", "id": "echo" }, { "type": "pulseStory", "id": "tunnel" },
             { "type": "chapterCard", "subtitle": "山的那一邊，先放著。", "illustration": "tunnel" } ],
   "sideBeat": { "when": { "type": "dwell", "pos": [30, 150], "r": 4, "seconds": 8 },
                 "say": "不要在裡面蹲太久，我會以為你迷路。" }
  },
  {
   "id": "ch3-admin", "index": 3, "title": "行政大樓辦手續", "banner": "行政大樓",
   "requires": ["ch2-tunnel"],
   "start": { "when": { "type": "enter", "pos": [-70, 96], "r": 6 } },
   "objective": "到行政大樓前的銅獅報到", "objectiveAfterDialogue": "走上階梯領學生證",
   "dialogue": [ /* §2 ③ */ ],
   "complete": { "when": { "type": "enter", "pos": [-70, 84], "r": 3, "minY": 1.5 } },   // 門廊【待定位】
   "then": [ { "type": "npcLine", "npc": "clerk-admin", "text": "學生證，拿好。" },
             { "type": "giveItem", "id": "student-card", "label": "學生證" },
             { "type": "pulseStory", "id": "lions" },
             { "type": "chapterCard", "subtitle": "正式成為中山人。", "illustration": "lions" },
             { "type": "guideSay", "text": "對了，這附近以前有動物園，去找找。" } ]
  },
  {
   "id": "ch4-library", "index": 4, "title": "圖資大樓借書", "banner": "圖資大樓",
   "requires": ["ch3-admin"],
   "start": { "when": { "type": "enter", "pos": [-66, -60], "r": 6 } },
   "objective": "到圖資大樓前借第一本書", "objectiveAfterDialogue": "走上大階梯到二樓入口",
   "dialogue": [ /* §2 ④ */ ],
   "complete": { "when": { "type": "enter", "pos": [-66, -72], "r": 3, "minY": 3 } },    // 2F 平台【待定位】
   "then": [ { "type": "npcLine", "npc": "clerk-library", "text": "第一本書，好好看。" },
             { "type": "giveItem", "id": "book", "label": "一本書" },
             { "type": "pulseStory", "id": "library" },
             { "type": "chapterCard", "subtitle": "高樓對海，先借一本。", "illustration": "crown" } ]
  },
  {
   "id": "ch5-classroom", "index": 5, "title": "理工長廊找教室", "banner": "理工長廊",
   "requires": ["ch4-library"],
   "start": { "when": { "type": "enter", "pos": [0, 0], "r": 6 } },                         // 長廊南端【待定位】
   "objective": "走理工長廊，找到 SC2001",
   "dialogue": [ /* §2 ⑤ */ ],
   "hint": { "type": "uiPoint", "target": ".walk-search", "text": "打 SC2001，路會亮起來" },
   "arrow": false,                                                                          // 本章交給室內尋路
   "complete": { "when": { "type": "room", "code": "SC2001", "seconds": 2 } },
   "then": [ { "type": "setEmissive", "target": "SC2001:board", "on": true },
             { "type": "pulseStory", "id": "monkeys" },
             { "type": "chapterCard", "subtitle": "找得到教室，就找得到路。", "illustration": "corridor" } ],
   "sideBeat": { "when": { "type": "enter", "pos": [82, 62], "r": 2 },
                 "say": "不要對視。走你的。", "broadcast": true }
  },
  {
   "id": "ch6-sunset", "index": 6, "title": "西子灣看夕陽", "banner": "西子夕照",
   "requires": ["ch5-classroom"],
   "start": { "when": { "type": "chapterDone", "id": "ch5-classroom" } },                 // 立即開啟，目標在遠方
   "objective": "回到海堤，坐進蘿蔔坑", "objectiveAfterDialogue": "等夕陽",
   "dialogueAt": { "type": "enter", "pos": [-226, 178], "r": 6 },
   "dialogue": [ /* §2 ⑥ */ ],
   "complete": { "when": { "type": "all", "of": [
     { "type": "sit", "seat": "seawall-01" },
     { "type": "preset", "is": "sunset" }
   ] } },
   "autoPreset": { "after": 10, "to": "sunset", "duration": 20 },
   "then": [ { "type": "banner", "text": "西子夕照" },
             { "type": "subtitle", "text": "好，導覽結束。明天開始，路你自己走。" },
             { "type": "pulseStory", "id": "sunset" },
             { "type": "chapterCard", "subtitle": "導覽完成", "illustration": "sunset", "final": true },
             { "type": "unlockFreeMode" } ],
   "sideBeat": { "when": { "type": "preset", "is": "night", "while": "sitting" },
                 "say": "夜景也可以。但不要太晚，猴子睡了，警衛沒睡。" }
  }
 ],
 "stories": [
  { "id": "sunset", "title": "蘿蔔坑看夕陽", "pos": [-226, 178], "text": "…", "sources": [ "…" ],
    "quest": "海堤的兩人座", "pulseAfter": "ch1-gate" },           // 新增兩個可選欄位，其餘不動
  { "id": "gallery", "...": "...", "quest": "海邊的溫浴館", "hintAfter": "ch6-sunset",
    "hint": "還有一顆在海邊很遠的地方，去過的人不多。" }
 ]
}
```

### 條件（`when`）型別

| type | 欄位 | 說明 |
|---|---|---|
| `enter` | `pos [x,z]`, `r`, `minY?`, `id?` | 玩家腳點進入圓柱；`minY` 用來區分階梯上下 |
| `exit` | `pos`, `r`, `after?` | 離開圓柱；`after` 指定必須先進過某個 `id` |
| `dwell` | `pos`, `r`, `seconds` | 停留秒數 |
| `room` | `code`, `seconds?` | 既有室內定位的房間代碼 |
| `interact` | `target`, `r` | 在目標旁按 E；`target` 可為 `npc:*`、`prop:*`、`story:*` |
| `sit` | `seat` | 在指定座位體積按 E 進入 `Sit` |
| `preset` | `is`, `while?` | 光照預設；`while: "sitting"` 等狀態修飾 |
| `dialogueDone` | — | 本章對話播完 |
| `chapterDone` | `id` | 某章完成 |
| `storyCollected` | `id` | 某寶石已收集 |
| `all` / `any` | `of[]` | 組合；`all` 內的 `enter`→`exit` 以 `id/after` 表順序 |

### 動作（`then`）型別

`banner`、`subtitle`、`chapterCard`、`pulseStory`、`giveItem`、`npcLine`、`guideSay`（阿灣遠端一句）、`guideWalkTo`、`setPreset`、`setEmissive`、`sfx`、`uiPoint`、`unlockFreeMode`。全部冪等，重播不會重複給物品。

### 儲存

`localStorage` 鍵 `campusWalk.quest.v1`：`{ done: string[], items: string[], freeMode: boolean }`；與既有故事收集的鍵分開，刪一個不影響另一個。

### 與 `docs/spec-v3.md` §8.1（`public/data/chapters.json`）的對應

spec 決定章節資料獨立成 `chapters.json`（`zone`／`steps`／`when: []` 陣列／`dialogues` 字典），本稿的台詞與觸發可 1:1 搬過去；若採 spec 的檔案，以 spec 的欄位為準，本節只保留語意。詞彙對照：

| 本稿 | spec | 備註 |
|---|---|---|
| `enter {pos,r}` | `inZone` 或 `near {target,r}` | 章節觸發點改成 `world/zones.json` 的 zone id；`minY` 用兩個 zone（階下／階上）取代 |
| `dialogueDone` | `flag` ＋ `dialogue` 的 `setFlag` | |
| `room {code}` | `atDestination` | SC2001 走既有帶路 |
| `preset {is}` | `timeOfDay` | |
| `interact`／`sit` | `near` ＋ `press:"E"` | `sit` 另需控制器的 `Sit` 狀態，spec 尚未列，標為新增 |
| `dwell`／`exit`／`chapterDone`／`storyCollected`／`all`／`any` | `chapterDone` 已有；其餘為新增建議 | 不採用時，② 章完成條件退化為 `inZone: tunnel-inside` 一次即可 |
| `pulseStory` | `unlockSideQuest` | 語意相同：寶石脈動、不自動收集 |
| `setPreset`／`autoPreset` | `setSky` | `autoPreset` 的 10 s 延遲可用 `dwell` 近似 |
| `banner`／`chapterCard`／`guideWalkTo`／`npcLine`／`giveItem` | `setObjective`／`completeChapter`／`moveNpc`／`dialogue`／（新增） | `giveItem` 只是 UI 圖示，可先省略 |
| `stories[].quest` | `sideQuests[].fromCampusInfo` | 側任務名稱放 `sideQuests[]` |

---

## 5. 待查證清單（交研究者）

1. 【待查證：第 ⑤ 章「社團擺攤、海報牆」是否納入 campus-info 的 `SC.facts`；否則刪該句】
2. 【待查證：第 ⑥ 章橫幅「西子夕照」是否可用；不提「高雄八景」】
3. 【待查證：隧道扁額實際題字，決定 art-direction §5 #5 的貼圖文字】
4. 【待定位：ch3 門廊、ch4 2F 平台、ch5 長廊南端、ch2 洞內點、海堤座位、阿灣常駐點的世界座標】——實作時在場景內讀 `campusWalk` 填入
5. 阿灣所有台詞不含新的史實；若研究者更動 campus-info 任一句，對應 `dialogue[].fact` 標記的句子要同步改
