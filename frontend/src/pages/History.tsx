import { useState, useEffect } from 'react'
import { useCardano, txExplorerUrl, addrExplorerUrl } from '../hooks/useCardano'
import { useI18n } from '../i18n'
import { walkUserTxHistory, type TxRecord } from '../lib/txHistoryWalker'
import { clearCacheForDomain } from '../lib/historyCache'

export default function History() {
  const { wallet } = useCardano()
  const { t } = useI18n()
  const [txs, setTxs] = useState<TxRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const PAGE_SIZE = 10

  useEffect(() => { window.scrollTo(0, 0) }, [])

  async function fetchHistory(force: boolean = false) {
    if (!wallet.connected || !wallet.address) return
    setLoading(true)
    setError(null)
    try {
      if (force) {
        // Force-purge cached classifications so walker re-fetches + re-classifies
        // all TXs from Blockfrost. User-facing escape hatch when cached entries
        // are stale (e.g., from a previous classifier-version where some TXs
        // ended up cached as null/unknown but should now match a vault branch).
        await clearCacheForDomain('tx-history')
      }
      const records = await walkUserTxHistory(wallet.address, 50)
      setTxs(records)
    } catch {
      setError('Unable to load transaction history')
    } finally {
      setLoading(false)
    }
  }

  async function handleForceRefresh() {
    setRefreshing(true)
    try {
      await fetchHistory(true)
    } finally {
      setRefreshing(false)
    }
  }

  useEffect(() => {
    if (!wallet.connected || !wallet.address) return
    fetchHistory()
    const timer = setInterval(() => fetchHistory(), 30_000)
    const onVisible = () => { if (document.visibilityState === 'visible') fetchHistory() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', onVisible) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallet.connected, wallet.address])

  const totalPages = Math.ceil(txs.length / PAGE_SIZE)
  const pagedTxs = txs.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  return (
    <div className="max-w-3xl mx-auto space-y-4 sm:space-y-6">
      <div>
        <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold text-white">{t('history.title')}</h1>
        <p className="text-slate-400 text-base sm:text-lg md:text-xl mt-1 md:mt-2">{t('history.desc')}</p>
      </div>


      {!wallet.connected && (
        <div className="glass-card rounded-xl p-6 text-center text-slate-400 text-sm">
          {t('history.connectFirst')}
        </div>
      )}

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm px-4 py-3 rounded-xl">
          {error}
        </div>
      )}

      {wallet.connected && (
        <div className="glass-card rounded-xl md:rounded-2xl p-3 sm:p-4 md:p-6">
          <div className="flex justify-between items-center mb-3">
            <span className="text-slate-400 text-sm sm:text-base md:text-lg">{t('history.wallet')}</span>
            <div className="flex items-center gap-1.5">
              <a
                href={addrExplorerUrl(wallet.address)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sky-400 text-sm sm:text-base md:text-lg hover:underline font-mono"
              >
                {wallet.address.slice(0, 12)}...{wallet.address.slice(-8)}
              </a>
              <CopyButton text={wallet.address} />
            </div>
          </div>
        </div>
      )}

      {loading && (
        <div className="glass-card rounded-xl p-6 text-center text-slate-400 text-sm">
          {t('history.loading')}
        </div>
      )}

      {!loading && wallet.connected && txs.length === 0 && (
        <div className="glass-card rounded-xl p-6 text-center text-slate-500 text-sm">
          {t('history.noTx')}
        </div>
      )}

      {pagedTxs.length > 0 && (
        <div className="space-y-2 md:space-y-4">
          <div className="flex items-center justify-between">
            <button
              onClick={handleForceRefresh}
              disabled={refreshing || loading}
              className="text-xs sm:text-sm text-cyan-400 hover:text-cyan-300 disabled:text-slate-500 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5 px-2 py-1 rounded hover:bg-slate-800/50"
              title={refreshing ? 'Refreshing…' : 'Force re-fetch + re-classify all transactions'}
            >
              <svg className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>
              </svg>
              {refreshing ? '…' : t('history.refresh') || 'Refresh'}
            </button>
            <div className="text-slate-500 text-xs sm:text-sm md:text-base">{txs.length} {t('history.transactions')}</div>
          </div>
          {pagedTxs.map(tx => (
            <div key={tx.txHash} className="glass-card rounded-xl md:rounded-2xl p-4 sm:p-5 md:p-6 flex items-center justify-between gap-3 md:gap-5">
              <div className="min-w-0">
                <span className={`text-xs sm:text-sm px-2 py-0.5 md:py-1 rounded font-medium ${
                  tx.type === 'deposit' ? 'bg-emerald-500/10 text-emerald-400' :
                  tx.type === 'withdraw' ? 'bg-red-500/10 text-red-400' :
                  'bg-slate-500/10 text-slate-400'
                }`}>
                  {tx.type === 'deposit' ? 'Deposit' : tx.type === 'withdraw' ? 'Withdraw' : 'TX'}
                </span>
                <p className="text-slate-500 text-[10px] sm:text-xs md:text-sm mt-1.5 md:mt-2">
                  <a href={txExplorerUrl(tx.txHash)} target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:underline">{tx.txHash.slice(0, 8)}...</a>
                  <span className="ml-2">{new Date(tx.timestamp).toLocaleDateString()}</span>
                </p>
              </div>
              <span className={`text-base sm:text-lg md:text-xl font-medium text-right shrink-0 ${
                tx.type === 'deposit' ? 'text-emerald-400' : tx.type === 'withdraw' ? 'text-red-400' : 'text-white'
              }`}>
                {tx.type === 'deposit' && !tx.amount.startsWith('+') ? '+' : tx.type === 'withdraw' && !tx.amount.startsWith('-') ? '-' : ''}{tx.amount}
              </span>
            </div>
          ))}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 pt-2">
              <button
                onClick={() => { setPage(p => Math.max(0, p - 1)); window.scrollTo({ top: 0, behavior: 'smooth' }) }}
                disabled={page === 0}
                className="px-4 py-2 rounded-lg text-xs sm:text-sm font-medium bg-slate-800 text-slate-400 hover:text-white active:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors min-h-[40px]"
              >
                {t('history.prev')}
              </button>
              <span className="text-slate-500 text-xs">{page + 1} / {totalPages}</span>
              <button
                onClick={() => { setPage(p => Math.min(totalPages - 1, p + 1)); window.scrollTo({ top: 0, behavior: 'smooth' }) }}
                disabled={page >= totalPages - 1}
                className="px-4 py-2 rounded-lg text-xs sm:text-sm font-medium bg-slate-800 text-slate-400 hover:text-white active:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors min-h-[40px]"
              >
                {t('history.next')}
              </button>
            </div>
          )}
        </div>
      )}

      <div className="glass-card rounded-xl p-3 sm:p-4 text-[11px] sm:text-sm text-slate-400 space-y-1">
        <p>• {t('history.clickTx')}</p>
        <p>• {t('history.refreshNote')}</p>
      </div>
    </div>
  )
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000) }}
      className="text-slate-500 hover:text-white active:text-cyan-400 p-1.5 rounded-lg hover:bg-slate-700/50 transition-colors min-w-[32px] min-h-[32px] flex items-center justify-center shrink-0"
      title="Copy address"
    >
      {copied ? (
        <svg className="w-4 h-4 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
      ) : (
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
      )}
    </button>
  )
}
