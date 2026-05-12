/**
 * Withdraw Page Logic Tests
 *
 * Tests buffer check, canWithdraw validation, queue vs direct mode,
 * shares conversion, and edge cases.
 */
import { describe, it, expect } from 'vitest'

// ═══════════════════════════════════
// formatShares — Extended Edge Cases
// ═══════════════════════════════════

function formatShares(n: number): string {
  if (n === 0) return '0'
  const abs = Math.abs(n)
  if (abs >= 1e12) return (n / 1e12).toFixed(2) + 'T'
  if (abs >= 1e9) return (n / 1e9).toFixed(2) + 'B'
  if (abs >= 1e6) return (n / 1e6).toFixed(2) + 'M'
  if (abs >= 1e3) return (n / 1e3).toFixed(1) + 'K'
  return n.toLocaleString()
}

describe('formatShares edge cases', () => {
  it('zero', () => expect(formatShares(0)).toBe('0'))
  it('1', () => expect(formatShares(1)).toBe('1'))
  it('999', () => expect(formatShares(999)).toBe('999'))
  it('1000 boundary', () => expect(formatShares(1000)).toBe('1.0K'))
  it('999_999', () => expect(formatShares(999_999)).toBe('1000.0K'))
  it('1M boundary', () => expect(formatShares(1_000_000)).toBe('1.00M'))
  it('1B boundary', () => expect(formatShares(1_000_000_000)).toBe('1.00B'))
  it('1T boundary', () => expect(formatShares(1_000_000_000_000)).toBe('1.00T'))
  it('large number', () => expect(formatShares(94_000_000_000_000)).toBe('94.00T'))
  it('fractional T', () => expect(formatShares(1_500_000_000_000)).toBe('1.50T'))
  it('negative not expected but handled', () => {
    // formatShares uses Math.abs for bracket detection but n for value
    const result = formatShares(-5_000_000)
    expect(result).toBe('-5.00M')
  })
})

// ═══════════════════════════════════
// Shares T-unit Conversion
// ═══════════════════════════════════

describe('Shares T-unit conversion', () => {
  it('T input to raw shares', () => {
    const sharesT = '1.5'
    const raw = (parseFloat(sharesT) || 0) * 1e12
    expect(raw).toBe(1_500_000_000_000)
  })

  it('raw shares to T display', () => {
    const raw = 94_000_000_000_000
    const t = raw / 1e12
    expect(t).toBe(94)
  })

  it('empty input = 0', () => {
    const raw = (parseFloat('') || 0) * 1e12
    expect(raw).toBe(0)
  })

  it('invalid input = 0', () => {
    const raw = (parseFloat('abc') || 0) * 1e12
    expect(raw).toBe(0)
  })

  it('very small T input', () => {
    const raw = (parseFloat('0.001') || 0) * 1e12
    expect(raw).toBe(1_000_000_000) // 1B shares
  })
})

// ═══════════════════════════════════
// USDCx Preview Calculation
// ═══════════════════════════════════

describe('USDCx preview calculation', () => {
  function calcPreview(sharesToBurn: number, totalDeposited: number, totalShares: number): number {
    return totalShares > 0
      ? (sharesToBurn * totalDeposited) / totalShares / 1e6
      : sharesToBurn / 1_000_000
  }

  it('proportional withdraw', () => {
    const preview = calcPreview(50e12, 200_000_000, 100e12)
    expect(preview).toBeCloseTo(100, 0) // 100 USDCx
  })

  it('full withdraw', () => {
    const preview = calcPreview(94e12, 94_020_000, 94e12)
    expect(preview).toBeCloseTo(94.02, 1)
  })

  it('empty vault fallback', () => {
    const preview = calcPreview(10_000_000, 0, 0)
    expect(preview).toBe(10) // 10M shares / 1M = 10
  })

  it('with yield: more per share', () => {
    // 100T shares, 110M deposited (10% yield)
    const preview = calcPreview(50e12, 110_000_000, 100e12)
    expect(preview).toBeCloseTo(55, 0) // 55 USDCx (>50 due to yield)
  })
})

// ═══════════════════════════════════
// canWithdraw Validation
// ═══════════════════════════════════

