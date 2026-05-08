/**
 * V1 emergency-withdraw — deploy-state loader (browser).
 *
 * Mirrors `withdraw-cli/src/config.ts` but uses `fetch` instead of `fs`
 * and supports a `?config=<url>` query string override so operators can
 * point at a hosted JSON URL without rebuilding the SPA.
 *
 * Resolution order:
 *   1. `?config=<url>` query string (absolute URL)
 *   2. `${BASE_URL}/v1-deploy-state.json` — sibling of `index.html`
 *      (operators copy `keeper/data/preprod-<release>.json` to
 *      `public/v1-deploy-state.json` before `vite build`)
 */

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

export interface V1Config {
  ceremony: CeremonyState
  network: 'Mainnet' | 'Preprod'
  releaseTag: string
  proxyAddr: string
  vaultNftPolicy: string
  vaultNftName: string
  vaultNftUnit: string
  vusdcxPolicy: string
  vusdcxName: string
  vusdcxUnit: string
  /// Lazily filled by `hydrateRewardAddrs` once Lucid is available.
  userRewardAddr: string
}

const VUSDCX_NAME_HEX = '765553444378'

export function deployStateUrl(): string {
  const params = new URLSearchParams(window.location.search)
  const override = params.get('config')
  if (override) return override
  const base = (import.meta.env.BASE_URL || '/').replace(/\/$/, '')
  return base + '/v1-deploy-state.json'
}

export async function loadV1Config(signal?: AbortSignal): Promise<V1Config> {
  const url = deployStateUrl()
  const res = await fetch(url, { signal })
  if (!res.ok) {
    throw new Error(
      `Failed to fetch deploy state at ${url} (HTTP ${res.status}). ` +
      `Operator: copy ceremony JSON to public/v1-deploy-state.json and redeploy, ` +
      `or pass ?config=<url>.`,
    )
  }
  const ceremony = (await res.json()) as CeremonyState
  if (
    !ceremony.network || !ceremony.releaseTag ||
    !ceremony.mints || !ceremony.refScripts ||
    !ceremony.stateUtxos || !ceremony.hashes
  ) {
    throw new Error('Deploy state JSON missing required top-level fields')
  }

  const vaultNftPolicy = ceremony.mints.vaultNft?.policyId || ''
  const vaultNftName = ceremony.mints.vaultNft?.assetName || ''
  if (!vaultNftPolicy || !vaultNftName) {
    throw new Error(
      ceremony.network === 'Mainnet'
        ? 'V1 mainnet ceremony JSON has no vault NFT entry — placeholder JSON?'
        : 'Ceremony JSON missing vault NFT mint entry',
    )
  }
  const vusdcxPolicy = ceremony.hashes.vusdcxPolicy || ''
  const proxyAddr = ceremony.stateUtxos.vault?.address || ''
  if (!vusdcxPolicy) throw new Error('Ceremony missing hashes.vusdcxPolicy')
  if (!proxyAddr) throw new Error('Ceremony missing stateUtxos.vault.address')

  return {
    ceremony,
    network: ceremony.network,
    releaseTag: ceremony.releaseTag,
    proxyAddr,
    vaultNftPolicy,
    vaultNftName,
    vaultNftUnit: vaultNftPolicy + vaultNftName,
    vusdcxPolicy,
    vusdcxName: VUSDCX_NAME_HEX,
    vusdcxUnit: vusdcxPolicy + VUSDCX_NAME_HEX,
    userRewardAddr: '',
  }
}

export function makeDepositUnit(policy: string, name: string): string {
  return policy + name
}
