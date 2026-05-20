/**
 * R2-backed history fetcher.
 *
 * Reads operator-published JSONL files from a public R2 bucket (or any
 * static-CDN URL with CORS allowed). The frontend never needs to know
 * how the keeper(s) wrote those files — Model 1/2/3 (shared creds /
 * per-keeper-scoped / Worker-proxy on-chain-auth) all surface the same
 * read shape: public R2 URL → JSONL stream.
 *
 * File layout, prefixed by the ceremony's `releaseTag` so the same
 * bucket can host multiple ceremonies side-by-side without overwrites:
 *   ${VITE_HISTORY_BASE_URL}/
 *   └── <releaseTag>/
 *       ├── vault-history.jsonl                # single, per-vault snapshots
 *       ├── apy-history.jsonl                  # single, per-vault Liqwid market
 *       └── keeper-actions/
 *           ├── <keeper_pkh_A>.jsonl           # per-keeper action log
 *           └── <keeper_pkh_B>.jsonl           # additional keepers
 *
 * The frontend reads `releaseTag` from the deploy state JSON
 * (`/v1-deploy-state.json`), so a fresh ceremony swap (replace JSON +
 * redeploy SPA) automatically points at the new ceremony's data; the
 * old ceremony's files remain untouched in the bucket.
 *
 * Multi-keeper aggregation: the deploy state JSON also carries
 * `historyKeepers: string[]` listing pkh's currently expected to
 * publish. Frontend fans out a fetch per pkh, merges by ts, dedupes by
 * tx_hash. Adding a new KaaS keeper = operator updates deploy state
 * JSON entry.
 *
 * No R2 base URL configured → all fetchers return `null` and callers
 * fall back to chain-walk (graceful degrade — KaaS-friendly).
 */

import { loadDeployState } from './v1Deploy'

const HISTORY_BASE_URL = (import.meta.env.VITE_HISTORY_BASE_URL || '') as string

/** True iff the operator has set `VITE_HISTORY_BASE_URL`. Callers
 *  short-circuit to chain-walk fallback when false. */
export function historyR2Configured(): boolean {
  return Boolean(HISTORY_BASE_URL)
}

function joinUrl(base: string, path: string): string {
  return base.replace(/\/$/, '') + '/' + path.replace(/^\//, '')
}

/** Path-component shape for R2 keys — mirror of the Worker's
 *  `RELEASE_TAG_PATTERN`. Defensive only; the deploy state JSON is
 *  operator-published so a malformed tag is an operator error. */
const RELEASE_TAG_PATTERN = /^[A-Za-z0-9._-]{1,64}$/

/** Build the R2-relative path for a given (releaseTag, kind, pkh?). */
function r2PathFor(
  releaseTag: string,
  kind: 'vault-history' | 'apy-history' | 'keeper-actions',
  pkh?: string,
): string {
  if (!RELEASE_TAG_PATTERN.test(releaseTag)) {
    throw new Error(`releaseTag "${releaseTag}" must match /^[A-Za-z0-9._-]{1,64}$/`)
  }
  if (kind === 'keeper-actions') {
    if (!pkh) throw new Error('keeper-actions path requires pkh')
    return `${releaseTag}/keeper-actions/${pkh}.jsonl`
  }
  return `${releaseTag}/${kind}.jsonl`
}

interface FetchOpts {
  signal?: AbortSignal
  /** Treat 404 as `null` so callers can distinguish "not yet
   *  published" from network errors. */
  notFoundAsNull?: boolean
}

async function fetchText(url: string, opts: FetchOpts = {}): Promise<string | null> {
  const res = await fetch(url, { signal: opts.signal })
  if (res.status === 404 && opts.notFoundAsNull) return null
  if (!res.ok) {
    throw new Error(`R2 fetch ${res.status} (${url}): ${(await res.text()).slice(0, 200)}`)
  }
  return await res.text()
}

/** Parse a JSONL string into an array of typed records. Lines that
 *  fail JSON.parse are skipped (not thrown) — defensive against a
 *  partially-flushed write at the publisher's tail. */
export function parseJsonl<T>(text: string): T[] {
  const out: T[] = []
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      out.push(JSON.parse(trimmed) as T)
    } catch {
      /* skip malformed line */
    }
  }
  return out
}

// ════════════════════════════════════════════════════════════
// vault-history (single file)
// ════════════════════════════════════════════════════════════

