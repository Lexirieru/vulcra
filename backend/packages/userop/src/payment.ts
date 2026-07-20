/**
 * Compute the XRP payment (in drops = UBA; XRP and FXRP both use 6 decimals)
 * a user must send so that, after the minting fee and executor fee are
 * deducted, `netMintDrops` of FXRP is minted as collateral.
 *
 * Fee model (from the FAssets direct-minting guide):
 *   mintFee = max(minFeeUBA, floor(netMintDrops * mintFeeBips / 10000))
 *   total   = netMintDrops + mintFee + executorFeeUBA
 *
 * NOTE: the exact fee base (payment vs net) is a contract detail; this is a
 * safe estimate. At live time prefer the on-chain
 * `computeDirectMintingPaymentAmountXrp` helper. Pure & unit-testable.
 */
export function computeRequiredXrpDrops(args: {
  netMintDrops: bigint;
  mintFeeBips: bigint;
  minFeeUBA: bigint;
  executorFeeUBA: bigint;
}): { totalDrops: bigint; mintFeeDrops: bigint } {
  if (args.netMintDrops < 0n) throw new Error("netMintDrops must be >= 0");
  const pct = (args.netMintDrops * args.mintFeeBips) / 10000n;
  const mintFeeDrops = pct > args.minFeeUBA ? pct : args.minFeeUBA;
  const totalDrops = args.netMintDrops + mintFeeDrops + args.executorFeeUBA;
  return { totalDrops, mintFeeDrops };
}

/** 1 XRP = 1_000_000 drops. */
export const DROPS_PER_XRP = 1_000_000n;

export function dropsToXrpString(drops: bigint): string {
  const whole = drops / DROPS_PER_XRP;
  const frac = (drops % DROPS_PER_XRP).toString().padStart(6, "0").replace(/0+$/, "");
  return frac.length > 0 ? `${whole}.${frac}` : `${whole}`;
}
