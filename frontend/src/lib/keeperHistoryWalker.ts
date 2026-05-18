/**
 * Vault TX chain-walker — chain-walk fallback for `/api/keeper-history`
 * when no R2-published per-keeper file is available.
 *
 * Strategy:
 *   1. List recent TXs at proxy.address (vault UTXO lives there).
 *   2. For each TX, fetch redeemers + UTxOs.
 *   3. Classify by which staking validator was Withdraw-Zero invoked
 *      against (script_hash → REDEEMER_TO_VALIDATOR table). For
 *      validators that host multiple redeemers (vault_user has
 *      Deposit/Withdraw/BatchProcess/CommunitySunset), use vault
 *      datum delta to discriminate.
 *   4. Compute incremental yield (Compound) / market-id (Supply/Recall) /
 *      buffer delta as detail.
 *
 * Cache TX hash → KeeperActionRecord in IndexedDB. First load on a
 * vault with 100 TXs ≈ 100 redeemer + 100 utxos calls = 200 Blockfrost
 * hits (~20s on free tier rate limit); subsequent loads are instant
 * via cache.
 *
 * This walker is the **fallback path**. When the operator's keeper
 * publishes JSONL via R2 + Worker proxy, `historyR2.fetchKeeperActionsFromR2`
 * is preferred (cheaper, richer detail) and this walker is invoked
 * only when R2 returns null / 404.
 */

import { resolveApiKey, blockfrostNetwork } from './blockfrost'
import { loadDeployState, hydrateAddresses, type V1DeployState } from './v1Deploy'
import { getCachedMany, setCachedMany, clearCacheForDomain, type CachedTxClassification } from './historyCache'

// Bump this whenever classifyByValidatorAndDelta() output for any TX
// changes — drives a one-shot IDB cache purge so users on the new
// bundle get fresh classifications without manual cache clear.
//
// IMPORTANT: walker awaits purge BEFORE getCachedMany() to close the
// race where stale entries get served while clearCache is in flight.
const KEEPER_CLASSIFIER_VERSION = '2026-05-18-r15-adapter-donation'
let _keeperPurgePromise: Promise<void> | null = null

function purgeKeeperCacheIfClassifierChanged(): Promise<void> {
  if (_keeperPurgePromise) return _keeperPurgePromise
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
    _keeperPurgePromise = Promise.resolve()
    return _keeperPurgePromise
  }
  try {
    const last = localStorage.getItem('optivaults-keeper-classifier-version')
    if (last === KEEPER_CLASSIFIER_VERSION) {
      _keeperPurgePromise = Promise.resolve()
      return _keeperPurgePromise
    }
    // Use per-domain clear so we don't blow away tx-history entries
    // (the other walker's cache) — that caused settled-label regressions
    // when keeper page loaded eagerly via App.tsx top-level import.
    _keeperPurgePromise = clearCacheForDomain('keeper-history')
      .then(() => {
        try { localStorage.setItem('optivaults-keeper-classifier-version', KEEPER_CLASSIFIER_VERSION) } catch { /* swallow */ }
      })
      .catch(() => { /* private-mode or quota error — best-effort */ })
    return _keeperPurgePromise
  } catch {
    _keeperPurgePromise = Promise.resolve()
    return _keeperPurgePromise
  }
}
import { parseVaultDatum } from './vaultDatum'
import type { KeeperActionRecord } from './historyR2'

const BASE_URL = blockfrostNetwork === 'mainnet'
  ? 'https://cardano-mainnet.blockfrost.io/api/v0'
  : 'https://cardano-preprod.blockfrost.io/api/v0'

interface AddressTx {
  tx_hash: string
  tx_index: number
  block_height: number
  block_time: number
}

interface RedeemerEntry {
  tx_index: number
  purpose: 'spend' | 'mint' | 'cert' | 'reward'
  script_hash: string
  redeemer_data_hash: string
  datum_hash?: string | null
  unit_mem?: string
  unit_steps?: string
  fee?: string
}

interface UtxoEntry {
  address: string
  amount: { unit: string; quantity: string }[]
  inline_datum?: string | null
  data_hash?: string | null
}

