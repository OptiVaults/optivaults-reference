/**
 * TX Confirmation Dialog — shows amounts, fees, and asks for confirmation before submitting
 */
import { useI18n } from '../i18n'

interface ConfirmDialogProps {
  open: boolean
  onConfirm: () => void
  onCancel: () => void
  title: string
  rows: Array<{ label: string; value: string; highlight?: boolean }>
}

export default function ConfirmDialog({ open, onConfirm, onCancel, title, rows }: ConfirmDialogProps) {
  const { t } = useI18n()
  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onCancel}>
      <div className="glass-card rounded-2xl p-5 sm:p-6 max-w-sm w-full mx-4 border border-slate-700 shadow-xl" onClick={e => e.stopPropagation()}>
        <h3 className="text-lg font-bold text-white mb-4">{title}</h3>
        <div className="space-y-2.5 mb-5">
          {rows.map((r, i) => (
            <div key={i} className="flex justify-between items-center text-sm">
              <span className="text-slate-400">{r.label}</span>
              <span className={r.highlight ? 'text-cyan-400 font-semibold' : 'text-white font-medium'}>{r.value}</span>
            </div>
          ))}
        </div>
        <div className="flex gap-3">
          <button onClick={onCancel} className="flex-1 py-2.5 rounded-xl border border-slate-600 text-slate-400 hover:text-white hover:border-slate-500 transition-colors text-sm font-medium">
            {t('confirm.cancel') || 'Cancel'}
          </button>
          <button onClick={onConfirm} className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-emerald-500 text-white font-semibold text-sm hover:opacity-90 transition-opacity">
            {t('confirm.proceed') || 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  )
}
