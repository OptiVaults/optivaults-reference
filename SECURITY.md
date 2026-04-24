# Security Policy — OptiVaults Operator Reference Implementation

## Scope

This repository contains the **V1 operator-layer reference implementation** — off-chain TypeScript code for the keeper, API server, frontend, and self-serve recovery tools. The scope of security disclosure handled here is limited to **operator-layer code**.

**Protocol-layer findings** (Aiken validator bugs, datum injection, redeemer misuse, on-chain invariant violations) belong in the sibling repository [`optivaults-protocol`](https://github.com/OptiVaults/optivaults-protocol). See [`optivaults-protocol/SECURITY.md`](https://github.com/OptiVaults/optivaults-protocol/blob/v1/SECURITY.md).

**When in doubt, default to `optivaults-protocol`.** Triage will route appropriately.

---

## Reporting Operator-Layer Vulnerabilities

If you discover a security vulnerability in the operator reference implementation (keeper runtime, API authentication, frontend XSS, CLI parsing bugs, configuration leakage, etc.), please report it privately. **Do not open a public issue.**

**Email:** `optivaults@gmail.com`
**PGP key:** `optivaults.app/security` (encrypt sensitive technical details)

**Please include:**
- Description of the vulnerability
- Steps to reproduce (or theoretical attack walkthrough if exploit not implemented)
- Potential impact assessment (severity + affected component)
- Suggested fix (if any)

**Response timeline:**
- Acknowledgment: within 72 hours
- Initial triage: within 7 days
- Fix + patch notice: depends on severity; CRITICAL / HIGH findings target 30-day remediation with operator-mitigation notice published immediately

---

## In-scope (operator layer)

Once the code is migrated in (see `README.md` repository status table):

- **Keeper TypeScript runtime** (`keeper/`) — Compound / Batch / Supply / Recall / VaultSwap orchestration, cooldown state persistence, Blockfrost/Ogmios rate-limit handling
- **API server** (`api/`) — REST endpoints, JWT authentication, TX building, WebSocket streaming, rate-limit, CORS, request validation
- **Frontend** (`frontend/`) — CIP-30 wallet integration, JWT handling, TX-display for user signing, slippage/min-share UX, network-consistency guard
- **CLI tools** (`withdraw-cli/`, `emergency-withdraw/`) — Self-serve fund-recovery code paths, config parsing, CBOR signing correctness
- **Configuration templates** (`.env.example` files) — Must not leak secrets; must document required permissions

## Out of scope

- **Protocol-layer findings** (on-chain contract behaviour) — go to [`optivaults-protocol`](https://github.com/OptiVaults/optivaults-protocol/blob/v1/SECURITY.md)
- **Social engineering** against governance signers, operators, or depositors
- **Third-party infrastructure** — Cardano node, Blockfrost, Ogmios, Kupo, Liqwid, Minswap V2, Circle xReserve — each has its own disclosure process
- **Physical wallet compromise** of the depositor
- **Issues in forks of this codebase** operated by third parties — those are the fork operator's responsibility

---

## Operator-layer trust boundaries

The operator reference implementation has several trust boundaries worth naming:

- **Keeper hot key** — the PKH signing keeper actions. A compromised keeper wallet can cause operational DoS (delay of Compound, stuck batches) but cannot extract depositor principal — on-chain contracts enforce that. See [`optivaults-protocol/docs/security-model.md §3.4`](https://github.com/OptiVaults/optivaults-protocol/blob/v1/docs/security-model.md).
- **API JWT signing key** — authenticates CIP-30 wallet sessions. Compromise lets an attacker forge session tokens; they cannot sign transactions on the user's behalf (the user's wallet always signs client-side).
- **Blockfrost / Ogmios / Kupo API keys** — rate-limit bypass exposure. Rotated regularly; documented in the keeper `.env.example`.
- **Server TLS certificate** — handled by Cloudflare in the hosted-by-OptiVaults instance; forks managing their own TLS assume that responsibility.

Each of these is scoped narrowly to operator-instance health. **Depositor principal safety is anchored at the contract layer**, not at the operator layer — see `optivaults-protocol` for those guarantees.

---

## Responsible disclosure + ex gratia recognition

V1 does **not** operate a structured bug bounty program at launch. See [`optivaults-protocol/docs/audit-scope.md §6`](https://github.com/OptiVaults/optivaults-protocol/blob/v1/docs/audit-scope.md) for the full Responsible Disclosure Policy + ex gratia recognition framework. That policy applies uniformly to findings in this repository as well.

Summary: acknowledgement within 72 hours; triage + remediation plan within 7 days; 90-day coordinated disclosure window; no legal threats for good-faith disclosure; discretionary ex gratia recognition (public credit, case-study collaboration, appreciation payment from founder founding capital — not from treasury audit reserve).

A structured bounty tier is a post-external-audit + post-TVL-scale consideration, not a V1 launch commitment.

---

## Known operator-layer trust expectations

Forks running their own instance will have **different** trust expectations — your users trust *you* to run the infrastructure honestly. OptiVaults publishes audit reports + treasury spending on-chain as accountability; forks are encouraged but not obligated to do the same.

If you operate a fork of this codebase, please maintain your own `SECURITY.md` describing your disclosure process, scope, and timelines. Do not direct your users' security reports to `optivaults@gmail.com` unless coordinated in advance — we cannot triage issues specific to your instance configuration.

---

## Contact

- **Operator-layer security**: `optivaults@gmail.com` (PGP on `optivaults.app/security`)
- **Protocol-layer security**: see [`optivaults-protocol/SECURITY.md`](https://github.com/OptiVaults/optivaults-protocol/blob/v1/SECURITY.md)
- **General / non-sensitive**: Discord (invite on `optivaults.app`)
- **Commercial / partnership**: not solicited — V1 operator instance is funded by the on-chain fee-revenue model, not by external commercial agreements

---

## See also

- [`README.md`](README.md) — two-layer architecture overview
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — how to contribute to this repo
- [`optivaults-protocol/SECURITY.md`](https://github.com/OptiVaults/optivaults-protocol/blob/v1/SECURITY.md) — protocol-layer disclosure
- [`optivaults-protocol/docs/security-model.md`](https://github.com/OptiVaults/optivaults-protocol/blob/v1/docs/security-model.md) — full V1 threat model
- [`optivaults-protocol/docs/audit-scope.md`](https://github.com/OptiVaults/optivaults-protocol/blob/v1/docs/audit-scope.md) — RDP + ex gratia recognition framework
