/**
 * V1 emergency-withdraw — Vite config (mirrors v1/reference/frontend
 * setup so the CML / UPLC WASM bundling works the same way).
 *
 * Key plugins (order matters):
 *   - `wasm()` rewrites `import * as wasm from "*.wasm"` (used by
 *     @anastasia-labs/cardano-multiplatform-lib-browser +
 *     @lucid-evolution/uplc) into Vite's `?init` async loader.
 *   - `topLevelAwait()` rewrites resulting top-level `await initWasm()`
 *     into IIFE form for browsers without TLA support.
 *   - `react()` / `tailwindcss()` standard.
 *
 * The Buffer polyfill is injected post-build via
 * `scripts/inject-buffer-polyfill.mjs`. Vite has multiple polyfill
 * injection points (HTML inline / chunk prepend / app code) that can
 * race on first-run; the chunk-level stub uses a defensive-override
 * pattern (check completeness, not existence) and pins `utf8Write`
 * as an own property on the prototype.
 */
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import wasm from 'vite-plugin-wasm'
import topLevelAwait from 'vite-plugin-top-level-await'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [wasm(), topLevelAwait(), react(), tailwindcss()],

  resolve: {
    alias: {
      // Same fix as v1/reference/frontend — libsodium-wrappers-sumo's
      // ./libsodium-sumo.mjs cross-package import doesn't resolve through
      // ESM. Point it at the actual path under node_modules/libsodium-sumo.
      './libsodium-sumo.mjs': path.resolve(
        __dirname,
        'node_modules/libsodium-sumo/dist/modules-sumo-esm/libsodium-sumo.mjs',
      ),
    },
  },

  optimizeDeps: {
    exclude: [
      '@lucid-evolution/uplc',
      '@anastasia-labs/cardano-multiplatform-lib-browser',
      '@emurgo/cardano-message-signing-browser',
    ],
  },

  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 3_000,
  },

  define: {
    global: 'globalThis',
  },

  assetsInclude: ['**/*.wasm'],
})
