# OptiVaults V1 — Operator Reference Implementation

![License](https://img.shields.io/badge/license-Apache%202.0-blue)
![Status](https://img.shields.io/badge/status-skeleton-orange)
![Sibling Repo](https://img.shields.io/badge/protocol-optivaults--protocol-informational)

> **Active development branch: `v1`.** Matches the sibling [`optivaults-protocol`](https://github.com/OptiVaults/optivaults-protocol) convention — no `main` branch.

This repository holds the **V1 operator-layer reference implementation** — the off-chain code needed to run an OptiVaults V1 instance: keeper, API server, frontend, and self-serve recovery tools.

It is the companion of [`optivaults-protocol`](https://github.com/OptiVaults/optivaults-protocol), which holds the Aiken smart contracts, protocol specification, whitepaper, and deploy pipeline.

---

## Two-layer architecture

OptiVaults V1 is deliberately structured as **two separable layers**:

| Layer | Repo | What it is | Fee |
|-------|------|-----------|-----|
| **Protocol layer (public good)** | [`optivaults-protocol`](https://github.com/OptiVaults/optivaults-protocol) | Aiken validators + spec + whitepaper + deploy scripts. Apache 2.0. Anyone may fork and launch their own vault without paying anything. | 0% — pure public good. |
| **Operator layer (this repo)** | `optivaults-reference` | Reference TypeScript implementation of the keeper, API, frontend, CLI tools. Apache 2.0. Runs a live vault instance on behalf of users via `optivaults.app`. | 4.5% of realised yield (hard-capped in the contract; at V1 launch 40% to keeper / 0% to gov pool / 60% to treasury; see [fee breakdown](https://github.com/OptiVaults/optivaults-protocol/blob/v1/docs/economics.md)). |

**Why two repos?** Because these are two fundamentally different things:

- The **protocol layer** is a piece of Cardano DeFi commons — auditable, fork-able, Apache 2.0, with zero rent extraction. Any team anywhere may use it.
- The **operator layer** is a convenience service — a live vault instance users can deposit into without running their own infrastructure. The 4.5% fee funds the cost of keeping it running: keeper compensation, VPS + Blockfrost + monitoring + CDN, future third-party audits, protocol R&D, and a buffer for incidents. No founder dividend; no investor return; no token.

The two layers are connected at the contract level (the operator-run keeper signs transactions that the on-chain vault validates), but they are not the same thing. Forking `optivaults-protocol` and running your own instance — with your own fee structure, or zero fee — is an explicit design goal.

See the [OptiVaults whitepaper](https://github.com/OptiVaults/optivaults-protocol/blob/v1/whitepaper/whitepaper.md) for the depositor-facing framing and the [product-overview.md](https://github.com/OptiVaults/optivaults-protocol/blob/v1/docs/product-overview.md) for a plain-language walkthrough.

---

## Repository status

**V1 is a pre-launch repo.** The operator layer is still being adapted from the internal-verification-era codebase. Current state:

| Component | Status | Notes |
|-----------|--------|-------|
| `keeper/` | 🚧 Placeholder | V1 keeper reference implementation coming post keeper-verification milestone. TypeScript, vitest-tested. |
| `api/` | ⏳ Deferred | V1 API server adaptation pending. Read-only endpoints + TX building + WebSocket streaming. |
| `frontend/` | ⏳ Deferred | React + Vite + TailwindCSS SPA. Cloudflare Pages deploy. |
| `withdraw-cli/` | ⏳ Deferred | Node CLI for self-serve Withdraw (no infrastructure dependency). |
| `emergency-withdraw/` | ⏳ Deferred | Static HTML self-serve emergency-withdraw tool. |

Contents will be added in batches as each component is verified V1-ready against the on-chain contracts.

---

## Running your own instance

OptiVaults is designed so that **any team can fork the protocol and launch their own vault instance**. The flow:

1. Fork [`optivaults-protocol`](https://github.com/OptiVaults/optivaults-protocol) (or use the published artefacts as-is).
2. Run the ceremony in `optivaults-protocol/deploy/` (see [deploy/runbooks/v1-mainnet-ceremony.md](https://github.com/OptiVaults/optivaults-protocol/blob/v1/deploy/runbooks/v1-mainnet-ceremony.md)) to deploy your own vault address + reference scripts.
3. Fork this repo (`optivaults-reference`), configure the keeper / API / frontend against your ceremony state, deploy where you want (or don't — you can run entirely locally and skip hosted infrastructure for your own use).
4. Operate under your own policy: your own fee rate, your own governance signer set, your own depositor base.

Your instance is independent of the OptiVaults-operated instance. The two will never interact except by convention (e.g., both following the same `optivaults-protocol` hash set).

---

## Operator governance & fee disclosure

The operator instance run by OptiVaults (at `optivaults.app`) is funded by the contract-enforced 4.5% performance fee. V1-launch breakdown (see [economics.md](https://github.com/OptiVaults/optivaults-protocol/blob/v1/docs/economics.md) for full math):

- **40% of fee** → signing keeper (covers operational cost per Compound; set at the validator hard cap to support open-source third-party keeper viability)
- **0% of fee** → governance signer pool (disabled at V1 launch; activated in Phase 2+ via `UpdateFeeSplit`, capped at 10%)
- **60% of fee** → on-chain treasury, sub-allocated 40 / 25 / 25 / 10 at launch (governance-adjustable within bounds):
  - 40% audit reserve
  - 25% operations (platform layer — VPS, Blockfrost, monitoring, CDN; per-keeper infra is funded directly out of the keeper's 40% share)
  - 25% R&D (future integrations, contributor bounties, ecosystem grants)
  - 10% buffer (unexpected costs, legal, incident response)

Hard caps enforced in the contract: `keeper_fee_bps ≤ 4000` (40%), `gov_fee_bps ≤ 1000` (10%), `keeper + gov ≤ 5000` (treasury floor ≥ 50%); each treasury sub-category `bps ∈ [0, 5000]` (no single category may exceed 50% of treasury inflow); `min_audit_reserve` is an absolute USDCx floor set immutably at deploy. The 4.5% performance-fee rate is itself hard-capped in the contract and **cannot be raised by governance under any redeemer path**.

**No founder dividend. No investor return. No token issuance. No SAFE / SAFT.** The 4.5% fee is pure cost-recovery + long-term protocol sustainability; the specific split is disclosed on-chain via `TreasuryDatum` and in the treasury's `recent_spend_log`.

---

## Relationship to `optivaults-protocol`

All protocol-level security findings, contract audits, economics documentation, and whitepaper content live in [`optivaults-protocol`](https://github.com/OptiVaults/optivaults-protocol).

**This repo's scope is strictly the off-chain operator instance code.** Security disclosures specific to operator infrastructure (keeper runtime bugs, API authentication issues, frontend XSS vectors, CLI parsing bugs) go to the disclosure channels in this repo's `SECURITY.md`. Protocol-level security disclosures (contract exploits, datum injection, etc.) go to `optivaults-protocol/SECURITY.md`.

If you're unsure which layer a finding applies to, default to `optivaults-protocol`'s disclosure channel — the triage process will forward appropriately.

---

## License

Apache License 2.0. See [`LICENSE`](LICENSE). Forks are welcome and encouraged.

The permissive license is deliberate. One of V1's stated success criteria is "the architecture is forked and specialized by other Cardano teams" — restrictive licensing on an operator reference implementation would contradict that goal.

---

## Contact

- **Website**: [optivaults.app](https://optivaults.app)
- **Protocol repo**: [github.com/OptiVaults/optivaults-protocol](https://github.com/OptiVaults/optivaults-protocol)
- **Security disclosure**: See [`SECURITY.md`](SECURITY.md) for this repo's scope; protocol-layer findings go to [`optivaults-protocol/SECURITY.md`](https://github.com/OptiVaults/optivaults-protocol/blob/v1/SECURITY.md)
- **General**: Discord (invite on optivaults.app)
