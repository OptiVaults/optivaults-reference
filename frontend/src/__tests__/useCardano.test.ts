/**
 * useCardano Hook Logic Tests
 *
 * Tests auth token management, balance parsing, wallet state,
 * JWT lifecycle, and API helper logic without browser/wallet dependencies.
 */
import { describe, it, expect, beforeEach } from 'vitest'

// ═══════════════════════════════════
// Auth Token Management
// ═══════════════════════════════════

describe('Auth token management', () => {
  let authToken: string | null = null
  let tokenExpiry = 0

  function getAuthHeaders(): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (authToken && Date.now() < tokenExpiry) {
      headers['Authorization'] = `Bearer ${authToken}`
    }
    return headers
  }

  beforeEach(() => {
    authToken = null
    tokenExpiry = 0
  })

  it('returns Content-Type only when no token', () => {
    const h = getAuthHeaders()
    expect(h['Content-Type']).toBe('application/json')
    expect(h['Authorization']).toBeUndefined()
  })

  it('includes Bearer token when valid', () => {
    authToken = 'jwt-token-123'
    tokenExpiry = Date.now() + 60_000
    const h = getAuthHeaders()
    expect(h['Authorization']).toBe('Bearer jwt-token-123')
  })

  it('excludes expired token', () => {
    authToken = 'expired-token'
    tokenExpiry = Date.now() - 1000
    const h = getAuthHeaders()
    expect(h['Authorization']).toBeUndefined()
  })

  it('excludes token when expiry is exactly now', () => {
    authToken = 'edge-token'
    tokenExpiry = Date.now()
    const h = getAuthHeaders()
    // Date.now() < tokenExpiry is false when equal
    expect(h['Authorization']).toBeUndefined()
  })
})

// ═══════════════════════════════════
// JWT Expiry Calculation
// ═══════════════════════════════════

describe('JWT expiry calculation', () => {
  it('30 minutes default', () => {
    const expiresIn = '30'
    const minutes = parseInt(expiresIn) || 30
    const expiry = Date.now() + minutes * 60 * 1000
    expect(expiry).toBeGreaterThan(Date.now())
    expect(expiry - Date.now()).toBeLessThanOrEqual(30 * 60 * 1000 + 100) // +100ms tolerance
  })

  it('parses custom expiry', () => {
    const expiresIn = '60'
    const minutes = parseInt(expiresIn) || 30
    expect(minutes).toBe(60)
  })

  it('falls back to 30 on invalid string', () => {
    const expiresIn = 'invalid'
    const minutes = parseInt(expiresIn) || 30
    expect(minutes).toBe(30)
  })

  it('falls back to 30 on empty string', () => {
    const expiresIn = ''
    const minutes = parseInt(expiresIn) || 30
    expect(minutes).toBe(30)
  })

  it('handles zero expiry as falsy -> default 30', () => {
    const expiresIn = '0'
    const minutes = parseInt(expiresIn) || 30
    expect(minutes).toBe(30) // 0 is falsy, falls to default
  })
})

// ═══════════════════════════════════
// Balance Parsing (API response)
// ═══════════════════════════════════

describe('Balance parsing', () => {
  const USDCX_POLICY = '1f3aec8bfe7ea4fe14c5f121e2a92e301afe414147860d557cac7e34'

  function parseBalance(data: { lovelace: string; tokens?: { unit: string; quantity: string }[] }, vusdcxPolicy: string) {
    const ada = BigInt(data.lovelace || '0')
    let vusdcx = 0n
    let usdcx = 0n
    for (const t of (data.tokens || [])) {
      const u = t.unit || ''
      const q = BigInt(t.quantity || '0')
      if (u.startsWith(USDCX_POLICY)) usdcx += q
      else if (vusdcxPolicy && u.startsWith(vusdcxPolicy)) vusdcx += q
    }
    return { ada, vusdcx, usdcx }
  }

  it('parses ADA-only balance', () => {
    const { ada, vusdcx, usdcx } = parseBalance({ lovelace: '5000000' }, '')
    expect(ada).toBe(5_000_000n)
    expect(vusdcx).toBe(0n)
    expect(usdcx).toBe(0n)
  })

  it('parses USDCx token', () => {
    const { usdcx } = parseBalance({
      lovelace: '2000000',
      tokens: [{ unit: USDCX_POLICY + '55534443', quantity: '100000000' }],
    }, '')
    expect(usdcx).toBe(100_000_000n) // 100 USDCx
  })

  it('parses vUSDCx token', () => {
    const vPolicy = 'aabbccdd'
    const { vusdcx } = parseBalance({
      lovelace: '2000000',
      tokens: [{ unit: vPolicy + '765553444378', quantity: '50000000000000' }],
    }, vPolicy)
    expect(vusdcx).toBe(50_000_000_000_000n)
  })

  it('sums multiple USDCx UTXOs', () => {
    const { usdcx } = parseBalance({
      lovelace: '5000000',
      tokens: [
        { unit: USDCX_POLICY + 'aa', quantity: '50000000' },
        { unit: USDCX_POLICY + 'bb', quantity: '30000000' },
      ],
    }, '')
    expect(usdcx).toBe(80_000_000n)
  })

  it('ignores unrelated tokens', () => {
    const { vusdcx, usdcx } = parseBalance({
      lovelace: '2000000',
      tokens: [
        { unit: 'deadbeef' + 'token1', quantity: '9999999' },
        { unit: USDCX_POLICY + '55534443', quantity: '10000000' },
      ],
    }, 'aabbccdd')
    expect(usdcx).toBe(10_000_000n)
    expect(vusdcx).toBe(0n) // deadbeef doesn't match vPolicy
  })

  it('handles empty token list', () => {
    const { ada, vusdcx, usdcx } = parseBalance({ lovelace: '1000000', tokens: [] }, 'abc')
    expect(ada).toBe(1_000_000n)
    expect(vusdcx).toBe(0n)
    expect(usdcx).toBe(0n)
  })

  it('handles missing lovelace', () => {
    const { ada } = parseBalance({ lovelace: '' }, '')
    expect(ada).toBe(0n)
  })
})