export interface VaultSnapshot {
  ts: number
  tvl: string
  totalShares: string
  sharePrice: number
  idleBuffer: string
  nonDepositValue: string
  liqwidPositions?: Array<{
    marketId: number
    qtokens: string
    suppliedValue: string
  }>
  lastCompoundTime?: number
  lastReallocTime?: number
  strategyBlendedApy?: number
}

/**
 * Fetch the vault snapshot history. Returns `null` if R2 not
 * configured OR file not yet published (404 grace).
 *
 * Caller can downsample, slice by `days`, etc. — the file is a flat
 * JSONL stream of all snapshots since the keeper started publishing.
 */
export async function fetchVaultHistoryFromR2(
  days: number = 30,
  opts: FetchOpts = {},
): Promise<VaultSnapshot[] | null> {
  if (!historyR2Configured()) return null
  const state = await loadDeployState(opts.signal).catch(() => null)
  if (!state) return null
  const url = joinUrl(HISTORY_BASE_URL, r2PathFor(state.ceremony.releaseTag, 'vault-history'))
  const text = await fetchText(url, { ...opts, notFoundAsNull: true })
  if (text === null) return null
  const all = parseJsonl<VaultSnapshot>(text)
  // Filter to last N days client-side.
  const cutoff = Date.now() - days * 86_400_000
  return all.filter((s) => s.ts >= cutoff)
}

// ════════════════════════════════════════════════════════════
// keeper-actions (per-keeper file, aggregate across pkhs)
// ════════════════════════════════════════════════════════════

export interface KeeperActionRecord {
  txHash: string
  type: string
  timestamp: string
  slot?: number
  profitUsdcx: string
  detail: string
  vaultState: {
    totalDeposited: string
    totalShares: string
    idleBuffer: string
  } | null
  estTxFeeAda: string
  /** PKH of the keeper that published this record. Set by the keeper
   *  R2 publisher; used by frontend to differentiate views per keeper
   *  (not yet rendered, but available for future UI). */
  keeperPkh?: string
}

/**
 * Fetch + merge keeper-action logs from every pkh listed under
 * `historyKeepers` in the deploy state JSON. Records merged by ts,
 * deduplicated by txHash. Returns `null` if R2 not configured.
 *
 * Per-keeper failures are tolerated — if one keeper's file 404s
 * (perhaps just-onboarded, no actions yet) the others still surface.
 */
export async function fetchKeeperActionsFromR2(
  opts: FetchOpts = {},
): Promise<KeeperActionRecord[] | null> {
  if (!historyR2Configured()) return null
  const state = await loadDeployState(opts.signal).catch(() => null)
  if (!state) return null
  const keepers = (state.ceremony as unknown as { historyKeepers?: string[] }).historyKeepers || []
  if (keepers.length === 0) {
    // No keepers declared in deploy state → keeper publisher hasn't been
    // wired for action logs yet. Return null (not [] — null signals
    // "R2 path not available, use chain-walk" to KeeperHistory page).
    // Avoids a guaranteed 404 on the legacy single-file path when the
    // operator hasn't shipped keeper-actions publishing.
    return null
  }

  const releaseTag = state.ceremony.releaseTag

  const results = await Promise.allSettled(
    keepers.map(async (pkh) => {
      const text = await fetchText(
        joinUrl(HISTORY_BASE_URL, r2PathFor(releaseTag, 'keeper-actions', pkh)),
        { ...opts, notFoundAsNull: true },
      )
      if (text === null) return [] as KeeperActionRecord[]
      return parseJsonl<KeeperActionRecord>(text).map((r) => ({ ...r, keeperPkh: r.keeperPkh || pkh }))
    }),
  )

  // Merge + dedupe by txHash, keep latest by ts.
  // `timestamp` is an ISO 8601 string — `Number(iso)` returns `NaN`, so
  // an earlier version of this code collapsed every comparison to 0
  // and lost the dedup/sort. Parse to epoch ms via `Date` instead;
  // fall back to `slot` if both timestamps are unparseable.
  const tsKey = (r: KeeperActionRecord): number => {
    const t = new Date(r.timestamp).getTime()
    if (Number.isFinite(t)) return t
    return r.slot ?? 0
  }
  const merged = new Map<string, KeeperActionRecord>()
  for (const r of results) {
    if (r.status !== 'fulfilled') continue
    for (const rec of r.value) {
      const prior = merged.get(rec.txHash)
      if (!prior || tsKey(rec) > tsKey(prior)) {
        merged.set(rec.txHash, rec)
      }
    }
  }

  return Array.from(merged.values()).sort((a, b) => tsKey(b) - tsKey(a))
}
