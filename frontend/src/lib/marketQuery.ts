/**
 * Direct on-chain Liqwid market query — replaces the operator API
 * server's `GET /api/market` endpoint.
 *
 * Strategy:
 *   1. Locate the Liqwid MarketState UTxO via its policy NFT.
 *   2. Decode the inline-datum (Plutus Data list) for supply / borrow /
 *      qToken-rate fields.
 *   3. Approximate APY using Liqwid's published USDCx kink model
 *      (base 5% + utilization × multiplier 22.2%; jump rate 300% above
 *      kink 90%; reserve factor 10%).
 *   4. Blend with vault on-chain `liqwid_positions[].supplied_value`
 *      against `total_deposited` to compute the gross strategy APY,
 *      then apply `performance_fee_bps` for the net figure.
 *
 * Caveat: Liqwid runs multiple market shards per asset and operators
 * may add new markets via governance. V1 launch points at a single
 * primary market via `VITE_LIQWID_MARKET_POLICY`. Multi-market support
 * (weighted across all `liqwid_positions`) is straightforward to add
 * once a registry-driven market enumeration is wired in — for now,
 * single-market output is the conservative baseline and matches the
 * keeper's `apyMonitor.ts` shape so Dashboard / ApyChart render the
 * same numbers as before.
 */

import { fetchUtxoHoldingAsset } from './blockfrost'
import { V1_CONFIG } from './v1Config'

let _Data: any = null
let _Constr: any = null
async function loadDataConstr() {
  if (!_Data || !_Constr) {
    const mod = await import('@lucid-evolution/lucid')
    _Data = mod.Data
    _Constr = mod.Constr
  }
  return { Data: _Data, Constr: _Constr }
}

// ────────────────────────────────────────────────────────────
// Liqwid kink-model parameters (from governance proposal)
// ────────────────────────────────────────────────────────────
const KINK_BASE_RATE = 5.0           // 5%
const KINK_UTIL_MULT = 22.2          // 22.2%
const KINK_JUMP_MULT = 300.0         // 300%
const KINK_AT = 90.0                 // 90% utilization
const RESERVE_FACTOR = 0.10          // 10%

export interface MarketSnapshot {
  /** True iff a MarketState UTxO was found and decoded successfully. */
  exists: boolean
  /** Liqwid MarketState NFT unit (`policy + name`). */
  marketUnit: string
  /** Total supply (USDCx microunits, before reserve factor). */
  totalSupply: number
  /** Total borrowed (principal + interest, microunits). */
  totalBorrowed: number
  /** Borrowed / (supply + borrowed) as percentage 0-100. */
  utilization: number
  /** Liqwid `qTokenRate` numerator / denominator. Used to convert
   *  `supplied_value` into current underlying value. */
  qTokenRate: [number, number]
  /** Estimated borrow APY using kink model (percentage). */
  borrowAPY: number
  /** Estimated supply APY (percentage, after 10% reserve factor). */
  supplyAPY: number
  /** Vault-blended gross APY: weighted average of supply APY across
   *  vault `liqwid_positions[]` plus 0% on idle_buffer. */
  blendedApy: number
  /** Net APY after `performance_fee_bps`. */
  netBlendedApy: number
}

// ────────────────────────────────────────────────────────────
// Plutus Data extraction helpers
// ────────────────────────────────────────────────────────────

/**
 * Walk a generic Plutus Data tree, returning the inner list of fields
 * for a Constr-or-list shape. Liqwid's MarketState datum has been
 * observed to wrap fields in a 0-tagged Constr; some encoders emit a
 * bare list. We accept both rather than guessing.
 */
async function extractFields(datumCbor: string): Promise<unknown[] | null> {
  try {
    const { Data, Constr } = await loadDataConstr()
    const parsed = Data.from(datumCbor) as unknown
    if (parsed instanceof Constr) {
      return (parsed as { fields: unknown[] }).fields
    }
    if (Array.isArray(parsed)) {
      return parsed as unknown[]
    }
    if (import.meta.env.DEV) {
      console.warn('[marketQuery] unexpected datum shape:', typeof parsed, parsed)
    }
    return null
  } catch (err) {
    if (import.meta.env.DEV) {
      console.warn('[marketQuery] datum decode failed:', (err as Error).message?.slice(0, 200))
    }
    return null
  }
}

function asBigInt(v: unknown): bigint {
  if (typeof v === 'bigint') return v
  if (typeof v === 'number') return BigInt(Math.floor(v))
  if (typeof v === 'string') {
    try { return BigInt(v) } catch { return 0n }
  }
  return 0n
}

function asRatio(v: unknown): [bigint, bigint] {
  // Liqwid encodes rates as a 2-field Constr OR a 2-element list.
  if (v && typeof v === 'object' && 'fields' in (v as any) && Array.isArray((v as any).fields)) {
    const f = (v as any).fields as unknown[]
    if (f.length >= 2) return [asBigInt(f[0]), asBigInt(f[1])]
  }
  if (Array.isArray(v) && v.length >= 2) {
    return [asBigInt(v[0]), asBigInt(v[1])]
  }
  return [0n, 1n]
}

function kinkBorrowApy(utilizationPct: number): number {
  if (utilizationPct < KINK_AT) {
    return KINK_BASE_RATE + (utilizationPct / 100) * KINK_UTIL_MULT
  }
  return (
    KINK_BASE_RATE
    + (KINK_AT / 100) * KINK_UTIL_MULT
    + ((utilizationPct - KINK_AT) / 100) * KINK_JUMP_MULT
  )
}

