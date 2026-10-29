# U9 整合驗收與審查

依賴：U1–U8。規格：spec-v4 §12、§15.11。

- `tools/v4_screens.py`：固定機位、三時段、桌機與手機、stats.json；`artifacts/v4/comparison/` 與 v3 並排。
- 全部回歸：`npm test`、`npm run build`、`walk_feel_qa`、`walkthrough_qa`、`campus_map_qa`、`story_playthrough_qa`、v4 玩法 QA。
- GPT-6 code review、Fable 美術審查；P1 全修，處置寫 `reviews/results/4x-*`。
- README 驗收表、handoff。
