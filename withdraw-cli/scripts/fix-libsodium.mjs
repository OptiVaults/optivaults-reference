#!/usr/bin/env node
/**
 * Postinstall workaround for a packaging bug in libsodium-wrappers-sumo.
 *
 * libsodium-wrappers-sumo@0.7.x ships an ESM build whose
 * `dist/modules-sumo-esm/libsodium-wrappers.mjs` does:
 *
 *     import sodium from "./libsodium-sumo.mjs"
 *
 * but `libsodium-sumo.mjs` is NOT shipped inside libsodium-wrappers-sumo —
 * it lives in the separate `libsodium-sumo` package. Under Node ESM that
 * relative import resolves to a non-existent sibling and throws
 * ERR_MODULE_NOT_FOUND, which crashes this CLI on startup (it reaches
 * libsodium-wrappers-sumo transitively via @lucid-evolution/lucid).
 *
 * The Vite-based v1 components (frontend, emergency-withdraw) paper over
 * this with a `resolve.alias` because they bundle. This CLI runs on plain
 * Node with dependencies left external, so we instead co-locate the file:
 * copy libsodium-sumo's module next to the wrapper that imports it.
 *
 * Wired to `postinstall`, so it runs after every `npm install` / `npm ci`
 * — for from-source builds and for consumers of the published package
 * alike. Idempotent, and never fails the install (warns instead).
 */
import { existsSync, copyFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SUBPATH = join('dist', 'modules-sumo-esm', 'libsodium-sumo.mjs')

/** Walk up from `start`, returning the first `node_modules/<name>` that exists. */
function findPackage(name, start) {
  let dir = start
  for (;;) {
    const candidate = join(dir, 'node_modules', name)
    if (existsSync(join(candidate, 'package.json'))) return candidate
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

function warn(msg) {
  // Never fail `npm install` over this — just surface it.
  console.warn(`[fix-libsodium] skipped: ${msg}`)
}

function main() {
  const here = dirname(fileURLToPath(import.meta.url))

  const wrappers = findPackage('libsodium-wrappers-sumo', here)
  if (!wrappers) return warn('libsodium-wrappers-sumo not found')

  const target = join(wrappers, SUBPATH)
  if (existsSync(target)) {
    console.log('[fix-libsodium] libsodium-sumo.mjs already in place — nothing to do')
    return
  }

  // Prefer a copy nested under the wrapper; otherwise the hoisted one.
  const nested = join(wrappers, 'node_modules', 'libsodium-sumo')
  const sumo = existsSync(join(nested, 'package.json'))
    ? nested
    : findPackage('libsodium-sumo', here)
  if (!sumo) return warn('libsodium-sumo package not found')

  const source = join(sumo, SUBPATH)
  if (!existsSync(source)) return warn(`source file missing: ${source}`)

  copyFileSync(source, target)
  console.log('[fix-libsodium] co-located libsodium-sumo.mjs for libsodium-wrappers-sumo')
}

try {
  main()
} catch (err) {
  warn(err && err.message ? err.message : String(err))
}
