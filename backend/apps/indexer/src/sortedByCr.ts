import { accrueDebt, collateralValueUsd18At, crBps } from "@vulcra/chain-client";
import type { VaultRow } from "./store.js";

/**
 * The V2 redemption queue: active vaults ordered ascending by their annual interest
 * rate (lowest rate is redeemed first). This replaces the old CR-ordered queue —
 * redemption in V2 targets the lowest-rate vault, independent of price. Does not
 * mutate the input.
 */
export function redemptionQueue(vaults: VaultRow[]): VaultRow[] {
  return [...vaults]
    .filter((v) => v.active)
    .sort((a, b) => (a.rateBps < b.rateBps ? -1 : a.rateBps > b.rateBps ? 1 : 0));
}

/**
 * Compute a vault's live CR (in bps) from a supplied feed reading, using the
 * branch's collateral decimals (FXRP 6, wFLR 18).
 *
 * The debt used is the CURRENT (accrued) debt, not the recorded debt:
 *   currentDebt = accrueDebt(vault.debt18, vault.rateBps, nowSeconds - vault.lastAccrualTs)
 * so a vault whose interest has accrued since its last debt event correctly reads a
 * lower CR even at an unchanged price. `VaultRow.collateral6` holds the RAW collateral
 * amount in the branch's native decimals — the field name is legacy (FXRP-only era);
 * `collateralDecimals` makes the value math correct for every branch.
 */
export function vaultCrBps(
  vault: VaultRow,
  collateralDecimals: number,
  feedValue: bigint,
  feedDecimals: number,
  nowSeconds: bigint,
): bigint {
  const currentDebt = accrueDebt(vault.debt18, vault.rateBps, nowSeconds - vault.lastAccrualTs);
  return crBps(
    collateralValueUsd18At(vault.collateral6, collateralDecimals, feedValue, feedDecimals),
    currentDebt,
  );
}

export interface AtRiskVault {
  vault: VaultRow;
  crBps: bigint;
}

/**
 * From `vaults`, compute each active vault's CR at the supplied price (using the
 * branch's collateral decimals and the accrued current debt at `nowSeconds`) and
 * return those strictly below `maxCrBps`, ordered ascending by CR (riskiest first).
 *
 * Zero-debt vaults are excluded: `crBps` reports 0 for debt 0 (see chain-client),
 * which is the "not-liquidatable / not-at-risk" sentinel — never a real risk.
 */
export function atRisk(
  vaults: VaultRow[],
  collateralDecimals: number,
  feedValue: bigint,
  feedDecimals: number,
  nowSeconds: bigint,
  maxCrBps: bigint,
): AtRiskVault[] {
  return vaults
    .filter((v) => v.active && v.debt18 > 0n)
    .map((v) => ({
      vault: v,
      crBps: vaultCrBps(v, collateralDecimals, feedValue, feedDecimals, nowSeconds),
    }))
    .filter((x) => x.crBps < maxCrBps)
    .sort((a, b) => (a.crBps < b.crBps ? -1 : a.crBps > b.crBps ? 1 : 0));
}
