/**
 * Deposit Page Logic Tests
 *
 * Tests deposit validation, share estimation, canDeposit logic,
 * order fallback detection, and input handling.
 */
import { describe, it, expect } from 'vitest'

// ═══════════════════════════════════
// canDeposit Validation (Full)
// ═══════════════════════════════════

describe('canDeposit validation', () => {
  interface DepositState {
    depositDisabled: boolean
    connected: boolean
    usdcxAmount: number
    minDeposit: number
    insufficientBalance: boolean
    loading: boolean
    networkMismatch: boolean
  }

  function canDeposit(s: DepositState): boolean {
    return !s.depositDisabled && s.connected && s.usdcxAmount >= s.minDeposit
      && !s.insufficientBalance && !s.loading && !s.networkMismatch
  }

  const base: DepositState = {
    depositDisabled: false, connected: true, usdcxAmount: 100,
    minDeposit: 10, insufficientBalance: false, loading: false, networkMismatch: false,
  }

  it('valid state returns true', () => {
    expect(canDeposit(base)).toBe(true)
  })

  it('deposit disabled returns false', () => {
    expect(canDeposit({ ...base, depositDisabled: true })).toBe(false)
  })

  it('disconnected returns false', () => {
    expect(canDeposit({ ...base, connected: false })).toBe(false)
  })

  it('below minimum returns false', () => {
    expect(canDeposit({ ...base, usdcxAmount: 5 })).toBe(false)
  })

  it('exact minimum returns true', () => {
    expect(canDeposit({ ...base, usdcxAmount: 10 })).toBe(true)
  })

  it('insufficient balance returns false', () => {
    expect(canDeposit({ ...base, insufficientBalance: true })).toBe(false)
  })

  it('loading returns false', () => {
    expect(canDeposit({ ...base, loading: true })).toBe(false)
  })

  it('network mismatch returns false', () => {
    expect(canDeposit({ ...base, networkMismatch: true })).toBe(false)
  })

  it('zero amount returns false', () => {
    expect(canDeposit({ ...base, usdcxAmount: 0 })).toBe(false)
  })
})

// ═══════════════════════════════════
// Insufficient Balance Detection (Integer)
// ═══════════════════════════════════

describe('Insufficient balance detection', () => {
  function isInsufficient(connected: boolean, usdcxAmount: number, walletBalance: bigint): boolean {
    return connected && usdcxAmount > 0 && Math.floor(usdcxAmount * 1e6) > Number(walletBalance)
  }

  it('sufficient balance', () => {
    expect(isInsufficient(true, 10, 50_000_000n)).toBe(false)
  })

  it('exact balance', () => {
    expect(isInsufficient(true, 50, 50_000_000n)).toBe(false)
  })

  it('insufficient by 1 unit', () => {
    // 22.84 USDCx = 22_840_000 units, balance = 22_839_999
    expect(isInsufficient(true, 22.84, 22_839_999n)).toBe(true)
  })

  it('zero amount: not insufficient', () => {
    expect(isInsufficient(true, 0, 50_000_000n)).toBe(false)
  })

  it('disconnected: not insufficient', () => {
    expect(isInsufficient(false, 100, 0n)).toBe(false)
  })

  it('zero balance: insufficient for any positive amount', () => {
    expect(isInsufficient(true, 10, 0n)).toBe(true)
  })
})

// ═══════════════════════════════════
// Share Estimation (Deposit Preview)
// ═══════════════════════════════════

describe('Share estimation', () => {
  function estimateShares(usdcxAmount: number, totalDeposited: number, totalShares: number): number {
    if (totalShares === 0) return usdcxAmount * 1_000_000
    if (totalDeposited > 0) return (usdcxAmount * 1e6 * totalShares) / totalDeposited
    return usdcxAmount * 1_000_000
  }

  it('first depositor: 1M multiplier', () => {
    expect(estimateShares(100, 0, 0)).toBe(100_000_000)
  })

  it('proportional shares', () => {
    expect(estimateShares(50, 100_000_000, 100_000_000_000_000)).toBe(50_000_000_000_000)
  })

  it('with yield: fewer shares', () => {
    // 110M deposited, 100T shares
    const shares = estimateShares(10, 110_000_000, 100_000_000_000_000)
    expect(shares).toBeLessThan(10_000_000_000_000)
    expect(shares).toBeGreaterThan(9_000_000_000_000)
  })

  it('zero amount: zero shares', () => {
    expect(estimateShares(0, 100_000_000, 100_000_000_000_000)).toBe(0)
  })

  it('totalDeposited = 0 but totalShares > 0: fallback to 1M multiplier', () => {
    // Edge case: shouldn't happen on-chain but defensive
    expect(estimateShares(10, 0, 100)).toBe(10_000_000)
  })
})

// ═══════════════════════════════════
// Min Deposit by Coin Type
// ═══════════════════════════════════

describe('Min deposit thresholds', () => {
  function getMinDeposit(coin: string): number {
    if (coin === 'ada') return 50
    return 10 // USDCx default
  }

  it('USDCx min = 10', () => {
    expect(getMinDeposit('usdcx')).toBe(10)
  })

  it('ADA min = 50', () => {
    expect(getMinDeposit('ada')).toBe(50)
  })

  it('unknown coin defaults to 10', () => {
    expect(getMinDeposit('djed')).toBe(10)
  })
})

