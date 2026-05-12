// MUST be the first import — installs Buffer on globalThis BEFORE any
// other transitive import's body executes (notably cbor-x in
// @lucid-evolution/utils, which uses Buffer.from at module top-level).
// See src/polyfills.ts for the full ESM-evaluation-order rationale.
import './polyfills'

// Suppress UPLC WASM init error — we use Ogmios for TX eval, not browser UPLC
window.addEventListener('error', (e) => {
  const msg = String(e.message || '')
  if (msg.includes('void 0') || msg.includes('wbindgen') || msg.includes('is not a function') || msg.includes('ToBigInt')) {
    e.preventDefault()
    if (import.meta.env.DEV) console.warn('[OptiVaults] Runtime error suppressed:', msg.slice(0, 80))
  }
})
window.addEventListener('unhandledrejection', (e) => {
  const msg = String(e.reason?.message || e.reason || '')
  if (msg.includes('void 0') || msg.includes('wbindgen') || msg.includes('is not a function') || msg.includes('ToBigInt')) {
    e.preventDefault()
  }
})

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Block 5 — Service Worker registration. Defers until after first paint
// so it doesn't compete with the initial render. SW handles offline
// shell caching + WASM/asset stale-while-revalidate. Skipped in DEV
// because Vite's HMR conflicts with SW caching.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .catch((err) => {
        if (import.meta.env.DEV) {
          console.warn('[OptiVaults] SW registration failed:', err)
        }
      })
  })
}
