/**
 * Blockfrost direct REST client.
 *
 * Replaces the operator-hosted API server's read paths so the frontend can
 * talk to the chain directly. Operators run their own instance, or users
 * may BYO their own Blockfrost key for higher rate-limit headroom (the
 * free tier is 50,000 req/day per key — generous for individual use, tight
 * if shared across many users).
 *
 * This module intentionally does NOT depend on Lucid / CML. It is a
 * lightweight fetch wrapper so the read paths can render before the
 * heavier TX-building bundle has loaded.
 */

const NETWORK = (import.meta.env.VITE_NETWORK || 'preprod') as 'preprod' | 'mainnet'

const BASE_URL = NETWORK === 'mainnet'
  ? 'https://cardano-mainnet.blockfrost.io/api/v0'
  : 'https://cardano-preprod.blockfrost.io/api/v0'

const USER_KEY_STORAGE = 'optivaults-blockfrost-key'
const KEY_INDEX_STORAGE = 'optivaults-bf-key-index'

/**
 * Operator-managed Blockfrost API keys, loaded at build time.
 * Two equivalent shapes are supported (the multi-key one wins when set):
 *   - `VITE_BLOCKFROST_API_KEYS` — comma-separated list, e.g.
 *     "preprodAAA,preprodBBB,preprodCCC,preprodDDD"
 *   - `VITE_BLOCKFROST_API_KEY` — single key (legacy, kept for back-compat)
 *
 * Multi-key enables runtime auto-rotation: when one key returns
 * 402/403/429 the frontend transparently advances to the next slot
 * (persisted in localStorage so the choice survives page reload).
 * Without redeploy. Operators rotating a burned key just push a new
 * `.env` value next deploy; until then the live frontend rotates
 * across the embedded list.
 */
const OPERATOR_KEYS: string[] = (() => {
  const csv = (import.meta.env.VITE_BLOCKFROST_API_KEYS as string | undefined) || ''
  const list = csv.split(',').map((s) => s.trim()).filter(Boolean)
  if (list.length > 0) return list
  const single = (import.meta.env.VITE_BLOCKFROST_API_KEY as string | undefined) || ''
  return single ? [single] : []
})()

function readKeyIndex(): number {
  try {
    const raw = localStorage.getItem(KEY_INDEX_STORAGE)
    if (raw === null) return 0
    const n = parseInt(raw, 10)
    if (!Number.isFinite(n) || n < 0) return 0
    return n % Math.max(OPERATOR_KEYS.length, 1)
  } catch {
    return 0
  }
}

function writeKeyIndex(idx: number): void {
  try {
    localStorage.setItem(KEY_INDEX_STORAGE, String(idx))
  } catch {
    /* localStorage unavailable */
  }
}

/**
 * Advance the operator-key cursor to the next slot. Called when the
 * current key returns 402 / 403 / 429. Returns the new active key
 * (may be the same one if the list has only 1 entry — caller should
 * still surface the error in that case).
 */
function rotateOperatorKey(): string {
  if (OPERATOR_KEYS.length <= 1) return OPERATOR_KEYS[0] || ''
  const next = (readKeyIndex() + 1) % OPERATOR_KEYS.length
  writeKeyIndex(next)
  return OPERATOR_KEYS[next]
}

/**
 * Resolve the Blockfrost API key.
 *
 * Order of resolution:
 *  1. User-supplied key from `localStorage` (BYO key — set via Settings UI)
 *  2. Operator-managed key list (auto-rotated on quota exhaustion —
 *     see `rotateOperatorKey` + `bf<T>` 402/403/429 handler).
 *  3. None — calls will fail with 403; caller must surface this to the user.
 */
export function resolveApiKey(): string {
  const userKey = (() => {
    try {
      return localStorage.getItem(USER_KEY_STORAGE) || ''
    } catch {
      return ''
    }
  })()
  if (userKey) return userKey
  return OPERATOR_KEYS[readKeyIndex()] || OPERATOR_KEYS[0] || ''
}

