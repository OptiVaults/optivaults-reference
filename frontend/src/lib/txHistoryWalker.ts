/**
 * Per-user TX history chain-walker.
 *
 * Replaces `GET /api/tx-history/{addr}?limit=N` with a pure-frontend
 * Blockfrost walk. Each user only has their own (typically modest)
 * TX history to scan, and the resulting classification is cached in
 * IndexedDB so subsequent renders are instant.
 *
 * Classification inputs per TX:
 *   - User's USDCx delta = output qty - input qty (user-side)
 *   - User's vUSDCx delta = output qty - input qty (user-side)
 *   - vault.proxyAddr present in inputs/outputs?
 *   - order.scriptAddress present in inputs/outputs?
 *
 * Decision rules (mirror the legacy API server's classifier shape):
 *   delta_usdcx < 0, delta_vusdcx > 0 → deposit (direct or queue depending on order presence)
 *   delta_usdcx > 0, delta_vusdcx < 0 → withdraw (direct or queue)
 *   delta_usdcx > 0, delta_vusdcx == 0, order in inputs → cancel/expire (refund)
 *   no delta and no vault/order presence → unknown (hidden in default UX)
 */

import { resolveApiKey, blockfrostNetwork } from './blockfrost'
import { loadDeployState, hydrateAddresses } from './v1Deploy'
import { getCachedMany, setCachedMany, clearCacheForDomain, type CachedTxClassification } from './historyCache'

// Bump this string whenever classify() output for any existing TX
// changes — drives a one-shot IndexedDB cache purge so users on the
// new bundle get fresh classifications without needing to manually
// clear browser data. The localStorage marker is per-tab/origin, so
// multiple tabs auto-coordinate.
//
// IMPORTANT: walkUserTxHistory awaits purgeCacheIfClassifierChanged()
// BEFORE getCachedMany() to avoid the race where cached stale entries
// get served while clearCache() is still in flight on first load after
// a classifier-version bump.
const CLASSIFIER_VERSION = '2026-05-02-batchprocess-settled-vs-cancel-r5-mobile-purge'
let _purgePromise: Promise<void> | null = null

function purgeCacheIfClassifierChanged(): Promise<void> {
  if (_purgePromise) return _purgePromise
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
    _purgePromise = Promise.resolve()
    return _purgePromise
  }
  try {
    const last = localStorage.getItem('optivaults-classifier-version')
    if (last === CLASSIFIER_VERSION) {
      _purgePromise = Promise.resolve()
      return _purgePromise
    }
    // Per-domain purge avoids blowing away keeper-history entries.
    _purgePromise = clearCacheForDomain('tx-history')
      .then(() => {
        try { localStorage.setItem('optivaults-classifier-version', CLASSIFIER_VERSION) } catch { /* swallow */ }
      })
      .catch(() => { /* private-mode or quota error — best-effort */ })
    return _purgePromise
  } catch {
    _purgePromise = Promise.resolve()
    return _purgePromise
  }
}

const BASE_URL = blockfrostNetwork === 'mainnet'
  ? 'https://cardano-mainnet.blockfrost.io/api/v0'
  : 'https://cardano-preprod.blockfrost.io/api/v0'

// ─────────────────────────────────────────────────────────────
// Output shape — mirrors legacy `/api/tx-history` response
// ─────────────────────────────────────────────────────────────

export interface TxRecord {
  txHash: string
  type: 'deposit' | 'withdraw' | 'unknown'
  /** Human-readable amount string with `+` / `-` sign. UI prepends
   *  the sign symbol if missing. */
  amount: string
  /** ISO 8601 timestamp from block_time. */
  timestamp: string
  block: number
}

// ─────────────────────────────────────────────────────────────
// Blockfrost helpers
// ─────────────────────────────────────────────────────────────

interface AddressTx {
  tx_hash: string
  tx_index: number
  block_height: number
  block_time: number
}

interface UtxoEntry {
  address: string
  amount: { unit: string; quantity: string }[]
}

interface TxUtxos {
  hash: string
  inputs: UtxoEntry[]
  outputs: UtxoEntry[]
}

async function bf<T>(path: string, signal?: AbortSignal): Promise<T | null> {
  const key = resolveApiKey()
  if (!key) throw new Error('Blockfrost API key missing — set VITE_BLOCKFROST_API_KEY or BYO via Settings')
  const res = await fetch(`${BASE_URL}${path}`, { headers: { project_id: key }, signal })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`Blockfrost ${res.status}: ${path}`)
  return (await res.json()) as T
}

async function fetchAddressTxs(
  addr: string,
  limit: number,
  signal?: AbortSignal,
): Promise<AddressTx[]> {
  // Blockfrost paginates 100 per request; for typical user TVL we
  // only need the first page (≤ 50 user TXs lifetime), but allow
  // higher counts for active users.
  const count = Math.min(Math.max(limit, 1), 100)
  const data = await bf<AddressTx[]>(`/addresses/${addr}/transactions?count=${count}&order=desc`, signal)
  return data || []
}

