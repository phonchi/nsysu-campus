# T3 配置與地形

目標：鳥瞰與官方平面圖一致，壽山與西子灣地形可信。（spec §5）

範圍：
- 下載官方全校平面圖至 `data/sources/`（SHA256、日期、來源頁）。
- `tools/align_campus_map.py`：≥6 控制點相似轉換＋殘差報告；更新外圍建築與道路位置。
- `tools/build_terrain.py`：DEM → `public/data/terrain/`；取不到則手工塑形並註明。平台墊固定理工八棟 `floorY`，墊外 12 m 過渡。
- 海岸線、沙灘、海堤、防波堤；`src/world/terrain.ts` 顯示與 Rapier heightfield 碰撞。

驗收：
- 對位殘差報告（平均誤差 m）；鳥瞰截圖 vs 平面圖疊圖 `artifacts/v3/T3/overlay.png`。
- T3 完成後重跑 `npm run walk:bake` 與 `walk-manual` 全過。
