import { useState, useEffect } from 'react'
import { NavLink } from 'react-router-dom'
import { useCardano } from '../hooks/useCardano'
import { ApiStatusBanner, BetaBanner } from '../components/StatusBanners'
import { Skeleton } from '../components/Skeleton'
import { useI18n } from '../i18n'
import CountUp from '../components/CountUp'
import ApyChart from '../components/ApyChart'
import PreAuditCapWidget from '../components/PreAuditCapWidget'
import { formatCompactNumber } from '../utils/formatters'
import { queryMarketSnapshot, type MarketSnapshot } from '../lib/marketQuery'

interface MarketData {
  totalSupply: number
  totalBorrowed: number
  utilization: number
  supplyAPY: number
  borrowAPY: number
  qTokenRate: [number, number]
  djedApy?: number
  blendedApy?: number
  netBlendedApy?: number
}

function snapshotToMarketData(s: MarketSnapshot): MarketData {
  return {
    totalSupply: s.totalSupply,
    totalBorrowed: s.totalBorrowed,
    utilization: s.utilization,
    supplyAPY: s.supplyAPY,
    borrowAPY: s.borrowAPY,
    qTokenRate: s.qTokenRate,
    blendedApy: s.blendedApy,
    netBlendedApy: s.netBlendedApy,
  }
}

function ActionButtons() {
  const { t } = useI18n()
  return (
    <div className="space-y-3">
      {/* Desktop: 2-col horizontal */}
      <div className="hidden md:grid grid-cols-2 gap-5">
        <NavLink to="/deposit" className="btn-shine bg-gradient-to-r from-cyan-500 to-emerald-500 text-white font-semibold py-5 rounded-2xl shadow-lg shadow-cyan-500/20 text-xl text-center flex items-center justify-center gap-3 transition-transform hover:scale-[1.02]">
          <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="17 13 12 18 7 13" /><line x1="12" y1="18" x2="12" y2="6" /></svg>
          {t('nav.deposit')}
        </NavLink>
        <NavLink to="/withdraw" className="bg-slate-800/70 hover:bg-slate-700/70 text-slate-300 hover:text-white font-medium py-5 rounded-2xl border border-slate-700 text-xl transition-all text-center flex items-center justify-center gap-3 hover:scale-[1.02]">
          <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="7 11 12 6 17 11" /><line x1="12" y1="6" x2="12" y2="18" /></svg>
          {t('nav.withdraw')}
        </NavLink>
      </div>
    </div>
  )
}

