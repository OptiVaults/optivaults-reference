/**
 * V1 Emergency Withdraw — single-page UI.
 *
 * Sections (all on one page; no router):
 *   1. Header — brand, language toggle, ceremony context, trust strip
 *   2. "Before you start" safety brief (shown until connected)
 *   3. Connect — Blockfrost API key + CIP-30 wallet
 *   4. Vault State — live 29-field VaultDatum + your position
 *   5. Withdraw — partial Withdraw-Zero with deferred-yield quote
 *   6. Layer 3 CommunitySunset — 90d dead-man-switch countdown + trigger
 *   7. Reference — how it works, scope & limits
 *   8. Footer — links + offline-backup guidance
 *
 * Visual style aligns with the v1 frontend (vault.optivaults.app):
 * slate glass cards, cyan→emerald gradient, amber for the Layer 3
 * danger surface. UI primitives (InfoRow / SectionCard / …) and the
 * i18n table are kept local — this page must stay one self-contained
 * bundle so a browser-saved copy is a working offline recovery surface
 * in any of the supported languages.
 *
 * Self-contained: all logic in this file + lib/{config,vault}.ts +
 * i18n.tsx. No router, no cross-package shared components.
 */
import { useEffect, useState, useRef, type ReactNode } from 'react'
import {
  loadV1Config,
  type V1Config,
} from './lib/config'
import {
  initLucid,
  queryVaultState,
  computeWithdrawQuote,
  computeSunsetStatus,
  getUserShares,
  buildWithdrawTx,
  buildSunsetTx,
  type VaultState,
  type SunsetStatus,
} from './lib/vault'
import type { LucidEvolution } from '@lucid-evolution/lucid'
import { useI18n, LANG_NAMES, type Lang } from './i18n'

type Cip30Api = any
type StatusKind = 'info' | 'ok' | 'error'
type StatusMsg = { kind: StatusKind; text: string } | null

const DECIMALS = 6n

function fmtMicro(n: bigint, dec: bigint = DECIMALS): string {
  const neg = n < 0n
  const abs = neg ? -n : n
  const s = abs.toString().padStart(Number(dec) + 1, '0')
  const head = s.slice(0, -Number(dec))
  const tail = s.slice(-Number(dec)).replace(/0+$/, '') || '0'
  return (neg ? '-' : '') + Number(head).toLocaleString() + '.' + tail
}

/** vUSDCx is stored at 1e12 raw per display unit (≈ 1 USDCx of value). */
const SHARE_SCALE = 1_000_000_000_000n

/** Format a raw vUSDCx amount as a human-readable string (up to 6 dp). */
function fmtShares(n: bigint): string {
  const neg = n < 0n
  const abs = neg ? -n : n
  const whole = abs / SHARE_SCALE
  const frac = ((abs % SHARE_SCALE) / 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '')
  return (neg ? '-' : '') + Number(whole).toLocaleString() + (frac ? '.' + frac : '')
}

/** Raw vUSDCx → plain comma-free decimal string, for the input field. */
function rawSharesToInput(n: bigint): string {
  if (n <= 0n) return ''
  const whole = n / SHARE_SCALE
  const frac = (n % SHARE_SCALE).toString().padStart(12, '0').replace(/0+$/, '')
  return whole.toString() + (frac ? '.' + frac : '')
}

/** Parse a human vUSDCx input string → raw bigint. Returns -1n on invalid. */
function parseShares(input: string): bigint {
  const s = input.trim()
  if (!s) return 0n
  if (!/^\d*\.?\d*$/.test(s) || s === '.') return -1n
  const [whole, frac = ''] = s.split('.')
  if (frac.length > 12) return -1n
  try {
    return BigInt(whole || '0') * SHARE_SCALE + BigInt((frac + '000000000000').slice(0, 12))
  } catch {
    return -1n
  }
}

function fmtTime(ms: bigint, never: string): string {
  if (ms <= 0n) return never
  return new Date(Number(ms)).toISOString().replace('T', ' ').slice(0, 19) + ' UTC'
}

function short(s: string): string {
  return s.length > 24 ? `${s.slice(0, 12)}…${s.slice(-6)}` : s
}

function listCardanoWallets(): string[] {
  const w = (window as any).cardano || {}
  return Object.keys(w).filter(
    (k) => w[k] && typeof w[k].enable === 'function' && typeof w[k].name === 'string',
  )
}

function explorerUrl(network: 'mainnet' | 'preprod', txHash: string): string {
  return network === 'preprod'
    ? `https://preprod.cardanoscan.io/transaction/${txHash}`
    : `https://cardanoscan.io/transaction/${txHash}`
}

/**
 * Render a translated string with light inline markup:
 *   `code`   → <code>
 *   *strong* → <strong>
 * Translations carry the markers so every language stays styled.
 */