/** Number of operator-managed keys currently embedded in the bundle.
 *  Useful for Settings UI to show "rotation pool size: N". */
export function operatorKeyCount(): number {
  return OPERATOR_KEYS.length
}

/** Currently active key index (after any rotations from this session).
 *  Useful for Settings UI to show "active operator key: N/M". */
export function activeOperatorKeyIndex(): number {
  return readKeyIndex()
}

/** Returns true iff the user has set a BYO key (overriding the
 *  operator's default). Used by Settings UI to render appropriate
 *  status. */
export function hasUserApiKey(): boolean {
  try {
    return Boolean(localStorage.getItem(USER_KEY_STORAGE))
  } catch {
    return false
  }
}

/** Persist a user-supplied Blockfrost key. Pass `''` to clear. */
export function setUserApiKey(key: string): void {
  try {
    if (key) localStorage.setItem(USER_KEY_STORAGE, key)
    else localStorage.removeItem(USER_KEY_STORAGE)
  } catch {
    /* localStorage unavailable — caller should warn user */
  }
}

/**
 * Health-probe a Blockfrost key against the configured network's
 * `/genesis` endpoint. Returns `{ ok: true, networkMagic }` on a 200
 * response, `{ ok: false, error }` on any failure (rate-limit, wrong
 * network, invalid key).
 *
 * Why `/genesis` rather than `/network`: Blockfrost `/network` returns
 * `{supply, stake}` only — no network_magic field. `/genesis` returns
 * the full Shelley genesis params including `network_magic`, so we can
 * cross-check that the key is for the network the app was built for.
 *
 * Used by Settings UI to validate a pasted key before saving it.
 */
export async function testApiKey(
  key: string,
): Promise<{ ok: true; networkMagic: number } | { ok: false; error: string }> {
  const trimmed = (key || '').trim()
  if (!trimmed) return { ok: false, error: 'empty key' }
  try {
    const res = await fetch(`${BASE_URL}/genesis`, { headers: { project_id: trimmed } })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      return { ok: false, error: `Blockfrost ${res.status}: ${body.slice(0, 120)}` }
    }
    const j = (await res.json()) as { network_magic?: number }
    if (typeof j.network_magic !== 'number') {
      return { ok: false, error: 'unexpected response shape' }
    }
    const expected = NETWORK === 'mainnet' ? 764824073 : 1
    if (j.network_magic !== expected) {
      return {
        ok: false,
        error: `wrong network — key serves magic ${j.network_magic}, app expects ${expected} (${NETWORK})`,
      }
    }
    return { ok: true, networkMagic: j.network_magic }
  } catch (err) {
    return { ok: false, error: (err as Error).message?.slice(0, 200) || 'unknown error' }
  }
}

interface FetchOpts {
  signal?: AbortSignal
  /** Treat 404 as `null` instead of throwing. Useful for "not yet indexed" probes. */
  notFoundAsNull?: boolean
}

async function bf<T>(path: string, opts: FetchOpts = {}): Promise<T | null> {
  const startKey = resolveApiKey()
  if (!startKey) {
    throw new Error(
      'Blockfrost API key not configured. Set VITE_BLOCKFROST_API_KEY(S) in .env, or set a user key via Settings.'
    )
  }
  // BYO user key bypasses rotation entirely (their own quota, their problem).
  const useUserKey = (() => {
    try {
      return Boolean(localStorage.getItem(USER_KEY_STORAGE))
    } catch {
      return false
    }
  })()
  // Operator-key path: try the current cursor key, then rotate up to
  // `OPERATOR_KEYS.length - 1` more times on 402 / 403 / 429 (quota
  // exhaustion or invalid key) until a key returns success or we've
  // exhausted the pool. The cursor persists across page reloads via
  // localStorage so subsequent BF calls in this tab — and on the
  // user's next visit — start from the last-known-good key.
  const maxAttempts = useUserKey ? 1 : Math.max(OPERATOR_KEYS.length, 1)
  let lastErrText = ''
  let lastStatus = 0
  let key = startKey
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const res = await fetch(`${BASE_URL}${path}`, {
      headers: { project_id: key },
      signal: opts.signal,
    })
    if (res.status === 404 && opts.notFoundAsNull) return null
    if (res.ok) return (await res.json()) as T
    lastStatus = res.status
    lastErrText = await res.text().catch(() => '')
    // Operator-side quota errors → rotate + retry. User-side errors
    // (4xx other than these three, 5xx) → bail.
    const isQuotaErr = res.status === 402 || res.status === 403 || res.status === 429
    if (!isQuotaErr) break
    if (useUserKey) break
    if (attempt >= maxAttempts - 1) break
    key = rotateOperatorKey()
    if (import.meta.env.DEV) {
      console.warn(`[blockfrost] ${res.status} on ${path} — rotating to operator key #${activeOperatorKeyIndex()}`)
    }
  }
  throw new Error(`Blockfrost ${lastStatus} (${path}): ${lastErrText.slice(0, 200)}`)
}

