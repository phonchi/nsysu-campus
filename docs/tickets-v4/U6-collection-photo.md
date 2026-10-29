# U6 集章、成就、拍照模式

依賴：U4（collection）。規格：spec-v4 §9.1–§9.2。

- `public/data/collection.json`：物品、集章點（範圍）、成就條件。
- 集章：走進範圍蓋章（動畫＋音效）；成就判定；集章冊頁（Esc 選單）。
- `src/games/photo.ts`：拍照模式（隱藏 HUD、受限環繞相機、時段、暗角、浮水印、PNG 下載、`counters.photo.saved`）。

驗收：Playwright 蓋 3 章、觸發 3 成就、存出非單色 PNG。
