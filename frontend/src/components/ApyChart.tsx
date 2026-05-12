/**
 * APY Trend chart — realised return from vault share-price history.
 *
 * Data source: operator-published `vault-history.jsonl` on R2 (or any
 * static-CDN URL via `VITE_HISTORY_BASE_URL`). When the operator hasn't
 * configured R2, the chart degrades gracefully to the on-chain
 * "Accruing in Liqwid" line only.
 *
 * Realised APY = (sharePrice_end / sharePrice_start) ** (365 / elapsedDays) - 1
 *
 * The "Accruing in Liqwid" companion line uses on-chain Liqwid market
 * state directly (Block 2 step 3) so it remains accurate even if the
 * R2 publishing path is offline.
 *
 * Fallbacks:
 *   - R2 not configured / file 404 → show placeholder with on-chain
 *     blended APY only.
 *   - empty snapshots (new vault / keeper hasn't written yet) → same.
 *   - < 2 data points within selected period → same.
 */
import { useState, useEffect, useMemo } from 'react'
import { useI18n } from '../i18n'
import { useCardano } from '../hooks/useCardano'
import { queryMarketSnapshot } from '../lib/marketQuery'
import { fetchVaultHistoryFromR2 } from '../lib/historyR2'

interface VaultSnapshot {
  ts: number
  tvl: string
  totalShares: string
  sharePrice: number
  idleBuffer: string
  nonDepositValue: string
  strategyBlendedApy?: number
}

interface DataPoint {
  ts: number
  date: string
  apy: number
  sharePrice: number
}

// Daily downsample: bucket by calendar day (UTC), take the latest snapshot
// per day. Chart usually wants 30 or 90 points, not 720 hourly samples.
function downsampleDaily(snaps: VaultSnapshot[]): VaultSnapshot[] {
  const buckets = new Map<string, VaultSnapshot>()
  for (const s of snaps) {
    const key = new Date(s.ts).toISOString().slice(0, 10)
    const prior = buckets.get(key)
    if (!prior || prior.ts < s.ts) buckets.set(key, s)
  }
  return Array.from(buckets.values()).sort((a, b) => a.ts - b.ts)
}

// Annualised APY from two share-price samples and their timestamp delta.
// For brand-new vaults the chart populates within hours of the first
// snapshot, so we keep the minimum window short (1 hour). Volatility under
// 24h is expected and acceptable — the chart is a "live trend" indicator,
// not a long-term performance metric.
function annualisedApy(startSp: number, endSp: number, startTs: number, endTs: number): number {
  if (!startSp || !endSp || endTs <= startTs) return 0
  const days = (endTs - startTs) / 86400000
  if (days < 0.04) return 0 // less than ~1 hour — too short to extrapolate
  const ratio = endSp / startSp
  if (ratio <= 0) return 0
  return (Math.pow(ratio, 365 / days) - 1) * 100
}