interface TxUtxos {
  hash: string
  inputs: UtxoEntry[]
  outputs: UtxoEntry[]
}

interface TxInfo {
  hash: string
  block_height: number
  block_time: number
  fees: string
  slot: number
}

async function bf<T>(path: string, signal?: AbortSignal): Promise<T | null> {
  const key = resolveApiKey()
  if (!key) throw new Error('Blockfrost API key missing')
  const res = await fetch(`${BASE_URL}${path}`, { headers: { project_id: key }, signal })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`Blockfrost ${res.status}: ${path}`)
  return (await res.json()) as T
}

// ─────────────────────────────────────────────────────────────
// Hash → validator name map (built lazily from deploy state)
// ─────────────────────────────────────────────────────────────

interface ValidatorMap {
  /** Reward / staking script hashes → human-readable validator name. */
  byStakeHash: Map<string, string>
  /** Spend script hashes → name. */
  bySpendHash: Map<string, string>
}

function buildValidatorMap(state: V1DeployState): ValidatorMap {
  const h = state.ceremony.hashes
  const byStakeHash = new Map<string, string>()
  const add = (k: string, name: string) => { if (h[k]) byStakeHash.set(h[k].toLowerCase(), name) }
  add('userStakeHash', 'vault_user')
  add('keeperHotStakeHash', 'vault_keeper_hot')
  add('batcherStakeHash', 'vault_batcher')
  add('swapAdaStakeHash', 'vault_swap_ada')
  add('protocolStakeHash', 'vault_protocol')
  add('recallStakeHash', 'vault_recall')
  add('liqwidStakeHash', 'vault_liqwid')
  add('govPolicyStakeHash', 'vault_gov_policy')
  add('govEmergencyStakeHash', 'vault_gov_emergency')
  add('adminDeployStakeHash', 'vault_admin_deploy')
  add('keeperStakeHash', 'keeper_stake_script')
  // DEX swap-adapter / cancel-guard withdraw-0 validators. These ride
  // along on a Deploy/swap TX as an auxiliary reward redeemer next to
  // the real operation validator (vault_protocol etc.) — mapped here so
  // the redeemer picker can recognise + skip them (see AUXILIARY_STAKE).
  add('minswapV2AdapterHash', 'minswap_v2_adapter')
  add('sundaeswapAdapterHash', 'sundaeswap_adapter')
  add('sundaeswapCancelGuardHash', 'sundaeswap_cancel_guard')

  const bySpendHash = new Map<string, string>()
  const addS = (k: string, name: string) => { if (h[k]) bySpendHash.set(h[k].toLowerCase(), name) }
  addS('vaultProxyHash', 'vault_proxy')
  addS('orderScriptHash', 'order')
  addS('registryHash', 'registry')
  addS('treasuryHash', 'treasury')
  addS('multisigGovHash', 'multisig_gov')
  return { byStakeHash, bySpendHash }
}

/**
 * Validator names that ride along on a TX as auxiliary Withdraw-Zero
 * reward redeemers and are NOT the operation being performed. The
 * redeemer picker skips these so the real operation validator (e.g.
 * `vault_protocol` on a Deploy that swaps via an adapter) is selected.
 */
const AUXILIARY_STAKE = new Set([
  'keeper_stake_script',
  'minswap_v2_adapter',
  'sundaeswap_adapter',
  'sundaeswap_cancel_guard',
])

// ─────────────────────────────────────────────────────────────
// Action classification
// ─────────────────────────────────────────────────────────────

interface VaultDelta {
  tdDelta: bigint
  idleBufferDelta: bigint
  liqwidPositionsCountDelta: number
  frozenChanged: boolean
  sunsetChanged: boolean
  /** Supply: `supplied_value` of the LiqwidPosition added this TX (resolved
   *  by market_id diff). Lets the Supply row surface the principal amount
   *  instead of a bare "SupplyToLiqwid". */
  liqwidSupplied?: bigint
  /** Recall: `supplied_value` (principal) of the LiqwidPosition removed
   *  this TX. Paired with `idleBufferDelta` to derive realized yield/loss. */
  liqwidRecalled?: bigint
}

