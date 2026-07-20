// Pure collateral-ratio / liquidation-price / redemption math (KTD7). No React,
// no chain, no side effects — the single source shared by the dashboard, the
// what-if simulator, and the redemption preview so the numbers can never diverge.
// Branch-aware: the collateral token's decimals are passed in (FXRP 6, wFLR 18).
//
// Units convention:
//   collateral  : collateral amount in the token's own decimals (bigint)
//   collDec     : collateral token decimals (6 for FXRP, 18 for wFLR)
//   debt18      : vUSD debt, 18 decimals (bigint)
//   price18     : collateral/USD price, 18 decimals (bigint)
//   *Bps        : basis points (10000 = 100%)

const USD_DECIMALS = 18n;
const ONE_USD = 10n ** USD_DECIMALS; // 1e18

export type HealthBand = "healthy" | "warning" | "danger";

/** USD value (18-dec) of a collateral amount at a given price. */
export function collateralValueUsd18(
  collateral: bigint,
  collDec: number,
  price18: bigint,
): bigint {
  // collateral (token*10^collDec) * price18 (USD/token*1e18) / 10^collDec => USD*1e18
  return (collateral * price18) / 10n ** BigInt(collDec);
}

/**
 * Collateral ratio in basis points. Returns null for a debt-free position
 * (ratio is effectively infinite — render as "∞", not a number).
 */
export function computeCrBps(
  collateral: bigint,
  collDec: number,
  debt18: bigint,
  price18: bigint,
): bigint | null {
  if (debt18 === 0n) return null;
  const value18 = collateralValueUsd18(collateral, collDec, price18);
  return (value18 * 10_000n) / debt18;
}

/**
 * Price (18-dec) at which this position's CR falls to MCR — i.e. the price at
 * or below which it becomes liquidatable. Null when there is no collateral.
 */
export function liquidationPrice18(
  collateral: bigint,
  collDec: number,
  debt18: bigint,
  mcrBps: bigint,
): bigint | null {
  if (collateral === 0n) return null;
  // value18 = debt18 * mcr/1e4 ; value18 = collateral * price / 10^collDec
  // => price18 = debt18 * mcrBps * 10^collDec / (1e4 * collateral)
  return (debt18 * mcrBps * 10n ** BigInt(collDec)) / (10_000n * collateral);
}

/** Collateral (token decimals) received for redeeming a vUSD amount at face value. */
export function collateralForVusd(
  vusd18: bigint,
  price18: bigint,
  collDec: number,
): bigint {
  if (price18 === 0n) return 0n;
  // vusd18 (USD*1e18) / price18 (USD/token*1e18) => token ; *10^collDec => token dec
  return (vusd18 * 10n ** BigInt(collDec)) / price18;
}

/** Max vUSD mintable against collateral while staying at exactly MCR. */
export function maxMintableVusd18(
  collateral: bigint,
  collDec: number,
  price18: bigint,
  mcrBps: bigint,
): bigint {
  if (mcrBps === 0n) return 0n;
  const value18 = collateralValueUsd18(collateral, collDec, price18);
  return (value18 * 10_000n) / mcrBps;
}

/**
 * Health band relative to MCR. Healthy ≥ 1.5×MCR, warning ≥ MCR, danger < MCR.
 * A null CR (no debt) is always healthy.
 */
export function healthBand(crBps: bigint | null, mcrBps: bigint): HealthBand {
  if (crBps === null) return "healthy";
  if (crBps < mcrBps) return "danger";
  if (crBps < (mcrBps * 15_000n) / 10_000n) return "warning";
  return "healthy";
}

export const UNITS = { ONE_USD, USD_DECIMALS };
