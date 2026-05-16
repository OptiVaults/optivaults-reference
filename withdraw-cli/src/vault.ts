/**
 * V1 vault state query + Withdraw-Zero TX builder + CommunitySunset
 * (Layer 3 90-day dead-man-switch) TX builder.
 *
 * V1 contract surface:
 *   - 29-field VaultDatum (liqwid_positions, non_deposit_value,
 *     last_realloc_time, last_fee_update_time, last_ada_swap_time,
 *     keeper_fee_bps, gov_fee_bps, max_slippage_bps, min_swap_peg_bps,
 *     community_sunset_triggered)
 *   - Withdraw redeemer: Constr(1, [shares, receiver, receiver_output_idx]) —
 *     receiver_output_idx pins the payout output index, defending against
 *     output double-satisfaction
 *   - Withdraw routes through the `vault_user` staking validator (the
 *     user-flow validators are split into `vault_user` + `vault_keeper_hot`)
 *   - vault_proxy.UseUser = Constr(0, [])
 *   - vault_nft_policy is a compile-time anchor, not a datum field;
 *     vault is identified via NFT scan at proxy address
 *   - CommunitySunset = Constr(3, []) — permissionless redeemer; sets
 *     frozen=1 + community_sunset_triggered=1 after ≥90d operational inactivity
 *
 * V1 Withdraw TX structure (Withdraw-Zero pattern, 3 ref scripts):
 *   - Spend vault UTXO at proxy address with ProxyRedeemer::UseUser
 *   - Withdraw 0 lovelace from `vault_user` reward address with
 *     VaultRedeemer::Withdraw(shares, receiver, receiver_output_idx)
 *   - Burn vUSDCx with MintRedeemer::BurnShares = Constr(1, [])
 *   - Output updated vault datum back to proxy address
 *   - Output USDCx to receiver (must equal output index passed in redeemer)
 *
 * V1 CommunitySunset TX structure:
 *   - Spend vault UTXO at proxy address with ProxyRedeemer::UseUser
 *   - Withdraw 0 lovelace from `vault_user` reward address with
 *     VaultRedeemer::CommunitySunset = Constr(3, [])
 *   - Output vault datum with frozen=1 + community_sunset_triggered=1
 *     (everything else unchanged)
 *   - Caller's wallet input must contain ≥1 vUSDCx (validator scans inputs
 *     for vUSDCx-bearing wallet UTXO)
 *
 * Both flows preserve the vault NFT in the continuing output by virtue
 * of `vaultAssets` being a copy of the input UTXO's assets minus the
 * deposit-token delta (Withdraw only) — NFT stays put.
 */

import {
  Blockfrost,
  Lucid,
  Data,
  Constr,
  paymentCredentialOf,
  credentialToRewardAddress,
  scriptHashToCredential,
  type LucidEvolution,
  type UTxO,
} from '@lucid-evolution/lucid'
import type { V1Config } from './config.js'
import { makeDepositUnit } from './config.js'

// ─────────────────────────────────────────────────────────────────
// VaultDatum decode (29 fields, V1 layout)
// ─────────────────────────────────────────────────────────────────

/** V1 VaultDatum field indices. Mirror lib/vault/types.ak::VaultDatum
 *  declaration order. Drift = silent decode failure. */
const VF = {
  // Accounting (10)
  total_deposited: 0,
  total_shares: 1,
  idle_buffer: 2,
  non_deposit_value: 3,
  last_compound_time: 4,
  last_realloc_time: 5,
  last_fee_update_time: 6,
  last_ada_swap_time: 7,
  strategy_allocations: 8,
  liqwid_positions: 9,

  // Policy (8)
  performance_fee_bps: 10,
  early_withdraw_fee_bps: 11,
  min_hold_seconds: 12,
  buffer_target_bps: 13,
  keeper_fee_bps: 14,
  gov_fee_bps: 15,
  max_slippage_bps: 16,
  min_swap_peg_bps: 17,

  // Identity (immutable, 9)
  vault_version: 18,
  governance_policy: 19,
  governance_name: 20,
  deposit_token_policy: 21,
  deposit_token_name: 22,
  vusdcx_policy: 23,
  order_script_hash: 24,
  registry_hash: 25,
  registry_auth_policy: 26,

  // Operational (2)
  frozen: 27,
  community_sunset_triggered: 28,
} as const

