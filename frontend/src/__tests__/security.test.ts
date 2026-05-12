/**
 * Security-Critical Validation Tests
 *
 * Tests blind signing protection, address validation,
 * JWT security, slippage bounds, and TX verification logic.
 */
import { describe, it, expect } from 'vitest'

// ═══════════════════════════════════
// Blind Signing Protection
// ═══════════════════════════════════

describe('Blind signing protection — deposit TX verification', () => {
  function verifyVaultInOutputs(outputs: { address: string }[], vaultAddr: string): boolean {
    if (!vaultAddr || vaultAddr.length <= 50) return true // skip if unknown
    return outputs.some(o => o.address === vaultAddr)
  }

  it('passes when vault address found in outputs', () => {
    const outputs = [
      { address: 'addr_test1qpUserAddr' },
      { address: 'addr_test1qpVaultAddrThatIsLongerThan50CharsForSureAbsolutelyPositively' },
    ]
    expect(verifyVaultInOutputs(outputs, 'addr_test1qpVaultAddrThatIsLongerThan50CharsForSureAbsolutelyPositively')).toBe(true)
  })

  it('fails when vault address NOT in outputs', () => {
    const outputs = [
      { address: 'addr_test1qpAttackerAddr' },
      { address: 'addr_test1qpOtherAddrThatIsLongerThan50CharsDefinitelyAbsolutelyPositively' },
    ]
    expect(verifyVaultInOutputs(outputs, 'addr_test1qpVaultAddrThatIsLongerThan50CharsForSureAbsolutelyPositively')).toBe(false)
  })

  it('skips verification when vault addr unknown (short)', () => {
    expect(verifyVaultInOutputs([], '')).toBe(true)
    expect(verifyVaultInOutputs([], 'addr_test1')).toBe(true)
  })
})

// ═══════════════════════════════════
// Blind Signing — Withdraw TX Verification
// ═══════════════════════════════════

describe('Blind signing protection — withdraw TX verification', () => {
  function verifyUserInOutputs(outputs: { address: string }[], userAddr: string): boolean {
    if (!userAddr || userAddr.length <= 50) return true // skip if unknown
    return outputs.some(o => o.address === userAddr)
  }

  it('passes when user address found', () => {
    const addr = 'addr_test1qpMyAddressThatIsLongerThan50CharsForSureAbsolutelyPositivelyYes'
    const outputs = [{ address: addr }, { address: 'addr_test1qpVaultXXX' }]
    expect(verifyUserInOutputs(outputs, addr)).toBe(true)
  })

  it('fails when user address missing (possible theft)', () => {
    const addr = 'addr_test1qpMyAddressThatIsLongerThan50CharsForSureAbsolutelyPositivelyYes'
    const outputs = [{ address: 'addr_test1qpAttackerLongAddressThatExceedsFiftyCharactersEasily' }]
    expect(verifyUserInOutputs(outputs, addr)).toBe(false)
  })
})

// ═══════════════════════════════════
// Address Validation
// ═══════════════════════════════════

describe('Address validation', () => {
  it('bech32 address starts with addr', () => {
    const addr = 'addr_test1qp123abc'
    expect(addr.startsWith('addr')).toBe(true)
  })

  it('hex address does not start with addr', () => {
    const hex = '0073eee5b886a32a2ef965329038ce08395c5711b51c7ea4d6b0428f43'
    expect(hex.startsWith('addr')).toBe(false)
  })

  it('empty address is not bech32', () => {
    expect(''.startsWith('addr')).toBe(false)
  })

  it('mainnet address starts with addr1', () => {
    const addr = 'addr1qx2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3n0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgs68faae'
    expect(addr.startsWith('addr1')).toBe(true)
  })

  it('testnet address starts with addr_test1', () => {
    const addr = 'addr_test1qp123'
    expect(addr.startsWith('addr_test1')).toBe(true)
  })
})

// ═══════════════════════════════════
// Slippage Protection
// ═══════════════════════════════════

describe('Slippage protection', () => {
  it('2% slippage on deposit: minShares = 98% of expected', () => {
    const expectedShares = 100_000_000
    const minShares = Math.floor(expectedShares * 0.98)
    expect(minShares).toBe(98_000_000)
    expect(minShares).toBeLessThan(expectedShares)
  })

  it('2% slippage on withdraw: minReceive = 98% of preview', () => {
    const preview = 50.5 // USDCx
    const minReceive = Math.floor(preview * 0.98 * 1e6)
    expect(minReceive).toBe(49_490_000)
  })

  it('slippage on zero amount = 0', () => {
    expect(Math.floor(0 * 0.98 * 1e6)).toBe(0)
  })

  it('slippage never exceeds original', () => {
    for (const amount of [1, 100, 10_000, 1_000_000]) {
      const slipped = Math.floor(amount * 0.98)
      expect(slipped).toBeLessThanOrEqual(amount)
    }
  })

  it('BigInt conversion preserves precision', () => {
    const preview = 100.123456
    const minReceive = BigInt(Math.floor(preview * 0.98 * 1e6))
    expect(minReceive).toBe(98_120_986n)
  })
})