function renderRich(s: string, codeClass = 'text-cyan-300'): ReactNode {
  return s.split(/(`[^`]+`|\*[^*]+\*)/g).map((part, i) => {
    if (part.length > 1 && part.startsWith('`') && part.endsWith('`')) {
      return (
        <code key={i} className={`font-mono break-words ${codeClass}`}>
          {part.slice(1, -1)}
        </code>
      )
    }
    if (part.length > 1 && part.startsWith('*') && part.endsWith('*')) {
      return (
        <strong key={i} className="text-slate-200">
          {part.slice(1, -1)}
        </strong>
      )
    }
    return part
  })
}

// ─────────────────────────────────────────────────────────────────
// UI primitives — kept local so the page stays a single offline bundle
// ─────────────────────────────────────────────────────────────────

/** Stroke icon. Multiple sub-paths joined with `|`. */
function Svg({ d, className = 'w-5 h-5' }: { d: string; className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {d.split('|').map((seg, i) => (
        <path key={i} d={seg} />
      ))}
    </svg>
  )
}

const ICON = {
  link: 'M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1|M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1',
  vault: 'M5 11h14v10H5z|M8 11V7a4 4 0 0 1 8 0v4',
  download: 'M12 3v12|M7 10l5 5 5-5|M5 21h14',
  alert: 'M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z|M12 9v4|M12 17h.01',
  refresh: 'M21 12a9 9 0 1 1-2.64-6.36|M21 3v6h-6',
  check: 'M20 6 9 17l-5-5',
  external: 'M15 3h6v6|M10 14 21 3|M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6',
  book: 'M4 19.5A2.5 2.5 0 0 1 6.5 17H20|M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z',
  shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
  globe: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z|M2 12h20|M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z',
} as const

function GitHubMark({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
    </svg>
  )
}

/** Language picker — globe button + dropdown (closes on outside click). */
function LangToggle() {
  const { lang, setLang, t } = useI18n()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center justify-center w-9 h-9 rounded-lg border border-slate-700 bg-slate-800/50 text-slate-400 hover:border-cyan-500/40 hover:text-white transition-colors"
        title={t('lang.label')}
        aria-label={t('lang.label')}
      >
        <Svg d={ICON.globe} className="w-[18px] h-[18px]" />
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-36 rounded-xl border border-slate-700 bg-slate-800/95 backdrop-blur-lg shadow-xl overflow-hidden py-1 z-50">
          {(Object.keys(LANG_NAMES) as Lang[]).map((l) => (
            <button
              key={l}
              onClick={() => {
                setLang(l)
                setOpen(false)
              }}
              className={`w-full text-left px-3.5 py-2 text-xs transition-colors ${
                lang === l
                  ? 'bg-cyan-500/20 text-cyan-400 font-semibold'
                  : 'text-slate-300 hover:bg-slate-700/60'
              }`}
            >
              {LANG_NAMES[l]}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

type Tone = 'default' | 'good' | 'warn' | 'bad' | 'accent'
const TONE_TEXT: Record<Tone, string> = {
  default: 'text-slate-100',
  good: 'text-emerald-400',
  warn: 'text-amber-400',
  bad: 'text-red-400',
  accent: 'text-cyan-400',
}

/** Label / value row — mirrors the frontend's InfoRow. */
function InfoRow({
  label,
  value,
  tone = 'default',
  mono = true,
  breakAll = true,
}: {
  label: string
  value: ReactNode
  tone?: Tone
  mono?: boolean
  breakAll?: boolean
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 text-sm">
      <span className="text-slate-400 shrink-0">{label}</span>
      <span
        className={`text-right ${breakAll ? 'break-all' : 'break-words'} ${
          mono ? 'font-mono' : ''
        } ${TONE_TEXT[tone]}`}
      >
        {value}
      </span>
    </div>
  )
}

/** Rounded context badge — Network / Release / Vault. */
function Pill({
  label,
  value,
  tone = 'accent',
}: {
  label: string
  value: string
  tone?: 'accent' | 'good' | 'warn'
}) {
  const dot = { accent: 'bg-cyan-400', good: 'bg-emerald-400', warn: 'bg-amber-400' }[tone]
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-700/70 bg-slate-800/40 px-2.5 py-1 text-xs">
      <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
      <span className="text-slate-500">{label}</span>
      <span className="font-mono text-slate-300">{value}</span>
    </span>
  )
}

/** Glass section with an icon-chip header and optional right-side action. */
function SectionCard({
  title,
  eyebrow,
  iconPath,
  accent = 'cyan',
  action,
  danger,
  id,
  children,
}: {
  title: string
  eyebrow?: string
  iconPath: string
  accent?: 'cyan' | 'emerald' | 'amber' | 'slate'
  action?: ReactNode
  danger?: boolean
  id?: string
  children: ReactNode
}) {
  const text = {
    cyan: 'text-cyan-400',
    emerald: 'text-emerald-400',
    amber: 'text-amber-400',
    slate: 'text-slate-300',
  }[accent]
  const chipBg = {
    cyan: 'bg-cyan-500/10',
    emerald: 'bg-emerald-500/10',
    amber: 'bg-amber-500/10',
    slate: 'bg-slate-500/10',
  }[accent]
  return (
    <section
      id={id}
      className={`glass-card glow-border rounded-2xl sm:rounded-3xl p-5 sm:p-6 md:p-7 space-y-4 sm:space-y-5 ${
        danger ? 'danger' : ''
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <span className={`shrink-0 flex items-center justify-center w-9 h-9 rounded-xl ${chipBg} ${text}`}>
            <Svg d={iconPath} />
          </span>
          <div className="min-w-0">
            {eyebrow && (
              <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500">{eyebrow}</div>
            )}
            <h2 className={`text-base sm:text-lg font-bold ${text}`}>{title}</h2>
          </div>
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      {children}
    </section>
  )
}

/** Inset data panel — the `bg-slate-900/70` sub-block used in the frontend. */
function DataPanel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`bg-slate-900/60 rounded-xl p-4 sm:p-5 ${className}`}>{children}</div>
}

