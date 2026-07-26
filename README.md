# maplestorytw-character-data

此公開 Repository 只提供《新楓之谷》台服固定白名單角色的精簡分析 JSON，不包含 Cloudflare Worker 原始碼或完整 NEXON 原始回傳。

公開資料：

- `https://raven03115.github.io/maplestorytw-character-data/analysis.json`（challenger 相容別名）
- `https://raven03115.github.io/maplestorytw-character-data/health.json`（challenger 相容別名）
- `https://raven03115.github.io/maplestorytw-character-data/characters/challenger/analysis.json`
- `https://raven03115.github.io/maplestorytw-character-data/characters/challenger/health.json`
- `https://raven03115.github.io/maplestorytw-character-data/characters/adele/analysis.json`
- `https://raven03115.github.io/maplestorytw-character-data/characters/adele/health.json`

固定角色：

- `challenger`：豹豹奶霜／狂豹獵人／DEX 主屬性／STR 副屬性
- `adele`：余盼／阿戴爾／STR 主屬性／DEX 副屬性

## 資料來源與更新

GitHub Actions 依序從公開 Cloudflare Worker 的 `/characters/{characterId}/analysis` 取得兩個角色。資料源為 NEXON Open API - MapleStory Taiwan，經 Worker 精簡及正規化後發布。

Workflow 支援手動執行；功能分支把未來排程調整為每小時第 7 分一次。GitHub 排程可能延遲，Worker 本身使用 15 分鐘快取，因此 Pages 資料不保證與 NEXON 即時同步。多角色會增加 Worker 聚合快取失效時的 NEXON 呼叫量，若 NEXON 應用仍在開發階段，應持續觀察每日配額。

每次產生器執行都先依序驗證兩個角色的 HTTP 200、JSON Content-Type、JSON 可解析、精確角色名稱、精確職業、主副屬性名稱、實際戰鬥力與敏感欄位。只有兩者全數通過後才會寫入 `_site` 與 connector-readable snapshot；任一失敗時 workflow 立即失敗，既有 Pages 部署不會被取代。

根目錄 `analysis.json` 與 `health.json` 永久是 `challenger` 的相容別名。

## 安全

此 Repository 不需要、也不含任何 NEXON API Key、Cloudflare Token、OCID、Authorization、Cookie 或其他 Secret。產生器會遞迴拒絕這些敏感欄位；Actions 日誌只輸出角色數、來源總位元組數與 snapshot 狀態，不輸出完整 JSON。

## 本機驗證

```powershell
npm install
npm run check
```

測試使用 mock Response，不會呼叫正式 Worker 或 NEXON API。

## 新增或改名

1. 先在私人 Worker 專案更新並驗證固定角色設定。
2. 在 `scripts/build-pages.mjs` 的 `CHARACTERS` 加入或修改相同 ID、精確名稱、職業及主副屬性。
3. 補上雙角色抓取、驗證、輸出、相容別名與敏感資訊測試。
4. 執行 `npm run check`，審閱草稿 PR；Worker 新路由正式部署後才可合併並手動觸發 Pages workflow。

## 發布與回復

GitHub Pages 由 `.github/workflows/deploy-pages.yml` 使用官方 `configure-pages`、`upload-pages-artifact` 與 `deploy-pages` actions 發布。功能分支不應手動執行正式 workflow。

若新資料驗證失敗，workflow 會在上傳 artifact 前停止並保留上一版部署。若已合併的產生器有問題，請以最後一個已驗證 commit 建立修正 PR；不要強制推送或手動提交 `_site`。
