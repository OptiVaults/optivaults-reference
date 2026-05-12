/**
 * Direct on-chain vault state query — replaces the operator API server's
 * `GET /api/vault-state` endpoint.
 *
 * The vault UTxO is the unique UTxO at `proxy.address` carrying the
 * one-shot vault NFT. We discover it by asset lookup (`fetchUtxoHoldingAsset`)
 * rather than scanning every UTxO at the proxy address — at low TVL the
 * proxy may have other no-datum UTxOs (small ADA donations awaiting
 * MergeUtxo) and asset-based lookup is unambiguous.
 *
 * Returned shape mirrors the API server's `/api/vault-state` payload so
 * `useCardano` can swap implementations without UI churn.
 */

import { fetchUtxoHoldingAsset, fetchAssetAddressCount, type BlockfrostUtxo } from './blockfrost'
import { V1_CONFIG, V1_VAULT_NFT_UNIT, V1_VUSDCX_UNIT, isV1Configured } from './v1Config'
import {
  parseVaultDatum,
  sharePrice as computeSharePrice,
  liqwidPrincipalRaw,
  type VaultDatum,
} from './vaultDatum'

export interface VaultStateResponse {
  exists: boolean
  vaultAddr: string
  vusdcxPolicyId: string
  /** Total deposited (USDCx microunits). */
  totalDeposited: number
  /** Total shares (vUSDCx raw units). */
  totalShares: number
  /** Idle buffer (USDCx microunits). */
  idleBuffer: number
  /** Non-deposit-token value held in vault (other stable tokens, microunits). */
  nonDepositValue: number
  /** Share price = total_deposited / total_shares × 1e-6 reference. */
  sharePrice: number
  /** Performance fee (bps, 0..450 cap). */
  performanceFeeBps: number
  /** Early-withdraw fee (bps, 0..100 cap). */
  earlyWithdrawFeeBps: number
  /** Buffer target (bps, e.g. 3500 = 35%). */
  bufferTargetBps: number
  /** Frozen flag (Layer 1 governance safety). */
  frozen: boolean
  /** Phase 1 Layer 3 dead-man-switch flag. */
  communitySunsetTriggered: boolean
  /** Unique vUSDCx holders — proxy for depositor count. */
  depositorCount: number
  /** Last on-chain Compound time (ms). */
  lastCompoundTime: number
  /** Unrealized yield total (USDCx microunits) — qToken rate accrual not
   *  yet realized into total_deposited via Compound. Computed off-chain
   *  if a Liqwid market is configured; otherwise 0. */
  unrealizedYieldTotal: number
  /** Sum of `liqwid_positions[].supplied_value` (USDCx microunits).
   *  Used by `marketQuery.queryMarketSnapshot` to weight blended APY. */
  liqwidPrincipal: number
  /** Hex28 — deposit-token (USDCx-equivalent) minting policy. Read from
   *  the live VaultDatum so wallet balance scans match the operator's
   *  ceremony exactly, regardless of the build-time `VITE_DEPOSIT_TOKEN_*`
   *  env override. */
  depositTokenPolicy: string
  /** Hex — deposit-token asset name. */
  depositTokenName: string
  /** Hex unit (`policy + name`) — convenience for asset lookup. */
  depositTokenUnit: string
  /** Original VaultDatum — exposed for advanced UI (governance, etc.). */
  datum: VaultDatum
}

const STATE_FETCH_TIMEOUT_MS = 12_000

// Module-level cache for the resolved vault state. The frontend has
// two independent polling loops that both read this:
//   - useCardano.refreshVault() → 30s interval
//   - Dashboard.queryMarketSnapshot() effect on vault state changes
// Plus pre-flight reads from buildDirectDepositTx / buildDirectWithdrawTx.
// Without caching, each independent reader issues 2-3 Blockfrost
// requests (NFT lookup + datum decode + depositor count) and a single
// idle Dashboard tab burns ~360 requests/hour.
//
// 15-second TTL is short enough that vault state drift remains
// invisible to UX (next 30s poll picks up fresh data anyway), and long
// enough that all readers within one polling burst share the result.
// Invalidation is via `invalidateVaultStateCache()` which the TX
// submission paths call after deposit/withdraw so the user's wallet
// sees the post-TX state immediately on next refresh instead of
// waiting up to 15s.
const VAULT_STATE_TTL_MS = 15_000
let _vaultStateCache: { value: VaultStateResponse; fetchedAtMs: number } | null = null

