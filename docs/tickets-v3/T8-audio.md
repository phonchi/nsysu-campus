# T8 音效

範圍：`src/audio/sound.ts` WebAudio 環境音（海浪、蟬鳴依區域）、腳步、任務音效；預設靜音，喇叭鈕切換並記憶。（spec §10）

驗收：靜音預設不建立 AudioContext；開啟後 Playwright 確認 context running；退出 3D 後關閉。
