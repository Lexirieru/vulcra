/**
 * Centralized decimal normalization (R3 / smartcontract KTD4).
 *
 * Conventions:
 *   - FXRP collateral: 6 decimals (XRP drops).
 *   - FTSO feed: returns (value, int8 decimals) — decimals are DYNAMIC, read per call.
 *   - vUSD / all USD math: 18 decimals.
 *
 * All helpers are pure integer math (bigint) and sign-safe for feed decimals
 * that exceed 12 (where 18 - 6 - feedDecimals goes negative).
 */

/** Multiply by 10^exp for any integer exp (divides when exp < 0). */
export function scaleBy10(value: bigint, exp: number): bigint {
  if (exp === 0) return value;
  const factor = 10n ** BigInt(Math.abs(exp));
  return exp > 0 ? value * factor : value / factor;
}

/** XRP/USD price in 18-decimal USD: value * 10^(18 - feedDecimals). */
export function xrpUsdPrice18(feedValue: bigint, feedDecimals: number): bigint {
  if (feedValue < 0n) throw new Error("feedValue must be >= 0");
  return scaleBy10(feedValue, 18 - feedDecimals);
}

/**
 * USD value (18-dec) of an FXRP amount (6-dec):
 *   fxrp6 * feedValue * 10^(18 - 6 - feedDecimals)
 * Computed as (fxrp6 * feedValue) then scaled, so a negative exponent divides
 * the full product (not each factor) — preserving precision.
 */
export function collateralValueUsd18(
  fxrp6: bigint,
  feedValue: bigint,
  feedDecimals: number,
): bigint {
  if (fxrp6 < 0n || feedValue < 0n) throw new Error("amounts must be >= 0");
  return scaleBy10(fxrp6 * feedValue, 18 - 6 - feedDecimals);
}

/** Collateral ratio in bps: collateralUsd18 * 10000 / debt18. Returns max uint-ish for debt 0. */
export function crBps(collateralUsd18: bigint, debt18: bigint): bigint {
  if (debt18 === 0n) return 0n; // caller treats 0-debt vaults as not-liquidatable / not-at-risk
  return (collateralUsd18 * 10000n) / debt18;
}

/** How much FXRP (6-dec) a given USD amount (18-dec) buys at the current price. */
export function usd18ToFxrp6(
  usd18: bigint,
  feedValue: bigint,
  feedDecimals: number,
): bigint {
  if (feedValue === 0n) throw new Error("feedValue must be > 0");
  // fxrp6 = usd18 / (price18) * 1e6 ; price18 = feedValue * 10^(18 - feedDecimals)
  const price18 = xrpUsdPrice18(feedValue, feedDecimals);
  if (price18 === 0n) throw new Error("price18 resolved to 0");
  return (usd18 * 1_000_000n) / price18;
}
