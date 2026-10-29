# 山海之間・NPC 名單與分支對話 v4

版本 2026-10-20・作者 Fable（narrative）。搭配 `art-direction-v4.md`（§8.4 NPC 視覺原型、§9 肖像、§10 對話框）。主線六章沿用 `public/data/chapters.json` 的台詞與觸發，本文不改主線；`guide`／`s1`／`s2`／`s3`／`m1` 五個既有 id 與其 zone、model 性別一律沿用（`s1` 為 `np2` 女生、`s2` 為 `np4` 男生＝「學長」、`s3` 為 `np5` 女生）。

史實只用 `nsysu-history-v3.md`「已二次查證」表中 **狀態為 ✅ 的列**；⚠ 與 ❌ 列一律不出現在 NPC 台詞與問答。所有人物、店名、社團名皆為原創，不影射真人；日常校園生活（上課、看夕陽、猴子搶食）屬通用情境。

> 一致性提醒（不在本文處理，交給資料維護者）：`chapters.json` 的 `c1-done`／`c2-done` 旁白用了「1979 籌備處」「1927／1928 隧道」兩句，在查證表中是 ⚠（年份核實但措辭須對齊校方），不是 ✅。本文的 NPC 與問答**不**引用這兩句。

---

## 0. 通則

### 0.1 玩家暱稱

開場命名（≤ 8 字，預設「新生」）；對話以 `{player}` 代入。v3 草稿「阿灣不叫玩家名字」的規則**取消**：所有 NPC 都可直接用 `{player}`（UI 名牌也顯示暱稱）；「我叫 {player}」之類的自我介紹選項只是風味分支，設旗標、改一兩句後續台詞，不是叫名字的前提。

### 0.2 效果標記（對應 `src/story/schema.ts`）

| 標記 | 對應 schema | 說明 |
|---|---|---|
| `[flag:x]` | `setFlag` | 既有 |
| `[unlock:side-id]` | `unlockSideQuest` | 既有（`sideQuests[]` 需新增本文列的 id） |
| `[sky:sunset]` | `setSky` | 既有 |
| `[sfx:id]` | `playSound` | 既有 |
| `[move:npc,zone]` | `moveNpc` | 既有 |
| `[give:item-id]` | **新增** `giveItem` | 寫入背包；冪等 |
| `[stamp:id]` | **新增** `stamp` | 印章；冪等 |
| `[achv:id]` | **新增** `achievement` | 成就 |
| `[minigame:id]` | **新增** `startMinigame` | 進入小遊戲，結束後回到同一 NPC 的 `after-*` 節點 |
| `[changes-later-line]` | — | 註記：此選擇會改變該 NPC（或他人）之後的台詞，實作上是 `[flag:]`＋對話節點 `if flag` |
| `[if flag:x]`／`[if item:x]`／`[if preset:sunset]`／`[if stamps<n]` | **新增** 對話節點條件 | 節點顯示條件；`stamps` 為已取得的集章數（§6.2 的 10 枚） |
| `[once]` | — | 該節點只播一次，之後跳到 `repeat` 節點 |

沒有好感度數值；分支只改旗標、物品、印章與後續台詞。主線六章永遠可完成，所有支線皆可略過。

### 0.3 對話樹寫法

```
root（條件）: 台詞 1／台詞 2
  > 選項文字 → 分支台詞… [效果]
      >> 二層選項（少數）
repeat: 第二次以後的短句
```

一句 ≤ 28 字、一段 ≤ 2 句（沿用 v3 說話規則）。肖像表情以 `(smile)`、`(surprised)`、`(troubled)` 標在句首，未標為 `neutral`。

### 0.4 作息（以三個光照預設為時段）

| 預設 | 意義 | 同時可見 NPC 上限（Tier A／B／C） |
|---|---|---|
| `day` | 上課日白天 | 12／8／5 |
| `sunset` | 傍晚下課後 | 12／8／5 |
| `night` | 晚上 | 8／6／4 |

每位 NPC 列「day／sunset／night」三個位置；「—」表示不出現（回宿舍、下班、猴子睡了）。位置用 `story-zones.json` 的 zone id，或 `campus-info.json` `stories[].pos` 的座標（x 東、z 南），或建築代碼（`AD`、`IL`、`SC`、`EN`、`ACTIVITY`、`MS`、`YH`、`GALLERY`）＋相對描述。

---

## 1. 名單總表（20 個 id）