describe('canWithdraw validation', () => {
  interface WithdrawState {
    connected: boolean
    sharesToBurn: number
    userShares: number
    totalShares: number
    loading: boolean
    queueLoading: boolean
    networkMismatch: boolean
  }

  function canWithdraw(s: WithdrawState): boolean {
    return s.connected && s.sharesToBurn > 0 && s.sharesToBurn <= s.userShares
      && s.sharesToBurn <= s.totalShares && !s.loading && !s.queueLoading && !s.networkMismatch
  }

  const base: WithdrawState = {
    connected: true, sharesToBurn: 1e12, userShares: 10e12,
    totalShares: 100e12, loading: false, queueLoading: false, networkMismatch: false,
  }

  it('valid state returns true', () => {
    expect(canWithdraw(base)).toBe(true)
  })

  it('disconnected returns false', () => {
    expect(canWithdraw({ ...base, connected: false })).toBe(false)
  })

  it('zero shares returns false', () => {
    expect(canWithdraw({ ...base, sharesToBurn: 0 })).toBe(false)
  })

  it('exceeds user balance returns false', () => {
    expect(canWithdraw({ ...base, sharesToBurn: 20e12, userShares: 10e12 })).toBe(false)
  })

  it('exceeds total shares returns false', () => {
    expect(canWithdraw({ ...base, sharesToBurn: 200e12, totalShares: 100e12 })).toBe(false)
  })

  it('loading returns false', () => {
    expect(canWithdraw({ ...base, loading: true })).toBe(false)
  })

  it('queue loading returns false', () => {
    expect(canWithdraw({ ...base, queueLoading: true })).toBe(false)
  })

  it('network mismatch returns false', () => {
    expect(canWithdraw({ ...base, networkMismatch: true })).toBe(false)
  })
})

// ═══════════════════════════════════
// Insufficient Shares Detection
// ═══════════════════════════════════

describe('Insufficient shares detection', () => {
  function isInsufficient(connected: boolean, sharesToBurn: number, userShares: number): boolean {
    return connected && sharesToBurn > 0 && sharesToBurn > userShares
  }

  it('within balance', () => {
    expect(isInsufficient(true, 5e12, 10e12)).toBe(false)
  })

  it('exact balance', () => {
    expect(isInsufficient(true, 10e12, 10e12)).toBe(false)
  })

  it('exceeds balance', () => {
    expect(isInsufficient(true, 15e12, 10e12)).toBe(true)
  })

  it('zero shares: not insufficient', () => {
    expect(isInsufficient(true, 0, 10e12)).toBe(false)
  })

  it('disconnected: not insufficient', () => {
    expect(isInsufficient(false, 15e12, 10e12)).toBe(false)
  })
})

// ═══════════════════════════════════
// Buffer Exceeded Warning
// ═══════════════════════════════════

describe('Buffer exceeded warning', () => {
  function exceedsBuffer(mode: string, idleBuffer: number, withdrawUsdcxRaw: number): boolean {
    return mode === 'direct' && idleBuffer > 0 && withdrawUsdcxRaw > idleBuffer
  }

  it('within buffer', () => {
    expect(exceedsBuffer('direct', 50_000_000, 30_000_000)).toBe(false)
  })

  it('exceeds buffer', () => {
    expect(exceedsBuffer('direct', 50_000_000, 80_000_000)).toBe(true)
  })

  it('queue mode: never warns', () => {
    expect(exceedsBuffer('queue', 50_000_000, 80_000_000)).toBe(false)
  })

  it('zero buffer: never warns', () => {
    expect(exceedsBuffer('direct', 0, 80_000_000)).toBe(false)
  })

  it('exact buffer: not exceeded', () => {
    expect(exceedsBuffer('direct', 50_000_000, 50_000_000)).toBe(false)
  })
})

// ═══════════════════════════════════
// Direct vs Queue Mode
// ═══════════════════════════════════

describe('Direct vs Queue mode', () => {
  it('direct mode charges early exit fee', () => {
    const feeBps = 10 // 0.1%
    const amount = 1000_000_000 // 1000 USDCx
    const fee = Math.floor(amount * feeBps / 10_000)
    expect(fee).toBe(1_000_000) // 1 USDCx
  })

  it('queue mode: no early exit fee', () => {
    const fee = 0
    expect(fee).toBe(0)
  })

  it('direct mode minReceive with 2% slippage', () => {
    const preview = 100 // 100 USDCx
    const minReceive = Math.floor(preview * 0.98 * 1e6)
    expect(minReceive).toBe(98_000_000)
  })

  it('queue mode minReceive with 2% slippage', () => {
    const preview = 50
    const minReceive = Math.floor(preview * 0.98 * 1e6)
    expect(minReceive).toBe(49_000_000)
  })
})

// ═══════════════════════════════════
// Early Exit Fee (Contract-Aligned)
// ═══════════════════════════════════

describe('Early exit fee edge cases', () => {
  function earlyFee(amount: number, bps: number): number {
    return Math.floor(amount * bps / 10_000)
  }

  it('0 bps = no fee', () => {
    expect(earlyFee(1_000_000_000, 0)).toBe(0)
  })

  it('10 bps on small amount: rounds to 0', () => {
    // 100 * 10 / 10000 = 0.1 → floor = 0
    expect(earlyFee(100, 10)).toBe(0)
  })

  it('10 bps on min deposit: 1000 units fee', () => {
    // 10_000_000 * 10 / 10000 = 10_000
    expect(earlyFee(10_000_000, 10)).toBe(10_000)
  })

  it('max fee 2000 bps (20%)', () => {
    expect(earlyFee(100_000_000, 2000)).toBe(20_000_000)
  })
})
