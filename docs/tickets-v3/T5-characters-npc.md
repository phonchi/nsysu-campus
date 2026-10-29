# T5 角色與 NPC

範圍：下載 CC0 骨架角色包至獨立目錄、核對授權、記錄 `docs/licenses.md`；Blender 腳本換色與精簡動畫；3 位主角＋嚮導＋學生 NPC＋獼猴；`src/world/npc.ts` 巡邏、活動、距離休眠；`avatar.ts` 接上新角色動畫。（spec §3.4、§7）

驗收：角色 GLB 合計 < 4 MB；動畫切換無跳幀（Playwright 錄 10 s 影格檢查）；NPC 不卡牆（路徑點皆在 navmesh 或戶外可走面上）。
