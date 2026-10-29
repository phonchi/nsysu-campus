# GitHub 公開版本

目的地：https://github.com/phonchi/nsysu-campus （公開）。

原始開發目錄的歷史含官方來源檔與參考素材，不直接推送該歷史。公開原始碼快照位於 `artifacts/github-source/`，其獨立 Git repository 才連接公開 remote；後續更新應先同步乾淨快照、驗證再推送，不把原開發歷史接到此 remote。

公開範圍：src、public、tests、tools、docs、套件與建置設定。排除 data 原始來源、artifacts、reviews、handoffs、node_modules、dist、第三方下載包與本機設定。

公開版 build 不執行需原始官方 PDF/平面圖的內部資料稽核；保留公開資料／導航 hash／章節／型別驗證。詳見公開快照根目錄 PUBLICATION.md。已啟用 GitHub Actions → GitHub Pages 自動部署；網站 https://phonchi.github.io/nsysu-campus/ ，工作流程位於公開快照 `.github/workflows/pages.yml`。公開版使用免費 Pages／Actions，沒有啟用付費設定。後續同步原始碼時保留公開庫的 workflow、PUBLICATION.md 與公開版 package scripts。
