# 海科院建築群（海工館、海資館、綜合大樓）建模參考照片

## OSM 對位（data/sources/osm/osm-nsysu.json）

| OSM 名稱 | way | 質心 | 外框（東西 × 南北） | 推定 |
|---|---|---|---|---|
| 海工館 & 通識中心 | 269874271 | 22.62919, 120.26268 | 82 × 85 m | **海工館**（2006 啟用，最南、最新） |
| 海洋資源館 | 269874277 | 22.63047, 120.26248 | 63 × 146 m | **海資館**（1993） |
| 海洋科學學院 | 269874274 | 22.63118, 120.26190 | 102 × 176 m | 海科院主體／臨海「綜合大樓」（1990）【待查證】 |

- 由南到北：海工館 → 海資館 → 海科院主體 → 造波池、海科院球場。東側山腰為文學院（非本群）。
- 1111 新聞（https://www.1111.com.tw/news/jobns/156534 ）稱「校內最貼近大海的建築綜合大樓，戶外正立面階梯」被彩繪成海洋地景，且為海科院與西灣學院共用；OSM 把「通識中心」併入海工館，故「綜合大樓」究竟對應哪一 OSM 輪廓 【待查證】。

## 照片

| 本地檔 | 來源頁 | 作者 | 授權 | 視角／內容 |
|---|---|---|---|---|
| `artifacts/v3/T4/refs/marine/01.jpg` | https://commons.wikimedia.org/wiki/File:NSYSU_College_of_Liberal_Arts_and_College_of_Marine_Sciences.jpg | othree | CC BY 2.0 | 2013-10-28，長焦，由海面／對岸**往東看**臨海一排：左低磚盒、中段紅色斜屋頂長廊、右側磚樓＋藍玻璃高塔（海工館）；山腰為文學院 |
| `artifacts/v3/T4/refs/marine/02.jpg` | https://commons.wikimedia.org/wiki/File:NSYSU_MS03.JPG | FJAC | CC BY-SA 4.0 | 人眼仰視：灰白高塔（圓形徽記）＋磚翼＋玻璃帷幕條＝**海工館** |
| `artifacts/v3/T4/refs/marine/03.jpg` | https://commons.wikimedia.org/wiki/File:NSYSU_MS04.JPG | 上傳者自稱「自己的作品」（作者名不詳） | CC BY-SA 4.0 | 5 層紅磚長樓，山牆形女兒牆＋菱形飾，左端開放樓梯塔 |
| `artifacts/v3/T4/refs/marine/04.jpg` | https://commons.wikimedia.org/wiki/File:NSYSU_MS06.JPG | 同上 | CC BY-SA 4.0 | 5 層紅磚長樓沿車道，底層白色圓柱列廊，深窗洞 |
| `artifacts/v3/T4/refs/marine/05.jpg` | https://commons.wikimedia.org/wiki/File:NSYSU_MS02.JPG | FJAC | CC BY-SA 4.0 | 2–3 層紅磚拱廊翼，頂層白色格柵／花架，椰子樹（臨海側） |

（另：https://commons.wikimedia.org/wiki/File:NSYSU_MS01.JPG 為 3 層磚盒、方形穿孔牆板，未下載。）

## 建模觀察

### 海工館（確定度高）
- `01` 右端＋`02`：主塔約 **7–8 層**、淺灰白（約 `#d8d8d4`）實牆配小方窗（散點式），頂部有圓形徽記；轉角一條淺綠藍色玻璃帷幕直條（約 `#9fc7c4`）；兩側接 4–6 層紅磚翼（約 `#b5523f`），水平連續帶窗；平屋頂。`01` 中另有一段深藍玻璃立面（約 `#2f4f7a`）。
- 量體：塔＋L／ㄇ形磚翼，外框約 80 × 85 m。

### 海資館／綜合大樓（1990s 紅磚系，對應關係【待查證】）
- 共同語彙：紅磚面（約 `#a9483a`）、米白（約 `#ece6d8`）水平樑帶、平屋頂女兒牆、5 層以內。
- `03`：5 層長條，屋頂女兒牆中段與端部有**三角山牆形飾**＋菱形開口；端部開放式樓梯塔（窗洞錯落）。
- `04`：5 層，底層一排**白色圓柱**形成騎樓。
- `05`：2–3 層，底層**半圓拱廊**，頂層白色方格架。
- `01` 中段：2 層長條，**紅色緩坡斜屋頂**（約 `#b8463a`），是本群唯一斜屋頂。
- 臨海側外有拋石／消波塊護岸（`01` 前景）。

## 未解
- 每張 MS 照片的確切建物與拍攝方向（Commons 描述僅 "National Sun Yat-sen University"）。
- 「綜合大樓」＝哪個 OSM 輪廓；彩繪階梯位置。
