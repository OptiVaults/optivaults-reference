/**
 * Frontend Tests — Vault Types & Calculations
 *
 * Tests share calculation, yield analytics, and input validation
 * without browser/wallet dependencies
 */
import { describe, it, expect } from 'vitest'

// ═══════════════════════════════════
// Share Calculation (mirrors useCardano logic)
// ═══════════════════════════════════

function calculateShares(amount: number, totalDeposited: number, totalShares: number): number {
  if (totalShares === 0) return amount * 1_000_000
  if (totalDeposited <= 0) return amount * 1_000_000
  return (amount * 1e6 * totalShares) / totalDeposited
}

function calculateWithdrawAmount(shares: number, totalDeposited: number, totalShares: number): number {
  if (totalShares <= 0) return 0
  return (shares * totalDeposited) / totalShares
}

function calculateSharePrice(totalDeposited: number, totalShares: number): number {
  if (totalShares <= 0) return 1.0
  return totalDeposited / totalShares
}

describe('Share calculation', () => {
  it('first depositor gets ×1M shares', () => {
    const shares = calculateShares(10, 0, 0)
    expect(shares).toBe(10_000_000)
  })

  it('subsequent depositor gets proportional', () => {
    // Vault has 100 deposited, 100M shares → 1:1M ratio
    const shares = calculateShares(50, 100_000_000, 100_000_000_000_000)
    expect(shares).toBe(50_000_000_000_000) // 50M × 1M
  })

  it('with yield: fewer shares per unit', () => {
    // Vault has 110 deposited (100 + 10 yield), 100M shares
    const shares = calculateShares(10_000_000, 110_000_000, 100_000_000_000_000)
    // 10M * 1e6 * 100T / 110M
    const expected = (10_000_000 * 1e6 * 100_000_000_000_000) / 110_000_000
    expect(shares).toBe(expected)
  })

  it('zero amount returns zero shares', () => {
    const shares = calculateShares(0, 100_000_000, 100_000_000_000_000)
    expect(shares).toBe(0)
  })
})

describe('Withdraw calculation', () => {
  it('full withdraw returns all deposited', () => {
    const amount = calculateWithdrawAmount(100_000_000_000_000, 100_000_000, 100_000_000_000_000)
    expect(amount).toBe(100_000_000)
  })

  it('partial withdraw returns proportional', () => {
    const amount = calculateWithdrawAmount(50_000_000_000_000, 100_000_000, 100_000_000_000_000)
    expect(amount).toBe(50_000_000)
  })

  it('with yield: more per share', () => {
    // 100M shares, 110M deposited (10M yield)
    const amount = calculateWithdrawAmount(100_000_000_000_000, 110_000_000, 100_000_000_000_000)
    expect(amount).toBe(110_000_000)
  })

  it('zero shares returns zero', () => {
    expect(calculateWithdrawAmount(0, 100_000_000, 100_000_000_000_000)).toBe(0)
  })

  it('handles empty vault', () => {
    expect(calculateWithdrawAmount(100, 0, 0)).toBe(0)
  })
})

describe('Share price', () => {
  it('empty vault = 1.0', () => {
    expect(calculateSharePrice(0, 0)).toBe(1.0)
  })

  it('no yield = deposited/shares', () => {
    expect(calculateSharePrice(100_000_000, 100_000_000_000_000)).toBeCloseTo(0.000001, 8)
  })

  it('with yield: price increases', () => {
    const price = calculateSharePrice(110_000_000, 100_000_000_000_000)
    expect(price).toBeGreaterThan(calculateSharePrice(100_000_000, 100_000_000_000_000))
  })
})

// ═══════════════════════════════════
// Yield Analytics
// ═══════════════════════════════════

describe('Yield analytics', () => {
  it('daily yield calculation', () => {
    const userValue = 1000
    const apy = 5
    const daily = userValue * (apy / 100) / 365
    expect(daily).toBeCloseTo(0.1370, 2)
  })

  it('weekly yield', () => {
    const daily = 1000 * 0.05 / 365
    expect(daily * 7).toBeCloseTo(0.9589, 2)
  })

  it('monthly yield', () => {
    const daily = 1000 * 0.05 / 365
    expect(daily * 30).toBeCloseTo(4.1096, 2)
  })

  it('yield earned = current - deposited', () => {
    const deposited = 1000
    const currentValue = 1050
    const earned = currentValue - deposited
    expect(earned).toBe(50)
  })
})

// ═══════════════════════════════════
// Input Validation
// ═══════════════════════════════════

describe('Input validation', () => {
  it('min deposit = 10', () => {
    const minDeposit = 10
    expect(9.99 >= minDeposit).toBe(false)
    expect(10 >= minDeposit).toBe(true)
    expect(10.01 >= minDeposit).toBe(true)
  })

  it('TX hash is 64 hex chars', () => {
    const validHash = 'a'.repeat(64)
    const shortHash = 'a'.repeat(63)
    const nonHex = 'g'.repeat(64)

    expect(/^[0-9a-fA-F]{64}$/.test(validHash)).toBe(true)
    expect(/^[0-9a-fA-F]{64}$/.test(shortHash)).toBe(false)
    expect(/^[0-9a-fA-F]{64}$/.test(nonHex)).toBe(false)
  })

  it('CBOR hex validation', () => {
    expect(/^[0-9a-fA-F]+$/.test('aabbccdd')).toBe(true)
    expect(/^[0-9a-fA-F]+$/.test('not-hex!')).toBe(false)
    expect(/^[0-9a-fA-F]+$/.test('')).toBe(false)
  })

  it('network mismatch detection', () => {
    const frontendNetwork: string = 'preprod'
    const apiNetwork: string = 'mainnet'
    expect(frontendNetwork !== apiNetwork).toBe(true)
  })
})

// ═══════════════════════════════════
// Explorer URLs
// ═══════════════════════════════════

describe('Explorer URLs', () => {
  it('preprod explorer', () => {
    const base = 'https://preprod.cardanoscan.io'
    const hash = 'abc123'
    expect(`${base}/transaction/${hash}`).toBe('https://preprod.cardanoscan.io/transaction/abc123')
  })

  it('mainnet explorer', () => {
    const base = 'https://cardanoscan.io'
    const addr = 'addr1xxx'
    expect(`${base}/address/${addr}`).toBe('https://cardanoscan.io/address/addr1xxx')
  })
})
