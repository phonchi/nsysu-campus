# 圖資涵蓋與核對狀態

更新日期：2026-10-19

官方 PDF 40 份、原頁總覽影像 152 張及 SC 分層裁圖 4 張；樓層索引 164 筆（包含 PH／BI 共用原圖的額外 8 筆引用），文字層房號 88 筆（含不同來源重複，未視為獨立教室總數）。

- 來源：教務處各學院教室平面圖、校安組校舍平面圖。原始 PDF 保存在 `data/sources/`，URL、SHA256、下載時間列於 `public/data/sources.json`。
- 文學院、藝術大樓、海科院專屬圖資與宿舍不納入可瀏覽資料；校安教學區多棟合併原始 PDF 為完整存檔，可能仍含排除建築，但不將其混合頁面公開為單棟樓層。
- 所有頁面保留整頁總覽，沒有把同頁多層圖誤標成同一樓層。SC 原頁 1F–4F 已視覺核對並分層裁切；其他只有官方標題明示單一樓層的圖資賦予 level，其餘為 null。
- 搜尋結果座標來自 PDF 文字 span 的框；狀態 `text-extracted`，並非逐間人工確認。房號可重複出現，亦可能落在索引/圖例；介面應顯示「文字擷取・待核對」。
- `overview` 圖資可閱讀和縮放；SC 已提供逐層裁切，入口/樓梯/房門與可行走路網尚待核對，不能僅據文字座標宣稱提供經驗證的室內導航。
- 校安來源標示「教學區平面圖」實為多頁合集，首張圖面標題為「資訊機房消防滅火設備」，標示「中山大學圖書與資訊處」，不是行政大樓或校園總配置圖；teaching-area.png 僅為該 PDF 首頁預覽，未知實際樓層，不掛入任何單棟樓層。
- 未採 OCR 猜測掃描圖房號；無文字層圖目前僅可視覺瀏覽。
- 未實地勘查；校方原圖年代與現況可能不同。

| 建築代碼 | 文字房號筆數 |
|---|---:|
| ACTIVITY | 0 |
| AD | 0 |
| BI | 0 |
| CH | 0 |
| CM | 0 |
| EC | 0 |
| EN | 0 |
| EV | 0 |
| GATE | 0 |
| IL | 0 |
| IR | 0 |
| KINDER | 0 |
| MS | 0 |
| PH | 0 |
| SC | 88 |
| SPORT | 0 |
| SS | 0 |
| SW | 0 |
| VILLA | 0 |
| XIZI | 0 |

## 後續

逐頁人工辨識樓層區域後，另新增經核對的 crop，轉換房號座標，再建置走廊與出入口路網；保留原頁以便覆圖複核。

## 全部官方來源

