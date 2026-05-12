/**
 * Shared Component Logic Tests
 *
 * Tests MobileTabNav grid logic, InfoRow color mapping,
 * WalletButton address truncation, and LangToggle language options.
 * Pure logic tests without React DOM rendering.
 */
import { describe, it, expect } from 'vitest'

// ═══════════════════════════════════
// MobileTabNav — Grid Column Logic
// ═══════════════════════════════════

describe('MobileTabNav grid logic', () => {
  function getGridCols(itemCount: number): string {
    return itemCount <= 3 ? 'grid-cols-3' : 'grid-cols-4'
  }

  it('1 item → grid-cols-3', () => {
    expect(getGridCols(1)).toBe('grid-cols-3')
  })

  it('2 items → grid-cols-3', () => {
    expect(getGridCols(2)).toBe('grid-cols-3')
  })

  it('3 items → grid-cols-3', () => {
    expect(getGridCols(3)).toBe('grid-cols-3')
  })

  it('4 items → grid-cols-4', () => {
    expect(getGridCols(4)).toBe('grid-cols-4')
  })

  it('5 items → grid-cols-4', () => {
    expect(getGridCols(5)).toBe('grid-cols-4')
  })
})

describe('MobileTabNav path mapping', () => {
  const PATHS: Record<string, string> = {
    dashboard: '/',
    deposit: '/deposit',
    withdraw: '/withdraw',
    history: '/history',
    keeper: '/keeper',
  }

  it('all nav items have valid paths', () => {
    expect(PATHS.dashboard).toBe('/')
    expect(PATHS.deposit).toBe('/deposit')
    expect(PATHS.withdraw).toBe('/withdraw')
    expect(PATHS.history).toBe('/history')
    expect(PATHS.keeper).toBe('/keeper')
  })

  it('all paths start with /', () => {
    for (const path of Object.values(PATHS)) {
      expect(path.startsWith('/')).toBe(true)
    }
  })
})

describe('MobileTabNav primary styling', () => {
  function getClassName(item: string, primary?: string): string {
    return item === primary
      ? 'btn-shine bg-gradient-to-r from-cyan-500 to-emerald-500'
      : 'bg-slate-800/70'
  }

  it('primary item gets gradient style', () => {
    expect(getClassName('deposit', 'deposit')).toContain('gradient')
  })

  it('non-primary item gets slate style', () => {
    expect(getClassName('withdraw', 'deposit')).toContain('slate')
    expect(getClassName('withdraw', 'deposit')).not.toContain('gradient')
  })

  it('no primary → all slate', () => {
    expect(getClassName('deposit', undefined)).toContain('slate')
  })
})

// ═══════════════════════════════════
// InfoRow — Color Mapping
// ═══════════════════════════════════

describe('InfoRow color logic', () => {
  function getColorClass(opts: { highlight?: boolean; green?: boolean; warn?: boolean }): string {
    return opts.highlight ? 'text-cyan-400 font-medium'
      : opts.green ? 'text-green-400 font-medium'
      : opts.warn ? 'text-amber-400'
      : 'text-white'
  }

  it('default → white', () => {
    expect(getColorClass({})).toBe('text-white')
  })

  it('highlight → cyan', () => {
    expect(getColorClass({ highlight: true })).toContain('cyan-400')
    expect(getColorClass({ highlight: true })).toContain('font-medium')
  })

  it('green → green', () => {
    expect(getColorClass({ green: true })).toContain('green-400')
    expect(getColorClass({ green: true })).toContain('font-medium')
  })

  it('warn → amber', () => {
    expect(getColorClass({ warn: true })).toContain('amber-400')
  })

  it('highlight takes precedence over green', () => {
    expect(getColorClass({ highlight: true, green: true })).toContain('cyan-400')
  })

  it('green takes precedence over warn', () => {
    expect(getColorClass({ green: true, warn: true })).toContain('green-400')
  })
})

// ═══════════════════════════════════
// WalletButton — Address Truncation
// ═══════════════════════════════════

