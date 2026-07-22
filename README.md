# maplestorytw-character-data

此公開 Repository 只透過 GitHub Pages 提供《新楓之谷》台服角色「豹豹奶霜」的精簡角色分析 JSON，不包含 Cloudflare Worker 原始碼或完整 NEXON 原始回傳。

公開資料：

- `https://raven03115.github.io/maplestorytw-character-data/analysis.json`
- `https://raven03115.github.io/maplestorytw-character-data/health.json`

## 資料來源與更新

GitHub Actions 從公開的 Cloudflare Worker `/analysis` 端點取得資料。資料源為 NEXON Open API - MapleStory Taiwan，經 Worker 精簡及正規化後發布。

Workflow 支援手動執行，並排程於每小時第 3、18、33、48 分更新，約每 15 分鐘一次。GitHub 排程可能延遲，Worker 本身也使用 15 分鐘快取，因此 Pages 資料不保證與 NEXON 即時同步。

每次部署前都會驗證 HTTP 200、JSON Content-Type、JSON 可解析、角色名稱與實際戰鬥摘要。驗證失敗時 workflow 立即失敗，不會上傳空資料或舊資料。

## 安全

此 Repository 不需要、也不含任何 NEXON API Key、Cloudflare Token、OCID、Authorization、Cookie 或其他 Secret。產生的 `_site/analysis.json` 與 `_site/health.json` 僅存在於單次 GitHub Pages artifact，不會 commit 進 Git 歷史。
