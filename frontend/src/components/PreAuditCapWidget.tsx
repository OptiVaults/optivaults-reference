import { PRE_AUDIT_TVL_WARN_RATIO, formatCapUsdcx, capUtilization, capHeadroom } from '../config/hardCap'

type Props = {
  totalDeposited: number // USDCx 6-decimal base units
  frozen: boolean
  loaded: boolean
}

/**
 * Pre-Audit TVL Cap widget — whitepaper §8.1.
 *
 * Surfaces the operator-enforced pre-audit ceiling to every visitor.
 * Shows live utilization, headroom, and state transitions:
 *   - Within cap         (green)
 *   - Nearing (≥90%)     (amber)
 *   - Over cap           (red)
 *   - Frozen             (blue, governance intervened)
 *
 * Critically, this widget never gates withdraws. It is informational
 * for depositors + accountability for operators.
 */
export default function PreAuditCapWidget({ totalDeposited, frozen, loaded }: Props) {
  if (!loaded) return null

  const totalBig = BigInt(Math.max(0, Math.floor(totalDeposited)))
  const util = capUtilization(totalBig)
  const utilPct = Math.min(util * 100, 100)
  const overCap = util > 1
  const nearing = util >= PRE_AUDIT_TVL_WARN_RATIO && util < 1
  const headroomUsdcx = Number(capHeadroom(totalBig)) / 1e6
  const currentUsdcx = totalDeposited / 1e6
  const capUsdcxLabel = formatCapUsdcx()

  let state: 'within' | 'nearing' | 'over' | 'frozen'
  if (frozen) state = 'frozen'
  else if (overCap) state = 'over'
  else if (nearing) state = 'nearing'
  else state = 'within'

  const palette = {
    within:  { bar: 'bg-emerald-500',  ring: 'border-emerald-500/30', text: 'text-emerald-300', bg: 'bg-emerald-500/5', label: 'Within cap' },
    nearing: { bar: 'bg-amber-500',    ring: 'border-amber-500/40',   text: 'text-amber-300',   bg: 'bg-amber-500/5',   label: 'Cap nearing' },
    over:    { bar: 'bg-red-500',      ring: 'border-red-500/50',     text: 'text-red-300',     bg: 'bg-red-500/5',     label: 'Over cap' },
    frozen:  { bar: 'bg-sky-500',      ring: 'border-sky-500/40',     text: 'text-sky-300',     bg: 'bg-sky-500/10',    label: 'Frozen by governance' },
  }[state]

  return (
    <div className={`rounded-xl border ${palette.ring} ${palette.bg} px-4 py-3 space-y-2`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className={`text-xs sm:text-sm font-semibold ${palette.text}`}>
            Pre-Audit TVL Cap · {palette.label}
          </p>
          <p className="text-[10px] sm:text-xs text-slate-400 mt-0.5">
            Operator-enforced ceiling until Q2-Q3 2027 third-party audit. Withdrawals unaffected.
          </p>
        </div>
        <span className={`text-xs sm:text-sm font-mono ${palette.text} shrink-0`}>
          {util >= 1 ? (util * 100).toFixed(1) + '%' : utilPct.toFixed(1) + '%'}
        </span>
      </div>

      <div className="h-2 rounded-full bg-slate-800/80 overflow-hidden">
        <div
          className={`h-full ${palette.bar} transition-all duration-500`}
          style={{ width: `${Math.min(utilPct, 100)}%` }}
        />
      </div>

      <div className="flex justify-between text-[10px] sm:text-xs text-slate-400 font-mono">
        <span>{currentUsdcx.toFixed(0)} / {capUsdcxLabel} USDCx</span>
        <span>
          {overCap
            ? `over cap by ${((util - 1) * 100).toFixed(1)}%`
            : `headroom ${headroomUsdcx.toFixed(0)} USDCx`}
        </span>
      </div>
    </div>
  )
}
