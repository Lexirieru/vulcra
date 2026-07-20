import type { Address, Hex, PublicClient } from "viem";
import { ftsoV2Abi } from "./abis.js";
import { resolveFtsoV2 } from "./registry.js";
import { XRP_USD_FEED_ID } from "./coston2.js";
import { feedPrice18 } from "./decimals.js";
import type { BranchDescriptor } from "./branches.js";

export interface FeedReading {
  value: bigint;
  decimals: number;
  timestamp: bigint;
  price18: bigint;
  stale: boolean;
}

/**
 * Read any FTSOv2 block-latency feed by id and scale it to 18-dec USD. On Coston2
 * the view read is free. `feedDecimals` is read from the feed itself (dynamic) —
 * never assumed. Flags staleness against `maxStalenessSeconds`.
 */
export async function readFeedById(
  client: PublicClient,
  feedId: Hex,
  opts: { ftsoV2?: Address; maxStalenessSeconds: number; nowSeconds: bigint },
): Promise<FeedReading> {
  const ftso = opts.ftsoV2 ?? (await resolveFtsoV2(client));
  const [value, decimals, timestamp] = (await client.readContract({
    address: ftso,
    abi: ftsoV2Abi,
    functionName: "getFeedById",
    args: [feedId],
  })) as [bigint, number, bigint];

  if (value === 0n) throw new Error(`FTSO returned zero price for feed ${feedId}`);
  const stale = opts.nowSeconds - timestamp > BigInt(opts.maxStalenessSeconds);
  return { value, decimals, timestamp, price18: feedPrice18(value, decimals), stale };
}

/** Read a branch's USD feed (FXRP -> XRP/USD, wFLR -> FLR/USD). */
export function readBranchPrice(
  client: PublicClient,
  branch: BranchDescriptor,
  opts: { ftsoV2?: Address; maxStalenessSeconds: number; nowSeconds: bigint },
): Promise<FeedReading> {
  return readFeedById(client, branch.feedId, opts);
}

/** Read the XRP/USD feed. Kept for back-compat; delegates to readFeedById. */
export function readXrpUsd(
  client: PublicClient,
  opts: { ftsoV2?: Address; maxStalenessSeconds: number; nowSeconds: bigint },
): Promise<FeedReading> {
  return readFeedById(client, XRP_USD_FEED_ID, opts);
}
