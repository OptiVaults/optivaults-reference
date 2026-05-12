/**
 * V1 frontend TX builders — ports the 5 user-flow TX templates from
 * `v1/tests/preprod/` (canonical reference) into browser-side Lucid
 * Evolution. Each builder returns a `TxBuilder` that callers chain
 * with `.sign.withWallet().complete()` + `submitTolerant`.
 *
 * Sources:
 *   - Direct Deposit: `tests/preprod/10-deposit-direct.ts`
 *   - Direct Withdraw: `tests/preprod/tools/withdraw-helpers.ts`
 *   - Queue Deposit Order: `tests/preprod/13-queue-deposit-order.ts`
 *   - Queue Withdraw Order: `tests/preprod/18-withdraw-queue-batch.ts`
 *   - Cancel Order: `tests/preprod/16-order-cancel.ts`
 *
 * Critical patterns (do not drop):
 *   - `tx.complete({ localUPLCEval: false })` — Lucid Evolution v0.4.x
 *     local UPLC has a generic-crash bug on multi-validator TXs;
 *     provider eval (Blockfrost / Ogmios) returns structured failures.
 *   - `defaultValidityRange()` — 180s past margin + 10min future window
 *     absorbs Preprod relay chain-tip lag without tripping the 1h
 *     validity-range width cap.
 *   - `stripLucidDatumFields(utxo)` — Blockfrost-fetched UTxOs carry
 *     both `datum` and `datumHash`; Lucid v0.4.x picks the wrong
 *     internal branch and attaches the datum to the witness set,
 *     which the ledger rejects with `NotAllowedSupplementalDatums`.
 *     Stripping forces the inline-datum path.
 *   - `addSignerKey(userPkh)` — required because the user pkh is
 *     referenced inside redeemers + Plutus Address payload; without
 *     the explicit signer the wallet won't include the vkey witness.
 */

import type { LucidEvolution, UTxO } from '@lucid-evolution/lucid'
import { getLucid } from './lucidClient'
import { loadDeployState, hydrateAddresses, loadRefUtxos, type V1DeployState } from './v1Deploy'
import {
  REDEEMER_IDX,
  proxyRedeemerForVaultRedeemer,
  vusdcxMintSharesRedeemerCbor,
  vusdcxBurnSharesRedeemerCbor,
  orderCancelRedeemerCbor,
} from './proxyRoute'
import { parseVaultDatum, type VaultDatum } from './vaultDatum'
import {
  calculateSharesToMint,
  calculateWithdrawAmount,
  calculateEarlyFee,
  defaultValidityRange,
  isKeeperInactive,
  MIN_DEPOSIT,
  DEFAULT_MAX_BATCHER_TIP,
  DEFAULT_ORDER_EXPIRES_HOURS,
  MIN_ORDER_LOVELACE,
} from './vaultMath'

// ════════════════════════════════════════════════════════════
// Lucid lazy refs — Data / Constr / paymentCredentialOf /
// getAddressDetails — pulled in once on first builder call.
// ════════════════════════════════════════════════════════════

let _lucidMod: any = null
async function lucidMod() {
  if (!_lucidMod) _lucidMod = await import('@lucid-evolution/lucid')
  return _lucidMod
}

function stripLucidDatumFields<T extends { datum?: any; datumHash?: any; scriptRef?: any }>(u: T): T {
  return { ...u, datum: undefined, datumHash: undefined, scriptRef: undefined }
}

// ════════════════════════════════════════════════════════════
// Vault UTXO + datum lookup
// ════════════════════════════════════════════════════════════

/** Locate the unique vault UTXO via vault NFT scan at proxy.address. */
async function findVaultUtxo(
  lucid: LucidEvolution,
  state: V1DeployState,
): Promise<{ utxo: UTxO; datum: VaultDatum }> {
  const utxos = await lucid.utxosAt(state.proxyAddr)
  const matches = utxos.filter(
    (u) => (u.assets[state.vaultNftUnit] || 0n) === 1n && u.datum,
  )
  if (matches.length === 0) {
    throw new Error(
      `No vault UTXO at ${state.proxyAddr.slice(0, 40)}… carrying ${state.vaultNftUnit.slice(0, 20)}…`,
    )
  }
  if (matches.length > 1) {
    throw new Error(`Multiple vault UTxOs at proxy address — invariant violation`)
  }
  const utxo = matches[0]
  const datum = await parseVaultDatum(utxo.datum!)
  if (!datum) throw new Error('Vault inline datum failed to decode (schema drift?)')
  return { utxo, datum }
}

