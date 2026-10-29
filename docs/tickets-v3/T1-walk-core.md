# T1 步行核心

目標：消除人物抖動，提供穩定跟隨與可鎖定相機；把 `src/walkthrough.ts` 拆成 `src/walk/*` 模組。（spec §2、§3）

範圍：
- `src/walk/controller.ts`：`CharacterController` 介面＋`RapierController`（48 m 分區 trimesh、KCC autostep／snap／slope、1/120 s 子步）。
- `src/walk/camera-rig.ts`：跟隨、鎖定 L、第一人稱 V＋pointer lock、鳥瞰 M（可平移不被踢出）、sphere-cast 遮擋、最小 1 m＋近距淡出、FOV 奔跑、帶路轉向時間制。
- `src/walk/avatar.ts`：動畫狀態機（Jump 只播一次、Fall 延遲 0.15 s、Land）、朝向平滑、速度取意圖速度。
- `src/walk/input.ts`、`interaction.ts`、`hud.ts`、`debug.ts`、`runtime.ts`；`walkthrough.ts` 改為薄殼轉呼叫。
- 陰影 texel snap（`walk-sky.ts`）、LOD 遲滯（`walk-lod.ts`）。
- `window.campusWalk` 增加 `onGround`、`camera`（位置、距離、模式、鎖定）、`animState`。

驗收：
- vitest：`tests/walk-controller.test.ts` 斜向撞牆／沿牆／柱間／樓梯各 120 步，平地 y 抖動 < 1 mm、`onGround` 不中斷。
- vitest：相機臂沿牆 300 幀，距離逐幀增量 < 0.15 m（拉近除外）。
- `tests/walk-manual.test.ts` 改用 `RapierController`（`await RAPIER.init()`）：877/877 房、樓梯、跨棟、電梯全過，E 選錯門 0。
- Playwright 逐幀記錄 y／相機，平地行走無振盪；`npm run walk:qa` 10/10。
- 移除 `walk-physics.ts`、`walk-collision.ts` 與其測試（以新測試取代）。
