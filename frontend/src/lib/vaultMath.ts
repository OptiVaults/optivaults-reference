/**
 * Pure share-mint / burn / fee math — frontend mirror of
 * `keeper/src/utils/helpers.ts` + Aiken `lib/vault/validation.ak`.
 *
 * These are the EXACT formulas the on-chain validator enforces, so the
 * frontend can pre-compute expected mint / withdraw amounts and bound
 * `min_receive` slippage before submitting. Drift between this module
 * and `validation.ak` produces TX rejections at script eval time.
 */

/** Matches `initial_share_multiplier` in `lib/vault/constants.ak`. */
export const INITIAL_SHARE_MULTIPLIER = 1_000_000n

/** Matches `min_deposit` in `lib/vault/constants.ak` (10 USDCx). */
export const MIN_DEPOSIT = 10_000_000n

/** Min lovelace per V1 ceremony convention (vault, order UTXOs). */
export const MIN_VAULT_LOVELACE = 15_000_000n // SwapAda floor (ada_swap_min)
export const MIN_ORDER_LOVELACE = 2_000_000n  // Cardano min-UTxO

/** Default `max_batcher_tip` for queued orders — keeper claims at most
 *  this much lovelace from the order UTXO when folding. */
export const DEFAULT_MAX_BATCHER_TIP = 500_000n // 0.5 ADA

/** Default queued-order TTL (24h). */
export const DEFAULT_ORDER_EXPIRES_HOURS = 24n

/** Past margin for `validFrom` to absorb Preprod relay chain-tip lag.
 *  See feedback_lucid_evolution_v04_offchain_bugs.md — Preprod relay's
 *  current slot can lag wall-clock by 30-180s. */
export const VALID_FROM_PAST_MARGIN_MS = 180_000

/** Future window for `validTo` — generous bound so the TX has time to
 *  propagate + settle before validators reject on `lower > upper - 1h`. */
export const VALID_TO_FUTURE_WINDOW_MS = 10 * 60_000

// ════════════════════════════════════════════════════════════
// Mint / burn math (mirrors validation.ak verbatim)
// ════════════════════════════════════════════════════════════

/**
 * `calculate_shares_to_mint` — ERC-4626 proportional mint, with a fixed
 * 10⁶ multiplier on the very first deposit to bootstrap a non-zero
 * `total_shares`.
 *
 * Throws if `total_shares > 0` but `total_deposited <= 0` (impossible
 * on-chain; if observed, datum is corrupted).
 */
export function calculateSharesToMint(
  depositAmount: bigint,
  totalDeposited: bigint,
  totalShares: bigint,
): bigint {
  if (totalShares === 0n) {
    return depositAmount * INITIAL_SHARE_MULTIPLIER
  }
  if (totalDeposited <= 0n) {
    throw new Error(
      `calculateSharesToMint: total_deposited must be positive when total_shares > 0 ` +
      `(td=${totalDeposited}, ts=${totalShares})`,
    )
  }
  return (depositAmount * totalShares) / totalDeposited
}

/**
 * `calculate_withdraw_amount` — `shares × td / ts`. Integer floor
 * rounds toward the vault (favours existing holders + matches the
 * on-chain validator's rounding direction).
 */
export function calculateWithdrawAmount(
  sharesToBurn: bigint,
  totalDeposited: bigint,
  totalShares: bigint,
): bigint {
  if (totalShares <= 0n) {
    throw new Error(`calculateWithdrawAmount: total_shares must be > 0 (got ${totalShares})`)
  }
  return (sharesToBurn * totalDeposited) / totalShares
}

/** `calculate_early_fee` — `withdrawAmount × bps / 10_000`. */
export function calculateEarlyFee(withdrawAmount: bigint, earlyWithdrawFeeBps: bigint): bigint {
  return (withdrawAmount * earlyWithdrawFeeBps) / 10_000n
}

// ════════════════════════════════════════════════════════════
// Validity-range timing
// ════════════════════════════════════════════════════════════

/** Standard `(validFrom, validTo)` pair used by all V1 user-flow TXs.
 *  Past margin absorbs Preprod chain-tip lag; future window prevents
 *  the validator from rejecting on `upper - lower > 1h` width cap. */
export function defaultValidityRange(nowMs: number = Date.now()): {
  validFrom: number
  validTo: number
} {
  return {
    validFrom: nowMs - VALID_FROM_PAST_MARGIN_MS,
    validTo: nowMs + VALID_TO_FUTURE_WINDOW_MS,
  }
}

// ════════════════════════════════════════════════════════════
// Keeper-inactive waiver detection
// ════════════════════════════════════════════════════════════

/** `keeper_inactive_ms` from `constants.ak`. After this much elapsed since
 *  `last_compound_time`, contract waives `early_withdraw_fee_bps` to 0. */
export const KEEPER_INACTIVE_MS = 7n * 86_400n * 1_000n

/** Validators reject inputs with `last_compound_time < min_valid_timestamp_ms`
 *  to defend against bootstrap zero values; mirror the constant here. */
export const MIN_VALID_TIMESTAMP_MS = 1_700_000_000_000n

/**
 * Off-chain mirror of `vault_user.ak::Withdraw::keeper_inactive`.
 * If true, the contract treats `early_withdraw_fee_bps = 0` regardless
 * of the datum's value — caller must compute `withdraw_amount =
 * baseWithdraw - 0 = baseWithdraw` to match.
 *
 * `validFromMs` should equal the TX's `validFrom` parameter (which the
 * validator reads as `tx.validity_range.lower_bound`).
 */
export function isKeeperInactive(
  lastCompoundTime: bigint,
  validFromMs: number,
): boolean {
  return (
    lastCompoundTime > MIN_VALID_TIMESTAMP_MS &&
    BigInt(validFromMs) >= lastCompoundTime + KEEPER_INACTIVE_MS
  )
}
