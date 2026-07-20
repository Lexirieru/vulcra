import { collateralValueUsd18, crBps } from "@vulcra/chain-client";
import type { VaultRow } from "./store.js";

/**
 * Sort active vaults ascending by nicr (price-free). Under single-collateral this
 * ordering equals ascending actual CR, so the head of the list is the riskiest.
 * Does not mutate the input.
 */
export function sortByNicrAsc(vaults: VaultRow[]): VaultRow[] {
  return [...vaults].sort((a, b) => (a.nicr < b.nicr ? -1 : a.nicr > b.nicr ? 1 : 0));
}

/** Compute a vault's live CR (in bps) from a supplied FTSO feed reading. */
export function vaultCrBps(vault: VaultRow, feedValue: bigint, feedDecimals: number): bigint {
  return crBps(collateralValueUsd18(vault.collateral6, feedValue, feedDecimals), vault.debt18);
}

export interface AtRiskVault {
  vault: VaultRow;
  crBps: bigint;
}

/**
 * From `vaults`, compute each active vault's CR at the supplied price and return
 * those strictly below `maxCrBps`, ordered ascending by CR (riskiest first).
 *
 * Zero-debt vaults are excluded: `crBps` reports 0 for debt 0 (see chain-client),
 * which is the "not-liquidatable / not-at-risk" sentinel — never a real risk.
 */
export function atRisk(
  vaults: VaultRow[],
  feedValue: bigint,
  feedDecimals: number,
  maxCrBps: bigint,
): AtRiskVault[] {
  return vaults
    .filter((v) => v.active && v.debt18 > 0n)
    .map((v) => ({ vault: v, crBps: vaultCrBps(v, feedValue, feedDecimals) }))
    .filter((x) => x.crBps < maxCrBps)
    .sort((a, b) => (a.crBps < b.crBps ? -1 : a.crBps > b.crBps ? 1 : 0));
}
