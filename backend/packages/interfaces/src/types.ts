import type { Address, Hex } from "viem";

/** Protocol parameters (bps where noted). Mirrors smartcontract deploy config. */
export interface ProtocolParams {
  mcrBps: bigint; // 13000 = 130%
  minDebt18: bigint; // 100e18
  mintFeeBps: bigint; // 50 = 0.5%
  liqBonusBps: bigint; // 1000 = 10%
}

/** A vault, keyed by OWNER ADDRESS (one vault per address). */
export interface VaultView {
  owner: Address;
  collateral6: bigint; // FXRP, 6 decimals
  debt18: bigint; // vUSD, 18 decimals
  active: boolean;
}

/** What the user wants to mint atomically from an XRPL payment. */
export interface MintIntent {
  /** XRPL r-address initiating the payment. */
  xrplAddress: string;
  /** FXRP collateral to lock (6 decimals). */
  collateral6: bigint;
  /** vUSD to mint (18 decimals). */
  mint18: bigint;
  /** Where minted vUSD is delivered (default: the PersonalAccount). */
  vusdDestination: Address;
}

/** A private Vault Guardian protection rule (lives only inside the TEE). */
export interface GuardianRule {
  owner: Address; // vault owner address
  triggerCrBps: bigint; // e.g. 15000 = 150%
  maxRepay18: bigint; // cap on auto-repay
}

/** Sorted-list insertion hints (owner addresses); zero = let the contract descend. */
export interface SortedHints {
  prevHint: Address;
  nextHint: Address;
}

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;

export type { Address, Hex };
