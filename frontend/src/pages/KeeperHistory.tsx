import { useState, useEffect } from 'react'
import { txExplorerUrl, useCardano } from '../hooks/useCardano'
import { useI18n } from '../i18n'
import { fetchKeeperActionsFromR2, type KeeperActionRecord } from '../lib/historyR2'
import { walkVaultKeeperHistory } from '../lib/keeperHistoryWalker'

type KeeperAction = KeeperActionRecord

const TYPE_STYLE: Record<string, { bg: string; text: string; label: string }> = {
  compound:       { bg: 'bg-emerald-500/10', text: 'text-emerald-400', label: 'Compound' },
  reconcile:      { bg: 'bg-orange-500/10',  text: 'text-orange-400',  label: 'Reconcile' },
  batch_deposit:  { bg: 'bg-cyan-500/10',    text: 'text-cyan-400',    label: 'Deposit' },
  batch_withdraw: { bg: 'bg-red-500/10',     text: 'text-red-400',     label: 'Withdraw' },
  batch:          { bg: 'bg-cyan-500/10',    text: 'text-cyan-400',    label: 'Batch' },
  deploy:         { bg: 'bg-amber-500/10',   text: 'text-amber-400',   label: 'Deploy' },
  recall:         { bg: 'bg-purple-500/10',  text: 'text-purple-400',  label: 'Recall' },
  rebalance:      { bg: 'bg-blue-500/10',    text: 'text-blue-400',    label: 'Rebalance' },
  supply:         { bg: 'bg-teal-500/10',    text: 'text-teal-400',    label: 'Supply' },
  merge:          { bg: 'bg-sky-500/10',     text: 'text-sky-400',     label: 'Merge' },
  swap:           { bg: 'bg-indigo-500/10',  text: 'text-indigo-400',  label: 'Swap' },
  donation:       { bg: 'bg-lime-500/10',    text: 'text-lime-400',    label: 'Donation' },
  vault_tx:       { bg: 'bg-slate-500/10',   text: 'text-slate-400',   label: 'TX' },
}

