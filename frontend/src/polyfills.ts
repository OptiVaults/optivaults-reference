/**
 * Browser polyfills that MUST be installed before any other module
 * body executes.
 *
 * ESM modules evaluate depth-first post-order on the import graph,
 * NOT in source order. So a `globalThis.Buffer = ...` line in
 * `main.tsx`'s body runs AFTER every transitive import's body runs.
 *
 * `@lucid-evolution/utils` (statically imported by `lib/lucidClient`
 * → `lib/blockfrostScriptCache`) pulls in `cbor-x`, which evaluates
 * `Buffer.from('ffc00000', 'hex')` at module top-level (constants for
 * IEEE-754 NaN / Infinity CBOR markers). Without `Buffer` on the
 * global at that moment → `ReferenceError: Buffer is not defined` →
 * white screen of death on first load.
 *
 * By isolating the assignment into its own zero-import module and
 * importing it FIRST from `main.tsx`, this file's body runs before
 * any of `main.tsx`'s other static imports' bodies — including the
 * cbor-x module top-level Buffer.from calls.
 *
 * The latent bug was masked
 * by stale-while-revalidate SW cache serving an older chunk that
 * pre-dated the script-cache import; Block 5's `clients.claim()`
 * forced open tabs onto the live bundle and exposed it.
 */

import { Buffer } from 'buffer'

;(globalThis as { Buffer?: unknown }).Buffer = Buffer

// Round 5 fix (2026-05-02): set `utf8Write` as own property on
// feross/buffer's Buffer.prototype. cbor-x's Encoder fast-path checks
// `ByteArray.prototype.utf8Write` and calls `target.utf8Write(...)`.
// feross.Buffer.prototype inherits from Uint8Array.prototype but
// doesn't define utf8Write itself — and the postbuild stub's
// `Uint8Array.prototype.utf8Write` monkey-patch isn't always picked
// up via the prototype chain in production builds (Round 4 deployed
// with that patch but cbor-x still saw `SQ.prototype.utf8Write` as
// undefined — possible engine optimization that doesn't walk the
// chain). Setting it as own property closes that gap.
type Utf8WriteCapable = { utf8Write?: (s: string, o: number, l: number) => number }
const bufProto = Buffer.prototype as unknown as Utf8WriteCapable
if (!bufProto.utf8Write) {
  bufProto.utf8Write = function (s: string, o: number, l: number): number {
    const enc = new TextEncoder()
    const bytes = enc.encode(s)
    const n = Math.min(bytes.length, l)
    for (let i = 0; i < n; i++) (this as Uint8Array)[o + i] = bytes[i]
    return n
  }
}