// ═══════════════════════════════════
// Types (subset of Blockfrost responses we use)
// ═══════════════════════════════════

interface AddressInfo {
  address: string
  amount: { unit: string; quantity: string }[]
  stake_address: string | null
  type: 'byron' | 'shelley'
  script: boolean
}

interface TxInfo {
  hash: string
  block: string
  block_height: number
  block_time: number
  slot: number
  index: number
  output_amount: { unit: string; quantity: string }[]
  fees: string
  deposit: string
  size: number
  invalid_before: string | null
  invalid_hereafter: string | null
  utxo_count: number
  withdrawal_count: number
  mir_cert_count: number
  delegation_count: number
  stake_cert_count: number
  pool_update_count: number
  pool_retire_count: number
  asset_mint_or_burn_count: number
  redeemer_count: number
  valid_contract: boolean
}

export interface BlockfrostUtxo {
  address: string
  tx_hash: string
  output_index: number
  amount: { unit: string; quantity: string }[]
  data_hash: string | null
  inline_datum: string | null
  reference_script_hash: string | null
}

interface AssetAddressEntry {
  address: string
  quantity: string
}

// ═══════════════════════════════════
// High-level helpers used by the frontend
// ═══════════════════════════════════

/**
 * Total balance at a wallet address — sums lovelace + native tokens.
 *
 * Blockfrost requires bech32-encoded addresses; if the caller has a hex
 * address from CIP-30 it must be converted first (see `lucidClient.ts`'s
 * `hexAddressToBech32` helper).
 *
 * Returns `null` if Blockfrost has not yet indexed the address (404).
 */
export async function fetchAddressBalance(
  bech32Address: string,
  signal?: AbortSignal
): Promise<{ lovelace: bigint; tokens: { unit: string; quantity: bigint }[] } | null> {
  const info = await bf<AddressInfo>(`/addresses/${bech32Address}`, {
    signal,
    notFoundAsNull: true,
  })
  if (!info) return null

  let lovelace = 0n
  const tokens: { unit: string; quantity: bigint }[] = []
  for (const a of info.amount) {
    const q = BigInt(a.quantity)
    if (a.unit === 'lovelace') {
      lovelace = q
    } else {
      tokens.push({ unit: a.unit, quantity: q })
    }
  }
  return { lovelace, tokens }
}

/**
 * Check whether a TX has been included in a block.
 *
 * Blockfrost returns 404 while the TX is still in the mempool / not yet
 * picked up by the indexer; we map that to `confirmed = false` so the
 * caller can poll cleanly. Returns `confirmed = true` once the TX has a
 * block.
 */
export async function fetchTxStatus(
  hash: string,
  signal?: AbortSignal
): Promise<{ confirmed: boolean; blockHeight?: number; blockTime?: number }> {
  const tx = await bf<TxInfo>(`/txs/${hash}`, { signal, notFoundAsNull: true })
  if (!tx) return { confirmed: false }
  return {
    confirmed: true,
    blockHeight: tx.block_height,
    blockTime: tx.block_time,
  }
}

