"use client";

// Runtime resolution of Flare system contract addresses via FlareContractRegistry
// (U2 / mandate: never hardcode a system address). Uses wagmi's own useReadContract
// — not the periphery package's generated hooks.
import { useReadContract } from "wagmi";
import type { Address } from "viem";
import {
  COSTON2_CHAIN_ID,
  FLARE_CONTRACT_REGISTRY_ADDRESS,
} from "@/config/contracts";
import { contractRegistryAbi } from "./abis";

const ZERO = "0x0000000000000000000000000000000000000000";

/** Resolve a Flare system contract address by its registry name. */
export function useContractAddress(name: string) {
  const query = useReadContract({
    address: FLARE_CONTRACT_REGISTRY_ADDRESS,
    abi: contractRegistryAbi,
    functionName: "getContractAddressByName",
    args: [name],
    chainId: COSTON2_CHAIN_ID,
    query: {
      staleTime: 5 * 60_000, // system addresses effectively never change
      gcTime: 30 * 60_000,
    },
  });

  const resolved =
    query.data && query.data !== ZERO ? (query.data as Address) : undefined;

  return { ...query, address: resolved };
}
