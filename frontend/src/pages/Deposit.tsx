import { useState, useEffect } from 'react'
import { NavLink } from 'react-router-dom'
import { useCardano } from '../hooks/useCardano'
import { ErrorBanner, TxStatusBanner, ApiStatusBanner, BetaBanner } from '../components/StatusBanners'
import InfoRow from '../components/InfoRow'
import TxLockOverlay from '../components/TxLockOverlay'
import ConfirmDialog from '../components/ConfirmDialog'
import { CancelOrderSection } from './Withdraw'
import { useI18n } from '../i18n'
import {
  PRE_AUDIT_TVL_WARN_RATIO,
  formatCapUsdcx,
  wouldBreachCap,
  isAtCap,
  capUtilization,
  capHeadroom,
} from '../config/hardCap'
import { buildQueueDepositOrderTx } from '../lib/txBuilder'
import { selectWalletFromCip30, submitTolerant } from '../lib/lucidClient'

export default function Deposit() {
  const { wallet, vault, deposit, loading, networkMismatch, txStatus, txHash } = useCardano()
  const { t } = useI18n()
  const [amount, setAmount] = useState('')
  const selectedCoin = 'usdcx'
  const [mode, setMode] = useState<'direct' | 'queue'>(() => (localStorage.getItem('optivaults-default-mode') === 'queue' ? 'queue' : 'direct'))
  const [orderFallback, setOrderFallback] = useState(false)
  const [orderStatus, setOrderStatus] = useState('')
  const [queueLoading, setQueueLoading] = useState(false)
  const usdcxAmount = parseFloat(amount) || 0
  const minDeposit = 10  // USDCx minimum (contract min_deposit = 10_000_000 = 10 USDCx)
  
  const walletBalance = Number(wallet.usdcxBalance) / 1e6
  const insufficientBalance = wallet.connected && usdcxAmount > 0 && Math.floor(usdcxAmount * 1e6) > Number(wallet.usdcxBalance)

  const shares = vault.totalShares === 0
    ? usdcxAmount * 1_000_000
    : vault.totalDeposited > 0
      ? (usdcxAmount * 1e6 * vault.totalShares) / vault.totalDeposited
      : usdcxAmount * 1_000_000

  // Format large vUSDCx shares for display (e.g., 190T, 10B, 500M)
  function formatShares(s: number): string {
    if (s >= 1e12) return `${(s / 1e12).toFixed(2)}T`
    if (s >= 1e9) return `${(s / 1e9).toFixed(2)}B`
    if (s >= 1e6) return `${(s / 1e6).toFixed(2)}M`
    return Math.floor(s).toLocaleString()
  }

  const DEPOSIT_DISABLED = false
  // Operator-policy access control. Default `[]` keeps deposits open to all
  // wallets. Operators running their own instance may populate this list
  // with their own depositor allowlist (e.g. during a closed-beta or invite
  // phase). Withdraw is NOT gated here (see Withdraw.tsx) — existing
  // depositors can always exit. The on-chain contract itself is
  // permissionless; this is a frontend-only soft gate.
  const ALLOWED_ADDRESSES: string[] = []
  const isAllowedAddress = ALLOWED_ADDRESSES.length === 0 || !wallet.connected || ALLOWED_ADDRESSES.some(a => wallet.address?.startsWith(a.slice(0, 40)))

  // Pre-audit TVL hard cap (whitepaper §8.1). Frontend gating for
  // honest users — does NOT override the on-chain withdraw rights.
  const totalDepositedBig = BigInt(Math.max(0, Math.floor(vault.totalDeposited)))
  const depositAmountBig = BigInt(Math.max(0, Math.floor(usdcxAmount * 1e6)))
  const capFull = vault.loaded && isAtCap(totalDepositedBig)
  const capWouldBreach = vault.loaded && usdcxAmount > 0 && wouldBreachCap(totalDepositedBig, depositAmountBig)
  const capBlocked = capFull || capWouldBreach
  const capUtilPct = vault.loaded ? capUtilization(totalDepositedBig) : 0
  const capNearing = capUtilPct >= PRE_AUDIT_TVL_WARN_RATIO && capUtilPct < 1
  const capHeadroomUsdcx = vault.loaded ? Number(capHeadroom(totalDepositedBig)) / 1e6 : 0

  const canDeposit = !DEPOSIT_DISABLED && wallet.connected && isAllowedAddress && usdcxAmount >= minDeposit && !insufficientBalance && !loading && !queueLoading && !networkMismatch && !capBlocked

  const [depositError, setDepositError] = useState('')
  const [hideConfirmed, setHideConfirmed] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)

  useEffect(() => { setHideConfirmed(true); window.scrollTo(0, 0) }, [])
  useEffect(() => {
    if (txStatus === 'building') { setHideConfirmed(false); window.scrollTo({ top: 0, behavior: 'smooth' }) }
    if (txStatus === 'confirmed') window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [txStatus])

  function requestDeposit() {
    if (!canDeposit) return
    setShowConfirm(true)
  }

  async function handleQueueConfirmed() {
    setShowConfirm(false)
    await handleQueueDeposit()
  }

  async function handleDeposit() {
    setShowConfirm(false)
    if (!canDeposit) return
    setOrderFallback(false)
    setDepositError('')
    try {
      const minShares = BigInt(Math.floor(shares * 0.99))
      await deposit(BigInt(Math.floor(usdcxAmount * 1e6)), minShares, selectedCoin)
      setAmount('')
    } catch (e) {
      const msg = (e as Error).message || String(e)
      setDepositError(msg.slice(0, 200))
      if (msg.includes('contention') || msg.includes('already spent') || msg.includes('CollateralNotFound')) {
        setOrderFallback(true)
      }
    }
  }

  async function handleQueueDeposit() {
    if (!canDeposit || queueLoading) return
    setQueueLoading(true)
    setOrderStatus('building')
    setDepositError('')
    try {
      const minShares = BigInt(Math.floor(shares * 0.99))
      const savedWallet = localStorage.getItem('optivaults-wallet')
      const cip30 = (window as any).cardano?.[savedWallet || '']
      if (!cip30) { setOrderStatus('Wallet not found'); setQueueLoading(false); return }
      const api = await cip30.enable()
      await selectWalletFromCip30(api)

      const { tx } = await buildQueueDepositOrderTx({
        userAddr: wallet.address,
        amount: BigInt(Math.floor(usdcxAmount * 1e6)),
        minReceive: minShares,
      })

      setOrderStatus('signing')
      const signed = await tx.sign.withWallet().complete()

      setOrderStatus('submitting')
      const txHash = await submitTolerant(signed)
      setOrderStatus(`Order queued! TX: ${txHash.slice(0, 16)}... Keeper will process within ~5 min.`)
      setAmount('')
    } catch (e: any) {
      const msg = e?.message || e?.info || (typeof e === 'string' ? e : JSON.stringify(e))
      if (msg?.includes('cancel') || msg?.includes('decline') || msg?.includes('reject') || msg?.includes('refused') || e?.code === 2) {
        setOrderStatus('')
      } else {
        setOrderStatus(`Error: ${msg || 'Unknown error'}`)
      }
    } finally {
      setQueueLoading(false)
    }
  }

  return (
    <div className="max-w-3xl mx-auto space-y-4 sm:space-y-6 pb-16 md:pb-0">
      <TxLockOverlay txStatus={txStatus} />
      <ConfirmDialog
        open={showConfirm}
        onConfirm={mode === 'direct' ? handleDeposit : handleQueueConfirmed}
        onCancel={() => setShowConfirm(false)}
        title={mode === 'direct' ? t('deposit.direct') : t('deposit.order')}
        rows={mode === 'direct' ? [
          { label: t('deposit.youDeposit'), value: `${usdcxAmount.toFixed(2)} USDCx` },
          { label: t('deposit.youReceive'), value: `~${formatShares(shares)} vUSDCx`, highlight: true },
          { label: t('deposit.fee'), value: '~1 ADA' },
        ] : [
          { label: t('deposit.youDeposit'), value: `${usdcxAmount.toFixed(2)} USDCx` },
          { label: t('deposit.youReceive'), value: `~${formatShares(shares)} vUSDCx`, highlight: true },
          { label: t('deposit.fee'), value: t('deposit.queueFeeDetail') },
          { label: t('deposit.queueProcessing'), value: t('deposit.queueProcessingValue') },
        ]}
      />
      <div>
        <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold text-white">{t('deposit.title')}</h1>
        <p className="text-slate-400 text-base sm:text-lg md:text-xl mt-1">{t('deposit.desc')}</p>
      </div>

      {/* Maintenance banner (set DEPOSIT_DISABLED=true to show) */}

      {txStatus === 'confirmed' && !hideConfirmed && (
        <div className="glass-card rounded-xl p-5 text-center space-y-3 glow-border">
          <div className="text-3xl text-emerald-400">&#10003;</div>
          <p className="text-emerald-400 font-semibold">{t('status.confirmed')}</p>
          {txHash && <p className="text-slate-500 text-xs font-mono">{txHash.slice(0, 16)}...</p>}
          <div className="flex justify-center gap-3">
            <NavLink to="/" className="bg-gradient-to-r from-cyan-500 to-emerald-500 text-white font-medium px-6 py-2.5 rounded-xl text-sm">
              Dashboard
            </NavLink>
            <button onClick={() => setHideConfirmed(true)} className="bg-slate-700 hover:bg-slate-600 text-slate-300 font-medium px-4 py-2.5 rounded-xl text-sm transition-colors">
              Close
            </button>
          </div>
        </div>
      )}

      {wallet.connected && !isAllowedAddress && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-xs sm:text-sm px-4 py-3 rounded-xl">
          Deposits are temporarily restricted during the V1 pre-launch / internal-verification phase. The app is not yet publicly available — V1 public mainnet launch happens at the pre-audit 100K USDCx cap once §1.5 launch gates clear (whitepaper §0.2; audit is a cap-lift gate, not a launch gate). <strong>Withdraw is open for existing depositors</strong> and is unaffected by this gate.
        </div>
      )}
      <BetaBanner />

      {/* Pre-audit TVL hard cap — whitepaper §8.1 */}
      {vault.loaded && (capFull || capNearing) && (
        <div className={`rounded-xl px-4 py-3 text-xs sm:text-sm space-y-1 ${
          capFull
            ? 'bg-red-500/10 border border-red-500/40 text-red-300'
            : 'bg-amber-500/10 border border-amber-500/30 text-amber-300'
        }`}>
          <div className="font-semibold">
            {capFull
              ? `Pre-audit cap reached (${(capUtilPct * 100).toFixed(1)}% of ${formatCapUsdcx()} USDCx)`
              : `Pre-audit cap nearing — ${(capUtilPct * 100).toFixed(1)}% of ${formatCapUsdcx()} USDCx used, ~${capHeadroomUsdcx.toFixed(0)} USDCx headroom`}
          </div>
          <div className="opacity-90">
            New deposits gated by the 100K USDCx pre-audit cap; cap lifts toward Stage 3 ($500K → $2M) when external audit completes (target Q2-Q3 2027 if §8.1 funding stack delivers). If audit funding never lands (§8.1 Option D), cap stays at 100K indefinitely. <strong>Withdrawals are unaffected at all times</strong> — existing depositors can always exit.
          </div>
        </div>
      )}

      <ApiStatusBanner />
      <ErrorBanner onRetry={mode === 'direct' ? requestDeposit : handleQueueDeposit} />
      <TxStatusBanner />
      {depositError && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-[10px] sm:text-xs px-4 py-2.5 rounded-xl break-all max-h-24 overflow-y-auto">
          {depositError}
        </div>
      )}

      {orderStatus && (
        <div className={`text-xs px-4 py-2.5 rounded-xl ${orderStatus.startsWith('Error') ? 'bg-red-500/10 border border-red-500/30 text-red-400' : 'bg-cyan-500/10 border border-cyan-500/30 text-cyan-400'}`}>
          {orderStatus}
        </div>
      )}

      {orderFallback && (
        <div className="bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs sm:text-sm px-4 py-3 rounded-xl space-y-2">
          <p>Vault is busy (another transaction in progress).</p>
          <div className="flex gap-2">
            <button onClick={handleDeposit} className="bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 px-3 py-1 rounded-lg text-xs font-medium">
              Retry Direct
            </button>
            <button onClick={() => { setMode('queue'); setOrderFallback(false) }} className="bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-200 px-3 py-1 rounded-lg text-xs font-medium">
              Use Queue Mode
            </button>
          </div>
        </div>
      )}

      {/* Mode Toggle */}
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={() => setMode('direct')}
          className={`py-2.5 px-3 rounded-xl text-sm font-semibold transition-all ${
            mode === 'direct'
              ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30'
              : 'bg-slate-800/50 text-slate-400 hover:bg-slate-700/50'
          }`}
        >
          {t('deposit.direct')}
          <span className="block text-[10px] font-normal mt-0.5 opacity-70">{t('deposit.directNote')}</span>
        </button>
        <button
          onClick={() => setMode('queue')}
          className={`py-2.5 px-3 rounded-xl text-sm font-semibold transition-all ${
            mode === 'queue'
              ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30'
              : 'bg-slate-800/50 text-slate-400 hover:bg-slate-700/50'
          }`}
        >
          {t('deposit.order')}
          <span className="block text-[10px] font-normal mt-0.5 opacity-70">{t('deposit.queueNote')}</span>
        </button>
      </div>

      <div className="glass-card rounded-xl sm:rounded-2xl p-4 sm:p-6 space-y-4">
        {/* Amount input with balance */}
        <div>
          <div className="flex justify-between items-center mb-2 sm:mb-3">
            <label className="text-slate-400 text-sm sm:text-base block">{t('deposit.amount')} (USDCx)</label>
            {wallet.connected && (
              <span className="text-emerald-400 text-sm sm:text-base font-medium">
                {walletBalance.toFixed(6)} USDCx
              </span>
            )}
          </div>
          <div className={`flex items-center bg-slate-900 rounded-xl sm:rounded-2xl border transition-colors overflow-hidden ${insufficientBalance ? 'border-red-500/60' : 'border-slate-600 focus-within:border-cyan-500'}`}>
            <input
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={amount}
              onChange={(e) => { const v = e.target.value.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1'); setAmount(v) }}
              onKeyDown={(e) => { if (e.key === 'e' || e.key === 'E' || e.key === '+' || e.key === '-') e.preventDefault() }}
              placeholder="0.00"
              className="flex-1 bg-transparent text-white text-2xl sm:text-3xl md:text-4xl p-4 sm:p-5 outline-none min-w-0 text-right min-h-[56px] sm:min-h-[72px]"
            />
            <span className="text-slate-400 pr-3 sm:pr-4 font-semibold text-sm sm:text-base shrink-0">USDCx</span>
          </div>
          {insufficientBalance && (
            <p className="text-red-400 text-xs mt-2 flex items-center gap-1.5">
              <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
              {t('deposit.insufficientDetail')} ({walletBalance.toFixed(6)} USDCx)
            </p>
          )}
          {!insufficientBalance && capWouldBreach && !capFull && (
            <p className="text-amber-400 text-xs mt-2 flex items-center gap-1.5">
              <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
              This amount would exceed the pre-audit cap. Maximum available: {capHeadroomUsdcx.toFixed(2)} USDCx.
            </p>
          )}
          <div className="flex justify-between items-center mt-2.5">
            <p className="text-slate-500 text-[10px] sm:text-xs">{t('deposit.min')}: {minDeposit} USDCx</p>
            <div className="grid grid-cols-4 gap-1.5 sm:flex sm:gap-2">
              {[0.25, 0.5, 0.75, 1].map(pct => (
                 <button
                   key={pct}
                   className="bg-slate-800 hover:bg-slate-700 active:bg-slate-600 text-cyan-400 text-[10px] sm:text-xs font-semibold px-2.5 py-2 sm:py-1 rounded-md border border-slate-700 transition-colors min-h-[36px] sm:min-h-0"
                   onClick={() => {
                     const maxBal = Math.max(0, walletBalance)
                     setAmount(maxBal > 0 ? (maxBal * pct).toFixed(6) : '')
                   }}
                 >
                   {pct === 1 ? 'MAX' : `${pct * 100}%`}
                 </button>
              ))}
            </div>
          </div>
        </div>

        {usdcxAmount >= minDeposit && (
          <div className="bg-slate-900/70 rounded-lg p-3 sm:p-4 space-y-2">
            <InfoRow label={t('deposit.youDeposit')} value={`${usdcxAmount.toFixed(6)} $USDCx`} />
            <InfoRow label={t('deposit.youReceive')} value={`${formatShares(shares)} vUSDCx`} highlight />
            <InfoRow label={t('deposit.apy')} value={`~${(vault.apyBps / 100).toFixed(2)}%`} green />
            <InfoRow label={t('deposit.perfFee')} value={`${vault.performanceFeeBps / 100}% ${t('dashboard.onYield')}`} />
            <InfoRow label={t('deposit.fee')} value={mode === 'queue' ? t('deposit.queueFeeDetail') : '~1 ADA'} />
            {mode === 'queue' && <InfoRow label={t('deposit.queueProcessing')} value={t('deposit.queueProcessingValue')} />}
          </div>
        )}

        <button
          disabled={!canDeposit}
          onClick={requestDeposit}
          className="w-full bg-gradient-to-r from-cyan-500 to-emerald-500 hover:from-cyan-400 hover:to-emerald-400 active:from-cyan-600 active:to-emerald-600 active:scale-[0.98] disabled:from-slate-600 disabled:to-slate-600 disabled:cursor-not-allowed text-white text-base sm:text-lg md:text-xl font-bold py-3.5 sm:py-4 md:py-5 rounded-xl md:rounded-2xl transition-all duration-200 shadow-lg shadow-cyan-500/20 disabled:shadow-none"
        >
          {loading || queueLoading ? t('status.processing')
            : networkMismatch ? t('status.mismatch')
            : !wallet.connected ? t('deposit.connectFirst')
            : insufficientBalance ? t('deposit.insufficient')
            : usdcxAmount < minDeposit ? `${t('deposit.enterAmount')} (min ${minDeposit} $USDCx)`
            : mode === 'queue' ? t('deposit.order')
            : t('deposit.btn')}
        </button>
      </div>

      {wallet.connected && <CancelOrderSection address={wallet.address} />}


      <div className="glass-card rounded-xl p-3 sm:p-4 text-[11px] sm:text-sm text-slate-400 space-y-1">
        <p>• USDCx {t('deposit.infoBuffer')}</p>
        <p>• {t('deposit.infoKeeper')}</p>
        <p>• {t('deposit.infoShares')}</p>
        <p>• {t('deposit.infoWithdraw')} ({t('deposit.infoFee')})</p>
      </div>
    </div>
  )
}