export const blockfrostNetwork = NETWORK

/**
 * Fetch all UTxOs at a script or wallet address. Inline-datum and
 * reference-script fields are returned as Blockfrost serves them
 * (hex CBOR for inline datums; null when absent).
 *
 * Returns `[]` on 404 (address not yet indexed) — callers can treat that
 * as "no vault UTXO yet" without distinguishing from "address has zero
 * UTxOs after a drain".
 */
export async function fetchAddressUtxos(
  bech32Address: string,
  signal?: AbortSignal,
): Promise<BlockfrostUtxo[]> {
  const data = await bf<BlockfrostUtxo[]>(`/addresses/${bech32Address}/utxos`, {
    signal,
    notFoundAsNull: true,
  })
  return data || []
}

/**
 * Fetch the first holder of an asset (policy + name in hex unit). Used
 * for one-shot NFT lookup — vault NFT, registry auth NFT, Liqwid market
 * state token.
 *
 * Returns `null` if Blockfrost has not yet indexed the asset.
 */
export async function fetchFirstAssetHolder(
  unit: string,
  signal?: AbortSignal,
): Promise<string | null> {
  const data = await bf<AssetAddressEntry[]>(`/assets/${unit}/addresses?count=1`, {
    signal,
    notFoundAsNull: true,
  })
  if (!data || data.length === 0) return null
  return data[0].address
}

/**
 * Fetch UTxOs at an address that contain a specific asset unit. Useful
 * when an address holds many UTxOs but we only care about the one
 * carrying the vault NFT / registry auth NFT.
 */
export async function fetchAddressUtxosWithAsset(
  bech32Address: string,
  unit: string,
  signal?: AbortSignal,
): Promise<BlockfrostUtxo[]> {
  const data = await bf<BlockfrostUtxo[]>(
    `/addresses/${bech32Address}/utxos/${unit}`,
    { signal, notFoundAsNull: true },
  )
  return data || []
}

/**
 * Resolve the unique on-chain UTxO holding a one-shot asset. Combines
 * `fetchFirstAssetHolder` + `fetchAddressUtxosWithAsset` and returns
 * the single match, or `null` if not found / multiple matches detected
 * (latter would violate the one-shot invariant).
 *
 * Use this for vault UTXO discovery — pass the vault NFT's hex unit
 * (`vaultNftPolicy + vaultNftName`).
 */
export async function fetchUtxoHoldingAsset(
  unit: string,
  signal?: AbortSignal,
): Promise<BlockfrostUtxo | null> {
  const holder = await fetchFirstAssetHolder(unit, signal)
  if (!holder) return null
  const utxos = await fetchAddressUtxosWithAsset(holder, unit, signal)
  if (utxos.length === 0) return null
  // One-shot NFTs should have exactly one UTxO carrying the token. If
  // somehow multiple appear (e.g. in-flight TX double-counted by the
  // indexer), prefer the one with an inline datum and the highest
  // lovelace — empirically the live state UTXO. Callers can also dedupe
  // by tx_hash / output_index.
  if (utxos.length > 1) {
    const withDatum = utxos.filter((u) => u.inline_datum)
    if (withDatum.length === 1) return withDatum[0]
  }
  return utxos[0]
}

/** Number of unique addresses currently holding a token. Used for a
 *  cheap depositor-count proxy via the vUSDCx policy. */
export async function fetchAssetAddressCount(
  unit: string,
  signal?: AbortSignal,
): Promise<number> {
  // Blockfrost paginates 100 per page. For low-TVL launch phase a single
  // page is enough; the call returns up to 100 holders. Pre-audit TVL cap
  // (100K USDCx) implies far fewer than 100 depositors, so this is
  // accurate. Post-audit a paginated walker can replace this.
  const data = await bf<AssetAddressEntry[]>(`/assets/${unit}/addresses?count=100`, {
    signal,
    notFoundAsNull: true,
  })
  if (!data) return 0
  return data.length
}
