# keeper/ — V1 Keeper Reference Implementation

**Status**: 🚧 Placeholder. Source code not yet migrated. See parent [`README.md`](../README.md) for repo-status table.

---

## Purpose (planned contents)

The **keeper** is the off-chain automation layer for an OptiVaults V1 vault instance. Its responsibilities:

- **Compound** — periodically invoke the on-chain `Compound` redeemer to harvest Liqwid yield and refresh share-price accounting
- **Batch** — process queued user orders via `BatchProcess`
- **Capital routing** — `DeployToProtocol` + `RecallFromProtocol` + `SupplyToLiqwid` + `RecallFromLiqwid` to move funds between idle buffer, Liqwid markets, and DEX swap orders
- **MergeUtxo** — consolidate orphan UTxOs back into the vault main UTxO
- **Vault swap** — DEX routing between USDCx / DJED / USDM via Minswap V2 adapter
- **Self-healing** — buffer shortage detection + auto-recovery chain (Recall → reverse swap → NDV consolidation)
- **Governance fallback** — execute keeper-class redeemers via governance after 7d keeper inactivity
- **TVL cap monitoring** — frontend/API coordination to enforce the pre-audit 100K USDCx TVL cap

## Current state

Source code lives in an operator-private working tree; it will be migrated into this directory once the keeper-verification milestone is reached (see parent `README.md`).

The pending migration includes:

- Full TypeScript source (engines, utils, monitors, types)
- `package.json` + `tsconfig.json` + `vitest.config.ts`
- Comprehensive vitest suite (~97 tests at migration time)
- `.env.example` with required + optional configuration
- Keeper operator deployment guide

## When does migration happen?

After keeper has been verified V1-ready:

1. V1 mainnet ceremony completes
2. V1 keeper operates on mainnet under observation for a meaningful window
3. vitest suite passes clean + `tsc --noEmit` clean
4. No outstanding operator-layer security findings
5. Any adaptation required from the internal-verification codebase is stable

At that point, the keeper code migrates here as **Batch R2** (see the batch plan documented in project history).

## Why not here yet?

Publishing half-working keeper code would be misleading — it could suggest "this is ready to run" when it is not yet adapted for V1. Migration happens when the code is ready to stand behind.

In the meantime, V1 protocol-layer spec + contracts + whitepaper are fully published in [`optivaults-protocol`](https://github.com/OptiVaults/optivaults-protocol) — those are the artefacts any fork needs most urgently. The keeper is an operational convenience layer and can wait.

## See also

- [`../README.md`](../README.md) — repo-wide two-layer architecture overview
- [`../SECURITY.md`](../SECURITY.md) — operator-layer security disclosure
- [`optivaults-protocol/spec/keeper-auth.md`](https://github.com/OptiVaults/optivaults-protocol/blob/v1/spec/keeper-auth.md) — how the keeper stake-script authorizes keeper actions on-chain
- [`optivaults-protocol/docs/economics.md §5.3`](https://github.com/OptiVaults/optivaults-protocol/blob/v1/docs/economics.md) — keeper economics + Phase-gated rotation mechanism
