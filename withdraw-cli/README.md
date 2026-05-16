# @optivaults/v1-withdraw-cli

V1 command-line self-serve withdrawal + Layer 3 dead-man-switch trigger. Runs entirely locally — no backend dependency, no trust in any operator infrastructure.

Currently supports **Preprod** (V1 launch-candidate ceremony). Mainnet placeholder ships unfilled — pass `--config <path>` once V1 mainnet ceremony lands.

## What V1 adds vs the V9.x / V10 `withdraw-cli`

V1 ships a different on-chain contract surface from V9.x / V10:

- **29-field VaultDatum** (vs 25 in V9). Adds `liqwid_positions`, `non_deposit_value`, `last_realloc_time`, `last_fee_update_time`, `last_ada_swap_time`, `keeper_fee_bps`, `gov_fee_bps`, `max_slippage_bps`, `min_swap_peg_bps`, and the new operational flag `community_sunset_triggered`.
- **R55 compile-time vault NFT anchor**: `vault_nft_policy` is no longer a datum field — it's baked into `vault_proxy` / `vusdcx` / `order` at compile time. The CLI locates the vault UTXO by NFT scan at the proxy address.
- **Withdraw redeemer signature**: `Constr(1, [shares, receiver, receiver_output_idx])` (V9 was `Constr(1, [shares, receiver])`). The third field defends against R48 M-1 anti-double-satisfaction.
- **Withdraw-Zero routes through `vault_user`** (V9 used `vault_core`; V1 split the user-flow validators).
- **Layer 3 CommunitySunset**: a permissionless redeemer any vUSDCx holder can call after ≥90 days of operational inactivity. Sets `frozen=1 + community_sunset_triggered=1`, opening the permissionless `vault_recall.RecallFromLiqwid` + `vault_protocol.DeployToProtocol` Layer 2 paths. The CLI exposes this as `sunset-status` (read) + `sunset-trigger` (write).

## Quick start

### Option A — from source

```bash
cd withdraw-cli
npm install
npm run build
node dist/cli.js --help
```

### Option B — `npx` (when published)

```bash
npx @optivaults/v1-withdraw-cli balance \
  --blockfrost-key preprod... \
  --network preprod \
  --address addr_test1...
```

## Commands

### `balance` — read-only status

Show vault state (29-field V1 VaultDatum), Liqwid positions, sunset countdown, and your vUSDCx balance.

```bash
optivaults-v1-withdraw balance \
  --blockfrost-key preprod... \
  --network preprod \
  --address addr_test1...
```

### `quote` — estimate output

Pure-math preview of a Withdraw, including R49 M-4 deferred-yield (subtract NET not BASE from `total_deposited`) and the 7-day keeper-inactive fee waiver.

```bash
optivaults-v1-withdraw quote \
  --blockfrost-key preprod... \
  --network preprod \
  --shares 1000000000000
```

### `withdraw` — build, sign, submit

V1 Withdraw-Zero TX: proxy spend + `vault_user` staking withdrawal + vUSDCx burn. Withdraw only touches `vault_user`; `vault_keeper_hot` / `vault_protocol` / `vault_liqwid` / etc. are not involved.

```bash
optivaults-v1-withdraw withdraw \
  --blockfrost-key preprod... \
  --network preprod \
  --shares max \
  --seed-file ~/.optivaults/seed
```

`--shares max` caps to `min(your_vUSDCx, total_shares - 1)` — full-drain (= last depositor) is **not supported** by this CLI; that path requires the admin NFT-burn flow.

Dry-run (build but don't submit):

```bash
optivaults-v1-withdraw withdraw ... --dry-run
```

### `sunset-status` — Layer 3 read

Show how many days remain until the 90-day dead-man-switch becomes available, and whether it has already been triggered.

```bash
optivaults-v1-withdraw sunset-status \
  --blockfrost-key preprod...
```

### `sunset-trigger` — Layer 3 write

Flip `frozen=0→1` + `community_sunset_triggered=0→1`. **One-way irreversible flag.** Requires the calling wallet to hold ≥1 vUSDCx (the validator scans tx inputs).

```bash
optivaults-v1-withdraw sunset-trigger \
  --blockfrost-key preprod... \
  --seed-file ~/.optivaults/seed
```

After triggering, ANY vUSDCx holder can call:

- `vault_recall.RecallFromLiqwid` without the keeper-active gate
- `vault_protocol.DeployToProtocol` Layer 2 swap-out path (NDV → USDCx) without keeper signatures

so depositors can recover their full proportional USDCx share even if the founder + governance are completely failed.

## Network flag + config

| Flag | Network | Vault |
|------|---------|-------|
| `--network preprod` (default) | Preprod testnet | bundled `config/preprod.json` (current p23 ceremony) |
| `--network mainnet` | Cardano mainnet | **Placeholder — pass `--config <path>` once V1 mainnet ceremony lands** |

Override the bundled config in any of three ways:

1. `--config <path>` — absolute or relative path to a ceremony JSON
2. `OPTIVAULTS_V1_CONFIG=<path>` env var
3. Edit `config/<network>.json` in the package directly

The JSON shape mirrors `keeper/data/preprod-<release>.json` (the same file the keeper and frontend read). After a fresh ceremony the operator simply replaces it.

## V1 Withdraw-Zero pattern

The CLI builds V1 transactions with:

- **Proxy spend** — vault UTXO at proxy address with `ProxyRedeemer::UseUser = Constr(0,[])`
- **User staking withdrawal** — `withdraw(user_reward_addr, 0, Constr(1, [shares, receiver, receiver_output_idx]))`
- **vUSDCx burn** — `mintAssets({vusdcx: -shares}, Constr(1, []))`
- **Reference scripts** — `readFrom([vaultProxy, vaultUser, vusdcx])` (3 entries, identical to V9.x — the additional V1 staking validators are not needed for Withdraw)

CommunitySunset replaces the `withdraw` redeemer with `Constr(3, [])` and skips the burn + payout outputs (datum-only mutation, vault assets unchanged).

## Security

### Seed phrase handling

**NEVER pass `--seed "words..."` in production.** It leaks to shell history.

Preferred approaches:

1. **File with restricted permissions** — `--seed-file ~/.optivaults/seed` (chmod 600)
2. **Interactive stdin** — `--stdin` flag, paste when prompted
3. **Environment variable** — `OPTIVAULTS_SEED` (ephemeral shell only)

### Verification

Before running on mainnet, verify the loaded ceremony JSON's `proxyAddr` + `vaultNftPolicy` against the published ceremony announcement. The CLI prints these on every command for visual confirmation.

## What this CLI does NOT do

- **No full-drain** — if you are the last depositor, use admin tooling (full drain requires NFT burn)
- **No deposits** — withdrawal only
- **No batch orders** — direct withdrawal only (queued orders go through the optivaults.app frontend)
- **No keeper / governance operations**
- **No Liqwid Recall / DEX swap-out** — once Layer 3 sunset has fired, those redeemers are permissionless but still need the multi-validator ceremony (use `opti-gov` or follow `docs/runbooks/keeper-outage-recovery.md` from the protocol repo)

## License

Apache License 2.0 (permissive open-source, OSI-approved).
