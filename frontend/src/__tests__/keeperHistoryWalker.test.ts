/**
 * keeperHistoryWalker classifier regression test.
 *
 * Runs the real `walkVaultKeeperHistory` against frozen Blockfrost
 * fixtures captured from three Preprod ceremony vaults (62 TXs total)
 * that between them exercise every classifier branch. The fixtures are
 * trimmed Blockfrost responses (`fixtures/keeper-history/*.json`); no
 * network, no API key, no external paths — so this is a deterministic
 * regression guard for the action-type classification.
 *
 * Mocked: only the I/O boundaries — deploy-state source, IndexedDB
 * cache, API-key resolution, and `fetch` (served from fixtures). The
 * classification logic (`classifyByValidatorAndDelta`,
 * `computeVaultDelta`, `parseVaultDatum`) runs unchanged. The
 * `@lucid-evolution/lucid` umbrella is redirected to the libsodium-free
 * `@lucid-evolution/plutus` subpackage — `Data` is the identical impl.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

vi.mock('@lucid-evolution/lucid', async () => {
  const plutus = await vi.importActual<{ Data: unknown }>('@lucid-evolution/plutus')
  return { Data: plutus.Data }
})
vi.mock('../lib/blockfrost', () => ({
  resolveApiKey: () => 'fixture-key',
  blockfrostNetwork: 'preprod',
}))
vi.mock('../lib/historyCache', () => ({
  getCachedMany: async () => new Map(),
  setCachedMany: async () => {},
  clearCacheForDomain: async () => {},
}))
vi.mock('../lib/v1Deploy', () => ({
  loadDeployState: vi.fn(),
  hydrateAddresses: vi.fn((s: unknown) => s),
}))

import { walkVaultKeeperHistory } from '../lib/keeperHistoryWalker'
import { loadDeployState } from '../lib/v1Deploy'

interface Fixture {
  label: string
  hashes: Record<string, string>
  proxyAddr: string
  vaultNftUnit: string
  addressTxs: { tx_hash: string; tx_index: number; block_height: number; block_time: number }[]
  txData: Record<string, { redeemers: unknown[]; utxos: { inputs: unknown[]; outputs: unknown[] }; info: unknown }>
}

const FIX_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/keeper-history')
const loadFixture = (label: string): Fixture =>
  JSON.parse(readFileSync(path.join(FIX_DIR, `${label}.json`), 'utf8'))

// The fetch stub serves whichever ceremony fixture is active.
let active: Fixture

beforeAll(() => {
  vi.stubGlobal('fetch', async (url: string) => {
    const json = (data: unknown) => ({ ok: true, status: 200, json: async () => data })
    const notFound = { ok: false, status: 404, json: async () => null }
    if (url.includes('/addresses/')) return json(active.addressTxs)
    const tx = url.match(/\/txs\/([0-9a-f]{64})/)?.[1]
    if (!tx || !active.txData[tx]) return notFound
    if (url.endsWith('/redeemers')) return json(active.txData[tx].redeemers)
    if (url.endsWith('/utxos')) return json({ hash: tx, ...active.txData[tx].utxos })
    return json({ hash: tx, ...(active.txData[tx].info as object) })
  })
})

async function walk(label: string) {
  active = loadFixture(label)
  vi.mocked(loadDeployState).mockResolvedValue({
    ceremony: { hashes: active.hashes, network: 'Preprod' },
    proxyAddr: active.proxyAddr,
    vaultNftUnit: active.vaultNftUnit,
    rewardAddrs: { user: 'hydrated' },
  } as never)
  const records = await walkVaultKeeperHistory(100)
  return records.map((r) => ({ txHash: r.txHash, type: r.type, detail: r.detail }))
}

describe('keeperHistoryWalker — action-type classification', () => {
  const all: Record<string, Awaited<ReturnType<typeof walk>>> = {}

  it('compound-cycle fixture classifies to a stable snapshot', async () => {
    all['compound-cycle'] = await walk('compound-cycle')
    expect(all['compound-cycle']).toMatchSnapshot()
  })

  it('vault-lifecycle fixture classifies to a stable snapshot', async () => {
    all['vault-lifecycle'] = await walk('vault-lifecycle')
    expect(all['vault-lifecycle']).toMatchSnapshot()
  })

  it('keeper-daemon fixture classifies to a stable snapshot', async () => {
    all['keeper-daemon'] = await walk('keeper-daemon')
    expect(all['keeper-daemon']).toMatchSnapshot()
  })

  it('exercises every classifier action type', () => {
    const types = new Set(Object.values(all).flat().map((r) => r.type))
    // §26 coverage: every type the walker can emit for V1 keeper history.
    for (const t of ['compound', 'deploy', 'merge', 'batch_deposit',
      'batch_withdraw', 'supply', 'recall', 'donation', 'vault_tx']) {
      expect(types, `type "${t}" should appear`).toContain(t)
    }
  })

  it('never falls through to the unknown bucket', () => {
    // Regression guard: an unmapped reward redeemer ("unknown_stake") or
    // a no-redeemer non-donation TX ("unknown") means the walker failed
    // to attribute a vault touch — the exact defect class fixed for the
    // DEX-adapter and token-donation cases.
    const rows = Object.values(all).flat()
    expect(rows.filter((r) => r.detail === 'unknown' || r.detail === 'unknown_stake')).toEqual([])
  })

  it('classifies token donations, not just ADA top-ups', () => {
    // A stable-token donation (NoDatum non-NFT output) must read as a
    // donation — pre-fix it fell through to "unknown".
    const donations = Object.values(all).flat().filter((r) => r.type === 'donation')
    expect(donations.some((r) => r.detail.startsWith('Token top-up'))).toBe(true)
    expect(donations.some((r) => r.detail.startsWith('ADA top-up'))).toBe(true)
  })

  it('attributes DEX swap-adapter / cancel-guard TXs', () => {
    // Pre-fix these unmapped withdraw-0 redeemers produced "unknown_stake".
    expect(Object.values(all).flat().some((r) => r.detail === 'DEX order cancel')).toBe(true)
  })
})
