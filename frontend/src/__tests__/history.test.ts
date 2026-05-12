/**
 * History & KeeperHistory Page Logic Tests
 *
 * Tests pagination, TX type display, stats aggregation,
 * keeper action styling, and data formatting.
 */
import { describe, it, expect } from 'vitest'

// ═══════════════════════════════════
// Pagination Logic
// ═══════════════════════════════════

describe('Pagination', () => {
  const PAGE_SIZE = 10

  function paginate<T>(items: T[], page: number): { paged: T[]; totalPages: number } {
    const totalPages = Math.ceil(items.length / PAGE_SIZE)
    const paged = items.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
    return { paged, totalPages }
  }

  it('empty list: 0 pages', () => {
    const { paged, totalPages } = paginate([], 0)
    expect(paged).toHaveLength(0)
    expect(totalPages).toBe(0)
  })

  it('5 items: 1 page', () => {
    const items = Array.from({ length: 5 }, (_, i) => i)
    const { paged, totalPages } = paginate(items, 0)
    expect(paged).toHaveLength(5)
    expect(totalPages).toBe(1)
  })

  it('15 items: 2 pages', () => {
    const items = Array.from({ length: 15 }, (_, i) => i)
    expect(paginate(items, 0).paged).toHaveLength(10)
    expect(paginate(items, 1).paged).toHaveLength(5)
    expect(paginate(items, 0).totalPages).toBe(2)
  })

  it('exactly 10 items: 1 page', () => {
    const items = Array.from({ length: 10 }, (_, i) => i)
    expect(paginate(items, 0).totalPages).toBe(1)
    expect(paginate(items, 0).paged).toHaveLength(10)
  })

  it('50 items: 5 pages', () => {
    const items = Array.from({ length: 50 }, (_, i) => i)
    expect(paginate(items, 0).totalPages).toBe(5)
    expect(paginate(items, 4).paged).toHaveLength(10)
  })

  it('page beyond range: empty', () => {
    const items = Array.from({ length: 5 }, (_, i) => i)
    expect(paginate(items, 5).paged).toHaveLength(0)
  })

  it('page bounds clamping', () => {
    const page = 3
    const totalPages = 5
    const nextPage = Math.min(totalPages - 1, page + 1)
    const prevPage = Math.max(0, page - 1)
    expect(nextPage).toBe(4)
    expect(prevPage).toBe(2)
  })

  it('first page prev = 0', () => {
    expect(Math.max(0, 0 - 1)).toBe(0)
  })

  it('last page next = last', () => {
    const totalPages = 3
    expect(Math.min(totalPages - 1, 2 + 1)).toBe(2)
  })
})

// ═══════════════════════════════════
// TX Type Display
// ═══════════════════════════════════

describe('TX type display', () => {
  function txTypeStyle(type: string): { bg: string; text: string; label: string } {
    if (type === 'deposit') return { bg: 'emerald', text: 'emerald', label: 'Deposit' }
    if (type === 'withdraw') return { bg: 'red', text: 'red', label: 'Withdraw' }
    return { bg: 'slate', text: 'slate', label: 'TX' }
  }

  it('deposit is green', () => {
    const s = txTypeStyle('deposit')
    expect(s.bg).toBe('emerald')
    expect(s.label).toBe('Deposit')
  })

  it('withdraw is red', () => {
    const s = txTypeStyle('withdraw')
    expect(s.bg).toBe('red')
    expect(s.label).toBe('Withdraw')
  })

  it('unknown is slate', () => {
    expect(txTypeStyle('unknown').bg).toBe('slate')
  })

  it('amount sign: deposit is positive', () => {
    const type = 'deposit'
    const sign = type === 'deposit' ? '+' : type === 'withdraw' ? '-' : ''
    expect(sign).toBe('+')
  })

  it('amount sign: withdraw is negative', () => {
    const type: string = 'withdraw'
    const sign = type === 'deposit' ? '+' : type === 'withdraw' ? '-' : ''
    expect(sign).toBe('-')
  })
})

// ═══════════════════════════════════
// Address Truncation
// ═══════════════════════════════════

describe('Address truncation', () => {
  function truncateAddr(addr: string, prefixLen: number, suffixLen: number): string {
    if (addr.length <= prefixLen + suffixLen + 3) return addr
    return `${addr.slice(0, prefixLen)}...${addr.slice(-suffixLen)}`
  }

  it('long address truncated', () => {
    const addr = 'addr_test1qp1234567890abcdefghijklmnopqrstuvwxyz'
    expect(truncateAddr(addr, 12, 8)).toBe('addr_test1qp...stuvwxyz')
  })

  it('short address not truncated', () => {
    const addr = 'addr_test1'
    expect(truncateAddr(addr, 12, 8)).toBe('addr_test1')
  })
})

// ═══════════════════════════════════
// Keeper Action Types & Styling
// ═══════════════════════════════════

