/**
 * V1 frontend deploy-state loader.
 *
 * Mirrors the shape of `keeper/data/preprod-<release>.json` (the file
 * `keeper/src/utils/v1Config.ts` reads). The operator publishes this
 * JSON alongside the SPA build (default path: `/v1-deploy-state.json`)
 * and the frontend fetches it at startup before any TX-building flow
 * needs reference-script outRefs / staking-validator hashes / NFT names.
 *
 * Resolution order:
 *   1. `VITE_DEPLOY_STATE_URL` env override (absolute URL).
 *   2. `${BASE_URL}/v1-deploy-state.json` — sibling of `index.html`,
 *      so operators just `cp keeper/data/preprod-<release>.json
 *      frontend/public/v1-deploy-state.json` before `vite build`.
 *
 * After a fresh ceremony, the operator replaces the JSON, redeploys
 * the SPA, and the new release is live without code changes. The same
 * JSON drives keeper, API server, and frontend — single source of
 * truth for ceremony anchors.
 */

import type { UTxO } from '@lucid-evolution/lucid'

// ─────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────

export interface RefScriptEntry {
  txHash: string
  outputIndex: number
  scriptHash: string
}

export interface StateUtxoEntry {
  txHash: string
  outputIndex: number
  address: string
}

export interface MintEntry {
  policyId: string
  assetName: string
  utxoRef?: { txHash: string; outputIndex: number }
}

/** Same shape as keeper's `CeremonyState` — JSON serialised verbatim. */
export interface CeremonyState {
  network: 'Mainnet' | 'Preprod'
  releaseTag: string
  mints: {
    vaultNft: MintEntry
    governanceNft: MintEntry
    registryAuthNft: MintEntry
  }
  refScripts: Record<string, RefScriptEntry>
  stateUtxos: Record<string, StateUtxoEntry>
  hashes: Record<string, string>
}

/**
 * Resolved live state — adds `proxyAddr` (= stateUtxos.vault.address)
 * + `vaultNftUnit` shortcuts for callers, and exposes the entire
 * ceremony JSON so TX builders can pluck whatever they need.
 */
export interface V1DeployState {
  ceremony: CeremonyState
  /** Bech32 address of the vault UTXO (lives at proxy script address). */
  proxyAddr: string
  /** Hex28 — vault NFT minting policy. */
  vaultNftPolicy: string
  /** Hex — vault NFT asset name (typically "OptiVault"). */
  vaultNftName: string
  /** Hex unit (`policy + name`) — convenience for asset lookups. */
  vaultNftUnit: string
  /** Hex28 — vUSDCx share-token minting policy. */
  vusdcxPolicy: string
  /** Hex unit. */
  vusdcxUnit: string
  /** Hex28 — order script hash (for OrderDatum address binding). */
  orderScriptHash: string
  /** Bech32 address of the order script. */
  orderAddr: string
  /** Hex28 — registry script hash. */
  registryHash: string
  /** Bech32 address of the registry script. */
  registryAddr: string
  /** Bech32 reward addresses for each Withdraw-Zero staking validator. */
  rewardAddrs: {
    user: string
    keeperHot: string
    batcher: string
    swapAda: string
    protocol: string
    recall: string
    liqwid: string
    govPolicy: string
    govEmergency: string
    adminDeploy: string
  }
}

// ─────────────────────────────────────────────────────────────────
// Loader
// ─────────────────────────────────────────────────────────────────

let _stateCache: V1DeployState | null = null
let _statePromise: Promise<V1DeployState> | null = null

export function deployStateUrl(): string {
  const override = import.meta.env.VITE_DEPLOY_STATE_URL as string | undefined
  if (override) return override
  // Vite injects BASE_URL — resolves to the SPA's deployed prefix.
  const base = import.meta.env.BASE_URL || '/'
  return base.replace(/\/$/, '') + '/v1-deploy-state.json'
}

async function fetchCeremony(signal?: AbortSignal): Promise<CeremonyState> {
  const url = deployStateUrl()
  const res = await fetch(url, { signal })
  if (!res.ok) {
    throw new Error(
      `Failed to fetch deploy state at ${url} (HTTP ${res.status}). ` +
      `Operator: copy ceremony JSON to public/v1-deploy-state.json and redeploy.`,
    )
  }
  const json = (await res.json()) as CeremonyState
  if (!json.network || !json.releaseTag || !json.refScripts || !json.stateUtxos || !json.hashes) {
    throw new Error('Deploy state JSON missing required top-level fields')
  }
  return json
}

function resolveAddrFromHash(_hash: string): string {
  // Reward / payment-script address derivation needs CML, which is
  // heavy. We compute these lazily via Lucid in `deriveRewardAddrs`
  // (called once after Lucid is loaded). Placeholder for now.
  return ''
}

/**
 * Fetch + cache deploy state. Subsequent calls return the same
 * resolved object. Throws on fetch error or schema-shape mismatch.
 */
