/**
 * Pre-Audit TVL Hard Cap — unit tests for the gating helpers.
 *
 * Covers the whitepaper §8.1 commitment:
 *   - Under cap: deposits allowed
 *   - Near cap (≥90%): warn state, deposits still allowed
 *   - At cap: all deposits rejected
 *   - Over cap: helpers continue to report correctly (no underflow)
 *   - Prospective deposit that would push TVL over cap: rejected
 *   - Display helpers return expected strings / numbers
 */
import { describe, it, expect } from 'vitest'
import {
  PRE_AUDIT_TVL_CAP_USDCX,
  PRE_AUDIT_TVL_WARN_RATIO,
  PRE_AUDIT_TVL_BREACH_RATIO,
  formatCapUsdcx,
  wouldBreachCap,
  isAtCap,
  capUtilization,
  capHeadroom,
} from '../config/hardCap'

const USDCX = 1_000_000n // 1 USDCx = 10^6 base units

describe('PRE_AUDIT_TVL_CAP_USDCX constant', () => {
  it('is set to 100,000 USDCx face value', () => {
    expect(PRE_AUDIT_TVL_CAP_USDCX).toBe(100_000n * USDCX)
  })

  it('warn ratio is 0.9 (90%)', () => {
    expect(PRE_AUDIT_TVL_WARN_RATIO).toBe(0.9)
  })

  it('breach ratio is 1.05 (105%) to match keeper monitor', () => {
    expect(PRE_AUDIT_TVL_BREACH_RATIO).toBe(1.05)
  })
})

describe('isAtCap', () => {
  it('returns false when vault is empty', () => {
    expect(isAtCap(0n)).toBe(false)
  })

  it('returns false when vault is well under cap', () => {
    expect(isAtCap(50_000n * USDCX)).toBe(false)
  })

  it('returns false when vault is at 99.9% of cap', () => {
    expect(isAtCap(99_900n * USDCX)).toBe(false)
  })

  it('returns true when vault is exactly at cap', () => {
    expect(isAtCap(PRE_AUDIT_TVL_CAP_USDCX)).toBe(true)
  })

  it('returns true when vault is over cap', () => {
    expect(isAtCap(PRE_AUDIT_TVL_CAP_USDCX + 1n)).toBe(true)
    expect(isAtCap(200_000n * USDCX)).toBe(true)
  })
})

describe('wouldBreachCap', () => {
  it('allows a small deposit on an empty vault', () => {
    expect(wouldBreachCap(0n, 10n * USDCX)).toBe(false)
  })

  it('allows a deposit that lands exactly at cap', () => {
    const tvl = 99_990n * USDCX
    const deposit = 10n * USDCX
    expect(wouldBreachCap(tvl, deposit)).toBe(false) // 100,000 exactly — not over
  })

  it('rejects a deposit that pushes cap+1 over', () => {
    const tvl = 99_990n * USDCX
    const deposit = 10n * USDCX + 1n
    expect(wouldBreachCap(tvl, deposit)).toBe(true)
  })

  it('rejects any deposit when vault is already at cap', () => {
    expect(wouldBreachCap(PRE_AUDIT_TVL_CAP_USDCX, 1n)).toBe(true)
  })

  it('rejects any deposit when vault is already over cap', () => {
    expect(wouldBreachCap(PRE_AUDIT_TVL_CAP_USDCX + 100_000n, 1n)).toBe(true)
  })

  it('rejects a large deposit on an empty vault that exceeds cap', () => {
    expect(wouldBreachCap(0n, 200_000n * USDCX)).toBe(true)
  })
})

describe('capUtilization', () => {
  it('returns 0 for an empty vault', () => {
    expect(capUtilization(0n)).toBe(0)
  })

  it('returns 0.5 at half cap', () => {
    expect(capUtilization(50_000n * USDCX)).toBeCloseTo(0.5, 6)
  })

  it('returns WARN ratio exactly at 90% cap', () => {
    expect(capUtilization(90_000n * USDCX)).toBeCloseTo(PRE_AUDIT_TVL_WARN_RATIO, 6)
  })

  it('returns 1.0 exactly at cap', () => {
    expect(capUtilization(PRE_AUDIT_TVL_CAP_USDCX)).toBe(1)
  })

  it('returns > 1 when over cap (breach state)', () => {
    expect(capUtilization(110_000n * USDCX)).toBeCloseTo(1.1, 6)
    expect(capUtilization(200_000n * USDCX)).toBeCloseTo(2.0, 6)
  })
})