| 標題 | 頁數 | 文字房號 |
|---|---:|---:|
| [理學院及東綜合大樓-理SC](https://oaa.nsysu.edu.tw/static/file/3/1003/img/4689/02Room_COS_1.pdf) | 1 | 88 |
| [生科館-理BI](https://oaa.nsysu.edu.tw/static/file/3/1003/img/4689/02Room_COS_2.pdf) | 1 | 0 |
| [物理館-理PH](https://oaa.nsysu.edu.tw/static/file/3/1003/img/4689/02Room_COS_3.pdf) | 1 | 0 |
| [化學館-理CH](https://oaa.nsysu.edu.tw/static/file/3/1003/img/4689/02Room_COS_4.pdf) | 1 | 0 |
| [材料大樓-工MS](https://oaa.nsysu.edu.tw/static/file/3/1003/img/4689/03Room_COE_1.pdf) | 1 | 0 |
| [電資大樓-工EC](https://oaa.nsysu.edu.tw/static/file/3/1003/img/4689/03Room_COE_2.pdf) | 1 | 0 |
| [工學院-機電大樓-工EN](https://oaa.nsysu.edu.tw/static/file/3/1003/img/4689/03Room_COE_3.pdf) | 1 | 0 |
| [管理學院-管CM](https://oaa.nsysu.edu.tw/static/file/3/1003/img/4689/04Room_COM.pdf) | 5 | 0 |
| [社會科學院-社SS](https://oaa.nsysu.edu.tw/static/file/3/1003/img/4689/06Room_COSS.pdf) | 1 | 0 |
| [圖資10樓-西SW](https://oaa.nsysu.edu.tw/static/file/3/1003/img/4689/07Room_SWC_1.pdf) | 1 | 0 |
| [西灣學院-綜合大樓-通GE](https://oaa.nsysu.edu.tw/static/file/3/1003/img/4689/07Room_SWC_2.pdf) | 1 | 0 |
| [圖資9樓-後醫系-醫IL](https://oaa.nsysu.edu.tw/static/file/3/1003/img/4689/08Room_COME_1.pdf) | 1 | 0 |
| [圖資3樓-護理系及醫科系-醫IL](https://oaa.nsysu.edu.tw/static/file/3/1003/img/4689/08Room_COME_2.pdf) | 1 | 0 |
| [國際研究大樓5、6樓-國IR](https://oaa.nsysu.edu.tw/static/file/3/1003/img/4689/08Room_COME_3.pdf) | 2 | 0 |
| [國際研究大樓6樓-國IR](https://oaa.nsysu.edu.tw/static/file/3/1003/img/4689/09Room_COSATR.pdf) | 1 | 0 |
| [國際研究大樓-國IR](https://oaa.nsysu.edu.tw/static/file/3/1003/img/4689/10Room_IB.pdf) | 1 | 0 |
| [電腦教室B1-圖IL PC01~圖IL    PC04](https://oaa.nsysu.edu.tw/static/file/3/1003/img/4689/11Room_LIS.pdf) | 1 | 0 |
| [教學區平面圖.pdf](https://safety-oga.nsysu.edu.tw/static/file/296/1296/attach/76/pta_174267_6219508_95389.pdf) | 172 | 0 |
| [教學行政區--行政大樓.pdf](https://safety-oga.nsysu.edu.tw/static/file/296/1296/attach/76/pta_174542_9100967_04268.pdf) | 9 | 0 |
| [教學行政區--東綜合大樓+理學院.pdf](https://safety-oga.nsysu.edu.tw/static/file/296/1296/attach/76/pta_174543_8048869_04268.pdf) | 6 | 0 |
| [教學行政區--物理館+生科館.pdf](https://safety-oga.nsysu.edu.tw/static/file/296/1296/attach/76/pta_174544_4720186_04268.pdf) | 8 | 0 |
| [教學行政區--材料大樓.pdf](https://safety-oga.nsysu.edu.tw/static/file/296/1296/attach/76/pta_174545_2241236_04269.pdf) | 4 | 0 |
| [教學行政區--化學館.pdf](https://safety-oga.nsysu.edu.tw/static/file/296/1296/attach/76/pta_174546_6679834_04269.pdf) | 4 | 0 |
| [教學行政區--工學院含機電大樓.pdf](https://safety-oga.nsysu.edu.tw/static/file/296/1296/attach/76/pta_174547_2531961_04269.pdf) | 6 | 0 |
| [教學行政區--電資大樓.pdf](https://safety-oga.nsysu.edu.tw/static/file/296/1296/attach/76/pta_174558_61801_04270.pdf) | 10 | 0 |
| [教學行政區--環工館.pdf](https://safety-oga.nsysu.edu.tw/static/file/296/1296/attach/76/pta_174548_7958856_04269.pdf) | 4 | 0 |
| [教學行政區--社會科學院大樓.pdf](https://safety-oga.nsysu.edu.tw/static/file/296/1296/attach/76/pta_174549_3838187_04269.pdf) | 6 | 0 |
| [教學行政區--西綜合大樓.pdf](https://safety-oga.nsysu.edu.tw/static/file/296/1296/attach/76/pta_174550_5377797_04269.pdf) | 3 | 0 |
| [教學行政區--管理學院大樓.pdf](https://safety-oga.nsysu.edu.tw/static/file/296/1296/attach/76/pta_174551_7300210_04269.pdf) | 6 | 0 |
| [教學行政區--管研大樓.pdf](https://safety-oga.nsysu.edu.tw/static/file/296/1296/attach/76/pta_174552_4927399_04269.pdf) | 6 | 0 |
| [教學行政區--圖資大樓.pdf](https://safety-oga.nsysu.edu.tw/static/file/296/1296/attach/76/pta_174559_8196417_04270.pdf) | 15 | 0 |
| [教學行政區--逸仙館.pdf](https://safety-oga.nsysu.edu.tw/static/file/296/1296/attach/76/pta_174572_2849704_06488.pdf) | 6 | 0 |
| [教學行政區--體育館.pdf](https://safety-oga.nsysu.edu.tw/static/file/296/1296/attach/76/pta_174565_2161288_04737.pdf) | 4 | 0 |
| [教學行政區--田徑場+游泳池+網球場.pdf](https://safety-oga.nsysu.edu.tw/static/file/296/1296/attach/76/pta_174561_9694061_04270.pdf) | 3 | 0 |
| [教學行政區--活動中心.pdf](https://safety-oga.nsysu.edu.tw/static/file/296/1296/attach/76/pta_174563_2057042_04737.pdf) | 14 | 0 |
| [教學行政區--幼兒園.pdf](https://safety-oga.nsysu.edu.tw/static/file/296/1296/attach/76/pta_174560_3711141_04270.pdf) | 1 | 0 |
| [教學行政區--蔣公行館.pdf](https://safety-oga.nsysu.edu.tw/static/file/296/1296/attach/76/pta_174571_857388_06488.pdf) | 2 | 0 |
| [教學行政區--警衛室、收費亭、汙水廠、遙望台.pdf](https://safety-oga.nsysu.edu.tw/static/file/296/1296/attach/76/pta_174564_7466265_04737.pdf) | 1 | 0 |
| [教學行政區--國研大樓.pdf](https://safety-oga.nsysu.edu.tw/static/file/296/1296/attach/76/pta_174573_4340963_07096.pdf) | 8 | 0 |
| [教學行政區--西子樓.pdf](https://safety-oga.nsysu.edu.tw/static/file/296/1296/attach/76/pta_174574_6135545_07096.pdf) | 4 | 0 |

## 圖資完整性檢查與審查更正

- `python -B tools/verify_data.py` 為唯讀檢查：核對每份原始 PDF 與 manifest／鎖定快照的 SHA256、每張樓層圖的存在、尺寸、SHA256，以及來源、樓層、房號外鍵、房號標記的 normalized 座標與 SC 前綴歸屬。
- `public/data/asset-integrity.json` 保存已檢視的來源及樓層圖快照。樓層 metadata 包含 crop（原始 PDF 點數）、page、rotation（未提供時為 0）、來源 PDF SHA256，以及原有標題、樓層與狀態。任何新增、移除或變更都使一般檢查失敗並以 exit 1 結束。
- 只有人工核對變更後明確執行 `python -B tools/verify_data.py --lock` 才會建立或取代快照；一般檢查及 build 不可使用 `--lock`，避免把錯誤自動接受成新基準。工具需要既有 Python 與 Pillow，不連線、不下載、不 OCR、不修改圖資。
- 額外保存的來源與尚未顯示於前端的館別可以存在。完整性檢查不以目前前端建築清單限制來源，也不宣稱所有房號或路網已人工核對。
- Fable 交叉審查確認：校安網站「教學區平面圖」連結實為 172 頁多棟合集；`teaching-area.png` 是首張「中山大學圖書與資訊處／資訊機房消防滅火設備」圖。先前把它理解為行政大樓的說法已更正；不能拿它當校園總圖或已知行政樓層。此合集只存檔，不掛入單棟樓層。
- Fable 提醒的 `COS_1`、`COS_2` 皆顯示 `rooms=88` 是早期 log 的**累計**房號筆數，沒有將生科館誤抽出 88 筆。已比對 COS_1–COS_4 的原始 PDF SHA256，四份均不同；實際 SC 抽出 88 筆，BI／PH／CH 各 0 筆。新工具將每檔 `source_rooms` 與 `cumulative_rooms` 分開記錄，來源 manifest 亦提供每檔 `extractedRoomLabels` 及 `extractedPrefixes`。
- 完整性快照能偵測核對後的意外變更，不能代替原圖內容、實際房門或現地可通行性的確認。

## 導航標註與交付範圍

`navigation.json` 目前有57個節點、56條邊，其中55條啟用。SC1001、SC1005、SC1015、SC2001的門點與部分1F/2F灰色廊道人工對照圖面；中央獨立樓梯以逐層圖示及相鄰空間配對，不靠相同像素位置猜接。四個門點與88筆「房號文字位置」是不同資料層，後者不自動升級可導航。

校園圖與SC樓層圖的入口方向未能確認，跨圖門檻邊保持停用。校門到室內目的地只產生到建築附近的部分路線；由已核對的室內起點出發可查看室內路線。所有結果均屬圖面導覽，未經現地勘測、門禁或即時通行確認，無公尺或無障礙通行保證。

完整性鎖定v2另外涵蓋校園原圖與縮圖、全部房號metadata及導航圖。程式檢查跨樓層樓梯必須同組、同建築且相鄰；戶外—室內連接若要啟用，須有明確thresholdChecked證據欄位。更新資料後不會在build時偷偷重建基準。

### 原PDF高解析補核
SC1015門洞位於裁圖normalized約(0.529,0.633)，早期低解析點位(0.509,0.634)落於隔間牆，已修正。中央樓梯兩層均為北側開口，南側為窗牆；節點改至1F(0.825,0.306)、2F(0.803,0.294)，2F由x=.871的東側外廊繞行（原PDF6倍圖已核對），避開x=.845處水平雙線。證據在artifacts/detail-door-SC1015.png、detail-stair-context-1F.png、detail-stair-context-2F.png；全路網覆圖可由tools/render_route_audit.py重現。

## 使用者補圖後的3D配置修正
新增理學院495×700官方配置圖，來源及sha位於data/sources/science-engineering-reference.json。2D彩繪圖標記維持原圖座標；3D改用src/world-layout.json獨立配置，不再直接將透視圖像素當作地面坐標。核心理工與管社的連續建築帶依新圖拓樸重建，外圍仍依2022圖交叉定位，basis逐棟標明示意限制。SC/EN與CM/SS量體相接，公共廊棚僅視覺表現，不擅自開通跨棟室內路由。

戶外道路與路網共用layoutX/Y，verify_layout.py檢查所有戶外節點連通、道路與路網一致、路段不穿封閉量體，以及核心連接存在。完整性鎖v3另外鎖新增參考圖與3D配置JSON；仍非實測比例或現地通行保證。

### 示意圖轉向限制
戶外2D與3D配置屬不同示意座標，不能以彩繪圖推導真實左右轉；戶外步驟只顯示校道節點及沿路線箭頭前進。室內仍依固定裁圖寬高、門點與走廊折線計算相對轉向。

## 舊圖資索引修正（2026-10-19）

- `oaa-04Room_COM` 5頁與 `safety-pta_174551_7300210_04269` 6頁共11筆，從錯掛SC改為CM。「管理學院」包含「理學院」字串，分類規則現先比對完整管理學院名稱；沒有重跑下載或覆蓋人工圖資。
- `safety-pta_174544_4720186_04268` 共8張PH／BI合頁，每頁保留原BI引用，新增唯一 `-PH` ID供PH查圖。兩份引用保持相同sourceId、page與imageUrl；標題明示合頁原圖／未獨立裁切，level=null、status=overview，不冒稱已核對單棟樓層。
- 索引由156增加8筆成164筆；沒有新增PDF或影像檔，實際不同圖檔仍156張。現有17棟前端建築可引用156筆樓層索引，16棟有可讀圖；YH目前沒有獨立舊索引，這是既有逸仙館來源歸在ACTIVITY的另一項分類問題，本次未擴大修改。
- 本次只修分類與共用頁引用；原PDF、房號、已凍結步行版與integrity lock均不變，鎖定基準由主代理審查後另行更新。


## OpenStreetMap 校區輪廓（2026-10 新增）

- 檔案：`data/sources/osm/osm-nsysu.json`、查詢 `query.overpassql`、來源與 SHA `osm-nsysu.source.json`（Overpass API，取得時間與 osm_base 見該檔）。
- 授權：ODbL 1.0，© OpenStreetMap contributors；網站畫面右下角與 README 皆有標示。
- 用途：理工八棟的擬合定位與比例（`tools/build_campus_structure.py`）、地標與背景建築量體、道路、全校小地圖。社群資料，非測量；擬合誤差與調整寫在 `campus-structure.json`（`fits`、`placements.*.separationShift`、`fittedScale`）。
- 建模參考（不隨網站發佈照片）：`docs/reference/visual-reference.md`（Gemini 4 蒐集，附來源）、`docs/reference/art-direction.md`（Fable 美術規格）。