| # | id | 稱呼 | 原型 | 主要地點 | day／sunset／night | 功能 |
|---|---|---|---|---|---|---|
| 1 | `guide` | 阿灣 | 學生（海科大三） | 隨章節移動；自由模式 `seawall` | 章節位置／章節位置／`seawall` | 主線導覽、自由模式閒聊 |
| 2 | `s1` | 小禾 | 學生（新生，女） | `gate` | `gate`／`admin` 階梯下／— | 同梯新生，隨玩家進度改變位置與台詞 |
| 3 | `s2` | 建宇學長 | 服務台 | `admin` | `admin`／`admin`／— | 學生證；報到補充 |
| 4 | `s3` | 佩蓉學姊 | 圖書館櫃台 | `library` | `library`／`library`／`library`（閉館前） | 借書；3F 特藏室 |
| 5 | `m1` | 猴學長 | 獼猴 | `arcade` | `arcade`／`arcade`／— | 主線猴子事件；觀察型對話 |
| 6 | `guard-chung` | 阿忠伯 | 警衛 | `gate` | `gate`／`gate`／`admin`→`seawall` 巡邏 | 校門規矩、夜巡事件、夜貓印章 |
| 7 | `clerk-jie` | 小潔 | 店員 | `ACTIVITY` 2F「海風小舖」 | 店／店／店 | 賣飲料與麵包（猴子追逐的食物來源） |
| 8 | `coffee-kai` | 阿凱 | 店員（咖啡車） | `arcade` 中段 | 車／車／— | 咖啡、八卦、改變志工台詞 |
| 9 | `photo-ju` | 小橘 | 學生（攝影社社長） | `seawall` | `IL` 前試鏡頭／`seawall`／`seawall` | **小遊戲：海堤夕照** |
| 10 | `quiz-dian` | 阿典 | 學生（校史迷） | `library` 大階梯 | `library`／`library`／`IL` 1F 門口 | **小遊戲：校史問答** |
| 11 | `monkey-volunteer-man` | 阿滿姐 | 志工 | `arcade` 東端 `[82,62]` | `arcade`／`arcade`／— | **小遊戲：猴子追逐**；四不宣導 |
| 12 | `m3-thief` | 大膽 | 獼猴（會搶食） | `arcade` 東端 | `arcade`／`seawall` 後方樹／— | 追逐小遊戲的主角 |
| 13 | `m2-mother` | 母猴（抱小猴） | 獼猴 | `tunnel-west` 坡上樹 | 樹上／樹上／— | 觀察型；不可接近的教學 |
| 14 | `jogger-po` | 阿柏 | 學生（運動） | 環校道路 | 跑 `gate`↔`admin`／跑 `seawall`／— | 移動 NPC；路線指引；計步成就 |
| 15 | `guitar-yun` | 允哲 | 學生（吉他社） | `arcade` 南端長椅 | `IL` 前／`arcade`／`arcade` | 夜間事件「長廊夜唱」 |
| 16 | `club-ocean-ting` | 小婷 | 學生（海洋研究社擺攤） | `arcade` 擺攤桌 | `arcade`／—／— | 白天事件「社團擺攤」；傳單道具 |
| 17 | `ta-lin` | 林老師（理學院助教兼講師） | 教職員（理學院） | `SC` 2F 走廊 SC2001 門外 | `SC`／`SC`／— | 教室指引、遺失隨身碟支線 |
| 18 | `gardener-hai` | 海伯 | 園丁 | `admin` 草坪 | `admin`／`bodhi [-67,-27]`／— | 樹與草的閒聊、落葉收集支線 |
| 19 | `poet-wen` | 文青學長 阿文 | 學生（文學院） | `IL` 2F 平台 | `library`／`seawall`／`library` | 余光中特藏室（✅）、原創短句 |
| 20 | `intl-mia` | Mia | 學生（國際生） | `library` | `library`／`arcade`／— | 帶路支線；改變後續台詞 |

（19 位可對話＋ `m2-mother` 為觀察型，共 20 個 id；`m1`、`m3`、`m2` 共用獼猴模型。）

---

## 2. 逐位設定與對話樹

### 2.1 `guide` 阿灣

- **外型**：沿用 v3（單馬尾、淺青外套 `#62c8d2`、深藍工裝褲、橘拖鞋、收起的傘、貼紙水壺）；v4 以新骨架重做，5.6 頭身。肖像 4 表情＋ `laugh`。
- **作息**：主線期間在當章 zone；完成 c6 後常駐 `seawall` 蘿蔔坑旁（`Sit`／`Idle`），night 仍在（c6-night 台詞已說她會待一會）。
- **個性**：話多、冷笑話、怕猴嘴硬、講到海就安靜（沿用）。
- **主線台詞**：完全依 `chapters.json`，不改。以下是**主線對話結束後再按 E** 的閒聊樹（每章一組），以及自由模式樹。

```
c1-extra（c1.talked 後，gate）:
  (smile) 還有問題？趁我還在這裡問。
  > 「妳為什麼叫阿灣？」 → 本名有個灣字，爸媽在這片海邊約會取的。／俗嗎？我也覺得。但懶得改。 [flag:wan.name] [changes-later-line]
  > 「猴子真的那麼多？」 → (troubled) 多。食物收好，牠們比你早畢業。／長廊有志工阿滿姐，她比我會講。
  > 「我叫 {player}。」 → (smile) {player}，好，記住了。這個我不會考，放心。 [flag:player.introduced] [changes-later-line]（之後 repeat 句改為「{player}，走吧，隧道口見。」）
  repeat: 走吧，隧道口見。

c3-extra（c3.card 後，admin）:
  > 「銅獅真的戴過帽子？」 → 真的，2024 年 12 月，紅白毛帽加圍巾。／我有拍，照片不給你看。 （✅ 銅獅列）
  > 「報到還要做什麼？」 → 學生證拍照存起來，學長說的。／然後去圖資大樓借第一本書。
  > 「你怕猴子吧？」 → (surprised) 誰說的！……傘是防曬。 [flag:wan.monkey-tease] [changes-later-line]

c4-extra（c4.book 後，library）:
  > 「余光中特藏室在哪？」 → 三樓，借還書也在三樓。／想看就上去，不用問我。 （✅ 3F 列）
  > 「圖書館以前在哪？」 → 以前擠在行政大樓，後來先搬到這棟十樓。 （✅ 圖書館遷館列）
  > 「阿典是誰？」 [if flag:quiz.met] → 校史迷。他問你問題不要亂猜，他會記仇。

free-mode（c6 完成後，seawall）:
  (smile) {player}，又來發呆？坐。
  > 「再講一次某一章」 → 開章節選單（UI），不另寫台詞。
  > 「印章收齊了嗎？」 → [if stamps<10] 還差幾個，慢慢來。四年很長。／[if stamps==10] (laugh) 全收？你比我還熟。 [achv:collector]
  > 「妳怕猴子吧？」 [if flag:wan.monkey-tease] → (troubled) ……好啦，怕。不要講出去。 [stamp:secret-wan]
  > [if preset:night]「要不要回去了？」 → 再五分鐘。警衛阿忠伯會來趕，到時再走。
  repeat: 背後是山，前面是海。坐就對了。
```

### 2.2 `s1` 小禾（同梯新生）