/** Drop the cached vault state. Call after a successful TX submit so
 *  the next refreshVault() picks up the new total_deposited /
 *  total_shares / idle_buffer immediately. */
export function invalidateVaultStateCache(): void {
  _vaultStateCache = null
}

/**
 * Read live vault state from chain via Blockfrost. Throws only on config
 * errors (not configured); resolves to `null` on transient indexer
 * misses (caller polls again) and to a populated response on success.
 *
 * Cached at module scope with a 15s TTL — see VAULT_STATE_TTL_MS above.
 */
export async function queryVaultState(
  signal?: AbortSignal,
): Promise<VaultStateResponse | null> {
  if (_vaultStateCache && Date.now() - _vaultStateCache.fetchedAtMs < VAULT_STATE_TTL_MS) {
    return _vaultStateCache.value
  }
  if (!isV1Configured()) {
    throw new Error(
      'V1 deployment not configured — set VITE_PROXY_ADDR / VITE_VAULT_NFT_POLICY / VITE_VUSDCX_POLICY (or fork-edit src/lib/v1Config.ts).',
    )
  }

  // 1. Locate the unique vault UTxO via the one-shot vault NFT
  const utxo = await fetchUtxoHoldingAsset(V1_VAULT_NFT_UNIT, signal)
  if (!utxo) return null
  if (!utxo.inline_datum) {
    if (import.meta.env.DEV) {
      console.warn('[vaultQuery] vault UTXO found but no inline_datum (data_hash=%s)', utxo.data_hash)
    }
    return null
  }

  // 2. Decode the 29-field VaultDatum
  const datum = await parseVaultDatum(utxo.inline_datum)
  if (!datum) return null

  // 3. Derived fields
  const sharePrice = computeSharePrice(datum)
  const lastCompoundTime = Number(datum.last_compound_time)

  // 4. Cheap depositor-count proxy via vUSDCx holders. Pre-audit cap is
  //    100K USDCx so single-page (100 holders) is exact; keep within
  //    Blockfrost free-tier budget by skipping when policy missing.
  let depositorCount = 0
  if (V1_VUSDCX_UNIT) {
    try {
      depositorCount = await fetchAssetAddressCount(V1_VUSDCX_UNIT, signal)
    } catch {
      depositorCount = 0
    }
  }

  const value: VaultStateResponse = {
    exists: true,
    vaultAddr: V1_CONFIG.proxyAddr,
    vusdcxPolicyId: V1_CONFIG.vusdcxPolicy,
    totalDeposited: Number(datum.total_deposited),
    totalShares: Number(datum.total_shares),
    idleBuffer: Number(datum.idle_buffer),
    nonDepositValue: Number(datum.non_deposit_value),
    sharePrice,
    performanceFeeBps: Number(datum.performance_fee_bps),
    earlyWithdrawFeeBps: Number(datum.early_withdraw_fee_bps),
    bufferTargetBps: Number(datum.buffer_target_bps),
    frozen: datum.frozen === 1n,
    communitySunsetTriggered: datum.community_sunset_triggered === 1n,
    depositorCount,
    lastCompoundTime,
    // Unrealized yield is a Liqwid-side number computed against live
    // qToken rate; left at 0 here and populated separately in
    // marketQuery / a follow-up cycle to keep this single-asset query
    // shape unchanged.
    unrealizedYieldTotal: 0,
    liqwidPrincipal: Number(liqwidPrincipalRaw(datum)),
    depositTokenPolicy: datum.deposit_token_policy,
    depositTokenName: datum.deposit_token_name,
    depositTokenUnit: datum.deposit_token_policy + datum.deposit_token_name,
    datum,
  }
  _vaultStateCache = { value, fetchedAtMs: Date.now() }
  return value
}

export { STATE_FETCH_TIMEOUT_MS }
/** Re-export so callers don't need to also import vaultDatum. */
export type { VaultDatum, BlockfrostUtxo }
