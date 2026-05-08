# V1 Emergency Withdraw

Self-serve withdrawal + Layer 3 dead-man-switch trigger for OptiVaults V1 depositors. **Works entirely in-browser** — no backend dependency, no trust in `optivaults.app` infrastructure.

V1 introduces a permissionless 90-day **CommunitySunset** redeemer that any vUSDCx holder can trigger after extended operational inactivity. This tool surfaces both the routine partial-Withdraw flow and the dead-man-switch trigger in a single self-contained page.

## What V1 adds vs the V9.x / V10 emergency-withdraw

V1 ships a different on-chain contract surface from V9.x / V10:

- **29-field VaultDatum** (vs 25 in V9). Adds `liqwid_positions`, `non_deposit_value`, `last_realloc_time`, `last_fee_update_time`, `last_ada_swap_time`, `keeper_fee_bps`, `gov_fee_bps`, `max_slippage_bps`, `min_swap_peg_bps`, and the operational flag `community_sunset_triggered`.
- **R55 compile-time vault NFT anchor**: `vault_nft_policy` is no longer a datum field — it's baked into `vault_proxy` / `vusdcx` / `order` at compile time. The page locates the vault UTXO by NFT scan at the proxy address.
- **Withdraw redeemer signature**: `Constr(1, [shares, receiver, receiver_output_idx])` (V9 was `Constr(1, [shares, receiver])`). The third field defends against R48 M-1 anti-double-satisfaction.
- **Withdraw-Zero routes through `vault_user`** (V9 used `vault_core`; V1 split the user-flow validators).
- **Layer 3 CommunitySunset**: a permissionless redeemer any vUSDCx holder can call after ≥90 days of operational inactivity. Sets `frozen=1 + community_sunset_triggered=1`, opening the permissionless `vault_recall.RecallFromLiqwid` + `vault_protocol.DeployToProtocol` Layer 2 paths so depositors can recover their full proportional USDCx share even if the founder + governance + keeper have all failed.

## Trust model

| Layer | Who you trust |
|---|---|
| Smart contract | OptiVaults V1 contract code on Cardano (open source, multiple rounds of internal audit, external Q2-Q3 2027 audit pending — Withdraw-Zero pattern + R55 compile-time Vault NFT anchor + V1 Layer 3 governance safety) |
| Vault identity | One-shot Vault NFT minted at deploy ceremony — the validator script hashes physically encode the real NFT policy, and the page verifies the target vault UTXO holds that NFT before building the TX |
| Withdrawal logic | This static React/Vite SPA (open source, ~700 lines logic + 700 lines UI) |
| Chain query | Blockfrost (your own API key) |
| Deploy state | A `v1-deploy-state.json` ceremony file (operator-published, but you can swap it via `?config=<url>` query param) |
| TX signing | Your CIP-30 wallet extension |
| Private key | **Never leaves your wallet** |

## Network support

The page detects the network from the loaded ceremony JSON's `network` field, then validates the user's Blockfrost key prefix and CIP-30 wallet network ID against it. Mismatched keys / wallets are rejected at the connect step.

V1 currently runs on **Preprod only** (release `v1-preprod-p23`). Mainnet deploy lands when V1 ceremony is performed.

## Usage

### Option A — online (operator-hosted)

Visit the operator's URL (e.g. `https://emergency.optivaults.app` once published).

### Option B — offline (recommended for worst-case)

1. **Once** (now, while everything works): Save the page
   - Open the hosted version
   - Press `Ctrl+S` / `⌘+S` — save as "Webpage, HTML Only"
   - Keep the `.html` file somewhere safe (USB drive, encrypted archive)
2. **When needed** (if the operator's host is offline): open the saved HTML file directly
3. Provide your Blockfrost API key, connect wallet, withdraw

The saved HTML is fully self-contained — all JavaScript, CSS, WASM, and contract anchors are inlined.

### Option C — point at your own ceremony JSON

```
https://emergency.optivaults.app/?config=https://my.host/v1-deploy-state.json
```

Useful if you've forked the contract for your own instance and want to share an emergency UI without rebuilding it.

## What this tool does

1. **Loads** the V1 ceremony JSON (default `/v1-deploy-state.json`, override via `?config=...`)
2. **Connects** Blockfrost + your CIP-30 wallet
3. **Queries** the vault UTXO from Cardano (29-field VaultDatum, NFT-scan at proxy addr)
4. **Reads** state: total_deposited, total_shares, idle_buffer, Liqwid positions, frozen, sunset, last activity
5. **Calculates** Withdraw quote: `shares × td / ts` minus 0.1% early-fee (waived if keeper inactive 7+ days)
6. **Builds** V1 Withdraw-Zero transaction (proxy spend + vault_user staking withdrawal + vUSDCx burn)
7. **Computes** Layer 3 sunset countdown: `max(last_compound, last_realloc) + 90 days`
8. **Builds** CommunitySunset transaction once threshold passes (datum-only mutation: `frozen=1 + community_sunset_triggered=1`)
9. Asks your wallet to sign + submits via Blockfrost

## What this tool does NOT do

- **No full-drain** — if you are the last depositor, use admin tooling (full drain requires NFT burn)
- **No deposits** — withdrawal only
- **No batch orders** — direct withdrawal only
- **No governance operations** (use `opti-gov` CLI for those)
- **No Liqwid Recall / DEX swap-out** — once Layer 3 sunset has fired, those redeemers are permissionless but still need the multi-validator ceremony (use `opti-gov` or follow `docs/runbooks/keeper-outage-recovery.md`)

## Development

```bash
cd v1/reference/emergency-withdraw
npm install
npm run dev      # vite dev server on :5173
npm run build    # outputs dist/ (Buffer polyfill auto-injected post-build)
npm run preview  # serve dist/ locally
```

The build outputs a multi-file dist (HTML + JS chunks + WASM). For true single-file offline mode, run the build then drag `dist/index.html` into a browser; modern browsers inline assets automatically when saving "Webpage HTML Only".

## License

Apache License 2.0 (permissive open-source, OSI-approved).
