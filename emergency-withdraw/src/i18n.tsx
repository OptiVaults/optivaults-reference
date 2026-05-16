/**
 * V1 Emergency Withdraw — self-contained i18n.
 *
 * Mirrors the v1 frontend's i18n (en / zh-TW / ja) but kept fully local:
 * the translation table is inlined so a browser-saved copy of the page
 * stays a working offline recovery surface in any language.
 *
 * Usage:
 *   const { t, lang, setLang } = useI18n()
 *   t('wd.title')                       → "Withdraw"
 *   t('wd.exceeds', { bal: '100' })     → "{bal}" placeholder interpolation
 *
 * Strings may embed light markup for the App's `renderRich` helper:
 *   `code`   → inline <code>
 *   *strong* → inline <strong>
 *
 * zh-TW / ja are written natively (idiomatic phrasing + full-width
 * punctuation), not transliterated from the English source.
 */
import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react'

export type Lang = 'en' | 'zh' | 'ja'
type Section = Record<string, string>
type Translations = Record<string, Section>

export const LANG_NAMES: Record<Lang, string> = {
  en: 'English',
  zh: '繁體中文',
  ja: '日本語',
}

const translations: Record<Lang, Translations> = {
  en: {
    err: {
      title: 'Failed to load deploy state',
      body: 'The page expects a ceremony JSON at `/v1-deploy-state.json`. Operators publish it alongside this static HTML; users on a self-hosted copy can pass `?config=<url>` to point at a hosted JSON.',
    },
    app: {
      loading: 'Loading deploy state…',
      brand: 'OptiVaults V1',
      brandSub: 'Operator reference · self-serve recovery',
      connected: 'Connected',
      disconnected: 'Not connected',
      title: 'Emergency Withdraw',
      subtitle: 'Self-serve withdrawal and Layer 3 dead-man-switch trigger for V1 vUSDCx depositors. Runs entirely in your browser — no backend, no trust in `optivaults.app` infrastructure.',
      network: 'Network',
      release: 'Release',
      vault: 'Vault',
    },
    trust: {
      keys: 'Private key never leaves your wallet',
      browser: '100% in-browser — no backend',
      blockfrost: 'Your own Blockfrost API key',
      nft: 'Vault NFT verified on-chain',
    },
    safety: {
      title: 'Before you start',
      b1: 'Your wallet seed/key *never leaves your wallet extension* — this page only assembles the transaction.',
      b2: 'You supply your own Blockfrost API key; the free tier is sufficient.',
      b3: 'Only *partial Withdraw* is supported — a full drain (last depositor) needs admin tooling.',
      b4: 'An early-withdraw fee applies unless the keeper has been inactive for 7+ days.',
      b5: 'The Layer 3 CommunitySunset trigger is *irreversible* and only unlocks after ≥90 days of operational inactivity.',
    },
    connect: {
      step: 'Step 1',
      title: 'Connect',
      keyLabel: 'Blockfrost API key',
      keyPlaceholder: 'preprod… or mainnet…',
      keyHelp1: 'Get a free key at',
      keyHelp2: '— the key prefix is checked against the loaded ceremony network.',
      walletLabel: 'CIP-30 wallet',
      walletSelect: '— select wallet —',
      walletNone: '(No wallet detected — install Eternl / Nami / Lace)',
      btn: 'Connect wallet',
      btnBusy: 'Connecting…',
    },
    conn: {
      wallet: 'Wallet',
    },
    vault: {
      title: 'Vault State',
      eyebrow: 'Live on-chain',
      refresh: 'Refresh',
      yourShares: 'Your vUSDCx',
      estValue: 'Estimated value',
      version: 'Vault version',
      totalDeposited: 'Total deposited',
      totalShares: 'Total shares',
      idleBuffer: 'Idle buffer',
      nonDeposit: 'Non-deposit value',
      earlyFee: 'Early-withdraw fee',
      frozen: 'Frozen',
      sunsetFlag: 'Sunset triggered',
      lastCompound: 'Last compound',
      lastRealloc: 'Last realloc',
      yes: 'YES',
      no: 'no',
      sunsetActive: 'YES — Layer 3 active',
      liqwid: 'Liqwid positions',
      never: 'never',
      na: 'n/a',
    },
    wd: {
      step: 'Step 2',
      title: 'Withdraw',
      desc: 'Burn your vUSDCx to receive a proportional share of USDCx from the vault. If the keeper has been inactive for 7+ days, the early-withdraw fee is waived automatically.',
      techToggle: 'Technical details',
      techDetail: 'V1 Withdraw-Zero path: proxy spend + `vault_user` staking withdrawal + vUSDCx burn. Quote = `shares × total_deposited ÷ total_shares` minus the early-withdraw fee.',
      sharesLabel: 'Amount of vUSDCx to withdraw',
      balanceHint: 'Balance: {bal}',
      max: 'Max',
      invalid: 'Invalid number',
      exceeds: 'Exceeds your balance ({bal})',
      gross: 'Gross withdraw',
      fee: 'Early fee',
      waived: 'waived',
      receive: 'You receive',
      btn: 'Sign & submit Withdraw',
      btnBusy: 'Working…',
      btnEnter: 'Enter an amount to withdraw',
      confirmNative: 'Burn {n} vUSDCx and withdraw. Continue?',
    },
    sunset: {
      title: 'Layer 3 CommunitySunset',
      eyeActive: 'Active',
      eyeAvail: 'Available now',
      eyeCountdown: 'Dead-man-switch · countdown',
      desc: 'If the vault sees no operational activity for 90 days, the operator may have failed. At that point any vUSDCx holder can flip this dead-man-switch, letting every depositor recover their full USDCx share without the operator, keeper, or governance. *This is one-way — it cannot be undone.*',
      techToggle: 'Technical details',
      techDetail: 'The 90-day threshold is measured from `max(last_compound, last_realloc)`. Triggering sets `frozen=1 + community_sunset_triggered=1`, opening the permissionless `vault_recall.RecallFromLiqwid` + `vault_protocol.DeployToProtocol` Layer 2 paths.',
      cdReached: 'Threshold reached',
      cdLabel: 'Days until sunset unlocks',
      availNow: 'AVAILABLE NOW',
      lastActivity: 'Last activity',
      daysSince: 'Days since activity',
      threshold: 'Threshold',
      thresholdVal: '90 days',
      daysLeft: 'Days remaining',
      triggered: 'Already triggered',
      callerShares: 'Your vUSDCx — ≥1 required',
      activeMsg: 'Sunset is already active. The permissionless RecallFromLiqwid + DeployToProtocol Layer 2 paths are open — use the `opti-gov` CLI or follow the operator runbook to exercise them.',
      btnNeed: 'Need ≥1 vUSDCx to trigger',
      btnTrigger: 'Trigger Layer 3 Sunset (irreversible)',
      confirm: '*This is irreversible.* After confirming, the vault is permanently frozen for normal Deposit/Compound, and any vUSDCx holder will be able to push the permissionless recovery path. Only do this if the founder, keeper, and governance have all genuinely failed.',
      confirmYes: 'Yes, trigger sunset',
      confirmCancel: 'Cancel',
      notYet: 'Not available yet — the vault is still operational.',
      daysRemain: '{n} days remaining.',
    },
    how: {
      title: 'How this tool works',
      eyebrow: 'Reference',
      s1: 'Loads the V1 ceremony state (deploy-state JSON) and locates the vault UTXO by NFT scan at the proxy address.',
      s2: 'Connects Blockfrost and your CIP-30 wallet — the key prefix and wallet network ID are both checked against the ceremony.',
      s3: 'Reads live vault state directly from Cardano: the 29-field VaultDatum, Liqwid positions, frozen / sunset flags, last activity.',
      s4: 'Computes your Withdraw quote — shares × TD ÷ TS minus the early-withdraw fee (waived if the keeper is 7+ days inactive).',
      s5: 'Builds the V1 Withdraw-Zero transaction in-browser; your wallet signs it and it is submitted via Blockfrost.',
      s6: 'If the vault has been inactive 90+ days, lets any vUSDCx holder trigger the Layer 3 CommunitySunset dead-man-switch.',
    },
    scope: {
      title: 'Scope & limits',
      eyebrow: 'Reference',
      doesTitle: 'This tool does',
      d1: 'Partial self-serve Withdraw of your vUSDCx',
      d2: 'Layer 3 CommunitySunset dead-man-switch trigger',
      d3: 'Network-checked Blockfrost + CIP-30 connection',
      notTitle: 'This tool does not',
      n1: 'Full-drain — last depositor needs admin tooling',
      n2: 'Deposits, batch / queued orders',
      n3: 'Governance operations — use the opti-gov CLI',
      n4: 'Liqwid Recall / DEX swap-out after sunset fires',
    },
    footer: {
      backupTitle: 'Keep an offline backup',
      backup: 'While everything still works, save this page — Ctrl+S / ⌘+S → "Webpage, HTML Only" — and keep the file somewhere safe. The saved HTML is fully self-contained (JS, CSS, WASM, and contract anchors all inlined) and recovers your funds even if `optivaults.app` and this GitHub repo both go offline.',
      source: 'Source',
      whitepaper: 'Whitepaper',
      security: 'Security disclosure',
      meta: 'OptiVaults V1 Emergency Withdraw v0.1.0 · Apache 2.0 · Network {net} · Release {rel}',
    },
    st: {
      noConfig: 'Deploy state not loaded',
      keyPrefix: 'Blockfrost key must start with "preprod" or "mainnet"',
      netMainnet: 'Loaded ceremony is Mainnet but your key is {key}',
      netPreprod: 'Loaded ceremony is Preprod but your key is {key}',
      selectWallet: 'Select a wallet',
      connecting: 'Connecting…',
      connected: 'Connected',
      walletNotFound: 'Wallet not found: {name}',
      wrongNetwork: 'Wallet on the wrong network — switch to {net}',
      loadingVault: 'Loading vault state…',
      ready: 'Ready',
      buildingWd: 'Building Withdraw TX…',
      signWallet: 'Sign in your wallet…',
      submitting: 'Submitting…',
      submitted: 'Submitted — receiving {amt} (deposit-token units)',
      buildingSunset: 'Building CommunitySunset TX…',
      sunsetDone: 'Layer 3 dead-man-switch triggered. Permissionless recovery paths are now open.',
    },
    tx: {
      view: 'View on Cardanoscan',
    },
    lang: {
      label: 'Language',
    },
  },

  zh: {
    err: {
      title: '無法載入部署狀態',
      body: '本頁需要位於 `/v1-deploy-state.json` 的 ceremony JSON。營運者會將它與這份靜態 HTML 一起發佈；若你使用自行存檔的副本，可加上 `?config=<url>` 指向自架的 JSON。',
    },
    app: {
      loading: '正在載入部署狀態…',
      brand: 'OptiVaults V1',
      brandSub: '營運者參考實作 · 自助救援',
      connected: '已連線',
      disconnected: '未連線',
      title: '緊急提取',
      subtitle: '為 V1 vUSDCx 存款人提供自助提取，以及 Layer 3 dead-man-switch 的觸發功能。完全在瀏覽器中執行，沒有後端，也不需信任 `optivaults.app` 的基礎設施。',
      network: '網路',
      release: '版本',
      vault: '金庫',
    },
    trust: {
      keys: '私鑰絕不離開你的錢包',
      browser: '100% 在瀏覽器中執行，沒有後端',
      blockfrost: '使用你自己的 Blockfrost API 金鑰',
      nft: '在鏈上驗證 Vault NFT',
    },
    safety: {
      title: '開始之前',
      b1: '你的助記詞與私鑰 *絕不離開錢包擴充功能*，本頁只負責組裝交易。',
      b2: '你需自備 Blockfrost API 金鑰，免費方案就夠用。',
      b3: '僅支援 *部分提取*；若要全額清空（例如你是最後一位存款人），需改用管理工具。',
      b4: '除非 keeper 已停擺 7 天以上，否則會收取提前提取手續費。',
      b5: '觸發 Layer 3 CommunitySunset 的動作 *不可逆*，且須營運停擺達 90 天以上才會解鎖。',
    },
    connect: {
      step: '步驟 1',
      title: '連接錢包',
      keyLabel: 'Blockfrost API 金鑰',
      keyPlaceholder: 'preprod… 或 mainnet…',
      keyHelp1: '免費金鑰可至',
      keyHelp2: '取得；系統會檢查金鑰前綴是否與所載入 ceremony 的網路相符。',
      walletLabel: 'CIP-30 錢包',
      walletSelect: '請選擇錢包',
      walletNone: '（未偵測到錢包，請先安裝 Eternl / Nami / Lace）',
      btn: '連接錢包',
      btnBusy: '連線中…',
    },
    conn: {
      wallet: '錢包',
    },
    vault: {
      title: '金庫狀態',
      eyebrow: '鏈上即時',
      refresh: '重新整理',
      yourShares: '你的 vUSDCx',
      estValue: '預估價值',
      version: '金庫版本',
      totalDeposited: '總存入量',
      totalShares: '總份額',
      idleBuffer: '閒置緩衝',
      nonDeposit: '非存款價值',
      earlyFee: '提前提取手續費',
      frozen: '凍結',
      sunsetFlag: 'Sunset 觸發',
      lastCompound: '上次 compound',
      lastRealloc: '上次 realloc',
      yes: '是',
      no: '否',
      sunsetActive: '是，Layer 3 已啟用',
      liqwid: 'Liqwid 部位',
      never: '從未',
      na: '不適用',
    },
    wd: {
      step: '步驟 2',
      title: '提取',
      desc: '燒掉你的 vUSDCx，按金庫目前的兌換比例換回等值的 USDCx。若 keeper 已停擺超過 7 天，提前提取手續費會自動免除。',
      techToggle: '技術細節',
      techDetail: 'V1 Withdraw-Zero 路徑：proxy spend + `vault_user` staking withdrawal + 銷毀 vUSDCx。報價 = `份額 × total_deposited ÷ total_shares` 減去提前提取手續費。',
      sharesLabel: '要提取的 vUSDCx 數量',
      balanceHint: '餘額：{bal}',
      max: '最大',
      invalid: '數字格式無效',
      exceeds: '超過你的餘額（{bal}）',
      gross: '提取總額',
      fee: '提前手續費',
      waived: '已豁免',
      receive: '你將收到',
      btn: '簽署並送出提取',
      btnBusy: '處理中…',
      btnEnter: '請輸入提取數量',
      confirmNative: '將銷毀 {n} vUSDCx 並執行提取，是否繼續？',
    },
    sunset: {
      title: 'Layer 3 CommunitySunset',
      eyeActive: '已啟用',
      eyeAvail: '現可使用',
      eyeCountdown: 'dead-man-switch · 倒數中',
      desc: '如果金庫連續 90 天沒有任何營運活動，代表營運方可能已經失效。屆時任何 vUSDCx 持有者都能啟動這個無人值守開關，讓每位存款人不需經過營運方、keeper 或治理，就能取回自己應得的全部 USDCx。*此操作為單向，無法復原。*',
      techToggle: '技術細節',
      techDetail: '90 天門檻以 `max(last_compound, last_realloc)` 計算。觸發後會設定 `frozen=1 + community_sunset_triggered=1`，開啟無需許可的 `vault_recall.RecallFromLiqwid` 與 `vault_protocol.DeployToProtocol` Layer 2 路徑。',
      cdReached: '已達門檻',
      cdLabel: '距 sunset 解鎖的天數',
      availNow: '現可使用',
      lastActivity: '上次活動',
      daysSince: '距上次活動的天數',
      threshold: '門檻',
      thresholdVal: '90 天',
      daysLeft: '剩餘天數',
      triggered: '是否已觸發',
      callerShares: '你的 vUSDCx（至少需 1）',
      activeMsg: 'Sunset 已啟用，無需許可的 RecallFromLiqwid 與 DeployToProtocol Layer 2 路徑皆已開啟。請使用 `opti-gov` CLI，或依營運者的 runbook 操作。',
      btnNeed: '需至少 1 vUSDCx 才能觸發',
      btnTrigger: '觸發 Layer 3 Sunset（不可逆）',
      confirm: '*此操作無法復原。* 確認後，金庫的一般 Deposit / Compound 功能將被永久凍結，任何 vUSDCx 持有者都能推進無需許可的救援路徑。請務必只在創辦人、keeper 與治理全都確實失效時，才執行此操作。',
      confirmYes: '是，觸發 sunset',
      confirmCancel: '取消',
      notYet: '尚不可使用，金庫仍在正常運作。',
      daysRemain: '剩餘 {n} 天。',
    },
    how: {
      title: '本工具的運作方式',
      eyebrow: '參考',
      s1: '載入 V1 ceremony 狀態（deploy-state JSON），並在 proxy 位址透過掃描 NFT 定位金庫 UTXO。',
      s2: '連接 Blockfrost 與你的 CIP-30 錢包；金鑰前綴與錢包網路 ID 都會與 ceremony 核對。',
      s3: '直接從 Cardano 讀取即時金庫狀態：29 欄位的 VaultDatum、Liqwid 部位、frozen / sunset 旗標，以及上次活動時間。',
      s4: '計算你的提取報價：份額 × TD ÷ TS 減去提前提取手續費（keeper 停擺 7 天以上則豁免）。',
      s5: '在瀏覽器內建構 V1 Withdraw-Zero 交易，交由你的錢包簽署，再透過 Blockfrost 送出。',
      s6: '若金庫已停擺 90 天以上，讓任何 vUSDCx 持有者觸發 Layer 3 CommunitySunset dead-man-switch。',
    },
    scope: {
      title: '範圍與限制',
      eyebrow: '參考',
      doesTitle: '本工具支援',
      d1: '自助部分提取你的 vUSDCx',
      d2: '觸發 Layer 3 CommunitySunset dead-man-switch',
      d3: '經網路核對的 Blockfrost + CIP-30 連線',
      notTitle: '本工具不支援',
      n1: '全額清空（若你是最後一位存款人，需改用管理工具）',
      n2: '存入、批次或排隊 order',
      n3: '治理操作（請改用 opti-gov CLI）',
      n4: 'sunset 觸發後的 Liqwid Recall 或 DEX 兌換',
    },
    footer: {
      backupTitle: '保留一份離線備份',
      backup: '趁一切仍正常運作時，以 Ctrl+S / ⌘+S 將本頁存成「網頁，只有 HTML」，並妥善保存該檔案。儲存後的 HTML 完全獨立（JS、CSS、WASM 與合約錨點全部內嵌），即使 `optivaults.app` 與這個 GitHub repo 都離線，仍能救回你的資金。',
      source: '原始碼',
      whitepaper: '白皮書',
      security: '安全揭露',
      meta: 'OptiVaults V1 緊急提取 v0.1.0 · Apache 2.0 · 網路 {net} · 版本 {rel}',
    },
    st: {
      noConfig: '尚未載入部署狀態',
      keyPrefix: 'Blockfrost 金鑰須以 "preprod" 或 "mainnet" 開頭',
      netMainnet: '載入的 ceremony 為 Mainnet，但你的金鑰是 {key}',
      netPreprod: '載入的 ceremony 為 Preprod，但你的金鑰是 {key}',
      selectWallet: '請選擇錢包',
      connecting: '連線中…',
      connected: '已連線',
      walletNotFound: '找不到錢包：{name}',
      wrongNetwork: '錢包網路錯誤，請切換至 {net}',
      loadingVault: '正在載入金庫狀態…',
      ready: '就緒',
      buildingWd: '正在建構提取交易…',
      signWallet: '請在錢包中簽署…',
      submitting: '正在送出…',
      submitted: '已送出，將收到 {amt}（deposit-token 單位）',
      buildingSunset: '正在建構 CommunitySunset 交易…',
      sunsetDone: 'Layer 3 dead-man-switch 已觸發，無需許可的救援路徑現已開啟。',
    },
    tx: {
      view: '在 Cardanoscan 上查看',
    },
    lang: {
      label: '語言',
    },
  },

  ja: {
    err: {
      title: 'デプロイ状態の読み込みに失敗しました',
      body: 'このページには `/v1-deploy-state.json` にある ceremony JSON が必要です。運用者がこの静的 HTML と一緒に公開します。自分でホストしたコピーを使う場合は、`?config=<url>` を付けてホスト済みの JSON を指定できます。',
    },
    app: {
      loading: 'デプロイ状態を読み込んでいます…',
      brand: 'OptiVaults V1',
      brandSub: '運用者リファレンス · セルフサービス回収',
      connected: '接続済み',
      disconnected: '未接続',
      title: '緊急引出',
      subtitle: 'V1 vUSDCx 預入者向けの、セルフサービス引出と Layer 3 デッドマンスイッチのトリガー機能です。すべてブラウザ内で動作し、バックエンドはなく、`optivaults.app` のインフラを信頼する必要もありません。',
      network: 'ネットワーク',
      release: 'リリース',
      vault: 'ヴォールト',
    },
    trust: {
      keys: '秘密鍵がウォレットの外に出ることはありません',
      browser: '100% ブラウザ内で動作・バックエンド不要',
      blockfrost: 'ご自身の Blockfrost API キーを使用',
      nft: 'Vault NFT をオンチェーンで検証',
    },
    safety: {
      title: 'ご利用前に',
      b1: 'シードフレーズや秘密鍵が *ウォレット拡張機能の外に出ることはありません*。このページはトランザクションを組み立てるだけです。',
      b2: 'Blockfrost API キーはご自身でご用意ください。無料プランで十分です。',
      b3: '対応しているのは *部分引出* のみです。全額引出（あなたが最後の預入者となる場合）には管理ツールが必要です。',
      b4: 'keeper が 7 日以上停止していない限り、早期引出手数料がかかります。',
      b5: 'Layer 3 CommunitySunset のトリガーは *元に戻せません*。運用停止が 90 日以上続いた後にのみ解放されます。',
    },
    connect: {
      step: 'ステップ 1',
      title: 'ウォレット接続',
      keyLabel: 'Blockfrost API キー',
      keyPlaceholder: 'preprod… または mainnet…',
      keyHelp1: '無料キーは',
      keyHelp2: 'で取得できます。キーの接頭辞は、読み込んだ ceremony のネットワークと照合されます。',
      walletLabel: 'CIP-30 ウォレット',
      walletSelect: 'ウォレットを選択',
      walletNone: '（ウォレットが見つかりません。Eternl / Nami / Lace をインストールしてください）',
      btn: 'ウォレット接続',
      btnBusy: '接続中…',
    },
    conn: {
      wallet: 'ウォレット',
    },
    vault: {
      title: 'ヴォールト状態',
      eyebrow: 'オンチェーンの最新状態',
      refresh: '更新',
      yourShares: 'あなたの vUSDCx',
      estValue: '推定価値',
      version: 'ヴォールトバージョン',
      totalDeposited: '総預入額',
      totalShares: '総シェア',
      idleBuffer: '待機バッファ',
      nonDeposit: '非預入価値',
      earlyFee: '早期引出手数料',
      frozen: '凍結',
      sunsetFlag: 'Sunset トリガー',
      lastCompound: '前回の compound',
      lastRealloc: '前回の realloc',
      yes: 'はい',
      no: 'いいえ',
      sunsetActive: 'はい（Layer 3 有効）',
      liqwid: 'Liqwid ポジション',
      never: 'なし',
      na: '該当なし',
    },
    wd: {
      step: 'ステップ 2',
      title: '引出',
      desc: 'vUSDCx をバーンし、ヴォールトの USDCx から比例配分された分を受け取ります。keeper が 7 日以上停止している場合、早期引出手数料は自動的に免除されます。',
      techToggle: '技術詳細',
      techDetail: 'V1 Withdraw-Zero パス：proxy spend + `vault_user` staking withdrawal + vUSDCx バーン。見積もり = `シェア × total_deposited ÷ total_shares` から早期引出手数料を引いた額。',
      sharesLabel: '引き出す vUSDCx の数量',
      balanceHint: '残高：{bal}',
      max: '最大',
      invalid: '数値の形式が正しくありません',
      exceeds: '残高を超えています（{bal}）',
      gross: '引出総額',
      fee: '早期手数料',
      waived: '免除',
      receive: '受取額',
      btn: '署名して引出を送信',
      btnBusy: '処理中…',
      btnEnter: '引出数量を入力してください',
      confirmNative: '{n} vUSDCx をバーンして引き出します。続行しますか？',
    },
    sunset: {
      title: 'Layer 3 CommunitySunset',
      eyeActive: '有効',
      eyeAvail: '利用可能',
      eyeCountdown: 'デッドマンスイッチ · カウントダウン',
      desc: 'ヴォールトに 90 日間運用活動がない場合、運用者が機能を停止した可能性があります。その時点で、いずれの vUSDCx 保有者もこのデッドマンスイッチを作動させることができ、すべての預入者が運用者・keeper・ガバナンスを介さずに自分の USDCx 全額を回収できます。*これは一方向で、元に戻せません。*',
      techToggle: '技術詳細',
      techDetail: '90 日の閾値は `max(last_compound, last_realloc)` から計算されます。作動すると `frozen=1 + community_sunset_triggered=1` が設定され、許可不要の `vault_recall.RecallFromLiqwid` と `vault_protocol.DeployToProtocol` の Layer 2 パスが開きます。',
      cdReached: '閾値に到達',
      cdLabel: 'sunset 解放までの日数',
      availNow: '利用可能',
      lastActivity: '前回の活動',
      daysSince: '前回の活動からの日数',
      threshold: '閾値',
      thresholdVal: '90 日',
      daysLeft: '残り日数',
      triggered: 'トリガー済みか',
      callerShares: 'あなたの vUSDCx（1 以上必要）',
      activeMsg: 'Sunset は既に有効です。許可不要の RecallFromLiqwid と DeployToProtocol の Layer 2 パスが開いています。`opti-gov` CLI、または運用者の runbook に従って実行してください。',
      btnNeed: 'トリガーには vUSDCx が 1 以上必要です',
      btnTrigger: 'Layer 3 Sunset をトリガー（不可逆）',
      confirm: '*この操作は元に戻せません。* 確認すると、ヴォールトの通常の Deposit / Compound は永久に凍結され、すべての vUSDCx 保有者が許可不要の回収パスを進められるようになります。創業者・keeper・ガバナンスのすべてが実際に機能しなくなった場合にのみ実行してください。',
      confirmYes: 'はい、sunset をトリガー',
      confirmCancel: 'キャンセル',
      notYet: 'まだ利用できません。ヴォールトは正常に稼働しています。',
      daysRemain: '残り {n} 日。',
    },
    how: {
      title: 'このツールの仕組み',
      eyebrow: 'リファレンス',
      s1: 'V1 ceremony 状態（deploy-state JSON）を読み込み、proxy アドレスでの NFT スキャンによりヴォールト UTXO を特定します。',
      s2: 'Blockfrost と CIP-30 ウォレットを接続します。キーの接頭辞とウォレットのネットワーク ID は、いずれも ceremony と照合されます。',
      s3: 'Cardano から最新のヴォールト状態を直接読み取ります。対象は 29 フィールドの VaultDatum、Liqwid ポジション、frozen / sunset フラグ、前回の活動時刻です。',
      s4: '引出見積もりを計算します。シェア × TD ÷ TS から早期引出手数料を引いた額です（keeper が 7 日以上停止していれば免除）。',
      s5: 'V1 Withdraw-Zero トランザクションをブラウザ内で構築します。ウォレットで署名し、Blockfrost 経由で送信します。',
      s6: 'ヴォールトが 90 日以上停止している場合、すべての vUSDCx 保有者が Layer 3 CommunitySunset デッドマンスイッチをトリガーできます。',
    },
    scope: {
      title: '範囲と制限',
      eyebrow: 'リファレンス',
      doesTitle: 'このツールができること',
      d1: 'あなたの vUSDCx のセルフサービス部分引出',
      d2: 'Layer 3 CommunitySunset デッドマンスイッチのトリガー',
      d3: 'ネットワーク照合済みの Blockfrost + CIP-30 接続',
      notTitle: 'このツールができないこと',
      n1: '全額引出（最後の預入者には管理ツールが必要）',
      n2: '預入、バッチやキューの order',
      n3: 'ガバナンス操作（opti-gov CLI を使用）',
      n4: 'sunset 発動後の Liqwid Recall や DEX スワップアウト',
    },
    footer: {
      backupTitle: 'オフラインバックアップを保管',
      backup: 'すべてが正常なうちに、このページを Ctrl+S / ⌘+S で「ウェブページ、HTML のみ」として保存し、ファイルを安全な場所に保管してください。保存された HTML は完全に自己完結しており（JS、CSS、WASM、コントラクトアンカーをすべてインライン化）、`optivaults.app` とこの GitHub repo の両方がオフラインになっても資金を回収できます。',
      source: 'ソース',
      whitepaper: 'ホワイトペーパー',
      security: 'セキュリティ開示',
      meta: 'OptiVaults V1 緊急引出 v0.1.0 · Apache 2.0 · ネットワーク {net} · リリース {rel}',
    },
    st: {
      noConfig: 'デプロイ状態が読み込まれていません',
      keyPrefix: 'Blockfrost キーは "preprod" または "mainnet" で始まる必要があります',
      netMainnet: '読み込んだ ceremony は Mainnet ですが、キーは {key} です',
      netPreprod: '読み込んだ ceremony は Preprod ですが、キーは {key} です',
      selectWallet: 'ウォレットを選択してください',
      connecting: '接続中…',
      connected: '接続済み',
      walletNotFound: 'ウォレットが見つかりません：{name}',
      wrongNetwork: 'ウォレットのネットワークが違います。{net} に切り替えてください',
      loadingVault: 'ヴォールト状態を読み込んでいます…',
      ready: '準備完了',
      buildingWd: '引出トランザクションを構築しています…',
      signWallet: 'ウォレットで署名してください…',
      submitting: '送信しています…',
      submitted: '送信しました。{amt}（deposit-token 単位）を受け取る予定です',
      buildingSunset: 'CommunitySunset トランザクションを構築しています…',
      sunsetDone: 'Layer 3 デッドマンスイッチをトリガーしました。許可不要の回収パスが開きました。',
    },
    tx: {
      view: 'Cardanoscan で表示',
    },
    lang: {
      label: '言語',
    },
  },
}

