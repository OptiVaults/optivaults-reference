#!/usr/bin/env node
/**
 * Postbuild step that prepends the Buffer + Uint8Array polyfill to every
 * .js chunk in dist/assets/.
 *
 * Why a postbuild script instead of a Vite plugin?
 *   - Vite v8 + Rolldown doesn't honor `build.rolldownOptions.output.banner`
 *     in the way the old Rollup-based Vite did.
 *   - `generateBundle` and `renderChunk` plugin hooks didn't apply
 *     mutations either (silently dropped — possibly a Rolldown plugin
 *     interop quirk; the chunks emitted by Rolldown aren't pipeable
 *     through standard plugin API mutations).
 *   - Rather than chase the right plugin hook, just rewrite the
 *     emitted files on disk after `vite build` finishes. Bulletproof,
 *     no plugin-API guesswork.
 *
 * Round 4 (2026-05-02): Round 3's minimal stub had `from` + `isBuffer`
 * only. cbor-x's Encoder fast-path expects `Buffer.allocUnsafeSlow`
 * (returns ByteArray) AND `ByteArray.prototype.utf8Write`. Stub had
 * neither → `target = new ByteArrayAllocate(8192)` either crashed or
 * returned a Uint8Array, then `target.utf8Write(...)` fired with
 * undefined target.
 *
 * Round 4 fix:
 *   - Patch `Uint8Array.prototype.utf8Write` (idempotent) so cbor-x's
 *     fast-path works whether `Buffer = stub` or `Buffer = feross/buffer`
 *     (feross.Buffer.prototype delegates to Uint8Array.prototype).
 *   - Stub's `Buffer.alloc/allocUnsafe/allocUnsafeSlow` all return
 *     `new Uint8Array(n)` — `new ByteArrayAllocate(n)` returns the
 *     Uint8Array (function returns object → `new` returns that object).
 *   - Stub Buffer.prototype = Uint8Array.prototype so prototype
 *     lookups match what feross/buffer would later install.
 *
 * The full `buffer` npm package overrides `globalThis.Buffer` once
 * `src/polyfills.ts` evaluates, but `Uint8Array.prototype.utf8Write`
 * monkey-patch survives the swap (both stub-Buffer instances and
 * feross.Buffer instances are Uint8Array subclasses).
 *
 * Idempotent — runs detect-then-skip per chunk via MARKER.
 */
import { readdirSync, readFileSync, writeFileSync, statSync } from 'fs'
import { resolve, join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

const POLYFILL = `;(function(){var __u8w=function(s,o,l){var e=new TextEncoder(),b=e.encode(s),n=Math.min(b.length,l);for(var i=0;i<n;i++)this[o+i]=b[i];return n;};if(typeof Uint8Array!=="undefined"&&!Uint8Array.prototype.utf8Write){Uint8Array.prototype.utf8Write=__u8w;}var __needStub=(typeof globalThis.Buffer==="undefined")||!globalThis.Buffer.prototype||typeof globalThis.Buffer.allocUnsafeSlow!=="function";if(__needStub){var __opfR6=function(s){var n=s.length/2,u=new Uint8Array(n);for(var i=0;i<n;i++)u[i]=parseInt(s.substr(i*2,2),16);return u;};var __StubProto=Object.create(Uint8Array.prototype);__StubProto.utf8Write=__u8w;function __StubB(){}__StubB.from=function(i,e){if(typeof i==="string"&&e==="hex")return __opfR6(i);if(Array.isArray(i)||i instanceof Uint8Array)return new Uint8Array(i);return new Uint8Array(0);};__StubB.alloc=function(n){return new Uint8Array(n);};__StubB.allocUnsafe=function(n){return new Uint8Array(n);};__StubB.allocUnsafeSlow=function(n){return new Uint8Array(n);};__StubB.isBuffer=function(b){return b instanceof Uint8Array;};__StubB.prototype=__StubProto;globalThis.Buffer=__StubB;}else if(globalThis.Buffer.prototype&&!globalThis.Buffer.prototype.utf8Write){try{globalThis.Buffer.prototype.utf8Write=__u8w;}catch(_e){}}if(typeof console!=="undefined"&&console.log&&!globalThis.__optiR6Logged){globalThis.__optiR6Logged=true;console.log("[OptiVaults R6] U8.utf8Write="+typeof Uint8Array.prototype.utf8Write+" B="+(globalThis.Buffer?"yes":"no")+" B.allocUnsafeSlow="+(globalThis.Buffer?typeof globalThis.Buffer.allocUnsafeSlow:"n/a")+" B.proto.utf8Write="+(globalThis.Buffer&&globalThis.Buffer.prototype?typeof globalThis.Buffer.prototype.utf8Write:"n/a")+" stubInstalled="+__needStub);}})();\n`

const MARKER = '__opfR6=function(s)' // detect already-injected files (Round 6 — defensive override)

const distDir = resolve(__dirname, '..', 'dist', 'assets')

let injected = 0
let skipped = 0
for (const fileName of readdirSync(distDir)) {
  if (!fileName.endsWith('.js')) continue
  const fullPath = join(distDir, fileName)
  if (!statSync(fullPath).isFile()) continue
  const code = readFileSync(fullPath, 'utf8')
  if (code.includes(MARKER)) {
    skipped++
    continue
  }
  writeFileSync(fullPath, POLYFILL + code)
  injected++
}

console.log(`[inject-buffer-polyfill] ${injected} chunks prepended, ${skipped} already had polyfill`)