async function computeVaultDelta(
  inputs: UtxoEntry[],
  outputs: UtxoEntry[],
  proxyAddr: string,
  vaultNftUnit: string,
): Promise<VaultDelta | null> {
  // Find the input vault UTXO (proxy address + vault NFT) and output vault UTXO.
  const findVault = (list: UtxoEntry[]) =>
    list.find((u) => u.address === proxyAddr
      && u.amount.some((a) => a.unit.toLowerCase() === vaultNftUnit.toLowerCase()))
  const inVault = findVault(inputs)
  const outVault = findVault(outputs)
  if (!inVault?.inline_datum) return null
  const before = await parseVaultDatum(inVault.inline_datum)
  if (!before) return null
  if (!outVault?.inline_datum) {
    // Full-drain Withdraw destroys vault — return drain marker.
    return {
      tdDelta: -before.total_deposited,
      idleBufferDelta: -before.idle_buffer,
      liqwidPositionsCountDelta: -before.liqwid_positions.length,
      frozenChanged: false,
      sunsetChanged: false,
    }
  }
  const after = await parseVaultDatum(outVault.inline_datum)
  if (!after) return null
  // Diff liqwid_positions by market_id — the count alone can't tell a
  // Supply/Recall row how much was supplied/recalled.
  const beforeIds = new Set(before.liqwid_positions.map((p) => p.market_id))
  const afterIds = new Set(after.liqwid_positions.map((p) => p.market_id))
  const added = after.liqwid_positions.find((p) => !beforeIds.has(p.market_id))
  const removed = before.liqwid_positions.find((p) => !afterIds.has(p.market_id))
  return {
    tdDelta: after.total_deposited - before.total_deposited,
    idleBufferDelta: after.idle_buffer - before.idle_buffer,
    liqwidPositionsCountDelta: after.liqwid_positions.length - before.liqwid_positions.length,
    frozenChanged: after.frozen !== before.frozen,
    sunsetChanged: after.community_sunset_triggered !== before.community_sunset_triggered,
    liqwidSupplied: added?.supplied_value,
    liqwidRecalled: removed?.supplied_value,
  }
}