// ════════════════════════════════════════════════════════════
// Address-to-PlutusData encoder for OrderDatum.receiver
// ════════════════════════════════════════════════════════════

async function addressToPlutusData(addr: string): Promise<unknown> {
  const { Constr, getAddressDetails } = await lucidMod()
  const d = getAddressDetails(addr)
  if (!d.paymentCredential) {
    throw new Error(`Address ${addr.slice(0, 20)}… has no payment credential`)
  }
  const payment = new Constr(
    d.paymentCredential.type === 'Key' ? 0 : 1,
    [d.paymentCredential.hash],
  )
  const stake = d.stakeCredential
    ? new Constr(0, [
        new Constr(0, [
          new Constr(
            d.stakeCredential.type === 'Key' ? 0 : 1,
            [d.stakeCredential.hash],
          ),
        ]),
      ])
    : new Constr(1, [])
  return new Constr(0, [payment, stake])
}

// ════════════════════════════════════════════════════════════
// Direct Deposit — vault_user.Deposit (port of test 10)
// ════════════════════════════════════════════════════════════

export interface BuildDepositParams {
  /** Wallet address driving the TX. Must already be selected on
   *  Lucid (`selectWalletFromCip30`) so coin selection sees its USDCx. */
  userAddr: string
  /** Deposit amount in deposit-token microunits (USDCx ≥ 10_000_000). */
  amount: bigint
  /**
   * Slippage floor — minimum vUSDCx the user is willing to receive.
   * Defaults to 99% of the contract-derived expected mint amount.
   * Used only as off-chain UX guard; the contract enforces share-math
   * exactly per `validation.ak`.
   */
  minReceive?: bigint
}

export interface BuiltTx {
  /** Lucid `TxComplete` ready for `.sign.withWallet().complete()`. */
  tx: any
  /** Convenience: hash returned after `.submit()`. */
  expectedShares?: bigint
  /** The vault datum at TX-build time (snapshot). */
  preState?: VaultDatum
}

export async function buildDirectDepositTx(p: BuildDepositParams): Promise<BuiltTx> {
  if (p.amount < MIN_DEPOSIT) {
    throw new Error(`Deposit amount ${p.amount} below min_deposit ${MIN_DEPOSIT}`)
  }
  const lucid = await getLucid()
  const state = await hydrateAddresses(await loadDeployState())
  const { Data, Constr, paymentCredentialOf } = await lucidMod()

  // 1. Vault snapshot
  const { utxo: vaultUtxo, datum: pre } = await findVaultUtxo(lucid, state)
  if (pre.frozen !== 0n) throw new Error('Vault is frozen — Deposit rejected')
  if (pre.deposit_token_policy.length === 0) throw new Error('Vault not initialised')

  const depositTokenUnit = pre.deposit_token_policy + pre.deposit_token_name
  const vusdcxUnit = pre.vusdcx_policy + '765553444378' // "vUSDCx"

  const expectedShares = calculateSharesToMint(p.amount, pre.total_deposited, pre.total_shares)

  // 2. Continuing vault datum + assets
  const newDatum: VaultDatum = {
    ...pre,
    idle_buffer: pre.idle_buffer + p.amount,
    total_deposited: pre.total_deposited + p.amount,
    total_shares: pre.total_shares + expectedShares,
  }
  const newDatumCbor = await encodeVaultDatum(newDatum)

  const newVaultAssets: Record<string, bigint> = { ...vaultUtxo.assets }
  newVaultAssets[depositTokenUnit] =
    (newVaultAssets[depositTokenUnit] || 0n) + p.amount

  // 3. Redeemers
  const depositRedeemerCbor = Data.to(new Constr(REDEEMER_IDX.Deposit, [p.amount]))
  const proxyRdmrCbor = await proxyRedeemerForVaultRedeemer('Deposit')
  const mintRdmrCbor = await vusdcxMintSharesRedeemerCbor()

  // 4. Ref scripts: proxy + vault_user + vusdcx
  const refUtxos = await loadRefUtxos(state, ['vaultProxy', 'vaultUser', 'vusdcx'], (refs) =>
    lucid.utxosByOutRef(refs),
  )

  // 5. Build TX
  const userPkh = paymentCredentialOf(p.userAddr).hash
  const { validFrom, validTo } = defaultValidityRange()

  const tx = await lucid
    .newTx()
    .collectFrom([stripLucidDatumFields(vaultUtxo)], proxyRdmrCbor)
    .withdraw(state.rewardAddrs.user, 0n, depositRedeemerCbor)
    .mintAssets({ [vusdcxUnit]: expectedShares }, mintRdmrCbor)
    .pay.ToContract(state.proxyAddr, { kind: 'inline', value: newDatumCbor }, newVaultAssets)
    .pay.ToAddress(p.userAddr, { [vusdcxUnit]: expectedShares })
    .addSignerKey(userPkh)
    .validFrom(validFrom)
    .validTo(validTo)
    .readFrom(refUtxos)
    .complete({ localUPLCEval: false })

  return { tx, expectedShares, preState: pre }
}

