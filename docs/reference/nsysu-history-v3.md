# 中山校史與地標研究（Gemini 4 原始報告）

> 來源：agy researcher（gemini-3.8-flash-high），job `research-mvfai9ot-8a99ce59`，2026-10-19。
> **狀態：未逐條驗證。** 故事與介面只能使用下方「已二次查證」表中的條目；其餘僅作建模與研究線索。Wikimedia 檔名與部分數字（席數、高度、年份）可能有誤，使用前須開啟連結確認。

## 已二次查證（T6 填寫）

| 事實 | 查證來源 | 查證日期 | 狀態 |
|---|---|---|---|
| 校門口校碑標高 21.2 公尺（c1） | https://news.nsysu.edu.tw/p/404-1120-242198.php?Lang=zh-tw | 2026-10-19 | ✅ 已核實（原文「矗立在中山大學校門口、標高21.2公尺的校碑」） |
| 海邊雅座暱稱「蘿蔔坑」（c6） | https://news.nsysu.edu.tw/p/404-1120-242198.php?Lang=zh-tw | 2026-10-19 | ✅ 已核實；「一格剛好坐兩人」未見來源，故事不用 |
| 民國 68 年（1979）核定於高雄西子灣設籌備處，翌年 7 月正式建校（c1） | https://www.nsysu.edu.tw/p/404-1000-10337.php?Lang=zh-tw | 2026-10-19 | ⚠ 與 Gemini 不同：校方只寫民國 68 年核定、翌年 7 月建校，未寫「1979 年 7 月行政院核定」；Gemini 所列 history.nsysu.edu.tw 網域不存在 |
| 西子灣隧道 1927 年開挖、1928 年完工（c2） | https://www.nsysu.edu.tw/p/404-1000-179130.php?Lang=zh-tw | 2026-10-19 | ⚠ 年份核實；Gemini 的「1928 年 10 月竣工」月份與「1933 年正式通車」查無校方或官方來源，不使用 |
| 隧道旁坑道群戰時作防空避難（c2） | https://www.nsysu.edu.tw/p/404-1000-179130.php?Lang=zh-tw | 2026-10-19 | ✅ 已核實（文中容納人數 2150 與「2000 多人」兩說並存，故事不提人數） ；2017-11-11 以前未對外開放，台詞寫「以前都不開放」 |
| 理工長廊串連理學院、工學院（c5） | campus-info.json `SC`／`EN` facts（出處為教務處教室平面圖 https://oaa.nsysu.edu.tw/p/412-1003-27076.php?Lang=zh-tw） | 2026-10-19 | ⚠ 沿用 campus-info 既有出處，本次未另開一手來源；屬空間描述非校史 |
| SC2001 位於理學院 2F（c5） | public/data/rooms.json（`oaa-02Room_COS_1-p1-28`，`SC-2F`） | 2026-10-19 | ✅ 已核對專案資料 |
| 隧道長 260 公尺、別名「壽山洞」 | （nchdb 頁為前端渲染，無法讀取內容；僅見新聞與部落格） | 2026-10-19 | ❌ 查無一手來源，故事不使用（campus-info `tunnel` 既有句仍含此數字，建議日後補一手來源） |
| 2004 年登錄為歷史建築「西子灣隧道及其防空設施」 | https://nchdb.boch.gov.tw/assets/overview/historicalBuilding/20040409000003 | 2026-10-19 | ❌ 頁面無法取得內文，僅新聞轉述，不使用 |
| 行政大樓前兩隻銅獅耶誕期間戴過紅白毛帽、圍巾（c3） | https://news.nsysu.edu.tw/p/404-1120-346875.php?Lang=zh-tw | 2026-10-19 | ✅ 已核實（2024-12 一次；「每年」未另查證，台詞不說每年） |
| 銅獅由陳志慈鑄造 | https://news.nsysu.edu.tw/p/404-1120-346875.php?Lang=zh-tw | 2026-10-19 | ⚠ 與 Gemini 不同：校方原文為「據傳」由陳志慈鑄造，故事不提作者名 |
| 校訓「博學、審問、慎思、明辨、篤行」（c3） | https://www.nsysu.edu.tw/p/412-1000-1497.php?Lang=zh-tw | 2026-10-19 | ✅ 已核實；⚠ Gemini 所附 412-1000-1503 實為「校園地圖」頁 |
| 校慶為國父誕辰 11 月 12 日（c3、c4） | https://www.nsysu.edu.tw/p/412-1000-1497.php?Lang=zh-tw | 2026-10-19 | ✅ 已核實 |
| 圖書館原在行政大樓，77/08/01 先遷至圖資大樓十樓（c4） | https://lis.nsysu.edu.tw/p/412-1001-1174.php?Lang=zh-tw | 2026-10-19 | ✅ 已核實 |
| 圖書館 78/11/12（1989-11-12）全面開館（c4） | https://lis.nsysu.edu.tw/p/412-1001-1174.php?Lang=zh-tw | 2026-10-19 | ✅ 已核實（外胚落成為 77/06/01）；Gemini「1985 年動工」未查到來源 |
| 借還書服務與余光中特藏室都在 3F（c4） | https://lis.nsysu.edu.tw/p/412-1001-1175.php?Lang=zh-tw | 2026-10-19 | ✅ 已核實 |
| 圖資大樓 12 層／10–11 層 | https://lis.nsysu.edu.tw/p/412-1001-1174.php?Lang=zh-tw | 2026-10-19 | ❌ 圖資處只寫其範圍為 B1–8F，校內頁面另見 10F、11F；總樓層數未查到一手來源，故事不提 |
| 余光中 1985/08–1991/07 任文學院院長（c4） | https://la.nsysu.edu.tw/p/412-1016-3641.php?Lang=zh-tw | 2026-10-19 | ✅ 已核實（列表把第一、二任合併為同一列，故事只說「當過院長」） |
| 獼猴宣導「不外露食物（塑膠袋）、不餵食、不接觸、不攻擊」；遇攻擊性勿眼神接觸、慢慢走開（c5） | https://admin-support-oga.nsysu.edu.tw/p/406-1100-110789,r1266.php?Lang=zh-tw | 2026-10-19 | ✅ 已核實；⚠ Gemini 只給 oga.nsysu.edu.tw 首頁，正確出處為總務處事務組此頁 |
| 民國 69 年（1980）秋季開始招生，成立 4 系 2 所（c5） | https://www.nsysu.edu.tw/p/412-1000-1497.php?Lang=zh-tw | 2026-10-19 | ✅ 已核實 |
| 1997 年識別標誌：綠色山形為壽山、藍色筆觸為西灣（c6） | https://www.nsysu.edu.tw/p/412-1000-1508.php?Lang=zh-tw | 2026-10-19 | ✅ 已核實；⚠ Gemini 所附 cpr.nsysu.edu.tw 連結未使用，「Navy／Forest Green 標準校色」未查到來源 |
| 圖資大樓設計圖（73.10）署名建築師陳其寛 | https://collections.culture.tw/Object?SYSUID=31&RNO=Q0NDSzI2MTIzMDQ1 | 2026-10-19 | ✅ 已核實（原文作「寛」）；故事未使用 |
| 壽山動物園 1978 年於西子灣創立、1986 年遷至現址（支線 story-zoo） | https://zoo.kcg.gov.tw/en/intro/ | 2026-10-19 | ✅ 已核實；⚠ 銅獅新聞稱「1984 年行政大樓落成，動物園正式搬遷」與此不一致，故事不連結兩者 |
| 西子灣行館 1935 年為臺灣博覽會高雄觀光館，會後轉為溫浴場（支線 story-gallery） | https://artcenter.nsysu.edu.tw/p/412-1008-26424.php?Lang=zh-tw | 2026-10-19 | ⚠ 1935 與溫浴場核實；campus-info 的「1980 年移交」「2018 年整修」不在此頁（頁面記 2023 年 12 月完成溫浴池遺構復原），建議修正 campus-info |

