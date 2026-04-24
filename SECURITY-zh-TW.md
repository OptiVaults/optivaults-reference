# 安全政策 — OptiVaults Operator 層參考實作

## 範圍

本 repo 收錄 **V1 operator 層的參考實作**——keeper、API server、frontend、self-serve 恢復工具的鏈下 TypeScript 程式。本 repo 處理的安全揭露範圍**僅限於 operator 層程式**。

**協議層發現**(Aiken validator bug、datum 注入、redeemer 誤用、鏈上不變量違反)屬於姊妹 repo [`optivaults-protocol`](https://github.com/OptiVaults/optivaults-protocol) 的範圍。見 [`optivaults-protocol/SECURITY.md`](https://github.com/OptiVaults/optivaults-protocol/blob/v1/SECURITY.md)。

**不確定時,預設走 `optivaults-protocol`**——triage 會適當轉派。

---

## 通報 operator 層漏洞

若你在 operator 參考實作(keeper runtime、API 驗證、frontend XSS、CLI 解析 bug、設定洩漏等)中發現安全性漏洞,請私下通報。**不要開公開 issue**。

**Email:** `optivaults@gmail.com`
**PGP key:** `optivaults.app/security`(加密敏感技術細節)

**通報內容請包含:**
- 漏洞描述
- 重現步驟(若尚未實作成 exploit,給理論攻擊流程也可以)
- 影響評估(嚴重性 + 受影響元件)
- 建議的修復方向(若有想法)

**回應時程:**
- 私下確認收到:72 小時內
- 初步 triage:7 天內
- Fix + patch 公告:視嚴重性而定;CRITICAL / HIGH 目標 30 天內完成修補,並立即公開 operator 端的暫時緩解

---

## 範圍內(operator 層)

當程式遷入後(見 `README.md` 的 repo 狀態表):

- **Keeper TypeScript runtime**(`keeper/`)——Compound / Batch / Supply / Recall / VaultSwap 指揮、cooldown 狀態持久化、Blockfrost/Ogmios 速率限制處理
- **API server**(`api/`)——REST endpoint、JWT 驗證、TX 建構、WebSocket 串流、rate-limit、CORS、請求驗證
- **Frontend**(`frontend/`)——CIP-30 錢包整合、JWT 處理、給使用者簽名的 TX-display、滑點 / 最低份額 UX、網路一致性防護
- **CLI 工具**(`withdraw-cli/`、`emergency-withdraw/`)——self-serve 資金恢復程式路徑、config 解析、CBOR 簽名正確性
- **設定範本**(`.env.example` 檔)——**不得洩露 secret**;必須文件化所需權限

## 範圍外

- **協議層發現**(鏈上合約行為)——去 [`optivaults-protocol`](https://github.com/OptiVaults/optivaults-protocol/blob/v1/SECURITY.md)
- **對治理簽名者、operator、存入者的社交工程攻擊**
- **第三方基礎設施**——Cardano node、Blockfrost、Ogmios、Kupo、Liqwid、Minswap V2、Circle xReserve,各有自己的揭露流程
- **存入者錢包的實體入侵**
- **本 codebase 的 fork 由第三方運營所產生的問題**——那是 fork 運營者的責任

---

## Operator 層信任邊界

Operator 參考實作有幾個值得命名的信任邊界:

- **Keeper 熱錢包**——簽 keeper 動作的 PKH。被入侵的 keeper 錢包可以造成運營 DoS(延遲 Compound、卡住批次),但**無法**抽走存入者本金——合約層強制。見 [`optivaults-protocol/docs/security-model.md §3.4`](https://github.com/OptiVaults/optivaults-protocol/blob/v1/docs/security-model.md)。
- **API JWT 簽名金鑰**——驗證 CIP-30 錢包 session。被入侵會讓攻擊者偽造 session token;**但他們無法代使用者簽 TX**(使用者錢包永遠在 client-side 簽)。
- **Blockfrost / Ogmios / Kupo API key**——rate-limit 繞過的曝險。定期輪換;在 keeper 的 `.env.example` 文件化。
- **伺服器 TLS 憑證**——OptiVaults 代管實例由 Cloudflare 處理;fork 自己管 TLS 的自負其責。

這些範圍都窄——只限 operator 實例健康。**存入者本金安全錨定在合約層**,不是 operator 層——那些保證見 `optivaults-protocol`。

---

## 責任揭露 + 酬庸式肯定

V1 啟動時**不**運行結構化 bug bounty 計畫。完整的**責任揭露政策(RDP)+ 酬庸式(ex gratia)肯定**框架見 [`optivaults-protocol/docs/audit-scope.md §6`](https://github.com/OptiVaults/optivaults-protocol/blob/v1/docs/audit-scope.md)。該政策對本 repo 的發現**一體適用**。

摘要:72 小時內確認收到;7 天內 triage + 修補計畫;90 天協調揭露窗口;**對善意揭露者不提告**;酬庸式肯定(公開致謝、case-study 合撰、由創辦人啟動資金支付的感謝金——**不從** treasury audit reserve 出)。

結構化 bounty tier 是 post-external-audit + post-TVL-scale 的考量,**不是 V1 啟動承諾**。

---

## 已知的 operator 層信任預期

運營自己實例的 fork 會有**不同**的信任預期——**你的使用者信任的是你運營基礎設施的誠實性**。OptiVaults 把審計報告 + treasury 支出公開在鏈上作為 accountability;fork **被鼓勵但非強制**這麼做。

若你運營本 codebase 的 fork,請**自行維護**一份 `SECURITY.md`,描述你的揭露流程、範圍、時程。**除非事前協調**,否則不要把你使用者的安全通報導向 `optivaults@gmail.com`——我們無法 triage 針對你實例特定設定的問題。

---

## 聯絡方式

- **Operator 層安全**:`optivaults@gmail.com`(PGP 在 `optivaults.app/security`)
- **協議層安全**:見 [`optivaults-protocol/SECURITY.md`](https://github.com/OptiVaults/optivaults-protocol/blob/v1/SECURITY.md)
- **一般 / 非敏感**:Discord(邀請在 `optivaults.app`)
- **商業 / 合作**:不主動招攬——V1 operator 實例由鏈上 fee-revenue 模型支撐,**不**依賴外部商業協議

---

## 延伸閱讀

- [`README.md`](README.md) — 兩層架構概述
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — 如何貢獻本 repo
- [`optivaults-protocol/SECURITY.md`](https://github.com/OptiVaults/optivaults-protocol/blob/v1/SECURITY.md) — 協議層揭露
- [`optivaults-protocol/docs/security-model.md`](https://github.com/OptiVaults/optivaults-protocol/blob/v1/docs/security-model.md) — 完整 V1 威脅模型
- [`optivaults-protocol/docs/audit-scope.md`](https://github.com/OptiVaults/optivaults-protocol/blob/v1/docs/audit-scope.md) — RDP + ex gratia 框架
