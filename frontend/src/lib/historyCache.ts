/**
 * IndexedDB cache for chain-walked history classifications.
 *
 * TX classifications (deposit / withdraw / Compound / etc.) are
 * deterministic + immutable once a TX is on-chain — once a TX hash
 * has been classified, the result never changes. Cache forever, key
 * by (domain, txHash) composite — same TX hash can legitimately appear
 * in BOTH histories (e.g. a BatchProcess settle TX that the user-side
 * walker classifies as "deposit (settled)" while the keeper-side walker
 * classifies as "BatchProcess fold").
 *
 * The cache is per-network (preprod vs mainnet) so an operator who
 * switches `VITE_NETWORK` doesn't see stale entries from the other
 * network. Schema version bumps drop the entire store.
 */

const DB_NAME_PREFIX = 'optivaults-v1-history'
// Bumped 2026-05-03 to v3: keyPath changed from 'txHash' (single) to 'key'
// (composite "${domain}:${txHash}"). Pre-v3 schema let two walkers fight
// over the same primary key — keeper-history writes for a BatchProcess
// settle TX would overwrite tx-history's "+X vUSDCx (settled)" record,
// then tx-history walker's domain-check at line 315 of txHistoryWalker.ts
// would reject the keeper-flavoured cached entry + skip the TX (no fetch
// because cached.has() is true), producing the ghost "—" labels reported
// for debf83b4 / 46a06525 / 6e6b5921 / 003b1e96 on user
// addr_test1qp6nludl…cnkdv5qt5lc2s.
const DB_VERSION = 3
const STORE_TX = 'tx_classifications'

const NETWORK = (import.meta.env.VITE_NETWORK || 'preprod') as 'preprod' | 'mainnet'
const DB_NAME = `${DB_NAME_PREFIX}-${NETWORK}`

// ─────────────────────────────────────────────────────────────
// Cache entry shapes — opaque payload chosen by caller. Keep the
// store schema generic so both txHistoryWalker (TxRecord) and
// keeperHistoryWalker (KeeperAction) can share it without coupling.
// ─────────────────────────────────────────────────────────────

export interface CachedTxClassification {
  txHash: string
  /** "tx-history" | "keeper-history" — distinguishes which walker
   *  populated the entry. Same TX can appear in both stores
   *  (tx-history's per-user delta vs keeper-history's vault delta). */
  domain: 'tx-history' | 'keeper-history'
  /** Free-form classification payload — typed by caller. */
  payload: unknown
  /** Unix ms when classified (for diagnostics; cache itself is permanent). */
  classifiedAt: number
  /** Composite primary key — `${domain}:${txHash}`. Computed by helpers
   *  below; callers don't need to set it manually but it's safe to. */
  key?: string
}

function makeKey(domain: 'tx-history' | 'keeper-history', txHash: string): string {
  return `${domain}:${txHash}`
}

// ─────────────────────────────────────────────────────────────
// Lazy connection
// ─────────────────────────────────────────────────────────────

let _dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  if (_dbPromise) return _dbPromise
  _dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB not available in this environment'))
      return
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      // Drop existing store on every version bump so stale cached
      // classifications get re-computed against the latest classifier
      // (TX hashes are immutable but classifier output can change).
      if (db.objectStoreNames.contains(STORE_TX)) {
        db.deleteObjectStore(STORE_TX)
      }
      const store = db.createObjectStore(STORE_TX, { keyPath: 'key' })
      store.createIndex('domain', 'domain', { unique: false })
      store.createIndex('txHash', 'txHash', { unique: false })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return _dbPromise
}

// ─────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────

/** Single TX classification lookup, scoped by domain. */
export async function getCached(
  domain: 'tx-history' | 'keeper-history',
  txHash: string,
): Promise<CachedTxClassification | null> {
  try {
    const db = await openDb()
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_TX, 'readonly')
      const req = tx.objectStore(STORE_TX).get(makeKey(domain, txHash))
      req.onsuccess = () => resolve((req.result as CachedTxClassification) || null)
      req.onerror = () => reject(req.error)
    })
  } catch {
    return null
  }
}

/** Bulk lookup — returns map keyed by txHash, scoped by domain.
 *  Missing entries omitted. */
export async function getCachedMany(
  domain: 'tx-history' | 'keeper-history',
  txHashes: string[],
): Promise<Map<string, CachedTxClassification>> {
  const result = new Map<string, CachedTxClassification>()
  if (txHashes.length === 0) return result
  try {
    const db = await openDb()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_TX, 'readonly')
      const store = tx.objectStore(STORE_TX)
      let pending = txHashes.length
      tx.onerror = () => reject(tx.error)
      for (const h of txHashes) {
        const req = store.get(makeKey(domain, h))
        req.onsuccess = () => {
          if (req.result) result.set(h, req.result as CachedTxClassification)
          pending -= 1
          if (pending === 0) resolve()
        }
      }
      if (pending === 0) resolve()
    })
  } catch {
    /* IndexedDB unavailable — return whatever we accumulated (likely empty). */
  }
  return result
}

/** Insert or replace — newer payload wins for the same (domain, txHash). */
export async function setCached(
  entry: CachedTxClassification,
): Promise<void> {
  try {
    const db = await openDb()
    const stamped = { ...entry, key: makeKey(entry.domain, entry.txHash) }
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_TX, 'readwrite')
      tx.objectStore(STORE_TX).put(stamped)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } catch {
    /* swallow — cache is best-effort, classifier still works */
  }
}

/** Bulk insert. Faster than N setCached() calls. */
export async function setCachedMany(
  entries: CachedTxClassification[],
): Promise<void> {
  if (entries.length === 0) return
  try {
    const db = await openDb()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_TX, 'readwrite')
      const store = tx.objectStore(STORE_TX)
      for (const e of entries) {
        store.put({ ...e, key: makeKey(e.domain, e.txHash) })
      }
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } catch {
    /* best-effort */
  }
}

/** Drop everything — for diagnostics or schema-change recovery. */
export async function clearCache(): Promise<void> {
  try {
    const db = await openDb()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_TX, 'readwrite')
      tx.objectStore(STORE_TX).clear()
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } catch {
    /* swallow */
  }
}

/**
 * Drop entries matching a single domain — for selective re-classify
 * after a per-walker classifier change. Avoids the cross-domain
 * collateral damage of clearCache() (which drops both 'tx-history'
 * AND 'keeper-history' entries, forcing the other walker to re-fetch
 * + re-classify on its next page visit, and risking rate-limit-induced
 * record loss when Blockfrost calls fail mid-batch).
 */
export async function clearCacheForDomain(domain: 'tx-history' | 'keeper-history'): Promise<void> {
  try {
    const db = await openDb()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_TX, 'readwrite')
      const store = tx.objectStore(STORE_TX)
      const idx = store.index('domain')
      const req = idx.openCursor(IDBKeyRange.only(domain))
      req.onsuccess = () => {
        const cursor = req.result
        if (cursor) {
          cursor.delete()
          cursor.continue()
        }
      }
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } catch {
    /* swallow */
  }
}
