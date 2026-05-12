import { useState, useEffect } from 'react'
import { NavLink } from 'react-router-dom'
import { useCardano } from '../hooks/useCardano'
import { ErrorBanner, TxStatusBanner, ApiStatusBanner, BetaBanner } from '../components/StatusBanners'
import InfoRow from '../components/InfoRow'
import TxLockOverlay from '../components/TxLockOverlay'
import ConfirmDialog from '../components/ConfirmDialog'
import { useI18n } from '../i18n'
import { formatCompactNumber } from '../utils/formatters'
import { buildQueueWithdrawOrderTx, buildCancelOrderTx } from '../lib/txBuilder'
import { selectWalletFromCip30, submitTolerant } from '../lib/lucidClient'

export default function Withdraw() {
  const { wallet, vault, withdraw, loading, networkMismatch, txStatus, txHash } = useCardano()
  const { t } = useI18n()
  const [sharesT, setSharesT] = useState('') // Input in T vUSDCx units (÷1e12)
  const [mode, setMode] = useState<'direct' | 'queue'>(() => (localStorage.getItem('optivaults-default-mode') === 'queue' ? 'queue' : 'direct'))
  const [hideConfirmed, setHideConfirmed] = useState(false)
  const [orderStatus, setOrderStatus] = useState('')
  const [queueLoading, setQueueLoading] = useState(false)
  useEffect(() => { setHideConfirmed(true); window.scrollTo(0, 0) }, [])
  useEffect(() => {
    if (txStatus === 'building') { setHideConfirmed(false); window.scrollTo({ top: 0, behavior: 'smooth' }) }
    if (txStatus === 'confirmed') window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [txStatus])

  const userShares = Number(wallet.vusdcxBalance)
  const userSharesT = userShares / 1e12 // Display in T units
  // Convert T vUSDCx input to raw shares (1 T vUSDCx = 1e12 raw)
  const sharesToBurn = (parseFloat(sharesT) || 0) * 1e12
    const insufficientShares = wallet.connected && sharesToBurn > 0 && sharesToBurn > userShares

  const usdcxPreview = vault.totalShares > 0
    ? (sharesToBurn * vault.totalDeposited) / vault.totalShares / 1e6
    : sharesToBurn / 1_000_000

  const canWithdraw = wallet.connected && sharesToBurn > 0 && sharesToBurn <= userShares && sharesToBurn <= vault.totalShares && !loading && !queueLoading && !networkMismatch

  // Buffer check: warn if direct withdraw exceeds idle buffer
  const withdrawUsdcx = usdcxPreview * 1e6  // in raw units
  const exceedsBuffer = mode === 'direct' && vault.idleBuffer > 0 && withdrawUsdcx > vault.idleBuffer

  const [showConfirm, setShowConfirm] = useState(false)

  function requestWithdraw() {
    if (!canWithdraw) return
    setShowConfirm(true)
  }

  async function handleDirectWithdraw() {
    setShowConfirm(false)
    if (!canWithdraw) return
    try {
      const minReceive = BigInt(Math.floor(usdcxPreview * 0.99 * 1e6))
      await withdraw(BigInt(Math.floor(sharesToBurn)), minReceive)
      setSharesT('')
    } catch {
      // Error handled by context
    }
  }

  async function handleQueueWithdraw() {
    if (!canWithdraw || queueLoading) return
    setQueueLoading(true)
    setOrderStatus('building')
    try {
      const minReceive = BigInt(Math.floor(usdcxPreview * 0.99 * 1e6))
      const savedWallet = localStorage.getItem('optivaults-wallet')
      const cip30 = (window as any).cardano?.[savedWallet || '']
      if (!cip30) { setOrderStatus('Wallet not found'); setQueueLoading(false); return }
      const api = await cip30.enable()
      await selectWalletFromCip30(api)

      const { tx } = await buildQueueWithdrawOrderTx({
        userAddr: wallet.address,
        sharesToBurn: BigInt(Math.floor(sharesToBurn)),
        minReceive,
      })

      setOrderStatus('signing')
      const signed = await tx.sign.withWallet().complete()

      setOrderStatus('submitting')
      const txHash = await submitTolerant(signed)
      setOrderStatus(`Order submitted! TX: ${txHash.slice(0, 16)}...`)
      setSharesT('')
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
        onConfirm={handleDirectWithdraw}
        onCancel={() => setShowConfirm(false)}
        title={t('withdraw.title')}
        rows={[
          { label: t('withdraw.youBurn'), value: `${(parseFloat(sharesT) || 0).toFixed(6)}T vUSDCx` },
          { label: t('withdraw.youReceive'), value: `~${usdcxPreview.toFixed(6)} USDCx`, highlight: true },
          { label: t('withdraw.earlyFee'), value: `${vault.earlyWithdrawFeeBps / 100}%` },
          { label: t('deposit.fee'), value: '~1 ADA' },
        ]}
      />
      <div>
        <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold text-white">{t('withdraw.title')}</h1>
        <p className="text-slate-400 text-base sm:text-lg md:text-xl mt-1">{t('withdraw.desc')}</p>
      </div>

      {vault.loaded && !vault.exists && (
        <div className="glass-card rounded-xl p-6 text-center space-y-3 border border-cyan-500/30">
          <div className="text-4xl">⚠️</div>
          <p className="text-amber-400 font-semibold text-lg">Vault State Unavailable</p>
          <p className="text-slate-400 text-sm">Could not load the vault UTXO from the selected network. Check your wallet is on the correct network, then refresh. If the problem persists, see the status page.</p>
        </div>
      )}

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

      <BetaBanner />
      <ApiStatusBanner />
      <ErrorBanner onRetry={mode === 'direct' ? handleDirectWithdraw : handleQueueWithdraw} />
      <TxStatusBanner />

      {orderStatus && (
        <div className={`text-xs px-4 py-2.5 rounded-xl ${orderStatus.startsWith('Error') ? 'bg-red-500/10 border border-red-500/30 text-red-400' : 'bg-cyan-500/10 border border-cyan-500/30 text-cyan-400'}`}>
          {orderStatus}
        </div>
      )}

      {/* Balance */}
      <div className="glass-card rounded-xl sm:rounded-2xl p-4 md:p-5 flex justify-between items-center">
        <span className="text-slate-400 text-sm sm:text-base md:text-lg">{t('withdraw.balance')}</span>
        <span className="text-white font-semibold text-base sm:text-lg md:text-xl">{userSharesT.toFixed(6)}T vUSDCx</span>
      </div>

      {/* Buffer Status */}
      {vault.loaded && vault.exists && (
        <div className={`glass-card rounded-xl p-3 sm:p-4 border ${vault.idleBuffer > 0 ? 'border-emerald-500/20' : 'border-slate-700'}`}>
          <div className="flex justify-between items-center text-xs sm:text-sm">
            <span className="text-slate-400">Instant buffer available</span>
            <span className={`font-mono font-medium ${vault.idleBuffer > 0 ? 'text-emerald-400' : 'text-slate-500'}`}>
              {(vault.idleBuffer / 1e6).toLocaleString(undefined, { maximumFractionDigits: 2 })} USDCx
            </span>
          </div>
          {vault.totalDeposited > 0 && (
            <div className="flex justify-between items-center text-xs mt-1">
              <span className="text-slate-500">Buffer ratio</span>
              <span className="text-slate-400">{(vault.idleBuffer / vault.totalDeposited * 100).toFixed(1)}% of TVL</span>
            </div>
          )}
        </div>
      )}

      {/* Mode Toggle */}
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={() => setMode('direct')}
          className={`py-2.5 px-3 rounded-xl text-sm font-semibold transition-all ${
            mode === 'direct'
              ? 'bg-red-500/20 text-red-400 border border-red-500/30'
              : 'bg-slate-800/50 text-slate-400 hover:bg-slate-700/50'
          }`}
        >
          {t('withdraw.directMode')}
          <span className="block text-[10px] font-normal mt-0.5 opacity-70">{t('withdraw.directModeNote')}</span>
        </button>
        <button
          onClick={() => setMode('queue')}
          className={`py-2.5 px-3 rounded-xl text-sm font-semibold transition-all ${
            mode === 'queue'
              ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30'
              : 'bg-slate-800/50 text-slate-400 hover:bg-slate-700/50'
          }`}
        >
          {t('withdraw.queueMode')}
          <span className="block text-[10px] font-normal mt-0.5 opacity-70">{t('withdraw.queueModeNote')}</span>
        </button>
      </div>

      {mode === 'direct' && (
        <div className="bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs px-4 py-2.5 rounded-xl">
          <span className="font-medium">{t('withdraw.directFeeNotice')}</span>
        </div>
      )}

      {exceedsBuffer && sharesToBurn > 0 && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-300 text-xs px-4 py-3 rounded-xl space-y-1">
          <p className="font-semibold">Exceeds available buffer</p>
          <p>Withdraw amount (~{(withdrawUsdcx / 1e6).toFixed(2)} USDCx) exceeds instant buffer ({(vault.idleBuffer / 1e6).toFixed(2)} USDCx). Transaction may fail if vault does not hold sufficient tokens.</p>
          <p className="text-amber-300">Recommended: Use <strong>Queue Withdraw</strong> — Keeper will recall funds from protocols and process your withdrawal.</p>
        </div>
      )}

      <div className="glass-card rounded-xl sm:rounded-3xl p-4 sm:p-6 space-y-4 md:space-y-5">
        <div>
          <label className="text-slate-400 text-sm sm:text-base md:text-lg block mb-2 sm:mb-3">{t('withdraw.shares')}</label>
          <div className={`flex items-center bg-slate-900 rounded-xl border transition-colors ${insufficientShares ? 'border-red-500/60' : 'border-slate-600 focus-within:border-red-500'}`}>
            <input
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={sharesT}
              onChange={(e) => { const v = e.target.value.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1'); setSharesT(v) }}
              onKeyDown={(e) => { if (e.key === 'e' || e.key === 'E' || e.key === '+' || e.key === '-') e.preventDefault() }}
              placeholder="0"
              className="flex-1 bg-transparent text-white text-2xl sm:text-3xl md:text-4xl p-4 sm:p-5 outline-none min-w-0 text-right min-h-[56px] sm:min-h-[72px]"
            />
            <span className="text-slate-400 pr-4 sm:pr-5 font-bold text-sm sm:text-base shrink-0">
              T vUSDCx
            </span>
          </div>
          {insufficientShares && (
            <p className="text-red-400 text-xs mt-2 flex items-center gap-1.5">
              <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
              {t('withdraw.insufficient')} ({userSharesT.toFixed(6)}T vUSDCx)
            </p>
          )}
          <div className="flex justify-between items-center mt-3">
            <span className="text-slate-500 text-xs">{sharesToBurn > 0 ? `= ${formatCompactNumber(sharesToBurn)} shares` : ''}</span>
            <div className="grid grid-cols-4 gap-1.5 sm:flex sm:gap-2">
              {[0.25, 0.5, 0.75, 1].map(pct => (
                <button
                  key={pct}
                  className="bg-slate-800 hover:bg-slate-700 active:bg-slate-600 text-sky-400 hover:text-sky-300 text-xs sm:text-sm font-bold px-3 py-2 sm:py-1.5 rounded-lg border border-slate-700 transition-colors min-h-[36px] sm:min-h-0"
                  onClick={() => {
                    const vaultSharesT = vault.totalShares / 1e12
                    const maxT = Math.min(userSharesT, vaultSharesT)
                    // Floor to avoid exceeding vault shares due to floating point
                    const val = Math.floor(maxT * pct * 1e6) / 1e6
                    setSharesT(val.toFixed(6))
                  }}
                >
                  {pct === 1 ? 'MAX' : `${pct * 100}%`}
                </button>
              ))}
            </div>
          </div>
        </div>

        {sharesToBurn > 0 && (
          <div className="bg-slate-900/70 rounded-lg p-3 sm:p-4 space-y-2">
            <InfoRow label={t('withdraw.youBurn')} value={`${(parseFloat(sharesT) || 0).toFixed(6)}T vUSDCx`} />
            {mode === 'direct' ? (
              <>
                <InfoRow label={t('withdraw.earlyFee')} value={`-${(usdcxPreview * vault.earlyWithdrawFeeBps / 10000).toFixed(6)} USDCx (${vault.earlyWithdrawFeeBps / 100}%)`} warn />
                <InfoRow label={t('withdraw.youReceive')} value={`~${(usdcxPreview * (1 - vault.earlyWithdrawFeeBps / 10000)).toFixed(6)} USDCx`} green />
              </>
            ) : (
              <InfoRow label={t('withdraw.youReceive')} value={`~${usdcxPreview.toFixed(6)} USDCx`} green />
            )}
            {mode === 'queue' && (
              <InfoRow label={t('withdraw.earlyFee')} value={t('withdraw.queueFree')} green />
            )}
            <InfoRow label={t('deposit.fee')} value={mode === 'queue' ? t('withdraw.queueFeeDetail') : '~1 ADA'} />
            {mode === 'direct' && vault.idleBuffer > 0 && (
              <InfoRow
                label={t('withdraw.bufferStatus')}
                value={withdrawUsdcx <= vault.idleBuffer
                  ? `OK (${(vault.idleBuffer / 1e6).toFixed(2)} available)`
                  : `Exceeds buffer (${(vault.idleBuffer / 1e6).toFixed(2)} available)`}
                green={withdrawUsdcx <= vault.idleBuffer}
                warn={withdrawUsdcx > vault.idleBuffer}
              />
            )}
          </div>
        )}

        <button
          disabled={!canWithdraw || loading}
          onClick={mode === 'direct' ? requestWithdraw : handleQueueWithdraw}
          className={`w-full font-semibold py-3 sm:py-3.5 rounded-xl transition-all duration-200 text-sm sm:text-base ${
            mode === 'direct'
              ? 'bg-gradient-to-r from-red-500 to-rose-500 hover:from-red-400 hover:to-rose-400 active:from-red-600 active:to-rose-600 active:scale-[0.98] disabled:from-slate-600 disabled:to-slate-600 shadow-lg shadow-red-500/20 disabled:shadow-none'
              : 'bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 active:from-amber-600 active:to-orange-600 active:scale-[0.98] disabled:from-slate-600 disabled:to-slate-600 shadow-lg shadow-amber-500/20 disabled:shadow-none'
          } disabled:cursor-not-allowed text-white`}
        >
          {loading ? t('status.processing')
            : networkMismatch ? t('status.mismatch')
            : !wallet.connected ? t('deposit.connectFirst')
            : userShares === 0 ? t('withdraw.noShares')
            : sharesToBurn <= 0 ? t('withdraw.enterAmount')
            : sharesToBurn > userShares ? t('withdraw.insufficient')
            : mode === 'direct' ? t('withdraw.directMode')
            : t('withdraw.queueMode')}
        </button>
      </div>

      {/* Cancel Order */}
      {wallet.connected && (
        <CancelOrderSection address={wallet.address} />
      )}


      <div className="glass-card rounded-xl p-3 sm:p-4 text-[11px] sm:text-sm text-slate-400 space-y-1">
        <p>• {t('withdraw.infoBuffer')}</p>
        <p>• {t('withdraw.infoKeeper')}</p>
        <p>• {t('withdraw.infoEarly')}</p>
        <p>• {t('withdraw.infoEmergency')}</p>
        <p>• {t('withdraw.infoSwapLoss')}</p>
      </div>
    </div>
  )
}

export function CancelOrderSection({ address }: { address: string }) {
  const [status, setStatus] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleCancel() {
    if (loading) return
    setLoading(true)
    setStatus('Building cancel TX...')
    try {
      const savedWallet = localStorage.getItem('optivaults-wallet')
      const cip30 = (window as any).cardano?.[savedWallet || '']
      if (!cip30) { setStatus('Wallet not found'); setLoading(false); return }
      const api = await cip30.enable()
      await selectWalletFromCip30(api)

      const { tx } = await buildCancelOrderTx({ userAddr: address })

      setStatus('Signing...')
      const signed = await tx.sign.withWallet().complete()

      setStatus('Submitting...')
      const txHash = await submitTolerant(signed)
      setStatus(`Cancelled! TX: ${txHash.slice(0, 16)}...`)
    } catch (e: any) {
      const msg = e?.message || e?.info || (typeof e === 'string' ? e : JSON.stringify(e))
      if (msg?.includes('No pending orders')) {
        setStatus('No pending orders')
      } else if (msg?.includes('cancel') || msg?.includes('decline') || e?.code === 2) {
        setStatus('')
      } else {
        setStatus(`Error: ${msg || 'Unknown error'}`)
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="glass-card rounded-xl p-4 space-y-2">
      <div className="flex justify-between items-center">
        <span className="text-slate-400 text-sm">Pending Orders</span>
        <button
          onClick={handleCancel}
          disabled={loading}
          className="bg-slate-700 hover:bg-slate-600 disabled:bg-slate-800 text-slate-300 text-xs px-3 py-1.5 rounded-lg transition-colors"
        >
          {loading ? 'Processing...' : 'Cancel Orders'}
        </button>
      </div>
      {status && (
        <p className={`text-xs ${status.startsWith('Error') ? 'text-red-400' : status.includes('No pending') ? 'text-slate-500' : 'text-cyan-400'}`}>
          {status}
        </p>
      )}
    </div>
  )
}
