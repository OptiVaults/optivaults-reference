/**
 * V1 Emergency Withdraw — single-page UI.
 *
 * Three sections:
 *   1. Connect — Blockfrost API key + CIP-30 wallet picker
 *   2. Vault state + Withdraw — partial Withdraw with R49 M-4 deferred-yield quote
 *   3. Layer 3 CommunitySunset — 90d dead-man-switch countdown + trigger
 *      (always rendered, but clearly marked with state: not-available /
 *      countdown-visible / available-now / already-triggered)
 *
 * Visual style aligns with v1 frontend (`vault.optivaults.app`):
 *   - slate-900 bg + slate-800 glass cards
 *   - cyan→emerald gradient text + glow borders
 *   - amber accent for sunset section
 *
 * Self-contained: all logic in this file + `lib/{config,vault}.ts`.
 * No router, no shared components — small enough that an offline-saved
 * page is the recovery surface even if optivaults.app is down.
 */
import { useEffect, useState } from 'react'
import {
  loadV1Config,
  type V1Config,
} from './lib/config'
import {
  initLucid,
  queryVaultState,
  computeWithdrawQuote,
  computeSunsetStatus,
  getUserShares,
  buildWithdrawTx,
  buildSunsetTx,
  type VaultState,
  type SunsetStatus,
} from './lib/vault'
import type { LucidEvolution } from '@lucid-evolution/lucid'

type Cip30Api = any
type StatusKind = 'info' | 'ok' | 'error'
type StatusMsg = { kind: StatusKind; text: string } | null

const DECIMALS = 6n

function fmtMicro(n: bigint, dec: bigint = DECIMALS): string {
  const neg = n < 0n
  const abs = neg ? -n : n
  const s = abs.toString().padStart(Number(dec) + 1, '0')
  const head = s.slice(0, -Number(dec))
  const tail = s.slice(-Number(dec)).replace(/0+$/, '') || '0'
  return (neg ? '-' : '') + Number(head).toLocaleString() + '.' + tail
}

function fmtTime(ms: bigint): string {
  if (ms <= 0n) return 'never'
  return new Date(Number(ms)).toISOString().replace('T', ' ').slice(0, 19) + ' UTC'
}

function listCardanoWallets(): string[] {
  const w = (window as any).cardano || {}
  return Object.keys(w).filter(
    (k) => w[k] && typeof w[k].enable === 'function' && typeof w[k].name === 'string',
  )
}

function explorerUrl(network: 'mainnet' | 'preprod', txHash: string): string {
  return network === 'preprod'
    ? `https://preprod.cardanoscan.io/transaction/${txHash}`
    : `https://cardanoscan.io/transaction/${txHash}`
}

