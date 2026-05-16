/**
 * V1 emergency-withdraw — vault state query + Withdraw + CommunitySunset
 * TX builders (browser).
 *
 * Mirrors `withdraw-cli/src/vault.ts` exactly. Differences:
 *   - Uses CIP-30 wallet API via `lucid.selectWallet.fromAPI(api)`
 *     instead of `fromSeed`.
 *   - Imports Lucid lazily (`await import(...)`) so the heavy WASM
 *     payload doesn't block initial render — the vault state preview
 *     can render against `Data` + `fetch` alone.
 *
 * V1 contract surface:
 *   - 29-field VaultDatum (V1 +`community_sunset_triggered`)
 *   - Withdraw redeemer = Constr(1, [shares, receiver, receiver_output_idx])
 *   - CommunitySunset redeemer = Constr(3, []) — permissionless after ≥90d
 *   - vault_proxy.UseUser = Constr(0, [])
 *   - 3 ref scripts (vaultProxy + vaultUser + vusdcx)
 *   - Vault NFT scan at proxy address (compile-time anchor)
 */

import type { LucidEvolution, UTxO } from '@lucid-evolution/lucid'
import type { V1Config } from './config'
import { makeDepositUnit } from './config'

// ─────────────────────────────────────────────────────────────────
// VaultDatum field indices (29 fields, declaration order in types.ak)
// ─────────────────────────────────────────────────────────────────

const VF = {
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
  performance_fee_bps: 10,
  early_withdraw_fee_bps: 11,
  min_hold_seconds: 12,
  buffer_target_bps: 13,
  keeper_fee_bps: 14,
  gov_fee_bps: 15,
  max_slippage_bps: 16,
  min_swap_peg_bps: 17,
  vault_version: 18,
  governance_policy: 19,
  governance_name: 20,
  deposit_token_policy: 21,
  deposit_token_name: 22,
  vusdcx_policy: 23,
  order_script_hash: 24,
  registry_hash: 25,
  registry_auth_policy: 26,
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
  lastActivityMs: bigint
  daysSinceActivity: number
  daysUntilSunset: number
  available: boolean
  alreadyTriggered: boolean
}

// ─────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────

const SUNSET_THRESHOLD_MS = 90n * 86_400n * 1_000n
const KEEPER_INACTIVE_MS = 7n * 86_400n * 1_000n
const MIN_VALID_TIMESTAMP_MS = 1_700_000_000_000n
const VALID_FROM_PAST_MARGIN_MS = 180_000
const VALID_TO_FUTURE_WINDOW_MS = 10 * 60_000

const VAULT_REDEEMER_IDX = {
  Withdraw: 1,
  CommunitySunset: 3,
} as const

const PROXY_ROUTE_IDX = {
  UseUser: 0,
} as const

// ─────────────────────────────────────────────────────────────────
// Lucid lazy refs
// ─────────────────────────────────────────────────────────────────

let _lucidMod: any = null
async function lucidMod() {
  if (!_lucidMod) _lucidMod = await import('@lucid-evolution/lucid')
  return _lucidMod
}

// ─────────────────────────────────────────────────────────────────
// Lucid Evolution v0.4.x patches
//
// Two known bugs the stock provider hits in production browser sessions:
//
//   1. `getProtocolParameters` calls `BigInt(...)` on Conway-era fields
//      (`drep_deposit`, `gov_action_deposit`) without null-checking →
//      `Lucid()` init crashes with `Cannot convert undefined to a BigInt`.
//
//   2. `evaluateTx` sends Lucid's `d90102` CBOR tag-258 wrappers around
//      input/output sets to Blockfrost's evaluate endpoint, which proxies
//      to Ogmios v6, which rejects with "failed to decode payload from
//      base64 or base16". Same problem hits any TX builder using Lucid
//      Evolution v0.4.x's stock Blockfrost provider. Fix: strip `d90102`
//      + POST raw CBOR + normalise the response shape to what Lucid's
//      downstream effect-ts switch expects.
// ─────────────────────────────────────────────────────────────────

function hexToUint8Array(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error('hex length must be even')
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16)
  return out
}

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

