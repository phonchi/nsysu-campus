# U2 主線沿線場景精修（小物與地標細部）

依賴：U1（材質與 tier 設定）。規格：spec-v4 §5、§15.9；美術：art-direction-v4 §6。

- `tools/create_props_v4.py`（Blender）：路燈、長椅、腳踏車與車架、告示牌、社團海報板、花圃、垃圾桶與回收桶、販賣機、站牌、機車、消防栓、交通錐、海堤欄杆與座位凹槽、咖啡車、擺攤桌；單一 atlas，meshopt GLB。
- `public/data/props-v4.json`：六個 L0 地點的佈置（種類、位置、朝向、優先級）。
- `src/world/props.ts`：instancing 生成；純函式 `propColliders(data)` 供 runtime 與 `tests/world-fixture.ts` 共用。
- 地標細部：行政、圖資、理工長廊的招牌、雨遮、室外機、排水管（原創招牌文字，無真實商標）。

驗收：每地點近景 ≥ 6 種小物；`story-walk` 與瀏覽器六章不退步；`validateRoutes` 移除邊數增加 ≤ 5%。