async function fetchTxUtxos(hash: string, signal?: AbortSignal): Promise<TxUtxos | null> {
  return bf<TxUtxos>(`/txs/${hash}/utxos`, signal)
}

// ─────────────────────────────────────────────────────────────
// Delta computation
// ─────────────────────────────────────────────────────────────

interface Delta {
  usdcx: bigint
  vusdcx: bigint
  vaultIn: boolean
  vaultOut: boolean
  orderIn: boolean
  orderOut: boolean
}

function computeUserDelta(
  utxos: TxUtxos,
  userAddr: string,
  usdcxUnit: string,
  vusdcxUnit: string,
  vaultAddr: string,
  orderAddr: string,
): Delta {
  let usdcx = 0n
  let vusdcx = 0n
  let vaultIn = false, vaultOut = false, orderIn = false, orderOut = false
  for (const inp of utxos.inputs) {
    if (inp.address === vaultAddr) vaultIn = true
    if (inp.address === orderAddr) orderIn = true
    if (inp.address !== userAddr) continue
    for (const a of inp.amount) {
      if (a.unit === usdcxUnit) usdcx -= BigInt(a.quantity)
      else if (a.unit === vusdcxUnit) vusdcx -= BigInt(a.quantity)
    }
  }
  for (const out of utxos.outputs) {
    if (out.address === vaultAddr) vaultOut = true
    if (out.address === orderAddr) orderOut = true
    if (out.address !== userAddr) continue
    for (const a of out.amount) {
      if (a.unit === usdcxUnit) usdcx += BigInt(a.quantity)
      else if (a.unit === vusdcxUnit) vusdcx += BigInt(a.quantity)
    }
  }
  return { usdcx, vusdcx, vaultIn, vaultOut, orderIn, orderOut }
}

function classify(delta: Delta): { type: TxRecord['type']; amount: string } | null {
  // Direct Deposit (USDCx out, vUSDCx in, vault touched directly)
  if (delta.usdcx < 0n && delta.vusdcx > 0n) {
    const usdcxAbs = -delta.usdcx
    return { type: 'deposit', amount: `+${(Number(usdcxAbs) / 1e6).toFixed(2)} USDCx` }
  }
  // Direct Withdraw (vUSDCx burned by user, USDCx returned)
  if (delta.usdcx > 0n && delta.vusdcx < 0n) {
    return { type: 'withdraw', amount: `-${(Number(delta.usdcx) / 1e6).toFixed(2)} USDCx` }
  }
  // Queue Deposit (USDCx out to order addr, no vUSDCx received yet — fold pending)
  if (delta.usdcx < 0n && delta.vusdcx === 0n && delta.orderOut) {
    const usdcxAbs = -delta.usdcx
    return { type: 'deposit', amount: `+${(Number(usdcxAbs) / 1e6).toFixed(2)} USDCx (queued)` }
  }
  // Queue Withdraw (vUSDCx out to order addr, no USDCx in yet)
  if (delta.usdcx === 0n && delta.vusdcx < 0n && delta.orderOut) {
    const vusdcxAbs = -delta.vusdcx
    return { type: 'withdraw', amount: `-${(Number(vusdcxAbs) / 1e12).toFixed(2)} vUSDCx (queued)` }
  }
  // BatchProcess settlement of DepositOrder — vUSDCx received from keeper batch fold
  // (vault + order both touched, distinguishes from cancel which doesn't touch vault).
  if (delta.vusdcx > 0n && delta.usdcx === 0n && delta.orderIn && delta.vaultIn) {
    return { type: 'deposit', amount: `+${(Number(delta.vusdcx) / 1e12).toFixed(2)} vUSDCx (settled)` }
  }
  // BatchProcess settlement of WithdrawOrder — USDCx received from keeper batch fold
  // (vault + order both touched, distinguishes from cancel which doesn't touch vault).
  if (delta.usdcx > 0n && delta.vusdcx === 0n && delta.orderIn && delta.vaultIn) {
    return { type: 'withdraw', amount: `+${(Number(delta.usdcx) / 1e6).toFixed(2)} USDCx (settled)` }
  }
  // Cancel / expire — order spent, asset returned, vault NOT touched.
  // Distinguished from settlement above by !delta.vaultIn.
  if (delta.usdcx > 0n && delta.orderIn && !delta.vaultIn) {
    return { type: 'unknown', amount: `+${(Number(delta.usdcx) / 1e6).toFixed(2)} USDCx (refund)` }
  }
  if (delta.vusdcx > 0n && delta.orderIn && !delta.vaultIn) {
    return { type: 'unknown', amount: `+${(Number(delta.vusdcx) / 1e12).toFixed(2)} vUSDCx (refund)` }
  }
  // Doesn't touch the vault economy — not relevant for vault history.
  if (!delta.vaultIn && !delta.vaultOut && !delta.orderIn && !delta.orderOut) return null
  return { type: 'unknown', amount: '—' }
}