// ═══════════════════════════════════
// Wallet Balance Display
// ═══════════════════════════════════

describe('Wallet balance display', () => {
  it('converts bigint lovelace to display', () => {
    const balance = Number(50_000_000n) / 1e6
    expect(balance).toBe(50)
  })

  it('handles zero', () => {
    const balance = Number(0n) / 1e6
    expect(balance).toBe(0)
  })

  it('6 decimal precision', () => {
    const balance = Number(22_839_999n) / 1e6
    expect(balance.toFixed(6)).toBe('22.839999')
  })

  it('large balance', () => {
    const balance = Number(1_000_000_000_000n) / 1e6
    expect(balance).toBe(1_000_000) // 1M USDCx
  })
})

// ═══════════════════════════════════
// Percentage Button Logic
// ═══════════════════════════════════

describe('Percentage buttons', () => {
  const balance = 100.5

  it('25% of balance', () => {
    expect((balance * 0.25).toFixed(6)).toBe('25.125000')
  })

  it('50% of balance', () => {
    expect((balance * 0.5).toFixed(6)).toBe('50.250000')
  })

  it('75% of balance', () => {
    expect((balance * 0.75).toFixed(6)).toBe('75.375000')
  })

  it('MAX (100%) of balance', () => {
    expect((balance * 1).toFixed(6)).toBe('100.500000')
  })

  it('zero balance: empty string', () => {
    const bal = 0
    const maxBal = Math.max(0, bal)
    const result = maxBal > 0 ? (maxBal * 0.5).toFixed(6) : ''
    expect(result).toBe('')
  })
})

// ═══════════════════════════════════
// Input Sanitization
// ═══════════════════════════════════

describe('Input sanitization', () => {
  function sanitize(raw: string): string {
    return raw.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1')
  }

  it('strips letters', () => expect(sanitize('12.34abc')).toBe('12.34'))
  it('strips special chars', () => expect(sanitize('$100!')).toBe('100'))
  it('prevents multiple dots', () => expect(sanitize('12.34.56')).toBe('12.3456'))
  it('allows plain integer', () => expect(sanitize('100')).toBe('100'))
  it('allows leading dot', () => expect(sanitize('.5')).toBe('.5'))
  it('strips negative sign', () => expect(sanitize('-50')).toBe('50'))
  it('strips scientific notation', () => expect(sanitize('1e5')).toBe('15'))
  it('empty string stays empty', () => expect(sanitize('')).toBe(''))
})

// ═══════════════════════════════════
// Order Fallback (Contention) Detection
// ═══════════════════════════════════

describe('Order fallback detection', () => {
  function shouldShowFallback(errMsg: string): boolean {
    return errMsg.includes('contention') || errMsg.includes('already spent') || errMsg.includes('CollateralNotFound')
  }

  it('contention triggers fallback', () => {
    expect(shouldShowFallback('UTXO contention: vault busy')).toBe(true)
  })

  it('already spent triggers fallback', () => {
    expect(shouldShowFallback('Input already spent')).toBe(true)
  })

  it('CollateralNotFound triggers fallback', () => {
    expect(shouldShowFallback('CollateralNotFound')).toBe(true)
  })

  it('generic error: no fallback', () => {
    expect(shouldShowFallback('Insufficient funds')).toBe(false)
  })

  it('user rejected: no fallback', () => {
    expect(shouldShowFallback('user declined to sign')).toBe(false)
  })
})

// ═══════════════════════════════════
// Deposit Button Text Logic
// ═══════════════════════════════════

describe('Deposit button text', () => {
  function buttonText(p: {
    loading: boolean; networkMismatch: boolean; connected: boolean;
    insufficientBalance: boolean; usdcxAmount: number; minDeposit: number
  }): string {
    if (p.loading) return 'Processing...'
    if (p.networkMismatch) return 'Network Mismatch'
    if (!p.connected) return 'Connect Wallet First'
    if (p.insufficientBalance) return 'Insufficient Balance'
    if (p.usdcxAmount < p.minDeposit) return `Enter Amount (min ${p.minDeposit})`
    return 'Deposit'
  }

  it('loading state', () => {
    expect(buttonText({ loading: true, networkMismatch: false, connected: true, insufficientBalance: false, usdcxAmount: 100, minDeposit: 10 })).toBe('Processing...')
  })

  it('network mismatch', () => {
    expect(buttonText({ loading: false, networkMismatch: true, connected: true, insufficientBalance: false, usdcxAmount: 100, minDeposit: 10 })).toBe('Network Mismatch')
  })

  it('not connected', () => {
    expect(buttonText({ loading: false, networkMismatch: false, connected: false, insufficientBalance: false, usdcxAmount: 100, minDeposit: 10 })).toBe('Connect Wallet First')
  })

  it('insufficient balance', () => {
    expect(buttonText({ loading: false, networkMismatch: false, connected: true, insufficientBalance: true, usdcxAmount: 100, minDeposit: 10 })).toBe('Insufficient Balance')
  })

  it('below min deposit', () => {
    expect(buttonText({ loading: false, networkMismatch: false, connected: true, insufficientBalance: false, usdcxAmount: 5, minDeposit: 10 })).toBe('Enter Amount (min 10)')
  })

  it('valid state', () => {
    expect(buttonText({ loading: false, networkMismatch: false, connected: true, insufficientBalance: false, usdcxAmount: 100, minDeposit: 10 })).toBe('Deposit')
  })
})