export async function loadDeployState(signal?: AbortSignal): Promise<V1DeployState> {
  if (_stateCache) return _stateCache
  if (_statePromise) return _statePromise
  _statePromise = (async () => {
    const ceremony = await fetchCeremony(signal)

    // Wire up the most-used fields. Reward addresses derived lazily on
    // first call to `getStakingRewardAddr` (needs Lucid CML helpers).
    const proxyAddr = ceremony.stateUtxos.vault?.address || ''
    const vaultNftPolicy = ceremony.mints.vaultNft.policyId
    const vaultNftName = ceremony.mints.vaultNft.assetName
    const vusdcxPolicy = ceremony.hashes.vusdcxPolicy || ''
    const vusdcxName = '765553444378' // hex of "vUSDCx" — V1 ceremony convention
    const orderScriptHash = ceremony.hashes.orderScriptHash || ''
    const orderAddr = ceremony.refScripts.order
      ? resolveAddrFromHash(orderScriptHash)
      : ''
    const registryHash = ceremony.hashes.registryHash || ''
    const registryAddr = ceremony.stateUtxos.registry?.address || ''

    const state: V1DeployState = {
      ceremony,
      proxyAddr,
      vaultNftPolicy,
      vaultNftName,
      vaultNftUnit: vaultNftPolicy + vaultNftName,
      vusdcxPolicy,
      vusdcxUnit: vusdcxPolicy + vusdcxName,
      orderScriptHash,
      orderAddr,
      registryHash,
      registryAddr,
      rewardAddrs: {
        user: '',
        keeperHot: '',
        batcher: '',
        swapAda: '',
        protocol: '',
        recall: '',
        liqwid: '',
        govPolicy: '',
        govEmergency: '',
        adminDeploy: '',
      },
    }
    _stateCache = state
    return state
  })()
  return _statePromise
}

/**
 * Lazy reward-address + script-address derivation using Lucid's CML.
 * Mutates the cached state in-place and returns the populated copy.
 *
 * Must be called after Lucid has been loaded into the page (typically
 * inside the wallet-connect / TX-build path).
 */
export async function hydrateAddresses(state: V1DeployState): Promise<V1DeployState> {
  if (state.rewardAddrs.user) return state // already hydrated

  const {
    credentialToAddress,
    credentialToRewardAddress,
    scriptHashToCredential,
  } = await import('@lucid-evolution/utils')

  const network = state.ceremony.network
  const h = state.ceremony.hashes

  const reward = (hash: string) =>
    hash ? credentialToRewardAddress(network, scriptHashToCredential(hash)) : ''
  const addr = (hash: string) =>
    hash ? credentialToAddress(network, scriptHashToCredential(hash)) : ''

  state.rewardAddrs = {
    user:          reward(h.userStakeHash),
    keeperHot:     reward(h.keeperHotStakeHash),
    batcher:       reward(h.batcherStakeHash),
    swapAda:       reward(h.swapAdaStakeHash),
    protocol:      reward(h.protocolStakeHash),
    recall:        reward(h.recallStakeHash),
    liqwid:        reward(h.liqwidStakeHash),
    govPolicy:     reward(h.govPolicyStakeHash),
    govEmergency:  reward(h.govEmergencyStakeHash),
    adminDeploy:   reward(h.adminDeployStakeHash),
  }
  if (!state.orderAddr && state.orderScriptHash) state.orderAddr = addr(state.orderScriptHash)
  return state
}

// ─────────────────────────────────────────────────────────────────
// Reference-script UTXO resolver
// ─────────────────────────────────────────────────────────────────

/**
 * Resolve named ref-script outRefs into live UTXOs via the provided
 * Lucid instance. Accepts a list of label keys
 * (e.g. `["vaultProxy", "vaultUser", "vusdcx"]`) and returns the
 * UTXOs in the same order so callers can `.readFrom([...])` them.
 *
 * Caches per-state so subsequent calls don't re-fetch from Blockfrost.
 */
const _refUtxoCache: WeakMap<V1DeployState, Map<string, UTxO>> = new WeakMap()

export async function loadRefUtxos(
  state: V1DeployState,
  labels: string[],
  utxosByOutRef: (refs: { txHash: string; outputIndex: number }[]) => Promise<UTxO[]>,
): Promise<UTxO[]> {
  let cache = _refUtxoCache.get(state)
  if (!cache) { cache = new Map(); _refUtxoCache.set(state, cache) }

  const missing: { label: string; ref: { txHash: string; outputIndex: number } }[] = []
  for (const label of labels) {
    if (cache.has(label)) continue
    const entry = state.ceremony.refScripts[label]
    if (!entry) {
      throw new Error(`Deploy state has no refScripts.${label} entry — ceremony JSON incomplete?`)
    }
    missing.push({ label, ref: { txHash: entry.txHash, outputIndex: entry.outputIndex } })
  }

  if (missing.length > 0) {
    const fresh = await utxosByOutRef(missing.map((m) => m.ref))
    for (const m of missing) {
      const found = fresh.find(
        (u) => u.txHash === m.ref.txHash && u.outputIndex === m.ref.outputIndex,
      )
      if (!found) {
        throw new Error(
          `Ref script ${m.label} UTxO not found at ${m.ref.txHash.slice(0, 16)}…#${m.ref.outputIndex} ` +
          `— operator may have reclaimed the ref scripts; redeploy required.`,
        )
      }
      cache.set(m.label, found)
    }
  }

  return labels.map((l) => cache!.get(l)!)
}

// ─────────────────────────────────────────────────────────────────
// Test-only / dev hooks
// ─────────────────────────────────────────────────────────────────

/** Drop the cached deploy state. Useful in tests + when an operator
 *  swaps the JSON file at runtime and wants the next call to refetch. */
export function _resetDeployStateCache(): void {
  _stateCache = null
  _statePromise = null
}