export default function App() {
  const { t } = useI18n()

  // ── Config + connection ──
  const [config, setConfig] = useState<V1Config | null>(null)
  const [configError, setConfigError] = useState<string | null>(null)
  const [bfKey, setBfKey] = useState('')
  const [walletList, setWalletList] = useState<string[]>([])
  const [walletName, setWalletName] = useState('')
  const [lucid, setLucid] = useState<LucidEvolution | null>(null)
  const [walletAddr, setWalletAddr] = useState('')
  const [networkResolved, setNetworkResolved] = useState<'mainnet' | 'preprod' | null>(null)

  // ── Live state ──
  const [vault, setVault] = useState<VaultState | null>(null)
  const [userShares, setUserShares] = useState(0n)
  const [sunset, setSunset] = useState<SunsetStatus | null>(null)

  // ── UI ──
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<StatusMsg>(null)
  const [txHash, setTxHash] = useState('')
  const [sharesInput, setSharesInput] = useState('')
  const [sunsetConfirmOpen, setSunsetConfirmOpen] = useState(false)
  const justConnectedRef = useRef(false)

  // ── Bootstrap: load config + wallet list ──
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const cfg = await loadV1Config()
        if (cancelled) return
        setConfig(cfg)
      } catch (e) {
        setConfigError((e as Error).message)
      }
    })()
    setWalletList(listCardanoWallets())
    return () => {
      cancelled = true
    }
  }, [])

  // After a fresh connect, scroll the vault section into view on mobile.
  useEffect(() => {
    if (!vault || !justConnectedRef.current) return
    justConnectedRef.current = false
    if (typeof window !== 'undefined' && window.innerWidth < 640) {
      document
        .getElementById('vault-section')
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [vault])

  // ── Connect flow ──
  async function handleConnect() {
    setStatus(null)
    if (!config) {
      setStatus({ kind: 'error', text: t('st.noConfig') })
      return
    }
    const key = bfKey.trim()
    let resolvedNet: 'mainnet' | 'preprod' | null = null
    if (key.startsWith('preprod')) resolvedNet = 'preprod'
    else if (key.startsWith('mainnet')) resolvedNet = 'mainnet'
    else {
      setStatus({ kind: 'error', text: t('st.keyPrefix') })
      return
    }
    if (config.network === 'Mainnet' && resolvedNet !== 'mainnet') {
      setStatus({ kind: 'error', text: t('st.netMainnet', { key: resolvedNet }) })
      return
    }
    if (config.network === 'Preprod' && resolvedNet !== 'preprod') {
      setStatus({ kind: 'error', text: t('st.netPreprod', { key: resolvedNet }) })
      return
    }
    if (!walletName) {
      setStatus({ kind: 'error', text: t('st.selectWallet') })
      return
    }
    setBusy(true)
    setStatus({ kind: 'info', text: t('st.connecting') })
    try {
      const apiFn = (window as any).cardano?.[walletName]
      if (!apiFn) throw new Error(t('st.walletNotFound', { name: walletName }))
      const api: Cip30Api = await apiFn.enable()
      const networkId = await api.getNetworkId()
      const expected = resolvedNet === 'mainnet' ? 1 : 0
      if (networkId !== expected) {
        throw new Error(t('st.wrongNetwork', { net: resolvedNet }))
      }
      const ld = await initLucid(key, resolvedNet)
      ld.selectWallet.fromAPI(api)
      const addr = await ld.wallet().address()
      setLucid(ld)
      setWalletAddr(addr)
      setNetworkResolved(resolvedNet)
      justConnectedRef.current = true
      setStatus({ kind: 'ok', text: t('st.connected') })
      await loadOnChainState(ld, resolvedNet)
    } catch (e) {
      setStatus({ kind: 'error', text: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  async function loadOnChainState(ld: LucidEvolution, _net: 'mainnet' | 'preprod') {
    if (!config) return
    setStatus({ kind: 'info', text: t('st.loadingVault') })
    try {
      const [v, s, addr] = await Promise.all([
        queryVaultState(ld, config),
        Promise.resolve(0n).then(() => ld.wallet().address()).then((a) => getUserShares(ld, a, config)),
        ld.wallet().address(),
      ])
      void addr // already stored
      setVault(v)
      setUserShares(s)
      setSunset(computeSunsetStatus(v))
      setStatus({ kind: 'ok', text: t('st.ready') })
    } catch (e) {
      setStatus({ kind: 'error', text: (e as Error).message })
    }
  }

  async function handleRefresh() {
    if (!lucid || !networkResolved) return
    setBusy(true)
    try {
      await loadOnChainState(lucid, networkResolved)
    } finally {
      setBusy(false)
    }
  }

  // ── Withdraw ──
  const sharesParsed = parseShares(sharesInput)
  const sharesValid = sharesParsed > 0n && sharesParsed <= userShares
  const quote = (() => {
    if (!vault || !sharesValid) return null
    try {
      return computeWithdrawQuote(vault, sharesParsed)
    } catch {
      return null
    }
  })()

  function setSharesPct(pct: number) {
    if (!vault) return
    const cap = vault.totalShares - 1n
    const base = userShares > cap ? cap : userShares
    const v = pct >= 100 ? base : (base * BigInt(pct)) / 100n
    setSharesInput(rawSharesToInput(v))
  }

  async function handleWithdraw() {
    if (!lucid || !config || !vault || !networkResolved || !sharesValid) return
    if (!confirm(t('wd.confirmNative', { n: fmtShares(sharesParsed) }))) return
    setBusy(true)
    setTxHash('')
    setStatus({ kind: 'info', text: t('st.buildingWd') })
    try {
      const { cbor, quote: q } = await buildWithdrawTx(lucid, config, vault, sharesParsed, walletAddr)
      setStatus({ kind: 'info', text: t('st.signWallet') })
      const signed = await lucid.fromTx(cbor).sign.withWallet().complete()
      setStatus({ kind: 'info', text: t('st.submitting') })
      const hash = await signed.submit()
      setTxHash(hash)
      setStatus({ kind: 'ok', text: t('st.submitted', { amt: fmtMicro(q.netWithdraw) }) })
      setSharesInput('')
      // Refresh state
      setTimeout(() => loadOnChainState(lucid, networkResolved), 5_000)
    } catch (e) {
      setStatus({ kind: 'error', text: (e as Error).message.slice(0, 400) })
    } finally {
      setBusy(false)
    }
  }

  // ── CommunitySunset ──
  async function handleSunsetTrigger() {
    if (!lucid || !config || !vault || !networkResolved || !sunset) return
    if (!sunset.available) return
    setSunsetConfirmOpen(false)
    setBusy(true)
    setTxHash('')
    setStatus({ kind: 'info', text: t('st.buildingSunset') })
    try {
      const { cbor } = await buildSunsetTx(lucid, config, vault, walletAddr)
      setStatus({ kind: 'info', text: t('st.signWallet') })
      const signed = await lucid.fromTx(cbor).sign.withWallet().complete()
      setStatus({ kind: 'info', text: t('st.submitting') })
      const hash = await signed.submit()
      setTxHash(hash)
      setStatus({ kind: 'ok', text: t('st.sunsetDone') })
      setTimeout(() => loadOnChainState(lucid, networkResolved), 5_000)
    } catch (e) {
      setStatus({ kind: 'error', text: (e as Error).message.slice(0, 400) })
    } finally {
      setBusy(false)
    }
  }

  // ── Render: error / loading gates ──
  if (configError) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="glass-card glow-border rounded-2xl sm:rounded-3xl p-6 sm:p-8 max-w-2xl space-y-4">
          <div className="flex items-center gap-3">
            <span className="flex items-center justify-center w-10 h-10 rounded-xl bg-red-500/10 text-red-400">
              <Svg d={ICON.alert} />
            </span>
            <h1 className="text-xl sm:text-2xl font-bold text-red-400">{t('err.title')}</h1>
          </div>
          <p className="text-slate-300 text-xs sm:text-sm break-all font-mono bg-slate-900/70 p-3 rounded-lg">
            {configError}
          </p>
          <p className="text-slate-400 text-sm leading-relaxed">{renderRich(t('err.body'))}</p>
        </div>
      </div>
    )
  }

  if (!config) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex items-center gap-3 text-slate-400">
          <span className="w-2.5 h-2.5 rounded-full bg-cyan-400 pulse-dot" />
          <span className="animate-pulse">{t('app.loading')}</span>
        </div>
      </div>
    )
  }

  const estValue =
    vault && vault.totalShares > 0n
      ? fmtMicro((userShares * vault.totalDeposited) / vault.totalShares)
      : t('vault.na')

  // ── Render ──
  return (
    <div className="min-h-screen p-4 sm:p-6 md:p-8">
      <div className="max-w-3xl mx-auto space-y-5 sm:space-y-6">

        {/* ── Header ── */}
        <header className="space-y-4 sm:space-y-5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="text-2xl sm:text-3xl shrink-0">🛟</span>
              <div className="leading-tight min-w-0">
                <div className="text-sm font-bold gradient-text">{t('app.brand')}</div>
                <div className="text-[11px] text-slate-500 truncate">{t('app.brandSub')}</div>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <LangToggle />
              <span
                className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium ${
                  lucid
                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                    : 'border-slate-700 bg-slate-800/50 text-slate-400'
                }`}
              >
                <span className={`w-2 h-2 rounded-full ${lucid ? 'bg-emerald-400 pulse-dot' : 'bg-slate-500'}`} />
                <span className="hidden sm:inline">
                  {lucid ? t('app.connected') : t('app.disconnected')}
                </span>
              </span>
            </div>
          </div>

          <div>
            <h1 className="text-3xl sm:text-4xl font-bold gradient-text">{t('app.title')}</h1>
            <p className="text-slate-400 text-sm sm:text-base mt-2 max-w-2xl leading-relaxed">
              {renderRich(t('app.subtitle'))}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Pill
              label={t('app.network')}
              value={config.network}
              tone={config.network === 'Mainnet' ? 'good' : 'accent'}
            />
            <Pill label={t('app.release')} value={config.releaseTag} />
            <Pill label={t('app.vault')} value={short(config.proxyAddr)} />
          </div>

          <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-slate-500">
            {(['keys', 'browser', 'blockfrost', 'nft'] as const).map((k) => (
              <span key={k} className="flex items-center gap-1.5">
                <span className="w-1 h-1 rounded-full bg-emerald-400/70" />
                {t(`trust.${k}`)}
              </span>
            ))}
          </div>
        </header>

        {/* ── Before you start (until connected) ── */}
        {!lucid && (
          <div className="glass-card rounded-2xl p-5 sm:p-6 border-l-4 border-l-amber-500 space-y-3">
            <div className="flex items-center gap-2.5">
              <span className="text-amber-400">
                <Svg d={ICON.alert} className="w-4 h-4" />
              </span>
              <strong className="text-amber-400 text-sm">{t('safety.title')}</strong>
            </div>
            <ul className="space-y-1.5 text-xs sm:text-sm text-slate-400">
              {(['b1', 'b2', 'b3', 'b4', 'b5'] as const).map((k) => (
                <li key={k} className="flex gap-2">
                  <span className="text-amber-500/70 shrink-0">•</span>
                  <span>{renderRich(t(`safety.${k}`))}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* ── Connect ── */}
        {!lucid && (
          <SectionCard
            title={t('connect.title')}
            eyebrow={t('connect.step')}
            iconPath={ICON.link}
            accent="emerald"
          >
            <div className="space-y-2">
              <label className="block text-xs uppercase tracking-wide text-slate-400">
                {t('connect.keyLabel')}
              </label>
              <input
                type="password"
                value={bfKey}
                onChange={(e) => setBfKey(e.target.value)}
                placeholder={t('connect.keyPlaceholder')}
                autoComplete="off"
              />
              <p className="text-xs text-slate-500">
                {t('connect.keyHelp1')}{' '}
                <a
                  href="https://blockfrost.io"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-cyan-400 hover:text-cyan-300 underline"
                >
                  blockfrost.io
                </a>{' '}
                {t('connect.keyHelp2')}
              </p>
            </div>

            <div className="space-y-2">
              <label className="block text-xs uppercase tracking-wide text-slate-400">
                {t('connect.walletLabel')}
              </label>
              <select value={walletName} onChange={(e) => setWalletName(e.target.value)}>
                <option value="">{t('connect.walletSelect')}</option>
                {walletList.map((w) => (
                  <option key={w} value={w}>
                    {w}
                  </option>
                ))}
                {walletList.length === 0 && (
                  <option value="" disabled>
                    {t('connect.walletNone')}
                  </option>
                )}
              </select>
            </div>

            <button
              onClick={handleConnect}
              disabled={busy || !bfKey || !walletName}
              className="btn-shine w-full bg-gradient-to-r from-cyan-500 to-emerald-500 hover:from-cyan-400 hover:to-emerald-400 active:scale-[0.99] disabled:from-slate-600 disabled:to-slate-600 disabled:cursor-not-allowed text-slate-950 font-bold py-3 rounded-xl transition-all shadow-lg shadow-emerald-500/20 disabled:shadow-none"
            >
              {busy ? t('connect.btnBusy') : t('connect.btn')}
            </button>
          </SectionCard>
        )}

        {/* ── Connected summary ── */}
        {lucid && (
          <div className="glass-card rounded-2xl px-5 py-3.5 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 pulse-dot shrink-0" />
              <span className="text-sm text-slate-300 shrink-0">{t('conn.wallet')}</span>
              <span className="font-mono text-xs text-slate-500 truncate">{short(walletAddr)}</span>
            </div>
            <span className="text-xs font-mono text-slate-400 shrink-0">{networkResolved}</span>
          </div>
        )}

        {/* ── Vault load failed (connected but state unreadable) ── */}
        {lucid && !vault && (
          <SectionCard
            title={t('vault.loadFailedTitle')}
            eyebrow={t('vault.eyebrow')}
            iconPath={ICON.alert}
            accent="amber"
          >
            <p className="text-xs sm:text-sm text-slate-400 leading-relaxed">
              {t('vault.loadFailedBody')}
            </p>
            <button
              onClick={handleRefresh}
              disabled={busy}
              className="btn-shine w-full bg-gradient-to-r from-amber-500 to-cyan-500 hover:from-amber-400 hover:to-cyan-400 active:scale-[0.99] disabled:from-slate-600 disabled:to-slate-600 disabled:cursor-not-allowed text-slate-950 font-bold py-3 rounded-xl transition-all"
            >
              {busy ? t('wd.btnBusy') : t('vault.retry')}
            </button>
          </SectionCard>
        )}

        {/* ── Vault State ── */}
        {lucid && vault && (
          <SectionCard
            id="vault-section"
            title={t('vault.title')}
            eyebrow={t('vault.eyebrow')}
            iconPath={ICON.vault}
            accent="cyan"
            action={
              <button
                onClick={handleRefresh}
                disabled={busy}
                className="inline-flex items-center gap-1.5 text-xs text-cyan-400 hover:text-cyan-300 disabled:text-slate-600 transition-colors"
              >
                <Svg d={ICON.refresh} className="w-3.5 h-3.5" />
                {t('vault.refresh')}
              </button>
            }
          >
            {/* Your position — headline */}
            <DataPanel className="border border-emerald-500/20">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-xs uppercase tracking-wide text-slate-500">
                    {t('vault.yourShares')}
                  </div>
                  <div className="font-mono text-lg sm:text-xl mt-0.5">{fmtShares(userShares)}</div>
                </div>
                <div className="text-right">
                  <div className="text-xs uppercase tracking-wide text-slate-500">
                    {t('vault.estValue')}
                  </div>
                  <div className="font-mono text-lg sm:text-xl mt-0.5 text-emerald-400">{estValue}</div>
                </div>
              </div>
            </DataPanel>

            {/* Vault datum */}
            <DataPanel className="space-y-2.5">
              <InfoRow label={t('vault.version')} value={`V${vault.vaultVersion.toString()}`} />
              <InfoRow label={t('vault.totalDeposited')} value={fmtMicro(vault.totalDeposited)} />
              <InfoRow label={t('vault.totalShares')} value={fmtShares(vault.totalShares)} />
              <InfoRow label={t('vault.idleBuffer')} value={fmtMicro(vault.idleBuffer)} />
              <InfoRow label={t('vault.nonDeposit')} value={fmtMicro(vault.nonDepositValue)} />
              <InfoRow
                label={t('vault.earlyFee')}
                value={`${(Number(vault.earlyWithdrawFeeBps) / 100).toFixed(2)}%`}
              />
              <InfoRow
                label={t('vault.frozen')}
                value={vault.frozen === 1n ? t('vault.yes') : t('vault.no')}
                tone={vault.frozen === 1n ? 'warn' : 'good'}
              />
              <InfoRow
                label={t('vault.sunsetFlag')}
                value={vault.communitySunsetTriggered === 1n ? t('vault.sunsetActive') : t('vault.no')}
                tone={vault.communitySunsetTriggered === 1n ? 'warn' : 'good'}
              />
              <InfoRow
                label={t('vault.lastCompound')}
                value={fmtTime(vault.lastCompoundTime, t('vault.never'))}
                breakAll={false}
              />
              <InfoRow
                label={t('vault.lastRealloc')}
                value={fmtTime(vault.lastReallocTime, t('vault.never'))}
                breakAll={false}
              />
            </DataPanel>

            {vault.liqwidPositions.length > 0 && (
              <DataPanel className="space-y-1.5">
                <div className="text-xs uppercase tracking-wide text-slate-500 mb-1">
                  {t('vault.liqwid')}
                </div>
                {vault.liqwidPositions.map((p) => (
                  <div key={p.marketId.toString()} className="font-mono text-xs text-slate-300 break-all">
                    market_id={p.marketId.toString()} · qtokens={p.qtokensHeld.toString()} · supplied=
                    {fmtMicro(p.suppliedValue)}
                  </div>
                ))}
              </DataPanel>
            )}
          </SectionCard>
        )}

        {/* ── Withdraw ── */}
        {lucid && vault && (
          <SectionCard
            title={t('wd.title')}
            eyebrow={t('wd.step')}
            iconPath={ICON.download}
            accent="emerald"
          >
            <div className="space-y-2">
              <p className="text-xs sm:text-sm text-slate-400 leading-relaxed">{t('wd.desc')}</p>
              <details className="group">
                <summary className="text-xs text-slate-500 cursor-pointer hover:text-slate-300 select-none">
                  {t('wd.techToggle')}
                </summary>
                <p className="mt-2 text-xs text-slate-400 leading-relaxed">{renderRich(t('wd.techDetail'))}</p>
              </details>
            </div>

            <div className="space-y-2">
              <div className="flex items-baseline justify-between gap-3">
                <label className="text-xs uppercase tracking-wide text-slate-400">
                  {t('wd.sharesLabel')}
                </label>
                <span className="text-xs text-slate-500">
                  {t('wd.balanceHint', { bal: fmtShares(userShares) })}
                </span>
              </div>
              <input
                type="text"
                inputMode="decimal"
                value={sharesInput}
                onChange={(e) => setSharesInput(e.target.value)}
                placeholder="0.0"
              />
              <div className="grid grid-cols-4 gap-1.5">
                {[25, 50, 75, 100].map((pct) => (
                  <button
                    key={pct}
                    onClick={() => setSharesPct(pct)}
                    className="py-2 text-xs font-bold uppercase tracking-wide rounded-lg border border-slate-700 bg-slate-800/50 text-cyan-400 hover:border-cyan-500/50 hover:bg-slate-800 transition-colors"
                  >
                    {pct === 100 ? t('wd.max') : `${pct}%`}
                  </button>
                ))}
              </div>
              {sharesParsed === -1n && <p className="text-xs text-red-400">{t('wd.invalid')}</p>}
              {sharesParsed > userShares && (
                <p className="text-xs text-red-400">
                  {t('wd.exceeds', { bal: fmtShares(userShares) })}
                </p>
              )}
            </div>

            {quote && (
              <div className="rounded-xl border border-cyan-500/30 bg-cyan-500/5 p-4 space-y-2.5">
                <InfoRow label={t('wd.gross')} value={fmtMicro(quote.baseWithdraw)} />
                <InfoRow
                  label={t('wd.fee')}
                  value={
                    <>
                      {fmtMicro(quote.earlyFee)}
                      {quote.keeperInactive && (
                        <span className="ml-1.5 text-[10px] font-bold uppercase tracking-wide text-emerald-400">
                          {t('wd.waived')}
                        </span>
                      )}
                    </>
                  }
                  tone={quote.keeperInactive ? 'good' : 'warn'}
                />
                <div className="h-px bg-slate-700/60" />
                <div className="flex items-baseline justify-between gap-4">
                  <span className="text-sm font-semibold text-slate-200">{t('wd.receive')}</span>
                  <span className="font-mono text-lg sm:text-xl font-bold text-emerald-400">
                    {fmtMicro(quote.netWithdraw)}
                  </span>
                </div>
              </div>
            )}

            <button
              onClick={handleWithdraw}
              disabled={busy || !sharesValid}
              className="btn-shine w-full bg-gradient-to-r from-cyan-500 to-emerald-500 hover:from-cyan-400 hover:to-emerald-400 active:scale-[0.99] disabled:from-slate-600 disabled:to-slate-600 disabled:cursor-not-allowed text-slate-950 font-bold py-3 rounded-xl transition-all shadow-lg shadow-emerald-500/20 disabled:shadow-none"
            >
              {busy ? t('wd.btnBusy') : !sharesValid ? t('wd.btnEnter') : t('wd.btn')}
            </button>
          </SectionCard>
        )}

        {/* ── Layer 3 CommunitySunset ── */}
        {lucid && vault && sunset && (
          <SectionCard
            title={t('sunset.title')}
            eyebrow={
              sunset.alreadyTriggered
                ? t('sunset.eyeActive')
                : sunset.available
                ? t('sunset.eyeAvail')
                : t('sunset.eyeCountdown')
            }
            iconPath={ICON.alert}
            accent={sunset.available || sunset.alreadyTriggered ? 'amber' : 'slate'}
            danger={sunset.available || sunset.alreadyTriggered}
          >
            <div className="space-y-2">
              <p className="text-xs sm:text-sm text-slate-400 leading-relaxed">
                {renderRich(t('sunset.desc'), 'text-amber-400')}
              </p>
              <details className="group">
                <summary className="text-xs text-slate-500 cursor-pointer hover:text-slate-300 select-none">
                  {t('sunset.techToggle')}
                </summary>
                <p className="mt-2 text-xs text-slate-400 leading-relaxed">
                  {renderRich(t('sunset.techDetail'), 'text-amber-400')}
                </p>
              </details>
            </div>

            {/* Countdown headline */}
            {!sunset.alreadyTriggered && (
              <DataPanel className="text-center">
                <div className="text-xs uppercase tracking-wide text-slate-500">
                  {sunset.available ? t('sunset.cdReached') : t('sunset.cdLabel')}
                </div>
                <div
                  className={`font-mono font-bold mt-1 ${
                    sunset.available ? 'text-2xl text-amber-400' : 'text-4xl text-slate-200'
                  }`}
                >
                  {sunset.available ? t('sunset.availNow') : sunset.daysUntilSunset}
                </div>
              </DataPanel>
            )}

            <DataPanel className="space-y-2.5">
              <InfoRow
                label={t('sunset.lastActivity')}
                value={fmtTime(sunset.lastActivityMs, t('vault.never'))}
                breakAll={false}
              />
              <InfoRow
                label={t('sunset.daysSince')}
                value={sunset.daysSinceActivity >= 0 ? sunset.daysSinceActivity : t('vault.na')}
              />
              <InfoRow label={t('sunset.threshold')} value={t('sunset.thresholdVal')} />
              <InfoRow
                label={t('sunset.daysLeft')}
                value={sunset.daysUntilSunset}
                tone={sunset.daysUntilSunset === 0 ? 'warn' : 'default'}
              />
              <InfoRow
                label={t('sunset.triggered')}
                value={sunset.alreadyTriggered ? t('vault.yes') : t('vault.no')}
                tone={sunset.alreadyTriggered ? 'warn' : 'good'}
              />
              <InfoRow
                label={t('sunset.callerShares')}
                value={fmtShares(userShares)}
                tone={userShares > 0n ? 'good' : 'bad'}
              />
            </DataPanel>

            {sunset.alreadyTriggered ? (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-400 leading-relaxed">
                {renderRich(t('sunset.activeMsg'), 'text-amber-300')}
              </div>
            ) : sunset.available ? (
              !sunsetConfirmOpen ? (
                <button
                  onClick={() => setSunsetConfirmOpen(true)}
                  disabled={busy || userShares <= 0n}
                  className="btn-shine w-full bg-gradient-to-r from-amber-500 to-red-600 hover:from-amber-400 hover:to-red-500 active:scale-[0.99] disabled:from-slate-600 disabled:to-slate-600 disabled:cursor-not-allowed text-white font-bold py-3 rounded-xl transition-all shadow-lg shadow-amber-500/20 disabled:shadow-none"
                >
                  {userShares <= 0n ? t('sunset.btnNeed') : t('sunset.btnTrigger')}
                </button>
              ) : (
                <div className="space-y-3 rounded-xl border-2 border-amber-500/40 bg-amber-500/10 p-4 animate-fadeIn">
                  <div className="text-sm text-amber-300 leading-relaxed">
                    {renderRich(t('sunset.confirm'), 'text-amber-200')}
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={handleSunsetTrigger}
                      disabled={busy}
                      className="flex-1 bg-gradient-to-r from-amber-500 to-red-600 hover:from-amber-400 hover:to-red-500 disabled:from-slate-600 disabled:to-slate-600 text-white font-bold py-3 rounded-lg transition-all"
                    >
                      {busy ? t('wd.btnBusy') : t('sunset.confirmYes')}
                    </button>
                    <button
                      onClick={() => setSunsetConfirmOpen(false)}
                      disabled={busy}
                      className="px-6 py-3 border border-slate-600 hover:border-slate-400 text-slate-300 rounded-lg transition-colors"
                    >
                      {t('sunset.confirmCancel')}
                    </button>
                  </div>
                </div>
              )
            ) : (
              <div className="rounded-xl border border-slate-700 bg-slate-900/50 p-4 text-sm text-slate-400">
                {t('sunset.notYet')}
                {sunset.daysUntilSunset > 0 && ` ${t('sunset.daysRemain', { n: sunset.daysUntilSunset })}`}
              </div>
            )}
          </SectionCard>
        )}

        {/* ── Status + tx ── */}
        {status && (
          <div
            className={`rounded-xl p-3.5 text-sm break-all flex items-start gap-2.5 ${
              status.kind === 'error'
                ? 'bg-red-500/10 border border-red-500/30 text-red-400'
                : status.kind === 'ok'
                ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-400'
                : 'bg-cyan-500/10 border border-cyan-500/30 text-cyan-400'
            }`}
          >
            <span className="shrink-0 mt-0.5">
              {status.kind === 'ok' ? (
                <Svg d={ICON.check} className="w-4 h-4" />
              ) : status.kind === 'error' ? (
                <Svg d={ICON.alert} className="w-4 h-4" />
              ) : (
                <span className="block w-3 h-3 rounded-full bg-cyan-400 pulse-dot mt-0.5" />
              )}
            </span>
            <span>{status.text}</span>
          </div>
        )}

        {txHash && networkResolved && (
          <a
            href={explorerUrl(networkResolved, txHash)}
            target="_blank"
            rel="noopener noreferrer"
            className="glass-card rounded-xl p-3.5 flex items-center justify-between gap-3 hover:border-cyan-500/30 transition-colors"
          >
            <span className="flex items-center gap-2 text-sm text-cyan-400">
              <Svg d={ICON.external} className="w-4 h-4" />
              {t('tx.view')}
            </span>
            <span className="font-mono text-xs text-slate-500 truncate">{short(txHash)}</span>
          </a>
        )}

        {/* ── Reference: how it works ── */}
        <SectionCard
          title={t('how.title')}
          eyebrow={t('how.eyebrow')}
          iconPath={ICON.book}
          accent="slate"
        >
          <ol className="space-y-2.5">
            {(['s1', 's2', 's3', 's4', 's5', 's6'] as const).map((k, i) => (
              <li key={k} className="flex gap-3 text-xs sm:text-sm text-slate-400">
                <span className="shrink-0 flex items-center justify-center w-5 h-5 rounded-md bg-slate-700/60 text-slate-300 text-[11px] font-bold">
                  {i + 1}
                </span>
                <span className="leading-relaxed">{t(`how.${k}`)}</span>
              </li>
            ))}
          </ol>
        </SectionCard>

        {/* ── Reference: scope & limits ── */}
        <SectionCard
          title={t('scope.title')}
          eyebrow={t('scope.eyebrow')}
          iconPath={ICON.shield}
          accent="slate"
        >
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <div className="text-xs font-bold uppercase tracking-wide text-emerald-400">
                {t('scope.doesTitle')}
              </div>
              <ul className="space-y-1.5 text-xs sm:text-sm text-slate-400">
                {(['d1', 'd2', 'd3'] as const).map((k) => (
                  <li key={k} className="flex gap-2">
                    <span className="text-emerald-400 shrink-0">✓</span>
                    <span>{t(`scope.${k}`)}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="space-y-2">
              <div className="text-xs font-bold uppercase tracking-wide text-slate-500">
                {t('scope.notTitle')}
              </div>
              <ul className="space-y-1.5 text-xs sm:text-sm text-slate-400">
                {(['n1', 'n2', 'n3', 'n4'] as const).map((k) => (
                  <li key={k} className="flex gap-2">
                    <span className="text-slate-600 shrink-0">✗</span>
                    <span>{t(`scope.${k}`)}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </SectionCard>

        {/* ── Footer ── */}
        <footer className="pt-2 space-y-5">
          <div className="glass-card rounded-2xl p-5 sm:p-6 space-y-2.5 border-l-4 border-l-cyan-500/40">
            <div className="flex items-center gap-2 text-sm font-bold text-cyan-400">
              <Svg d={ICON.shield} className="w-4 h-4" />
              {t('footer.backupTitle')}
            </div>
            <p className="text-xs sm:text-sm text-slate-400 leading-relaxed">
              {renderRich(t('footer.backup'))}
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs">
            <a
              href="https://github.com/OptiVaults/optivaults-reference"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-slate-400 hover:text-white transition-colors"
            >
              <GitHubMark />
              {t('footer.source')}
            </a>
            <a
              href="https://github.com/OptiVaults/optivaults-protocol/blob/v1/whitepaper/whitepaper.md"
              target="_blank"
              rel="noopener noreferrer"
              className="text-slate-400 hover:text-cyan-400 transition-colors"
            >
              {t('footer.whitepaper')}
            </a>
            <a
              href="https://github.com/OptiVaults/optivaults-reference/blob/v1/SECURITY.md"
              target="_blank"
              rel="noopener noreferrer"
              className="text-slate-400 hover:text-cyan-400 transition-colors"
            >
              {t('footer.security')}
            </a>
            <a
              href="https://optivaults.app"
              target="_blank"
              rel="noopener noreferrer"
              className="text-slate-400 hover:text-cyan-400 transition-colors"
            >
              optivaults.app
            </a>
          </div>

          <div className="text-center text-[11px] text-slate-600">
            {t('footer.meta', { net: config.network, rel: config.releaseTag })}
          </div>
        </footer>
      </div>
    </div>
  )
}
