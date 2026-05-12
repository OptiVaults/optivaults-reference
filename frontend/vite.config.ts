import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import wasm from 'vite-plugin-wasm'
import topLevelAwait from 'vite-plugin-top-level-await'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Plugin: patch UPLC WASM __wbindgen_start call that crashes in browser
function patchUplcWasm(): any {
  return {
    name: 'patch-uplc-wasm',
    transform(code: string, id: string) {
      if (id.includes('uplc_tx.js') && code.includes('__wbindgen_start')) {
        return code.replace(
          'wasm.__wbindgen_start();',
          'if (typeof wasm.__wbindgen_start === "function") { try { wasm.__wbindgen_start(); } catch(e) {} }'
        )
      }
    },
  }
}

// Round 5 (2026-05-02): the HTML inline Buffer polyfill (Round 2 era)
// was REMOVED. It set `globalThis.Buffer = {from, isBuffer}` — a plain
// object with no `.prototype`. Then the chunk-level polyfill (postbuild
// `scripts/inject-buffer-polyfill.mjs`) saw `Buffer` already defined,
// skipped stub setup, and cbor-x captured the bad plain-object Buffer
// → `SQ.prototype.utf8Write` crashed at runtime.
//
// The chunk-level postbuild prepend now handles everything (full stub
// with `Object.create(Uint8Array.prototype)`-derived prototype +
// own-property `utf8Write`). HTML inline route was unnecessary +
// actively harmful, so it's gone.

export default defineConfig({
  // Order matters: `wasm()` transforms `import * as wasm from "*.wasm"`
  // (the wasm-bindgen ESM-integration shape used by
  // @anastasia-labs/cardano-multiplatform-lib-browser +
  // @emurgo/cardano-message-signing-browser + @lucid-evolution/uplc)
  // into Vite's `?init` async loader. `topLevelAwait()` rewrites the
  // resulting top-level `await initWasm()` calls into IIFE form so
  // browsers without TLA support still work. `patchUplcWasm()` runs
  // last to defang the `__wbindgen_start` call in uplc_tx.js (which
  // throws in some browser configs even after init completes).
  plugins: [wasm(), topLevelAwait(), react(), tailwindcss(), patchUplcWasm()],


  resolve: {
    alias: {
      // Fix libsodium-wrappers-sumo → libsodium-sumo cross-package ESM import
      './libsodium-sumo.mjs': path.resolve(
        __dirname,
        'node_modules/libsodium-sumo/dist/modules-sumo-esm/libsodium-sumo.mjs',
      ),
    },
  },

  optimizeDeps: {
    // Pre-bundle heavy Cardano dependencies
    exclude: [
      '@lucid-evolution/uplc',
      '@anastasia-labs/cardano-multiplatform-lib-browser',
      '@emurgo/cardano-message-signing-browser',
    ],
  },

  build: {
    target: 'es2022',
    // Block 5 originally split @lucid-evolution + cardano-multiplatform-lib
    // into separate manualChunks — but this broke the CML WASM
    // initializer (`__wbindgen_add_to_stack_pointer is not a function`
    // at TX-build time on Cloudflare Pages). The WASM JS wrapper +
    // its initializer must end up in the same chunk for the binding
    // helpers to be wired up before any caller invokes a CML method.
    // Until we can isolate the breakage, defer to Vite's default
    // chunk strategy. Lazy `await import()` boundaries in lib/* still
    // keep CML out of the initial route bundle.
    chunkSizeWarningLimit: 3_000,
  },

  // Define global polyfills
  define: {
    global: 'globalThis',
  },

  // Allow WASM files to be served
  assetsInclude: ['**/*.wasm'],
})