- **外型**：`np2` 女生，紅上衣 `#e04b3a`、米白短褲、新背包標籤還沒剪、手拿報到資料夾。肖像：短鮑伯、圓眼。
- **作息**：day `gate`（c1 期間）→ 完成 c3 後 day／sunset 移到 `admin` 階梯下；night —。
- **個性**：迷路專家、嘴硬假裝熟、其實很緊張。

```
root（gate，c1 前後）: 既有 c1-s1 三句不變；之後：
  > 「一起走吧。」 → (smile) 好！那你走前面，我負責看起來很熟。 [flag:s1.together] [changes-later-line]
  > 「報到在行政大樓，走隧道方向。」 → 我記下了。你先走，我拍張校碑再去。 [flag:s1.solo]
  > 「你也怕猴子？」 → (surprised) 誰不怕！……我帶了麵包，不行嗎？ [flag:s1.bread] [changes-later-line]

admin（c3 後，階梯下）:
  [if flag:s1.together] (smile) {player}！我比你早到，厲害吧。／其實是跟著指示牌。
  [if flag:s1.solo] 校碑那張拍得不錯。你要看嗎？不給看。
  [if flag:s1.bread] (troubled) 麵包被猴子盯上了，我丟了。／阿滿姐說不可以餵，我沒餵，是牠自己拿的……
  > 「要一起去圖資大樓嗎？」 → 不了，我要先找宿舍。晚點長廊見。 [flag:s1.dorm]
  > 「有看到阿灣嗎？」 → 剛剛往圖資大樓走了，馬尾很好認。
  > 「加個好友？」 → (smile) 好。你叫 {player} 對吧？我記得。 [give:item-sticker-he]（小禾的貼紙） [stamp:friend]
  repeat: 四年很長，先找到廁所比較重要。
```

### 2.3 `s2` 建宇學長（行政大樓服務台）

- **外型**：`np4` 男生，白襯衫＋服務台背心 `#2c7f91`、名牌、黑框眼鏡、袖子捲起。肖像：濃眉、嘴角下垂但眼睛笑。
- **作息**：day／sunset `admin` 門廊服務桌；night —。
- **個性**：冷面熱心、講話像在念 SOP、偶爾吐槽。

```
root（c3-desk 之後再按 E）:
  還有事？排隊的人不多，問吧。
  > 「學生證掉了怎麼辦？」 → 來這裡補辦。所以第一件事就是拍照存起來。／我說過了，對，我會一直說。
  > 「校訓是什麼？」 → 博學、審問、慎思、明辨、篤行。／考試不考，但阿典會考。 （✅ 校訓列） [flag:s2.motto]
  > 「校慶什麼時候？」 → 11 月 12 日。那天圖書館也有故事，問櫃台學姊。 （✅ 校慶列） [flag:s2.anniv]
  > 「你每天都在這？」 → 服務學習時數。下次見面可能是期中考。／或者你又把學生證弄丟。
  repeat: 名字我記得了，{player}。學生證別弄丟。
```

### 2.4 `s3` 佩蓉學姊（圖資大樓櫃台）

- **外型**：`np5` 女生，紫上衣 `#7b4a8f` 外罩館員背心、長髮盤起插一支筆、推一台還書車。肖像：細框眼鏡、溫和。
- **作息**：day／sunset `library` 2F 入口櫃台；night 櫃台（閉館前，台詞變短）。
- **個性**：溫和、愛推書、對逾期書有執念。

```
root（c4-desk 之後）:
  書拿好了？還想問什麼？
  > 「余光中特藏室可以進去嗎？」 → 三樓，可以參觀。／他當過文學院院長，特藏室放的是相關資料。 （✅ 3F、院長列） [flag:s3.yu] [stamp:library-3f]
  > 「圖書館什麼時候搬來的？」 → 以前在行政大樓。民國 77 年 8 月先搬到這棟十樓，78 年 11 月 12 日全面開館。／對，校慶那天。 （✅ 遷館、開館列）
  > 「推薦一本書？」 → (smile) 第一本自己選，比較有意思。／選完告訴我，我會記得。 [flag:s3.recommend] [changes-later-line]
  night-root: 快閉館了，書先還不還都行，但別留在海邊。
  repeat: [if flag:s3.recommend] 選好了嗎？沒有？那就再逛一圈。／[else] 到期前記得還。
```

### 2.5 `m1` 猴學長（理工長廊固定獼猴）

- **外型**：成年公猴，坐姿 `Sit`，背對牆，眼神直視。肖像：獼猴正面，表情只有 `neutral`／`surprised`。
- **作息**：day／sunset `arcade` offset `[10,-8]`（既有）；night —。
- **對話**：觀察型，全部用（）描述，沒有選項效果以外的「對話」。

```
root（c5-monkey 之後再靠近）:
  （猴學長抓了抓頭，繼續盯著你的背包。）
  > 「慢慢後退。」 → （牠沒有動。你安全離開了。）[flag:m1.retreat] [stamp:monkey-rule]（首次）
  > 「對牠揮手。」 → （牠露出牙齒。阿灣的聲音從遠處傳來：「不要對視！」）[sfx:monkey]
  > 「拿出麵包。」 [if item:bread] → （牠一瞬間站起來。你立刻把麵包塞回背包——好險。）／（不餵食、不外露食物。你記住了。）[flag:m1.tempted]（✅ 四不列；無正向結果）
  repeat: （牠在打盹。別吵牠。）
```

### 2.6 `guard-chung` 阿忠伯（校門警衛）

- **外型**：深藍制服 `#2a3a5c`、帽、對講機、肚子微凸、拖鞋（違規但沒人管）。肖像：白眉、方臉、笑起來瞇眼。
- **作息**：day／sunset `gate` 警衛亭旁；night 巡邏路線 `admin` → `seawall`（來回，每趟 90 s），手電筒光束。
- **個性**：嘴碎、什麼都知道一點、把學生當孫子。
- **事件**：night「夜巡」（§5）。