export default function Dashboard() {
  const { vault, wallet, error } = useCardano()
  const { t } = useI18n()
  const [market, setMarket] = useState<MarketData | null>(null)

  // Direct on-chain Liqwid market query — replaces legacy /api/market.
  // Re-fires whenever vault accounting moves (totalDeposited /
  // liqwidPrincipal / fee), so blendedApy stays in sync with on-chain
  // strategy state without an API server in the loop.
  useEffect(() => {
    if (!vault.exists || vault.totalDeposited === 0) return
    let cancelled = false
    queryMarketSnapshot({
      totalDeposited: vault.totalDeposited,
      liqwidPrincipal: vault.liqwidPrincipal,
      performanceFeeBps: vault.performanceFeeBps,
    })
      .then(snap => {
        if (cancelled) return
        if (snap && snap.exists) setMarket(snapshotToMarketData(snap))
      })
      .catch(() => { /* market UTXO not configured / unavailable */ })
    return () => { cancelled = true }
  }, [vault.exists, vault.totalDeposited, vault.liqwidPrincipal, vault.performanceFeeBps])

  const tvlNode = vault.loaded ? <><CountUp end={Number(vault.totalDeposited) / 1e6} decimals={2} duration={2000} /> USDCx</> : <Skeleton className="inline-block h-6 w-24" />
  // Blended APY: use API netBlendedApy (calculated from on-chain vault allocations + live market APYs)
  const blendedApy = (market?.netBlendedApy && market.netBlendedApy > 0.1) ? market.netBlendedApy : null

  // Phase 2: APY from DJED+USDM blended (not USDCx supply APY)
  const estimatedApy = blendedApy ?? (vault.apyBps > 0 ? vault.apyBps / 100 : 0) * (1 - vault.performanceFeeBps / 10000)
  // Show estimated target APY (deploy not yet automated)
  const apy = estimatedApy > 0
    ? 'Est. ' + estimatedApy.toFixed(2) + '%'
    : 'Pending'
  const apySub = estimatedApy > 0
    ? 'Liqwid diversified strategy'
    : 'Awaiting deployment'
  // If vault is empty (totalShares=0), any vUSDCx in wallet is worthless dust from previous epoch
  const vaultActive = vault.totalShares > 0
  const effectiveVusdcx = vaultActive ? Number(wallet.vusdcxBalance) : 0

  const sharePrice = wallet.connected ? (vault.sharePrice > 0 && vaultActive ? vault.sharePrice.toFixed(6) : '1.000000') : '—'

  // Yield analytics
  const userSharesNum = effectiveVusdcx
  // Value = shares × sharePrice (sharePrice = totalDeposited / totalShares in lovelace)
  const userValueUsdcx = userSharesNum * vault.sharePrice / 1e6
  // Deposited estimate: same formula but using initial sharePrice (1 / initial_share_multiplier)
  // At initial deposit: shares = amount × 1M, so amount = shares / 1M / 1e6
  const userDepositedEstimate = userSharesNum / 1_000_000 / 1e6
  const yieldEarned = userValueUsdcx - userDepositedEstimate

  return (
    <div className="max-w-3xl mx-auto space-y-5 sm:space-y-6">
      <BetaBanner />
      <ApiStatusBanner />

      {vault.loaded && !vault.exists && (
        <div className="glass-card rounded-xl p-6 text-center space-y-3 border border-cyan-500/30">
          <div className="text-4xl">🚀</div>
          <p className="text-cyan-400 font-semibold text-lg">{t('dashboard.comingSoon')}</p>
          <p className="text-slate-400 text-sm">{t('dashboard.comingSoonDesc')}</p>
        </div>
      )}

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm px-4 py-3 rounded-xl">
          {error}
        </div>
      )}

      {/* Pre-audit TVL cap widget — whitepaper §8.1 */}
      <PreAuditCapWidget
        totalDeposited={Number(vault.totalDeposited)}
        frozen={!!vault.frozen}
        loaded={vault.loaded}
      />

      {/* Hero — compact when connected */}
      {wallet.connected ? (
        <div className="flex items-center gap-3 pt-2">
          <div className="flex-1">
            <h1 className="text-lg sm:text-3xl font-bold gradient-text tracking-tight">{t('hero.title')}</h1>
            <p className="text-slate-500 text-[11px] sm:text-sm">{t('hero.subtitle')}</p>
          </div>
          <div className="flex items-center gap-2 sm:gap-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-3 sm:px-4 py-1.5 sm:py-2">
            <img src="/icon.png" alt="" className="w-6 h-6 sm:w-8 sm:h-8" />
            <div className="text-right">
              <p className="text-emerald-400 text-base sm:text-2xl font-bold leading-tight">{apy}</p>
              <p className="text-emerald-400/60 text-[9px] sm:text-xs">{apySub}</p>
            </div>
          </div>
        </div>
      ) : (
        <div className="text-center py-6 sm:py-10">
          <div className="flex items-center justify-center gap-3 mb-3">
            <img src="/icon.png" alt="" className="w-12 h-12 sm:w-14 sm:h-14" />
          </div>
          <h1 className="text-3xl sm:text-5xl font-bold gradient-text mb-2 sm:mb-3 tracking-tight">{t('hero.title')}</h1>
          <p className="text-slate-300 text-sm sm:text-lg font-medium">{t('hero.subtitle')}</p>
          <p className="text-slate-500 text-xs sm:text-sm mt-2 max-w-md mx-auto">{t('hero.desc')}</p>
        </div>
      )}

      {/* ═══ Connected Layout: Position → Yield → Actions → Stats ═══ */}
      {wallet.connected ? (<>

        {/* Your Position + Yield — merged */}
        <div className="glass-card rounded-xl sm:rounded-2xl p-4 sm:p-6 glow-border space-y-3 sm:space-y-4">
          <div className="flex items-center gap-2 sm:gap-3">
            <svg className="w-5 h-5 sm:w-6 sm:h-6 text-cyan-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>
            <h2 className="text-base sm:text-xl md:text-2xl font-bold text-white">{t('dashboard.yourPosition')}</h2>
          </div>

          <div className="space-y-2.5">
            {/* Wallet balance */}
            <div className="flex justify-between items-center text-sm sm:text-base">
              <span className="text-slate-500">{t('dashboard.walletBalance')}</span>
              <span className="text-emerald-400 font-semibold text-lg">{(Number(wallet.usdcxBalance) / 1e6).toFixed(2)}</span>
            </div>

            {/* Vault position */}
            <div className="bg-slate-900/50 rounded-xl p-3 sm:p-4 space-y-2 border border-slate-800/50">
              <div className="flex justify-between text-sm sm:text-base">
                <span className="text-slate-500">{t('dashboard.vaultShares')}</span>
                <span className="text-cyan-400 font-medium">{formatCompactNumber(effectiveVusdcx)} vUSDCx</span>
              </div>
              <div className="flex justify-between text-sm sm:text-base">
                <span className="text-slate-500">{t('dashboard.currentValue')}</span>
                <span className="text-white font-semibold">~{(effectiveVusdcx * vault.sharePrice / 1e6).toFixed(4)} USDCx</span>
              </div>
              {userSharesNum > 0 && yieldEarned > 0 && (
                <div className="border-t border-slate-700/30 pt-2 mt-1 flex justify-between text-sm sm:text-base">
                  <span className="text-slate-500">{t('dashboard.yieldEarned')}</span>
                  <span className="text-emerald-400 font-medium">+{yieldEarned.toFixed(4)} USDCx</span>
                </div>
              )}
              {userSharesNum > 0 && estimatedApy > 0 && (
                <div className="flex justify-between text-sm sm:text-base">
                  <span className="text-slate-500">{t('dashboard.weekly')}</span>
                  <span className="text-cyan-400 font-medium">
                    Est. +{(userValueUsdcx * estimatedApy / 100 / 52).toFixed(4)} USDCx
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Frozen banner */}
        {vault.frozen && (
          <div className="bg-amber-900/30 border border-amber-500/50 rounded-xl px-4 py-3 text-amber-300 text-sm font-medium">
            {t('dashboard.frozen')}
          </div>
        )}

        {/* Action Buttons — visible on first screen */}
        <ActionButtons />

        {/* Stats — stacked */}
        <div className="space-y-2 sm:space-y-3 mt-4 md:mt-6">
          <StatCard icon={<TvlIcon />} label={t('dashboard.tvl')} value={tvlNode} sub="" color="neutral" />
          <div className="grid grid-cols-2 gap-2 sm:gap-3">
            <StatCard icon={<PriceIcon />} label={t('dashboard.sharePrice')} value={sharePrice} sub={t('dashboard.sharePriceSub')} color="cyan" />
            <StatCard icon={<UsersIcon />} label={t('dashboard.depositors')} value={vault.depositorCount || '—'} sub="" color="neutral" />
          </div>
        </div>

      </>) : (<>

        {/* ═══ Not Connected Layout: Stats → CTA → How It Works ═══ */}

        {/* Stats — public highlights */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 md:gap-5">
          <StatCard icon={<TvlIcon />} label={t('dashboard.tvl')} value={tvlNode} sub="" color="neutral" />
          <StatCard icon={<ApyIcon />} label={t('dashboard.apy')} value={apy} sub={apySub} color="emerald" apyHighlight />
        </div>

        {/* Connect CTA */}
        <div className="glass-card rounded-xl sm:rounded-2xl p-5 sm:p-6 text-center glow-border">
          <p className="text-slate-300 text-sm sm:text-base mb-2">{t('dashboard.connectCta')}</p>
          <p className="text-slate-500 text-xs">{t('dashboard.connectCtaDesc')}</p>
        </div>

      </>)}

      {/* APY Trend Chart */}
      <ApyChart />

      {/* Vault Strategy */}
      <div className="glass-card rounded-xl sm:rounded-2xl p-4 sm:p-6 glow-border">
        <div className="flex items-center gap-2 mb-4 sm:mb-5">
          <div className="w-2 h-2 bg-emerald-400 rounded-full pulse-dot" />
          <h2 className="text-base sm:text-lg font-semibold text-white">{t('dashboard.strategy')}</h2>
          <span className="text-[10px] sm:text-xs md:text-sm bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded-full ml-auto">{t('dashboard.conservative')}</span>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-4 md:gap-5">
          <InfoRow label={t('dashboard.protocol')} value={t('dashboard.protocolValue')} icon={<IconProtocol />} />
          <InfoRow label={t('dashboard.asset')} value={t('dashboard.assetValue')} icon={<IconAsset />} />
          <InfoRow label={t('dashboard.perfFee')} value={`${vault.performanceFeeBps / 100}% ${t('dashboard.onYield')}`} icon={<IconFee />} highlight subtitle={t('dashboard.perfFeeNote')} />
          <InfoRow label={t('dashboard.earlyFee')} value={`${vault.earlyWithdrawFeeBps / 100}% ${t('dashboard.earlyFeeNote')}`} icon={<IconTimer />} />
          {/* V1 mainnet plan: 30% buffer / 25% USDM / 45% DJED (whitepaper §2.3). */}
          {/* Display the mainnet-plan value here — Preprod test ceremonies may carry legacy values */}
          {/* but the user-facing strategy data should reflect the V1 mainnet posture. */}
          <InfoRow label={t('dashboard.buffer')} value={`30% ${t('dashboard.idle')}`} icon={<IconShield />} />
          <InfoRow label={t('dashboard.compound')} value={t('dashboard.weekly2')} icon={<IconCompound />} />
        </div>
      </div>

      {/* Governance */}
      <div className="glass-card rounded-xl sm:rounded-2xl p-4 sm:p-6">
        <div className="flex items-center gap-2 mb-4 sm:mb-5">
          <svg className="w-4 h-4 sm:w-5 sm:h-5 text-violet-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path><path d="M9 12l2 2 4-4"></path></svg>
          <h2 className="text-base sm:text-lg font-semibold text-white">{t('governance.title')}</h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
          <InfoRow label={t('governance.model')} value={t('governance.multisig')} icon={<svg className="w-4 h-4 text-violet-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>} />
          <InfoRow label={t('governance.timelock')} value={t('governance.timelockValue')} icon={<svg className="w-4 h-4 text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>} />
          <InfoRow label={t('governance.immutable')} value={t('governance.immutableValue')} icon={<svg className="w-4 h-4 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>} />
          <InfoRow label={t('governance.escape')} value={t('governance.escapeValue')} icon={<svg className="w-4 h-4 text-cyan-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>} />
        </div>
      </div>

      {/* How it Works */}
      <div className="glass-card rounded-xl sm:rounded-2xl p-4 sm:p-6">
        <div className="flex items-center gap-2 sm:gap-3 mb-4 sm:mb-5">
          <svg className="w-5 h-5 sm:w-6 sm:h-6 text-cyan-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
          <h2 className="text-base sm:text-lg font-semibold text-white">{t('dashboard.howItWorks')}</h2>
        </div>
        <div className="relative grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-6">
          {/* Flow line — mobile: vertical, desktop: horizontal */}
          <div className="absolute left-[19px] top-[32px] bottom-[32px] w-px bg-gradient-to-b from-cyan-500/40 via-emerald-500/30 to-cyan-500/40 sm:hidden" />
          <div className="hidden sm:block absolute top-[20px] left-[calc(16.67%+20px)] right-[calc(16.67%+20px)] h-px bg-gradient-to-r from-cyan-500/40 via-emerald-500/30 to-cyan-500/40" />
          <Step num="1" title={t('steps.deposit')} desc={t('steps.depositDesc')} />
          <Step num="2" title={t('steps.earn')} desc={t('steps.earnDesc')} />
          <Step num="3" title={t('steps.withdraw')} desc={t('steps.withdrawDesc')} />
        </div>
      </div>

      {/* Security */}
      <div className="glass-card rounded-xl sm:rounded-2xl p-4 sm:p-6">
        <div className="flex items-center gap-2 sm:gap-3 mb-3 sm:mb-4">
          <svg className="w-5 h-5 sm:w-6 sm:h-6 text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg>
          <h2 className="text-base sm:text-lg font-semibold text-white">{t('dashboard.security')}</h2>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 sm:gap-3">
          <SecurityBadge label={t('security.tests')} desc={t('security.testsDesc')} color="green" />
          <SecurityBadge label={t('security.openSource')} desc={t('security.openSourceDesc')} color="sky" />
          <SecurityBadge label={t('security.noAdminDrain')} desc={t('security.noAdminDrainDesc')} color="indigo" />
          <SecurityBadge label={t('security.escape')} desc={t('security.escapeDesc')} color="amber" />
          <SecurityBadge label={t('security.depeg')} desc={t('security.depegDesc')} color="purple" />
        </div>
      </div>

      {/* FAQ */}
      <div className="glass-card rounded-xl sm:rounded-2xl p-4 sm:p-6">
        <div className="flex items-center gap-2 sm:gap-3 mb-4 sm:mb-5">
          <svg className="w-5 h-5 sm:w-6 sm:h-6 text-cyan-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          <h2 className="text-base sm:text-lg font-semibold text-white">{t('faq.title')}</h2>
        </div>
        <div className="space-y-4">
          <FaqItem q={t('faq.q1')} a={t('faq.a1')} />
          <FaqItem q={t('faq.q2')} a={t('faq.a2')} />
          <FaqItem q={t('faq.q3')} a={t('faq.a3')} />
          <FaqItem q={t('faq.q6')} a={t('faq.a6')} />
          <FaqItem q={t('faq.q7')} a={t('faq.a7')} />
          <FaqItem q={t('faq.q4')} a={t('faq.a4')} />
          <FaqItem q={t('faq.q5')} a={t('faq.a5')} />
          <FaqItem q={t('faq.q8')} a={t('faq.a8')} />
          <FaqItem q={t('faq.q9')} a={t('faq.a9')} />
          <FaqItem q={t('faq.q10')} a={t('faq.a10')} />
          <FaqItem q={t('faq.q11')} a={t('faq.a11')} />
          <FaqItem q={t('faq.q12')} a={t('faq.a12')} />
        </div>
      </div>
    </div>
  )
}

// SVG Icons for stat cards
function TvlIcon() {
  return (
    <svg className="w-5 h-5 sm:w-6 sm:h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    </svg>
  )
}
function ApyIcon() {
  return (
    <svg className="w-5 h-5 sm:w-6 sm:h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" /><polyline points="16 7 22 7 22 13" />
    </svg>
  )
}
function PriceIcon() {
  return (
    <svg className="w-5 h-5 sm:w-6 sm:h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" /><polyline points="17 6 23 6 23 12" />
    </svg>
  )
}
function UsersIcon() {
  return (
    <svg className="w-5 h-5 sm:w-6 sm:h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  )
}

function StatCard({ icon, label, value, sub, color, apyHighlight, blur, className }: { icon?: React.ReactNode; label: string; value: React.ReactNode; sub: React.ReactNode; color: string; apyHighlight?: boolean; blur?: boolean; className?: string }) {
  const c: Record<string, string> = {
    neutral: 'from-slate-700/30 to-slate-800/30 border-white/5 hover:border-white/10',
    emerald: 'from-emerald-500/10 to-emerald-500/5 border-emerald-500/20 hover:border-emerald-500/40',
    cyan: 'from-cyan-500/10 to-cyan-500/5 border-cyan-500/15 hover:border-cyan-500/30',
  }
  return (
    <div className={`stat-card rounded-xl sm:rounded-2xl p-3 sm:p-4 border bg-gradient-to-br min-w-0 ${c[color] || c.neutral} ${className || ''}`}>
      <div className="flex items-center gap-2 mb-2">
        {icon && <div className="text-slate-300/60 flex-shrink-0 [&>svg]:w-4 [&>svg]:h-4 sm:[&>svg]:w-5 sm:[&>svg]:h-5">{icon}</div>}
        <p className="text-slate-300 text-xs sm:text-sm font-medium uppercase tracking-wider truncate leading-none">{label}</p>
      </div>
      <div className={`text-xl sm:text-2xl md:text-3xl leading-tight tracking-tight font-bold text-right truncate ${apyHighlight ? 'text-emerald-400' : blur ? 'text-slate-500' : 'text-white'} ${blur ? 'blur-sm select-none' : ''}`}>{value}</div>
      {sub && <p className={`text-[9px] sm:text-[10px] mt-0.5 text-right truncate ${blur ? 'text-slate-600' : 'text-slate-500'}`}>{sub}</p>}
    </div>
  )
}

function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border border-slate-700/30 rounded-lg overflow-hidden">
      <button onClick={() => setOpen(!open)} className="w-full flex justify-between items-center p-3 sm:p-4 text-left hover:bg-slate-800/30 transition-colors">
        <span className="text-white text-sm sm:text-base font-medium pr-4">{q}</span>
        <span className={`text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`}>▼</span>
      </button>
      {open && <div className="px-3 sm:px-4 pb-3 sm:pb-4 text-slate-400 text-xs sm:text-sm leading-relaxed">{a}</div>}
    </div>
  )
}

// Strategy SVG icons
function IconProtocol() {
  return <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 21h18" /><path d="M5 21V7l7-4 7 4v14" /><path d="M9 21v-4h6v4" /></svg>
}
function IconAsset() {
  return <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="8" /><line x1="12" y1="8" x2="12" y2="16" /><path d="M9 12h6" /></svg>
}
function IconFee() {
  return <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.21 15.89A10 10 0 1 1 8 2.83" /><path d="M22 12A10 10 0 0 0 12 2v10z" /></svg>
}
function IconTimer() {
  return <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="13" r="8" /><path d="M12 9v4l2 2" /><path d="M5 3l2 2" /><path d="M19 3l-2 2" /><line x1="12" y1="1" x2="12" y2="3" /></svg>
}
function IconShield() {
  return <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>
}
function IconCompound() {
  return <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" /><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" /></svg>
}

function InfoRow({ label, value, icon, highlight, subtitle }: { label: string; value: string; icon: React.ReactNode; highlight?: boolean; subtitle?: string }) {
  return (
    <div className="flex items-start gap-2 sm:gap-3 py-2.5 sm:py-3 px-3 sm:px-4 rounded-lg bg-slate-800/50">
      <span className="text-cyan-400/60 mt-0.5 shrink-0">{icon}</span>
      <div className="flex flex-col flex-1 min-w-0 gap-0.5">
        <p className="text-slate-400 text-xs sm:text-sm">{label}</p>
        {subtitle && <p className="text-slate-500 text-[10px] sm:text-xs">{subtitle}</p>}
        <p className={`text-sm sm:text-base font-semibold ${highlight ? 'text-emerald-400' : 'text-white'}`}>{value}</p>
      </div>
    </div>
  )
}

function Step({ num, title, desc }: { num: string; title: string; desc: string }) {
  return (
    <div className="relative flex sm:flex-col items-start sm:items-center gap-3 sm:gap-0 sm:text-center z-10">
      <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-full bg-gradient-to-br from-cyan-500 to-emerald-500 flex items-center justify-center text-white text-sm sm:text-base font-bold shrink-0 sm:mx-auto sm:mb-3 ring-4 ring-slate-900/80">{num}</div>
      <div>
        <h3 className="text-white text-sm sm:text-base font-semibold mb-0.5 sm:mb-1">{title}</h3>
        <p className="text-slate-400 text-xs sm:text-sm">{desc}</p>
      </div>
    </div>
  )
}


function SecurityBadge({ label, desc }: { label: string; desc: string; color: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="col-span-1">
      <button
        onClick={() => setOpen(!open)}
        className="w-full text-center py-2 sm:py-2.5 px-2 sm:px-3 rounded-lg sm:rounded-xl border border-slate-700 bg-slate-800/50 hover:bg-slate-700/50 text-[10px] sm:text-xs font-medium transition-colors cursor-pointer text-slate-300"
      >
        <span className="text-emerald-400 mr-1">&#10003;</span>
        {label}
        <span className="ml-1 text-slate-500">{open ? '−' : '+'}</span>
      </button>
      {open && (
        <p className="text-slate-400 text-[10px] sm:text-xs mt-1.5 px-1 leading-relaxed">{desc}</p>
      )}
    </div>
  )
}
