/**
 * V1 deployment configuration — runtime config for vault address, NFT
 * policies, and ceremony anchors.
 *
 * The frontend reads vault state directly from chain via Blockfrost, so
 * it needs to know which UTXO to look at. After every fresh ceremony,
 * operators replace the values below (or override via `VITE_*` env vars
 * at build time).
 *
 * Resolution order (per field):
 *   1. Vite env var (VITE_*) — operator's build-time override
 *   2. Network preset constant below — per-network default
 *   3. Empty string — UI shows "vault not configured" state
 *
 * Field origins (post-ceremony deploy state JSON):
 *   - proxyAddr             ← stateUtxos.vault.address (= proxy script address)
 *   - vaultNftPolicy        ← mints.vaultNft.policyId
 *   - vaultNftName          ← mints.vaultNft.assetName  (typically "OptiVault")
 *   - vusdcxPolicy          ← hashes.vusdcxPolicy
 *   - vusdcxName            ← hashes.vusdcxAssetName    (typically "vUSDCx")
 *   - depositTokenPolicy/Name ← VaultDatum.deposit_token_policy/name
 *   - registryAddr          ← stateUtxos.registry.address
 *   - registryAuthPolicy    ← mints.registryAuthNft.policyId
 *   - liqwidMarketPolicy    ← Liqwid Action one-shot NFT for the chosen market
 */

const NETWORK = (import.meta.env.VITE_NETWORK || 'preprod') as 'preprod' | 'mainnet'

export interface V1Config {
  network: 'preprod' | 'mainnet'
  /** bech32 address — where the vault UTXO lives (proxy.address). */
  proxyAddr: string
  /** hex28 — one-shot vault NFT minting policy. */
  vaultNftPolicy: string
  /** hex — vault NFT asset name; default "OptiVault" = `4f7074695661756c74`. */
  vaultNftName: string
  /** hex28 — vUSDCx share-token minting policy (parameterized on vault NFT). */
  vusdcxPolicy: string
  /** hex — vUSDCx asset name; default "vUSDCx" = `765553444378`. */
  vusdcxName: string
  /** hex28 — deposit-token (USDCx) policy. */
  depositTokenPolicy: string
  /** hex — deposit-token asset name. */
  depositTokenName: string
  /** bech32 address — registry script (for /api/market replacement). */
  registryAddr: string
  /** hex28 — registry auth NFT minting policy. */
  registryAuthPolicy: string
  /** hex28 — Liqwid market state token policy (operator's primary
   *  Liqwid market — DJED / USDM / etc. Empty to disable on-chain APY. */
  liqwidMarketPolicy: string
}

const VAULT_NFT_NAME_DEFAULT = '4f7074695661756c74' // "OptiVault"
const VUSDCX_NAME_DEFAULT = '765553444378'         // "vUSDCx"

// ────────────────────────────────────────────────────────────────────
// Network presets — operators replace after every fresh V1 ceremony.
// Empty values surface the "vault not configured" banner so a forked
// instance fails loudly instead of silently pointing at the wrong vault.
// ────────────────────────────────────────────────────────────────────

const PREPROD_PRESET: V1Config = {
  network: 'preprod',
  proxyAddr: '',
  vaultNftPolicy: '',
  vaultNftName: VAULT_NFT_NAME_DEFAULT,
  vusdcxPolicy: '',
  vusdcxName: VUSDCX_NAME_DEFAULT,
  depositTokenPolicy: '',
  depositTokenName: '',
  registryAddr: '',
  registryAuthPolicy: '',
  liqwidMarketPolicy: '',
}

const MAINNET_PRESET: V1Config = {
  network: 'mainnet',
  proxyAddr: '',
  vaultNftPolicy: '',
  vaultNftName: VAULT_NFT_NAME_DEFAULT,
  vusdcxPolicy: '',
  vusdcxName: VUSDCX_NAME_DEFAULT,
  // Mainnet USDCx (Circle xReserve, Feb 2026 launch). Asset name is
  // `USDCx` = hex `5553444378`.
  depositTokenPolicy: '1f3aec8bfe7ea4fe14c5f121e2a92e301afe414147860d557cac7e34',
  depositTokenName: '5553444378',
  registryAddr: '',
  registryAuthPolicy: '',
  liqwidMarketPolicy: '',
}

// Vite replaces `import.meta.env.VITE_FOO` LITERALLY at build time —
// any aliasing (`const env = import.meta.env`) defeats the static
// replacer + leaves the value undefined at runtime. Every field
// below uses a direct dot-access expression so the operator's `.env`
// values get baked into the production bundle.
function pick(envVal: string | undefined, fallback: string): string {
  return typeof envVal === 'string' && envVal.length > 0 ? envVal : fallback
}

export const V1_CONFIG: V1Config = (() => {
  const preset = NETWORK === 'mainnet' ? MAINNET_PRESET : PREPROD_PRESET
  return {
    network: NETWORK,
    proxyAddr:           pick(import.meta.env.VITE_PROXY_ADDR, preset.proxyAddr),
    vaultNftPolicy:      pick(import.meta.env.VITE_VAULT_NFT_POLICY, preset.vaultNftPolicy),
    vaultNftName:        pick(import.meta.env.VITE_VAULT_NFT_NAME, preset.vaultNftName),
    vusdcxPolicy:        pick(import.meta.env.VITE_VUSDCX_POLICY, preset.vusdcxPolicy),
    vusdcxName:          pick(import.meta.env.VITE_VUSDCX_NAME, preset.vusdcxName),
    depositTokenPolicy:  pick(import.meta.env.VITE_DEPOSIT_TOKEN_POLICY, preset.depositTokenPolicy),
    depositTokenName:    pick(import.meta.env.VITE_DEPOSIT_TOKEN_NAME, preset.depositTokenName),
    registryAddr:        pick(import.meta.env.VITE_REGISTRY_ADDR, preset.registryAddr),
    registryAuthPolicy:  pick(import.meta.env.VITE_REGISTRY_AUTH_POLICY, preset.registryAuthPolicy),
    liqwidMarketPolicy:  pick(import.meta.env.VITE_LIQWID_MARKET_POLICY, preset.liqwidMarketPolicy),
  }
})()

/** True iff enough config is present to query vault state on-chain. */
export function isV1Configured(): boolean {
  return Boolean(V1_CONFIG.proxyAddr && V1_CONFIG.vaultNftPolicy && V1_CONFIG.vusdcxPolicy)
}

/** Hex unit (`policy + name`) for one-shot lookups. */
export const V1_VAULT_NFT_UNIT = V1_CONFIG.vaultNftPolicy + V1_CONFIG.vaultNftName
export const V1_VUSDCX_UNIT = V1_CONFIG.vusdcxPolicy + V1_CONFIG.vusdcxName
export const V1_DEPOSIT_TOKEN_UNIT = V1_CONFIG.depositTokenPolicy + V1_CONFIG.depositTokenName