```
root（gate，day／sunset）:
  新生？報到往裡面走。別站路中間，車會按喇叭。
  > 「校碑有多高？」 → 21.2 公尺。你問我幾次我都答得出來。／迷路就找它。 （✅ 校碑列） [flag:guard.height]
  > 「隧道那邊有什麼？」 → 隧道旁邊有坑道，戰時當防空用的。以前不開放，別亂鑽。 （✅ 坑道列）
  > 「晚上校門會關嗎？」 → 不關，但我會巡。看到你在海堤發呆我會叫你回去。 [flag:guard.night-warned] [changes-later-line]
  repeat: 去去去，報到要排隊的。

night-root（巡邏途中靠近）:
  (troubled) 這麼晚還在外面。[if flag:guard.night-warned] 我說過我會叫你回去吧。
  > 「再看一下夜景。」 → 好啦，十分鐘。猴子睡了，但我沒睡。 [stamp:night-owl]（首次）[achv:night-walk]
  > 「阿灣還在海堤。」 → 她喔，從大一坐到大三。你們兩個一起回去。
  > 「我回去了。」 → 乖。路燈下面走。
```

### 2.7 `clerk-jie` 小潔（海風小舖店員，活動中心 2F）

- **外型**：圍裙 `#e8b84a`、鴨舌帽、馬尾、手上條碼槍。肖像：圓臉、雀斑、愛笑。
- **作息**：day／sunset／night 都在店（night 台詞改「快打烊」）。
- **個性**：熱情推銷、講話快、記得每個常客的口味。
- **地點**：`ACTIVITY` 2F 原創店「海風小舖」（不用真實便利商店名）。

```
root:
  歡迎～新生？第一次來送你一張集點卡。 [give:item-stamp-card]（首次）
  > 「買一瓶飲料。」 → 冰的？好。拿去。 [give:item-drink]（可重複，背包上限 1）
  > 「買麵包。」 → (smile) 麵包喔……長廊那邊猴子很多，你放包包裡再走。 [give:item-bread] [flag:bread.bought] [changes-later-line]
  > 「這裡有賣什麼？」 → 飲料、麵包、文具、雨衣。／雨衣很重要，這裡的雨說來就來。
  after-chase（[if flag:chase.done]）: (laugh) 聽說你被大膽追了？我說過要放包包裡。 [stamp:shop-regular]（第三次購買後）
  night-root: 快打烊了，要買快。
```

### 2.8 `coffee-kai` 阿凱（長廊咖啡車）

- **外型**：圍裙 `#2a2c4a`、手臂刺青（原創浪花圖樣）、短髮、戴耳機一邊。肖像：瘦長臉、挑眉。
- **作息**：day／sunset `arcade` 中段咖啡車「長廊咖啡」；night —。
- **個性**：話少但消息靈通；用咖啡換八卦。

```
root:
  今天美式、拿鐵。你看起來需要後者。
  > 「一杯拿鐵。」 → 來。第一杯算你的新生價——免費。 [give:item-latte]（首次）[flag:kai.latte]
  > 「長廊的猴子怎麼回事？」 → 東邊那隻叫大膽，專搶塑膠袋。／阿滿姐在那邊守，去找她，她缺幫手。 [flag:kai.tip] [changes-later-line]（志工首句改為「阿凱叫你來的？」）
  > 「你為什麼在這裡擺車？」 → 下雨不用傘、人多、有插座。長廊就是這樣。
  > [if flag:s1.dorm]「有看到一個紅衣服新生嗎？」 → 拿資料夾那個？往宿舍方向去了，走得很快。
  repeat: 第二杯要錢。
```

### 2.9 `photo-ju` 小橘（攝影社社長）—— 小遊戲「海堤夕照」

- **外型**：橘色風衣 `#f27a2c`、相機背帶、短髮染一撮橘、腳架斜背。肖像：單眼皮、嘴角一邊上揚。
- **作息**：day `IL` 前試鏡頭；sunset／night `seawall` 蘿蔔坑上方欄杆邊架腳架。
- **個性**：直接、只在乎構圖、對「手機直出」有意見但也接受。

```
root（day，IL 前）:
  等光。你要拍就傍晚來海堤，現在不值得。
  > 「怎麼去海堤？」 → 往校門方向，校碑旁邊。看到消波塊就到了。
  > 「你在拍什麼？」 → 皇冠。圖資大樓的屋頂，大家都這樣叫。
  repeat: 傍晚，海堤。別遲到。

root（sunset／night，seawall）:
  來了。今天雲不錯。要不要比一張？
  > 「比什麼？」 → 夕陽入鏡、海平線要平、人要在三分之一線。三張裡選一張。 [minigame:sunset-photo]
  > 「我用手機拍可以嗎？」 → (troubled) ……可以。構圖比器材重要，我說服自己。 [minigame:sunset-photo]
  > 「我先看你拍。」 → （她按下快門。）就這樣。輪到你。 [minigame:sunset-photo]
  after-sunset-photo:
    [score ≥ 2/3] (smile) 可以。社團下次活動你來。 [stamp:photo-gold] [give:item-photo-print] [achv:golden-hour]
    [score 1/3] 海平線歪了。再來。 [stamp:photo-bronze]（首次）
    [score 0] 你把太陽切掉了。再一次，不急。
  night-root: 夜景也可以，長曝光。但你沒腳架，先看看就好。
```

**小遊戲「海堤夕照」規格**：`[sky:sunset]` 鎖定；進入拍照模式（art-direction-v4 §11.4）；三個判定：太陽在畫面內、海平線傾斜 < 3°、玩家或 NPC 在畫面三分線 ±8% 內；每達成一項 1 分；三張快門取最高分。失敗無懲罰，可重玩。

### 2.10 `quiz-dian` 阿典（校史迷）—— 小遊戲「校史問答」

