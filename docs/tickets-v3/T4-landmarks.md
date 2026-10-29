# T4 地標

目標：11 處地標一眼可認；其他建築立面升級。（spec §6）

範圍：`docs/reference/landmarks/<id>.md`（參考照片與描述，取自 Gemini 研究）；`tools/create_landmarks.py`（讀 placements／對位結果生成座標）；`public/models/landmarks/*.glb`＋`*.collision.json`；`src/world/landmarks.ts` 替換 OSM 擠出體；程式化立面升級。

驗收：
- 每棟 ≤ 25k 三角形、≤ 4 材質；合計 < 6 MB。
- 理工外殼：每個入口從外走進去不穿模、不被外殼擋住（vitest 以控制器實走 60 入口）。
- `artifacts/v3/comparison/<id>.png` 參考照片 vs 渲染並排；Fable 檢閱。
