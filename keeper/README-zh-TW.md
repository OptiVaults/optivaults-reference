# keeper/ — V1 Keeper 參考實作

**狀態**:🚧 Placeholder。原始碼尚未遷入。Repo 狀態表見上層 [`README.md`](../README.md)。

---

## 用途(計畫內容)

**Keeper** 是 OptiVaults V1 vault 實例的**鏈下自動化層**。職責:

- **Compound**——定期呼叫鏈上 `Compound` redeemer,收割 Liqwid 收益、更新 share-price 會計
- **Batch**——透過 `BatchProcess` 處理 queued user orders
- **資本路由**——`DeployToProtocol` + `RecallFromProtocol` + `SupplyToLiqwid` + `RecallFromLiqwid`,在 idle buffer、Liqwid 市場、DEX swap order 之間移動資金
- **MergeUtxo**——把 orphan UTxO 整合回 vault 主 UTxO
- **Vault swap**——透過 Minswap V2 adapter 在 USDCx / DJED / USDM 間 DEX routing
- **Self-healing**——buffer shortage 偵測 + 自動恢復鏈(Recall → 反向 swap → NDV 整合)
- **治理 fallback**——keeper 停擺 7 天後,透過治理執行 keeper 類 redeemer
- **TVL 上限監控**——frontend / API 協調,強制 pre-audit 100K USDCx TVL 上限

## 當前狀態

原始碼住在 operator 私下的工作樹;當 keeper 驗證里程碑達成(見上層 `README.md`),會遷入本目錄。

預計遷入的內容:

- 完整 TypeScript 原始碼(engines、utils、monitors、types)
- `package.json` + `tsconfig.json` + `vitest.config.ts`
- 完整 vitest 測試集(遷入時約 97 個 test)
- `.env.example`,含所需與選用設定
- Keeper operator 部署指南

## 什麼時候遷入?

Keeper 被驗證為 V1-ready 後:

1. V1 mainnet ceremony 完成
2. V1 keeper 在 mainnet 觀察一段有意義的時間
3. vitest suite 全綠 + `tsc --noEmit` 乾淨
4. 沒有待處理的 operator 層安全發現
5. 從內部驗證期程式碼的適配穩定

那時 keeper 程式以 **Batch R2** 遷入(批次計畫見專案歷史)。

## 為什麼還沒在這?

**發布半成品的 keeper 會誤導讀者**——會讓人以為「這可以直接跑」,但實際上還沒為 V1 適配完。**程式準備好再遷,這樣才能為它背書**。

在此之前,V1 的協議層 spec + contracts + whitepaper 已完整發布在 [`optivaults-protocol`](https://github.com/OptiVaults/optivaults-protocol)——那些才是任何 fork 最迫切需要的 artefact。Keeper 是運營便利層,可以等。

## 延伸閱讀

- [`../README.md`](../README.md) — repo 兩層架構概述
- [`../SECURITY.md`](../SECURITY.md) — operator 層安全揭露
- [`optivaults-protocol/spec/keeper-auth-zh-TW.md`](https://github.com/OptiVaults/optivaults-protocol/blob/v1/spec/keeper-auth-zh-TW.md) — keeper stake-script 如何在鏈上授權 keeper 動作
- [`optivaults-protocol/docs/economics-zh-TW.md §5.3`](https://github.com/OptiVaults/optivaults-protocol/blob/v1/docs/economics-zh-TW.md) — keeper 經濟模型 + 階段性輪替機制