- **外型**：格子襯衫、肩背舊帆布包、胸前掛一疊自製小卡；頭髮中分。肖像：細長眼、推眼鏡動作。
- **作息**：day／sunset `library` 大階梯中段坐著；night `IL` 1F 門口（閉館後不走）。
- **個性**：考據狂、說「我有來源」、不接受「大概」。

```
root:
  新生？我是阿典。校史我有來源，想不想被考一下？
  > 「來吧。」 → 五題，答對三題給印章。沒答對也不會怎樣，只是我會記得。 [minigame:history-quiz] [flag:quiz.met]
  > 「先給我提示。」 → 服務台學長講過校訓、櫃台學姊講過開館日。／去聽，再回來。 [flag:quiz.hinted]
  > 「你為什麼這麼熟？」 → 因為每句都有出處。沒出處的我不說。
  after-quiz:
    [≥ 3/5] (smile) 可以。你有在聽。 [stamp:quiz-master]（首次）[give:item-history-card]
    [5/5] (surprised) 全對？再來十題進階版。 [achv:historian] [flag:quiz.perfect]（解鎖第二輪：另外五題）
    [< 3] 回去再走一遍，答案都在路上。 [flag:quiz.failed]
  repeat: [if flag:quiz.perfect] 全對的人不多。／[else] 再考一次？
```

**小遊戲「校史問答」規格**：每輪從 §4 題庫隨機抽 5 題（第一輪只抽 Q1–Q10 的前 8 題中隨機 5 題；第二輪抽全部），四選一，答錯立刻顯示正解＋出處列；無計時；不扣分。

### 2.11 `monkey-volunteer-man` 阿滿姐（防猴志工）—— 小遊戲「猴子追逐」

- **外型**：反光背心 `#b7e04a`、袖套、斗笠、哨子、手拿長柄傘。肖像：黝黑、大笑紋。
- **作息**：day／sunset `arcade` 東端 `[82,62]`（既有 `monkeys` 寶石旁）；night —。
- **個性**：大嗓門、宣導狂、對猴子有感情但絕不心軟。

```
root:
  [if flag:kai.tip] 阿凱叫你來的？好，缺人手。／[else] 新生！站住。食物收好了沒？
  > 「收好了。」 → 很好。四不：不外露食物、不餵食、不接觸、不攻擊。／再講一次，你跟著念。 （✅ 四不列） [flag:rule.learned] [stamp:monkey-rule]（若尚未取得）
  > 「牠們會攻擊人嗎？」 → 通常不會。牠兇你，就不要對看，慢慢走開。 （✅ 四不列）
  > 「我可以幫忙嗎？」 [if flag:rule.learned] → 來。大膽剛搶了一袋麵包，你去把袋子撿回來，不要追到牠身上。 [minigame:monkey-chase]
  after-monkey-chase:
    [成功] (laugh) 撿回來了？好，袋子給我，麵包牠已經吃了。／記住，是你的塑膠袋引牠來的。 [stamp:monkey-guard] [achv:no-feeding] [flag:chase.done] [changes-later-line]
    [失敗] 追太近了。牠跑進山裡，袋子也沒了。再來一次。
  repeat: 四不。你念一遍。
```

**小遊戲「猴子追逐」規格**（訊息：**不要餵猴，食物收好**）：
1. 觸發：玩家背包有 `item-bread` 且在 `arcade` 東端 15 m 內時，`m3-thief` 播 `Grab`，背包圖示消失，猴子叼著袋子沿預設路線（長廊東端→坡地→樹上）`Flee`。
2. 玩法 60 s：跟在猴子 **3–6 m** 之間（太近牠加速並掉頭露牙；太遠袋子掉在地上被風吹）。牠每 10 s 停下翻袋子，期間玩家按 E「撿起掉出的東西」（3 次）。
3. 結束：撿滿 3 次＝成功（袋子回收、麵包沒了）；追到 < 1.5 m 或 60 s 到＝失敗。
4. 畫面提示只有「保持距離」「不要對視」兩句；**沒有任何丟食物、引誘的操作**。
5. 成功後 `clerk-jie` 與 `guide` 有新台詞。

### 2.12 `m3-thief` 大膽（會搶食的獼猴）

- **外型**：較瘦、尾巴有缺口（辨識點）、動作快。
- **作息**：day `arcade` 東端樹上（`Idle` 搔頭）；sunset `seawall` 後方樹上；night —。
- **對話**：靠近時只有（）描述。

```
root: （大膽盯著你的包包。尾巴缺一截，就是牠。）
  > 「退開。」 → （牠失去興趣。）
  > 「拿出食物。」 [if item:bread] → 觸發小遊戲（見 2.11，若已跟阿滿姐學過四不；否則）→ （牠一把抓走袋子！阿滿姐的哨聲響起。）[minigame:monkey-chase]（未學四不也可進入，但失敗率不變）
```

### 2.13 `m2-mother` 母猴（抱小猴）

- **外型**：抱著小猴，`Carry` 姿勢，坐在 `tunnel-west` 坡上樹幹。
- **對話**：不可互動到 2 m 內（進入 4 m 時阿灣或旁白提示）。

```
root（4 m）: （母猴抱著小猴看你。阿灣遠端：「有小猴的不要靠近，媽媽會緊張。」）
  > 「拍一張就走。」 → （你遠遠拍了一張。）[give:item-photo-monkey] [stamp:macaque-family]
  > 「慢慢離開。」 → （牠低頭繼續理毛。）
```

### 2.14 `jogger-po` 阿柏（跑步的學生）

- **外型**：運動背心 `#3d7a4a`、短褲、頭帶、手錶；永遠在 `Run`。肖像：曬痕、喘氣笑。
- **作息**：day 繞 `gate`↔`admin` 道路；sunset 繞 `seawall`；night —。靠近 < 3 m 時減速到 `Walk` 並對話，離開後繼續跑。
- **個性**：講話斷句短、用公里數形容距離。

