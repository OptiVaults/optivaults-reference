/**
 * Browser Lucid Evolution initialiser.
 *
 * Lazy-loads `@lucid-evolution/lucid` (heavy WASM bundle) on first
 * call so vault-state read paths can render before TX-building deps
 * are needed. The Blockfrost provider key flows from `lib/blockfrost`'s
 * `resolveApiKey` (BYO from Settings → env override → operator default).
 *
 * Network is pinned to `VITE_NETWORK` at module import time. A fresh
 * Lucid instance is created once and re-used for all TX builds (cheap
 * — internally caches protocol params).
 */

import { resolveApiKey, blockfrostNetwork } from './blockfrost'
import { patchBlockfrostScriptCache } from './blockfrostScriptCache'
import { invalidateVaultStateCache } from './vaultQuery'

const NETWORK = blockfrostNetwork === 'mainnet' ? 'Mainnet' : 'Preprod'
const BLOCKFROST_URL =
  blockfrostNetwork === 'mainnet'
    ? 'https://cardano-mainnet.blockfrost.io/api/v0'
    : 'https://cardano-preprod.blockfrost.io/api/v0'

let _lucid: any = null
let _lucidPromise: Promise<any> | null = null
/** Project_id the cached Lucid instance was bound to. Used to detect
 *  operator-key rotation events between getLucid() calls — when
 *  `lib/blockfrost.ts::bf<T>` advances the rotation cursor (e.g. on
 *  402 from a burned key), the cached Lucid still holds the old key
 *  internally. Drop + rebuild the cache so subsequent TX builds use
 *  the active key. */
let _lucidBoundKey: string = ''

/**
 * Convert hex CBOR string to a `Uint8Array`. Browser equivalent of
 * Node's `Buffer.from(hex, 'hex')` — used by the Blockfrost evaluator
 * patch below to POST raw bytes instead of base16-encoded text.
 */
function hexToUint8Array(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error('hex length must be even')
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  }
  return out
}

/**
 * Patch a Lucid `Blockfrost` provider's `evaluateTx` to:
 *   1. Strip `d90102` CBOR tag-258 wrappers around the
 *      input/output/required-signer sets (Lucid Evolution emits
 *      these; Ogmios v6 — which Blockfrost's evaluator delegates
 *      to — rejects them with "failed to decode payload from base64
 *      or base16"; mainnet/preprod identical behaviour).
 *   2. POST raw CBOR bytes (`Content-Type: application/cbor`)
 *      instead of letting Lucid send hex-encoded text. Some
 *      Blockfrost endpoints reject hex on the evaluate path.
 *   3. Map Ogmios redeemer-purpose tags
 *      (`spending`/`minting`/`withdrawal`/`publishing`) into the
 *      shorter Lucid-expected forms (`spend`/`mint`/`withdraw`/
 *      `publish`).
 *
 * Mirrors `deploy/lib/blockfrostProvider.ts::patchEval` from the
 * reference keeper — same transform, scoped to what the SPA needs.
 */