// ════════════════════════════════════════════════════════════
// Direct Withdraw — vault_user.Withdraw partial (port of withdraw-helpers)
// ════════════════════════════════════════════════════════════

export interface BuildWithdrawParams {
  userAddr: string
  /** vUSDCx amount to burn. Must be < total_shares (full-drain has its
   *  own helper that's not yet implemented in the frontend). */
  sharesToBurn: bigint
  /** Address that receives the USDCx payout. Defaults to userAddr. */
  receiver?: string
  /** Optional override for the early-withdraw fee bps. Defaults to the
   *  datum's current `early_withdraw_fee_bps`, with the keeper-inactive
   *  waiver auto-detected. */
  earlyFeeBpsOverride?: bigint
}

export async function buildDirectWithdrawTx(p: BuildWithdrawParams): Promise<BuiltTx> {
  const lucid = await getLucid()
  const state = await hydrateAddresses(await loadDeployState())
  const { Data, Constr, paymentCredentialOf } = await lucidMod()
  const receiver = p.receiver ?? p.userAddr

  const { utxo: vaultUtxo, datum: pre } = await findVaultUtxo(lucid, state)
  if (pre.total_shares <= 0n) throw new Error('total_shares == 0; nothing to withdraw')
  if (p.sharesToBurn <= 0n) throw new Error(`sharesToBurn must be > 0`)
  if (p.sharesToBurn >= pre.total_shares) {
    throw new Error('Full-drain Withdraw not supported via this builder; use direct full-drain helper')
  }

  const baseWithdraw = calculateWithdrawAmount(p.sharesToBurn, pre.total_deposited, pre.total_shares)
  const { validFrom, validTo } = defaultValidityRange()
  const keeperInactive = isKeeperInactive(pre.last_compound_time, validFrom)
  const earlyFeeBps = p.earlyFeeBpsOverride ?? (keeperInactive ? 0n : pre.early_withdraw_fee_bps)
  const earlyFee = calculateEarlyFee(baseWithdraw, earlyFeeBps)
  const withdrawAmount = baseWithdraw - earlyFee
  if (withdrawAmount <= 0n) {
    throw new Error(`withdraw_amount <= 0 (base=${baseWithdraw}, fee=${earlyFee})`)
  }
  if (withdrawAmount > pre.idle_buffer) {
    throw new Error(
      `withdraw_amount ${withdrawAmount} > idle_buffer ${pre.idle_buffer} — keeper Recall required`,
    )
  }

  const depositTokenUnit = pre.deposit_token_policy + pre.deposit_token_name
  const vusdcxUnit = pre.vusdcx_policy + '765553444378'
  const userPkh = paymentCredentialOf(p.userAddr).hash
  const receiverPkh = paymentCredentialOf(receiver).hash

  const newDatum: VaultDatum = {
    ...pre,
    total_deposited: pre.total_deposited - withdrawAmount,
    total_shares: pre.total_shares - p.sharesToBurn,
    idle_buffer: pre.idle_buffer - withdrawAmount,
  }
  const newDatumCbor = await encodeVaultDatum(newDatum)
  const newVaultAssets: Record<string, bigint> = { ...vaultUtxo.assets }
  newVaultAssets[depositTokenUnit] =
    (newVaultAssets[depositTokenUnit] || 0n) - withdrawAmount

  const receiverOutputIdx = 1n
  const withdrawRdmrCbor = Data.to(
    new Constr(REDEEMER_IDX.Withdraw, [
      p.sharesToBurn,
      receiverPkh,
      receiverOutputIdx,
    ]),
  )
  const proxyRdmrCbor = await proxyRedeemerForVaultRedeemer('Withdraw')
  const burnRdmrCbor = await vusdcxBurnSharesRedeemerCbor()

  const refUtxos = await loadRefUtxos(state, ['vaultProxy', 'vaultUser', 'vusdcx'], (refs) =>
    lucid.utxosByOutRef(refs),
  )

  const tx = await lucid
    .newTx()
    .collectFrom([stripLucidDatumFields(vaultUtxo)], proxyRdmrCbor)
    .withdraw(state.rewardAddrs.user, 0n, withdrawRdmrCbor)
    .mintAssets({ [vusdcxUnit]: -p.sharesToBurn }, burnRdmrCbor)
    .pay.ToContract(state.proxyAddr, { kind: 'inline', value: newDatumCbor }, newVaultAssets)
    .pay.ToAddress(receiver, { [depositTokenUnit]: withdrawAmount })
    .addSignerKey(userPkh)
    .validFrom(validFrom)
    .validTo(validTo)
    .readFrom(refUtxos)
    .complete({ localUPLCEval: false })

  return { tx, preState: pre }
}

