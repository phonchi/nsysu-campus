# v3 Tickets

依 `docs/spec-v3.md`。順序與依賴：

| Ticket | 內容 | 依賴 | 狀態 |
|---|---|---|---|
| [T1](T1-walk-core.md) | 步行核心：Rapier 控制器、相機 rig、動畫狀態機、模組拆分 | — | 完成（`artifacts/v3/T1/`） |
| [T2](T2-render.md) | 柔和卡通渲染、後處理、合批、自適應畫質 | T1 | 待做 |
| [T3](T3-terrain-layout.md) | 平面圖對位、DEM 地形、海岸、室外路網 A* | T1 | 待做 |
| [T4](T4-landmarks.md) | 11 處地標 GLB、程式化立面升級 | T2、T3 | 待做 |
| [T5](T5-characters-npc.md) | CC0 骨架角色、NPC、獼猴 | T1、T2 | 待做 |
| [T6](T6-story.md) | 故事引擎、6 章、UI、支線 | T1、T5（NPC 介面） | 待做 |
| [T7](T7-campus-map.md) | 互動校園地圖首頁、移除舊 2D | T3、T6（進度） | 待做 |
| [T8](T8-audio.md) | 環境音與音效 | T1 | 待做 |
| [T9](T9-acceptance-review.md) | 整合驗收、GPT-6／Fable 審查、交接 | 全部 | 待做 |

每張完成：相關測試、`npm run build`、截圖到 `artifacts/v3/<ticket>/`、commit。
