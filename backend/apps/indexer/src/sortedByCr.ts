import { collateralValueUsd18At, crBps } from "@vulcra/chain-client";
import type { VaultRow } from "./store.js";

/**
 * Sort active vaults ascending by nicr (price-free). Within a single branch this
 * ordering equals ascending actual CR, so the head of the list is the riskiest.
 * Does not mutate the input.
 */
export function sortByNicrAsc(vaults: VaultRow[]): VaultRow[] {
  return [...vaults].sort((a, b) => (a.nicr < b.nicr ? -1 : a.nicr > b.nicr ? 1 : 0));
}

/**
 * Compute a vault's live CR (in bps) from a supplied feed reading, using the
 * branch's collateral decimals (FXRP 6, wFLR 18). `VaultRow.collateral6` holds
 * the RAW collateral amount in the branch's native decimals — the field name is
 * legacy (from the FXRP-only era); `collateralDecimals` makes the math correct
 * for every branch.
 */
export function vaultCrBps(
  vault: VaultRow,
  collateralDecimals: number,
  feedValue: bigint,
  feedDecimals: number,
): bigint {
  return crBps(
    collateralValueUsd18At(vault.collateral6, collateralDecimals, feedValue, feedDecimals),
    vault.debt18,
  );
}

export interface AtRiskVault {
  vault: VaultRow;
  crBps: bigint;
}

/**
 * From `vaults`, compute each active vault's CR at the supplied price (using the
 * branch's collateral decimals) and return those strictly below `maxCrBps`,
 * ordered ascending by CR (riskiest first).
 *
 * Zero-debt vaults are excluded: `crBps` reports 0 for debt 0 (see chain-client),
 * which is the "not-liquidatable / not-at-risk" sentinel — never a real risk.
 */
export function atRisk(
  vaults: VaultRow[],
  collateralDecimals: number,
  feedValue: bigint,
  feedDecimals: number,
  maxCrBps: bigint,
): AtRiskVault[] {
  return vaults
    .filter((v) => v.active && v.debt18 > 0n)
    .map((v) => ({ vault: v, crBps: vaultCrBps(v, collateralDecimals, feedValue, feedDecimals) }))
    .filter((x) => x.crBps < maxCrBps)
    .sort((a, b) => (a.crBps < b.crBps ? -1 : a.crBps > b.crBps ? 1 : 0));
}