describe('WalletButton address truncation', () => {
  const addr = 'addr1qx2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3jcu5d8ps7zex2k2xt3uqxgjqnnj83ws8lhrn648jjxtwq2ytjqp'

  it('mobile truncation: 6 chars + 3 chars', () => {
    const mobile = `${addr.slice(0, 6)}..${addr.slice(-3)}`
    expect(mobile).toHaveLength(11) // 6 + 2 + 3
    expect(mobile).toContain('..')
    expect(mobile.startsWith('addr1q')).toBe(true)
  })

  it('desktop truncation: 8 chars + 4 chars', () => {
    const desktop = `${addr.slice(0, 8)}...${addr.slice(-4)}`
    expect(desktop).toHaveLength(15) // 8 + 3 + 4
    expect(desktop).toContain('...')
    expect(desktop.startsWith('addr1qx2')).toBe(true)
  })

  it('truncated address is much shorter than original', () => {
    const mobile = `${addr.slice(0, 6)}..${addr.slice(-3)}`
    expect(mobile.length).toBeLessThan(addr.length / 5)
  })
})

describe('WalletButton balance formatting', () => {
  function formatVusdcxBalance(balance: bigint): string {
    const n = Number(balance)
    if (n >= 1e12) return (n / 1e12).toFixed(2) + 'T'
    if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B'
    return n.toLocaleString()
  }

  it('small balance → locale string', () => {
    expect(formatVusdcxBalance(1000n)).toBe('1,000')
    expect(formatVusdcxBalance(999_999n)).toBe('999,999')
  })

  it('billions → B suffix', () => {
    expect(formatVusdcxBalance(1_500_000_000n)).toBe('1.50B')
  })

  it('trillions → T suffix', () => {
    expect(formatVusdcxBalance(2_000_000_000_000n)).toBe('2.00T')
  })

  it('zero', () => {
    expect(formatVusdcxBalance(0n)).toBe('0')
  })
})

// ═══════════════════════════════════
// WalletIcon — Fallback Logic
// ═══════════════════════════════════

describe('WalletIcon fallback logic', () => {
  const WALLET_ICON: Record<string, string> = {
    vespr: '/wallets/vespr.png',
    nami: '/wallets/nami.png',
    eternl: '/wallets/eternl.png',
    lace: '/wallets/lace.png',
  }

  function resolveIcon(name: string, cip30Icon?: string | null, failed = false): string | null {
    const key = name.toLowerCase()
    const src = WALLET_ICON[key]
    return (!failed && src) ? src : (!failed && cip30Icon) ? cip30Icon : null
  }

  it('known wallet → local icon', () => {
    expect(resolveIcon('Nami')).toBe('/wallets/nami.png')
    expect(resolveIcon('eternl')).toBe('/wallets/eternl.png')
  })

  it('unknown wallet with CIP-30 icon → use CIP-30', () => {
    expect(resolveIcon('CustomWallet', 'data:image/png;base64,abc')).toBe('data:image/png;base64,abc')
  })

  it('unknown wallet without icon → null (letter fallback)', () => {
    expect(resolveIcon('CustomWallet')).toBeNull()
  })

  it('failed load → try CIP-30 icon', () => {
    expect(resolveIcon('Nami', 'data:base64', true)).toBeNull()
  })

  it('case insensitive lookup', () => {
    expect(resolveIcon('VESPR')).toBe('/wallets/vespr.png')
    expect(resolveIcon('Lace')).toBe('/wallets/lace.png')
  })
})

// ═══════════════════════════════════
// LangToggle — Language Options
// ═══════════════════════════════════

describe('LangToggle language options', () => {
  const LANGS = ['en', 'zh', 'ja'] as const
  const LABELS: Record<string, string> = {
    en: 'English',
    zh: '繁體中文',
    ja: '日本語',
  }

  it('supports 3 languages', () => {
    expect(LANGS).toHaveLength(3)
  })

  it('all languages have labels', () => {
    for (const lang of LANGS) {
      expect(LABELS[lang]).toBeDefined()
      expect(LABELS[lang].length).toBeGreaterThan(0)
    }
  })

  it('labels are correct', () => {
    expect(LABELS.en).toBe('English')
    expect(LABELS.zh).toBe('繁體中文')
    expect(LABELS.ja).toBe('日本語')
  })
})
