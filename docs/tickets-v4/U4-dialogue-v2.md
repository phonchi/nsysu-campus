# U4 對話系統 v2（對話樹＋視覺小說 UI）

依賴：無（U3 的配色資料可後補）。規格：spec-v4 §8、§15.2–§15.4。

- `src/story/schema.ts`：對話樹型別與 `validateTrees`（DAG、邊合法、flag 命名空間、id 存在）。
- `src/story/dialogue.ts`：純邏輯執行器（entries、lines、choices、effects、win／lose）；`Facts` 讀取介面。
- `src/story/collection.ts`：`nsysu-campus-v4` 正規化讀寫、counters、items、stamps、achievements。
- `src/story/portraits.ts`：程序化 SVG 半身立繪、4 表情。
- `src/story/ui.ts`：VN 對話框、選項、紀錄、快轉；主線 `Line[]` 共用。
- `src/walk/input.ts`：集中輸入模式與分派；E 仲裁順序（§15.4）。
- `tools/verify_dialogue.py`＋ vitest 窮舉。
- `chapters.json` `c1-done` 旁白措辭修正（§13）。

驗收：verify 0 錯；窮舉全部可結束；主線瀏覽器 6/6；舊存檔可讀。
