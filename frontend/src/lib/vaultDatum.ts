/**
 * V1 VaultDatum decoder for the frontend.
 *
 * Field order MUST mirror `contracts/lib/vault/types.ak::VaultDatum` (29
 * fields including the `community_sunset_triggered` flag). Drift
 * between this file and the on-chain enum produces silent decode
 * failures that surface as "vault not found" in the UI.
 *
 * This module uses `Data.from(cbor, Schema)` from `@lucid-evolution/lucid`,
 * which parses Plutus Data CBOR with schema validation. It runs in
 * pure JS (no WASM init) — Lucid Evolution loads the Data layer ahead
 * of the heavier CML / UPLC layers, so vault state can render before
 * the wallet bundle is needed.
 */

let _Data: any = null
async function loadData() {
  if (!_Data) {
    const mod = await import('@lucid-evolution/lucid')
    _Data = mod.Data
  }
  return _Data
}

// ════════════════════════════════════════════════════════════
// Schema definitions — mirror keeper/src/types/vaultDatum.ts
// ════════════════════════════════════════════════════════════

let _VaultDatumSchema: any = null

async function getVaultDatumSchema() {
  if (_VaultDatumSchema) return _VaultDatumSchema
  const Data = await loadData()

  const AllocationSchema = Data.Object({
    protocol: Data.Enum([
      Data.Literal('Liqwid'),
      Data.Literal('MinswapLP'),
      Data.Literal('SundaeSwapLP'),
    ]),
    amount: Data.Integer(),
    expected_apy_bps: Data.Integer(),
  })

  const LiqwidPositionSchema = Data.Object({
    market_id: Data.Integer(),
    qtokens_held: Data.Integer(),
    supplied_value: Data.Integer(),
  })

  _VaultDatumSchema = Data.Object({
    // — Accounting (10) —
    total_deposited: Data.Integer(),
    total_shares: Data.Integer(),
    idle_buffer: Data.Integer(),
    non_deposit_value: Data.Integer(),
    last_compound_time: Data.Integer(),
    last_realloc_time: Data.Integer(),
    last_fee_update_time: Data.Integer(),
    last_ada_swap_time: Data.Integer(),
    strategy_allocations: Data.Array(AllocationSchema),
    liqwid_positions: Data.Array(LiqwidPositionSchema),

    // — Policy (8) —
    performance_fee_bps: Data.Integer(),
    early_withdraw_fee_bps: Data.Integer(),
    min_hold_seconds: Data.Integer(),
    buffer_target_bps: Data.Integer(),
    keeper_fee_bps: Data.Integer(),
    gov_fee_bps: Data.Integer(),
    max_slippage_bps: Data.Integer(),
    min_swap_peg_bps: Data.Integer(),

    // — Identity, immutable (9) —
    vault_version: Data.Integer(),
    governance_policy: Data.Bytes(),
    governance_name: Data.Bytes(),
    deposit_token_policy: Data.Bytes(),
    deposit_token_name: Data.Bytes(),
    vusdcx_policy: Data.Bytes(),
    order_script_hash: Data.Bytes(),
    registry_hash: Data.Bytes(),
    registry_auth_policy: Data.Bytes(),

    // — Operational (2) —
    frozen: Data.Integer(),
    /// Phase 1 governance safety — Layer 3 dead-man-switch flag.
    /// 0→1 by `CommunitySunset` after ≥ 90d operational inactivity.
    community_sunset_triggered: Data.Integer(),
  })
  return _VaultDatumSchema
}

// ════════════════════════════════════════════════════════════
// Public types
// ════════════════════════════════════════════════════════════

export interface Allocation {
  protocol: 'Liqwid' | 'MinswapLP' | 'SundaeSwapLP'
  amount: bigint
  expected_apy_bps: bigint
}

export interface LiqwidPosition {
  market_id: bigint
  qtokens_held: bigint
  supplied_value: bigint
}

export interface VaultDatum {
  // Accounting
  total_deposited: bigint
  total_shares: bigint
  idle_buffer: bigint
  non_deposit_value: bigint
  last_compound_time: bigint
  last_realloc_time: bigint
  last_fee_update_time: bigint
  last_ada_swap_time: bigint
  strategy_allocations: Allocation[]
  liqwid_positions: LiqwidPosition[]

  // Policy
  performance_fee_bps: bigint
  early_withdraw_fee_bps: bigint
  min_hold_seconds: bigint
  buffer_target_bps: bigint
  keeper_fee_bps: bigint
  gov_fee_bps: bigint
  max_slippage_bps: bigint
  min_swap_peg_bps: bigint

  // Identity (immutable)
  vault_version: bigint
  governance_policy: string
  governance_name: string
  deposit_token_policy: string
  deposit_token_name: string
  vusdcx_policy: string
  order_script_hash: string
  registry_hash: string
  registry_auth_policy: string

  // Operational
  frozen: bigint
  community_sunset_triggered: bigint
}

// ════════════════════════════════════════════════════════════
// Decode + sanity
// ════════════════════════════════════════════════════════════

/**
 * Parse a Plutus inline-datum CBOR hex string into a VaultDatum.
 * Returns null on any decode error (caller should treat as "vault state
 * unavailable"). Raises only programmer errors (Lucid not loadable).
 */
export async function parseVaultDatum(cborHex: string): Promise<VaultDatum | null> {
  try {
    const Data = await loadData()
    const schema = await getVaultDatumSchema()
    const parsed = Data.from(cborHex, schema as unknown as never) as unknown as VaultDatum
    return parsed
  } catch (err) {
    if (import.meta.env.DEV) {
      console.warn('[vaultDatum] parse failed:', (err as Error).message?.slice(0, 200))
    }
    return null
  }
}

/** True iff vault is currently in emergency-frozen state. */
export function isFrozen(d: VaultDatum): boolean {
  return d.frozen === 1n
}

/** True iff Phase 1 Layer 3 dead-man-switch has fired. */
export function isSunset(d: VaultDatum): boolean {
  return d.community_sunset_triggered === 1n
}

/**
 * Compute share price = `total_deposited / total_shares` as a JS number
 * (with the standard 1e6 share-price multiplier).
 *
 * First-depositor era: total_shares = 0 → price = 1.0e-6 reference.
 */
export function sharePrice(d: VaultDatum): number {
  if (d.total_shares === 0n) return 1.0e-6
  // Multiply numerator first to preserve precision before BigInt → Number.
  return Number(d.total_deposited * 1_000_000n / d.total_shares) / 1_000_000_000_000
}

/**
 * Vault-side TVL in raw deposit-token units (USDCx microunits).
 * Differs from `idle_buffer + supplied` because `liqwid_positions[].supplied_value`
 * is the principal recorded at supply time; on-chain qToken accrual is
 * unrealized until a Compound run.
 */
export function tvlRaw(d: VaultDatum): bigint {
  return d.total_deposited
}

/** Sum of `liqwid_positions[].supplied_value`. */
export function liqwidPrincipalRaw(d: VaultDatum): bigint {
  return d.liqwid_positions.reduce((acc, p) => acc + p.supplied_value, 0n)
}