function patchBlockfrostEvaluate(bf: any, baseUrl: string, key: string): void {
  bf.evaluateTx = async (tx: string, _additionalUTxOs?: unknown) => {
    const stripped = tx.replace(/d90102([89ab][0-9a-f])/g, '$1')
    const cborBytes = hexToUint8Array(stripped)
    const res = await fetch(`${baseUrl}/utils/txs/evaluate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/cbor', project_id: key },
      body: new Blob([cborBytes as unknown as BlobPart], { type: 'application/cbor' }),
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

export async function initLucid(
  blockfrostKey: string,
  network: 'mainnet' | 'preprod',
): Promise<LucidEvolution> {
  const { Blockfrost, Lucid } = await lucidMod()
  const url = network === 'preprod'
    ? 'https://cardano-preprod.blockfrost.io/api/v0'
    : 'https://cardano-mainnet.blockfrost.io/api/v0'
  const net = network === 'preprod' ? 'Preprod' : 'Mainnet'
  const key = blockfrostKey.trim()
  const provider = new Blockfrost(url, key)
  patchProtocolParamsConwaySafe(provider, url, key)
  patchBlockfrostEvaluate(provider, url, key)
  return await Lucid(provider, net)
}

export async function hydrateRewardAddrs(cfg: V1Config): Promise<void> {
  if (cfg.userRewardAddr) return
  const hash = cfg.ceremony.hashes.userStakeHash
  if (!hash) {
    throw new Error('Ceremony JSON missing hashes.userStakeHash')
  }
  const { credentialToRewardAddress, scriptHashToCredential } = await import(
    '@lucid-evolution/utils'
  )
  cfg.userRewardAddr = credentialToRewardAddress(cfg.network, scriptHashToCredential(hash))
}

// ─────────────────────────────────────────────────────────────────
// Vault state query
// ─────────────────────────────────────────────────────────────────

export async function queryVaultState(
  lucid: LucidEvolution,
  cfg: V1Config,
): Promise<VaultState> {
  const { Data } = await lucidMod()
  const utxos = await lucid.utxosAt(cfg.proxyAddr)
  const matches = utxos.filter(
    (u) => (u.assets[cfg.vaultNftUnit] || 0n) === 1n && u.datum,
  )
  if (matches.length === 0) {
    throw new Error(
      `No vault UTXO at ${cfg.proxyAddr.slice(0, 40)}… carrying NFT ${cfg.vaultNftUnit.slice(0, 20)}…`,
    )
  }
  if (matches.length > 1) {
    throw new Error('Multiple vault UTxOs at proxy address — invariant violation')
  }
  const utxo = matches[0]
  let datum: any
  try {
    datum = Data.from(utxo.datum!)
  } catch (e) {
    throw new Error(`Vault datum failed to parse: ${(e as Error).message}`)
  }
  if (datum.index !== 0 || !Array.isArray(datum.fields) || datum.fields.length !== 29) {
    throw new Error(
      `Vault datum shape mismatch: expected Constr(0, [...29 fields]), ` +
      `got Constr(${datum.index}, [${datum.fields?.length ?? '?'} fields]).`,
    )
  }
  const f = datum.fields as unknown[]

  const liqwidPositionsRaw = f[VF.liqwid_positions] as Array<any>
  const liqwidPositions: LiqwidPosition[] = (liqwidPositionsRaw || []).map((p) => ({
    marketId: BigInt(p.fields[0] as bigint),
    qtokensHeld: BigInt(p.fields[1] as bigint),
    suppliedValue: BigInt(p.fields[2] as bigint),
  }))

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
// Pure math
// ─────────────────────────────────────────────────────────────────

export function computeWithdrawQuote(
  state: VaultState,
  shares: bigint,
  validFromMs: number = Date.now() - VALID_FROM_PAST_MARGIN_MS,
): WithdrawQuote {
  if (state.totalShares <= 0n) throw new Error('Vault has zero shares')
  if (shares <= 0n) throw new Error('shares must be positive')
  if (shares >= state.totalShares) {
    throw new Error('Full-drain Withdraw not supported via emergency tool — admin only.')
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
      `Wait for keeper Recall, or trigger CommunitySunset if ≥90d inactive.`,
    )
  }
  return { shares, baseWithdraw, earlyFee, netWithdraw, keeperInactive }
}

export function computeSunsetStatus(
  state: VaultState,
  nowMs: number = Date.now(),
): SunsetStatus {
  const lastActivity =
    state.lastCompoundTime > state.lastReallocTime
      ? state.lastCompoundTime
      : state.lastReallocTime

  const now = BigInt(nowMs)
  const elapsedMs = lastActivity > 0n ? now - lastActivity : 0n
  const remainingMs = lastActivity > 0n
    ? lastActivity + SUNSET_THRESHOLD_MS - now
    : SUNSET_THRESHOLD_MS

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
    if (!entry) throw new Error(`Ceremony missing refScripts.${label}`)
    return { txHash: entry.txHash, outputIndex: entry.outputIndex }
  })
  const utxos = await lucid.utxosByOutRef(refOutRefs)
  if (utxos.length < 3) {
    throw new Error(`Expected 3 ref-script UTxOs, got ${utxos.length}`)
  }
  const find = (label: typeof refs[number]) => {
    const ref = cfg.ceremony.refScripts[label]
    const found = utxos.find(
      (u) => u.txHash === ref.txHash && u.outputIndex === ref.outputIndex,
    )
    if (!found) throw new Error(`Ref UTxO ${label} not on chain`)
    return found
  }
  return {
    vaultProxy: find('vaultProxy'),
    vaultUser: find('vaultUser'),
    vusdcx: find('vusdcx'),
  }
}

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
): Promise<{ cbor: string; quote: WithdrawQuote }> {
  await hydrateRewardAddrs(cfg)
  const { Data, Constr, paymentCredentialOf } = await lucidMod()
  const validFrom = Date.now() - VALID_FROM_PAST_MARGIN_MS
  const validTo = Date.now() + VALID_TO_FUTURE_WINDOW_MS
  const quote = computeWithdrawQuote(state, shares, validFrom)

  const userPkh = paymentCredentialOf(userAddr).hash
  const receiverPkh = userPkh

  const depositUnit = makeDepositUnit(state.depositTokenPolicy, state.depositTokenName)

  const oldDatum = Data.from(state.rawDatum) as any
  const newFields = [...(oldDatum.fields as unknown[])]
  newFields[VF.total_deposited] = state.totalDeposited - quote.netWithdraw
  newFields[VF.total_shares] = state.totalShares - shares
  newFields[VF.idle_buffer] = state.idleBuffer - quote.netWithdraw
  const newDatumCbor = Data.to(new Constr(0, newFields as any) as any)

  const vaultAssets: Record<string, bigint> = { ...state.utxo.assets }
  vaultAssets[depositUnit] = (vaultAssets[depositUnit] || 0n) - quote.netWithdraw

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
    .pay.ToAddress(userAddr, receiverAssets)
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
  await hydrateRewardAddrs(cfg)
  const { Data, Constr, paymentCredentialOf } = await lucidMod()
  const validFrom = Date.now() - VALID_FROM_PAST_MARGIN_MS
  const validTo = Date.now() + VALID_TO_FUTURE_WINDOW_MS
  const status = computeSunsetStatus(state, validFrom)

  if (status.alreadyTriggered) {
    throw new Error('CommunitySunset already triggered.')
  }
  if (!status.available) {
    throw new Error(
      `Not yet available — ${status.daysSinceActivity} days since last activity, ` +
      `${status.daysUntilSunset} days remaining until 90d threshold.`,
    )
  }

  const callerShares = await getUserShares(lucid, callerAddr, cfg)
  if (callerShares <= 0n) {
    throw new Error('Caller wallet must hold ≥1 vUSDCx (validator scans tx inputs).')
  }

  const callerPkh = paymentCredentialOf(callerAddr).hash

  const oldDatum = Data.from(state.rawDatum) as any
  const newFields = [...(oldDatum.fields as unknown[])]
  newFields[VF.frozen] = 1n
  newFields[VF.community_sunset_triggered] = 1n
  const newDatumCbor = Data.to(new Constr(0, newFields as any) as any)

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