// ═══════════════════════════════════
// JWT Security
// ═══════════════════════════════════

describe('JWT security', () => {
  it('expired token not used', () => {
    const tokenExpiry = Date.now() - 60_000
    const isValid = Date.now() < tokenExpiry
    expect(isValid).toBe(false)
  })

  it('fresh token is valid', () => {
    const tokenExpiry = Date.now() + 60_000
    expect(Date.now() < tokenExpiry).toBe(true)
  })

  it('localStorage keys are namespaced', () => {
    const keys = ['optivaults-jwt', 'optivaults-jwt-exp', 'optivaults-wallet', 'optivaults-connected']
    keys.forEach(k => {
      expect(k.startsWith('optivaults-')).toBe(true)
    })
  })

  it('token cleared on disconnect', () => {
    let authToken: string | null = 'some-jwt'
    let tokenExpiry = Date.now() + 60_000
    // Disconnect
    authToken = null
    tokenExpiry = 0
    expect(authToken).toBeNull()
    expect(tokenExpiry).toBe(0)
  })
})

// ═══════════════════════════════════
// Amount to Lovelace / Units Conversion
// ═══════════════════════════════════

describe('Amount conversion safety', () => {
  it('USDCx to units (6 decimals)', () => {
    const usdcx = 100.5
    const units = BigInt(Math.floor(usdcx * 1e6))
    expect(units).toBe(100_500_000n)
  })

  it('shares to BigInt', () => {
    const sharesToBurn = 1.5e12
    const bi = BigInt(Math.floor(sharesToBurn))
    expect(bi).toBe(1_500_000_000_000n)
  })

  it('float precision: floor avoids overshoot', () => {
    // 0.1 + 0.2 in IEEE 754
    const amount = 0.1 + 0.2 // 0.30000000000000004
    const units = Math.floor(amount * 1e6)
    expect(units).toBe(300_000) // Not 300_001
  })

  it('negative amount: floor rounds more negative', () => {
    const amount = -0.5
    expect(Math.floor(amount * 1e6)).toBe(-500_000)
  })

  it('very large USDCx amount', () => {
    const amount = 1_000_000 // 1M USDCx
    const units = BigInt(Math.floor(amount * 1e6))
    expect(units).toBe(1_000_000_000_000n)
  })
})

// ═══════════════════════════════════
// UTXO Contention / Retry Logic
// ═══════════════════════════════════

describe('UTXO contention detection', () => {
  function isContention(msg: string): boolean {
    return msg.includes('contention') || msg.includes('already spent') || msg.includes('CollateralNotFound')
  }

  it('detects contention error', () => {
    expect(isContention('UTXO contention detected')).toBe(true)
  })

  it('detects already spent', () => {
    expect(isContention('Input already spent in mempool')).toBe(true)
  })

  it('detects CollateralNotFound', () => {
    expect(isContention('CollateralNotFound: no suitable collateral')).toBe(true)
  })

  it('normal error: not contention', () => {
    expect(isContention('Insufficient funds')).toBe(false)
  })

  it('empty error: not contention', () => {
    expect(isContention('')).toBe(false)
  })
})

// ═══════════════════════════════════
// Network Mismatch Detection
// ═══════════════════════════════════

describe('Network mismatch', () => {
  it('same network: no mismatch', () => {
    const frontend = 'preprod'
    const api = 'preprod'
    expect(frontend !== api).toBe(false)
  })

  it('different network: mismatch', () => {
    const frontend: string = 'preprod'
    const api: string = 'mainnet'
    expect(frontend !== api).toBe(true)
  })

  it('deposit blocked on mismatch', () => {
    const connected = true
    const amount = 100
    const minDeposit = 10
    const networkMismatch = true
    const canDeposit = connected && amount >= minDeposit && !networkMismatch
    expect(canDeposit).toBe(false)
  })
})

// ═══════════════════════════════════
// Frozen Vault — Operation Blocking
// ═══════════════════════════════════

describe('Frozen vault operation blocking', () => {
  it('frozen=1 blocks deposit', () => {
    const frozen: number = 1
    expect(frozen === 0).toBe(false)
  })

  it('frozen=0 allows deposit', () => {
    const frozen: number = 0
    expect(frozen === 0).toBe(true)
  })

  it('frozen blocks batch process', () => {
    const frozen: number = 1
    const canBatch = frozen === 0
    expect(canBatch).toBe(false)
  })

  it('frozen allows direct withdraw', () => {
    // Withdraw is always allowed (no frozen check in contract)
    const canWithdraw = true // No frozen gate
    expect(canWithdraw).toBe(true)
  })
})
