# Contributing to OptiVaults Operator Reference Implementation

Thanks for your interest. This repo is the **V1 operator-layer reference implementation** — see [`README.md`](README.md) for the two-layer architecture overview and the distinction from [`optivaults-protocol`](https://github.com/OptiVaults/optivaults-protocol).

**For protocol-layer contributions** (Aiken validators, spec, whitepaper, deploy pipeline), go to [`optivaults-protocol/CONTRIBUTING.md`](https://github.com/OptiVaults/optivaults-protocol/blob/v1/CONTRIBUTING.md).

This document covers: environment setup, contribution types, PR expectations, testing, and security disclosure — **scoped to this repository's contents**.

---

## TL;DR — before you open a PR

1. Read [`README.md`](README.md) for the two-layer architecture + fee disclosure.
2. For changes to protocol-layer concerns (contracts, spec, datum schema), open the PR against [`optivaults-protocol`](https://github.com/OptiVaults/optivaults-protocol) instead — this repo only covers off-chain operator code.
3. Tests must pass locally before PR (vitest for keeper + API + frontend; no CI hosted at V1 pre-launch stage).
4. Don't commit secrets, mainnet signer PKHs, real Blockfrost keys, hot-wallet seeds. They belong in `.env` (gitignored) or operator-only private storage.
5. **Security-sensitive findings go to `optivaults@gmail.com` (PGP on optivaults.app/security), NOT a public issue.** See `SECURITY.md`.

---

## 1. Repository scope

This repo's contents are planned as:

| Directory | Role |
|-----------|------|
| `keeper/` | TypeScript keeper reference implementation; vitest-tested |
| `api/` | Express-style API server; JWT + WebSocket + TX building |
| `frontend/` | React + Vite SPA for user deposit / withdraw / dashboard |
| `withdraw-cli/` | Node CLI for self-serve Withdraw without API dependency |
| `emergency-withdraw/` | Static HTML for self-serve emergency Withdraw |

At repo initialization, most directories are placeholders. Components are migrated in as they are verified V1-ready — see `README.md` repository-status table.

**Out of scope for this repo** (handled in `optivaults-protocol`):
- Aiken contract changes
- Protocol specification
- Whitepaper + economic model documentation
- Deploy ceremony orchestrator
- Audit plan + RDP + ex gratia framework

---

## 2. Environment setup (once code is migrated in)

**Prerequisites:**

- Node.js 20.x+ (for TypeScript / tsx)
- `pnpm` (preferred) or `npm`
- A Cardano wallet for testing (CIP-30 compatible — Eternl / Lace / Vespr / Typhon / Yoroi)
- Blockfrost Preprod project ID (free tier OK for development)
- Never use mainnet seeds / real wallet keys in contributor environments

**Running the keeper locally (after Batch R2 migration):**

```bash
cd keeper
cp .env.example .env.local
# edit .env.local with your Preprod Blockfrost keys + keeper wallet seed
pnpm install
pnpm test      # vitest suite
pnpm start     # starts the keeper main loop
```

Other components follow a similar pattern once migrated.

---

## 3. Kinds of contributions

### Welcome without prior discussion

- **Bug fixes** — any operator-layer runtime bug; please include a test case demonstrating the fix
- **Test coverage increases** — vitest for keeper, vitest + React Testing Library for frontend
- **Documentation clarity** — typo fixes, wording improvements, i18n work beyond existing EN + 繁體中文
- **Dev-experience polish** — .env.example improvements, type-refactor, error message clarity, developer tooling
- **Observability** — better logging, better error reporting, better health-check endpoints

### Coordinate first (open an issue or email before PR)

- **New keeper engine** (new DEX route, new lending protocol integration on the operator side) — this is the operator-side counterpart to protocol-layer integration work; the protocol-layer audit happens in `optivaults-protocol` but the keeper adaptation lives here
- **API breaking changes** — endpoint signature changes, authentication scheme changes
- **Frontend architectural changes** — routing, state management, CIP-30 integration pattern changes
- **New monitoring / alerting pipelines** — cost + reliability implications

### Not accepted

- **Closing the source** — any change making any operator-layer component closed-source or proprietary. This repo is Apache 2.0; forks are expected.
- **Protocol-layer changes** — contract code, spec, economic model. Those go to `optivaults-protocol`.
- **Changes that break fork-friendliness** — hard-coded assumptions about OptiVaults-hosted infrastructure; config values that cannot be overridden; tools that require OptiVaults-issued credentials. Any fork must be able to configure and run independently.

---

## 4. PR expectations

### Commit discipline

- One logical change per commit. Rebase preferred over squash-and-merge.
- Commit messages: imperative + subject ≤ 72 chars, body explains _why_.
- **Do not** include `Co-Authored-By:` trailers unless the user has explicitly asked for them.
- **Do not** include sections like "still pending", "deferred work", "memory update", or speculative future work — a commit describes what IS in the commit, not what isn't.
- Do not include planning / decision documents as part of the commit diff unless the user has explicitly requested them.

### PR description

- Reference the issue or Discord discussion that initiated the work (if any).
- Summarize WHAT changed and WHY.
- For keeper / API / frontend changes: list any user-visible behavior changes.
- For test additions: note the test count delta.
- For monitoring / infra changes: describe any ops runbook updates needed.

### Review

- Frontend-only or docs-only PRs can merge with one reviewer approval.
- Keeper / API PRs require keeper-operator review — the runtime pipeline has significant state coordination and changes can cause silent drift if not carefully checked.
- CI not yet hosted at V1 pre-launch stage — the merge committer runs vitest locally before merging.

### Licensing + DCO

- **No CLA.** This project is Apache 2.0 inbound=outbound.
- By opening a PR you certify DCO: the code is yours to submit, it's licensed under Apache 2.0, and you're willing for it to be used in derivatives consistent with the license.

---

## 5. Testing expectations

### Unit tests (vitest)

Every new runtime behavior should have at least one vitest test case. Keeper tests live in `keeper/src/**/__tests__/` or `keeper/src/**/*.test.ts`. API tests live in `api/src/**/__tests__/`. Frontend tests in `frontend/src/**/*.test.tsx`.

### Integration tests

Preprod E2E tests for the operator layer (covering keeper → API → contract round-trip) are separate from the `optivaults-protocol/tests/` family — there, E2E covers on-chain flows; here, E2E covers keeper-to-contract orchestration. Migration of E2E scripts is part of the later Batch phases.

---

## 6. Security disclosure

**Do NOT open a public issue for security-sensitive findings in operator-layer code.** Route privately:

- **Email**: `optivaults@gmail.com`
- **PGP key**: `optivaults.app/security`

Scope rules: this repo handles operator-layer findings only. Protocol-layer findings go to [`optivaults-protocol/SECURITY.md`](https://github.com/OptiVaults/optivaults-protocol/blob/v1/SECURITY.md).

Full Responsible Disclosure Policy + ex gratia recognition framework lives in [`optivaults-protocol/docs/audit-scope.md §6`](https://github.com/OptiVaults/optivaults-protocol/blob/v1/docs/audit-scope.md) and applies to this repo as well.

---

## 7. Communication

- **Quick questions / implementation discussion**: Discord (invite on optivaults.app)
- **Design proposals / architectural changes**: open a GitHub issue on the appropriate repo
- **Protocol-layer coordination**: use `optivaults-protocol`'s channels

---

## 8. License

By contributing to this repo you agree your contributions are licensed under the **Apache License, Version 2.0** (see `LICENSE`).

The permissive license is deliberate. V1's stated goal includes making the operator reference implementation fork-friendly — restrictive licensing would contradict that.
