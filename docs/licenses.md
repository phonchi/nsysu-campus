# 第三方素材授權

## 角色（v3，T5）

| 素材 | 作者 | 授權 | 來源 | 用途 |
|---|---|---|---|---|
| Animated Men Pack（`Man` ×2、`Man in Long Sleeves`） | Quaternius | CC0 1.0 | <https://quaternius.com/packs/animatedmen.html>；GLB 取自作者在 poly.pizza 的上傳：<https://poly.pizza/m/HMnuH5geEG>、<https://poly.pizza/m/fjHyMd5Wxw>、<https://poly.pizza/m/DLptRuewTn> | `ahai`、`tuo`、`np1`、`np4`、`np6` 的網格、骨架與 Idle/Walk/Run/Jump/Sit 動作 |
| Animated Women Pack（`Woman Casual`、`Woman`、`Woman in Tank Top`、`Woman in Dress`） | Quaternius | CC0 1.0 | <https://quaternius.com/packs/animatedwomen.html>；<https://poly.pizza/m/jpKRgGDxhk>、<https://poly.pizza/m/AQsd9ngvKU>、<https://poly.pizza/m/XqzeZGB7iU>、<https://poly.pizza/m/zMyPlQXBzq> | `lan`、`wan`、`np2`、`np3`、`np5` |

- 授權證據：兩個官方包頁皆寫「License CC0」並連到 <https://creativecommons.org/publicdomain/zero/1.0/>；每個 poly.pizza 模型頁標示 `"Licence":"CC0 1.0"`（上傳日 2021-08-24）。頁面存檔、SHA256 與下載日期記在 `data/sources/characters/provenance.json`。
- 官方 Google Drive 下載（含包內 `License.txt`）在 2026-10-19 回應「Quota exceeded」，所以 GLB 改從作者本人的 poly.pizza 上傳取得。
- `quaternius.com/license.html` 目前顯示的是 Quaternius Asset License（QAL）v1.0（2026-08-28），不是 CC0。QAL 第 7 條明訂變更不溯及既往，以上兩包至遲在 2021 年（poly.pizza 上傳日 2021-08-24）即以 CC0 發布，早於 QAL，仍適用 CC0。
- 本 repo 自製（同樣以 CC0 釋出）：所有配色、256 px 色塊貼圖（含眼、嘴、腮紅）、配件（浮潛鏡、髮夾、側背包、眼鏡、背包、馬尾）、頭部比例調整、`Wave`／`Talk` 動作、Jump 重新計時與去除垂直位移、Sit 循環裁切。產生器：`tools/create_characters_v3.py`。
- 獼猴 `public/models/characters/monkey.glb`：完全自製（同一產生器），不含第三方資料。
- 授權檔隨模型放在 `public/models/characters/LICENSE.txt`。

## v4 新增素材（2026-10-20）

| 素材 | 來源 | 授權 |
|---|---|---|
| 學生主角與 NPC 原型（`public/models/characters/student-*.glb`、`npc-*.glb`） | `tools/create_student_v4.py` 以幾何體塊建模、程序繪製貼圖與動漫臉；骨架與基礎動作沿用 Quaternius Animated Men/Women | 網格與貼圖：本專案原創；骨架／動作：CC0 1.0 |
| 主線道具（`public/models/props/*.glb`） | `tools/create_props_v4.py` 原創幾何與頂點色，無任何品牌或真實招牌 | 本專案原創 |
| 對話立繪（`src/story/portraits.ts`） | 程序產生的 SVG，不描摹照片、不影射真人 | 本專案原創 |
| 樹冠、草葉、雲、海面貼圖 | 執行期以 Canvas／shader 程序產生 | 本專案原創 |
| NPC 名單與台詞（`public/data/npcs.json`）、題庫（`quiz.json`） | Fable 依 `docs/reference/npc-cast-v4.md` 撰寫；史實只取自 `nsysu-history-v3.md` ✅ 列並經 Gemini 查核 | 本專案原創文字；引用之校史附出處 |

v3 的 Quaternius 換色角色（ahai、lan、tuo、wan、np1–np6）已在 v4 停用並移出 `public/`。
