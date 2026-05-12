import { useCardano, txExplorerUrl } from '../hooks/useCardano'
import InfoRow from '../components/InfoRow'
import { useI18n } from '../i18n'

export default function Emergency() {
  const { wallet, vault, emergencyWithdraw, loading, error, txHash, txStatus } = useCardano()
  const { t } = useI18n()

  const lastCompoundTime = vault.loaded && vault.exists
    ? Number((vault as any).lastCompoundTime || 0)
    : 0
  const daysSinceCompound = lastCompoundTime > 0
    ? Math.floor((Date.now() - lastCompoundTime) / 86400000)
    : 0
  const canEmergencyWithdraw = daysSinceCompound >= 7 && wallet.connected && wallet.vusdcxBalance > 0n

  async function handleEmergencyWithdraw() {
    if (!canEmergencyWithdraw) return
    try {
      await emergencyWithdraw()
    } catch {
      // Error handled by context
    }
  }

  return (
    <div className="max-w-3xl mx-auto space-y-4 sm:space-y-6 pb-16 md:pb-0">
      <div>
        <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold text-white">{t('emergency.title')}</h1>
        <p className="text-slate-400 text-base sm:text-lg md:text-xl mt-1 md:mt-2">{t('emergency.desc')}</p>
      </div>


      <div className="glass-card rounded-xl sm:rounded-2xl md:rounded-3xl p-4 sm:p-6 md:p-8 space-y-4 md:space-y-6">
        <div className="flex items-center gap-3 md:gap-4">
          <div className={`w-3 h-3 md:w-4 md:h-4 rounded-full ${canEmergencyWithdraw ? 'bg-red-500 animate-pulse' : 'bg-green-500'}`} />
          <span className="text-white text-base sm:text-lg md:text-xl font-bold">
            {canEmergencyWithdraw ? t('emergency.available') : t('emergency.active')}
          </span>
        </div>

        <div className="bg-slate-900/70 rounded-lg md:rounded-xl p-4 sm:p-5 space-y-2 md:space-y-3">
          <InfoRow label={t('emergency.vaultStatus')} value={vault.exists ? t('emergency.vaultActive') : t('emergency.vaultNotDeployed')} />
          <InfoRow label={t('emergency.yourVusdcx')} value={`${Number(wallet.vusdcxBalance).toLocaleString()} vUSDCx`} />
          <InfoRow label={t('emergency.daysSince')} value={lastCompoundTime > 0 ? `${daysSinceCompound} ${t('emergency.days')}` : 'N/A'} warn={daysSinceCompound >= 5} />
          <InfoRow label={t('emergency.threshold')} value={`7 ${t('emergency.days')}`} />
          <InfoRow label={t('emergency.emergencyAvailable')} value={canEmergencyWithdraw ? 'YES' : 'NO'} green={!canEmergencyWithdraw} warn={canEmergencyWithdraw} />
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-xs sm:text-sm px-4 py-3 rounded-xl break-all">
            {error.slice(0, 200)}
          </div>
        )}

        {txHash && (
          <div className={`${txStatus === 'confirmed' ? 'bg-green-500/10 border-green-500/30 text-green-400' : txStatus === 'failed' ? 'bg-red-500/10 border-red-500/30 text-red-400' : 'bg-amber-500/10 border-amber-500/30 text-amber-400'} border text-xs sm:text-sm px-4 py-3 rounded-xl`}>
            <div className="flex items-center justify-between gap-2">
              <span>
                {txStatus === 'submitted' && t('emergency.pending')}
                {txStatus === 'confirmed' && t('emergency.confirmed')}
                {txStatus === 'failed' && t('status.failed')}
              </span>
              <a href={txExplorerUrl(txHash)} target="_blank" rel="noopener noreferrer" className="underline shrink-0">
                {t('common.explorer')}
              </a>
            </div>
          </div>
        )}

        <button
          disabled={!canEmergencyWithdraw || loading}
          onClick={handleEmergencyWithdraw}
          className="w-full bg-gradient-to-r from-red-600 to-red-800 hover:from-red-500 hover:to-red-700 disabled:from-slate-600 disabled:to-slate-600 disabled:cursor-not-allowed text-white text-base sm:text-lg md:text-xl font-bold py-3.5 sm:py-4 md:py-5 rounded-xl md:rounded-2xl transition-all duration-200"
        >
          {loading ? t('status.processing')
            : !wallet.connected ? t('deposit.connectFirst')
            : wallet.vusdcxBalance === 0n ? t('emergency.noVusdcx')
            : !canEmergencyWithdraw ? `${t('emergency.active')} (${Math.max(0, 7 - daysSinceCompound)} ${t('emergency.daysUntil')})`
            : t('emergency.btn')}
        </button>
      </div>

      <div className="glass-card rounded-xl md:rounded-2xl p-4 sm:p-5 md:p-6 text-xs sm:text-sm md:text-base text-slate-400 space-y-2 md:space-y-3">
        <h3 className="text-white font-bold text-base sm:text-lg md:text-xl">{t('emergency.howTitle')}</h3>
        <p>1. {t('emergency.howStep1')}</p>
        <p>2. {t('emergency.howStep2')}</p>
        <p>3. {t('emergency.howStep3')}</p>
        <p>4. {t('emergency.howStep4')}</p>
        <p className="text-amber-400 mt-2">{t('emergency.howNote')}</p>
      </div>
    </div>
  )
}
