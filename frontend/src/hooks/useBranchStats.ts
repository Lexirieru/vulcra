"use client";

// Live per-branch VaultManager aggregates, shared by the dashboard borrow table
// (useBranchStats) and the Earn scaffold (useBranchDebt). All values come from
// the branch's VaultManager on Coston2 — no mocks:
//   - totalDebt18   getEntireSystemDebt()
//   - mcrBps        params().mcrBps (Max LTV = 1/MCR)
//   - avgRateBps    debt-weighted mean over the by-rate queue, walked
//                   highestRateVault() → nextVault() (toward lower rate, the
//                   same bounded-traversal pattern as useRedeemableBefore).
import { useReadContract, useReadContracts, usePublicClient } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import { zeroAddress, type Address } from "viem";
import { COSTON2_CHAIN_ID } from "@/config/contracts";
import { vaultManagerAbi } from "@/lib/contracts/abis";
import type { CollateralBranch } from "@/config/branches";

const WALK_CAP = 50; // plenty for Coston2 vault counts; `capped` flags overflow

export interface BranchStats {
  totalDebt18?: bigint;
  mcrBps?: bigint;
  vaultCount?: number;
  /** Debt-weighted average annual rate (bps); undefined while loading or when no vaults exist. */
  avgRateBps?: number;
  /** True when the queue walk hit WALK_CAP before the tail — avg covers the first N vaults. */
  avgCapped: boolean;
  isLoading: boolean;
  notConfigured: boolean;
}

export function useBranchStats(branch: CollateralBranch): BranchStats {
  const vaultManager = (branch.vaultManager || undefined) as Address | undefined;
  const base = {
    address: vaultManager,
    abi: vaultManagerAbi,
    chainId: COSTON2_CHAIN_ID,
  } as const;

  const { data, isLoading } = useReadContracts({
    contracts: [
      { ...base, functionName: "getEntireSystemDebt" },
      { ...base, functionName: "params" },
      { ...base, functionName: "vaultCount" },
    ],
    query: { enabled: Boolean(vaultManager), refetchInterval: 30_000 },
  });

  const totalDebt18 =
    data?.[0]?.status === "success" ? (data[0].result as bigint) : undefined;
  const params =
    data?.[1]?.status === "success"
      ? (data[1].result as readonly [bigint, bigint, bigint, bigint, bigint])
      : undefined;
  const vaultCount =
    data?.[2]?.status === "success" ? Number(data[2].result as bigint) : undefined;

  const client = usePublicClient({ chainId: COSTON2_CHAIN_ID });
  const avg = useQuery({
    queryKey: ["branch-avg-rate", vaultManager],
    enabled: Boolean(client && vaultManager),
    refetchInterval: 60_000,
    queryFn: async () => {
      if (!client || !vaultManager) return { avgRateBps: null, capped: false };
      const read = (functionName: string, args?: readonly [Address]) =>
        client.readContract({
          address: vaultManager,
          abi: vaultManagerAbi,
          functionName,
          args,
        } as Parameters<typeof client.readContract>[0]);

      let cur = (await read("highestRateVault")) as Address;
      let weighted = 0n;
      let debtSum = 0n;
      let hops = 0;
      while (cur && cur !== zeroAddress && hops < WALK_CAP) {
        const [, debt18] = (await read("getVault", [cur])) as readonly [
          bigint,
          bigint,
          boolean,
        ];
        const rateBps = (await read("annualInterestRateBpsOf", [cur])) as bigint;
        weighted += debt18 * rateBps;
        debtSum += debt18;
        hops += 1;
        cur = (await read("nextVault", [cur])) as Address;
      }
      return {
        avgRateBps: debtSum > 0n ? Number(weighted / debtSum) : null,
        capped: hops >= WALK_CAP,
      };
    },
  });

  return {
    totalDebt18,
    mcrBps: params?.[0],
    vaultCount,
    avgRateBps: avg.data?.avgRateBps ?? undefined,
    avgCapped: avg.data?.capped ?? false,
    isLoading: isLoading || avg.isLoading,
    notConfigured: !vaultManager,
  };
}

/** Total vUSD debt of a branch (18 dec) — real `getEntireSystemDebt()` read. */
export function useBranchDebt(vaultManager?: Address) {
  const { data, isLoading, isError } = useReadContract({
    address: vaultManager,
    abi: vaultManagerAbi,
    functionName: "getEntireSystemDebt",
    chainId: COSTON2_CHAIN_ID,
    // Poll so accruing V2 interest keeps the figure current.
    query: { enabled: Boolean(vaultManager), refetchInterval: 12_000 },
  });
  return { debt18: data as bigint | undefined, isLoading, isError };
}
