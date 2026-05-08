/**
 * Buffer + Uint8Array polyfill bootstrap (browser).
 *
 * The HEAVY work — inserting the defensive `Buffer` stub into every JS
 * chunk — is done by `scripts/inject-buffer-polyfill.mjs` post-build.
 * That polyfill installs the stub BEFORE any module-level cbor-x /
 * Lucid Evolution code runs, which is the only point at which the
 * buggy `Buffer.prototype.utf8Write` lookup can crash.
 *
 * Once `feross/buffer` (the npm package) loads in via the imports
 * below, it overrides `globalThis.Buffer` with the full implementation.
 * We re-pin `Buffer.prototype.utf8Write` as an own property afterward
 * (cbor-x captures `globalThis.Buffer` AFTER we install feross's
 * override, so the prototype-chain lookup must work either way).
 *
 * Pattern: defensive override (check completeness, not existence) —
 * multiple polyfill injection points can race on first run, so the
 * chunk-level stub must override even pre-existing partial Buffer
 * rather than skipping when one is detected.
 */

import { Buffer } from 'buffer'

// Defensive override — make sure the chunk-level stub's utf8Write
// patch survives feross/buffer taking over.
if (typeof globalThis.Buffer === 'undefined') {
  ;(globalThis as any).Buffer = Buffer
}
const B = (globalThis as any).Buffer
if (B && B.prototype && typeof B.prototype.utf8Write !== 'function') {
  try {
    B.prototype.utf8Write = function (this: Uint8Array, s: string, o: number, l: number) {
      const e = new TextEncoder()
      const b = e.encode(s)
      const n = Math.min(b.length, l)
      for (let i = 0; i < n; i++) this[o + i] = b[i]
      return n
    }
  } catch (_e) {
    /* read-only prototype on some bundlers — already patched is fine */
  }
}
