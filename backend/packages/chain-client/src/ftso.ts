import type { Address, PublicClient } from "viem";
import { ftsoV2Abi } from "./abis.js";
import { resolveFtsoV2 } from "./registry.js";
import { XRP_USD_FEED_ID } from "./coston2.js";
import { xrpUsdPrice18 } from "./decimals.js";

export interface FeedReading {
  value: bigint;
  decimals: number;
  timestamp: bigint;
  price18: bigint;
  stale: boolean;
}

/**
 * Read the XRP/USD block-latency feed. On Coston2 the view read is free.
 * Flags staleness when the feed timestamp is older than `maxStalenessSeconds`
 * relative to `nowSeconds` (pass block time or wall clock).
 */
export async function readXrpUsd(
  client: PublicClient,
  opts: { ftsoV2?: Address; maxStalenessSeconds: number; nowSeconds: bigint },
): Promise<FeedReading> {
  const ftso = opts.ftsoV2 ?? (await resolveFtsoV2(client));
  const [value, decimals, timestamp] = (await client.readContract({
    address: ftso,
    abi: ftsoV2Abi,
    functionName: "getFeedById",
    args: [XRP_USD_FEED_ID],
  })) as [bigint, number, bigint];

  if (value === 0n) throw new Error("FTSO returned zero XRP/USD price");
  const stale = opts.nowSeconds - timestamp > BigInt(opts.maxStalenessSeconds);
  return {
    value,
    decimals,
    timestamp,
    price18: xrpUsdPrice18(value, decimals),
    stale,
  };
}
