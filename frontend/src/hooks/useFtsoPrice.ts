"use client";

// Live collateral/USD price from FTSOv2 (U4 / KTD4). Real Coston2 read via
// FlareContractRegistry resolution + wagmi useReadContract, polled at ~block
// cadence, with a staleness signal derived from the feed's own timestamp. The
// feed id is per-branch (XRP/USD for FXRP, FLR/USD for wFLR); feed decimals are
// read dynamically from the response, so 6-dec and 8-dec feeds both work. No mocks.
import { useEffect, useState } from "react";
import { useReadContract } from "wagmi";
import type { Hex } from "viem";
import { COSTON2_CHAIN_ID, CONTRACT_NAMES } from "@/config/contracts";
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

export function useFtsoPrice(feedId: Hex): FtsoPrice {
  const { address: ftsoAddress } = useContractAddress(CONTRACT_NAMES.ftsoV2);

  const { data, isLoading, isError, refetch } = useReadContract({
    address: ftsoAddress,
    abi: ftsoV2ReadAbi,
    functionName: "getFeedById",
    args: [feedId],
    chainId: COSTON2_CHAIN_ID,
    query: {
      enabled: Boolean(ftsoAddress),
      refetchInterval: POLL_MS,
      refetchIntervalInBackground: false,
    },
  });

  // Clock ticks in an effect (not during render) so staleness stays pure.
  const [nowS, setNowS] = useState(0);
  useEffect(() => {
    const tick = () => setNowS(Math.floor(Date.now() / 1000));
    tick();
    const id = setInterval(tick, 2000);
    return () => clearInterval(id);
  }, []);

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

  return {
    price18,
    priceFloat: Number(price18) / 1e18,
    timestamp: ts,
    isStale: ts > 0 && nowS > 0 && nowS - ts > STALE_AFTER_S,
    isLoading: false,
    isError,
    refetch,
  };
}
