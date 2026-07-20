// Pure collateral-ratio / liquidation-price / redemption math (KTD7). No React,
// no chain, no side effects — the single source shared by the dashboard, the
// what-if simulator, and the redemption preview so the numbers can never diverge.
//
// Units convention:
//   collateral6 : FXRP amount, 6 decimals (bigint)
//   debt18      : vUSD debt, 18 decimals (bigint)
//   price18     : XRP/USD price, 18 decimals (bigint)
//   *Bps        : basis points (10000 = 100%)

const FXRP_DECIMALS = 6n;
const USD_DECIMALS = 18n;
const ONE_FXRP = 10n ** FXRP_DECIMALS; // 1e6
const ONE_USD = 10n ** USD_DECIMALS; // 1e18

export type HealthBand = "healthy" | "warning" | "danger";

/** USD value (18-dec) of a FXRP collateral amount at a given price. */
export function collateralValueUsd18(collateral6: bigint, price18: bigint): bigint {
  // collateral6 (FXRP*1e6) * price18 (USD/XRP*1e18) / 1e6 => USD*1e18
  return (collateral6 * price18) / ONE_FXRP;
}

/**
 * Collateral ratio in basis points. Returns null for a debt-free position
 * (ratio is effectively infinite — render as "∞", not a number).
 */
export function computeCrBps(
  collateral6: bigint,
  debt18: bigint,
  price18: bigint,
): bigint | null {
  if (debt18 === 0n) return null;
  const value18 = collateralValueUsd18(collateral6, price18);
  return (value18 * 10_000n) / debt18;
}

/**
 * Price (18-dec) at which this position's CR falls to MCR — i.e. the price at
 * or below which it becomes liquidatable. Null when there is no collateral.
 */
export function liquidationPrice18(
  collateral6: bigint,
  debt18: bigint,
  mcrBps: bigint,
): bigint | null {
  if (collateral6 === 0n) return null;
  // value18 = debt18 * mcr/1e4 ; value18 = collateral6 * price / 1e6
  // => price18 = debt18 * mcrBps * 1e6 / (1e4 * collateral6)
  return (debt18 * mcrBps * ONE_FXRP) / (10_000n * collateral6);
}

/** FXRP (6-dec) received for redeeming a vUSD amount at face value. */
export function fxrpForVusd(vusd18: bigint, price18: bigint): bigint {
  if (price18 === 0n) return 0n;
  // vusd18 (USD*1e18) / price18 (USD/XRP*1e18) => XRP ; *1e6 => FXRP 6-dec
  return (vusd18 * ONE_FXRP) / price18;
}

/** Max vUSD mintable against collateral while staying at exactly MCR. */
export function maxMintableVusd18(
  collateral6: bigint,
  price18: bigint,
  mcrBps: bigint,
): bigint {
  if (mcrBps === 0n) return 0n;
  const value18 = collateralValueUsd18(collateral6, price18);
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

export const UNITS = { ONE_FXRP, ONE_USD, FXRP_DECIMALS, USD_DECIMALS };