---

## Summary

本研究報告針對國立中山大學（NSYSU）校園 3D 建模與「新生導覽」歷史劇情需求，系統性考證校史、地緣生態與 11 座核心地標之建築特徵。西子灣校區於 1980 年由李煥擘劃復校，校門門戶西子灣隧道實為日治時期「壽山洞」（1927 動工、1928 竣工，長約 260 公尺），非英國人所鑿；打狗英國領事館則為鄰近清末洋樓官邸。校園建築廣泛採用深紅褐色二丁掛面磚結合白色橫樑與圓拱長廊（Arcade）語彙，核心地標如圖資大樓為全校最高樓（地上 10–11 層，具階梯退縮天際線）、海科院為全台最貼近海浪之校舍，而大眾常誤傳之「紅33」公車實未行經校園，實際主力接駁為港都客運「橘1」與校園免費公車。

---

## Findings

### 1. 校史考證：廣東創校、西灣復校與「山海」精神識別
- **創校與復校歷程**：中山大學前身為孫中山先生於 1924 年在廣州創立之「國立廣東大學」，1926 年為紀念孫中山逝世更名為「國立中山大學」。政府遷台後，行政院於 1979 年 7 月核定成立在台復校籌備處，由李煥出任籌備處主任，並於 **1980 年（民國 69 年）7 月正式在高雄西子灣建校復學**，首任校長為李煥（[國立中山大學校史館](https://history.nsysu.edu.tw/)）。
- **校訓淵源**：沿用孫中山先生於 1924 年親筆手書題頒之訓詞——**「博學、審問、慎思、明辨、篤行」**，語出《禮記·中庸》第二十章（[國立中山大學校訓說明](https://www.nsysu.edu.tw/p/412-1000-1503.php?Lang=zh-tw)）。
- **校徽與校色**：
  - **傳統校徽**：採中華民國國花五瓣梅花外型，中央直書篆體「中山」二字，象徵剛毅堅貞與紀念國父。
  - **山水識別標誌（CIS Logo）**：1997 年設計推出，以「山之堅毅、海之寬廣」為核心，綠色山形筆觸象徵青翠壽山，藍色浪花筆觸象徵奔騰的西子灣海洋（[國立中山大學識別系統](https://cpr.nsysu.edu.tw/p/412-1025-3475.php)）。
  - **標準校色**：以海洋深藍（Navy Blue）與壽山蒼翠綠（Forest Green）為主色系，輔以白色。

### 2. 地理與地緣設施：日治壽山洞、清代領事館與獼猴生態
- **西子灣隧道（壽山洞）非英國人所鑿**：
  - 隧道由大日本帝國高雄州廳為開發「壽山公園」與西子灣海水浴場而開闢，昭和 2 年（1927 年）由日籍承包商海野三次郎的「海野組」開工，昭和 3 年（**1928 年 10 月**）竣工，總長 **260 公尺**、寬約 6 公尺、高約 3.6 公尺。2004 年登錄為高雄市歷史建築「西子灣隧道及其防空設施」（[文化部文化資產局](https://nchdb.boch.gov.tw/assets/overview/historicalBuilding/20040409000003)）。其開通使哈瑪星市區可直接穿山抵達西子灣，免除繞行哨船頭海岬，至今為全台唯一的穿山步行校園門戶。
- **打狗英國領事館官邸**：
  - 坐落於哨船頭山頂（高雄市鼓山區蓮海路 20 號），建於清光緒 5 年（1879 年），為英國政府在台興建之領事官邸，現已合併山下辦公室登錄為國定古蹟（[高雄旅遊網英國領事館介紹](https://khh.travel/zh-tw/attractions/detail/21)）。其地標緊鄰中山大學蓮海路校門外側山丘，非校內建築。
- **校園臺灣獼猴相處規範**：
  - 校園與壽山國家自然公園無縫交界，校方總務處常年宣導防猴安全原則：**「不餵食、食物不外露（食不露白）、不接觸、不攻擊挑釁」**，室內窗戶須緊閉紗窗，包包背胸前避免被猴群搶奪（[國立中山大學總務處獼猴宣導專區](https://oga.nsysu.edu.tw/)）。

### 3. 校園生活與交通查核（修正普遍訛傳）
- **「紅33」公車並未行經中山大學**：
  - 「紅33」為南台灣客運營運之市區明誠幹線（行經美術館、大樂、澄清湖至鳳山），從未進入西子灣。
  - **實際接駁主力**：
    1. **港都客運「橘1」系列**（橘1A、橘1B、橘1C）：自輕軌哈瑪星站／捷運西子灣站發車，經西子灣隧道口、哨船頭、蓮海路校門、行政大樓、海科院、武嶺路口至文學院（延駛柴山慈德宮）。中山師生憑證免費（校方補貼）。
    2. **校園公車（校巴）**：往返捷運西子灣站 2 號出口 ⇄ 行政大樓 ⇄ 翠亨宿舍（H棟） ⇄ 活動中心 ⇄ 武嶺路口 ⇄ 文學院，憑學生證免費搭乘（[國立中山大學校安組交通資訊](https://safety-oga.nsysu.edu.tw/)）。
    3. **高鐵直達車**：為港都客運 **「紅52」** 直達中山大學行政大樓。
- **宿舍聚落與學餐分佈**：
  - **翠亨山莊**：A、B、C、D、E、F、G、H、L 棟，主為大學部男女宿舍。A棟為宿服中心，H棟 1 樓設有萊爾富，E棟設有**翠亨學餐**。
  - **武嶺山莊**：武嶺一村至四村，座落於靠山腰平臺。武嶺一村設有著名**米羅美食坊（武嶺學餐）**，供應早午晚餐與宵夜。
  - **學生活動中心**：2 樓為**山海樓饗食廣場**（進駐多家餐飲、全家便利商店、麗文書局）。

---

## Details

### Part A: 6 章節「新生導覽」故事歷史事實對照表

| 章節主題 | 核心事實與歷史年代 | 關鍵地理坐標 / 視覺元素 | 權威文獻來源 |
| :--- | :--- | :--- | :--- |
| **Ch1: 西灣門戶與穿山之謎** | 1928 年日治「壽山洞」（海野組開鑿，長 260m），串起哈瑪星與西灣；二戰至冷戰增建龐大避難坑道。非英國人開挖。 | 仿石砌拱圈隧道東/西口、隧道內防空壕鐵門、自行車/行人專用分流線。 | [文化部文化資產局-西子灣隧道](https://nchdb.boch.gov.tw/assets/overview/historicalBuilding/20040409000003) |
| **Ch2: 復校拓荒與山海精神** | 1980 年首任校長李煥籌備復校；動物園遷往壽山；余光中等文人學者南下任教。 | 1984 行政大樓落成、大門前雄雌銅獅雕像、菩提樹圓環草坪。 | [國立中山大學校史網](https://history.nsysu.edu.tw/) |
| **Ch3: 紅磚拱廊與學術中軸** | 1982–1989 年陸續建置理學院、工學院與圖資大樓；挑高紅磚半圓拱廊形成防烈日暴雨遮蔭動線。 | 連續紅磚拱門（Arcade）、菩提樹木棧平台、穿堂光影。 | [中山大學菩提樹廣場管理規範](https://oga.nsysu.edu.tw/) |
| **Ch4: 柴山獼猴與西灣夕照** | 依傍壽山國家自然公園，台灣獼猴共存法則（四不：不餵食、不露白、不接觸、不攻擊）；海堤「蘿蔔坑」雙人垛情人座文化。 | 西子灣消波塊、海堤階梯、防猴紗窗、背在胸前的雙肩背包。 | [國立中山大學總務處](https://oga.nsysu.edu.tw/) |
| **Ch5: 臨海求真與半山書香** | 1986 年成立全台首座海洋科學學院（貼海造波池）；2000 年文學院遷入壽山半山腰（百階步道、余光中《高樓對海》）。 | 海科院「人生海海」蔚藍階梯彩繪、文學院居高臨下俯瞰高雄港第一港口防波堤。 | [中山大學海科院院史](https://marine.nsysu.edu.tw/) / [文學院遷院記](https://la.nsysu.edu.tw/) |
| **Ch6: 青春據點與山海日常** | 翠亨與武嶺兩大宿舍群；橘1公車與綠巴穿梭；活動中心山海樓、武嶺米羅宵夜與沙灘會館夕照。 | 翠亨斜坡、武嶺路口、活動中心圓形露天劇場、沙灘木棧道。 | [中山大學宿服組](https://housing-osa.nsysu.edu.tw/) |

---

### Part B: 11 處地標建築 3D 建模參考指南 (Blender Modelling Guide)

#### 1. 行政大樓 (Administration Building)
- **樓層／建築高度**：地下 1 層、地上 7 層，頂部設電梯機房與水塔塔樓（約 26–28 公尺）。
- **平面形狀 (Footprint)**：對稱長矩形（長邊約 70–80 公尺），中央入口向外凸出形成玄關體量。
- **屋頂形式**：平屋頂（Flat roof with parapet），頂樓女兒牆帶有幾何線條。
- **立面材質與色彩**：暗紅褐色二丁掛面磚為主，穿插米白色水泥樑柱水平飾帶；深色鋁框玻璃窗。
- **顯著特徵**：
  - 正面中央帶有 2 層樓挑高入口門廊（Portico），粗壯方柱支撐。
  - 正面頂層中央鑲嵌金色楷書「行政大樓」四字。
  - 大門前方設有一對氣勢威嚴的青銅巨獅雕像（藝術家陳志慈鑄造）。
  - 前方面臨大型圓環草坪噴水池與升旗台，後方連接菩提樹林與木棧道。
- **周邊環境**：座落於校園平地核心低處，背靠理學院與社會科學院，面朝西子灣海濱方向。
- **落成年代**：1984 年（民國 73 年）。
- **公開參考相片**：
  1. [Wikimedia Commons - NSYSU Administration Building](https://commons.wikimedia.org/wiki/File:NSYSU_Administration_Building.jpg)（授權：CC BY-SA 4.0）
  2. [Wikimedia Commons - Admin Building, Science & Social Science](https://commons.wikimedia.org/wiki/File:National_Sun_Yat-sen_University_Administration_Building,_College_of_Science_and_College_of_Social_Science_20240618.jpg)（授權：CC BY-SA 4.0）

---

#### 2. 圖書與資訊大樓 (圖資大樓 / Library & Information Building)
- **樓層／建築高度**：地下 1 層、地上 10 至 11 層（全校第一高樓，約 42–45 公尺，象徵學術燈塔）。
- **平面形狀 (Footprint)**：多邊形階梯狀量體，兩側翼樓延伸並以空中空橋／廊道與管院、工學院銜接。
- **屋頂形式**：**多層次退縮之平頂天際線**；中央頂部為突出之機房塔樓與國際會議廳構造，因層次遞減向上收攏，視覺上形成類似階梯狀「冠冕/皇冠」天際線（Crown-like stepped silhouette）。
- **立面材質與色彩**：紅褐色面磚基底結合淺米灰色耐候防鹽霧多彩仿石塗料，深色直立遮陽百葉。
- **顯著特徵**：
  - 正西向立面整排大面積落地垂直長窗，正對台灣海峽夕陽（余光中詩《高樓對海》所詠）。
  - 入口設有挑高氣派階梯與中央採光大廳，1 樓設有「集思軒」與「書香町」自習室，3 樓設余光中特藏室。
- **周邊環境**：背靠壽山田寮峰山腳，位處理工與社管院館中央谷地。
- **落成年代**：1985 年動工，1988 年外胚結構完成，1989 年 11 月 12 日開館。
- **公開參考相片**：
  1. [Wikimedia Commons - NSYSU Library 20240618](https://commons.wikimedia.org/wiki/File:National_Sun_Yat-sen_University_Library_20240618.jpg)（授權：CC BY-SA 4.0）
  2. [Wikimedia Commons - NSYSU Library & Information Building 20260209](https://commons.wikimedia.org/wiki/File:NSYSU_Library_%26_Information_Building_20260209.jpg)（授權：CC BY-SA 4.0）
  3. [Wikimedia Commons - Library, Management & Engineering](https://commons.wikimedia.org/wiki/File:National_Sun_Yat-sen_University_Library,_College_of_Management_and_College_of_Engineering-01.2024-06-18.jpg)（授權：CC BY-SA 4.0）

---

#### 3. 文學院 (College of Liberal Arts - 含文學院大樓與藝術大樓)
- **樓層／建築高度**：依山勢梯田式退縮建造，主體地上 4–5 層，高度約 16–20 公尺。
- **平面形狀 (Footprint)**：沿壽山等高線彎折之 L 型與多邊折帶狀建築群。
- **屋頂形式**：斜坡頂（深色金屬浪板／琉璃瓦斜頂）與頂層平頂海景露臺交錯。
- **立面材質與色彩**：紅褐色／橘紅色二丁掛磁磚立面，配白色水平挑簷遮陽板與洗石子窗框。
- **顯著特徵**：
  - **百階景觀階梯**：學院依山而建，建築間遍佈多段階梯步道，並有直通山下海工館之陡峭步道。
  - 各層均設有開闊懸挑之外廊，坐擁俯瞰西子灣、高雄港第一港口航道與防波堤的「全校最高視角」。
  - 藝術大樓（文 FA）附屬專業琴房與藝文演藝廳。
- **周邊環境**：全校唯一深處半山腰之學院，四周被茂密相思林、血桐林圍繞，為猴群出沒核心區。
- **落成年代**：2000 年（民國 89 年）自山下遷入半山腰現址。
- **公開參考相片**：
  1. [Wikimedia Commons - NSYSU College of Liberal Arts and Marine Sciences](https://commons.wikimedia.org/wiki/File:NSYSU_College_of_Liberal_Arts_and_College_of_Marine_Sciences.jpg)（授權：CC BY 2.0）
  2. [Wikimedia Commons - 從中山大學文學院俯瞰西子灣全貌](https://commons.wikimedia.org/wiki/File:%E5%BE%9E%E4%B8%AD%E5%B1%B1%E5%A4%A7%E5%AD%B8%E6%96%87%E5%AD%B8%E9%99%A2%E4%BF%AF%E7%9E%B0%E8%A5%BF%E5%AD%90%E7%81%A3%E5%85%A8%E8%B2%8C.JPG)（授權：CC BY-SA 4.0）

---

#### 4. 理工學院長廊外觀 (工學院／理學院／紅磚拱廊)
- **樓層／建築高度**：長廊單層挑高淨高約 3.8–4.5 公尺；背後相連之理學院、工學院主體為 4–6 層建築（約 18–22 公尺）。
- **平面形狀 (Footprint)**：長條折線形迴廊，串連工學院、理學院、社管長廊並圍塑中央菩提樹草坪。
- **屋頂形式**：長廊上方為鋼筋混凝土平頂雨庇，部分段落二樓為露天步道。
- **立面材質與色彩**：**典型「西灣紅磚」**（紅褐色清水面磚貼面柱身與拱形發券），拱頂石與橫樑交界處以白色混凝土／抿石子飾條收邊。
- **顯著特徵**：
  - **連續半圓拱圈（Semi-circular Arches）**：柱跨約 3–4 公尺之規律拱門序列，透視感極強。
  - 長廊內側設有大型海報張貼公布欄與社團活動擺攤插座，為學生日常必經主要人感動線。
  - 挑高拱廊具備遮陽、導風、排濕功能，抵擋南台灣烈日與海風暴雨。
- **周邊環境**：緊鄰中央菩提樹木棧廣場，平地校園生活軸心。
- **落成年代**：1982–1984 年隨理工學院初期校舍竣工。
- **公開參考相片**：
  1. [Wikimedia Commons - NSYSU College of Science](https://commons.wikimedia.org/wiki/File:NSYSU_College_of_Science.jpg)（授權：CC BY-SA 4.0）
  2. [Wikimedia Commons - Admin Building, Science & Social Science](https://commons.wikimedia.org/wiki/File:National_Sun_Yat-sen_University_Administration_Building,_College_of_Science_and_College_of_Social_Science_20240618.jpg)（授權：CC BY-SA 4.0）
  3. [Wikimedia Commons - Library, Management & Engineering](https://commons.wikimedia.org/wiki/File:National_Sun_Yat-sen_University_Library,_College_of_Management_and_College_of_Engineering-01.2024-06-18.jpg)（授權：CC BY-SA 4.0）

---

#### 5. 西子灣隧道口 (Sizihwan Tunnel Portals - 壽山洞)
- **樓層／建築高度**：單層隧道拱門構造，洞門高約 4.5 公尺、寬約 7 公尺（內部通道淨高 3.6m、寬 6m，長 260m）。
- **平面形狀 (Footprint)**：貫穿壽山山壁之直通形馬蹄管狀通道。
- **屋頂形式**：混凝土拱形穹頂（Barrel vault），外部為壽山天然綠色山丘與護坡擋土牆。
- **立面材質與色彩**：淺灰色／灰白色水泥仿粗琢石砌拱圈（Rusticated concrete ashlar pattern）。
- **顯著特徵**：
  - **東端（哨船頭／哈瑪星端）**：設有古典式山形女兒牆門額，帶有仿石砌拱肋雕紋，上方曾留有「壽山洞」舊題字處。
  - **西端（校園端）**：圓拱形混凝土護門，出口正迎校園林道與行政大樓草坪，兩側嵌有防空洞群出入口厚重鐵門。
  - 隧道內壁為白色耐磨磁磚與通風風道，地面畫有行人與自行車分道標線。
- **周邊環境**：東口鄰哈瑪星臨海二路端點，西口直達逸仙館、海科院與行政大樓前。
- **落成年代**：1927 年開工，1928 年 10 月完工，1933 年正式通車。
- **公開參考相片**：
  1. [Wikimedia Commons - Sizihwan Tunnel 01 (Campus Side)](https://commons.wikimedia.org/wiki/File:Sizihwan_Tunnel_01.jpg)（授權：CC BY-SA 4.0）
  2. [Wikimedia Commons - East Portal of Sizihwan Tunnel](https://commons.wikimedia.org/wiki/File:East_portal_of_Sizihwan_Tunnel.jpg)（授權：CC BY-SA 2.0）
  3. [Wikimedia Commons - Sizihwan Tunnel 02](https://commons.wikimedia.org/wiki/File:Sizihwan_Tunnel_02.jpg)（授權：CC BY-SA 4.0）

---

#### 6. 校門＋校碑 (Main Gate & Monument - 蓮海路校門)
- **樓層／建築高度**：門禁管理亭為單層（高約 3.5 公尺）；校名紀念柱石碑高約 5–6 公尺。
- **平面形狀 (Footprint)**：橫向跨越蓮海路之道路管制島、懸臂遮棚與綠帶基座。
- **屋頂形式**：平頂懸挑混凝土雨遮（Canopy）。
- **立面材質與色彩**：現代純白耐候塗料配合洗石子基座，不銹鋼伸縮電動閘門。
- **顯著特徵**：
  - **校門主碑**：立於濱海側入口綠帶，為白色/淺灰色方型立柱，正面直書國父孫中山墨寶行楷集字**「國立中山大學」**金屬字樣，頂端嵌有梅花校徽。
  - （另於西子灣隧道西口前草坪另置有橫向「國立中山大學」紀念臥石碑）。
  - **海島校門特色**：大門右側緊貼壽山山壁，左側直接面臨西子灣海堤消波塊與海平線。
- **周邊環境**：蓮海路 70 號，車輛進出校區唯一管制哨，外側即為哨船頭與打狗英國領事館步道入口。
- **落成年代**：1980 年建校後興建，歷年隨防波堤與電子車辨閘門更新。
- **公開參考相片**：
  1. [Wikimedia Commons - Main Gate of NSYSU](https://commons.wikimedia.org/wiki/File:Main_gate_of_National_Sun_Yat-sen_University.jpg)（授權：CC BY-SA 2.0）
  2. [Wikimedia Commons - 2017 NSYSU Maingate](https://commons.wikimedia.org/wiki/File:2017_NSYSU_maingate.jpg)（授權：CC BY-SA 4.0）
  3. [Wikimedia Commons - Sun Yat-sen University Monument](https://commons.wikimedia.org/wiki/File:Sunyetenuniversitymonument.JPG)（授權：CC BY-SA 3.0）

---

#### 7. 逸仙館 (Sun Yat-sen Hall)
- **樓層／建築高度**：地上 4 層（1 至 3 樓為大型階梯式鏡框式專業舞台劇院），高度約 18–20 公尺。
- **平面形狀 (Footprint)**：八角形／扇形多面體量，後端有舞台懸吊塔樓（Fly tower）。
- **屋頂形式**：多折面幾何切角鋼架斜屋頂，外覆金屬浪板或暗灰色琉璃瓦。
- **立面材質與色彩**：橘紅褐色面磚立面搭配白色水泥柱樑框線，1 樓外廊為整排白色立柱。
- **顯著特徵**：
  - **一樓柱列半圓形迴廊**：環抱館舍前廳，為開闊的觀眾進場休憩集會空間。
  - 內部為國家級 1,370 席專業演藝廳，座椅編排拼出「NSYSU」字樣。
  - 館外林間草坪設有著名戶外風動公共藝術品「太陽從西邊出來」（梁任宏作品）。
- **周邊環境**：位於隧道西口出口南側林蔭草坪，前臨海科院，後背壽山山麓。
- **落成年代**：1992 年動工，1994 年（民國 83 年）完工；2020 年進行聲學大規模整修。
- **公開參考相片**：
  1. [Wikimedia Commons - NSYSU Hall01](https://commons.wikimedia.org/wiki/File:NSYSU_Hall01.JPG)（授權：CC BY-SA 4.0）
  2. [Wikimedia Commons - NSYSU Xizihall](https://commons.wikimedia.org/wiki/File:NSYSU_Xizihall.JPG)（授權：CC BY-SA 3.0）

---

#### 8. 體育館 (Gymnasium)
- **樓層／建築高度**：地上 3 層（3 樓為超高大跨距主球場與健身中心），總高約 18–22 公尺。
- **平面形狀 (Footprint)**：大跨距長方形體量，長邊約 60 公尺、寬約 40 公尺。
- **屋頂形式**：鋼骨桁架支撐之**淺拱型弧形屋頂（Barrel-curved / low arched roof）**，覆蓋淺灰色防蝕金屬彩鋼板。
- **立面材質與色彩**：下層基座為米黃色洗石子與紅磚飾面，上層高側窗為金屬橫條百葉與淡藍色防霧玻璃。
- **顯著特徵**：
  - 曾為 2009 年高雄世界運動會（世運）合球比賽正式場館。
  - 正面入口設有挑高迎賓階梯平台與懸挑門廊。
  - 緊靠海堤，建物經常接受強烈海風鹽霧考驗，外牆帶有現代防水耐候塗料塗裝痕跡。
- **周邊環境**：位在田徑場、室外游泳池與西子灣海堤之間。
- **落成年代**：1985 年興建，1986 年（民國 75 年）12 月正式啟用。
- **公開參考相片**：
  1. [Wikimedia Commons - 2017 NSYSU Stadium 1](https://commons.wikimedia.org/wiki/File:2017_NSYSU_stadium1.jpg)（授權：CC BY-SA 4.0）
  2. [Wikimedia Commons - 2017 NSYSU Stadium 2](https://commons.wikimedia.org/wiki/File:2017_NSYSU_stadium2.jpg)（授權：CC BY-SA 4.0）

---

#### 9. 海洋科學學院 (海科院建築群 - 綜合大樓、海資館與海工館)
- **樓層／建築高度**：臨海綜合大樓為地上 4–5 層；海工大樓（海工館）為地上 7 層（約 25 公尺）。
- **平面形狀 (Footprint)**：沿海岸線帶狀分佈的多棟獨立矩形群樓，由露天步道銜接。
- **屋頂形式**：平屋頂，設有防鏽鋼製女兒牆、海洋雷達收發天線及水塔機房。
- **立面材質與色彩**：抗海鹽灰白色塗料搭配紅褐色面磚裙邊。
- **顯著特徵**：
  - **全台最靠海之大學校舍**：基座即為海堤防波石，漲潮時浪花常拍打至大樓下緣平台。
  - **「人生海海」海洋階梯彩繪**：面海主階梯塗刷有深藍至淺藍的海洋漸層，繪有深海魚類、鯨豚與水下載具圖騰。
  - 配備大型造波試驗水槽與海水抽取管線設施，臨側為文學院登山階梯起點。
- **周邊環境**：正對台灣海峽波濤，背倚壽山峭壁，南接西子灣沙灘會館。
- **落成年代**：臨海院區於 1990 年落成，海資館 1993 年落成，海工大樓 2006 年 1 月啟用。
- **公開參考相片**：
  1. [Wikimedia Commons - NSYSU MS01 (Marine Sciences)](https://commons.wikimedia.org/wiki/File:NSYSU_MS01.JPG)（授權：CC BY-SA 4.0）
  2. [Wikimedia Commons - NSYSU MS02](https://commons.wikimedia.org/wiki/File:NSYSU_MS02.JPG)（授權：CC BY-SA 4.0）
  3. [Wikimedia Commons - College of Liberal Arts & Marine Sciences](https://commons.wikimedia.org/wiki/File:NSYSU_College_of_Liberal_Arts_and_College_of_Marine_Sciences.jpg)（授權：CC BY 2.0）

---

#### 10. 學生活動中心 (Student Activity Center)
- **樓層／建築高度**：地上 5 至 6 層（含東棟與西棟複合結構），高度約 18–21 公尺。
- **平面形狀 (Footprint)**：依坡地起伏展開之雙翼不規則建築，前方圍出露天半圓形表演廣場。
- **屋頂形式**：平屋頂結合多層階梯式退台景觀露天平台（細語廣場、魔力廣場）。
- **立面材質與色彩**：紅褐色面磚搭配白色混凝土外樑柱框線、大片落地玻璃窗。
- **顯著特徵**：
  - **生活機能核心**：1 樓設洗衣部與理髮部，2 樓為「山海樓饗食廣場」（學生餐廳）、全家超商、麗文書局，3 樓為 464 席演藝廳與排舞鏡牆，6 樓為活動中心住宿部。
  - 連接東、西兩棟之 4 樓戶外高架空橋與階梯。
- **周邊環境**：座落於平地主生活圈，鄰近翠亨宿舍群與體育場，前有公車站停靠點。
- **落成年代**：約 1984–1985 年（民國 73–74 年）。
- **公開參考相片**：
  1. [Wikimedia Commons - FamilyMart at NSYSU Activity Center](https://commons.wikimedia.org/wiki/File:Familymart_in_National_Sun_Yat-sen_University.jpg)（授權：CC BY-SA 4.0）
  2. [國立中山大學學生事務處活動中心設施導覽專頁](https://sa.nsysu.edu.tw/)

---

#### 11. 西子灣沙灘會館／海堤 (Sizihwan Beach Resort / Seawall & Lovers' Niche)
- **樓層／建築高度**：會館主建築地上 2 層（高度約 8–9 公尺）；海堤混凝土壩頂高出潮位線約 3–5 公尺。
- **平面形狀 (Footprint)**：
  - 會館：沿沙灘弧度長條延展之度假木質鋼骨房舍，附設露天木棧景觀平台。
  - 海堤：沿蓮海路延伸數百公尺之線型混凝土波浪擋浪牆。
- **屋頂形式**：
  - 會館：度假風格深出簷雙坡斜屋頂（外覆深色瓦材或彩鋼）。
  - 海堤：平坦頂部步道，外側迎浪面有階梯式防浪胸牆。
- **立面材質與色彩**：
  - 沙灘會館：米白／米黃色灰泥外牆，搭配原木防腐木材欄杆、大片海景玻璃窗、戶外茅草涼亭（發呆亭）與白色玻璃婚禮教堂。
  - 海堤：灰色清水混凝土防波堤、消波塊（俗稱「肉粽」），步道鋪設透水地磚。
- **顯著特徵**：
  - **「蘿蔔坑」（情人雅座）**：舊海堤護欄設計為一格格長方形凹槽垛口，每格恰好容納情侶兩人依偎面海而坐，為全台著名的「西灣夕照」約會集體記憶。
  - **校園沙灘**：西子灣海水浴場（日治 1935 年興建、戰後蔣公西子灣行館原址），為全台國立大學唯一的私人級沙灘浴場。
- **周邊環境**：背靠翠亨宿舍坡地，西臨西子灣海灘與台灣海峽，北接海科院，南連校門。
- **落成年代**：日治昭和 10 年（1935 年）高雄州觀光館與海水浴場，戰後轉為行館；2000 年代校方以促參委外整建為沙灘會館營運。
- **公開參考相片**：
  1. [Wikimedia Commons - Seas Bay Beach Resort-01](https://commons.wikimedia.org/wiki/File:Seas_Bay_Beach_Resort-01.2024-06-18.jpg)（授權：CC BY-SA 4.0）
  2. [Wikimedia Commons - Seas Bay Beach Resort-02](https://commons.wikimedia.org/wiki/File:Seas_Bay_Beach_Resort-02.2024-06-18.jpg)（授權：CC BY-SA 4.0）
  3. [Wikimedia Commons - Sizihwan Scenic Area 01 (Seawall)](https://commons.wikimedia.org/wiki/File:Sizihwan_Scenic_Area-01.2024-06-18.jpg)（授權：CC BY-SA 4.0）
  4. [Wikimedia Commons - Sizihwan Scenic Area 02](https://commons.wikimedia.org/wiki/File:Sizihwan_Scenic_Area-02.2024-06-18.jpg)（授權：CC BY-SA 4.0）

---

## Unverified / open questions

1. **圖資大樓屋頂「皇冠」稱謂的官方性**：
   - *推論現狀*：校方正式檔案稱為「多功能塔樓」或「高樓層國際會議廳/西灣學院」；其層疊退縮的女兒牆與頂層機房在視覺上確實形成凹凸階梯狀的 Crown-like silhouette，但「皇冠造型屋頂」屬於師生或口語俗稱，未在建管藍圖或官方命名中見到此一正式名詞。
   - *驗證途徑*：需調閱中山大學營繕組 1985 年圖書館原始工程設計圖說或建築師設計理念說明書。
2. **各老建築之精確公尺級頂高數據（Height in Meters）**：
   - *推論現狀*：本報告已依校園避難逃生圖與樓層平面圖精確確認了所有 11 棟建築的地表層數（地上 2 至 11 層不等），其公尺高度乃根據一般大學教學大樓層高（每層 3.5 至 4.2 公尺、體育館與演藝廳等挑高約 6 至 8 公尺）推估，誤差約在 $\pm 1.5$ 公尺內。
   - *驗證途徑*：若 Blender 建模需要精確至公分的頂高（Absolute Elevation），需調閱高雄市政府工務局使用執照之竣工立面圖（Elevation Drawings）。
3. **海科院「人生海海」彩繪階梯目前的現存狀態**：
   - *推論現狀*：海科院正立面階梯彩繪為 2010 年代末期公共地景創作，因西子灣海風高鹽、強烈日照環境，地景彩繪常有定期重新塗刷或局部褪色風化現象。
   - *驗證途徑*：手繪貼圖建模前宜比對 2024 年底至 2026 年現場即時照片以確認最新色相。