export default function ApyChart() {
  const { t } = useI18n()
  const { vault } = useCardano()
  const [data, setData] = useState<DataPoint[]>([])
  const [period, setPeriod] = useState<'30' | '90'>('30')
  const [status, setStatus] = useState<'loading' | 'ready' | 'insufficient'>('loading')
  // Strategy blended APY ("Accruing in Liqwid") — direct on-chain query
  // via marketQuery, no API server dependency. Refreshes alongside the
  // vault state polling cadence.
  const [accruingApy, setAccruingApy] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    if (!vault.exists || vault.totalDeposited === 0) return
    queryMarketSnapshot({
      totalDeposited: vault.totalDeposited,
      liqwidPrincipal: vault.liqwidPrincipal,
      performanceFeeBps: vault.performanceFeeBps,
    })
      .then(snap => {
        if (!cancelled && snap?.exists) setAccruingApy(snap.blendedApy)
      })
      .catch(() => { /* market not configured */ })
    return () => { cancelled = true }
  }, [vault.exists, vault.totalDeposited, vault.liqwidPrincipal, vault.performanceFeeBps])

  useEffect(() => {
    let cancelled = false
    async function load() {
      setStatus('loading')
      try {
        // Block 4: read JSONL directly from operator's R2 bucket.
        // Returns null when VITE_HISTORY_BASE_URL is unset OR the file
        // hasn't been published yet — both treated as "insufficient".
        const fromR2 = await fetchVaultHistoryFromR2(parseInt(period, 10))
        if (cancelled) return
        const snaps: VaultSnapshot[] = fromR2 || []
        if (snaps.length < 2) {
          setStatus('insufficient')
          return
        }
        // Prefer daily-downsampled (1 point per UTC day) for stable curves.
        // For brand-new vaults that haven't accumulated 2+ calendar days yet,
        // fall back to raw hourly snapshots so users see something useful
        // within hours of first data, not after 2 full days.
        const daily = downsampleDaily(snaps)
        const usedSeries = daily.length >= 2 ? daily : snaps
        if (usedSeries.length < 2) {
          setStatus('insufficient')
          return
        }
        // Rolling APY at each point: compare to the first sample in the window.
        const first = usedSeries[0]
        const sub24h = (usedSeries[usedSeries.length - 1].ts - first.ts) < 86400000
        const points: DataPoint[] = usedSeries.map(s => ({
          ts: s.ts,
          // Format hourly when window spans <24h, daily otherwise.
          date: sub24h
            ? `${new Date(s.ts).getUTCHours().toString().padStart(2, '0')}:00`
            : `${new Date(s.ts).getUTCMonth() + 1}/${new Date(s.ts).getUTCDate()}`,
          apy: annualisedApy(first.sharePrice, s.sharePrice, first.ts, s.ts),
          sharePrice: s.sharePrice,
        }))
        setData(points)
        setStatus('ready')
      } catch {
        if (!cancelled) setStatus('insufficient')
      }
    }
    load()
    return () => { cancelled = true }
  }, [period])

  const { path, area, labels, accruingY, dims } = useMemo(() => {
    if (data.length < 2) return { path: '', area: '', labels: [] as Array<{ val: string; y: number }>, accruingY: null as number | null, dims: { W: 400, H: 120, PX: 40, PY: 10 } }
    const vals = data.map(d => d.apy)
    // Include accruingApy in y-range so its horizontal line stays inside
    // the chart frame (otherwise it could clip off the top when realised
    // line is flat at 0% and accruing is e.g. 6%).
    const accruingForRange = accruingApy !== null && accruingApy > 0 ? accruingApy : 0
    const min = Math.floor(Math.min(...vals, 0) * 10) / 10
    const max = Math.max(
      Math.ceil(Math.max(...vals, accruingForRange) * 10) / 10,
      min + 1,
    )
    const range = max - min || 1
    const W = 400, H = 120, PX = 40, PY = 10

    const points = data.map((d, i) => ({
      x: PX + (i / (data.length - 1)) * (W - PX * 2),
      y: PY + (1 - (d.apy - min) / range) * (H - PY * 2),
    }))

    const pathStr = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ')
    const areaStr = pathStr + ` L${points[points.length - 1].x},${H - PY} L${points[0].x},${H - PY} Z`

    const labelCount = 3
    const lbls = Array.from({ length: labelCount }, (_, i) => {
      const val = min + (range * i) / (labelCount - 1)
      const y = PY + (1 - i / (labelCount - 1)) * (H - PY * 2)
      return { val: val.toFixed(1) + '%', y }
    })

    // Y-coord for the (constant) accruing-in-Liqwid line. Render as a
    // dashed horizontal so it's visually distinguished from the realised
    // (solid) line.
    const accY = accruingApy !== null && accruingApy > 0
      ? PY + (1 - (accruingApy - min) / range) * (H - PY * 2)
      : null

    return { path: pathStr, area: areaStr, labels: lbls, accruingY: accY, dims: { W, H, PX, PY } }
  }, [data, accruingApy])

  if (status === 'loading') {
    return (
      <div className="glass-card rounded-xl sm:rounded-2xl p-4 sm:p-6">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm sm:text-base font-semibold text-white">{t('chart.title') || 'APY Trend'}</h3>
        </div>
        <div className="h-28 sm:h-32 flex items-center justify-center text-slate-500 text-xs">{t('chart.loading') || 'Loading…'}</div>
      </div>
    )
  }

  if (status === 'insufficient') {
    return (
      <div className="glass-card rounded-xl sm:rounded-2xl p-4 sm:p-6">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm sm:text-base font-semibold text-white">{t('chart.title') || 'APY Trend'}</h3>
        </div>
        <div className="h-28 sm:h-32 flex flex-col items-center justify-center text-center px-4">
          <div className="text-slate-400 text-xs sm:text-sm mb-1">
            {t('chart.insufficient') || 'Accruing history — chart returns when 2+ daily snapshots are available.'}
          </div>
          {accruingApy !== null && accruingApy > 0 && (
            <div className="text-cyan-400 text-[11px] sm:text-xs mt-1">
              {(t('chart.accruing') || 'Accruing in Liqwid')}: {accruingApy.toFixed(2)}%
            </div>
          )}
        </div>
      </div>
    )
  }

  const currentApy = data[data.length - 1]?.apy || 0
  // Heuristic: realised APY is "effectively flat" if it's < 0.05% (i.e.,
  // share-price basically hasn't moved across the chart's window). When
  // that's the case AND we have an accruing-in-Liqwid number, show the
  // explanatory note so the user understands the 0% line isn't a bug.
  const realisedFlat = Math.abs(currentApy) < 0.05
  const showFlatNote = realisedFlat && accruingApy !== null && accruingApy > 0

  return (
    <div className="glass-card rounded-xl sm:rounded-2xl p-4 sm:p-6">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm sm:text-base font-semibold text-white">{t('chart.title') || 'APY Trend'}</h3>
        <div className="flex gap-1">
          {(['30', '90'] as const).map(p => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-2 py-0.5 rounded text-[10px] sm:text-xs font-medium transition-colors ${
                period === p ? 'bg-cyan-500/20 text-cyan-400' : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              {p}d
            </button>
          ))}
        </div>
      </div>

      <svg viewBox="0 0 400 120" preserveAspectRatio="none" className="w-full h-28 sm:h-32">
        <defs>
          <linearGradient id="apyGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgb(34 211 238)" stopOpacity="0.3" />
            <stop offset="100%" stopColor="rgb(34 211 238)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {labels.map((l, i) => (
          <g key={i}>
            <line x1="40" y1={l.y} x2="360" y2={l.y} stroke="rgba(148,163,184,0.1)" strokeWidth="0.5" />
            <text x="2" y={l.y + 3} fill="rgba(148,163,184,0.5)" fontSize="8">{l.val}</text>
          </g>
        ))}
        <path d={area} fill="url(#apyGrad)" />
        {/* Accruing-in-Liqwid horizontal reference line (emerald, dashed) */}
        {accruingY !== null && (
          <line
            x1={dims.PX}
            x2={dims.W - dims.PX}
            y1={accruingY}
            y2={accruingY}
            stroke="rgb(52 211 153)"
            strokeWidth="1.5"
            strokeDasharray="3,2"
          />
        )}
        <path d={path} fill="none" stroke="rgb(34 211 238)" strokeWidth="1.5" />
      </svg>

      <div className="flex justify-between items-center mt-1">
        <span className="text-slate-500 text-[10px]">{data[0]?.date}</span>
        <span className="text-cyan-400 text-xs font-medium">
          {(t('chart.realized') || 'Realized')}: {currentApy.toFixed(2)}%
        </span>
        <span className="text-slate-500 text-[10px]">{data[data.length - 1]?.date}</span>
      </div>
      {accruingApy !== null && accruingApy > 0 && (
        <div className="flex justify-center mt-0.5">
          <span className="text-emerald-400 text-[11px] sm:text-xs">
            {(t('chart.accruing') || 'Accruing in Liqwid')}: {accruingApy.toFixed(2)}%
          </span>
        </div>
      )}
      {showFlatNote && (
        <div className="text-slate-500 text-[10px] sm:text-[11px] text-center mt-1 px-2">
          {t('chart.noteFlat') || 'Realized APY moves only when Compound runs. Yield supplied to Liqwid is unrealized until then.'}
        </div>
      )}
    </div>
  )
}
