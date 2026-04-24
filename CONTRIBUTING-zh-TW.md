# 貢獻 OptiVaults Operator 層參考實作

感謝對本 repo 的關注。本 repo 是 **V1 operator 層參考實作**——兩層架構與它和 [`optivaults-protocol`](https://github.com/OptiVaults/optivaults-protocol) 的區別見 [`README.md`](README.md)。

**協議層貢獻**(Aiken validator、spec、whitepaper、部署流程)請到 [`optivaults-protocol/CONTRIBUTING.md`](https://github.com/OptiVaults/optivaults-protocol/blob/v1/CONTRIBUTING.md)。

本文件涵蓋:環境建置、貢獻類型、PR 期待、測試、安全揭露——**範圍限於本 repo 的內容**。

---

## TL;DR——開 PR 前先看這幾點

1. 讀 [`README.md`](README.md) 了解兩層架構 + fee 揭露
2. 若變更屬於協議層(合約、spec、datum schema),請在 [`optivaults-protocol`](https://github.com/OptiVaults/optivaults-protocol) 開 PR——本 repo 只涵蓋鏈下 operator 程式
3. PR 前本機測試必須通過(keeper + API + frontend 用 vitest;V1 pre-launch 階段尚未架 CI)
4. 不要 commit secret、mainnet signer PKH、真的 Blockfrost key、熱錢包 seed。這些屬於 `.env`(gitignored)或 operator 私下保管
5. **安全相關發現請寄到 `optivaults@gmail.com`(PGP 在 optivaults.app/security),不要開公開 issue。** 見 `SECURITY.md`

---

## 1. Repo 範圍

本 repo 預期內容如下:

| 目錄 | 角色 |
|------|------|
| `keeper/` | TypeScript keeper 參考實作;vitest 測試 |
| `api/` | Express 風格 API server;JWT + WebSocket + TX 建構 |
| `frontend/` | React + Vite SPA,使用者 deposit / withdraw / dashboard |
| `withdraw-cli/` | Node CLI,self-serve Withdraw 不依賴 API |
| `emergency-withdraw/` | 靜態 HTML,self-serve 緊急 Withdraw |

Repo 初始化時,多數目錄是 placeholder。元件會隨著各自 V1-ready 驗證完成依序遷入——見 `README.md` 的 repo 狀態表。

**本 repo 範圍外**(由 `optivaults-protocol` 處理):
- Aiken 合約變更
- 協議 spec
- 白皮書 + 經濟模型文件
- 部署 ceremony 指揮
- 審計計畫 + RDP + ex gratia 框架

---

## 2. 環境建置(程式遷入後)

**前置需求:**

- Node.js 20.x+(用 TypeScript / tsx)
- `pnpm`(偏好)或 `npm`
- 一個測試用 Cardano 錢包(CIP-30 相容——Eternl / Lace / Vespr / Typhon / Yoroi)
- Blockfrost Preprod project ID(開發用免費版就夠)
- **貢獻者環境絕對不要放 mainnet seed / 真錢包 key**

**本機跑 keeper(Batch R2 遷入後):**

```bash
cd keeper
cp .env.example .env.local
# 編輯 .env.local,填入 Preprod Blockfrost key + keeper 錢包 seed
pnpm install
pnpm test      # vitest suite
pnpm start     # 啟動 keeper 主迴圈
```

其他元件在遷入後依類似模式運作。

---

## 3. 貢獻類型

### 直接開 PR 沒問題

- **Bug fix**——任何 operator 層 runtime bug;請附一個示範修復的測試
- **測試覆蓋強化**——keeper 用 vitest;frontend 用 vitest + React Testing Library
- **文件清晰化**——錯字修正、用字改善、既有 EN + 繁體中文以外的 i18n 工作
- **開發體驗打磨**—— `.env.example` 改善、型別重構、錯誤訊息清晰度、dev 工具
- **可觀測性**——更好的 log、更好的錯誤回報、更好的 health-check endpoint

### 請先討論(開 issue 或寄信,再開 PR)

- **新 keeper engine**(新 DEX 路徑、新借貸協議整合的 operator 側)——這是協議層整合工作的 operator 側對應;協議層審計在 `optivaults-protocol`,但 keeper 適配住在這裡
- **API 破壞性變更**——endpoint 簽名變更、驗證機制變更
- **Frontend 架構變更**——routing、state management、CIP-30 整合模式變更
- **新監控 / alerting pipeline**——成本 + 可靠性影響

### 不接受

- **閉源**——任何讓 operator 層元件變成閉源或專有的變更。本 repo 是 Apache 2.0;**fork 是預期的**。
- **協議層變更**——合約程式、spec、經濟模型。那些去 `optivaults-protocol`。
- **破壞 fork 友善度的變更**——對 OptiVaults 代管基礎設施的硬編碼假設;不能被覆寫的 config 值;需要 OptiVaults 發的憑證才能跑的工具。**任何 fork 必須能獨立設定與運行**。

---

## 4. PR 期待

### Commit 紀律

- 一個 commit 對應一個邏輯變更。Rebase 優先、不用 squash-and-merge。
- Commit 訊息:祈使句、標題 ≤ 72 字、body 說明**為什麼**。
- **不要**加 `Co-Authored-By:` 尾行,除非使用者明確要求。
- **不要**在訊息中寫「still pending」「deferred work」「memory update」或對未來的臆測——commit 描述的是「這筆 commit 裡有什麼」,不是「還沒進去的是什麼」。
- 不要把規劃 / 決策文件 commit 進 diff,除非使用者明確要求。

### PR 說明

- 引用觸發這次工作的 issue 或 Discord 討論(若有)
- 總結**做了什麼**與**為什麼**
- Keeper / API / frontend 變更:列任何使用者可見的行為變化
- 新增測試:標出測試數差異
- 監控 / 基礎設施變更:描述 runbook 更新需求

### 審視

- 純 frontend 或純文件 PR 可以在一位 reviewer 通過的情況下合併
- Keeper / API PR 需要 keeper-operator 審視——runtime pipeline 有重大狀態協調;未仔細審視的變更會造成靜默漂移
- V1 pre-launch 階段尚未架 CI——合併者在 merge 前本機跑 vitest

### 授權 + DCO

- **沒有 CLA**。本專案 Apache 2.0 進出一致(inbound=outbound)。
- 開 PR 視為同意 DCO:程式是你有權提交的、以 Apache 2.0 授權、你願意被以符合授權的方式用於衍生作品。

---

## 5. 測試期待

### 單元測試(vitest)

任何新的 runtime 行為應該至少有一個 vitest 測試。Keeper 測試放在 `keeper/src/**/__tests__/` 或 `keeper/src/**/*.test.ts`。API 測試放在 `api/src/**/__tests__/`。Frontend 測試放在 `frontend/src/**/*.test.tsx`。

### 整合測試

Operator 層的 Preprod E2E(涵蓋 keeper → API → 合約 round-trip)與 `optivaults-protocol/tests/` 是分開的——那邊的 E2E 涵蓋鏈上流程;這裡的 E2E 涵蓋 keeper-to-contract 指揮。E2E 腳本遷移屬於後期 Batch 的工作。

---

## 6. 安全揭露

**Operator 層程式的安全發現請不要開公開 issue**。用私下通報:

- **Email**:`optivaults@gmail.com`
- **PGP key**:`optivaults.app/security`

範圍規則:本 repo 只處理 operator 層發現。協議層發現去 [`optivaults-protocol/SECURITY.md`](https://github.com/OptiVaults/optivaults-protocol/blob/v1/SECURITY.md)。

完整**責任揭露政策(RDP)+ 酬庸式(ex gratia)肯定**框架見 [`optivaults-protocol/docs/audit-scope.md §6`](https://github.com/OptiVaults/optivaults-protocol/blob/v1/docs/audit-scope.md),本 repo **一體適用**。

---

## 7. 溝通

- **快速問題 / 實作討論**:Discord(邀請在 optivaults.app)
- **設計提案 / 架構變更**:在對應 repo 開 GitHub issue
- **協議層協調**:走 `optivaults-protocol` 的管道

---

## 8. 授權

開 PR 即代表你同意你的貢獻以 **Apache License 2.0** 授權(見 `LICENSE`)。

選這個授權是刻意的。V1 的目標之一是讓 operator 參考實作**可 fork 友善**——限制性授權會與此目標矛盾。