// ─────────────────────────────────────────────────────────────
// Main entry
// ─────────────────────────────────────────────────────────────

/**
 * Walk the user's TX history from Blockfrost, classify vault-related
 * TXs, return them sorted desc. Cached classifications are re-used
 * without re-fetching `/txs/{hash}/utxos`. Cold first-load typical
 * cost: 1 + N Blockfrost calls (where N = recent vault-related TXs).
 *
 * Returns at most `limit` TXs (default 50).
 */
export async function walkUserTxHistory(
  userAddr: string,
  limit: number = 50,
  signal?: AbortSignal,
): Promise<TxRecord[]> {
  // hydrateAddresses() is REQUIRED — loadDeployState() returns
  // unhydrated state where state.orderAddr === '' (resolveAddrFromHash
  // is a stub at module load; only hydrateAddresses() populates the
  // bech32 via Lucid CML). Without this hydration call, every
  // orderIn / orderOut comparison in computeUserDelta evaluates to
  // false → BatchProcess settlement + Cancel branches in classify()
  // never match → all settled/cancelled TXs fall through to '—'.
  // (keeperHistoryWalker already does the same hydration; mirror it.)
  const state = await hydrateAddresses(await loadDeployState(signal))
  const usdcxUnit =
    state.ceremony.hashes['depositTokenPolicy'] !== undefined
      ? state.ceremony.hashes['depositTokenPolicy'] + (state.ceremony.hashes['depositTokenName'] || '')
      : '' // fall back to env-config? Frontend has VITE_DEPOSIT_TOKEN_*
  // Resolve USDCx unit from V1 deploy state when present; otherwise use
  // the imported V1_CONFIG values (handled below).
  const { V1_CONFIG } = await import('./v1Config')
  const finalUsdcxUnit = usdcxUnit || (V1_CONFIG.depositTokenPolicy + V1_CONFIG.depositTokenName)
  const vusdcxUnit = state.vusdcxUnit
  const vaultAddr = state.proxyAddr
  const orderAddr = state.orderAddr

  // 0. Wait for any pending classifier-version cache purge to complete
  //    BEFORE reading from cache. Without this await, a race window exists
  //    on the first page load after a CLASSIFIER_VERSION bump where
  //    getCachedMany() returns stale entries that haven't been dropped yet.
  await purgeCacheIfClassifierChanged()

  // 1. List user's recent TXs from Blockfrost
  const txList = await fetchAddressTxs(userAddr, limit, signal)
  if (typeof console !== 'undefined' && console.log) {
    console.log(`[OptiVaults walker] userAddr=${userAddr.slice(0,20)}…${userAddr.slice(-8)} (len ${userAddr.length}) vaultAddr=${vaultAddr.slice(0,20)}… orderAddr=${orderAddr ? orderAddr.slice(0,20)+'…' : 'EMPTY'} txList.length=${txList.length}`)
  }
  if (txList.length === 0) return []

  // 2. Hit cache for already-classified hashes
  const cached = await getCachedMany('tx-history', txList.map((t) => t.tx_hash))

  // 3. Walk uncached ones in parallel (cap concurrency to avoid
  //    rate-limit). Blockfrost free tier is ~10 req/sec; 5 in flight
  //    keeps us well under that.
  const toFetch = txList.filter((t) => !cached.has(t.tx_hash))
  const fetched = new Map<string, TxUtxos>()
  for (let i = 0; i < toFetch.length; i += 5) {
    const batch = toFetch.slice(i, i + 5)
    const results = await Promise.allSettled(
      batch.map(async (t) => ({ hash: t.tx_hash, utxos: await fetchTxUtxos(t.tx_hash, signal) })),
    )
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value.utxos) {
        fetched.set(r.value.hash, r.value.utxos)
      }
    }
  }

  // 4. Classify uncached + stale-unknown-cached TXs
  //
  // Defensive re-classify pattern: cached payloads where
  // `type === 'unknown' && amount === '—'` are treated as stale —
  // the catch-all fall-through often means the classifier was running
  // against incomplete state (e.g. orderAddr empty before hydrate).
  // These get re-fetched + re-classified inline. Avoids the rate-limit
  // cliff of dropping the whole cache on every classifier-version bump.
  //
  // To force a re-fetch for a stale-unknown entry, we need its utxos
  // in the fetched map. Two cases now need fetching:
  //   (a) entries not in cache at all (existing behavior)
  //   (b) entries cached with stale-unknown payload (NEW)
  // Build that retry list HERE before the classification loop.
  // Stale = catch-all 'unknown / —' OR null (cached when classifier
  // wrongly returned null due to e.g. orderAddr empty before hydrate).
  // Re-classify both. Trust only entries with real deposit/withdraw labels.
  const shouldReClassify = (p: { type: TxRecord['type']; amount: string } | null): boolean => {
    if (!p) return true  // null cached → always re-classify (might be a buggy run)
    if (p.type === 'unknown' && p.amount === '—') return true  // stale-unknown
    return false  // valid label → trust cache
  }
  const retryFetch: AddressTx[] = []
  for (const tx of txList) {
    const cachedHit = cached.get(tx.tx_hash)
    if (cachedHit && cachedHit.domain === 'tx-history') {
      const payload = cachedHit.payload as { type: TxRecord['type']; amount: string } | null
      if (shouldReClassify(payload) && !fetched.has(tx.tx_hash)) {
        retryFetch.push(tx)
      }
    }
  }
  if (retryFetch.length > 0) {
    for (let i = 0; i < retryFetch.length; i += 5) {
      const batch = retryFetch.slice(i, i + 5)
      const results = await Promise.allSettled(
        batch.map(async (t) => ({ hash: t.tx_hash, utxos: await fetchTxUtxos(t.tx_hash, signal) })),
      )
      for (const r of results) {
        if (r.status === 'fulfilled' && r.value.utxos) {
          fetched.set(r.value.hash, r.value.utxos)
        }
      }
    }
  }

  const newCacheEntries: CachedTxClassification[] = []
  const records: TxRecord[] = []
  for (const tx of txList) {
    const cachedHit = cached.get(tx.tx_hash)
    if (cachedHit && cachedHit.domain === 'tx-history') {
      const payload = cachedHit.payload as { type: TxRecord['type']; amount: string } | null
      // Re-classify stale entries (unknown OR null payload) when we managed
      // to fetch their utxos (retryFetch above). Otherwise use cached label.
      if (shouldReClassify(payload) && fetched.has(tx.tx_hash)) {
        const utxos = fetched.get(tx.tx_hash)!
        const delta = computeUserDelta(utxos, userAddr, finalUsdcxUnit, vusdcxUnit, vaultAddr, orderAddr)
        const cls = classify(delta)
        newCacheEntries.push({
          txHash: tx.tx_hash,
          domain: 'tx-history',
          payload: cls,
          classifiedAt: Date.now(),
        })
        if (cls) {
          records.push({
            txHash: tx.tx_hash,
            type: cls.type,
            amount: cls.amount,
            timestamp: new Date(tx.block_time * 1000).toISOString(),
            block: tx.block_height,
          })
        }
        continue
      }
      if (payload) {
        records.push({
          txHash: tx.tx_hash,
          type: payload.type,
          amount: payload.amount,
          timestamp: new Date(tx.block_time * 1000).toISOString(),
          block: tx.block_height,
        })
      }
      continue
    }
    const utxos = fetched.get(tx.tx_hash)
    if (!utxos) continue
    const delta = computeUserDelta(utxos, userAddr, finalUsdcxUnit, vusdcxUnit, vaultAddr, orderAddr)
    const cls = classify(delta)
    newCacheEntries.push({
      txHash: tx.tx_hash,
      domain: 'tx-history',
      payload: cls, // null when irrelevant — cache the negative result so we don't re-fetch
      classifiedAt: Date.now(),
    })
    if (!cls) continue
    records.push({
      txHash: tx.tx_hash,
      type: cls.type,
      amount: cls.amount,
      timestamp: new Date(tx.block_time * 1000).toISOString(),
      block: tx.block_height,
    })
  }

  // 5. Persist cache
  if (newCacheEntries.length > 0) {
    await setCachedMany(newCacheEntries)
  }

  if (typeof console !== 'undefined' && console.log) {
    const fetchedCount = fetched.size
    const classified = newCacheEntries.length
    const labelCounts: Record<string, number> = {}
    for (const r of records) labelCounts[r.type] = (labelCounts[r.type] || 0) + 1
    console.log(`[OptiVaults walker] fetched=${fetchedCount}/${txList.length} classified=${classified} records=${records.length} labels=${JSON.stringify(labelCounts)}`)
    // Per-TX summary for diagnosis
    const summary = txList.slice(0, 25).map(t => {
      const c = cached.get(t.tx_hash)
      const f = fetched.has(t.tx_hash)
      const r = records.find(rec => rec.txHash === t.tx_hash)
      return `${t.tx_hash.slice(0,8)}: ${c ? 'cached' : 'fresh'}/${f ? 'fetched' : 'no-fetch'}/${r ? r.type : '—'}`
    }).join('\n  ')
    console.log(`[OptiVaults walker] per-tx:\n  ${summary}`)
  }

  return records.sort((a, b) => b.block - a.block)
}
