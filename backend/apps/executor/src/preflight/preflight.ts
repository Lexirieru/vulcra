import { computeRequiredXrpDrops, dropsToXrpString } from "@vulcra/userop";
import { evaluateMintDelay, type LimiterState } from "./limits.js";
import { isValidXrplClassicAddress } from "./address.js";

/**
 * Pre-flight a mint BEFORE any XRP is sent (R12, AE2).
 *
 * Blocks (ok=false) irrecoverable payments:
 *   - net mint below the minimum fee floor (payment would be forfeited)
 *   - debt below the protocol minimum (vault-open would revert)
 *   - malformed XRPL recipient address
 * Otherwise returns the exact required payment and whether the mint will be
 * delayed by rate limits (delayed != failed).
 */
export interface PreflightParams {
  xrplAddress: string;
  netMintDrops: bigint; // FXRP collateral to mint (= XRP drops)
  mint18: bigint; // vUSD debt to mint
  // direct-minting settings (read from AssetManager at runtime)
  minFeeUBA: bigint;
  mintFeeBips: bigint;
  executorFeeUBA: bigint;
  hourly: LimiterState;
  daily: LimiterState;
  largeThreshold: bigint;
  largeDelaySeconds: bigint;
  unblockUntil: bigint;
  // protocol params (read from VaultManager)
  minDebt18: bigint;
  nowSeconds: bigint;
}

export interface PreflightResult {
  ok: boolean;
  blockedReason?: string;
  willDelay: boolean;
  executionAllowedAt: bigint;
  delayReasons: string[];
  requiredPaymentDrops: bigint;
  requiredPaymentXrp: string;
  mintFeeDrops: bigint;
  warnings: string[];
}

export function preflightMint(p: PreflightParams): PreflightResult {
  const warnings: string[] = [];

  const { totalDrops, mintFeeDrops } = computeRequiredXrpDrops({
    netMintDrops: p.netMintDrops,
    mintFeeBips: p.mintFeeBips,
    minFeeUBA: p.minFeeUBA,
    executorFeeUBA: p.executorFeeUBA,
  });

  const blocked = (reason: string): PreflightResult => ({
    ok: false,
    blockedReason: reason,
    willDelay: false,
    executionAllowedAt: p.nowSeconds,
    delayReasons: [],
    requiredPaymentDrops: totalDrops,
    requiredPaymentXrp: dropsToXrpString(totalDrops),
    mintFeeDrops,
    warnings,
  });

  // AE2: a payment below the minimum minting fee is consumed by the fee receiver
  // and mints nothing — block before any XRP leaves the wallet.
  if (p.netMintDrops < p.minFeeUBA) {
    return blocked(
      `net mint ${p.netMintDrops} drops is below the minimum minting fee ${p.minFeeUBA} drops — a sub-minimum payment is unrecoverable`,
    );
  }
  if (!isValidXrplClassicAddress(p.xrplAddress)) {
    return blocked(`invalid XRPL classic address "${p.xrplAddress}" — a wrong recipient is unrecoverable`);
  }
  if (p.mint18 < p.minDebt18) {
    return blocked(
      `requested debt ${p.mint18} is below the protocol minimum ${p.minDebt18} — the vault-open would revert`,
    );
  }

  const delay = evaluateMintDelay({
    amount: p.netMintDrops,
    hourly: p.hourly,
    daily: p.daily,
    largeThreshold: p.largeThreshold,
    largeDelaySeconds: p.largeDelaySeconds,
    unblockUntil: p.unblockUntil,
    nowSeconds: p.nowSeconds,
  });
  if (delay.willDelay) {
    warnings.push(
      `mint will be delayed (not failed) until ${delay.executionAllowedAt} — the executor retries the same proof automatically`,
    );
  }

  return {
    ok: true,
    willDelay: delay.willDelay,
    executionAllowedAt: delay.executionAllowedAt,
    delayReasons: delay.reasons,
    requiredPaymentDrops: totalDrops,
    requiredPaymentXrp: dropsToXrpString(totalDrops),
    mintFeeDrops,
    warnings,
  };
}
