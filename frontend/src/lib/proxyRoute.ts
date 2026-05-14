/**
 * V1 redeemer constructors — frontend mirror of
 * `keeper/src/utils/cmlFoundation.ts`'s `proxyRedeemerCbor` /
 * `proxyRedeemerForVaultRedeemer` and `keeper/src/types/vaultDatum.ts`'s
 * `REDEEMER_IDX` / `PROXY_ROUTE_IDX` / `VAULT_REDEEMER_TO_PROXY_ROUTE`
 * tables.
 *
 * Constr indices MUST match the on-chain Aiken enum declaration order
 * in `contracts/lib/vault/types.ak::VaultRedeemer` and
 * `contracts/validators/vault_proxy.ak::ProxyRedeemer`. Drift between
 * this file and the on-chain code produces silent decode failures that
 * present as "Withdraw[N] the validator crashed" or "expected empty list".
 *
 * Every off-chain `Constr(N, [...])` instance for a vault/gov redeemer
 * is on this audit surface, not just the typed-record table.
 */

let _Data: any = null
let _Constr: any = null
async function loadDataConstr() {
  if (!_Data || !_Constr) {
    const mod = await import('@lucid-evolution/lucid')
    _Data = mod.Data
    _Constr = mod.Constr
  }
  return { Data: _Data, Constr: _Constr }
}

// ════════════════════════════════════════════════════════════
// VaultRedeemer Constr indices — match types.ak declaration order.
// CommunitySunset is at idx 3; everything after shifted +1.
// ════════════════════════════════════════════════════════════

export const REDEEMER_IDX = {
  Deposit: 0,
  Withdraw: 1,
  BatchProcess: 2,
  CommunitySunset: 3,
  Compound: 4,
  RebalanceBuffer: 5,
  SwapAda: 6,
  DeployToProtocol: 7,
  RecallFromProtocol: 8,
  MergeUtxo: 9,
  AdminDeployNonDeposit: 10,
  UpdateStrategy: 11,
  UpdateFee: 12,
  UpdateFeeSplit: 13,
  UpdateSlippagePolicy: 14,
  EmergencyWithdraw: 15,
  SupplyToLiqwid: 16,
  RecallFromLiqwid: 17,
} as const

export type RedeemerName = keyof typeof REDEEMER_IDX

// ════════════════════════════════════════════════════════════
// ProxyRedeemer route indices — match vault_proxy.ak ProxyRedeemer
// declaration order. UseBatcher is LAST (idx 9), not 2.
// ════════════════════════════════════════════════════════════

export const PROXY_ROUTE_IDX = {
  UseUser: 0,
  UseKeeperHot: 1,
  UseSwapAda: 2,
  UseProtocol: 3,
  UseRecall: 4,
  UseLiqwid: 5,
  UseGovPolicy: 6,
  UseGovEmergency: 7,
  UseAdminDeploy: 8,
  UseBatcher: 9,
} as const

export type ProxyRouteName = keyof typeof PROXY_ROUTE_IDX

/** VaultRedeemer variant → vault_proxy route it dispatches through. */
export const VAULT_REDEEMER_TO_PROXY_ROUTE: Record<RedeemerName, ProxyRouteName> = {
  Deposit: 'UseUser',
  Withdraw: 'UseUser',
  BatchProcess: 'UseBatcher',
  CommunitySunset: 'UseUser',
  Compound: 'UseKeeperHot',
  RebalanceBuffer: 'UseKeeperHot',
  SwapAda: 'UseSwapAda',
  DeployToProtocol: 'UseProtocol',
  RecallFromProtocol: 'UseRecall',
  MergeUtxo: 'UseRecall',
  AdminDeployNonDeposit: 'UseAdminDeploy',
  UpdateStrategy: 'UseGovPolicy',
  UpdateFee: 'UseGovPolicy',
  UpdateFeeSplit: 'UseGovPolicy',
  UpdateSlippagePolicy: 'UseGovPolicy',
  EmergencyWithdraw: 'UseGovEmergency',
  SupplyToLiqwid: 'UseLiqwid',
  RecallFromLiqwid: 'UseLiqwid',
}