function classifyByValidatorAndDelta(
  validatorName: string,
  delta: VaultDelta | null,
  inputsAtVault: number,
): { type: string; detail: string } {
  // Single-validator → multi-redeemer disambiguation via delta
  if (validatorName === 'vault_user') {
    if (!delta) return { type: 'vault_tx', detail: 'vault_user (unparsed datum)' }
    if (delta.sunsetChanged) return { type: 'vault_tx', detail: 'CommunitySunset triggered' }
    if (delta.tdDelta > 0n) return { type: 'batch_deposit', detail: `Direct Deposit +${formatU(delta.tdDelta)}` }
    if (delta.tdDelta < 0n) return { type: 'batch_withdraw', detail: `Direct Withdraw -${formatU(delta.tdDelta)}` }
    return { type: 'vault_tx', detail: 'vault_user (no td delta)' }
  }
  if (validatorName === 'vault_keeper_hot') {
    if (!delta) return { type: 'compound', detail: 'Compound (no delta)' }
    if (delta.tdDelta > 0n) return { type: 'compound', detail: `Compound +${formatU(delta.tdDelta)} yield` }
    // A zero-yield Compound and a RebalanceBuffer are indistinguishable
    // from the vault datum delta alone (both leave total_deposited
    // unchanged and only move idle_buffer). The walker classifies the
    // whole `vault_keeper_hot` family as `compound`; the redeemer
    // constructor — the only thing that could split them — is not
    // fetched. (An earlier `rebalance` branch here was dead code: its
    // guard was identical to the line above, so it never executed.)
    if (delta.tdDelta === 0n && delta.idleBufferDelta < 0n) {
      return { type: 'compound', detail: 'Reconciliation / RebalanceBuffer (zero-yield)' }
    }
    return { type: 'compound', detail: 'Compound / RebalanceBuffer / SwapAda' }
  }
  if (validatorName === 'vault_batcher') {
    const orderWord = inputsAtVault === 1 ? 'order' : 'orders'
    if (!delta) return { type: 'batch', detail: `BatchProcess (${inputsAtVault} ${orderWord})` }
    if (delta.tdDelta > 0n) {
      // Net deposit fold — vault TD grew by the deposited USDCx. Emit as
      // batch_deposit so the right-side value renders cyan (matches Direct Deposit).
      return { type: 'batch_deposit', detail: `BatchProcess fold (${inputsAtVault} ${orderWord}) +${formatU(delta.tdDelta)}` }
    }
    if (delta.tdDelta < 0n) {
      // Net withdraw fold — vault TD shrunk because withdraw orders returned USDCx.
      return { type: 'batch_withdraw', detail: `BatchProcess fold (${inputsAtVault} ${orderWord}) -${formatU(delta.tdDelta)}` }
    }
    // Mixed batch (deposit + withdraw legs cancel) or zero-sum noop.
    return { type: 'batch', detail: `BatchProcess (${inputsAtVault} ${orderWord}, mixed)` }
  }
  if (validatorName === 'vault_protocol') return { type: 'deploy', detail: 'DeployToProtocol' }
  if (validatorName === 'vault_recall') {
    if (!delta) return { type: 'recall', detail: 'RecallFromProtocol / MergeUtxo' }
    if (delta.liqwidPositionsCountDelta < 0) return { type: 'recall', detail: 'RecallFromProtocol' }
    return { type: 'merge', detail: 'MergeUtxo' }
  }
  if (validatorName === 'vault_liqwid') {
    if (!delta) return { type: 'supply', detail: 'SupplyToLiqwid / RecallFromLiqwid' }
    if (delta.liqwidPositionsCountDelta > 0) {
      const amt = delta.liqwidSupplied !== undefined ? ` ${formatU(delta.liqwidSupplied)}` : ''
      return { type: 'supply', detail: `SupplyToLiqwid${amt}` }
    }
    if (delta.liqwidPositionsCountDelta < 0) {
      let detail = 'RecallFromLiqwid'
      if (delta.liqwidRecalled !== undefined) {
        detail += ` ${formatU(delta.liqwidRecalled)}`
        // A deposit-token Liqwid market returns the underlying to
        // idle_buffer, so idleBufferDelta is the amount actually
        // recovered — the gap vs the principal is realized yield/loss.
        if (delta.idleBufferDelta > 0n) {
          const pnl = delta.idleBufferDelta - delta.liqwidRecalled
          if (pnl > 0n) detail += ` | +${formatU(pnl)} yield`
          else if (pnl < 0n) detail += ` | -${formatU(pnl)} loss`
        }
      }
      return { type: 'recall', detail }
    }
    return { type: 'supply', detail: 'Liqwid (rebalance)' }
  }
  if (validatorName === 'vault_admin_deploy') return { type: 'deploy', detail: 'AdminDeployNonDeposit (gov)' }
  if (validatorName === 'vault_gov_policy') return { type: 'vault_tx', detail: 'Gov policy update' }
  if (validatorName === 'vault_gov_emergency') return { type: 'vault_tx', detail: 'EmergencyWithdraw (gov)' }
  if (validatorName === 'vault_swap_ada') return { type: 'swap', detail: 'SwapAda' }
  // DEX adapter / cancel-guard appearing as the sole validator (no vault
  // operation rode with it) — a standalone swap or order cancel.
  if (validatorName === 'minswap_v2_adapter') return { type: 'swap', detail: 'Minswap V2 swap' }
  if (validatorName === 'sundaeswap_adapter') return { type: 'swap', detail: 'SundaeSwap swap' }
  if (validatorName === 'sundaeswap_cancel_guard') return { type: 'vault_tx', detail: 'DEX order cancel' }
  return { type: 'vault_tx', detail: validatorName }
}

function formatU(qty: bigint): string {
  const abs = qty < 0n ? -qty : qty
  return `${(Number(abs) / 1e6).toFixed(2)} USDCx`
}