function patchBlockfrostEvaluate(bf: any, baseUrl: string, apiKey: string): void {
  bf.evaluateTx = async (tx: string, _additionalUTxOs?: unknown) => {
    const stripped = tx.replace(/d90102([89ab][0-9a-f])/g, '$1')
    const cborBytes = hexToUint8Array(stripped)

    const res = await fetch(`${baseUrl}/utils/txs/evaluate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/cbor', project_id: apiKey },
      // Wrap in Blob — TS in lib.dom doesn't accept the bare
      // `Uint8Array<ArrayBufferLike>` shape but Blob accepts it.
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

    // Output shape MUST match `@lucid-evolution/provider`'s stock
    // `evaluateTx` (see node_modules/@lucid-evolution/provider/
    // dist/index.cjs). Wrong field names produce `Exhaustive check
    // failed: Unhandled case undefined` from Lucid's downstream
    // effect-ts switch on `redeemer_tag`. Lucid's
    // `fromLegacyRedeemerTag` only maps the two legacy long-forms
    // `certificate` → `publish` and `withdrawal` → `withdraw`; every
    // other Ogmios v6 short-form passes through unchanged.
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
    for (const [key, units] of Object.entries(evalResult)) {
      const [pTag, pIndex] = key.split(':')
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

/** Lazy-initialise the singleton Lucid instance (browser-side).
 *
 *  Operator-key rotation handling: each call checks whether the
 *  active operator key has changed since the cached Lucid was built
 *  (e.g. `lib/blockfrost.ts` advanced the rotation cursor on 402).
 *  If so, drop the cache + rebuild with the active key so subsequent
 *  Lucid TX builds (`tx.complete`, `submit`, `evaluateTx`) hit a
 *  live quota slot instead of the burned one. */
export async function getLucid(): Promise<any> {
  const key = resolveApiKey()
  // Cached + still bound to the current active key → reuse.
  if (_lucid && key && key === _lucidBoundKey) return _lucid
  // Active key changed → drop the cache so we rebuild below.
  if (_lucid && key && key !== _lucidBoundKey) {
    _lucid = null
    _lucidPromise = null
    _lucidBoundKey = ''
  }
  if (_lucidPromise) return _lucidPromise
  _lucidPromise = (async () => {
    if (!key) {
      throw new Error(
        'Blockfrost API key missing — set VITE_BLOCKFROST_API_KEY(S) or supply a user key via Settings.',
      )
    }
    const { Lucid, Blockfrost } = await import('@lucid-evolution/lucid')
    const provider: any = new Blockfrost(BLOCKFROST_URL, key)
    patchBlockfrostEvaluate(provider, BLOCKFROST_URL, key)
    // Session-wide /scripts/<hash>(+/cbor) cache — without this, every
    // getUtxos* call re-fetches every ref-script UTXO's script bytes
    // and burns the operator's free-tier Blockfrost quota in hours.
    patchBlockfrostScriptCache(provider)
    _lucid = await Lucid(provider, NETWORK as 'Mainnet' | 'Preprod')
    _lucidBoundKey = key
    return _lucid
  })()
  return _lucidPromise
}

/** Re-bind Lucid's selectedWallet to the supplied CIP-30 API. Call
 *  this after every wallet-connect (or after Eternl session expiry)
 *  so subsequent TX builds pull the wallet's UTxOs + sign with the
 *  active CIP-30 instance. */
export async function selectWalletFromCip30(cip30Api: unknown): Promise<void> {
  const lucid = await getLucid()
  // Lucid Evolution exposes `selectWallet.fromAPI(api)` for CIP-30.
  lucid.selectWallet.fromAPI(cip30Api as never)
}

/**
 * Submit a signed Lucid TX with awareness of Lucid Evolution's internal
 * retry trap — if the original submit landed but Lucid's internal
 * retry catches the resulting "All inputs are spent" / "already
 * included" error, treat that as success and pull the hash off the
 * signed-tx object.
 */
export async function submitTolerant(
  signed: { submit: () => Promise<string>; toHash?: () => string },
): Promise<string> {
  let hash: string
  try {
    hash = await signed.submit()
  } catch (err) {
    const msg = (err as Error).message || String(err)
    if (msg.includes('All inputs are spent') || msg.includes('already been included')) {
      if (typeof signed.toHash === 'function') {
        // Drop the cached vault state — the TX changed it, next refresh
        // should hit Blockfrost.
        invalidateVaultStateCache()
        return signed.toHash()
      }
    }
    throw err
  }
  // Successful submit — drop the cached vault state so the user's
  // Dashboard picks up the new total_deposited / total_shares /
  // idle_buffer immediately on next refresh.
  invalidateVaultStateCache()
  return hash
}

/** Drop the cached Lucid singleton — used on disconnectWallet so the
 *  next connect doesn't carry over the prior session's CIP-30 api. */
export function _resetLucidCache(): void {
  _lucid = null
  _lucidPromise = null
  _lucidBoundKey = ''
}

export const lucidNetwork = NETWORK
