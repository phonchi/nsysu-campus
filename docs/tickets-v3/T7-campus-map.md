# T7 互動校園地圖

範圍：新首頁取代舊 2D（`main.ts`、`scene.ts`、`layout.ts`、`buildings.ts`、`routing.ts`、`style.css`）；分類篩選、資訊卡、章節進度、「在 3D 帶我去」(`?walk=<id>`)；決定 `verify_layout.py` 與 `tests/routing.test.ts` 去留並同步 build 腳本與 README。（spec §9）

驗收：`npm run build` 通過；桌機／手機截圖；從地圖點任一地標可進 3D 並開始帶路或定位。
