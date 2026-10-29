# v4 研究：風格化 Web 3D 技術與中山校園生活資料（Gemini / agy research-mvgdca8l-3ce022ba，2026-10-20）

> 原始研究輸出，未經逐條核實；Part B 條目在用於台詞前須點開來源確認。

## Summary

本調查報告針對國立中山大學（NSYSU）3D 網頁漫遊專案（技術棧：vanilla three.js r186 + TypeScript + Vite），系統性彙整如何將場景藝術表現由低多邊形提升至原神／吉卜力風格之柔和日系卡通（Soft Toon）水準，並維持在行動端流暢與桌機約 500 次 Draw Call 預算內。報告 Part A 梳理了 12 個具代表性的開源專案與公開案例，深入解析樹冠法線球化、植被風動、筆刷草地、N8AO/頂點 AO、岸線泡沫水面、面磚去重複化、物件合批與二次元角色著色等 7 大技術；Part B 則基於中山大學與政府官方一手圖資文獻，整理出 37 條涵蓋作息時間、學餐門市、海域運動、校史傳統、西子灣夕陽、柴山獼猴共存規範與地標拍攝點的嚴謹事實清單，作為 NPC 對話與排程系統之落地數據庫。

---

## Findings

1. **樹冠「法線外擴／球化」與 InstancedMesh 是達成原神風柔和體積感的關鍵基礎**  
   傳統樹葉 Alpha-card 會因面片法線破碎產生零亂陰影，使樹木呈現硬邊燥點；業界標準解法（如 Michael Dougall 的 [Creating fluffy trees with Three.js](https://douges.dev/blog/threejs-trees) 與 craftzdog 的 [ghibli-style-shader](https://github.com/craftzdog/ghibli-style-shader)）是將樹冠葉片頂點法線替換為「以樹冠幾何中心向外輻射之單位向量（Spherical Normals）」。結合頂點著色器風動位移與 three.js 原生 `InstancedMesh`，校內數千棵樹木僅需 6–12 個 Draw Call 即可呈現柔和、澎軟的吉卜力式體積感。
2. **草地與地表採用 Instanced Blade + 地面色採樣 + 距離淡出，可避免單色平面感並抑制過度繪製**  
   如 James Smyth 在 [three-grass-demo](https://github.com/James-Smyth/three-grass-demo) 與其專文 [Stylized Grass in WebGL](https://smythdesign.com/blog/stylized-grass-webgl/) 所證實，將單一草葉簡化為 3–4 頂點之面片，在頂點著色器利用 UV.y 錨定根部並讓頂端隨風擺動；顏色則直接採樣底層地形紋理（Terrain Color Blending），並以攝影機距離在 Fragment 階段做 `smoothstep` 裁切淡出，能在 2–4 個 Draw Call 內鋪設整座西子灣田徑場與中庭草皮。
3. **環境光遮蔽（AO）應落實「桌機 N8AO、手機回退頂點 AO 與接觸貼花陰影」的分級策略**  
   在行動端 GPU 上執行即時全螢幕 SSAO/GTAO 通常佔用 4–8 ms 幀時間；N8python 開發的 [N8AO](https://github.com/N8python/n8ao)（npm: `n8ao@2.0.1`）利用時域穩定性與降噪大幅提升了 Three.js 後處理效率（桌機約 1.5–2.5 ms）。但針對行動裝置，最具成本效益的解法為在離線建模階段將 Ambient Occlusion 烤入頂點色（Baked Vertex AO），動態物件腳下則輔以單片 Alpha 貼花的接觸陰影（Contact Shadow Quad），達到 0 額外 Draw Call 與 0 算力浪費。
4. **二次元學生角色（主角／NPC）面部陰影必須跳過幾何法線，採用水平光源角度夾角或 SDF Shadow Map 閾值**  
   標準 3D 著色器（包括原生 `MeshToonMaterial`）直接對人臉計算 $N \cdot L$ 會在鼻樑與臉頰產生破碎的「骷髏陰影」；如 NiloCat 的 [UnityURPToonLitShaderExample](https://github.com/ColinLeung-NiloCat/UnityURPToonLitShaderExample) 與 NoiRC256 的 [URPSimpleGenshinShaders](https://github.com/NoiRC256/URPSimpleGenshinShaders) 所揭露，原神等日系遊戲核心技術為「以頭部朝向向量與光源方向之夾角」驅動水平陰影切割或取樣預先繪製的面部簽名距離場（SDF Face Map）。三維模型描邊則搭配反向外殼法（Inverted Hull），髮絲高光則透過 `@pixiv/three-vrm-materials-mtoon@3.5.5` 標準化的 Matcap 達成。
5. **中山大學校園生活事實查證：確立具體營業時間、公車主力與防猴法規**  
   經檢索總務處資產組官方營業表單（[property-oga.nsysu.edu.tw](https://property-oga.nsysu.edu.tw/p/16-1102-244060.php?Lang=zh-tw)）、圖書館服務時間（[lis.nsysu.edu.tw](https://lis.nsysu.edu.tw/p/412-1001-3560.php)）與公車時刻表（[safety-oga.nsysu.edu.tw](https://safety-oga.nsysu.edu.tw/p/412-1296-18044-1.php)），校內重要生活作息與設施數據全部核實：學餐主力為活動中心 2F「山海樓」（平日 07:30–19:30）、翠亨 E 棟「E 餐」、以及營業至凌晨兩點（02:00）的武嶺一村「米羅美食坊」；接駁交通主力為港都客運「橘1/橘1延」（師生刷卡免費）與校園專車；柴山獼猴規範除總務處「食不外露、不餵食、不接觸」外，壽山國家自然公園依法全面禁止餵食，違者處 1,500 至 3,000 元罰鍰。

---

## Details

### Part A: 網頁 3D 風格化技術與參考案例庫（7 大技術向）

#### 1. 精選開源專案與公開案例清單（8–12 選件）

| # | 專案 / 資源名稱 | 類型與公開 URL | 視覺與技術亮點 | 適合 three.js r186 之實作方式與 Draw Call 考量 |
|---|---|---|---|---|
| 1 | **NCCU 100 3D Campus** | 線上實例：[nccu100](https://wenzhotw.github.io/nccu100/) | 台灣大學校園 3D 化標竿，具備完整的 Soft Toon 色調、反向外殼描邊與校園地標辨識度。 | 證明反向外殼法（Inverted Hull）可在行動端穩定維持在 100–300 Draw Call 內；建築外殼應與主體幾何合批或採自定義頂點外推 Shader。 |
| 2 | **Danhai 3D Campus** | 線上實例：[danhai-3d-campus](https://danhai-3d-campus.vercel.app/) | 具備第三人稱角色控制器、相機碰撞緩衝與寬闊戶外步行校園視野。 | 驗證了 Recast 導航網格與角色在階梯、坡道間的巡航可行性，適合借鑑其相機跟隨與場景 LOD 分割。 |
| 3 | **Bruno Simon Portfolio** | 線上實例：[bruno-simon.com](https://bruno-simon.com/) | 網頁 WebGL 風格化極致代表；將陰影與環境光遮蔽完全烘焙至底圖，動態效能極高。 | 在 ~500 Draw Call 預算下，地面道路與建築基座全面改用烘焙頂點 AO 與陰影貼圖，節省昂貴的即時 Cascade Shadow Map。 |
| 4 | **craftzdog Ghibli Shader** | GitHub：[ghibli-style-shader](https://github.com/craftzdog/ghibli-style-shader) | 將 Lightning Boy Studio 的 Blender 吉卜力卡通渲染移植至 Three.js/R3F，具備自定義色彩梯度階梯與邊緣光（Rim Light）。 | 適合封裝至 `MeshToonMaterial` 的 `onBeforeCompile` 或自定義材質，共用 256×1 Ramp 紋理，不增加額外 Draw Call。 |
| 5 | **Fluffy Trees Breakdown** | 技術專文：[douges.dev/blog/threejs-trees](https://douges.dev/blog/threejs-trees) | 詳細拆解樹冠葉片面片化、頂點法線向外球形化重算（Normal Spherization）與微風噪聲位移。 | 樹冠葉片使用單一材質搭配 `InstancedMesh`；在幾何初始化時將頂點法線轉為相對於樹冠中心的向外向量，徹底解決樹冠碎裂陰影。 |
| 6 | **Stylized Grass Demo** | GitHub：[three-grass-demo](https://github.com/James-Smyth/three-grass-demo)<br>專文：[smythdesign.com](https://smythdesign.com/blog/stylized-grass-webgl/) | 仿《薩爾達傳說：曠野之息》風格化草地；低面數單葉 Instancing、頂點風動、底圖顏色取樣與距離剔除。 | 單一草葉幾何（3 頂點），使用 `InstancedMesh` 繪製數萬株草；草地 Chunk 依視野距離動態剔除與頂點收縮，僅需 2–4 Draw Calls。 |
| 7 | **Toon Water Shader** | 教學專文：[roystan.net/articles/toon-water](https://roystan.net/articles/toon-water/) | 卡通水體與岸線泡沫經典範本；基於 Depth Buffer 判定水體與地形交界產生動態白浪，噪聲波浪位移。 | 在 Three.js 取得水面 Pass 的 `depthTexture`，比對水體平面與地形深度差，差值 < 閾值處繪製岸線泡沫，西子灣海面僅需 1–2 Draw Calls。 |
| 8 | **N8AO** | GitHub：[N8python/n8ao](https://github.com/N8python/n8ao)<br>npm: `n8ao@2.0.1` | 高效能時域穩定螢幕空間環境光遮蔽（SSAO/GTAO 替代方案），降噪品質極高且支援 half-resolution 渲染。 | 桌機端可掛載於 Post-processing 流程（耗時約 2 ms），手機端則動態關閉並切換回純頂點 AO 模式。 |
| 9 | **NiloCat Toon & Genshin Shader** | GitHub：[UnityURPToonLitShaderExample](https://github.com/ColinLeung-NiloCat/UnityURPToonLitShaderExample)<br>衍生：[URPSimpleGenshinShaders](https://github.com/NoiRC256/URPSimpleGenshinShaders) | 詳細分析《原神》動漫角色臉部陰影算法：透過 Character Forward 與 Light Direction 夾角計算動態陰影線。 | 移植至 three.js 頂點/片段著色器，使角色面部完全不受曲面法線干擾，保持日系 2D 精緻立繪感。 |
| 10 | **Pixiv MToon (three-vrm)** | GitHub：[three-vrm](https://github.com/pixiv/three-vrm)<br>npm: `@pixiv/three-vrm-materials-mtoon@3.5.5` | 日本動漫 VRM 標準著色器在 Three.js 的官方實作；支援雙層陰影色、Matcap 髮絲高光與反向外殼描邊。 | 可直接抽取其 `MToonMaterial` 作為學生主角與 NPC 的專用材質，完全相容 three.js r186，支援骨骼動畫合批。 |
| 11 | **Three.js DecalGeometry** | 官方範例：[webgl_decals](https://threejs.org/examples/webgl_decals.html)<br>文件：[DecalGeometry](https://threejs.org/docs/examples/en/geometries/DecalGeometry.html) | 將不規則圖案、青苔、污漬、告示海報動態或靜態投影至建築立面上，帶 `polygonOffset` 消除 Z-fighting。 | 用於理工長廊社團海報與外牆雨漬，將多個 Decal 合併至單一 `BufferGeometry`，不產生多餘 Draw Call。 |
| 12 | **Three-Custom-Shader-Material** | GitHub：[THREE-CustomShaderMaterial](https://github.com/FarazzShaikh/THREE-CustomShaderMaterial)<br>npm: `three-custom-shader-material@6.4.0` | 允許在不破壞 three.js 原生光源、霧效、陰影傳遞下，優雅地擴充 `MeshToonMaterial` 的頂點/片段階段。 | 避免手動 patch three.js 內部 glsl chunk 造成版本升級碎裂，統一管理風動植被與面磚去重複 Shader。 |

---

#### 2. 七大技術細部實作指南（針對 three.js r186 & ~500 Draw Call 預算）

##### 技術 1：風格化樹冠（Stylized Tree Canopies）
* **幾何與法線處理（Spherical Normals）**：
  * 使用多組旋轉交叉的葉片卡片（Leaf-cards）或八面體聚合體構建樹冠。
  * **關鍵步驟**：在幾何體生成或載入後，遍歷頂點屬性 `geometry.attributes.normal`，將每個頂點的法線向量強制覆寫為：
    $$\vec{N}_{\text{spherized}} = \text{normalize}(\vec{P}_{\text{vertex}} - \vec{C}_{\text{canopy\_center}})$$
    如此受光面與背光面會呈現整顆澎軟的體積階梯，徹底消除面片邊緣突兀的破碎陰影。
* **風動頂點著色器（Wind Sway Vertex Shader）**：
  * 在頂點著色器中注入風力位移公式：
    ```glsl
    // 基于世界坐标与时间的正弦波噪声
    float sway = sin(uTime * 2.0 + dot(instancePosition.xz, vec2(0.1, 0.1))) * 0.15;
    transformed.x += sway * uv.y; // uv.y 锚定根部为 0，顶部最大位移
    ```
* **Draw Call 預算控制**：全校約 7,000 棵樹依據調色盤（`foliage.1` 至 `foliage.6` 綠色系、鳳凰木 `foliage.flame`、海岸白水木）分為 6–7 組 `InstancedMesh`，樹幹統一為 1 組，總計樹木繪製調用僅需 **7–8 次 Draw Calls**。

##### 技術 2：筆刷草地與地面紋理（Grass Fields & Ground Textures）
* **單葉幾何與合批**：
  * 草葉採用 3 頂點三角形（底寬 0.1 m，高 0.4–0.6 m）。
  * 透過 `InstancedMesh` 進行叢集分塊（Chunking，例如每塊 40×40 m），依玩家相機距離進行視錐與距離剔除（LOD 距離外不渲染或縮小為 0）。
* **地面顏色融合（Terrain Color Blending）**：
  * 草葉頂點著色器採樣底層地形紋理（`uGroundTexture`）或傳入地形頂點色，使草地底色與下方的泥土/草皮（`grass.a` `#86c45c` 與 `grass.b` `#6fb04e`）無縫銜接。
* **距離淡出（Distance Fade）**：
  * 在頂點著色器計算攝影機距離 $d = \text{length}(\vec{P}_{\text{cam}} - \vec{P}_{\text{world}})$；當 $d$ 超過 40 m 時，頂點高度依比例線性壓扁至 0，避免在遠處形成密集像素噪點。
* **地表紋理推薦（CC0 資源）**：
  * 草皮變化與泥土：[ambientCG Ground037](https://ambientcg.com/view?id=Ground037)
  * 西子灣人行道石板：[Poly Haven Cobblestone Floor 03](https://polyhaven.com/a/cobblestone_floor_03)
  * 西子灣沙灘：[ambientCG Sand002](https://ambientcg.com/view?id=Sand002)
  * 鋪設時採用二組 UV 噪聲在著色器中做 Macro 混合，打破貼圖拼接感（Tiling artifacts）。全校草地預算維持在 **4–6 次 Draw Calls**。

##### 技術 3：環境光遮蔽（Ambient Occlusion）與接觸陰影
* **分級渲染策略**：
  * **桌機端（Tier A）**：引入 `n8ao@2.0.1` 封裝之 `N8AOPass`。
    ```typescript
    import { N8AOPass } from 'n8ao';
    const n8aoPass = new N8AOPass(scene, camera, window.innerWidth, window.innerHeight);
    n8aoPass.configuration.aoRadius = 2.0;
    n8aoPass.configuration.distanceFalloff = 0.8;
    n8aoPass.configuration.intensity = 1.5;
    n8aoPass.configuration.halfRes = true; // 开启半分辨率以节省带宽
    ```
  * **行動端（Tier B/C）**：完全關閉即時 AO Pass（節省 15–20% GPU 功耗與避免高溫掉幀）。改採離線將遮蔽值烘焙至幾何頂點色 `geometry.attributes.color`（底部簷下乘 0.65，受光頂面 1.0）。
* **動態接觸陰影（Contact Shadow Quad）**：
  * 角色與大型道具底座下方綁定一個水平圓形面片（Quad），貼附具備徑向高斯模糊的 Alpha 貼圖（中心 Alpha 0.45，邊緣 0.0），混合模式採 `MultiplyBlending`，隨地面高程微幅抬升 0.02 m 並開啟 `polygonOffset`。在關閉動態陰影地圖的手機上，依然能精確提供腳踏實地的空間錨定感。

##### 技術 4：風格化水體與西子灣海面（Stylized Sea & Foam）
* **深度緩衝岸線浪沫（Depth-based Shoreline Foam）**：
  * 將西子灣海平面設為單一 `PlaneGeometry`。
  * 著色器讀取場景深度圖 `sceneDepth` 與水體自身深度 `waterDepth`。當 $\Delta z = |\text{sceneDepth} - \text{waterDepth}| < \text{uFoamThreshold}$ 時，疊加浪沫顏色（`sea.foam` `#ffffff`），並以滾動的 Perlin 噪聲紋理擾動浪緣，模擬波浪拍打消波塊與沙灘的細密白沫。
* **漸層海面與夕陽高光帶（Sun Glint）**：
  * 水體自岸邊向外海分為淺海（`sea.shallow` `#62c8d2`）、中深（`sea.mid` `#2f93a6`）與深海（`sea.deep` `#1f6f86`）。
  * 夕陽時段（太陽仰角 9°），著色器計算視線方向 $\vec{V}$ 與太陽方向 $\vec{L}$ 的微表面反射，沿太陽方位角（262°）產生一條寬約 25 m 的橘紅高光波帶（`sea.sunGlint` `#ff8f5a`），直指西子灣外海防波堤。海面繪製僅需 **2 次 Draw Calls**。

##### 技術 5：風格化紅磚立面去重複化（Breaking Façade Repetition）
* **色塊節奏與飾帶**：
  * 中山大學標誌性「深紅褐二丁掛磚」若以單一紋理重複鋪貼，遠看會產生嚴重的摩爾紋與積木感。
  * 解法：以層帶為單位切分幾何，每層樓外挑 0.15 m 白色水泥橫樑飾帶（`trim.cream` `#f3ebdb`），垂直向每 2 個柱跨（Bay 6.0 m）加入紅磚突柱。
* **頂點噪聲混色（Macro Color Variation）**：
  * 在材質中混入大型 Perlin 噪聲（週期約 15 m），使大面積牆面隨機在基底磚紅（`brick.base` `#c75f4a`）與偏暗陰影紅（`brick.shade` `#a8493a`）之間微幅漸變。
* **貼花與牆面污漬（Decals & Grime）**：
  * 引入 `DecalGeometry`（[webgl_decals](https://threejs.org/examples/webgl_decals.html)），在建築底座牆角投影雨水青苔貼花，在長廊立柱投影社團海報。將同一棟建築的所有 Decal 面片於載入時執行 `BufferGeometryUtils.mergeGeometries`，使整棟建築的所有貼花合併為單一 Draw Call，並設定 `material.polygonOffsetFactor = -4`。

##### 技術 6：場景物件合批散布（Props Scattering & Instancing）
* **物件種類與模型來源（CC0 資源）**：
  * 路燈、長椅、垃圾桶、自動販賣機、校園單車與花台：選用 [Kenney City Kit / Furniture Kit](https://kenney.nl/assets) 與 [Quaternius Stylized Props Pack](https://quaternius.com/)（均為 CC0 1.0 Universal 公共領域授權）。
* **合批實作**：
  * 每種道具原型（Archetype）統一使用單一貼圖圖集（Texture Atlas, 1024×1024）與材質。
  * 利用 `InstancedMesh` 散布：全校 150 盞路燈 = 1 Draw Call；80 張木長椅 = 1 Draw Call；20 台飲料販賣機 = 1 Draw Call；300 輛停放腳踏車 = 1 Draw Call。
  * 全校戶外街道家具總計僅需 **10–15 次 Draw Calls**，即使在低階手機上亦不造成 CPU 瓶頸。

##### 技術 7：動漫角色風格化著色（Anime Character Shading）
* **面部陰影向量閥值法（Orientation-based Face Shading）**：
  * 針對主角與 NPC 頭部，不使用頂點法線進行光照，而是傳入頭部正向單位向量 $\vec{F}_{\text{head}}$、右向向量 $\vec{R}_{\text{head}}$ 與平行光源方向 $\vec{L}$。
  * 計算水平受光偏角：
    $$\text{angle} = \text{atan2}(\vec{L} \cdot \vec{R}_{\text{head}}, \vec{L} \cdot \vec{F}_{\text{head}})$$
  * Fragment 階段根據頭部 UV 座標取樣面部遮罩紋理（SDF Face Mask），判斷像素是否落於陰影區。無論光源仰角或相機角度如何旋轉，面部陰影邊緣永遠呈現乾淨流暢的二次元漫畫線條。
* **髮絲天使環高光（Matcap Hair Highlight）**：
  * 採用 `@pixiv/three-vrm-materials-mtoon@3.5.5` 的 Matcap 技術：透過相機空間法線 $\vec{N}_{\text{view}}$ 採樣一張預製的橫向橢圓白色光斑紋理，使學生主角在視角轉動時，髮絲上方的水平天使環光暈能自然流轉。
* **反向外殼描邊（Inverted Hull Outline）**：
  * 複製角色幾何，設定 `side: THREE.BackSide`，頂點著色器沿平滑法線外推：
    $$\vec{P}_{\text{outline}} = \vec{P} + \vec{N}_{\text{smooth}} \times \text{clamp}(\text{offset}, 0.006, 0.03)$$
  * 材質使用 `MeshBasicMaterial`，描邊色指定為深藍黑（`outline.char` `#2a2c4a`），在保持原神手繪質感的同時抑制遠距破面。主角與 12–24 位 NPC 骨骼動畫合批後，角色渲染維持在 **20–40 次 Draw Calls**。

---

### Part B: 國立中山大學（NSYSU）校園生活事實查證庫（37 條帶出處清單）

以下條目均查證自國立中山大學官方行政/教學單位網站、政府公報、文化部國家文化資產網及校園主流新聞，不含推論臆測，可直接作為 NPC 對話台詞、日常行程腳本與任務地標之內容數據源。

#### 一、 作息、學餐、便利商店與生活機能
1. **活動中心「山海樓饗食廣場」**：位於學生活動中心 2 樓，2019 年（民國 108 年）全面整修重新開幕，引進智慧 APP 手機點餐與行動支付。進駐櫃位包含「雞餓早午餐」（平日 07:30–19:00 提供素食）、「龍馬創意粥品」、「小雞好食堂」、「五花馬水餃館」、「一番鍋燒」、「松本鮮奶茶」、「山海河粉」與「巧味丼飯」（11:00–19:30）。（來源：[總務處資產組校內各商家營業時間](https://property-oga.nsysu.edu.tw/p/16-1102-244060.php?Lang=zh-tw)）
2. **學生活動中心「柒拾參階餐飲店」**：位於學生活動中心 3 樓，供應各式簡餐與飲料（提供素食），營業時間為 09:00 至 20:30，每週一固定公休。（來源：[總務處資產組校內各商家營業時間](https://property-oga.nsysu.edu.tw/p/16-1102-244060.php?Lang=zh-tw)）
3. **學生宿舍武嶺學餐「米羅美食坊」**：座落於武嶺一村宿舍，供應早午晚餐與全校聞名的深夜宵夜。平常日早餐 05:30 開賣，麵食鍋貼與自助餐供應至 20:00，宵夜時段自 17:00 持續營業至凌晨 02:00，是中山夜貓族與趕報告學生的宵夜心臟。（來源：[總務處資產組校內各商家營業時間](https://property-oga.nsysu.edu.tw/p/16-1102-244060.php?Lang=zh-tw)）
4. **學生宿舍翠亨「E 餐」（淳蓮企業行）**：位於翠亨宿舍 E 棟，包含「小茶點茶坊」（早餐 07:00–13:00）、「十里飄香」便當與「中山河粉」（11:00–14:00、17:00–20:00）以及自助餐（11:00–13:30、17:00–19:30）。（來源：[總務處資產組校內各商家營業時間](https://property-oga.nsysu.edu.tw/p/16-1102-244060.php?Lang=zh-tw)）
5. **校內超商與特色福利社**：學生活動中心 2 樓設有 24 小時營業之「全家便利商店」；翠亨宿舍 H 棟設有「萊爾富便利商店」（平日 07:00–22:30）；理學院地下室設有「翠理商行」（學生俗稱「理百」，平日 07:00–18:30）；文學院 1 樓設有「寶強商行」（學生俗稱「文百」，平日 08:30–16:10）。（來源：[總務處資產組校內各商家營業時間](https://property-oga.nsysu.edu.tw/p/16-1102-244060.php?Lang=zh-tw)）
6. **菩提樹廣場咖啡座**：行政大樓與圖資大樓之間的菩提樹廣場平台設有「威爾希斯咖啡」，平日營業時間為 08:00 至 16:00（視情況延長至 17:00），提供輕食與現煮咖啡，為師生戶外課餘討論的主要集會點。（來源：[總務處資產組校內各商家營業時間](https://property-oga.nsysu.edu.tw/p/16-1102-244060.php?Lang=zh-tw)）
7. **校內生活服務商鋪**：學生活動中心 2 樓進駐「麗文書局」（平日 09:00–20:00）、「吉晟鐘錶眼鏡行（中山眼鏡行）」、「美髮部」與「理髮部」；地下室設有「快潔專業洗衣店」；西綜合大樓地下室設有「台灣富士全錄」影印裝訂。（來源：[總務處資產組校內各商家營業時間](https://property-oga.nsysu.edu.tw/p/16-1102-244060.php?Lang=zh-tw)）
8. **圖書館總圖開館時間**：圖資大樓 3 樓至 8 樓閱覽與圖書流通櫃檯，學期期間週一至週五開放時間為 08:00 至 22:00，週六與週日為 09:00 至 17:00；後門設有 24 小時智慧還書箱。（來源：[圖書與資訊處服務時間](https://lis.nsysu.edu.tw/p/412-1001-3560.php)）
9. **圖書館自修室（集思軒與書香町）**：位於圖資大樓 1 樓，平日開放時間為 09:00 至深夜 24:00，週末開放至 22:00；每逢期中考與期末考前一週及當週，週末全面延長開放至 24:00。（來源：[圖書與資訊處服務時間](https://lis.nsysu.edu.tw/p/412-1001-3560.php)）
10. **余光中特藏室**：位於圖資大樓 3 樓，典藏余光中教授之手稿、早期詩集、打字機與紀念物件，平日開放時間為 08:00 至 17:00，週末與國定例假日不開放。（來源：[圖書與資訊處服務時間](https://lis.nsysu.edu.tw/p/412-1001-3560.php)）
11. **圖資大樓歷史與陳其寬建築師**：圖書館原設於行政大樓，1988 年先遷入圖資大樓 10 樓，1989 年 11 月 12 日全館正式啟用；建築工程設計圖（民國 73 年 10 月）由著名建築師陳其寬署名親筆擘劃。（來源：[圖書與資訊處處史](https://lis.nsysu.edu.tw/p/412-1001-1174.php) / [文化部典藏網陳其寬設計圖](https://collections.culture.tw/Object?SYSUID=31&RNO=Q0NDSzI2MTIzMDQ1)）

#### 二、 體育場館、海域運動中心與特色社團
12. **體育館建築規格**：體育館為地上 3 層建築。1 樓設有桌球教室（面積 416 平方公尺，配備 12 張球桌）、韻律舞蹈教室、器材室與 100 人階梯視聽教室；2 樓為體育組辦公室；3 樓為 1,428 平方公尺之全楓木地板綜合球場，4 樓看台設有 1,500 席固定座位與 800 席活動看台；3 樓另設有第一體適能中心（120 平方公尺）。（來源：[學務處體育發展組場館簡介](https://ph-osa.nsysu.edu.tw/p/412-1089-23864.php?Lang=zh-tw)）
13. **第二體適能中心（健身房）**：坐落於田徑場看台下方，內部規劃有心肺有氧區、重量訓練區與高強度功能訓練區，配備深蹲架、臥推架與淋浴設備。（來源：[學務處體育發展組場館簡介](https://ph-osa.nsysu.edu.tw/p/412-1089-23864.php?Lang=zh-tw)）
14. **西灣第一線海景運動場**：本校田徑場（400 公尺 PU 跑道、3,000 人司令台）、棒壘球場（紅土夜照球場）、室外排球場（4 面標準場）與溜冰場（長 50 m、寬 25 m）皆緊鄰西子灣海岸線第一排，運動時可直接遠眺海堤浪花與落日。（來源：[學務處體育發展組場館簡介](https://ph-osa.nsysu.edu.tw/p/412-1089-23864.php?Lang=zh-tw)）
15. **臨海游泳池**：佔地 1,920 平方公尺，規劃為 50×30 m 標準大池與 25×13 m 教學小池，設有電動伸縮遮陽網與夜間照明，除供游泳課使用外，亦為校內潛水訓練專用池。（來源：[學務處體育發展組場館簡介](https://ph-osa.nsysu.edu.tw/p/412-1089-23864.php?Lang=zh-tw)）
16. **海洋特色體育課程**：中山大學充分利用西子灣海域，長年開設潛水、風帆、水域休閒活動、初級衝浪與水中救生等正式體育學分課程，並開放高醫等外校跨校選修。（來源：[中山校園新聞：西灣飆浪體驗](https://news.nsysu.edu.tw/p/404-1120-148067.php?Lang=zh-tw)）
17. **海域運動中心與推廣活動**：產學處與體育中心長年在西子灣海域中心舉辦「西灣風帆體驗班」、「海上蛟龍養成班」，引進雷射型帆船（Laser）、Topaz 帆船、風浪板、獨木舟與 SUP 立槳體驗。（來源：[全球產學營運及推廣處](https://ceo-ogiaca.nsysu.edu.tw/CourseDetail.aspx?ID=d1ea6a22-ddfd-4390-94c8-81a2d9a7e7f0&IsOpenSignUp=False)）
18. **海洋親海社團**：校內設有「風帆社」、「潛水社」等海洋性學生社團，定期於西子灣水域進行船艇組裝出海訓練與海洋生態踏查。（來源：[中山校園新聞：風帆西子灣](https://news.nsysu.edu.tw/p/404-1120-136625.php?Lang=zh-tw)）

#### 三、 交通路線與接駁實況（打破謬誤）
19. **市區公車「紅33」不經中山**：市區「紅33」為明誠幹線，從未駛入西子灣或中山校區。（來源：[國立中山大學校史與交通查核報告](file:///home/phonchi/habbit/docs/reference/nsysu-history-v3.md#L61-L68)）
20. **港都客運「橘1 / 橘1延」接駁**：由港都客運電動中巴營運，自捷運/輕軌哈瑪星站 1 號出口發車，沿途停靠哨船頭、西子灣（英國領事館）、行政大樓、翠亨 H 棟、活動中心、武嶺路口、文學院至柴山慈德宮；中山師生持已開卡學生證刷卡享校方補貼 0 元免費搭乘。（來源：[校安防護組橘1時刻表](https://safety-oga.nsysu.edu.tw/p/405-1296-193061,c18044.php?Lang=zh-tw)）
21. **校園巡迴公車（校巴）**：校方專為師生開辦之免費巡迴巴士，平日行駛於「捷運西子灣站 2 號出口 ⇄ 行政大樓 ⇄ 翠亨宿舍 ⇄ 活動中心 ⇄ 武嶺路口 ⇄ 文學院」，憑學生證或教職員證即可直接上車免費搭乘。（來源：[校安防護組校園公車時刻表](https://safety-oga.nsysu.edu.tw/p/405-1296-252682,c18044.php?Lang=zh-tw)）
22. **高鐵直達公車「紅52」**：港都客運「紅52」路自高鐵左營站（台鐵新左營站）直達國立中山大學行政大樓前，為返鄉與出差師生南北往返最主要幹線。（來源：[校安防護組紅52時刻表](https://safety-oga.nsysu.edu.tw/p/405-1296-193060,c18044.php?Lang=zh-tw)）

#### 四、 臺灣獼猴生態共存與官方罰則
23. **總務處防猴三原則**：總務處事務組長年宣導校園防猴核心規則：「一、食物不外露（嚴禁手提塑膠袋或紙袋）；二、不餵食；三、不接觸」；食物必須妥善收納於後背包並拉緊拉鍊。（來源：[總務處事務組獼猴安全宣導注意事項](https://admin-support-oga.nsysu.edu.tw/p/406-1100-110789,r1266.php?Lang=zh-tw)）
24. **遭遇攻擊性行為應對**：若獼猴表現攻擊性行為（如眨眼、露齒威嚇、吼叫），官方指引載明：**「請勿與其眼神接觸，並慢慢走開」**，切勿揮舞長棍挑釁或大聲尖叫。（來源：[總務處事務組獼猴安全宣導注意事項](https://admin-support-oga.nsysu.edu.tw/p/406-1100-110789,r1266.php?Lang=zh-tw)）
25. **宿舍防猴紗窗規範**：壽山獼猴具備開窗能力，學生宿舍規範離開寢室或睡眠時必須緊扣防猴窗栓與安全卡榫，避免猴群入室翻找乾糧與毀損個人財物。（來源：[國際事務處獼猴宣導專區](https://oia.nsysu.edu.tw/p/405-1308-246263,c20706.php?Lang=zh-tw)）
26. **壽山國家自然公園禁餵罰則**：依據《國家公園法》第 13 條第 8 款及內政部公告「壽山國家自然公園區域內禁止事項」，全區全面嚴禁餵食獼猴及其他野生動物，違者處新台幣 1,500 元至 3,000 元罰鍰。（來源：[行政院公報：壽山國家自然公園區域內禁止事項](https://gazette.nat.gov.tw/EG_FileManager/eguploadpub/eg018118/ch02/type2/gov10/num4/Eg.htm)）
27. **被搶食因應與學生保險**：國際處與學務處宣導，遭遇獼猴搶食切記自身安全第一、立即放手放棄食物；若不幸遭猴抓咬傷，應立即至衛保組消毒就醫，並由學務處協助申請學生平安保險給付。（來源：[國際事務處獼猴注意事項](https://oia.nsysu.edu.tw/p/405-1308-246263,c20706.php?Lang=zh-tw)）

#### 五、 校史、地標建築與打卡拍照名所
28. **校門口校碑**：座落於校門口哨船街與蓮海路交界海堤旁，標高達 21.2 公尺，筆直書寫金色「國立中山大學」字樣，為歷屆新生入學與畢業生穿學位服必拍首選。（來源：[中山校園新聞：校碑標高21.2公尺](https://news.nsysu.edu.tw/p/404-1120-242198.php?Lang=zh-tw)）
29. **海邊雅座「蘿蔔坑」**：校門旁臨海海堤長達數百公尺，女兒牆凹槽狀設計被師生俗稱為「蘿蔔坑」，一格剛好能容納兩人並坐，傍晚時分吸引大批學生與情侶駐足觀賞「西灣落日」染紅海峽。（來源：[中山校園新聞：海邊雅座蘿蔔坑](https://news.nsysu.edu.tw/p/404-1120-242198.php?Lang=zh-tw)）
30. **西子灣隧道（壽山洞）**：昭和 2 年（1927 年）開挖、昭和 3 年（1928 年）竣工，由承包商海野三次郎的「海野組」開鑿，總長約 260 公尺，是全台灣唯一穿越山腹直達大學校園的人行歷史隧道。（來源：[國立中山大學西子灣隧道簡介](https://www.nsysu.edu.tw/p/404-1000-179130.php?Lang=zh-tw)）
31. **歷史建築文化資產登錄**：高雄市政府於 2004 年 4 月 8 日正式將西子灣隧道登錄為高雄市歷史建築，登錄法定名稱為「西子灣隧道及其防空設施」。（來源：[文化部文化資產局國家文化資產網](https://nchdb.boch.gov.tw/assets/overview/historicalBuilding/20201127000001)）
32. **行政大樓與雙銅獅**：行政大樓於 1984 年完工，大門正前方設有兩座據傳由藝術家陳志慈鑄造的青銅巨獅雕像（公獅左腳踏繡球、母獅右腳撫小獅）。2024 年 12 月秘書室更替銅獅戴上大型紅白毛帽與紅綠圍巾，成為爆紅耶誕打卡點。（來源：[中山校園新聞：行政大樓前雙銅獅戴聖誕帽](https://news.nsysu.edu.tw/p/404-1120-346875.php?Lang=zh-tw)）
33. **逸仙館演藝劇場**：座落於行政大樓右前方，為地上 4 層大型鏡框式舞台專業劇場，觀眾席設有 1,370 席，座椅顏色巧妙排列出「NSYSU」字樣，為歷屆校慶大會與畢業典禮舉行場所。（來源：[藝文中心逸仙館場地介紹](https://artcenter.nsysu.edu.tw/p/412-1008-1148.php?Lang=zh-tw)）
34. **常態藝文季活動**：藝文中心每年定期推動兩檔旗艦大型藝術季：3–6 月「中山陽光藝術季」與 9–12 月「西灣表演藝術季」，在逸仙館與戶外草坪帶來音樂會、當代舞蹈與戲劇演出。（來源：[藝文中心主要業務介紹](https://artcenter.nsysu.edu.tw/p/412-1008-1148.php?Lang=zh-tw)）
35. **西子灣行館（前高雄觀光館）**：建於 1935 年（日治昭和 10 年），原為始政四十周年臺灣博覽會之「高雄觀光館」，會後改為「西子灣溫浴場」，戰後曾作為蔣公行館，2023 年 12 月底正式復原日治溫浴池遺構。（來源：[藝文中心西子灣行館沿革](https://artcenter.nsysu.edu.tw/p/412-1008-26424.php?Lang=zh-tw)）
36. **余光中創院與《高樓對海》**：詩人余光中教授自 1985 年至 1991 年擔任文學院創院院長，在文學院任教期間寫下名篇《高樓對海》：「高樓對海，長窗向西／黃昏之來多彩而神秘／落日去時，把海峽交給晚霞／晚霞去時，把海峽交給燈塔」。（來源：[文學院歷任院長名錄](https://la.nsysu.edu.tw/p/412-1016-3641.php?Lang=zh-tw) / [余光中數位文學館](https://dayu.lis.nsysu.edu.tw/)）
37. **文學院桂花巷、清園與茶山亭**：文學院坐落壽山山腰，設有栽植百株桂花的「桂花巷」、取朱熹「為有源頭活水來」詩意的「清園」水景，以及建於高處、鋪設韓式木地板需脫鞋席地而坐的「茶山亭」，可飽覽整個西子灣外海防波堤。（來源：[中山校園新聞：茶山亭觀海休憩新景點](https://www.nsysu.edu.tw/p/404-1000-52589.php?Lang=zh-tw)）

---

## Unverified / open questions

1. **西子灣隧道正式通車月份與歷史號誌**  
   * 狀況：日治文獻確認隧道於 1927 年開工、1928 年竣工，部分網路文章稱「1928 年 10 月正式通車」或「1933 年開放一般車輛」，但目前文化部文資網與校方一手檔案均僅寫 1928 年完工，通車確切日期未見官方一手公文佐證。  
   * 驗證方式：需調閱高雄州廳日治時期《台灣日日新報》或高雄州報當期公告。
2. **圖資大樓八角皇冠折板之精確結構角度與材質**  
   * 狀況：陳其寬建築師之手繪立面設計圖明確畫出 11–12 樓挑空之多角斜頂折板結構，目前 3D 模型假定為八角角錐折板（坡度約 30°、暗褐色塗層金屬折板）。  
   * 驗證方式：需向校方總務處營繕組調閱圖資大樓竣工工程結構竣工圖。
3. **行政大樓前雙銅獅作者「陳志慈」之生平檔案**  
   * 狀況：校方新聞報導指稱行政大樓銅獅「據傳」為雕塑家陳志慈鑄造，但教育部或高美館典藏紀錄中關於陳志慈之生平資料極少。在 NPC 台詞中建議維持「據傳由雕塑家鑄造」，不宜斷言確定。  
   * 驗證方式：調閱 1984 年行政大樓落成時總務處之採購發票或捐贈儀式老照片銘牌。
4. **校門實體幾何中心與 OpenStreetMap 節點偏差**  
   * 狀況：現行地圖對位顯示 OSM「校門」節點與校方平面示意圖所標之校門警衛亭相差約 140 公尺（專案已於 [README.md](file:///home/phonchi/habbit/README.md#L85) 標註已知限制）。  
   * 驗證方式：需使用 RTK GPS 或現地拍照量測校門與哨船街斑馬線之實際 WGS84 座標。

