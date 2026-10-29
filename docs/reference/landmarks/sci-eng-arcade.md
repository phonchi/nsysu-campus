# sci-eng-arcade — 理工長廊參考照片與建模觀察

調查日期：2026-10-19。照片存於 `artifacts/v3/T4/refs/sci-eng-arcade/`。Commons 沒有以「理工長廊」為主題的照片；以下 3 張 Commons 照片是從中庭拍兩側院館時順帶拍到的底層廊道，另 1 張部落格照片僅供參考。

## 照片

| 檔案 | 來源頁 | 作者 | 授權 | 視角／內容 |
|---|---|---|---|---|
| `01.jpg` | https://commons.wikimedia.org/wiki/File:National_Sun_Yat-sen_University_Administration_Building,_College_of_Science_and_College_of_Social_Science_20240618.jpg | 阿道（2024-06-18） | CC BY-SA 4.0 | 中庭草坪向南看行政大樓背面；**左＝理學院**（東側）底層廊、右＝社科院（Commons 說明）。**建議作並排比對用（左半部）。** |
| `02.jpg` | https://commons.wikimedia.org/wiki/File:National_Sun_Yat-sen_University_Library,_College_of_Management_and_College_of_Engineering-02.2024-06-18.jpg | 阿道（2024-06-18） | CC BY-SA 4.0 | 中庭向北看圖資大樓；**右＝工學院**（東側）底層廊，左＝管理學院。 |
| `03.jpg` | https://commons.wikimedia.org/wiki/File:National_Sun_Yat-sen_University_Library,_College_of_Management_and_College_of_Engineering-01.2024-06-18.jpg | 阿道（2024-06-18） | CC BY-SA 4.0 | 同區直幅；右側工學院廊柱較近。 |
| `04.jpg` | https://sshrimptrips.com/post-570683792/ （圖檔 `__pic_pimg_tw_weisen5583_1683714797-2244189053-g_n_jpg.jpg`） | 蝦蝦瞎遊記 | **license: unknown / reference only** | 部落格「理工學院」段落的仰角照，底層為方柱廊、上有 4 層教室；確切是哪一棟【待查證】。 |

方位依 `visual-reference.md`：理工長廊在中庭東側／東北側；照片 01 左側、02/03 右側即東側院館。

## 核心問題：拱廊還是平頂柱廊？

**答：照片顯示的是平頂的柱樑式廊道（post-and-beam loggia），不是半圓拱紅磚拱廊。**

- 01 左側（理學院）：底層一列**矩形紅磚方柱**，柱頂直接接**水平樑帶**，沒有任何拱圈；廊上方再疊 2 層教室（看得到兩排窗），屋頂線有一排鋸齒狀屋頂構架。
- 02／03 右側（工學院）：同樣是底層**方柱＋平樑**的騎樓式廊道，上方疊 3 層教室；柱距約對應上層 2 個窗。
- 01 右側／02 左側（社科院、管理學院，即社管長廊側）：柱子更高，約 **2 層高**的挑高方柱廊，同樣是平樑。
- 04（部落格）也是方柱、平樑、上有多層樓。
- 半圓紅磚拱廊在校內**確實存在，但在文學院**（見 `liberal-arts.md` 的 `03.jpg`）。spec 寫的「紅磚拱廊」與 Gemini 報告的「連續半圓拱圈」可能是把文學院搞混了【建議修正 spec 的 `sci-eng-facade` 描述】。

## 建模觀察

- **形式**：廊道是院館的**底層騎樓（pilotis／loggia）**，不是獨立的單層雨庇；「上面有沒有 2 樓」→ **有，上面是 2–3 層教室**（理學院約 3F、工學院約 4F，照片可數）。
- **柱**：矩形斷面紅磚面磚方柱，無柱頭、無柱礎線腳；目測斷面約 0.8 × 1.2 m（長邊垂直立面）【待查證】。柱距約 6–7 m（對應上層 2 窗）【待查證】。
- **樑／頂**：柱頂為與牆同色的水平樑帶，厚約 0.6–0.9 m；廊頂即上層樓板（平頂）。
- **廊高**：理工側約 1 層（淨高目測 3.5–4 m）；社管側約 2 層挑高。
- **廊深**：約 1 個柱距內退到室內牆面（01 右側可見深陰影）【待查證】。
- **上層立面**：紅磚面磚 `#9A4536`，窗為白框橫長窗，窗下有水平線腳；每層窗帶連續。
- **地坪**：廊前有淺灰石材步道 `#A9A9A4` 與 2–3 階長台階接草坪（01、02）。
- 中庭草坪：`#4E8A2E`。

### 【待查證】
- 「理工長廊」正式範圍（從行政大樓東側到圖資大樓東側的連續性；棟與棟之間是否有獨立連廊段及其形式）。
- 柱斷面、柱距實測值。