// ─────────────────────────────────────────────────────────────
// Walker entry
// ─────────────────────────────────────────────────────────────

/**
 * Walk vault TX history from Blockfrost and classify each TX. Cached
 * classifications skip the per-TX redeemer + UTxO fetches.
 *
 * Returns up to `limit` records, newest first. Used as the fallback
 * when `historyR2.fetchKeeperActionsFromR2()` returns null.
 */
export async function walkVaultKeeperHistory(
  limit: number = 50,
  signal?: AbortSignal,
): Promise<KeeperActionRecord[]> {
  // Wait for any pending classifier-version cache purge to complete
  // BEFORE reading from cache (closes race window on first load after
  // KEEPER_CLASSIFIER_VERSION bump).
  await purgeKeeperCacheIfClassifierChanged()

  const state = await hydrateAddresses(await loadDeployState(signal))
  const map = buildValidatorMap(state)

  const data = await bf<AddressTx[]>(
    `/addresses/${state.proxyAddr}/transactions?count=${Math.min(Math.max(limit, 1), 100)}&order=desc`,
    signal,
  )
  if (!data) return []

  const cached = await getCachedMany('keeper-history', data.map((t) => t.tx_hash))

  const toFetch = data.filter((t) => !cached.has(t.tx_hash) || cached.get(t.tx_hash)!.domain !== 'keeper-history')
  const fetched = new Map<string, { redeemers: RedeemerEntry[]; utxos: TxUtxos; info: TxInfo }>()
  for (let i = 0; i < toFetch.length; i += 5) {
    const batch = toFetch.slice(i, i + 5)
    const results = await Promise.allSettled(
      batch.map(async (t) => {
        const [redeemers, utxos, info] = await Promise.all([
          bf<RedeemerEntry[]>(`/txs/${t.tx_hash}/redeemers`, signal),
          bf<TxUtxos>(`/txs/${t.tx_hash}/utxos`, signal),
          bf<TxInfo>(`/txs/${t.tx_hash}`, signal),
        ])
        return { hash: t.tx_hash, redeemers, utxos, info }
      }),
    )
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value.redeemers && r.value.utxos && r.value.info) {
        fetched.set(r.value.hash, {
          redeemers: r.value.redeemers,
          utxos: r.value.utxos,
          info: r.value.info,
        })
      }
    }
  }

  const newCacheEntries: CachedTxClassification[] = []
  const records: KeeperActionRecord[] = []
  for (const tx of data) {
    const cachedHit = cached.get(tx.tx_hash)
    if (cachedHit && cachedHit.domain === 'keeper-history') {
      const payload = cachedHit.payload as KeeperActionRecord | null
      if (payload) records.push(payload)
      continue
    }
    const f = fetched.get(tx.tx_hash)
    if (!f) continue

    // Pick the operation-specific reward redeemer — a keeper TX carries
    // several Withdraw-Zero redeemers in canonical hash order:
    //   - auxiliary (keeper_stake_script auth, DEX swap-adapter, cancel
    //     guard) — NOT the operation
    //   - vault_batcher / vault_keeper_hot / vault_protocol / vault_recall /
    //     vault_liqwid / vault_swap_ada / vault_admin_deploy / etc. (the
    //     actual operation being authorized)
    // Skip the auxiliary set and take the first operation validator;
    // fall back to the first auxiliary redeemer (so a standalone swap /
    // order-cancel still resolves to a name), then to the first spend
    // redeemer if no reward redeemer is present at all.
    const rewardRdmrs = f.redeemers.filter((r) => r.purpose === 'reward')
    const opRdmr = rewardRdmrs.find((r) => {
      const name = map.byStakeHash.get(r.script_hash.toLowerCase())
      return !!name && !AUXILIARY_STAKE.has(name)
    }) || rewardRdmrs.find((r) => map.byStakeHash.has(r.script_hash.toLowerCase()))
      || rewardRdmrs[0]
    const validatorName = opRdmr
      ? map.byStakeHash.get(opRdmr.script_hash.toLowerCase()) || 'unknown_stake'
      : map.bySpendHash.get(f.redeemers[0]?.script_hash?.toLowerCase() || '') || 'unknown'

    const inputsAtVault = f.utxos.inputs.filter((u) => u.address === state.proxyAddr).length
    const delta = await computeVaultDelta(f.utxos.inputs, f.utxos.outputs, state.proxyAddr, state.vaultNftUnit)

    // r13 (2026-05-12) / r15 (2026-05-18): keeper-side donation pattern.
    // A TX with NO redeemers (no Plutus eval) that creates a NoDatum
    // output at the vault proxy address — sent before a subsequent
    // MergeUtxo folds it in (raises min-ADA headroom for an ADA top-up,
    // or seeds non-deposit value for a stable-token donation). The
    // output must NOT carry the vault NFT (that is the vault UTXO /
    // ceremony genesis, handled below). r13 detected ADA-only top-ups;
    // r15 widens it to token donations, which previously fell through
    // to the catch-all "unknown" bucket.
    const nftUnitLc = state.vaultNftUnit.toLowerCase()
    let cls: { type: string; detail: string }
    const noRedeemers = f.redeemers.length === 0
    const inboundDonation = noRedeemers && inputsAtVault === 0
      ? f.utxos.outputs.find((u) => {
          if (u.address !== state.proxyAddr) return false
          if (u.inline_datum) return false
          if (u.data_hash) return false
          return !u.amount.some((a) => a.unit.toLowerCase() === nftUnitLc)
        })
      : undefined
    // r14 (2026-05-18): the ceremony vault-creation TX has no input at
    // the proxy address but mints + outputs the vault UTXO. Pre-r14 it
    // fell through to the catch-all `unknown` bucket and rendered as
    // "TX / unknown" — looks like a bug. Detect it explicitly.
    const genesisVault = !inboundDonation && inputsAtVault === 0
      && f.utxos.outputs.some((u) => u.address === state.proxyAddr
        && u.amount.some((a) => a.unit.toLowerCase() === nftUnitLc))
    if (inboundDonation) {
      const lovelace = inboundDonation.amount.find((a) => a.unit === 'lovelace')
      const ada = lovelace ? (Number(lovelace.quantity) / 1e6).toFixed(2) : '?'
      const tokenCount = inboundDonation.amount.filter((a) => a.unit !== 'lovelace').length
      cls = tokenCount > 0
        ? { type: 'donation', detail: `Token top-up (+${ada} ADA + ${tokenCount} asset${tokenCount > 1 ? 's' : ''} NoDatum)` }
        : { type: 'donation', detail: `ADA top-up (+${ada} ADA NoDatum)` }
    } else if (genesisVault) {
      cls = { type: 'vault_tx', detail: 'Vault deployed (ceremony genesis)' }
    } else {
      cls = classifyByValidatorAndDelta(validatorName, delta, inputsAtVault)
    }

    const outVault = f.utxos.outputs.find((u) => u.address === state.proxyAddr)
    const outDatum = outVault?.inline_datum ? await parseVaultDatum(outVault.inline_datum) : null

    const record: KeeperActionRecord = {
      txHash: tx.tx_hash,
      type: cls.type,
      timestamp: new Date(f.info.block_time * 1000).toISOString(),
      slot: f.info.slot,
      profitUsdcx: cls.type === 'compound' && delta && delta.tdDelta > 0n
        ? (Number(delta.tdDelta) / 1e6).toFixed(2)
        : '0.00',
      detail: cls.detail,
      vaultState: outDatum ? {
        totalDeposited: (Number(outDatum.total_deposited) / 1e6).toString(),
        totalShares: outDatum.total_shares.toString(),
        idleBuffer: (Number(outDatum.idle_buffer) / 1e6).toString(),
      } : null,
      estTxFeeAda: (Number(f.info.fees) / 1e6).toFixed(6),
    }

    newCacheEntries.push({
      txHash: tx.tx_hash,
      domain: 'keeper-history',
      payload: record,
      classifiedAt: Date.now(),
    })
    records.push(record)
  }

  if (newCacheEntries.length > 0) await setCachedMany(newCacheEntries)
  return records
}
