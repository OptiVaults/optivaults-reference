/**
 * TxLockOverlay — 交易簽名期間的全屏畫面鎖控
 *
 * 當 txStatus 為 'building' 或 'signing' 時顯示：
 * - 全屏半透明遮罩 + 模糊背景，阻擋所有使用者互動
 * - 動態狀態文字（建構中 → 等待錢包授權）
 * - 旋轉 spinner 視覺回饋
 *
 * 使用者於錢包 popup 授權後，txStatus 轉為 'processing'，鎖控自動解除。
 * 此時使用者可看見 TxStatusBanner 持續追蹤鏈上確認狀態。
 */
import { useEffect } from 'react'
import type { TxStatus } from '../hooks/useCardano'
import { useI18n } from '../i18n'

interface Props {
  txStatus: TxStatus
}

export default function TxLockOverlay({ txStatus }: Props) {
  const { t } = useI18n()
  const locked = txStatus === 'building' || txStatus === 'signing'

  // 鎖控期間禁用背景捲動
  useEffect(() => {
    if (!locked) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [locked])

  if (!locked) return null

  const title = txStatus === 'building' ? t('lock.building') : t('lock.waitingSign')
  const isSigning = txStatus === 'signing'

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fadeIn"
      role="dialog"
      aria-modal="true"
      aria-live="polite"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="glass-card rounded-2xl p-6 sm:p-8 max-w-sm w-full text-center space-y-5 border border-cyan-500/30 shadow-2xl shadow-cyan-500/10">
        {/* 雙圈旋轉 spinner */}
        <div className="relative w-16 h-16 mx-auto">
          <div className="absolute inset-0 border-4 border-slate-700 rounded-full" />
          <div className={`absolute inset-0 border-4 border-transparent rounded-full animate-spin ${isSigning ? 'border-t-emerald-400 border-r-emerald-400' : 'border-t-cyan-400 border-r-cyan-400'}`} />
          {/* 錢包 icon (signing) or TX icon (building) */}
          <div className="absolute inset-0 flex items-center justify-center">
            {isSigning ? (
              <svg className="w-6 h-6 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" />
                <path d="M3 5v14a2 2 0 0 0 2 2h16v-5" />
                <path d="M18 12a2 2 0 0 0 0 4h4v-4Z" />
              </svg>
            ) : (
              <svg className="w-6 h-6 text-cyan-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="16" rx="2" />
                <path d="M3 10h18" />
                <path d="M8 4v4M16 4v4" />
              </svg>
            )}
          </div>
        </div>

        <div className="space-y-2">
          <p className={`font-semibold text-lg ${isSigning ? 'text-emerald-300' : 'text-cyan-300'}`}>
            {title}
          </p>
          <p className="text-slate-400 text-xs sm:text-sm">
            {t('lock.dontClose')}
          </p>
        </div>

        {/* 進度指示點 */}
        <div className="flex items-center justify-center gap-2 pt-1">
          <div className={`w-2 h-2 rounded-full transition-colors ${txStatus === 'building' ? 'bg-cyan-400 animate-pulse' : 'bg-emerald-400'}`} />
          <div className="w-8 h-0.5 bg-slate-700" />
          <div className={`w-2 h-2 rounded-full transition-colors ${isSigning ? 'bg-emerald-400 animate-pulse' : 'bg-slate-700'}`} />
        </div>
      </div>
    </div>
  )
}
