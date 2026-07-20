"use client";

// V2 interest-rate reads (Liquity-V2 user-set rates). Bounds for the slider come
// from the contract (min/max/default), the vault's own rate is polled, and
// "redeemable before you" is a real bounded on-chain walk down the by-rate
// redemption queue — no mock, no backend dependency.
import { useReadContract, useReadContracts, usePublicClient } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import { zeroAddress, type Address } from "viem";
import { COSTON2_CHAIN_ID } from "@/config/contracts";
import { vaultManagerAbi } from "@/lib/contracts/abis";

export interface InterestConfig {
  minBps: number;
  maxBps: number;
  defaultBps: number;
  isDefault: boolean;
}

export function useInterestConfig(
  vaultManager: Address | undefined,
  fallback: { minBps: number; maxBps: number; defaultBps: number },
): { config: InterestConfig; isLoading: boolean } {
  const base = { address: vaultManager, abi: vaultManagerAbi, chainId: COSTON2_CHAIN_ID } as const;
  const { data, isLoading } = useReadContracts({
    contracts: [
      { ...base, functionName: "minInterestRateBps" },
      { ...base, functionName: "maxInterestRateBps" },
      { ...base, functionName: "defaultInterestRateBps" },
    ],
    query: { enabled: Boolean(vaultManager) },
  });

  if (!vaultManager || !data || data.some((r) => r.status !== "success")) {
    return { config: { ...fallback, isDefault: true }, isLoading };
  }
  return {
    config: {
      minBps: Number(data[0].result as bigint),
      maxBps: Number(data[1].result as bigint),
      defaultBps: Number(data[2].result as bigint),
      isDefault: false,
    },
    isLoading,
  };
}

/** The connected vault's annual interest rate (bps), polled. */
export function useVaultRate(owner?: Address, vaultManager?: Address) {
  const query = useReadContract({
    address: vaultManager,
    abi: vaultManagerAbi,
    functionName: "annualInterestRateBpsOf",
    args: owner ? [owner] : undefined,
    chainId: COSTON2_CHAIN_ID,
    query: { enabled: Boolean(vaultManager && owner), refetchInterval: 12_000 },
  });
  return { rateBps: query.data as bigint | undefined, ...query };
}

/**
 * Total vUSD debt ahead of the user in the by-rate redemption queue (vaults at a
 * strictly lower rate are redeemed first). Bounded walk via nextVault (toward
 * lower rate) from the user's vault.
 */
export function useRedeemableBefore(
  owner?: Address,
  vaultManager?: Address,
  enabled = true,
) {
  const client = usePublicClient({ chainId: COSTON2_CHAIN_ID });
  return useQuery({
    queryKey: ["redeemable-before", vaultManager, owner],
    enabled: Boolean(client && owner && vaultManager && enabled),
    refetchInterval: 20_000,
    queryFn: async () => {
      if (!client || !owner || !vaultManager) return { debt18: 0n, count: 0, capped: false };
      const CAP = 25;
      let cur = (await client.readContract({
        address: vaultManager,
        abi: vaultManagerAbi,
        functionName: "nextVault",
        args: [owner],
      })) as Address;
      let debt18 = 0n;
      let count = 0;
      let hops = 0;
      while (cur && cur !== zeroAddress && hops < CAP) {
        const [, debt] = (await client.readContract({
          address: vaultManager,
          abi: vaultManagerAbi,
          functionName: "getVault",
          args: [cur],
        })) as readonly [bigint, bigint, boolean];
        debt18 += debt;
        count += 1;
        hops += 1;
        cur = (await client.readContract({
          address: vaultManager,
          abi: vaultManagerAbi,
          functionName: "nextVault",
          args: [cur],
        })) as Address;
      }
      return { debt18, count, capped: hops >= CAP };
    },
  });
}