export default function KeeperHistory() {
  const { t } = useI18n()
  const { vault } = useCardano()
  const [actions, setActions] = useState<KeeperAction[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(0)
  const [expanded, setExpanded] = useState<string | null>(null)
  const PAGE_SIZE = 10

  useEffect(() => { window.scrollTo(0, 0) }, [])

  useEffect(() => {
    async function fetchKeeper() {
      setLoading(true)
      setError(null)
      try {
        // Block 4: prefer R2-published per-keeper logs (Worker proxy +
        // on-chain auth); fall back to chain-walking the vault TX list
        // when the operator hasn't enabled R2 publishing.
        let records = await fetchKeeperActionsFromR2().catch(() => null)
        if (!records || records.length === 0) {
          records = await walkVaultKeeperHistory(50)
        }
        setActions(records || [])
      } catch {
        setError(t('keeper.error'))
      } finally {
        setLoading(false)
      }
    }
    fetchKeeper()
    const timer = setInterval(fetchKeeper, 60_000)
    const onVisible = () => { if (document.visibilityState === 'visible') fetchKeeper() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', onVisible) }
  }, [t])

  // Stats summary
  const compoundActions = actions.filter(a => a.type === 'compound')
  const totalProfit = compoundActions.reduce((sum, a) => sum + parseFloat(a.profitUsdcx), 0)
  const totalFees = actions.reduce((sum, a) => sum + parseFloat(a.estTxFeeAda), 0)

  const totalPages = Math.ceil(actions.length / PAGE_SIZE)
  const pagedActions = actions.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  return (
    <div className="max-w-3xl mx-auto space-y-4 sm:space-y-6">
      <div>
        <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold text-white">{t('keeper.title')}</h1>
        <p className="text-slate-400 text-base sm:text-lg md:text-xl mt-1 md:mt-2">{t('keeper.desc')}</p>
      </div>


      {/* Summary stats */}
      {!loading && actions.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <div className="glass-card rounded-xl p-3 sm:p-4 text-center">
            <p className="text-slate-500 text-[10px] sm:text-xs">{t('keeper.totalOps')}</p>
            <p className="text-white text-lg sm:text-xl font-bold mt-1">{actions.length}</p>
          </div>
          <div className="glass-card rounded-xl p-3 sm:p-4 text-center">
            <p className="text-slate-500 text-[10px] sm:text-xs">{t('keeper.totalProfit')}</p>
            <p className="text-emerald-400 text-lg sm:text-xl font-bold mt-1">+{totalProfit.toFixed(2)}</p>
            <p className="text-slate-500 text-[9px] sm:text-[10px]">USDCx</p>
            {totalProfit === 0 && (
              <p className="text-cyan-400/80 text-[9px] sm:text-[10px] mt-0.5 leading-tight">
                {t('keeper.accruing') || 'Accruing in Liqwid'}
                {vault.unrealizedYieldTotal > 0 && (
                  <> +{(vault.unrealizedYieldTotal / 1e6).toFixed(4)}</>
                )}
              </p>
            )}
          </div>
          <div className="glass-card rounded-xl p-3 sm:p-4 text-center">
            <p className="text-slate-500 text-[10px] sm:text-xs">{t('keeper.totalFees')}</p>
            <p className="text-amber-400 text-lg sm:text-xl font-bold mt-1">{totalFees.toFixed(2)}</p>
            <p className="text-slate-500 text-[9px] sm:text-[10px]">ADA</p>
          </div>
        </div>
      )}

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm px-4 py-3 rounded-xl">
          {error}
        </div>
      )}

      {loading && (
        <div className="glass-card rounded-xl p-6 text-center text-slate-400 text-sm">
          {t('keeper.loading')}
        </div>
      )}

      {!loading && actions.length === 0 && !error && (
        <div className="glass-card rounded-xl p-6 text-center text-slate-500 text-sm">
          {t('keeper.noActions')}
        </div>
      )}

      {/* Action list */}
      {pagedActions.length > 0 && (
        <div className="space-y-2 md:space-y-3">
          <div className="text-slate-500 text-xs sm:text-sm text-right">{actions.length} {t('keeper.operations')}</div>
          {pagedActions.map(action => {
            const style = TYPE_STYLE[action.type] || TYPE_STYLE.vault_tx
            const isExpanded = expanded === action.txHash
            return (
              <div key={action.txHash} className="glass-card rounded-xl md:rounded-2xl overflow-hidden">
                <button
                  onClick={() => setExpanded(isExpanded ? null : action.txHash)}
                  className="w-full p-4 sm:p-5 flex items-start justify-between gap-3 text-left hover:bg-slate-800/30 transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-xs px-2 py-0.5 rounded font-medium ${style.bg} ${style.text}`}>
                        {style.label}
                      </span>
                      <span className="text-slate-500 text-[10px] sm:text-xs">
                        {new Date(action.timestamp).toLocaleString(undefined, { hour12: false })}
                      </span>
                    </div>
                    <div className="text-slate-300 text-xs sm:text-sm mt-1.5 space-y-0.5 leading-relaxed break-words">
                      {action.detail.split(' | ').map((seg, i) => (
                        <p key={i}>{seg}</p>
                      ))}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    {action.type === 'compound' && parseFloat(action.profitUsdcx) > 0 && (
                      <p className="text-emerald-400 text-sm sm:text-base font-semibold">+{parseFloat(action.profitUsdcx).toFixed(2)}</p>
                    )}
                    {action.type === 'batch_deposit' && (
                      <p className="text-cyan-400 text-sm sm:text-base font-semibold">{action.detail.match(/[+-]?\d+\.\d+/)?.[0] || ''}</p>
                    )}
                    {action.type === 'batch_withdraw' && (
                      <p className="text-red-400 text-sm sm:text-base font-semibold">{action.detail.match(/[+-]?\d+\.\d+/)?.[0] || ''}</p>
                    )}
                    {action.type === 'supply' && (
                      <p className="text-teal-400 text-sm sm:text-base font-semibold">{action.detail.match(/\d+\.\d+/)?.[0] || ''}</p>
                    )}
                    {action.type === 'recall' && (
                      <p className="text-purple-400 text-sm sm:text-base font-semibold">{action.detail.match(/\d+\.\d+/)?.[0] || ''}</p>
                    )}
                    <p className="text-slate-500 text-[10px] whitespace-nowrap">
                      {parseFloat(action.estTxFeeAda) > 0 ? `Fee: ${parseFloat(action.estTxFeeAda).toFixed(4)} ADA` : ''}
                    </p>
                  </div>
                </button>

                {/* Expanded details */}
                {isExpanded && (
                  <div className="border-t border-slate-700/50 px-4 sm:px-5 py-3 sm:py-4 space-y-2 bg-slate-800/20">
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-500">TX Hash</span>
                      <a href={txExplorerUrl(action.txHash)} target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:underline font-mono">
                        {action.txHash.slice(0, 16)}...{action.txHash.slice(-8)}
                      </a>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-500">{t('keeper.txFee')}</span>
                      <span className="text-amber-400 font-mono">{parseFloat(action.estTxFeeAda).toFixed(6)} ADA</span>
                    </div>
                    {action.type === 'compound' && (
                      <div className="flex justify-between text-xs">
                        <span className="text-slate-500">{t('keeper.yieldAdded')}</span>
                        <span className="text-emerald-400 font-mono">+{parseFloat(action.profitUsdcx).toFixed(6)} USDCx</span>
                      </div>
                    )}
                    {action.vaultState && (
                      <>
                        <div className="border-t border-slate-700/30 pt-2 mt-2">
                          <p className="text-slate-500 text-[10px] mb-1.5">{t('keeper.vaultSnapshot')}</p>
                        </div>
                        <div className="flex justify-between text-xs">
                          <span className="text-slate-500">TVL</span>
                          <span className="text-white font-mono">{parseFloat(action.vaultState.totalDeposited).toLocaleString()} USDCx</span>
                        </div>
                        <div className="flex justify-between text-xs">
                          <span className="text-slate-500">{t('keeper.buffer')}</span>
                          <span className="text-white font-mono">{parseFloat(action.vaultState.idleBuffer).toLocaleString()} USDCx</span>
                        </div>
                        <div className="flex justify-between text-xs">
                          <span className="text-slate-500">{t('keeper.shares')}</span>
                          <span className="text-white font-mono">{BigInt(action.vaultState.totalShares).toLocaleString()}</span>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            )
          })}

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
        <p>• {t('keeper.note1')}</p>
        <p>• {t('keeper.note2')}</p>
      </div>
    </div>
  )
}
