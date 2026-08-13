// Reconstruct current-state vaults from the Goldsky subgraph's per-event entities.
// Goldsky Instant Subgraphs store ONE row per emitted event (vaultOpeneds,
// debtMinteds, …), not a rolling state — so we pull every state-changing event and
// fold them per owner in block order. This reproduces the on-chain getVault() exactly
// for collateral + active (verified against Coston2); debt matches modulo interest
// accrual (the live liquidate() re-checks CR on-chain anyway, so that drift is safe).
import { gqlFetch } from "./client";
import { computeCrBps } from "@/lib/vault-math";
import type { AtRiskVault } from "@/lib/api/types";
import type { Address } from "viem";

// Every entity also carries id / timestamp_ / transactionHash_ / contractId_; the
// current-state fold only needs the owner, the block, and the resulting amounts.
interface OwnerBlock {
  owner: string;
  block_number: string;
}
interface OpenEv extends OwnerBlock {
  collateral6: string;
  debt18: string;
  annualInterestRateBps: string;
}
interface CollEv extends OwnerBlock {
  newCollateral6: string;
}
interface DebtEv extends OwnerBlock {
  newDebt18: string;
}
interface RateEv extends OwnerBlock {
  newAnnualInterestRateBps: string;
  newDebt18: string;
}

export interface VaultEvents {
  vaultOpeneds: OpenEv[];
  collateralAddeds: CollEv[];
  collateralWithdrawns: CollEv[];
  debtMinteds: DebtEv[];
  debtRepaids: DebtEv[];
  interestRateAdjusteds: RateEv[];
  vaultCloseds: OwnerBlock[];
  vaultLiquidateds: OwnerBlock[];
}

export const VAULT_EVENTS_QUERY = `{
  vaultOpeneds(first:1000,orderBy:block_number,orderDirection:asc){owner collateral6 debt18 annualInterestRateBps block_number}
  collateralAddeds(first:1000,orderBy:block_number,orderDirection:asc){owner newCollateral6 block_number}
  collateralWithdrawns(first:1000,orderBy:block_number,orderDirection:asc){owner newCollateral6 block_number}
  debtMinteds(first:1000,orderBy:block_number,orderDirection:asc){owner newDebt18 block_number}
  debtRepaids(first:1000,orderBy:block_number,orderDirection:asc){owner newDebt18 block_number}
  interestRateAdjusteds(first:1000,orderBy:block_number,orderDirection:asc){owner newAnnualInterestRateBps newDebt18 block_number}
  vaultCloseds(first:1000,orderBy:block_number,orderDirection:asc){owner block_number}
  vaultLiquidateds(first:1000,orderBy:block_number,orderDirection:asc){owner block_number}
}`;

export function fetchVaultEvents(url: string): Promise<VaultEvents> {
  return gqlFetch<VaultEvents>(url, VAULT_EVENTS_QUERY);
}

export interface VaultState {
  owner: string;
  /** Collateral in the branch's own decimals (FXRP 6, wFLR 18). */
  collateral: bigint;
  /** vUSD debt (18-dec) at the last recorded event (no post-event accrual). */
  debt18: bigint;
  rateBps: bigint;
  active: boolean;
  lastBlock: number;
}

// Fold every event into current per-owner state. Ordered by block, then by a
// within-block priority so an open is applied before same-block adjustments and a
// close/liquidate is applied last. An owner that closed and re-opened is folded into
// its latest vault, matching on-chain getVault(). Owner keys are lowercased.
export function foldVaults(ev: VaultEvents): VaultState[] {
  interface Item {
    owner: string;
    block: number;
    prio: number;
    apply: (s: VaultState) => void;
  }
  const items: Item[] = [];
  const push = <T extends OwnerBlock>(
    arr: T[],
    prio: number,
    apply: (s: VaultState, e: T) => void,
  ) => {
    for (const e of arr) {
      items.push({ owner: e.owner.toLowerCase(), block: Number(e.block_number), prio, apply: (s) => apply(s, e) });
    }
  };

  push(ev.vaultOpeneds, 0, (s, e) => {
    s.collateral = BigInt(e.collateral6);
    s.debt18 = BigInt(e.debt18);
    s.rateBps = BigInt(e.annualInterestRateBps);
    s.active = true;
  });
  push(ev.collateralAddeds, 1, (s, e) => {
    s.collateral = BigInt(e.newCollateral6);
  });
  push(ev.collateralWithdrawns, 1, (s, e) => {
    s.collateral = BigInt(e.newCollateral6);
  });
  push(ev.debtMinteds, 1, (s, e) => {
    s.debt18 = BigInt(e.newDebt18);
  });
  push(ev.debtRepaids, 1, (s, e) => {
    s.debt18 = BigInt(e.newDebt18);
  });
  push(ev.interestRateAdjusteds, 1, (s, e) => {
    s.rateBps = BigInt(e.newAnnualInterestRateBps);
    s.debt18 = BigInt(e.newDebt18);
  });
  push(ev.vaultCloseds, 2, (s) => {
    s.active = false;
    s.collateral = 0n;
    s.debt18 = 0n;
  });
  push(ev.vaultLiquidateds, 2, (s) => {
    s.active = false;
    s.collateral = 0n;
    s.debt18 = 0n;
  });

  items.sort((a, b) => a.block - b.block || a.prio - b.prio);

  const byOwner = new Map<string, VaultState>();
  for (const it of items) {
    let s = byOwner.get(it.owner);
    if (!s) {
      s = { owner: it.owner, collateral: 0n, debt18: 0n, rateBps: 0n, active: false, lastBlock: 0 };
      byOwner.set(it.owner, s);
    }
    it.apply(s);
    s.lastBlock = it.block;
  }
  return [...byOwner.values()];
}

// Current-state vaults → the AtRiskVault shape the Liquidations UI already renders.
// Keeps only active, indebted vaults whose CR (computed with the live FTSO price) is
// at or below the threshold; riskiest first. crThresholdBps <= 0 disables discovery.
export function toAtRiskVaults(
  vaults: VaultState[],
  collDec: number,
  price18: bigint,
  crThresholdBps: number,
): AtRiskVault[] {
  const out: AtRiskVault[] = [];
  for (const v of vaults) {
    if (!v.active || v.debt18 === 0n) continue;
    const cr = computeCrBps(v.collateral, collDec, v.debt18, price18);
    if (cr === null) continue; // debt-free → not at risk
    const crBps = Number(cr);
    if (crThresholdBps > 0 && crBps > crThresholdBps) continue;
    out.push({
      owner: v.owner as Address,
      collateral6: v.collateral.toString(),
      debt18: v.debt18.toString(),
      crBps,
    });
  }
  return out.sort((a, b) => a.crBps - b.crBps);
}
