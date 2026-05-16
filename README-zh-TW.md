# OptiVaults V1 — Operator 層參考實作

![License](https://img.shields.io/badge/license-Apache%202.0-blue)
![Status](https://img.shields.io/badge/status-skeleton-orange)
![Sibling Repo](https://img.shields.io/badge/protocol-optivaults--protocol-informational)

> **開發分支:`v1`。** 與姊妹 repo [`optivaults-protocol`](https://github.com/OptiVaults/optivaults-protocol) 慣例一致——**沒有 `main` 分支**。

本 repo 收錄 **V1 operator 層的參考實作**——跑一個 OptiVaults V1 實例所需的鏈下程式：keeper、frontend（含瀏覽器內 TX 建構）、以及 self-serve 的恢復工具。

它是 [`optivaults-protocol`](https://github.com/OptiVaults/optivaults-protocol) 的姊妹 repo,後者持有 Aiken 智能合約、協議規格、白皮書、與部署流程。

---

## 兩層架構

OptiVaults V1 **刻意被設計成兩個可分離的層**:

| 層 | Repo | 是什麼 | Fee |
|----|------|--------|-----|
| **協議層(公共財)** | [`optivaults-protocol`](https://github.com/OptiVaults/optivaults-protocol) | Aiken validators + spec + whitepaper + 部署腳本。Apache 2.0。**任何人都能 fork 並啟動自己的 vault,完全免付費**。 | 0%——純公共財。 |
| **Operator 層（本 repo）** | `optivaults-reference` | keeper / frontend / CLI 工具的 TypeScript 參考實作。Apache 2.0。在 `optivaults.app` 代使用者跑活的 vault 實例。 | 已實現收益的 4.5%（**合約硬上限**；啟動 40% 給 keeper / 60% 進 treasury——keeper 份額在 validator 硬上限以支持開源第三方 keeper 經濟可行性；費用拆分見 [economics.md](https://github.com/OptiVaults/optivaults-protocol/blob/v1/docs/economics.md)）。 |

**為什麼要兩個 repo?** 因為這是兩個**根本不同**的東西:

- **協議層**是 Cardano DeFi commons 的一份貢獻——可審計、可 fork、Apache 2.0、**零 rent 抽取**。任何團隊都可以用。
- **Operator 層**是**便利服務**——給使用者一個可以直接存進來、不用自己跑基礎設施的 vault 實例。4.5% fee 用於支付跑這份實例的成本:keeper 補償、VPS + Blockfrost + 監控 + CDN、未來的第三方審計、協議 R&D、以及事件應變 buffer。**無創辦人 dividend、無投資人 return、無 token**。

兩層在合約層級連接(operator 跑的 keeper 簽 TX、由鏈上 vault 驗證),但**它們不是同一件事**。Fork `optivaults-protocol` 跑自己的實例——**用自己的費率,或零費率**——是明確的設計目標。

存入者面向的定位見 [OptiVaults 白皮書](https://github.com/OptiVaults/optivaults-protocol/blob/v1/whitepaper/whitepaper-zh-TW.md);白話版說明見 [product-overview-zh-TW.md](https://github.com/OptiVaults/optivaults-protocol/blob/v1/docs/product-overview-zh-TW.md)。

---

## Repo 狀態

**V1 尚未上線,本 repo 也還是 pre-launch。** Operator 層程式仍在從內部驗證期程式碼適配。目前狀態:

| 元件 | 狀態 | 備註 |
|------|------|------|
| `keeper/` | 🚧 Placeholder | V1 keeper 參考實作，在 keeper 驗證里程碑之後遷入。TypeScript、vitest 測試。 |
| `frontend/` | ✅ 已發布 | React 19 + Vite 8 + TailwindCSS v4 SPA。CIP-30 錢包整合、**瀏覽器內 TX 建構（Lucid Evolution）**（無獨立 API server——原本的 `api/` 元件已併入 frontend client-side）、Blockfrost 直接 REST、vitest 測試。7 個頁面、EN / zh-TW / ja 三語 i18n。Operator-specific URL + Cloudflare Pages 部署腳本已在 `frontend/README.md` 為 forker 標註。 |
| `withdraw-cli/` | ✅ 已發布 | Node CLI，用於 self-serve Withdraw（不依賴任何基礎設施）。 |
| `emergency-withdraw/` | ✅ 已發布 | 靜態 HTML 的 self-serve 緊急提領工具——瀏覽器內運作、無 backend 依賴。English / zh-TW / ja 三語 i18n。 |

剩餘元件會在驗證為 V1-ready 後分批遷入。

---

## 跑你自己的實例

OptiVaults 的設計讓**任何團隊都能 fork 協議、啟動自己的 vault 實例**。流程:

1. Fork [`optivaults-protocol`](https://github.com/OptiVaults/optivaults-protocol)(或直接用已發布的 artefact)。
2. 依 `optivaults-protocol/deploy/` 跑部署 ceremony(見 [deploy/runbooks/v1-mainnet-ceremony.md](https://github.com/OptiVaults/optivaults-protocol/blob/v1/deploy/runbooks/v1-mainnet-ceremony.md)),部署你自己的 vault 地址 + reference scripts。
3. Fork 本 repo（`optivaults-reference`）——依你自己的 ceremony state 設定 keeper / frontend、部署到你想要的地方（**也可以完全不部署，只在本機跑給自己用**）。
4. 用自己的政策運作:自己的費率、自己的治理簽名者集合、自己的存入者群體。

你的實例與 OptiVaults 運營的實例**互相獨立**。兩者除了慣例(例如都遵循同一份 `optivaults-protocol` hash 集合)之外,不會互相作用。

---

## Operator 治理與 fee 揭露

OptiVaults 運營的實例(`optivaults.app`)由合約強制的 4.5% 績效費支撐。拆分(完整數學見 [economics.md](https://github.com/OptiVaults/optivaults-protocol/blob/v1/docs/economics.md)):

- **fee 的 40%** → 簽名 keeper(每筆 Compound 的運營成本補償;在 validator 硬上限)
- **fee 的 60%** → 鏈上 treasury(**合約強制類別分配**):
  - 40% audit reserve(總 fee 的 24%——與舊 80%×30% 分配同樣的累積速度)
  - 25% operations(VPS、Blockfrost、監控、CDN)
  - 25% R&D(未來整合、貢獻者 bounty、生態補助)
  - 10% buffer(預期外支出、法律、事件應變)

治理可調整的類別有合約強制上限(單一類別 ≤ inflow 的 50%、audit reserve 下限 ≥ 20%)。**4.5% 績效費本身是合約硬上限,治理在任何 redeemer 路徑下都無法提高**。

**無創辦人 dividend、無投資人 return、無 token 發行、無 SAFE / SAFT**。4.5% fee 純屬成本回收 + 長期協議可持續性;具體拆分透過鏈上 `TreasuryDatum` 與 treasury 的 `recent_spend_log` 揭露。

---

## 與 `optivaults-protocol` 的關係

所有協議層級的安全發現、合約審計、經濟模型文件、白皮書內容,都住在 [`optivaults-protocol`](https://github.com/OptiVaults/optivaults-protocol)。

**本 repo 的 scope 嚴格限於鏈下 operator 實例程式**。針對 operator 基礎設施的安全揭露（keeper runtime bug、frontend XSS / CSP 問題、CLI 解析 bug）走本 repo `SECURITY.md` 的通報管道。協議層級的揭露（合約漏洞、datum 注入等）走 `optivaults-protocol/SECURITY.md`。

若你不確定發現屬於哪一層,**預設走 `optivaults-protocol` 的通報管道**——triage 流程會適當轉派。

---

## 授權

Apache License 2.0。見 [`LICENSE`](LICENSE)。**歡迎 fork**。

選這個授權是刻意的。V1 的成功指標之一是「架構被其他 Cardano 團隊 fork + 特化」——在 operator 參考實作上放限制性授權會與此目標矛盾。

---

## 聯絡方式

- **網站**:[optivaults.app](https://optivaults.app)
- **Protocol repo**:[github.com/OptiVaults/optivaults-protocol](https://github.com/OptiVaults/optivaults-protocol)
- **安全揭露**:本 repo 的 scope 見 [`SECURITY.md`](SECURITY.md);協議層發現走 [`optivaults-protocol/SECURITY.md`](https://github.com/OptiVaults/optivaults-protocol/blob/v1/SECURITY.md)
- **一般**:Discord(邀請在 optivaults.app)
