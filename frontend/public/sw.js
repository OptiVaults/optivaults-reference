/**
 * OptiVaults V1 — Service Worker
 *
 * Strategy:
 *   - Static assets (HTML, CSS, JS, WASM, fonts) → stale-while-revalidate
 *     so users see the last cached SPA shell instantly even when offline,
 *     while the SW refreshes the cache in the background.
 *   - Lucid Evolution + CML chunks (the heavy WASM bundles split out by
 *     vite.config.ts manualChunks) → cache-first with periodic refresh.
 *   - Blockfrost / R2 / Worker API responses → never cached (real-time
 *     chain state must always be fresh).
 *   - SPA routes (`/`, `/deposit`, `/withdraw`, ...) → app-shell:
 *     return cached `index.html` for any in-app route so the SPA boots
 *     offline; the React router takes over from there.
 *
 * Cache version: bump when shipping breaking changes to the asset
 * fingerprinting (Vite hashes ensure most asset URL changes are
 * automatic, but the SW itself + shell HTML need a manual nudge).
 *
 * Registered from `src/main.tsx` after first paint to avoid blocking
 * the critical render path.
 */

const VERSION = 'v1.0.0-block5-history-r18-multi-tag'
const SHELL_CACHE = `optivaults-shell-${VERSION}`
const ASSET_CACHE = `optivaults-assets-${VERSION}`

// Hosts whose responses we *never* cache — chain state must always
// be fresh. Frontend reads Blockfrost directly + R2 for history;
// neither tolerates stale data masquerading as live.
const NEVER_CACHE_HOSTS = [
  'cardano-mainnet.blockfrost.io',
  'cardano-preprod.blockfrost.io',
  // R2 dev URLs (operator-specific suffix; matched by substring below).
  '.r2.dev',
  '.r2.cloudflarestorage.com',
  // Worker proxy (HISTORY_PUBLISH_URL — POST-only, frontend doesn't
  // read but listed defensively).
  '.workers.dev',
]

const ALWAYS_CACHE_PATHS = [
  '/',
  '/icon.png',
  '/icon-192.png',
  '/icon-512.png',
  '/manifest.json',
]

self.addEventListener('install', (event) => {
  // skipWaiting BEFORE waitUntil so a stuck cache addAll doesn't keep the
  // old SW alive — operator key rotations must reach users without manual
  // cache clears (Phase 106 directive: "不可能每次都要user清快取").
  self.skipWaiting()
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(ALWAYS_CACHE_PATHS)),
  )
})

self.addEventListener('activate', (event) => {
  // clients.claim inside waitUntil so already-open tabs swap onto the new
  // SW immediately without a tab-reload — pairs with skipWaiting above.
  event.waitUntil(
    Promise.all([
      caches.keys().then((keys) =>
        Promise.all(
          keys
            .filter((k) => k !== SHELL_CACHE && k !== ASSET_CACHE)
            .map((k) => caches.delete(k)),
        ),
      ),
      self.clients.claim(),
    ]),
  )
})

function isNeverCacheHost(url) {
  try {
    const u = new URL(url)
    return NEVER_CACHE_HOSTS.some((host) => u.hostname.endsWith(host) || u.hostname.includes(host))
  } catch {
    return false
  }
}

function isStaticAsset(url) {
  try {
    const u = new URL(url)
    if (u.origin !== self.location.origin) return false
    return /\.(js|css|wasm|woff2?|png|jpg|jpeg|svg|ico|webp)$/i.test(u.pathname)
  } catch {
    return false
  }
}

function isSpaNavigation(req) {
  return req.mode === 'navigate' || (req.method === 'GET' && req.headers.get('accept')?.includes('text/html'))
}

self.addEventListener('fetch', (event) => {
  const { request } = event

  // Never cache POST / PUT / DELETE — those are TX submits, key-tests,
  // etc. that must hit the real endpoint.
  if (request.method !== 'GET') return

  if (isNeverCacheHost(request.url)) {
    return // browser default — direct fetch, no cache interception
  }

  if (isSpaNavigation(request)) {
    // App-shell fallback: try network first; on failure, serve cached
    // index.html so the SPA can boot offline (router renders the
    // requested route from local state).
    event.respondWith(
      fetch(request)
        .then((res) => {
          // Cache the latest shell so future offline navigations work.
          const clone = res.clone()
          caches.open(SHELL_CACHE).then((c) => c.put('/', clone)).catch(() => {})
          return res
        })
        .catch(() => caches.match('/') || caches.match(request)),
    )
    return
  }

  if (isStaticAsset(request.url)) {
    // Stale-while-revalidate for hashed assets — the cached version
    // is fine forever (Vite fingerprinted), but we still refresh in
    // the background for the rare cache-bust case.
    event.respondWith(
      caches.open(ASSET_CACHE).then(async (cache) => {
        const cached = await cache.match(request)
        const networkPromise = fetch(request)
          .then((res) => {
            if (res.ok) cache.put(request, res.clone()).catch(() => {})
            return res
          })
          .catch(() => null)
        return cached || networkPromise || fetch(request)
      }),
    )
    return
  }

  // Default: pass-through, no caching.
})

// Optional: periodic cleanup of asset cache to bound storage. Browsers
// run periodicSync only when conditions met; harmless when not.
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'cleanup-assets') {
    event.waitUntil(
      caches.open(ASSET_CACHE).then(async (cache) => {
        const keys = await cache.keys()
        // Cap to most recent 200 entries by deletion order.
        if (keys.length > 200) {
          const toDelete = keys.slice(0, keys.length - 200)
          await Promise.all(toDelete.map((k) => cache.delete(k)))
        }
      }),
    )
  }
})