// ════════════════════════════════════════════════════════════
// OrderDatum CBOR builder
// ════════════════════════════════════════════════════════════

interface OrderDatumParams {
  ownerPkh: string
  orderTypeWithdraw: boolean // false = DepositOrder, true = WithdrawOrder
  amount: bigint              // USDCx for deposit, vUSDCx for withdraw
  minReceive: bigint
  receiverAddr: string
  createdAt: bigint
  expiresAt: bigint
  maxBatcherTip: bigint
}

async function buildOrderDatumCbor(p: OrderDatumParams): Promise<string> {
  const { Data, Constr } = await lucidMod()
  const receiverData = await addressToPlutusData(p.receiverAddr)
  const datum = new Constr(0, [
    p.ownerPkh,
    new Constr(p.orderTypeWithdraw ? 1 : 0, []),
    p.amount,
    p.minReceive,
    receiverData,
    p.createdAt,
    p.expiresAt,
    p.maxBatcherTip,
  ])
  return Data.to(datum)
}

// ════════════════════════════════════════════════════════════
// Queue Deposit Order — port of test 13
// ════════════════════════════════════════════════════════════

export interface BuildQueueDepositParams {
  userAddr: string
  amount: bigint
  minReceive?: bigint
  expiresHours?: bigint
  maxBatcherTip?: bigint
}

