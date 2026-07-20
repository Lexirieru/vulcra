"use client";

// Vault reads against the Vulcra VaultManager (U5). The VaultManager is a Vulcra
// contract (not a Flare system contract), so its address comes from env and is
// blank until the smartcontract plan deploys on Coston2. Until then reads report
// `notConfigured` rather than inventing data (no mock). Protocol parameters fall
// back to the documented defaults (master R7) for client-side math, clearly
// flagged via `isDefault`.
import { useReadContract, useReadContracts } from "wagmi";
import type { Address } from "viem";
import { COSTON2_CHAIN_ID, VAULT_MANAGER_ADDRESS } from "@/config/contracts";
import { vaultManagerAbi } from "@/lib/contracts/abis";

export const DEFAULT_PARAMS = {
  mcrBps: 13_000n, // 130%
  minDebt18: 100n * 10n ** 18n, // 100 vUSD
  mintFeeBps: 50n, // 0.5%
  liqBonusBps: 1_000n, // 10%
} as const;

export function useVaultManagerAddress() {
  const address = VAULT_MANAGER_ADDRESS ? (VAULT_MANAGER_ADDRESS as Address) : undefined;
  return { address, configured: Boolean(address) };
}

export interface VaultParams {
  mcrBps: bigint;
  minDebt18: bigint;
  mintFeeBps: bigint;
  liqBonusBps: bigint;
  isDefault: boolean;
}

export function useVaultParams(): { params: VaultParams; isLoading: boolean } {
  const { address, configured } = useVaultManagerAddress();
  const base = { address, abi: vaultManagerAbi, chainId: COSTON2_CHAIN_ID } as const;

  const { data, isLoading } = useReadContracts({
    contracts: [
      { ...base, functionName: "mcrBps" },
      { ...base, functionName: "minDebt18" },
      { ...base, functionName: "mintFeeBps" },
      { ...base, functionName: "liqBonusBps" },
    ],
    query: { enabled: configured },
  });

  if (!configured || !data || data.some((r) => r.status !== "success")) {
    return { params: { ...DEFAULT_PARAMS, isDefault: true }, isLoading };
  }

  return {
    params: {
      mcrBps: data[0].result as bigint,
      minDebt18: data[1].result as bigint,
      mintFeeBps: data[2].result as bigint,
      liqBonusBps: data[3].result as bigint,
      isDefault: false,
    },
    isLoading,
  };
}

export interface VaultState {
  collateral6: bigint;
  debt18: bigint;
  active: boolean;
}

export function useVault(owner?: Address) {
  const { address, configured } = useVaultManagerAddress();

  const query = useReadContract({
    address,
    abi: vaultManagerAbi,
    functionName: "getVault",
    args: owner ? [owner] : undefined,
    chainId: COSTON2_CHAIN_ID,
    query: { enabled: configured && Boolean(owner) },
  });

  const vault = query.data
    ? (() => {
        const [collateral6, debt18, active] = query.data as readonly [
          bigint,
          bigint,
          boolean,
        ];
        return { collateral6, debt18, active } satisfies VaultState;
      })()
    : undefined;

  return {
    vault: vault?.active ? vault : undefined,
    hasVault: Boolean(vault?.active),
    notConfigured: !configured,
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
  };
}
