/**
 * V1 withdraw-cli — deploy-state loader.
 *
 * V1 ceremonies rotate per-release; the canonical anchor is the
 * `v1-deploy-state.json` file the operator publishes alongside the
 * frontend (mirrors `keeper/data/preprod-<release>.json`). The CLI
 * resolves which file to read in this order:
 *
 *   1. `--config <path>` flag (absolute or relative path)
 *   2. `OPTIVAULTS_V1_CONFIG` env var
 *   3. Bundled defaults: `config/preprod.json` for `--network preprod`
 *      and `config/mainnet.json` for `--network mainnet` (resolved via
 *      `import.meta.url`, so it works after `tsup` bundling)
 *
 * The bundled `config/preprod.json` ships with the current p23 ceremony
 * snapshot. After a fresh ceremony the operator can either:
 *   (a) update the bundled file + republish the package, or
 *   (b) point users at a hosted JSON URL via `OPTIVAULTS_V1_CONFIG`
 *
 * Mainnet placeholder ships unfilled — passing `--network mainnet`
 * without `--config` raises an explicit error so users don't accidentally
 * exercise a stale anchor.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

// ─────────────────────────────────────────────────────────────────
// Public types — same shape as `keeper/data/preprod-<release>.json`
// + `frontend/src/lib/v1Deploy.ts::CeremonyState`.
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
 * Hydrated config used by all CLI commands. Adds the most-used derived
 * fields (proxy address, NFT unit, deposit token unit) so command
 * implementations don't have to re-derive them from `ceremony.hashes`
 * + `ceremony.stateUtxos.vault.address` every time.
 */
export interface V1Config {
  ceremony: CeremonyState
  network: 'Mainnet' | 'Preprod'
  releaseTag: string

  /// Bech32 address of the vault UTXO (lives at proxy script address).
  proxyAddr: string
  /// Hex28 — vault NFT minting policy (compile-time anchor).
  vaultNftPolicy: string
  /// Hex — vault NFT asset name (typically "OptiVault" hex).
  vaultNftName: string
  /// Hex unit (`policy + name`).
  vaultNftUnit: string
  /// Hex28 — vUSDCx share-token minting policy.
  vusdcxPolicy: string
  /// Hex — vUSDCx asset name (always "vUSDCx" hex per V1 ceremony convention).
  vusdcxName: string
  /// Hex unit.
  vusdcxUnit: string

  /// Reward (script staking) addresses for each Withdraw-Zero validator
  /// the user might invoke directly — V1 user paths only need `user` for
  /// Withdraw + CommunitySunset.
  userRewardAddr: string
}

// ─────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────

/// V1 ceremony convention — vUSDCx asset name is fixed across all
/// releases. Hex of the ASCII string "vUSDCx".
const VUSDCX_NAME_HEX = '765553444378'

// ─────────────────────────────────────────────────────────────────
// Load + hydrate
// ─────────────────────────────────────────────────────────────────

function bundledConfigPath(network: 'mainnet' | 'preprod'): string {
  const here = path.dirname(fileURLToPath(import.meta.url))
  // After tsup bundling, dist/cli.js sits at <pkg>/dist/cli.js, so
  // <pkg>/config/<network>.json is one level up.
  // During `npm run dev`, src/config.ts sits at <pkg>/src/config.ts so
  // the same `..` resolution still works.
  return path.resolve(here, '..', 'config', `${network}.json`)
}

function readJson(p: string): CeremonyState {
  if (!fs.existsSync(p)) {
    throw new Error(`Config file not found: ${p}`)
  }
  const raw = fs.readFileSync(p, 'utf8')
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (e) {
    throw new Error(`Config file is not valid JSON: ${p} (${(e as Error).message})`)
  }
  const c = parsed as Partial<CeremonyState>
  if (!c.network || !c.releaseTag || !c.mints || !c.refScripts || !c.stateUtxos || !c.hashes) {
    throw new Error(
      `Config missing required fields (network/releaseTag/mints/refScripts/stateUtxos/hashes) at ${p}`,
    )
  }
  return parsed as CeremonyState
}

/**
 * Resolve a config file path from CLI flags + env + bundled defaults.
 * `network` only used as the bundled-defaults selector when no override
 * is provided; the actual network the CLI runs against comes from the
 * resolved JSON's `network` field, which is the source of truth.
 */
export function resolveConfigPath(
  network: 'mainnet' | 'preprod',
  cliConfigFlag?: string,
): string {
  if (cliConfigFlag) {
    return path.resolve(process.cwd(), cliConfigFlag)
  }
  if (process.env.OPTIVAULTS_V1_CONFIG) {
    return path.resolve(process.cwd(), process.env.OPTIVAULTS_V1_CONFIG)
  }
  return bundledConfigPath(network)
}

/**
 * Load + hydrate a V1 config from a file path. Throws on:
 *  - file missing or invalid JSON
 *  - placeholder mainnet config (network field present but mints empty)
 *  - missing required hash/UTXO fields
 *  - resolved network mismatch with the requested network flag
 */
export function loadV1Config(
  network: 'mainnet' | 'preprod',
  cliConfigFlag?: string,
): V1Config {
  const p = resolveConfigPath(network, cliConfigFlag)
  const ceremony = readJson(p)

  const wantedNetwork = network === 'mainnet' ? 'Mainnet' : 'Preprod'
  if (ceremony.network !== wantedNetwork) {
    throw new Error(
      `Config network mismatch: --network ${network} but file says ${ceremony.network}. ` +
      `Pass --config <path> with the matching ceremony JSON, or change --network.`,
    )
  }

  const vaultNftPolicy = ceremony.mints.vaultNft?.policyId
  const vaultNftName = ceremony.mints.vaultNft?.assetName
  if (!vaultNftPolicy || !vaultNftName) {
    throw new Error(
      `Config has no vault NFT mint entry. ` +
      (network === 'mainnet'
        ? `V1 mainnet ceremony has not been performed yet — when it lands, replace ` +
          `config/mainnet.json with the published ceremony JSON.`
        : `Config file appears to be a placeholder.`),
    )
  }

  const vusdcxPolicy = ceremony.hashes.vusdcxPolicy || ''
  if (!vusdcxPolicy) {
    throw new Error(`Config missing hashes.vusdcxPolicy`)
  }

  const proxyAddr = ceremony.stateUtxos.vault?.address || ''
  if (!proxyAddr) {
    throw new Error(`Config missing stateUtxos.vault.address (proxy address)`)
  }

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
    // Reward addresses derived lazily inside vault.ts via Lucid CML so we
    // don't pull `@lucid-evolution/utils` into the entry-point module.
    userRewardAddr: '',
  }
}

/** Hex unit for the vault's deposit token (USDCx in production). Lazy-
 *  derived from on-chain VaultDatum at withdraw time, not from the
 *  ceremony JSON, because the deposit_token policy can vary per ceremony
 *  (Preprod uses TestUSDC, mainnet will use Circle xReserve USDCx). */
export function makeDepositUnit(policy: string, name: string): string {
  return policy + name
}
