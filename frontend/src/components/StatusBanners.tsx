/**
 * Reusable status banners — error retry, WS status, TX status
 */
import { useState, useEffect } from 'react'
import { useCardano, txExplorerUrl } from '../hooks/useCardano'
import { useI18n } from '../i18n'

export function BetaBanner() {
  const { t } = useI18n()
  return (
    <div className="bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs sm:text-sm px-4 py-2.5 rounded-xl flex items-center gap-2">
      <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
      <span>{t('beta.banner')}</span>
    </div>
  )
}

function getErrorGuidance(error: string): string {
  if (error.includes('contention') || error.includes('already spent'))
    return 'Vault is busy. Try Queue mode or wait 30 seconds and retry.'
  if (error.includes('Insufficient') || error.includes('insufficient'))
    return 'Not enough balance. Check your wallet has enough ADA for fees.'
  if (error.includes('CollateralNotFound'))
    return 'No suitable collateral UTXO. Ensure you have a UTXO with only ADA (no tokens).'
  if (error.includes('Network') || error.includes('fetch'))
    return 'Network issue. Check your connection and try again.'
  if (error.includes('cancelled by user') || error.includes('User declined') || error.includes('rejected') || error.includes('cancel'))
    return 'Transaction was cancelled in your wallet. No funds were moved.'
  if (error.includes('timeout'))
    return 'Request timed out. The network may be congested. Try again.'
  if (error.includes('auth') || error.includes('Auth') || error.includes('Missing Authorization') || error.includes('401'))
    return 'Wallet authentication failed. Disconnect and reconnect your wallet, then try again.'
  if (error.includes('signData'))
    return 'Wallet signature failed. Make sure your wallet supports CIP-30 signData.'
  if (error.includes('CORS') || error.includes('cors'))
    return 'Cross-origin request blocked. Contact the team if this persists.'
  return 'Something went wrong. You can retry or try a different approach.'
}

export function ErrorBanner({ onRetry }: { onRetry?: () => void }) {
  const { error } = useCardano()
  if (!error) return null

  const guidance = getErrorGuidance(error)

  return (
    <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-xs sm:text-sm px-4 py-3 rounded-xl space-y-2">
      <div className="flex items-start justify-between gap-2">
        <p className="break-all flex-1">{error.slice(0, 200)}</p>
        {onRetry && (
          <button
            onClick={onRetry}
            className="shrink-0 bg-red-500/20 hover:bg-red-500/30 text-red-300 px-3 py-1 rounded-lg text-xs font-medium transition-colors"
          >
            Retry
          </button>
        )}
      </div>
      <p className="text-red-300/70 text-xs">{guidance}</p>
    </div>
  )
}

export function TxStatusBanner() {
  const { txHash, txStatus } = useCardano()
  const [hidden, setHidden] = useState(false)

  // Auto-hide after 8s when confirmed or failed
  useEffect(() => {
    if (txStatus === 'confirmed' || txStatus === 'failed') {
      const t = setTimeout(() => setHidden(true), 8000)
      return () => clearTimeout(t)
    }
    setHidden(false)
  }, [txStatus, txHash])

  if (!txHash || hidden) return null

  const colors = txStatus === 'confirmed'
    ? 'bg-green-500/10 border-green-500/30 text-green-400'
    : txStatus === 'failed'
    ? 'bg-red-500/10 border-red-500/30 text-red-400'
    : 'bg-amber-500/10 border-amber-500/30 text-amber-400'

  const statusText: Record<string, string> = {
    building: 'Building TX...',
    signing: 'Waiting for wallet signature...',
    submitted: 'TX submitted — waiting for confirmation...',
    confirmed: 'TX confirmed!',
    failed: 'TX may have failed. Check explorer.',
  }

  return (
    <div className={`${colors} border text-xs sm:text-sm px-4 py-3 rounded-xl`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {(txStatus === 'submitted' || txStatus === 'building' || txStatus === 'signing') && (
            <div className="w-3 h-3 border-2 border-amber-400 border-t-transparent rounded-full animate-spin shrink-0" />
          )}
          <span>{statusText[txStatus] || txStatus}</span>
        </div>
        <a
          href={txExplorerUrl(txHash)}
          target="_blank"
          rel="noopener noreferrer"
          className="underline shrink-0 hover:opacity-80"
        >
          {txHash.slice(0, 10)}...
        </a>
      </div>
    </div>
  )
}

export function ApiStatusBanner() {
  const { vault, wallet } = useCardano()
  const [show, setShow] = useState(true)

  // Auto-hide after 8 seconds to avoid stuck banner
  useEffect(() => {
    if (wallet.connected && !vault.loaded) {
      const timer = setTimeout(() => setShow(false), 8000)
      return () => clearTimeout(timer)
    }
    setShow(true)
  }, [wallet.connected, vault.loaded])

  if (wallet.connected && !vault.loaded && show) {
    return (
      <div className="bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs sm:text-sm px-4 py-2.5 rounded-xl flex items-center justify-between">
        <span>Connecting to API server...</span>
        <div className="w-3 h-3 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return null
}