/** Map redeemer → ceremony refScripts label for the staking validator
 *  hosting it. Used by TX builders to load the right Withdraw-Zero
 *  reference script. */
export const REDEEMER_TO_REF_LABEL: Record<RedeemerName, string> = {
  Deposit: 'vaultUser',
  Withdraw: 'vaultUser',
  BatchProcess: 'vaultBatcher',
  CommunitySunset: 'vaultUser',
  Compound: 'vaultKeeperHot',
  RebalanceBuffer: 'vaultKeeperHot',
  SwapAda: 'vaultSwapAda',
  DeployToProtocol: 'vaultProtocol',
  RecallFromProtocol: 'vaultRecall',
  MergeUtxo: 'vaultRecall',
  AdminDeployNonDeposit: 'vaultAdminDeploy',
  UpdateStrategy: 'vaultGovPolicy',
  UpdateFee: 'vaultGovPolicy',
  UpdateFeeSplit: 'vaultGovPolicy',
  UpdateSlippagePolicy: 'vaultGovPolicy',
  EmergencyWithdraw: 'vaultGovEmergency',
  SupplyToLiqwid: 'vaultLiqwid',
  RecallFromLiqwid: 'vaultLiqwid',
}

/** Map redeemer → reward-address slot on V1DeployState.rewardAddrs. */
export const REDEEMER_TO_REWARD_KEY: Record<RedeemerName, keyof import('./v1Deploy').V1DeployState['rewardAddrs']> = {
  Deposit: 'user',
  Withdraw: 'user',
  BatchProcess: 'batcher',
  CommunitySunset: 'user',
  Compound: 'keeperHot',
  RebalanceBuffer: 'keeperHot',
  SwapAda: 'swapAda',
  DeployToProtocol: 'protocol',
  RecallFromProtocol: 'recall',
  MergeUtxo: 'recall',
  AdminDeployNonDeposit: 'adminDeploy',
  UpdateStrategy: 'govPolicy',
  UpdateFee: 'govPolicy',
  UpdateFeeSplit: 'govPolicy',
  UpdateSlippagePolicy: 'govPolicy',
  EmergencyWithdraw: 'govEmergency',
  SupplyToLiqwid: 'liqwid',
  RecallFromLiqwid: 'liqwid',
}

// ════════════════════════════════════════════════════════════
// CBOR builders
// ════════════════════════════════════════════════════════════

/** Returns the CBOR for `ProxyRedeemer::<route>` (no payload). */
export async function proxyRedeemerCbor(route: ProxyRouteName): Promise<string> {
  const { Data, Constr } = await loadDataConstr()
  return Data.to(new Constr(PROXY_ROUTE_IDX[route], [])) as string
}

/** Same, driven by the VaultRedeemer variant name. */
export async function proxyRedeemerForVaultRedeemer(redeemer: RedeemerName): Promise<string> {
  return proxyRedeemerCbor(VAULT_REDEEMER_TO_PROXY_ROUTE[redeemer])
}

/** vusdcx mint-policy redeemer for a Deposit (mint vUSDCx shares). */
export async function vusdcxMintSharesRedeemerCbor(): Promise<string> {
  const { Data, Constr } = await loadDataConstr()
  return Data.to(new Constr(0, [])) as string
}

/** vusdcx burn redeemer for a Withdraw (burn vUSDCx shares). */
export async function vusdcxBurnSharesRedeemerCbor(): Promise<string> {
  const { Data, Constr } = await loadDataConstr()
  return Data.to(new Constr(1, [])) as string
}

/** OrderRedeemer::Cancel (variant 1, no fields) — owner-driven order cancel. */
export async function orderCancelRedeemerCbor(): Promise<string> {
  const { Data, Constr } = await loadDataConstr()
  return Data.to(new Constr(1, [])) as string
}
