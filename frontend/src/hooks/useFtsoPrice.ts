"use client";

// Live XRP/USD from FTSOv2 (U4 / KTD4). Real Coston2 read via FlareContractRegistry
// resolution + wagmi useReadContract, polled at ~block cadence, with a staleness
// signal derived from the feed's own timestamp. No mocks on this path.
import { useReadContract } from "wagmi";
import { COSTON2_CHAIN_ID, XRP_USD_FEED_ID } from "@/config/contracts";
import { CONTRACT_NAMES } from "@/config/contracts";
import { useContractAddress } from "@/lib/contracts/registry";
import { ftsoV2ReadAbi } from "@/lib/contracts/abis";

const POLL_MS = 1800; // ~1 Coston2 block
const STALE_AFTER_S = 30; // a handful of blocks

function normalizeTo18(value: bigint, decimals: number): bigint {
  const d = BigInt(decimals);
  return d <= 18n ? value * 10n ** (18n - d) : value / 10n ** (d - 18n);
}

export interface FtsoPrice {
  price18?: bigint;
  priceFloat?: number;
  timestamp?: number;
  isStale: boolean;
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
}

export function useFtsoPrice(): FtsoPrice {
  const { address: ftsoAddress } = useContractAddress(CONTRACT_NAMES.ftsoV2);

  const { data, isLoading, isError, refetch } = useReadContract({
    address: ftsoAddress,
    abi: ftsoV2ReadAbi,
    functionName: "getFeedById",
    args: [XRP_USD_FEED_ID],
    chainId: COSTON2_CHAIN_ID,
    query: {
      enabled: Boolean(ftsoAddress),
      refetchInterval: POLL_MS,
      refetchIntervalInBackground: false,
    },
  });

  if (!data) {
    return {
      isStale: false,
      isLoading: isLoading || !ftsoAddress,
      isError,
      refetch,
    };
  }

  const [value, decimals, timestamp] = data as readonly [bigint, number, bigint];
  const price18 = normalizeTo18(value, Number(decimals));
  const ts = Number(timestamp);
  const nowS = Math.floor(Date.now() / 1000);

  return {
    price18,
    priceFloat: Number(price18) / 1e18,
    timestamp: ts,
    isStale: ts > 0 && nowS - ts > STALE_AFTER_S,
    isLoading: false,
    isError,
    refetch,
  };
}
