# U7 小遊戲：海堤夕照、獼猴追逐、校史問答

依賴：U4、U5、U6。規格：spec-v4 §9.3–§9.5、§15.2、§15.5。

- `sunset-photo`：sunset 時段、海堤範圍、拍照模式下目標入鏡判定（畫面中央 60% ＋射線不遮擋）。
- `monkey-chase`：獼猴沿路網逃跑（低於奔跑速度），90 s 內 2 m 按 E 取回；結尾宣導官方三原則（引用前核對來源）。
- `history-quiz`：`public/data/quiz.json`（每題附 nsysu-history-v3 列號與 URL，只用 ✅），抽 5 題 4 選 1。

驗收：Playwright 三個遊戲各自完成並得章；失敗可重試；主線不受影響。