```
root:
  呼——新生？別停，邊走邊講。
  > 「行政大樓怎麼走？」 → 隧道口往前，右手邊紅磚那棟，兩隻獅子。
  > 「你每天跑幾圈？」 → 三圈。校門到海堤來回。／今天多一圈，因為你問。
  > 「一起跑？」 → 跟得上就來。 [flag:jog.joined] → 玩家在 30 s 內跟在 5 m 內 → (laugh) 不錯。 [stamp:three-laps]（累計三次）[achv:runner]
  repeat: 跑了。有事海堤見。
```

### 2.15 `guitar-yun` 允哲（吉他社）

- **外型**：連帽外套 `#6b6f78`、吉他袋、長瀏海。肖像：垂眼、耳機。
- **作息**：day `IL` 前長椅調音；sunset／night `arcade` 南端長椅彈唱（night 觸發事件「長廊夜唱」）。
- **個性**：害羞但一唱歌就不同人；歌詞原創。

```
root（day）:
  ……在調音。有事？
  > 「你晚上會表演？」 → 長廊，天黑以後。不是表演，是練習。／有人聽就變表演了。 [flag:yun.invited]
  > 「唱一段？」 → (troubled) 現在不行。晚上。
root（night，事件中）:
  [if flag:yun.invited] 你來了。坐。／[else] 坐吧，反正也沒人。
  > 「點歌：海的歌。」 → （他唱了一段原創短歌，歌詞只有：山在後面，海在前面，路自己走。）[stamp:night-song] [achv:audience]
  > 「點歌：隧道的歌。」 → （他唱了一段關於回音的歌。）[stamp:night-song]
  > 「安靜聽。」 → （他點點頭。）
  repeat: 明天還會在。
```

### 2.16 `club-ocean-ting` 小婷（海洋研究社擺攤）

- **外型**：社團 T `#2c7f91`、海報筒、擴音器。肖像：高馬尾、大笑。
- **作息**：day `arcade` 擺攤桌（事件「社團擺攤」）；sunset／night —。
- **個性**：招募狂、每句結尾都是「加入嗎」。

```
root:
  海洋研究社！新生加入嗎？
  > 「你們做什麼？」 → 浮潛、淨灘、看海。／海科系的阿灣學姊也是社員，她沒跟你說？ [flag:ting.wan]
  > 「給我一張傳單。」 → 拿去！上面有活動時間……是原創的，別真的去等。 [give:item-flyer-ocean] [stamp:club-fair]
  > 「我考慮一下。」 → 考慮就是加入的開始。
  [if item:flyer-ocean] repeat: 傳單拿了就是社員了（不是）。
```

### 2.17 `ta-lin` 林助教（理學院）

- **外型**：白袍 `#f4f1ea`、內搭 `#7b4a8f`、抱一疊考卷、識別證。肖像：黑眼圈、淡笑。
- **作息**：day／sunset `SC` 2F 走廊 SC2001 門外；night —。
- **個性**：累但好心、講話很精準。

```
root:
  SC2001？就這間。你是來上課還是來找路？
  > 「來找路。」 → 理學院二樓，長廊走到底上樓。記住樓梯的位置。 （✅ SC2001 列）
  > 「你在找什麼？」 → 隨身碟。藍色的，長廊某張長椅。／找到給我，我請咖啡。 [unlock:side-usb]（支線：長廊三張長椅之一有藍色隨身碟 `item-usb`）
  > [if item:usb]「這是你的？」 → (surprised) 是！謝謝。阿凱那邊一杯拿鐵，記我帳。 [flag:usb.returned] [stamp:good-samaritan]（阿凱 repeat 改為「助教說的那杯？拿去。」）[changes-later-line]
  repeat: 考卷還沒改完。有事快問。
```

### 2.18 `gardener-hai` 海伯（園丁）

- **外型**：反光背心、斗笠、長柄掃帚、推車。肖像：皺紋笑、缺一顆牙。
- **作息**：day `admin` 草坪掃落葉；sunset `bodhi [-67,-27]` 菩提樹下休息；night —。
- **個性**：話慢、對每棵樹有稱呼、不談史實只談樹。

```
root（day）:
  掃不完。鳳凰木一開花就掉，榕樹一年四季都掉。
  > 「這些樹幾歲？」 → 比你老。多老我不說，說了你也不記得。
  > 「我幫你掃？」 → 好。中庭五堆落葉，撿回來。 [unlock:side-leaves]（撿 5 處落葉貼花）
  > [if flag:leaves.done]「撿完了。」 → (smile) 手腳快。這個給你，樹上掉的。 [give:item-seed-pod]（鳳凰木莢果）[stamp:green-thumb]
root（sunset，菩提樹下）:
  這棵最老。大家在這裡開過會、吵過架、也睡過午覺。（不引用公投細節；支線 `story-bodhi` 由寶石卡講）
  > 「坐一下？」 → 坐。樹下涼。 [achv:under-the-bodhi]
```

### 2.19 `poet-wen` 阿文（文學院學長）

- **外型**：襯衫 `#efe6d1` 扣到最上、筆記本、鉛筆插耳。肖像：瀏海遮一眼、微笑。
- **作息**：day `IL` 2F 平台欄杆邊；sunset `seawall` 蘿蔔坑最南端；night `library` 1F 門口。
- **個性**：講話像寫句子、不念名家的詩（避免引用問題），只念自己的。

```
root（library）:
  站這裡看中庭，整個校園在你腳下。這句不是我寫的，是每個人都會說的。
  > 「你在寫什麼？」 → 短句。海、山、長廊。／不好意思給人看，但可以念一句：「紅磚記得每一場雨。」 [stamp:poem]
  > 「余光中特藏室在這棟？」 → 三樓。他當過文學院院長，我們院的。／我不念他的詩，你自己上去看。 （✅ 3F、院長列）
  > 「為什麼不念？」 → 念了就不是我的了。
root（seawall，sunset）:
  這個時候不要講話。看。
  > 「……」 → （你們一起看了一分鐘。）[achv:silence]
```