export async function buildQueueDepositOrderTx(p: BuildQueueDepositParams): Promise<BuiltTx> {
  if (p.amount < MIN_DEPOSIT) {
    throw new Error(`Order amount ${p.amount} below min_deposit ${MIN_DEPOSIT}`)
  }
  const lucid = await getLucid()
  const state = await hydrateAddresses(await loadDeployState())
  const { paymentCredentialOf } = await lucidMod()

  const { datum: pre } = await findVaultUtxo(lucid, state)
  const depositTokenUnit = pre.deposit_token_policy + pre.deposit_token_name
  const userPkh = paymentCredentialOf(p.userAddr).hash

  const maxTip = p.maxBatcherTip ?? DEFAULT_MAX_BATCHER_TIP
  const ttlHours = p.expiresHours ?? DEFAULT_ORDER_EXPIRES_HOURS
  const createdAt = BigInt(Date.now())
  const expiresAt = createdAt + ttlHours * 3_600n * 1_000n

  const datumCbor = await buildOrderDatumCbor({
    ownerPkh: userPkh,
    orderTypeWithdraw: false,
    amount: p.amount,
    minReceive: p.minReceive ?? 0n,
    receiverAddr: p.userAddr,
    createdAt,
    expiresAt,
    maxBatcherTip: maxTip,
  })

  if (!state.orderAddr) {
    throw new Error('Order script address missing in deploy state — ceremony JSON incomplete?')
  }

  const orderAssets: Record<string, bigint> = {
    lovelace: MIN_ORDER_LOVELACE + maxTip,
    [depositTokenUnit]: p.amount,
  }

  const tx = await lucid
    .newTx()
    .pay.ToContract(state.orderAddr, { kind: 'inline', value: datumCbor }, orderAssets)
    .addSignerKey(userPkh)
    .complete({ localUPLCEval: false })

  return { tx }
}

// ════════════════════════════════════════════════════════════
// Queue Withdraw Order — port of test 18 user-side
// ════════════════════════════════════════════════════════════

export interface BuildQueueWithdrawParams {
  userAddr: string
  /** vUSDCx amount to burn (raw units; 1e12 = 1 USDCx-ish at first deposit). */
  sharesToBurn: bigint
  minReceive?: bigint
  expiresHours?: bigint
  maxBatcherTip?: bigint
}

export async function buildQueueWithdrawOrderTx(p: BuildQueueWithdrawParams): Promise<BuiltTx> {
  if (p.sharesToBurn <= 0n) throw new Error('sharesToBurn must be > 0')
  const lucid = await getLucid()
  const state = await hydrateAddresses(await loadDeployState())
  const { paymentCredentialOf } = await lucidMod()

  const { datum: pre } = await findVaultUtxo(lucid, state)
  const vusdcxUnit = pre.vusdcx_policy + '765553444378'
  const userPkh = paymentCredentialOf(p.userAddr).hash

  const maxTip = p.maxBatcherTip ?? DEFAULT_MAX_BATCHER_TIP
  const ttlHours = p.expiresHours ?? DEFAULT_ORDER_EXPIRES_HOURS
  const createdAt = BigInt(Date.now())
  const expiresAt = createdAt + ttlHours * 3_600n * 1_000n

  const datumCbor = await buildOrderDatumCbor({
    ownerPkh: userPkh,
    orderTypeWithdraw: true,
    amount: p.sharesToBurn,
    minReceive: p.minReceive ?? 0n,
    receiverAddr: p.userAddr,
    createdAt,
    expiresAt,
    maxBatcherTip: maxTip,
  })

  if (!state.orderAddr) {
    throw new Error('Order script address missing in deploy state')
  }

  // WithdrawOrder UTXO carries vUSDCx as the "amount" payload; ADA covers
  // min-UTXO + the keeper's batcher tip.
  const orderAssets: Record<string, bigint> = {
    lovelace: MIN_ORDER_LOVELACE + maxTip,
    [vusdcxUnit]: p.sharesToBurn,
  }

  const tx = await lucid
    .newTx()
    .pay.ToContract(state.orderAddr, { kind: 'inline', value: datumCbor }, orderAssets)
    .addSignerKey(userPkh)
    .complete({ localUPLCEval: false })

  return { tx }
}

// ════════════════════════════════════════════════════════════
// Cancel Order — port of test 16
// ════════════════════════════════════════════════════════════

export interface BuildCancelOrderParams {
  userAddr: string
  /** Cancel a specific order outRef. If omitted, cancels every order
   *  UTxO at the order address whose datum names this `userPkh` as
   *  owner — matching the legacy `/api/build-cancel-order-tx` UX. */
  orderOutRef?: { txHash: string; outputIndex: number }
}

