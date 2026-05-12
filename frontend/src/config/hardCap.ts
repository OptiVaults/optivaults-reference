/// Pre-audit TVL hard cap — operator-enforced ceiling.
///
/// Documented in whitepaper §8.1 ("Pre-audit TVL risk-bounding commitment").
/// The cap is NOT a contract field — it is enforced by this frontend
/// gating deposits, the keeper TVL monitor alerting governance, and
/// the governance backstop (EmergencyWithdraw) in the worst case.
///
/// Critically, Withdraw is NEVER gated. Users can always exit
/// regardless of cap status.

/**
 * Pre-audit TVL ceiling in USDCx base units (6-decimal).
 *
 * `100_000_000_000n` = 100,000 USDCx. We treat the cap in USDCx face
 * value rather than requiring a live USD oracle — USDCx targets $1
 * and the cap is a risk-bounding policy, not a financial guarantee.
 * If USDCx depegs materially, the governance backstop can adjust.
 */
export const PRE_AUDIT_TVL_CAP_USDCX = 100_000_000_000n

/**
 * Warn threshold: surface an amber cap-near banner once utilization
 * crosses this fraction. Keeps users from hitting an abrupt "no" at
 * the very last basis point.
 */
export const PRE_AUDIT_TVL_WARN_RATIO = 0.9 // 90%

/**
 * Governance backstop threshold: if live `total_deposited` exceeds
 * cap by more than this fraction (i.e. over-cap by ≥5%), the keeper
 * monitor alerts governance for a best-effort prompt review.
 */
export const PRE_AUDIT_TVL_BREACH_RATIO = 1.05 // 105% of cap

/**
 * Display helper — formats the cap in human-readable USDCx.
 */
export function formatCapUsdcx(): string {
  return (Number(PRE_AUDIT_TVL_CAP_USDCX) / 1e6).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })
}

/**
 * Check whether a prospective deposit would breach the cap.
 *
 * @param totalDeposited current `vault.totalDeposited` in USDCx base units
 * @param depositAmount  prospective deposit amount in USDCx base units
 */
export function wouldBreachCap(totalDeposited: bigint, depositAmount: bigint): boolean {
  return totalDeposited + depositAmount > PRE_AUDIT_TVL_CAP_USDCX
}

/**
 * Check whether the vault is currently at or above the cap (any
 * additional deposit is blocked).
 */
export function isAtCap(totalDeposited: bigint): boolean {
  return totalDeposited >= PRE_AUDIT_TVL_CAP_USDCX
}

/**
 * Utilization ratio in [0, 1+] range. Values > 1 indicate an
 * over-cap breach that should trigger the keeper monitor.
 */
export function capUtilization(totalDeposited: bigint): number {
  if (Number(PRE_AUDIT_TVL_CAP_USDCX) === 0) return 0
  return Number(totalDeposited) / Number(PRE_AUDIT_TVL_CAP_USDCX)
}

/**
 * Remaining headroom in USDCx base units. Returns 0n if at or over
 * cap (never negative — the monitor layer handles over-cap state).
 */
export function capHeadroom(totalDeposited: bigint): bigint {
  if (totalDeposited >= PRE_AUDIT_TVL_CAP_USDCX) return 0n
  return PRE_AUDIT_TVL_CAP_USDCX - totalDeposited
}