export default function App() {
  // ── Config + connection ──
  const [config, setConfig] = useState<V1Config | null>(null)
  const [configError, setConfigError] = useState<string | null>(null)
  const [bfKey, setBfKey] = useState('')
  const [walletList, setWalletList] = useState<string[]>([])
  const [walletName, setWalletName] = useState('')
  const [lucid, setLucid] = useState<LucidEvolution | null>(null)
  const [walletAddr, setWalletAddr] = useState('')
  const [networkResolved, setNetworkResolved] = useState<'mainnet' | 'preprod' | null>(null)

  // ── Live state ──
  const [vault, setVault] = useState<VaultState | null>(null)
  const [userShares, setUserShares] = useState(0n)
  const [sunset, setSunset] = useState<SunsetStatus | null>(null)

  // ── UI ──
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<StatusMsg>(null)
  const [txHash, setTxHash] = useState('')
  const [sharesInput, setSharesInput] = useState('')
  const [sunsetConfirmOpen, setSunsetConfirmOpen] = useState(false)

  // ── Bootstrap: load config + wallet list ──
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const cfg = await loadV1Config()
        if (cancelled) return
        setConfig(cfg)
      } catch (e) {
        setConfigError((e as Error).message)
      }
    })()
    setWalletList(listCardanoWallets())
    return () => {
      cancelled = true
    }
  }, [])

  // ── Connect flow ──
  async function handleConnect() {
    setStatus(null)
    if (!config) {
      setStatus({ kind: 'error', text: 'Deploy state not loaded' })
      return
    }
    const key = bfKey.trim()
    let resolvedNet: 'mainnet' | 'preprod' | null = null
    if (key.startsWith('preprod')) resolvedNet = 'preprod'
    else if (key.startsWith('mainnet')) resolvedNet = 'mainnet'
    else {
      setStatus({ kind: 'error', text: 'Blockfrost key must start with "preprod" or "mainnet"' })
      return
    }
    if (config.network === 'Mainnet' && resolvedNet !== 'mainnet') {
      setStatus({ kind: 'error', text: `Loaded ceremony is Mainnet but key is ${resolvedNet}` })
      return
    }
    if (config.network === 'Preprod' && resolvedNet !== 'preprod') {
      setStatus({ kind: 'error', text: `Loaded ceremony is Preprod but key is ${resolvedNet}` })
      return
    }
    if (!walletName) {
      setStatus({ kind: 'error', text: 'Select a wallet' })
      return
    }
    setBusy(true)
    setStatus({ kind: 'info', text: 'Connecting…' })
    try {
      const apiFn = (window as any).cardano?.[walletName]
      if (!apiFn) throw new Error(`Wallet not found: ${walletName}`)
      const api: Cip30Api = await apiFn.enable()
      const networkId = await api.getNetworkId()
      const expected = resolvedNet === 'mainnet' ? 1 : 0
      if (networkId !== expected) {
        throw new Error(`Wallet on wrong network — switch to ${resolvedNet}`)
      }
      const ld = await initLucid(key, resolvedNet)
      ld.selectWallet.fromAPI(api)
      const addr = await ld.wallet().address()
      setLucid(ld)
      setWalletAddr(addr)
      setNetworkResolved(resolvedNet)
      setStatus({ kind: 'ok', text: 'Connected' })
      await loadOnChainState(ld, resolvedNet)
    } catch (e) {
      setStatus({ kind: 'error', text: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  async function loadOnChainState(ld: LucidEvolution, _net: 'mainnet' | 'preprod') {
    if (!config) return
    setStatus({ kind: 'info', text: 'Loading vault state…' })
    try {
      const [v, s, addr] = await Promise.all([
        queryVaultState(ld, config),
        Promise.resolve(0n).then(() => ld.wallet().address()).then((a) => getUserShares(ld, a, config)),
        ld.wallet().address(),
      ])
      void addr // already stored
      setVault(v)
      setUserShares(s)
      setSunset(computeSunsetStatus(v))
      setStatus({ kind: 'ok', text: 'Ready' })
    } catch (e) {
      setStatus({ kind: 'error', text: (e as Error).message })
    }
  }

  async function handleRefresh() {
    if (!lucid || !networkResolved) return
    setBusy(true)
    try {
      await loadOnChainState(lucid, networkResolved)
    } finally {
      setBusy(false)
    }
  }

  // ── Withdraw ──
  const sharesParsed = (() => {
    if (!sharesInput.trim()) return 0n
    try {
      return BigInt(sharesInput.trim())
    } catch {
      return -1n
    }
  })()
  const sharesValid = sharesParsed > 0n && sharesParsed <= userShares
  const quote = (() => {
    if (!vault || !sharesValid) return null
    try {
      return computeWithdrawQuote(vault, sharesParsed)
    } catch {
      return null
    }
  })()

  function setMaxShares() {
    if (!vault) return
    const cap = vault.totalShares - 1n
    const max = userShares > cap ? cap : userShares
    setSharesInput(max.toString())
  }

  async function handleWithdraw() {
    if (!lucid || !config || !vault || !networkResolved || !sharesValid) return
    if (!confirm(`Burn ${sharesParsed.toString()} vUSDCx and withdraw. Continue?`)) return
    setBusy(true)
    setTxHash('')
    setStatus({ kind: 'info', text: 'Building Withdraw TX…' })
    try {
      const { cbor, quote: q } = await buildWithdrawTx(lucid, config, vault, sharesParsed, walletAddr)
      setStatus({ kind: 'info', text: 'Sign in your wallet…' })
      const signed = await lucid.fromTx(cbor).sign.withWallet().complete()
      setStatus({ kind: 'info', text: 'Submitting…' })
      const hash = await signed.submit()
      setTxHash(hash)
      setStatus({
        kind: 'ok',
        text: `Submitted — receiving ${fmtMicro(q.netWithdraw)} (deposit-token units)`,
      })
      setSharesInput('')
      // Refresh state
      setTimeout(() => loadOnChainState(lucid, networkResolved), 5_000)
    } catch (e) {
      setStatus({ kind: 'error', text: (e as Error).message.slice(0, 400) })
    } finally {
      setBusy(false)
    }
  }

  // ── CommunitySunset ──
  async function handleSunsetTrigger() {
    if (!lucid || !config || !vault || !networkResolved || !sunset) return
    if (!sunset.available) return
    setSunsetConfirmOpen(false)
    setBusy(true)
    setTxHash('')
    setStatus({ kind: 'info', text: 'Building CommunitySunset TX…' })
    try {
      const { cbor } = await buildSunsetTx(lucid, config, vault, walletAddr)
      setStatus({ kind: 'info', text: 'Sign in your wallet…' })
      const signed = await lucid.fromTx(cbor).sign.withWallet().complete()
      setStatus({ kind: 'info', text: 'Submitting…' })
      const hash = await signed.submit()
      setTxHash(hash)
      setStatus({
        kind: 'ok',
        text: 'Layer 3 dead-man-switch triggered. Permissionless recovery paths are now open.',
      })
      setTimeout(() => loadOnChainState(lucid, networkResolved), 5_000)
    } catch (e) {
      setStatus({ kind: 'error', text: (e as Error).message.slice(0, 400) })
    } finally {
      setBusy(false)
    }
  }

  // ── Render ──
  if (configError) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="glass-card glow-border rounded-2xl p-8 max-w-2xl">
          <h1 className="text-2xl font-bold text-red-400 mb-3">⚠ Failed to load deploy state</h1>
          <p className="text-slate-300 text-sm mb-4 break-all font-mono bg-slate-900/70 p-3 rounded-lg">
            {configError}
          </p>
          <p className="text-slate-400 text-sm">
            The page expects a ceremony JSON at <code className="text-cyan-400">/v1-deploy-state.json</code>.
            Operators publish it alongside this static HTML; users on a self-hosted copy
            can pass <code className="text-cyan-400">?config=&lt;url&gt;</code> to point
            at a hosted JSON.
          </p>
        </div>
      </div>
    )
  }

  if (!config) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-slate-400 animate-pulse">Loading deploy state…</div>
      </div>
    )
  }

  const network = config.network === 'Mainnet' ? 'mainnet' : 'preprod'

  return (
    <div className="min-h-screen p-4 sm:p-6 md:p-8">
      <div className="max-w-3xl mx-auto space-y-6">

        {/* Header */}
        <header>
          <h1 className="text-3xl sm:text-4xl font-bold">
            🛟 <span className="gradient-text">OptiVaults V1</span> Emergency Withdraw
          </h1>
          <p className="text-slate-400 text-sm sm:text-base mt-2">
            Self-serve withdrawal + Layer 3 dead-man-switch trigger.
            Runs entirely in your browser — no backend dependency.
          </p>
          <div className="text-xs text-slate-500 mt-3 font-mono break-all">
            Network: <span className="text-cyan-400">{config.network}</span> ·
            Release: <span className="text-cyan-400">{config.releaseTag}</span> ·
            Vault: <span className="text-cyan-400">{config.proxyAddr.slice(0, 16)}…{config.proxyAddr.slice(-8)}</span>
          </div>
        </header>

        {/* Pre-flight warning */}
        <div className="glass-card rounded-xl p-4 sm:p-5 text-xs sm:text-sm text-slate-300 border-l-4 border-l-amber-500">
          <strong className="text-amber-400">Before you use this tool:</strong>
          <ul className="mt-2 ml-4 list-disc space-y-1 text-slate-400">
            <li>Your wallet seed/key <strong className="text-slate-200">never leaves your wallet extension</strong>.</li>
            <li>You supply your own Blockfrost API key (free tier works).</li>
            <li>Only <strong className="text-slate-200">partial Withdraw</strong> is supported (full-drain needs admin tools).</li>
            <li>Early-withdraw fee applies unless the keeper has been inactive 7+ days.</li>
            <li>The CommunitySunset Layer 3 trigger is <strong className="text-slate-200">irreversible</strong> and
                only available after ≥90 days of operational inactivity.</li>
          </ul>
        </div>

        {/* 1. Connect */}
        {!lucid && (
          <section className="glass-card glow-border rounded-2xl p-5 sm:p-6 space-y-4">
            <h2 className="text-lg sm:text-xl font-bold text-emerald-400">1. Connect</h2>

            <div>
              <label className="block text-xs uppercase tracking-wide text-slate-400 mb-1.5">
                Blockfrost API key (preprod… or mainnet…)
              </label>
              <input
                type="password"
                value={bfKey}
                onChange={(e) => setBfKey(e.target.value)}
                placeholder="preprod..."
                autoComplete="off"
              />
              <p className="text-xs text-slate-500 mt-1">
                Get a free key at <a href="https://blockfrost.io" target="_blank" rel="noopener noreferrer" className="text-cyan-400 underline">blockfrost.io</a>
              </p>
            </div>

            <div>
              <label className="block text-xs uppercase tracking-wide text-slate-400 mb-1.5">
                CIP-30 Wallet
              </label>
              <select value={walletName} onChange={(e) => setWalletName(e.target.value)}>
                <option value="">— select wallet —</option>
                {walletList.map((w) => (
                  <option key={w} value={w}>{w}</option>
                ))}
                {walletList.length === 0 && (
                  <option value="" disabled>(No wallet detected — install Eternl/Nami/Lace)</option>
                )}
              </select>
            </div>

            <button
              onClick={handleConnect}
              disabled={busy || !bfKey || !walletName}
              className="w-full bg-gradient-to-r from-cyan-500 to-emerald-500 hover:from-cyan-400 hover:to-emerald-400 disabled:from-slate-600 disabled:to-slate-600 disabled:cursor-not-allowed text-slate-950 font-bold py-3 rounded-xl transition-all"
            >
              {busy ? 'Connecting…' : 'Connect'}
            </button>
          </section>
        )}

        {/* 2. Vault state + Withdraw */}
        {lucid && vault && (
          <section className="glass-card glow-border rounded-2xl p-5 sm:p-6 space-y-5">
            <div className="flex items-center justify-between">
              <h2 className="text-lg sm:text-xl font-bold text-emerald-400">2. Vault State</h2>
              <button onClick={handleRefresh} disabled={busy} className="text-xs text-cyan-400 hover:text-cyan-300 disabled:text-slate-600">
                ↻ Refresh
              </button>
            </div>

            <div className="bg-slate-900/70 rounded-lg p-4 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <div className="text-slate-400">Vault version</div>
              <div className="text-right font-mono">V{vault.vaultVersion.toString()}</div>

              <div className="text-slate-400">Total deposited</div>
              <div className="text-right font-mono">{fmtMicro(vault.totalDeposited)}</div>

              <div className="text-slate-400">Total shares</div>
              <div className="text-right font-mono">{vault.totalShares.toString()}</div>

              <div className="text-slate-400">Idle buffer</div>
              <div className="text-right font-mono">{fmtMicro(vault.idleBuffer)}</div>

              <div className="text-slate-400">Non-deposit value</div>
              <div className="text-right font-mono">{fmtMicro(vault.nonDepositValue)}</div>

              <div className="text-slate-400">Early-withdraw fee</div>
              <div className="text-right font-mono">{(Number(vault.earlyWithdrawFeeBps) / 100).toFixed(2)}%</div>

              <div className="text-slate-400">Frozen</div>
              <div className={`text-right font-mono ${vault.frozen === 1n ? 'text-amber-400' : 'text-emerald-400'}`}>
                {vault.frozen === 1n ? 'YES' : 'no'}
              </div>

              <div className="text-slate-400">Sunset triggered</div>
              <div className={`text-right font-mono ${vault.communitySunsetTriggered === 1n ? 'text-amber-400' : 'text-emerald-400'}`}>
                {vault.communitySunsetTriggered === 1n ? 'YES (Layer 3 active)' : 'no'}
              </div>

              <div className="text-slate-400">Last compound</div>
              <div className="text-right font-mono text-xs">{fmtTime(vault.lastCompoundTime)}</div>

              <div className="text-slate-400">Last realloc</div>
              <div className="text-right font-mono text-xs">{fmtTime(vault.lastReallocTime)}</div>
            </div>

            {vault.liqwidPositions.length > 0 && (
              <div className="bg-slate-900/70 rounded-lg p-4 text-xs space-y-1">
                <div className="text-slate-400 mb-1.5">Liqwid positions:</div>
                {vault.liqwidPositions.map((p) => (
                  <div key={p.marketId.toString()} className="font-mono text-slate-300">
                    market_id={p.marketId.toString()} qtokens={p.qtokensHeld.toString()} supplied={fmtMicro(p.suppliedValue)}
                  </div>
                ))}
              </div>
            )}

            <div className="bg-slate-900/70 rounded-lg p-4 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <div className="text-slate-400">Wallet</div>
              <div className="text-right font-mono text-xs">{walletAddr.slice(0, 16)}…{walletAddr.slice(-8)}</div>

              <div className="text-slate-400">Your vUSDCx</div>
              <div className="text-right font-mono">{userShares.toString()}</div>

              <div className="text-slate-400">Estimated value</div>
              <div className="text-right font-mono text-emerald-400">
                {vault.totalShares > 0n
                  ? fmtMicro((userShares * vault.totalDeposited) / vault.totalShares)
                  : 'n/a'}
              </div>
            </div>

            <div>
              <label className="block text-xs uppercase tracking-wide text-slate-400 mb-1.5">
                Shares to burn (raw vUSDCx)
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  inputMode="numeric"
                  value={sharesInput}
                  onChange={(e) => setSharesInput(e.target.value)}
                  placeholder="0"
                />
                <button
                  onClick={setMaxShares}
                  className="px-4 py-2 text-xs uppercase tracking-wide rounded-lg border border-slate-600 hover:border-cyan-500/50 text-slate-300"
                >
                  Max
                </button>
              </div>
              {sharesParsed === -1n && (
                <p className="text-xs text-red-400 mt-1">Invalid integer</p>
              )}
              {sharesParsed > userShares && (
                <p className="text-xs text-red-400 mt-1">Exceeds your balance ({userShares.toString()})</p>
              )}
            </div>

            {quote && (
              <div className="bg-cyan-500/5 border border-cyan-500/30 rounded-lg p-4 space-y-1.5 text-sm">
                <div className="flex justify-between"><span className="text-slate-400">Gross withdraw</span><span className="font-mono">{fmtMicro(quote.baseWithdraw)}</span></div>
                <div className="flex justify-between"><span className="text-slate-400">Early fee</span><span className="font-mono">{fmtMicro(quote.earlyFee)} {quote.keeperInactive && <span className="text-xs text-emerald-400 ml-1">(WAIVED)</span>}</span></div>
                <div className="flex justify-between font-bold"><span>You receive</span><span className="font-mono text-emerald-400">{fmtMicro(quote.netWithdraw)}</span></div>
              </div>
            )}

            <button
              onClick={handleWithdraw}
              disabled={busy || !sharesValid}
              className="w-full bg-gradient-to-r from-cyan-500 to-emerald-500 hover:from-cyan-400 hover:to-emerald-400 disabled:from-slate-600 disabled:to-slate-600 disabled:cursor-not-allowed text-slate-950 font-bold py-3 rounded-xl transition-all"
            >
              {busy ? 'Working…' : 'Sign & Submit Withdraw'}
            </button>
          </section>
        )}

        {/* 3. CommunitySunset (Layer 3) — always render once connected so users see countdown */}
        {lucid && vault && sunset && (
          <section
            className={`glass-card glow-border rounded-2xl p-5 sm:p-6 space-y-4 ${
              sunset.available || sunset.alreadyTriggered ? 'danger' : ''
            }`}
          >
            <h2 className={`text-lg sm:text-xl font-bold ${sunset.available || sunset.alreadyTriggered ? 'text-amber-400' : 'text-slate-300'}`}>
              3. Layer 3 CommunitySunset {sunset.alreadyTriggered ? '— ACTIVE' : sunset.available ? '— AVAILABLE NOW' : '— countdown'}
            </h2>

            <p className="text-sm text-slate-400">
              The 90-day dead-man-switch. After ≥90 days of operational inactivity (no Compound, no realloc),
              ANY vUSDCx holder can flip <code className="text-amber-400">frozen=1 + community_sunset_triggered=1</code>,
              opening permissionless paths in <code className="text-amber-400">vault_recall.RecallFromLiqwid</code> +
              <code className="text-amber-400"> vault_protocol.DeployToProtocol</code> Layer 2 so depositors can
              recover their full proportional USDCx share without keeper or governance intervention.
              <strong className="text-slate-200"> The flag is one-way — irreversible.</strong>
            </p>

            <div className="bg-slate-900/70 rounded-lg p-4 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <div className="text-slate-400">Last activity</div>
              <div className="text-right font-mono text-xs">{fmtTime(sunset.lastActivityMs)}</div>

              <div className="text-slate-400">Days since activity</div>
              <div className="text-right font-mono">{sunset.daysSinceActivity >= 0 ? sunset.daysSinceActivity : 'n/a'}</div>

              <div className="text-slate-400">Threshold</div>
              <div className="text-right font-mono">90 days</div>

              <div className="text-slate-400">Days remaining</div>
              <div className={`text-right font-mono ${sunset.daysUntilSunset === 0 ? 'text-amber-400' : ''}`}>
                {sunset.daysUntilSunset}
              </div>

              <div className="text-slate-400">Already triggered</div>
              <div className={`text-right font-mono ${sunset.alreadyTriggered ? 'text-amber-400' : 'text-emerald-400'}`}>
                {sunset.alreadyTriggered ? 'YES' : 'no'}
              </div>

              <div className="text-slate-400">Caller vUSDCx (≥1 required)</div>
              <div className={`text-right font-mono ${userShares > 0n ? 'text-emerald-400' : 'text-red-400'}`}>
                {userShares.toString()}
              </div>
            </div>

            {sunset.alreadyTriggered ? (
              <div className="text-sm text-amber-400 bg-amber-500/10 border border-amber-500/30 p-3 rounded-lg">
                Sunset is already active. Permissionless RecallFromLiqwid + DeployToProtocol Layer 2 paths are open.
                Use <code>opti-gov</code> CLI or follow the operator runbook to exercise them.
              </div>
            ) : sunset.available ? (
              <>
                {!sunsetConfirmOpen ? (
                  <button
                    onClick={() => setSunsetConfirmOpen(true)}
                    disabled={busy || userShares <= 0n}
                    className="w-full bg-gradient-to-r from-amber-500 to-red-600 hover:from-amber-400 hover:to-red-500 disabled:from-slate-600 disabled:to-slate-600 disabled:cursor-not-allowed text-white font-bold py-3 rounded-xl transition-all"
                  >
                    {userShares <= 0n ? 'Need ≥1 vUSDCx to trigger' : 'Trigger Layer 3 Sunset (irreversible)'}
                  </button>
                ) : (
                  <div className="space-y-3 bg-amber-500/10 border-2 border-amber-500/40 rounded-lg p-4">
                    <div className="text-sm text-amber-300">
                      <strong>This is irreversible.</strong> After confirming, the vault will be permanently
                      frozen for normal Deposit/Compound, and any vUSDCx holder will be able to push the
                      permissionless recovery path. You should only do this if the founder + keeper +
                      governance have all genuinely failed.
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={handleSunsetTrigger}
                        disabled={busy}
                        className="flex-1 bg-gradient-to-r from-amber-500 to-red-600 hover:from-amber-400 hover:to-red-500 disabled:from-slate-600 disabled:to-slate-600 text-white font-bold py-3 rounded-lg transition-all"
                      >
                        {busy ? 'Working…' : 'Yes, trigger sunset'}
                      </button>
                      <button
                        onClick={() => setSunsetConfirmOpen(false)}
                        disabled={busy}
                        className="px-6 py-3 border border-slate-600 hover:border-slate-400 text-slate-300 rounded-lg"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="text-sm text-slate-400 bg-slate-900/50 border border-slate-700 p-3 rounded-lg">
                Not available yet — vault is still operational. {sunset.daysUntilSunset > 0 && `${sunset.daysUntilSunset} days remaining.`}
              </div>
            )}
          </section>
        )}

        {/* Status banner */}
        {status && (
          <div
            className={`rounded-xl p-3 text-sm break-all ${
              status.kind === 'error'
                ? 'bg-red-500/10 border border-red-500/30 text-red-400'
                : status.kind === 'ok'
                ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-400'
                : 'bg-cyan-500/10 border border-cyan-500/30 text-cyan-400'
            }`}
          >
            {status.text}
          </div>
        )}

        {txHash && networkResolved && (
          <div className="text-sm">
            <a
              href={explorerUrl(networkResolved, txHash)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-cyan-400 underline"
            >
              View on Cardanoscan ↗
            </a>
            <span className="text-slate-500 ml-2 font-mono text-xs">{txHash}</span>
          </div>
        )}

        {/* Footer */}
        <footer className="text-xs text-slate-500 pt-6 border-t border-slate-800 space-y-1.5">
          <div>OptiVaults V1 Emergency Withdraw v0.1.0 · Apache 2.0</div>
          <div>
            <strong className="text-slate-400">Offline use:</strong> Save this page (Ctrl+S / ⌘+S, "Webpage HTML Only").
            The saved file is fully self-contained and works any time, even if optivaults.app and the GitHub
            repo go offline.
          </div>
        </footer>
      </div>
    </div>
  )
}