interface I18nContextType {
  lang: Lang
  setLang: (lang: Lang) => void
  t: (key: string, vars?: Record<string, string | number>) => string
}

const I18nContext = createContext<I18nContextType | null>(null)

export function useI18n(): I18nContextType {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error('useI18n must be used inside <I18nProvider>')
  return ctx
}

const LANG_KEY = 'optivaults-lang'

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem(LANG_KEY)
    if (saved === 'en' || saved === 'zh' || saved === 'ja') return saved
  } catch {
    /* localStorage unavailable (e.g. file:// in some browsers) — fall through */
  }
  const nav = (typeof navigator !== 'undefined' && navigator.language) || ''
  if (nav.startsWith('zh')) return 'zh'
  if (nav.startsWith('ja')) return 'ja'
  return 'en'
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang)

  const setLang = useCallback((l: Lang) => {
    setLangState(l)
    try {
      localStorage.setItem(LANG_KEY, l)
    } catch {
      /* ignore — language still applies for this session */
    }
  }, [])

  // Keep <html lang> in sync for screen readers / browser features.
  useEffect(() => {
    document.documentElement.lang = lang === 'zh' ? 'zh-Hant' : lang
  }, [lang])

  const t = useCallback(
    (key: string, vars?: Record<string, string | number>): string => {
      const [section, field] = key.split('.')
      let s =
        translations[lang]?.[section]?.[field] ??
        translations.en[section]?.[field] ??
        key
      if (vars) {
        for (const k of Object.keys(vars)) {
          s = s.replaceAll(`{${k}}`, String(vars[k]))
        }
      }
      return s
    },
    [lang],
  )

  return <I18nContext.Provider value={{ lang, setLang, t }}>{children}</I18nContext.Provider>
}