describe('capHeadroom', () => {
  it('returns the full cap on an empty vault', () => {
    expect(capHeadroom(0n)).toBe(PRE_AUDIT_TVL_CAP_USDCX)
  })

  it('returns remaining headroom at half cap', () => {
    expect(capHeadroom(50_000n * USDCX)).toBe(50_000n * USDCX)
  })

  it('returns 0n exactly at cap', () => {
    expect(capHeadroom(PRE_AUDIT_TVL_CAP_USDCX)).toBe(0n)
  })

  it('returns 0n (not negative) when over cap', () => {
    expect(capHeadroom(110_000n * USDCX)).toBe(0n)
    expect(capHeadroom(1_000_000n * USDCX)).toBe(0n)
  })
})

describe('formatCapUsdcx', () => {
  it('returns a human-readable cap string', () => {
    const s = formatCapUsdcx()
    // 100,000 — could be localized; assert contains the digits
    expect(s).toMatch(/100[,.]?000/)
  })
})

// ═══════════════════════════════════
// Integration: combined Deposit.tsx gating shape
// ═══════════════════════════════════
describe('Deposit gating scenarios (integration)', () => {
  /** Mirrors the logic in Deposit.tsx for the cap check branch. */
  function depositAllowed(
    totalDeposited: bigint,
    depositAmount: bigint,
  ): { allowed: boolean; reason?: string } {
    if (isAtCap(totalDeposited)) return { allowed: false, reason: 'cap_full' }
    if (wouldBreachCap(totalDeposited, depositAmount)) {
      return { allowed: false, reason: 'would_breach' }
    }
    return { allowed: true }
  }

  it('✅ 50K existing, 20K new deposit → allowed', () => {
    const r = depositAllowed(50_000n * USDCX, 20_000n * USDCX)
    expect(r.allowed).toBe(true)
  })

  it('⚠️ 90K existing, 5K new deposit → allowed (headroom exists)', () => {
    const r = depositAllowed(90_000n * USDCX, 5_000n * USDCX)
    expect(r.allowed).toBe(true)
  })

  it('✅ 99.99K existing, 10 USDCx dust → allowed (lands exactly at cap)', () => {
    const r = depositAllowed(99_990n * USDCX, 10n * USDCX)
    expect(r.allowed).toBe(true)
  })

  it('❌ 99.99K existing, 10.000001 USDCx → rejected (would_breach by 1 atom)', () => {
    const r = depositAllowed(99_990n * USDCX, 10n * USDCX + 1n)
    expect(r.allowed).toBe(false)
    expect(r.reason).toBe('would_breach')
  })

  it('❌ 100K existing, any deposit → rejected (cap_full)', () => {
    const r = depositAllowed(PRE_AUDIT_TVL_CAP_USDCX, 10n * USDCX)
    expect(r.allowed).toBe(false)
    expect(r.reason).toBe('cap_full')
  })

  it('❌ 110K existing (over cap), any deposit → rejected (cap_full)', () => {
    const r = depositAllowed(110_000n * USDCX, 10n * USDCX)
    expect(r.allowed).toBe(false)
    expect(r.reason).toBe('cap_full')
  })

  it('❌ 0K existing, 200K whale deposit → rejected (would_breach)', () => {
    const r = depositAllowed(0n, 200_000n * USDCX)
    expect(r.allowed).toBe(false)
    expect(r.reason).toBe('would_breach')
  })

  it('✅ 0K existing, exactly 100K deposit → allowed (lands at cap)', () => {
    const r = depositAllowed(0n, PRE_AUDIT_TVL_CAP_USDCX)
    expect(r.allowed).toBe(true)
  })

  it('❌ 0K existing, 100K + 1 atom deposit → rejected', () => {
    const r = depositAllowed(0n, PRE_AUDIT_TVL_CAP_USDCX + 1n)
    expect(r.allowed).toBe(false)
    expect(r.reason).toBe('would_breach')
  })
})