### 2.20 `intl-mia` Mia（國際生）

- **外型**：連帽外套 `#2f5fa8`、大背包、手機地圖。肖像：捲髮、困惑表情是常態。
- **作息**：day `library` 大階梯下；sunset `arcade`；night —。
- **個性**：中文很努力、把「理工長廊」念成「理公長廊」、很感謝人。

```
root（library，day）:
  Hi！請問……SC2001？我找不到。
  > 「我帶你去。」 → (smile) 謝謝！跟你走。 [flag:mia.escort]（Mia 跟隨到 SC2001 門口）→ 到達後：找到了！你是 {player}？我記住了。 [stamp:good-samaritan]（若尚未）[flag:mia.done] [changes-later-line]
  > 「長廊走到底上二樓。」 → 長廊……理公長廊？好，我試試。 [flag:mia.told]
  > 「問林助教。」 → 林助教？在哪裡？……好吧，我找找。
root（arcade，sunset）:
  [if flag:mia.done] {player}！今天謝謝你。我請你喝咖啡，阿凱說第一杯免費……那下次。／[if flag:mia.told] 我找到了！走了三次。／[else] 我還在找。
  > 「你從哪裡來？」 → 很遠的地方。這裡的海跟我家很像。
  > 「要一起去海堤嗎？」 → 海堤？蘿蔔坑？大家都說。好！ [flag:mia.seawall]（她 sunset 之後出現在海堤）[changes-later-line]
```

---

## 3. 小遊戲總覽

| id | 主持 NPC | 地點／時段 | 核心訊息 | 獎勵 |
|---|---|---|---|---|
| `sunset-photo` | `photo-ju` | `seawall`，鎖 `sunset` | 構圖：太陽、海平線、三分線 | `stamp:photo-gold/bronze`、`item-photo-print`、`achv:golden-hour` |
| `monkey-chase` | `monkey-volunteer-man`（觸發者 `m3-thief`） | `arcade` 東端 → 坡地，day／sunset | **不餵食、食物收好、保持距離、不對視**（✅ 四不） | `stamp:monkey-guard`、`achv:no-feeding` |
| `history-quiz` | `quiz-dian` | `library` 大階梯，任何時段 | 只有 ✅ 史實 | `stamp:quiz-master`、`item-history-card`、`achv:historian` |

---

## 4. 校史問答題庫（10 題，全部出自 `nsysu-history-v3.md` ✅ 列）

格式：題目／四選項（★ 為正解）／出處列。答錯時顯示正解＋出處連結。

| # | 題目 | 選項 | 出處（查證表列） |
|---|---|---|---|
| Q1 | 校門口校碑標高幾公尺？ | 12.1／★21.2／30.5／19.8 | 「校門口校碑標高 21.2 公尺」✅ |
| Q2 | 海堤那排凹進去的座位，大家叫它什麼？ | 情人座／★蘿蔔坑／海景窗／貝殼位 | 「海邊雅座暱稱『蘿蔔坑』」✅（不出「兩人座」） |
| Q3 | 西子灣隧道旁的坑道群，戰時曾作為什麼用途？ | 倉庫／★防空避難／宿舍／實驗室 | 「隧道旁坑道群戰時作防空避難」✅（不出人數） |
| Q4 | 教室 SC2001 位於理學院幾樓？ | 1F／★2F／3F／B1 | 「SC2001 位於理學院 2F」✅ |
| Q5 | 2024 年 12 月，行政大樓前的銅獅戴上了什麼？ | 墨鏡／★紅白毛帽／花環／口罩 | 「銅獅耶誕期間戴過紅白毛帽、圍巾」✅（題幹寫明 2024-12，不寫「每年」） |
| Q6 | 校訓五項中，**不**包含下列哪一個？ | 博學／審問／★力行／篤行 | 「校訓『博學、審問、慎思、明辨、篤行』」✅ |
| Q7 | 校慶是哪一天？ | 10 月 10 日／★11 月 12 日／3 月 29 日／9 月 28 日 | 「校慶為 11 月 12 日」✅ |
| Q8 | 圖書館全面開館前，原本設在哪一棟？ | 逸仙館／★行政大樓／理學院／活動中心 | 「圖書館原在行政大樓，77/08/01 先遷至圖資大樓十樓」✅ |
| Q9 | 圖書館全面開館的日期是？ | 1988-06-01／★1989-11-12／1980-07-01／1997-11-12 | 「圖書館 78/11/12（1989-11-12）全面開館」✅ |
| Q10 | 借還書服務與余光中特藏室都在圖資大樓幾樓？ | 1F／2F／★3F／10F | 「借還書服務與余光中特藏室都在 3F」✅ |

第二輪（`quiz.perfect` 後）備用題，同樣只用 ✅ 列：

| # | 題目 | 選項 | 出處 |
|---|---|---|---|
| Q11 | 余光中曾擔任本校哪個學院的院長？ | 海科院／★文學院／管理學院／理學院 | 「余光中 1985/08–1991/07 任文學院院長」✅（題目不考年份） |
| Q12 | 校園獼猴宣導「四不」中，下列哪一項**不是**？ | 不餵食／不接觸／★不拍照／不攻擊 | 「獼猴宣導四不」✅ |
| Q13 | 民國 69 年（1980）秋季首次招生時，共成立幾系幾所？ | 2 系 1 所／★4 系 2 所／6 系 3 所／8 系 4 所 | 「1980 秋季開始招生，成立 4 系 2 所」✅ |
| Q14 | 1997 年識別標誌中，綠色山形代表什麼？ | 柴山步道／★壽山／半屏山／旗後山 | 「1997 年識別標誌：綠色山形為壽山、藍色筆觸為西灣」✅ |
| Q15 | 壽山動物園於哪一年在西子灣創立？ | 1968／★1978／1986／1990 | 「壽山動物園 1978 年於西子灣創立、1986 年遷至現址」✅ |

