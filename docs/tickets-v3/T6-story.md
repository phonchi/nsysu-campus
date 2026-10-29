# T6 故事系統

範圍：`public/data/chapters.json`、`src/story/{engine,schema,ui}.ts`；6 章主線；8 則故事轉支線徽章；區域 `world/zones.json`；進度存檔與重新開始。台詞底稿 `docs/reference/story-draft-v3.md`，事實出處 `docs/reference/nsysu-history-v3.md`。（spec §8）

驗收：
- schema 驗證與引擎單元測試涵蓋每種條件／動作。
- Playwright 從新存檔自動通關 6 章（真實輸入＋帶路，不瞬移），截圖每章完成卡。
- 每則校史敘述在 `sources` 有出處。