export interface LiqwidPosition {
  marketId: bigint
  qtokensHeld: bigint
  suppliedValue: bigint
}

export interface VaultState {
  totalDeposited: bigint
  totalShares: bigint
  idleBuffer: bigint
  nonDepositValue: bigint
  lastCompoundTime: bigint
  lastReallocTime: bigint
  earlyWithdrawFeeBps: bigint
  vaultVersion: bigint
  frozen: bigint
  communitySunsetTriggered: bigint
  depositTokenPolicy: string
  depositTokenName: string
  liqwidPositions: LiqwidPosition[]
  rawDatum: string
  utxo: UTxO
}

export interface WithdrawQuote {
  shares: bigint
  baseWithdraw: bigint
  earlyFee: bigint
  netWithdraw: bigint
  keeperInactive: boolean
}

export interface SunsetStatus {
  /// `max(last_compound_time, last_realloc_time)` — the inactivity anchor.
  lastActivityMs: bigint
  /// Days elapsed since last activity at the time the status was queried.
  daysSinceActivity: number
  /// Days remaining until the 90-day threshold passes.
  daysUntilSunset: number
  /// True iff `now >= last_activity + 90d`.
  available: boolean
  /// True iff the dead-man-switch has already been triggered (one-way flag).
  alreadyTriggered: boolean
}

// ─────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────

const SUNSET_THRESHOLD_MS = 90n * 86_400n * 1_000n
const KEEPER_INACTIVE_MS = 7n * 86_400n * 1_000n
const MIN_VALID_TIMESTAMP_MS = 1_700_000_000_000n

/// Past margin for `validFrom` to absorb Preprod relay chain-tip lag.
/// Preprod relay slot can lag wall-clock by 30-180s.
const VALID_FROM_PAST_MARGIN_MS = 180_000

/// Future window for `validTo`. Generous so the TX has time to propagate
/// without tripping the 1h validity-range width cap (`upper - lower <= 1h`).
const VALID_TO_FUTURE_WINDOW_MS = 10 * 60_000

/// Constr indices for VaultRedeemer (declaration order in types.ak).
/// CommunitySunset:3 was added by V1 — every later variant in
/// `VaultRedeemer` shifted +1, so off-chain `Constr(N, ...)` indices
/// must match the contract `types.ak` declaration order.
const VAULT_REDEEMER_IDX = {
  Withdraw: 1,
  CommunitySunset: 3,
} as const

/// Constr indices for ProxyRedeemer (declaration order in vault_proxy.ak).
/// V1 has 10 routes.
const PROXY_ROUTE_IDX = {
  UseUser: 0,
} as const

// ─────────────────────────────────────────────────────────────────
// Lucid bootstrap
// ─────────────────────────────────────────────────────────────────

/**
 * Helper: hex string → Uint8Array (used by `evaluateTx` patch).
 */
function hexToUint8Array(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error('hex length must be even')
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16)
  return out
}

/**
 * Patch Lucid Blockfrost `evaluateTx` to:
 *   1. Strip `d90102` CBOR tag-258 wrappers (Lucid Evolution v0.4.x emits
 *      Conway-set encodings around inputs / outputs / required-signers;
 *      Ogmios v6 — which Blockfrost's evaluator delegates to — rejects
 *      them with "failed to decode payload from base64 or base16").
 *   2. POST raw CBOR bytes (`Content-Type: application/cbor`) instead of
 *      letting Lucid send hex text.
 *   3. Return `{redeemer_tag, redeemer_index, ex_units}` shape that
 *      Lucid's downstream effect-ts switch expects.
 */
