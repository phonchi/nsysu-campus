# U3 學生主角與 NPC 角色模型

依賴：無。規格：spec-v4 §6、§7.1、§15.7；美術：art-direction-v4 §8。

- `tools/create_student_v4.py`：自建身體（Skin／voxel 體塊）綁 Quaternius 骨架、沿用 v3 clips；男 `student-m`、女 `student-f`；NPC 原型（學生 6 組、教職員、櫃台、店員、警衛、志工）同一產生器；動漫臉貼圖、髮束、背包、球鞋。
- 執行期換色（atlas 色槽 → 材質 uniform）。
- 開場選角：男／女、3 組配色、暱稱（1–8 字），存 `nsysu-campus-v4.player`。
- 臉部陰影（光源與頭部朝向夾角）與頭髮高光帶（`toon.ts`）。

驗收：Blender 正側背與走路預覽、瀏覽器 idle／walk／run／jump／wave 截圖無明顯穿模；頭身 5.5–6；`walk_feel_qa` 24/24。