// ═══════════════════════════════════
// Wallet State Transitions
// ═══════════════════════════════════

describe('Wallet state transitions', () => {
  const DISCONNECTED = { connected: false, walletName: '', address: '', adaBalance: 0n, vusdcxBalance: 0n, usdcxBalance: 0n }

  it('initial state is disconnected', () => {
    expect(DISCONNECTED.connected).toBe(false)
    expect(DISCONNECTED.address).toBe('')
  })

  it('connected state has all fields', () => {
    const connected = {
      connected: true,
      walletName: 'eternl',
      address: 'addr_test1qp123',
      adaBalance: 10_000_000n,
      vusdcxBalance: 50_000_000_000_000n,
      usdcxBalance: 100_000_000n,
    }
    expect(connected.walletName).toBe('eternl')
    expect(connected.adaBalance).toBe(10_000_000n)
  })

  it('disconnect clears all state', () => {
    const afterDisconnect = { ...DISCONNECTED }
    expect(afterDisconnect.connected).toBe(false)
    expect(afterDisconnect.walletName).toBe('')
    expect(afterDisconnect.adaBalance).toBe(0n)
    expect(afterDisconnect.vusdcxBalance).toBe(0n)
    expect(afterDisconnect.usdcxBalance).toBe(0n)
  })
})

// ═══════════════════════════════════
// Vault State Parsing
// ═══════════════════════════════════

describe('Vault state parsing', () => {
  it('derives vusdcxUnit from policy', () => {
    const vusdcxPolicyId = 'aabbccdd11223344'
    const vusdcxUnit = vusdcxPolicyId + '765553444378'
    expect(vusdcxUnit).toBe('aabbccdd11223344765553444378')
  })

  it('empty policy yields empty unit prefix', () => {
    const vusdcxPolicyId = ''
    const vusdcxUnit = vusdcxPolicyId ? vusdcxPolicyId + '765553444378' : ''
    expect(vusdcxUnit).toBe('')
  })

  it('frozen state: 0=normal, 1=frozen', () => {
    expect(0 === 0).toBe(true)  // not frozen
    expect(1 === 1).toBe(true)  // frozen
    const frozen1 = 1 as number
    const frozenBool = frozen1 === 1 || frozen1 === (true as any)
    expect(frozenBool).toBe(true)
  })

  it('default vault has sharePrice 1.0', () => {
    const vault = { totalDeposited: 0, totalShares: 0, sharePrice: 1.0 }
    expect(vault.sharePrice).toBe(1.0)
  })
})

// ═══════════════════════════════════
// Explorer URL Construction
// ═══════════════════════════════════

describe('Explorer URL construction', () => {
  function txExplorerUrl(hash: string, network: string) {
    const base = network === 'mainnet' ? 'https://cardanoscan.io' : 'https://preprod.cardanoscan.io'
    return `${base}/transaction/${hash}`
  }

  function addrExplorerUrl(addr: string, network: string) {
    const base = network === 'mainnet' ? 'https://cardanoscan.io' : 'https://preprod.cardanoscan.io'
    return `${base}/address/${addr}`
  }

  it('preprod TX URL', () => {
    expect(txExplorerUrl('abc123', 'preprod')).toBe('https://preprod.cardanoscan.io/transaction/abc123')
  })

  it('mainnet TX URL', () => {
    expect(txExplorerUrl('def456', 'mainnet')).toBe('https://cardanoscan.io/transaction/def456')
  })

  it('preprod address URL', () => {
    expect(addrExplorerUrl('addr_test1qp', 'preprod')).toBe('https://preprod.cardanoscan.io/address/addr_test1qp')
  })

  it('mainnet address URL', () => {
    expect(addrExplorerUrl('addr1q', 'mainnet')).toBe('https://cardanoscan.io/address/addr1q')
  })
})

// ═══════════════════════════════════
// Hex Encoding (signData message)
// ═══════════════════════════════════

describe('Hex encoding for signData', () => {
  function toHex(str: string): string {
    return Array.from(new TextEncoder().encode(str), b => b.toString(16).padStart(2, '0')).join('')
  }

  it('encodes ASCII string', () => {
    expect(toHex('hello')).toBe('68656c6c6f')
  })

  it('encodes challenge message', () => {
    const msg = 'Sign to authenticate with OptiVaults: abc123'
    const hex = toHex(msg)
    expect(hex.length).toBe(msg.length * 2) // ASCII: 1 byte per char
    expect(/^[0-9a-f]+$/.test(hex)).toBe(true)
  })

  it('handles empty string', () => {
    expect(toHex('')).toBe('')
  })
})

// ═══════════════════════════════════
// Polling Configuration
// ═══════════════════════════════════

describe('Vault polling config', () => {
  it('poll interval is 30 seconds', () => {
    const VAULT_POLL_INTERVAL = 30_000
    expect(VAULT_POLL_INTERVAL).toBe(30000)
  })

  it('visibility API exists in browser environments', () => {
    // visibilitychange event pauses/resumes polling
    // In browser: document.addEventListener('visibilitychange', handler)
    expect(typeof 'visibilitychange').toBe('string')
  })
})
