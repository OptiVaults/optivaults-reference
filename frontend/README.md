# OptiVaults V1 Frontend

React 19 + Vite 8 + TailwindCSS v4 SPA for the [OptiVaults V1](https://github.com/OptiVaults/optivaults-protocol) non-custodial yield vault on Cardano.

> **V1 pre-launch.** Design + Aiken implementation complete. The OptiVaults team currently operates a Preprod testnet instance at <https://v1-preprod.pages.dev> for behavioural verification. V1 mainnet launch happens at the pre-audit 100K USDCx cap once whitepaper §1.5 launch gates clear; external audit (target Q2-Q3 2027 if §8.1 funding stack delivers) lifts the cap toward Stage 3 — audit is a cap-lift gate, not a launch gate (see whitepaper §0.2).

## What it does

- Connects a CIP-30 Cardano wallet (Eternl, Nami, Lace, Vespr, Flint, Yoroi, Typhon)
- Lets users deposit USDCx → receive vUSDCx share tokens
- Lets users withdraw (direct or queued) → receive USDCx + accumulated yield
- Shows vault state (TVL, share price, allocations, recent compound history)
- Provides a self-serve emergency-withdraw path when the keeper has been inactive for 7+ days

The frontend **never handles private keys**. All signing goes through the CIP-30 wallet extension; this app only assembles the TX, presents it for signing, and submits the signed CBOR.

## Architecture

The frontend is in transition from an operator-API-server-backed model toward a **pure client-side** design that talks to the Cardano chain directly via Blockfrost and builds TXs in-browser via Lucid Evolution. This aligns with V1's public-goods + KaaS posture: no operator backend dependency, identical user experience whether the OptiVaults team's instance is online or not.

```
                  ┌─────────────────────────────┐
                  │    Frontend (this repo)     │
                  ├─────────────────────────────┤
   read paths     │  Blockfrost direct (REST)   │   ← already in place (Block 1)
                  ├─────────────────────────────┤
   tx build       │  Lucid Evolution in-browser │   ← in progress
                  ├─────────────────────────────┤
   tx submit      │  CIP-30 wallet.submitTx     │   ← in progress
                  ├─────────────────────────────┤
   history / APY  │  chain walk + IndexedDB     │   ← in progress
                  └─────────────────────────────┘
                                ↓
                          Cardano chain
```

A small operator-hosted API server still backs the remaining write paths (deposit/withdraw TX building, governance helpers) until the in-browser TX builder lands. Read paths (wallet balance, TX-status polling) are already direct.

### Migration status

| Block | Scope | Status |
|-------|-------|--------|
| 1 | Blockfrost direct client (`src/lib/blockfrost.ts`); migrate balance + TX-status read paths off the API server | ✅ done |
| 2 | Read paths off API: `/api/health` removed (network mismatch via CIP-30 `getNetworkId`), `/api/vault-state` → `lib/vaultQuery` (Blockfrost UTXO + 29-field VaultDatum decode via lazy-loaded Lucid `Data.from`), `/api/market` → `lib/marketQuery` (Liqwid MarketState UTXO + on-chain kink-model APY weighted against vault `liqwid_positions`) | ✅ done |
| 3 | TX building client-side via Lucid Evolution (Direct Deposit, Direct Withdraw, Queued Deposit/Withdraw Orders, Cancel Order). Removes JWT auth + every `/api/build-*-tx` + `/api/submit-tx` + `/api/auth/*` endpoint. Operator publishes ceremony state JSON at `public/v1-deploy-state.json` for the SPA to load at startup. | ✅ done |
| 4 | History views read directly: TX history (per-user) is pure chain-walk via Blockfrost + IndexedDB cache; KeeperHistory + APY chart prefer R2-published JSONL (`VITE_HISTORY_BASE_URL`) and fall back to chain-walk when no R2 is configured. Multi-keeper aggregation via `historyKeepers: string[]` in the deploy-state JSON. KaaS-compatible — no operator backend required. Keeper R2 publisher uses Worker-proxy + on-chain auth (Model 3) so keepers don't need shared R2 credentials. | ✅ done |
| 5 | BYO Blockfrost key UI in Settings (test/save/clear, network-magic check, localStorage-only); Vite `manualChunks` splits `@lucid-evolution/*`, CML, `@noble/*` into separate chunks loaded on first TX-building call (vault state + market query render before the heavy WASM is needed); Service Worker (`public/sw.js`) caches the SPA shell + hashed assets stale-while-revalidate, skips Blockfrost / R2 / Worker hosts so chain state is always live, registered after first paint in PROD only. | ✅ done |

## Setup

```bash
npm install
cp .env.example .env
# Edit .env: set VITE_NETWORK + VITE_BLOCKFROST_API_KEY
npm run dev          # Vite dev server
npm run build        # Production build to dist/
npm test             # Vitest test suite
```

## Environment variables

| Variable | Description | Example |
|----------|-------------|---------|
| `VITE_NETWORK` | Cardano network | `preprod` or `mainnet` |
| `VITE_BLOCKFROST_API_KEY` | Blockfrost project_id used for direct chain access. Free tier 50K req/day per key — sign up at <https://blockfrost.io>. Operators may also let users supply their own key at runtime via the Settings UI (BYO key, planned in Block 5). | `preprod...` |
| `VITE_API_URL` | **Deprecated.** Legacy operator-hosted API server URL. Still used by Block-2/3-pending endpoints; will be removed once those migrations complete. | `https://api.optivaults.app` |

### Why BYO key matters

Blockfrost's free tier is 50,000 requests/day per key. A frontend with vault polling + per-TX status checks consumes roughly **~3,000 requests per active session per day**. If many users share one operator-baked key, the rate limit becomes the bottleneck before the vault economics do. Block 5 will surface a Settings UI that lets each user paste their own free-tier key (gets them their own quota) while keeping the operator's default key available for casual visitors.

## OptiVaults-operated instance

The OptiVaults team plans to operate a public instance of this frontend at **<https://v1.optivaults.app>** once V1 mainnet launch happens (per whitepaper §1.5 launch gates). Currently the same codebase is deployed to **<https://v1-preprod.pages.dev>** for Preprod testnet behavioural verification. The codebase in this repo is the source of both instances — operators forking for their own deployments may want to review the items below.

## Operator-specific values to review before forking

If you fork this repo to run your own instance, replace these defaults with your own values:

| File | What to change |
|------|----------------|
| `index.html` | All `https://v1.optivaults.app/` URLs (canonical, og, twitter, hreflang, JSON-LD) → your domain |
| `public/manifest.json` | `name` / `description` if you re-brand (icon paths are already relative) |
| `public/sitemap.xml` | All `<loc>` URLs → your domain |
| `public/robots.txt` | `Sitemap:` URL → your domain |
| `public/llms.txt` | All operator-hosted URLs → your domain (or rewrite to your branding entirely) |
| `src/pages/Deposit.tsx` `ALLOWED_ADDRESSES` | Defaults to `[]` (open to all). Populate the array if you want a frontend-side allowlist (e.g., closed beta). The on-chain contract is permissionless regardless. |
| `.env` (`VITE_BLOCKFROST_API_KEY`) | Operator's Blockfrost key, or instruct users to BYO via Settings (Block 5) |
| `.env` (`VITE_API_URL`) | Point to your own API host while Block 2-4 migrations are pending |

## Project structure

```
src/
├── lib/
│   └── blockfrost.ts         Blockfrost direct REST client (read paths)
├── hooks/
│   ├── useCardano.tsx        CIP-30 wallet + vault state polling
│   └── useClickOutside.ts    Generic click-outside hook for menus
├── pages/
│   ├── Dashboard.tsx         Vault overview, APY, strategy
│   ├── Deposit.tsx           Deposit USDCx → receive vUSDCx
│   ├── Withdraw.tsx          Burn vUSDCx → receive USDCx
│   ├── History.tsx           User transaction history
│   ├── KeeperHistory.tsx     Keeper compound / rebalance log
│   ├── Emergency.tsx         Emergency withdrawal (keeper-inactive fallback)
│   └── Settings.tsx          Language, default withdraw mode, contract version info
├── components/               Reusable UI (WalletButton, ApyChart, banners, etc.)
├── config/hardCap.ts         Pre-audit TVL cap helpers
├── utils/formatters.ts       Number / address / date formatting
└── i18n/index.tsx            EN + 繁體中文 + 日本語 translations
```

## Security highlights

- **No private keys ever in the browser** — CIP-30 only.
- **Blind-sign defence** — TX CBOR parsed and verified before sending to the wallet for signing.
- **Slippage caps** — every Order / Withdraw bounds `min_receive` on-chain (the validator rejects out-of-band fills regardless of what the frontend sends).
- **Network-mismatch detection** — refuses to sign cross-network TXs (e.g. preprod TX against a mainnet wallet).
- **Frozen-vault blocking** — write operations refuse to submit when the vault is in emergency-frozen state (Phase 1 Layer 1 governance safety).
- **No persistent secrets in `localStorage`** — only wallet name (for auto-reconnect) and optional user-supplied Blockfrost key. No JWTs, session tokens, or PII.

## Tests

```bash
npm test               # full suite
npm run test:watch     # vitest watch mode
```

Vitest covers: formatters, hardCap helpers, deposit / withdraw flows, security guards, history rendering, dashboard parsing, useCardano hook, page coverage smoke tests.

## Deployment

The frontend is a standard static SPA and can be deployed to any static host (Cloudflare Pages, Vercel, Netlify, S3 + CloudFront, GitHub Pages, nginx, etc.). The general flow:

1. `npm run build` → produces a static bundle in `dist/`
2. Upload `dist/` to your hosting target
3. Configure your host to serve `index.html` for all routes (SPA catch-all). `public/_redirects` already covers Cloudflare Pages; for other hosts, add an equivalent rewrite rule.

Pick whatever hosting fits your operator setup — this repo intentionally does not ship a deployment script.

## License

[Apache License 2.0](../LICENSE) — permissive open-source, OSI-approved. Forks welcome.