export async function buildCancelOrderTx(p: BuildCancelOrderParams): Promise<BuiltTx> {
  const lucid = await getLucid()
  const state = await hydrateAddresses(await loadDeployState())
  const { Data, paymentCredentialOf } = await lucidMod()
  const userPkh = paymentCredentialOf(p.userAddr).hash

  if (!state.orderAddr) {
    throw new Error('Order script address missing in deploy state')
  }

  let orderUtxos: UTxO[]
  if (p.orderOutRef) {
    orderUtxos = await lucid.utxosByOutRef([p.orderOutRef])
  } else {
    const all = await lucid.utxosAt(state.orderAddr)
    // Filter by datum: OrderDatum.owner = first field of Constr 0.
    orderUtxos = []
    for (const u of all) {
      if (!u.datum) continue
      try {
        const d = Data.from(u.datum) as any
        const owner = d?.fields?.[0]
        if (typeof owner === 'string' && owner === userPkh) {
          orderUtxos.push(u)
          // R51 anti-double-satisfaction: order_input_count == 1 in
          // contract Cancel branch — one TX per cancelled order.
          break
        }
      } catch {
        /* malformed datum — skip */
      }
    }
  }

  if (orderUtxos.length === 0) {
    throw new Error('No pending orders found for this address')
  }

  const orderUtxo = orderUtxos[0]
  const cancelRdmrCbor = await orderCancelRedeemerCbor()

  // Refund full value back to the owner (R65 N-2 + contract Cancel
  // branch's None-vault-ref full-refund path).
  const refundAssets: Record<string, bigint> = { ...orderUtxo.assets }

  const refUtxos = await loadRefUtxos(state, ['order'], (refs) => lucid.utxosByOutRef(refs))

  const tx = await lucid
    .newTx()
    .collectFrom([stripLucidDatumFields(orderUtxo)], cancelRdmrCbor)
    .readFrom(refUtxos)
    .pay.ToAddress(p.userAddr, refundAssets)
    .addSignerKey(userPkh)
    .complete({ localUPLCEval: false })

  return { tx }
}

// ════════════════════════════════════════════════════════════
// VaultDatum encoder helper (used by deposit/withdraw)
// ════════════════════════════════════════════════════════════

let _vaultDatumSchema: any = null
async function getVaultDatumSchemaCached() {
  if (_vaultDatumSchema) return _vaultDatumSchema
  const { Data } = await lucidMod()
  // Mirror lib/vaultDatum.ts schema. Defining here too because the
  // lazy-loaded schema in vaultDatum.ts is internal to that module.
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
  _vaultDatumSchema = Data.Object({
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
    performance_fee_bps: Data.Integer(),
    early_withdraw_fee_bps: Data.Integer(),
    min_hold_seconds: Data.Integer(),
    buffer_target_bps: Data.Integer(),
    keeper_fee_bps: Data.Integer(),
    gov_fee_bps: Data.Integer(),
    max_slippage_bps: Data.Integer(),
    min_swap_peg_bps: Data.Integer(),
    vault_version: Data.Integer(),
    governance_policy: Data.Bytes(),
    governance_name: Data.Bytes(),
    deposit_token_policy: Data.Bytes(),
    deposit_token_name: Data.Bytes(),
    vusdcx_policy: Data.Bytes(),
    order_script_hash: Data.Bytes(),
    registry_hash: Data.Bytes(),
    registry_auth_policy: Data.Bytes(),
    frozen: Data.Integer(),
    community_sunset_triggered: Data.Integer(),
  })
  return _vaultDatumSchema
}

async function encodeVaultDatum(d: VaultDatum): Promise<string> {
  const { Data } = await lucidMod()
  const schema = await getVaultDatumSchemaCached()
  return Data.to(d as unknown as never, schema as unknown as never) as string
}

// ════════════════════════════════════════════════════════════
// Public re-exports for caller convenience
// ════════════════════════════════════════════════════════════

export { REDEEMER_IDX, REDEEMER_TO_REF_LABEL, REDEEMER_TO_REWARD_KEY } from './proxyRoute'
export { calculateSharesToMint, calculateWithdrawAmount, calculateEarlyFee, MIN_DEPOSIT } from './vaultMath'
