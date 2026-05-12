/**
 * Browser-side Blockfrost reference-script cache patch.
 *
 * Mirrors `v1/keeper/src/agent/utils/blockfrostScriptCache.ts` for the
 * frontend's Lucid Evolution Blockfrost provider.
 *
 * Why
 * ---
 * Lucid Evolution's stock `Blockfrost.blockfrostUtxosToUtxos` calls
 * `/scripts/<hash>` + `/scripts/<hash>/cbor` (and `/scripts/<hash>/json`
 * for native scripts) for EVERY UTXO with a `reference_script_hash` on
 * EVERY call to `getUtxos*`. There is no deduplication across a single
 * call and no session cache.
 *
 * In the V1 frontend this hits hard whenever the Lucid singleton
 * resolves UTxOs that include the proxy / order / vault_user / etc.
 * reference-script anchors — those addresses each carry a `scriptRef`
 * the Lucid provider re-fetches on every `getUtxos*` invocation. With
 * 18 ref scripts in the V1 ceremony and frontend polling every 30s,
 * an idle browser tab can burn the operator's free-tier Blockfrost
 * quota in hours.
 *
 * The patch
 * ---------
 * Scripts are content-addressed (the hash IS the script CBOR). A
 * session-wide `Map<scriptHash, ScriptRef>` is always correct and
 * survives the lifetime of the page load. The patch:
 *
 *   1. Module-level `scriptCache` Map shared across all patched
 *      Blockfrost instances created in this tab.
 *   2. LRU eviction at MAX_CACHE_ENTRIES so a malicious large response
 *      (or accidental over-pull) can't unbounded the heap.
 *   3. Idempotent — safe to call on a fresh provider after key swap.
 *   4. Intercepts inside `blockfrostUtxosToUtxos` so every public
 *      `getUtxos*` method benefits with no further wrapping.
 *
 * Result: `/scripts/*` call count drops from
 *   O(utxos_with_ref_scripts × getUtxos_calls)
 * to
 *   O(unique_script_hashes_seen_in_this_tab)
 *
 * For an idle tab polling vault state, that's a one-time fetch of
 * ~10-20 unique scripts — saved across every subsequent poll until the
 * tab closes.
 */
import {
  scriptFromNative,
  applyDoubleCborEncoding,
} from '@lucid-evolution/utils'

// Module-level LRU cache shared across all patched instances in this
// browser context. Per-tab (browser modules are isolated per origin per
// document); not shared across tabs (no IndexedDB / localStorage backing
// here — scripts are 10-30KB each and persisting them buys little since
// the cache is rebuilt cheaply from on-chain after page reload).
const MAX_CACHE_ENTRIES = 200
const scriptCache = new Map<string, unknown>()

function cacheSet(key: string, value: unknown): void {
  if (scriptCache.has(key)) scriptCache.delete(key)
  scriptCache.set(key, value)
  while (scriptCache.size > MAX_CACHE_ENTRIES) {
    const oldest = scriptCache.keys().next().value
    if (oldest === undefined) break
    scriptCache.delete(oldest)
  }
}

function cacheGet(key: string): unknown {
  if (!scriptCache.has(key)) return undefined
  // Touch: re-insert to mark as recently used (LRU bookkeeping).
  const v = scriptCache.get(key)
  scriptCache.delete(key)
  scriptCache.set(key, v)
  return v
}

/**
 * Monkey-patch a Lucid Evolution `Blockfrost` instance so its
 * `blockfrostUtxosToUtxos` method uses the session-wide script cache.
 *
 * Idempotent — safe to call on a new instance after key rotation. The
 * cache itself persists across patches because it is a module-level
 * `Map`, so even if the operator key changes the cached scripts stay
 * valid (scripts are content-addressed).
 */
export function patchBlockfrostScriptCache(bf: any): void {
  if (!bf || typeof bf.blockfrostUtxosToUtxos !== 'function') return
  if (bf.__scriptCachePatched) return

  const url: string = bf.url

  async function resolveScriptRef(refHash: string): Promise<unknown> {
    const cached = cacheGet(refHash)
    if (cached !== undefined) return cached
    // `bf.projectId` honours any subsequent key swap done by the host
    // app — the cache miss path always uses the current credential.
    const headers: Record<string, string> = {
      project_id: bf.projectId,
      lucid: 'lucid',
    }
    const typeRes = (await fetch(`${url}/scripts/${refHash}`, { headers }).then(
      (res) => res.json(),
    )) as { type?: string }
    const cborRes = (await fetch(`${url}/scripts/${refHash}/cbor`, { headers }).then(
      (res) => res.json(),
    )) as { cbor?: string }
    const type = typeRes?.type
    const script = cborRes?.cbor
    let resolved: unknown
    switch (type) {
      case 'timelock': {
        const nativeRes = (await fetch(`${url}/scripts/${refHash}/json`, {
          headers,
        }).then((res) => res.json())) as { json?: unknown }
        resolved = scriptFromNative(nativeRes?.json as never)
        break
      }
      case 'plutusV1':
        resolved = { type: 'PlutusV1', script: applyDoubleCborEncoding(script as string) }
        break
      case 'plutusV2':
        resolved = { type: 'PlutusV2', script: applyDoubleCborEncoding(script as string) }
        break
      case 'plutusV3':
        resolved = { type: 'PlutusV3', script: applyDoubleCborEncoding(script as string) }
        break
      default:
        resolved = undefined
    }
    cacheSet(refHash, resolved)
    return resolved
  }

  bf.blockfrostUtxosToUtxos = async function (result: any[]) {
    const batchSize = 10
    const utxos: any[] = []
    for (let i = 0; i < result.length; i += batchSize) {
      const batch = result.slice(i, i + batchSize)
      const mapped = await Promise.all(
        batch.map(async (r: any) => ({
          txHash: r.tx_hash,
          outputIndex: r.output_index,
          assets: Object.fromEntries(
            r.amount.map(({ unit, quantity }: { unit: string; quantity: string }) => [
              unit,
              BigInt(quantity),
            ]),
          ),
          address: r.address,
          datumHash: !r.inline_datum && r.data_hash || undefined,
          datum: r.inline_datum || undefined,
          scriptRef: r.reference_script_hash
            ? await resolveScriptRef(r.reference_script_hash)
            : undefined,
        })),
      )
      utxos.push(...mapped)
    }
    return utxos
  }

  bf.__scriptCachePatched = true
}

/** Diagnostic — current cache size. Useful from the Settings page if
 *  the operator wants to see how effective the cache is per session. */
export function getScriptCacheSize(): number {
  return scriptCache.size
}
