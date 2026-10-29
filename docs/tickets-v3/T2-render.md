# T2 柔和卡通渲染

目標：達到 nccu100 級柔和卡通質感並守住效能。（spec §4、§11）

順序（強制）：先 `src/render/batch.ts` 合批與 instancing，量測 draw calls；再 `toon.ts`（ramp、rim、描邊只套建築與角色）、`post.ts`（MSAA、雙層 bloom、調色、暈影）、`quality.ts`（自適應）。`walk-materials.ts` 改接 toon；日／夕／夜預設同步調整 rim 與調色。

驗收：
- 桌機步行（理工區）draw calls < 400、三角形 < 1.2 M；手機模式 < 300（stats JSON）。
- 自適應畫質降級與回升可由 `?quality=` 強制，Playwright 驗各級可渲染。
- 截圖：日／夕／夜各一張、鳥瞰一張，Fable 視覺檢閱無 P1。