function patchBlockfrostEvaluate(bf: any, baseUrl: string, key: string): void {
  bf.evaluateTx = async (tx: string, _additionalUTxOs?: unknown) => {
    const stripped = tx.replace(/d90102([89ab][0-9a-f])/g, '$1')
    const cborBytes = hexToUint8Array(stripped)
    const res = await fetch(`${baseUrl}/utils/txs/evaluate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/cbor', project_id: key },
      body: cborBytes as unknown as ArrayBuffer,
      signal: AbortSignal.timeout(30_000),
    })
    const text = await res.text()
    if (text.trimStart().startsWith('<')) {
      throw new Error(`Blockfrost eval returned non-JSON (HTML): ${text.slice(0, 120)}`)
    }
    let data: any
    try { data = JSON.parse(text) } catch {
      throw new Error(`Blockfrost eval returned non-JSON: ${text.slice(0, 200)}`)
    }
    if (data.status_code && data.status_code >= 400) {
      throw new Error(`Blockfrost eval ${data.status_code}: ${data.message || JSON.stringify(data).slice(0, 300)}`)
    }
    if (data.fault) {
      throw new Error(`Ogmios eval fault: ${JSON.stringify(data.fault).slice(0, 500)}`)
    }
    const evalResult = data?.result?.EvaluationResult
    if (!evalResult) {
      if (data?.result?.EvaluationFailure) {
        throw new Error(`EvaluateTransaction fails: ${JSON.stringify(data.result.EvaluationFailure).slice(0, 800)}`)
      }
      throw new Error(`Unexpected eval response: ${JSON.stringify(data).slice(0, 500)}`)
    }
    const fromLegacyTag = (t: string): string => {
      if (t === 'certificate') return 'publish'
      if (t === 'withdrawal') return 'withdraw'
      return t
    }
    const redeemers: Array<{
      redeemer_tag: string
      redeemer_index: number
      ex_units: { mem: number; steps: number }
    }> = []
    for (const [k, units] of Object.entries(evalResult)) {
      const [pTag, pIndex] = k.split(':')
      const u = units as { memory?: number; steps?: number }
      redeemers.push({
        redeemer_tag: fromLegacyTag(pTag),
        redeemer_index: Number(pIndex),
        ex_units: { mem: Number(u.memory ?? 0), steps: Number(u.steps ?? 0) },
      })
    }
    return redeemers
  }
}

/**
 * Lucid Evolution v0.4.x's stock Blockfrost provider crashes on Conway-era
 * responses with `Cannot convert undefined to a BigInt` (BigInt called on
 * missing `drep_deposit` / `gov_action_deposit` fields). Replace its
 * `getProtocolParameters` with a Conway-safe implementation that reads
 * Blockfrost REST directly + applies fallbacks. Cached per provider
 * instance.
 */
function patchProtocolParamsConwaySafe(bf: any, url: string, key: string): void {
  let cached: any = null
  bf.getProtocolParameters = async () => {
    if (cached) return cached
    const res = await fetch(`${url}/epochs/latest/parameters`, {
      headers: { project_id: key },
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) {
      throw new Error(`Blockfrost protocol-params HTTP ${res.status} ${res.statusText}`)
    }
    const text = await res.text()
    if (text.trimStart().startsWith('<')) {
      throw new Error(`Blockfrost protocol-params returned non-JSON: ${text.slice(0, 100)}`)
    }
    const r = JSON.parse(text) as any
    // Fallback: convert a named-key cost_models object to positional form.
    // Blockfrost lists the parameters in canonical Plutus order, so positions
    // follow iteration (insertion) order — sorting the names would scramble
    // them and corrupt the script-integrity hash.
    const normalizeCostModels = (raw: any): any => {
      if (!raw || typeof raw !== 'object') return raw
      const out: any = {}
      for (const [version, paramObj] of Object.entries(raw)) {
        if (!paramObj || typeof paramObj !== 'object') { out[version] = paramObj; continue }
        const entries = Object.entries(paramObj as Record<string, number>)
        const allNumeric = entries.every(([k]) => /^\d+$/.test(k))
        if (allNumeric) { out[version] = paramObj; continue }
        const positional: Record<string, number> = {}
        entries.forEach(([_n, val], idx) => { positional[String(idx)] = val })
        out[version] = positional
      }
      return out
    }
    cached = {
      minFeeA: parseInt(r.min_fee_a),
      minFeeB: parseInt(r.min_fee_b),
      maxTxSize: parseInt(r.max_tx_size),
      maxValSize: parseInt(r.max_val_size),
      keyDeposit: BigInt(r.key_deposit ?? '2000000'),
      poolDeposit: BigInt(r.pool_deposit ?? '500000000'),
      drepDeposit: BigInt(r.drep_deposit ?? '500000000'),
      govActionDeposit: BigInt(r.gov_action_deposit ?? '100000000000'),
      priceMem: parseFloat(r.price_mem),
      priceStep: parseFloat(r.price_step),
      maxTxExMem: BigInt(r.max_tx_ex_mem ?? '14000000'),
      maxTxExSteps: BigInt(r.max_tx_ex_steps ?? '10000000000'),
      coinsPerUtxoByte: BigInt(r.coins_per_utxo_size ?? '4310'),
      collateralPercentage: parseInt(r.collateral_percent ?? '150'),
      maxCollateralInputs: parseInt(r.max_collateral_inputs ?? '3'),
      minFeeRefScriptCostPerByte: parseInt(r.min_fee_ref_script_cost_per_byte ?? '15'),
      // `cost_models_raw` is Blockfrost's positional array form, already in
      // canonical Plutus order — required for a correct script-integrity hash
      // (and thus tx submission). Fall back to the named object if absent.
      costModels: r.cost_models_raw ?? normalizeCostModels(r.cost_models),
    }
    return cached
  }
}

export async function initLucid(
  blockfrostKey: string,
  network: 'mainnet' | 'preprod',
): Promise<LucidEvolution> {
  const url = network === 'preprod'
    ? 'https://cardano-preprod.blockfrost.io/api/v0'
    : 'https://cardano-mainnet.blockfrost.io/api/v0'
  const net = network === 'preprod' ? 'Preprod' as const : 'Mainnet' as const
  const key = blockfrostKey.trim()
  const provider = new Blockfrost(url, key)
  patchProtocolParamsConwaySafe(provider, url, key)
  patchBlockfrostEvaluate(provider, url, key)
  return await Lucid(provider, net)
}

/** Hydrate the user reward address from the ceremony's `userStakeHash`.
 *  Called once after Lucid is initialised; mutates the config in-place. */
export function hydrateRewardAddrs(cfg: V1Config): void {
  if (cfg.userRewardAddr) return // already hydrated
  const hash = cfg.ceremony.hashes.userStakeHash
  if (!hash) {
    throw new Error('Config missing hashes.userStakeHash — vault_user staking validator anchor required')
  }
  cfg.userRewardAddr = credentialToRewardAddress(cfg.network, scriptHashToCredential(hash))
}

// ─────────────────────────────────────────────────────────────────
// Vault state query
// ─────────────────────────────────────────────────────────────────

/**
 * Locate the unique vault UTXO at proxy.address by scanning for the
 * one-shot vault NFT (compile-time anchor). The deploy ceremony
 * mints exactly one such NFT and burns the mint window deadline, so
 * there is provably one vault UTxO per proxy address.
 */
export async function queryVaultState(
  lucid: LucidEvolution,
  cfg: V1Config,
): Promise<VaultState> {
  const utxos = await lucid.utxosAt(cfg.proxyAddr)
  const matches = utxos.filter(
    (u) => (u.assets[cfg.vaultNftUnit] || 0n) === 1n && u.datum,
  )
  if (matches.length === 0) {
    throw new Error(
      `No vault UTXO found at ${cfg.proxyAddr.slice(0, 40)}… carrying NFT ` +
      `${cfg.vaultNftUnit.slice(0, 20)}… — ceremony JSON may be stale.`,
    )
  }
  if (matches.length > 1) {
    throw new Error(
      `Multiple vault UTxOs at proxy address — invariant violation. ` +
      `Refusing to guess which one is canonical.`,
    )
  }
  const utxo = matches[0]
  let datum: any
  try {
    datum = Data.from(utxo.datum!)
  } catch (e) {
    throw new Error(`Vault datum failed to parse as Plutus Data: ${(e as Error).message}`)
  }
  if (datum.index !== 0 || !Array.isArray(datum.fields) || datum.fields.length !== 29) {
    throw new Error(
      `Vault datum shape mismatch: expected Constr(0, [...29 fields]), ` +
      `got Constr(${datum.index}, [${datum.fields?.length ?? '?'} fields]). ` +
      `Schema drift — withdraw-cli built against V1 (29 fields).`,
    )
  }
  const f = datum.fields as unknown[]

  const liqwidPositionsRaw = f[VF.liqwid_positions] as Array<any>
  const liqwidPositions: LiqwidPosition[] = (liqwidPositionsRaw || []).map((p) => {
    if (!p || p.index !== 0 || !Array.isArray(p.fields) || p.fields.length !== 3) {
      throw new Error('Malformed LiqwidPosition entry in vault datum')
    }
    return {
      marketId: BigInt(p.fields[0] as bigint),
      qtokensHeld: BigInt(p.fields[1] as bigint),
      suppliedValue: BigInt(p.fields[2] as bigint),
    }
  })

  return {
    totalDeposited: BigInt(f[VF.total_deposited] as bigint),
    totalShares: BigInt(f[VF.total_shares] as bigint),
    idleBuffer: BigInt(f[VF.idle_buffer] as bigint),
    nonDepositValue: BigInt(f[VF.non_deposit_value] as bigint),
    lastCompoundTime: BigInt(f[VF.last_compound_time] as bigint),
    lastReallocTime: BigInt(f[VF.last_realloc_time] as bigint),
    earlyWithdrawFeeBps: BigInt(f[VF.early_withdraw_fee_bps] as bigint),
    vaultVersion: BigInt(f[VF.vault_version] as bigint),
    frozen: BigInt(f[VF.frozen] as bigint),
    communitySunsetTriggered: BigInt(f[VF.community_sunset_triggered] as bigint),
    depositTokenPolicy: f[VF.deposit_token_policy] as string,
    depositTokenName: f[VF.deposit_token_name] as string,
    liqwidPositions,
    rawDatum: utxo.datum!,
    utxo,
  }
}

/** Sum vUSDCx across all UTxOs at the given address. */
export async function getUserShares(
  lucid: LucidEvolution,
  addr: string,
  cfg: V1Config,
): Promise<bigint> {
  const utxos = await lucid.utxosAt(addr)
  let total = 0n
  for (const u of utxos) total += u.assets[cfg.vusdcxUnit] || 0n
  return total
}

// ─────────────────────────────────────────────────────────────────
// Withdraw quote — pure math, mirrors lib/vault/validation.ak
// ─────────────────────────────────────────────────────────────────

export function computeWithdrawQuote(
  state: VaultState,
  shares: bigint,
  validFromMs: number = Date.now() - VALID_FROM_PAST_MARGIN_MS,
): WithdrawQuote {
  if (state.totalShares <= 0n) throw new Error('Vault has zero shares')
  if (shares <= 0n) throw new Error('shares must be positive')
  if (shares >= state.totalShares) {
    throw new Error('Full-drain Withdraw not supported via this CLI; use admin tooling')
  }

  const baseWithdraw = (shares * state.totalDeposited) / state.totalShares
  const keeperInactive =
    state.lastCompoundTime > MIN_VALID_TIMESTAMP_MS &&
    BigInt(validFromMs) >= state.lastCompoundTime + KEEPER_INACTIVE_MS

  const earlyFee = keeperInactive
    ? 0n
    : (baseWithdraw * state.earlyWithdrawFeeBps) / 10_000n
  const netWithdraw = baseWithdraw - earlyFee

  if (netWithdraw <= 0n) {
    throw new Error(`net_withdraw <= 0 (base=${baseWithdraw}, fee=${earlyFee})`)
  }
  if (netWithdraw > state.idleBuffer) {
    throw new Error(
      `withdraw_amount ${netWithdraw} > idle_buffer ${state.idleBuffer}. ` +
      `Wait for keeper Recall, or trigger CommunitySunset if vault has been ` +
      `inactive ≥90d.`,
    )
  }
  return { shares, baseWithdraw, earlyFee, netWithdraw, keeperInactive }
}

// ─────────────────────────────────────────────────────────────────
// Sunset status — pure math
// ─────────────────────────────────────────────────────────────────

export function computeSunsetStatus(
  state: VaultState,
  nowMs: number = Date.now(),
): SunsetStatus {
  // Validator reads max(last_compound, last_realloc) — both are advanced
  // by Compound (zero-yield heartbeat or real-yield) and reallocations.
  const lastActivity =
    state.lastCompoundTime > state.lastReallocTime
      ? state.lastCompoundTime
      : state.lastReallocTime

  const now = BigInt(nowMs)
  const elapsedMs = lastActivity > 0n ? now - lastActivity : 0n
  const remainingMs = lastActivity > 0n ? lastActivity + SUNSET_THRESHOLD_MS - now : SUNSET_THRESHOLD_MS

  return {
    lastActivityMs: lastActivity,
    daysSinceActivity: lastActivity > 0n ? Number(elapsedMs / 86_400_000n) : -1,
    daysUntilSunset: Math.max(0, Number(remainingMs / 86_400_000n)),
    available:
      lastActivity > MIN_VALID_TIMESTAMP_MS &&
      now >= lastActivity + SUNSET_THRESHOLD_MS,
    alreadyTriggered: state.communitySunsetTriggered === 1n,
  }
}

// ─────────────────────────────────────────────────────────────────
// Reference-script loader
// ─────────────────────────────────────────────────────────────────

interface RefBundle {
  vaultProxy: UTxO
  vaultUser: UTxO
  vusdcx: UTxO
}

async function loadRefBundle(lucid: LucidEvolution, cfg: V1Config): Promise<RefBundle> {
  const refs = ['vaultProxy', 'vaultUser', 'vusdcx'] as const
  const refOutRefs = refs.map((label) => {
    const entry = cfg.ceremony.refScripts[label]
    if (!entry) {
      throw new Error(
        `Config missing refScripts.${label} — required for V1 Withdraw-Zero (proxy + user + vusdcx)`,
      )
    }
    return { txHash: entry.txHash, outputIndex: entry.outputIndex }
  })
  const utxos = await lucid.utxosByOutRef(refOutRefs)
  if (utxos.length < 3) {
    throw new Error(
      `Expected 3 ref-script UTxOs (proxy + user + vusdcx), got ${utxos.length}. ` +
      `Operator may have reclaimed ref scripts; redeploy ceremony required.`,
    )
  }
  const find = (label: typeof refs[number]) => {
    const ref = cfg.ceremony.refScripts[label]
    const found = utxos.find((u) => u.txHash === ref.txHash && u.outputIndex === ref.outputIndex)
    if (!found) {
      throw new Error(`Ref UTxO ${label} ${ref.txHash.slice(0, 16)}… not on chain`)
    }
    return found
  }
  return {
    vaultProxy: find('vaultProxy'),
    vaultUser: find('vaultUser'),
    vusdcx: find('vusdcx'),
  }
}

/** Lucid v0.4.x picks the wrong internal branch when a UTXO carries
 *  both `datum` and `datumHash` — strip both + scriptRef to force the
 *  inline-datum path and avoid the `NotAllowedSupplementalDatums` ledger
 *  rejection. */
function stripLucidDatumFields(u: UTxO): UTxO {
  return { ...u, datum: undefined, datumHash: undefined, scriptRef: undefined } as UTxO
}

// ─────────────────────────────────────────────────────────────────
// Withdraw TX builder
// ─────────────────────────────────────────────────────────────────

export async function buildWithdrawTx(
  lucid: LucidEvolution,
  cfg: V1Config,
  state: VaultState,
  shares: bigint,
  userAddr: string,
  receiver?: string,
): Promise<{ cbor: string; quote: WithdrawQuote }> {
  hydrateRewardAddrs(cfg)
  const validFrom = Date.now() - VALID_FROM_PAST_MARGIN_MS
  const validTo = Date.now() + VALID_TO_FUTURE_WINDOW_MS
  const quote = computeWithdrawQuote(state, shares, validFrom)

  const recv = receiver ?? userAddr
  const userPkh = paymentCredentialOf(userAddr).hash
  const receiverPkh = paymentCredentialOf(recv).hash

  // Receiver must equal signer (CLI only signs from one wallet).
  if (recv !== userAddr) {
    throw new Error(
      `--receiver address must match signer wallet (CLI signs from one mnemonic). ` +
      `Got receiver=${recv.slice(0, 24)}…, signer=${userAddr.slice(0, 24)}…`,
    )
  }

  const depositUnit = makeDepositUnit(state.depositTokenPolicy, state.depositTokenName)

  // Build new datum — copy all 29 fields, mutate only accounting deltas.
  const oldDatum = Data.from(state.rawDatum) as any
  const newFields = [...(oldDatum.fields as unknown[])]
  newFields[VF.total_deposited] = state.totalDeposited - quote.netWithdraw // deferred-yield: subtract NET, not BASE
  newFields[VF.total_shares] = state.totalShares - shares
  newFields[VF.idle_buffer] = state.idleBuffer - quote.netWithdraw
  const newDatumCbor = Data.to(new Constr(0, newFields as any) as any)

  // Build vault output assets (preserve NFT + everything else, deduct payout).
  const vaultAssets: Record<string, bigint> = { ...state.utxo.assets }
  vaultAssets[depositUnit] = (vaultAssets[depositUnit] || 0n) - quote.netWithdraw

  // User payout output (must end up at output index 1 since vault output is 0).
  const receiverOutputIdx = 1n
  const receiverAssets: Record<string, bigint> = {
    [depositUnit]: quote.netWithdraw,
  }

  const refs = await loadRefBundle(lucid, cfg)

  const proxyRdmrCbor = Data.to(new Constr(PROXY_ROUTE_IDX.UseUser, []))
  const withdrawRdmrCbor = Data.to(
    new Constr(VAULT_REDEEMER_IDX.Withdraw, [shares, receiverPkh, receiverOutputIdx]),
  )
  const burnRdmrCbor = Data.to(new Constr(1, []))

  const tx = await lucid
    .newTx()
    .collectFrom([stripLucidDatumFields(state.utxo)], proxyRdmrCbor)
    .withdraw(cfg.userRewardAddr, 0n, withdrawRdmrCbor)
    .mintAssets({ [cfg.vusdcxUnit]: -shares }, burnRdmrCbor)
    .pay.ToContract(cfg.proxyAddr, { kind: 'inline', value: newDatumCbor }, vaultAssets)
    .pay.ToAddress(recv, receiverAssets)
    .addSignerKey(userPkh)
    .validFrom(validFrom)
    .validTo(validTo)
    .readFrom([refs.vaultProxy, refs.vaultUser, refs.vusdcx])
    .complete({ localUPLCEval: false })

  return { cbor: tx.toCBOR(), quote }
}

// ─────────────────────────────────────────────────────────────────
// CommunitySunset TX builder (Layer 3 dead-man-switch)
// ─────────────────────────────────────────────────────────────────

export async function buildSunsetTx(
  lucid: LucidEvolution,
  cfg: V1Config,
  state: VaultState,
  callerAddr: string,
): Promise<{ cbor: string; status: SunsetStatus }> {
  hydrateRewardAddrs(cfg)
  const validFrom = Date.now() - VALID_FROM_PAST_MARGIN_MS
  const validTo = Date.now() + VALID_TO_FUTURE_WINDOW_MS
  const status = computeSunsetStatus(state, validFrom)

  if (status.alreadyTriggered) {
    throw new Error(
      'CommunitySunset already triggered — frozen=1 + community_sunset_triggered=1. ' +
      'Permissionless RecallFromLiqwid + DeployToProtocol Layer 2 paths are already open.',
    )
  }
  if (!status.available) {
    throw new Error(
      `CommunitySunset not yet available — vault has been active within the last ` +
      `${status.daysSinceActivity} days. Threshold is 90 days of operational ` +
      `inactivity (no Compound, no realloc). ${status.daysUntilSunset} days remaining.`,
    )
  }

  // Caller must have ≥1 vUSDCx in their wallet — validator scans tx
  // inputs for a vUSDCx-bearing wallet UTXO. Lucid will pick a wallet
  // input automatically; we just verify the caller actually holds the
  // share before building.
  const callerShares = await getUserShares(lucid, callerAddr, cfg)
  if (callerShares <= 0n) {
    throw new Error(
      'Caller wallet holds 0 vUSDCx. CommunitySunset requires the trigger ' +
      'to be a depositor (validator scans tx inputs for vUSDCx).',
    )
  }

  const callerPkh = paymentCredentialOf(callerAddr).hash

  // Build new datum — copy 29 fields, set frozen=1 + community_sunset_triggered=1.
  const oldDatum = Data.from(state.rawDatum) as any
  const newFields = [...(oldDatum.fields as unknown[])]
  newFields[VF.frozen] = 1n
  newFields[VF.community_sunset_triggered] = 1n
  const newDatumCbor = Data.to(new Constr(0, newFields as any) as any)

  // Vault output assets unchanged (no token movement, just datum mutation).
  const vaultAssets: Record<string, bigint> = { ...state.utxo.assets }

  const refs = await loadRefBundle(lucid, cfg)

  const proxyRdmrCbor = Data.to(new Constr(PROXY_ROUTE_IDX.UseUser, []))
  const sunsetRdmrCbor = Data.to(new Constr(VAULT_REDEEMER_IDX.CommunitySunset, []))

  const tx = await lucid
    .newTx()
    .collectFrom([stripLucidDatumFields(state.utxo)], proxyRdmrCbor)
    .withdraw(cfg.userRewardAddr, 0n, sunsetRdmrCbor)
    .pay.ToContract(cfg.proxyAddr, { kind: 'inline', value: newDatumCbor }, vaultAssets)
    .addSignerKey(callerPkh)
    .validFrom(validFrom)
    .validTo(validTo)
    .readFrom([refs.vaultProxy, refs.vaultUser])
    .complete({ localUPLCEval: false })

  return { cbor: tx.toCBOR(), status }
}