不入題的 ⚠／❌ 項目（備查）：1979 籌備處措辭、1927／1928 月份、隧道 260 m、2004 登錄、陳志慈作者名、圖資 12 層、行館年份細節。

---

## 5. 時段校園事件（4 個）

| 事件 id | 時段 | 地點 | 內容（視覺＋互動） | 參與 NPC | 獎勵 |
|---|---|---|---|---|---|
| `ev-club-fair` | `day` | `arcade` 中段 | 4 張擺攤桌、海報立牌、擴音器音效；8 個路人 NPC 聚集；走過任一桌觸發招募一句 | `club-ocean-ting`、`coffee-kai`、路人 ×8 | 傳單 `item-flyer-ocean`、`stamp:club-fair` |
| `ev-sunset-crowd` | `sunset` | `seawall` | 蘿蔔坑坐滿 10 個 NPC（含 `poet-wen`、`intl-mia`［若 `mia.seawall`］、`jogger-po` 停下來）、兩支腳架、海面高光帶；`photo-ju` 小遊戲開放 | `photo-ju`、`guide`、路人 ×8 | `achv:golden-hour`（小遊戲）、`achv:silence`（阿文） |
| `ev-night-song` | `night` | `arcade` 南端 | 柱廊燈管全亮、4 個 NPC 坐長椅、吉他聲（簡短原創 loop）；`guard-chung` 巡邏經過會停 10 s | `guitar-yun`、路人 ×4、`guard-chung` | `stamp:night-song`、`achv:audience` |
| `ev-macaque-alert` | `day`／`sunset`（隨機，每 6 分鐘一次） | `arcade` 東端 | 哨聲、防猴立牌閃一下、`m3-thief` 從樹上下來在欄杆上走 20 s；背包有麵包者會被盯上 → 進入追逐 | `monkey-volunteer-man`、`m3-thief`、`m1` | 見小遊戲 |

事件只改 NPC 位置、音效與道具可見性，不改主線條件；同時可見 NPC 數受 §0.4 上限控制（事件 NPC 優先，路人補到上限為止）。

---

## 6. 物品、印章與成就清單

### 6.1 物品（背包，Esc 選單）

`item-student-card`（c3）、`item-book`（c4）、`item-stamp-card`、`item-drink`、`item-bread`（會被搶）、`item-latte`、`item-flyer-ocean`、`item-photo-print`、`item-photo-monkey`、`item-history-card`、`item-usb`（支線）、`item-seed-pod`、`item-sticker-he`。圖示皆為原創紙卡語彙（art-direction-v4 §11）。

### 6.2 印章（10 枚集章＋ 10 枚隱藏）

集章 10 枚（對應 art-direction-v4 §11.3 的 10 個圖樣；`[if stamps<n]` 與 `achv:collector` 只數這 10 枚）：

| id | 圖樣 | 取得 |
|---|---|---|
| `gate` | 校碑 | 完成 c1（既有章節卡改為蓋章） |
| `tunnel` | 拱圈 | 完成 c2 |
| `admin` | 獅 | 完成 c3 |
| `library-3f` | 皇冠 | `s3` 特藏室分支 |
| `arcade` | 柱 | 完成 c5 |
| `seawall` | 蘿蔔坑 | 完成 c6 |
| `monkey-rule` | 猴 | `m1` 後退分支或 `monkey-volunteer-man` 四不（`monkey-guard` 取得時也補發） |
| `photo` | 相機 | 夕照小遊戲：`photo-bronze`（1 分）為銅版、`photo-gold`（≥ 2 分）為金版，同一格升級 |
| `quiz-master` | 問號 | 問答 ≥ 3/5 |
| `night-owl` | 月亮 | 夜巡遇警衛 |

隱藏 10 枚（不計入集章，顯示在印章頁第二列）：`secret-wan`、`friend`、`club-fair`、`night-song`、`poem`、`green-thumb`、`good-samaritan`、`three-laps`、`macaque-family`、`shop-regular`；另 `monkey-guard`（追逐成功）為隱藏第 11 枚。

### 6.3 成就（14 個）

`collector`（10 枚集章）、`night-walk`、`golden-hour`、`no-feeding`、`historian`、`runner`、`audience`、`under-the-bodhi`、`silence`、`friend-of-all`（與 15 位 NPC 各談過一次）、`chapter-done`（六章）、`side-all`（8 顆寶石）、`photo-album`（相簿 10 張）、`early-bird`（三個時段各與阿灣對話一次）。

---

## 7. 與既有資料的對應與待辦

| 項目 | 現況 | v4 需要 |
|---|---|---|
| `story-zones.json` `npcs` | 5 個 | 新增 15 個 id、`at`／`pos`、`schedule: {day, sunset, night}`、`model` |
| `chapters.json` `dialogues` | 線性 `Line[]` | 新增節點型（`{id, lines[], choices[], cond}`），舊線性格式保留為單節點 |
| `schema.ts` `Action` | 9 種 | 加 `giveItem`、`stamp`、`achievement`、`startMinigame`；`Condition` 加 `item`、`stamp` |
| `sideQuests[]` | 8 顆寶石 | 加 `side-usb`、`side-leaves`（非寶石型，用 flag 完成） |
| `ui.ts` `CAST` | 5 位肖像色 | 20 位＋4 表情 SVG（art-direction-v4 §9） |
| 模型 | `np1–np6`、`wan`、`monkey` | 依 §8.4 原型重做：學生 ×6 體型、教職員、櫃台、店員、警衛、志工、獼猴（＋ `Grab`／`Flee`／`Carry`） |

所有台詞中的史實句都標了出處列；若 `nsysu-history-v3.md` 更新狀態（✅ 改 ⚠），對應句與題目同步下架。