// ────────────────────────────────────────────────────────────
// Public query
// ────────────────────────────────────────────────────────────

/**
 * Vault accounting slice needed to compute the blended APY off-chain.
 * Pass `null` to fall back to single-market `supplyAPY` only (no
 * weighting against vault state).
 */
export interface VaultAccountingForApy {
  /** Total deposited (USDCx microunits). */
  totalDeposited: number
  /** Sum of `liqwid_positions[].supplied_value` (microunits). */
  liqwidPrincipal: number
  /** Performance fee bps (0..450 cap). */
  performanceFeeBps: number
}

// Module-level cache for the resolved Liqwid market snapshot. The
// MarketState UTXO and its kink-model parameters are slow-moving;
// utilization shifts only when other Liqwid users supply/borrow, which
// for practical user-facing APY display is fine to lag by 30 s.
//
// Key by `vaultDeposited|vaultLiqwidPrincipal|feeBps` so the cached
// snapshot reflects the same vault state the caller passed; if the
// vault state changes (e.g. user deposits + total_deposited grows),
// blended APY recalculates against the new shape on the very next call
// instead of serving the stale weighting.
const MARKET_SNAPSHOT_TTL_MS = 30_000
let _marketSnapshotCache: { key: string; value: MarketSnapshot; fetchedAtMs: number } | null = null

function vaultCacheKey(vault: VaultAccountingForApy | null): string {
  if (!vault) return 'no-vault'
  return `${vault.totalDeposited}|${vault.liqwidPrincipal}|${vault.performanceFeeBps}`
}

/** Drop the cached market snapshot. Call after any TX that changes
 *  vault state in a way the kink-model output would notice (deposits
 *  shifting liqwid_principal share, governance changing fee bps). */
export function invalidateMarketSnapshotCache(): void {
  _marketSnapshotCache = null
}

/**
 * Compute a vault-aware market snapshot. Pass the live vault accounting
 * slice so `blendedApy` reflects current liqwid_positions weighted vs
 * idle_buffer (which is at 0% APY by definition).
 *
 * Resolves to `null` if no Liqwid market is configured (operator
 * intentionally disabled the on-chain APY estimate) or if Blockfrost
 * has not yet indexed the MarketState UTxO.
 */
export async function queryMarketSnapshot(
  vault: VaultAccountingForApy | null,
  signal?: AbortSignal,
): Promise<MarketSnapshot | null> {
  if (!V1_CONFIG.liqwidMarketPolicy) return null
  const cacheKey = vaultCacheKey(vault)
  if (
    _marketSnapshotCache &&
    _marketSnapshotCache.key === cacheKey &&
    Date.now() - _marketSnapshotCache.fetchedAtMs < MARKET_SNAPSHOT_TTL_MS
  ) {
    return _marketSnapshotCache.value
  }
  // Liqwid MarketState typically uses an empty asset name (one-shot
  // policy) — operators who run a custom market with a different name
  // can override `VITE_LIQWID_MARKET_NAME` later. For now the unit is
  // `policy + ""` which Blockfrost interprets as the policy's
  // implicit-empty-name asset.
  const marketUnit = V1_CONFIG.liqwidMarketPolicy
  const utxo = await fetchUtxoHoldingAsset(marketUnit, signal)
  if (!utxo || !utxo.inline_datum) return null

  const fields = await extractFields(utxo.inline_datum)
  if (!fields || fields.length < 11) {
    if (import.meta.env.DEV) {
      console.warn('[marketQuery] datum has only', fields?.length ?? 0, 'fields (need 11+)')
    }
    return null
  }

  const supply = asBigInt(fields[0])
  const principal = asBigInt(fields[3])
  const interest = asBigInt(fields[4])
  const totalBorrowed = principal + interest
  const totalAssets = supply + totalBorrowed
  // Precise utilization to 0.01%
  const utilizationPct = totalAssets > 0n
    ? Number(totalBorrowed * 10000n / totalAssets) / 100
    : 0
  const qTokenRate = asRatio(fields[9])

  const borrowAPY = kinkBorrowApy(utilizationPct)
  const supplyAPY = borrowAPY * (utilizationPct / 100) * (1 - RESERVE_FACTOR)

  // Vault-aware blended APY: idle buffer at 0%, every Liqwid position
  // earning supplyAPY (single-market approximation — multi-market would
  // weight per-position rates separately, see file header note). The
  // result matches the keeper's pre-fee blended figure.
  let blendedApy = supplyAPY // fallback when vault state unavailable
  if (vault && vault.totalDeposited > 0) {
    const liqwidShare = Math.min(vault.liqwidPrincipal / vault.totalDeposited, 1)
    // Idle buffer + non-deposit-value contribute 0% (USDCx idle, or
    // staged stable tokens not yet deployed).
    blendedApy = supplyAPY * liqwidShare
  }

  // Net APY after performance fee (bps → fraction).
  const feeBps = vault ? vault.performanceFeeBps : 0
  const netBlendedApy = blendedApy * (1 - feeBps / 10000)

  const snapshot: MarketSnapshot = {
    exists: true,
    marketUnit,
    totalSupply: Number(supply),
    totalBorrowed: Number(totalBorrowed),
    utilization: utilizationPct,
    qTokenRate: [Number(qTokenRate[0]), Number(qTokenRate[1])],
    borrowAPY,
    supplyAPY,
    blendedApy,
    netBlendedApy,
  }
  _marketSnapshotCache = { key: cacheKey, value: snapshot, fetchedAtMs: Date.now() }
  return snapshot
}
