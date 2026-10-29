# U1 美術基礎（樹、草、地面、AO、立面、天空與海）

依賴：無。規格：spec-v4 §4、§15.6、§15.8；美術：art-direction-v4 §2–§5、§7。

- 新 `src/render/foliage.ts`：五族群樹（榕、鳳凰木、小葉欖仁、棕櫚、海岸灌叢）葉片卡片樹冠，球化法線、風擺、instanceColor；取代 `walk-art.ts` 的 icosahedron 樹冠（山坡遠樹保留簡化團塊）。
- 草：單一 InstancedMesh，以玩家為中心 60 m 重新填充，遠端漸縮；數量依 tier。
- 新 `src/render/ground.ts`：草地雙尺度噪聲兩色、步道邊磨損帶、鋪面依區域、沙灘乾濕、濕海堤。
- 立面：磚色大尺度噪聲、牆腳污漬（頂點色）、窗凹側壁（L0）、窗台與腰帶。
- AO：頂點 AO（建築牆腳、簷下）；Tier A N8AO（量測後決定），接觸陰影貼片。
- 天空：雲層、時段 token（art-direction-v4 §2.2）；海：水深雙帶泡沫、夕陽反光帶。
- `quality.ts` 加 `detail` 分級表（§15.8）。

驗收：12 機位截圖與 v3 並排；草地 200 px 區塊 ≥ 3 綠峰；同種樹不連續 > 3；A 步行 < 500 draws；vitest、`walk_feel_qa` 不退步。