describe('Keeper action type styling', () => {
  const TYPE_STYLE: Record<string, { bg: string; text: string; label: string }> = {
    compound:  { bg: 'bg-emerald-500/10', text: 'text-emerald-400', label: 'Compound' },
    reconcile: { bg: 'bg-orange-500/10',  text: 'text-orange-400',  label: 'Reconcile' },
    batch:     { bg: 'bg-cyan-500/10',    text: 'text-cyan-400',    label: 'Batch' },
    deploy:    { bg: 'bg-amber-500/10',   text: 'text-amber-400',   label: 'Deploy' },
    recall:    { bg: 'bg-purple-500/10',  text: 'text-purple-400',  label: 'Recall' },
    rebalance: { bg: 'bg-blue-500/10',    text: 'text-blue-400',    label: 'Rebalance' },
    vault_tx:  { bg: 'bg-slate-500/10',   text: 'text-slate-400',   label: 'TX' },
  }

  it('all 7 types have styles', () => {
    expect(Object.keys(TYPE_STYLE)).toHaveLength(7)
  })

  it('compound is emerald', () => {
    expect(TYPE_STYLE.compound.label).toBe('Compound')
    expect(TYPE_STYLE.compound.text).toContain('emerald')
  })

  it('reconcile is orange', () => {
    expect(TYPE_STYLE.reconcile.label).toBe('Reconcile')
    expect(TYPE_STYLE.reconcile.text).toContain('orange')
  })

  it('deploy is amber', () => {
    expect(TYPE_STYLE.deploy.text).toContain('amber')
  })

  it('unknown type falls back to vault_tx', () => {
    const type = 'unknown_type'
    const style = TYPE_STYLE[type] || TYPE_STYLE.vault_tx
    expect(style.label).toBe('TX')
  })
})

// ═══════════════════════════════════
// Keeper Stats Aggregation
// ═══════════════════════════════════

describe('Keeper stats aggregation', () => {
  interface KeeperAction {
    type: string
    profitUsdcx: string
    estTxFeeAda: string
  }

  const actions: KeeperAction[] = [
    { type: 'compound', profitUsdcx: '1.50', estTxFeeAda: '0.25' },
    { type: 'compound', profitUsdcx: '2.30', estTxFeeAda: '0.25' },
    { type: 'batch',    profitUsdcx: '0',    estTxFeeAda: '0.30' },
    { type: 'deploy',   profitUsdcx: '0',    estTxFeeAda: '0.20' },
    { type: 'recall',   profitUsdcx: '0',    estTxFeeAda: '0.15' },
  ]

  it('total operations', () => {
    expect(actions.length).toBe(5)
  })

  it('compound count', () => {
    const compounds = actions.filter(a => a.type === 'compound')
    expect(compounds).toHaveLength(2)
  })

  it('total profit from compounds', () => {
    const total = actions
      .filter(a => a.type === 'compound')
      .reduce((sum, a) => sum + parseFloat(a.profitUsdcx), 0)
    expect(total).toBeCloseTo(3.80, 2)
  })

  it('total TX fees', () => {
    const total = actions.reduce((sum, a) => sum + parseFloat(a.estTxFeeAda), 0)
    expect(total).toBeCloseTo(1.15, 2)
  })

  it('empty actions: zero stats', () => {
    const empty: KeeperAction[] = []
    const profit = empty.filter(a => a.type === 'compound').reduce((s, a) => s + parseFloat(a.profitUsdcx), 0)
    const fees = empty.reduce((s, a) => s + parseFloat(a.estTxFeeAda), 0)
    expect(profit).toBe(0)
    expect(fees).toBe(0)
  })
})

// ═══════════════════════════════════
// Timestamp Formatting
// ═══════════════════════════════════

describe('Timestamp formatting', () => {
  it('ISO string to Date', () => {
    const ts = '2026-03-20T14:30:00Z'
    const d = new Date(ts)
    expect(d.getFullYear()).toBe(2026)
    expect(d.getUTCMonth()).toBe(2) // March = 2
  })

  it('toLocaleDateString returns string', () => {
    const d = new Date('2026-03-20T14:30:00Z')
    const str = d.toLocaleDateString()
    expect(typeof str).toBe('string')
    expect(str.length).toBeGreaterThan(0)
  })

  it('toLocaleString returns string with time', () => {
    const d = new Date('2026-03-20T14:30:00Z')
    const str = d.toLocaleString()
    expect(typeof str).toBe('string')
    expect(str.length).toBeGreaterThan(8)
  })
})

// ═══════════════════════════════════
// TX Hash Truncation Display
// ═══════════════════════════════════

describe('TX hash display', () => {
  it('short hash for list view', () => {
    const hash = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2'
    expect(`${hash.slice(0, 8)}...`).toBe('a1b2c3d4...')
  })

  it('medium hash for detail view', () => {
    const hash = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2'
    expect(`${hash.slice(0, 16)}...${hash.slice(-8)}`).toBe('a1b2c3d4e5f6a7b8...e9f0a1b2')
  })

  it('short hash for submitted TX', () => {
    const hash = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2'
    expect(`${hash.slice(0, 16)}...`).toBe('a1b2c3d4e5f6a7b8...')
  })
})
