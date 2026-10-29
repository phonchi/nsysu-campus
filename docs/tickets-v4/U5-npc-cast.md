# U5 NPC 群、作息與事件

依賴：U3（模型）、U4（對話）。規格：spec-v4 §7、§15.1、§15.9；名單：npc-cast-v4。

- `public/data/npcs.json`：20 個 id、schedule、對話樹（由 npc-cast-v4 轉寫，台詞 ≤ 28 字）。
- `src/world/npc.ts`：資料驅動生成、`resolveNpcPlacement`（故事所有權優先）、時段切換移動、可見上限、E 交談提示（世界座標標籤）、說話時面向玩家。
- 事件：4 個時段事件（npc-cast-v4 §5）。

驗收：三時段作息量測；故事 NPC 不受作息影響（vitest）；每位 NPC 瀏覽器搭話成功。
