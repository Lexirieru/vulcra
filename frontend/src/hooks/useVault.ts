"use client";

// Vault reads against a branch's Vulcra VaultManager (U5, multi-collateral). The
// VaultManager is a Vulcra contract (not in ContractRegistry), so its address
// comes from the branch config (env). A blank address → `notConfigured` (no mock).
// The SAME ABI serves every branch; only the instance address differs. Reads the
// real `params()` struct; falls back to documented defaults (R7) when unconfigured.
import { useAccount, useReadContract } from "wagmi";
import type { Address } from "viem";
import { COSTON2_CHAIN_ID } from "@/config/contracts";
import { useXrplWalletContext } from "@/context/xrpl";
import { usePersonalAccount } from "@/hooks/usePersonalAccount";
import { vaultManagerAbi } from "@/lib/contracts/abis";
import { useContractAddress } from "@/lib/contracts/registry";
import { BRANCHES, type CollateralBranch } from "@/config/branches";

export const DEFAULT_PARAMS = {
  mcrBps: 13_000n, // 130%
  minDebt18: 100n * 10n ** 18n, // 100 vUSD
  mintFeeBps: 50n, // 0.5%
  liqBonusBps: 1_000n, // 10%
  redemptionFeeBps: 0n, // face value
} as const;

/** Pure helper: the configured VaultManager for a branch, if any. */
export function branchVaultManager(branch: CollateralBranch): {
  address?: Address;
  configured: boolean;
} {
  const address = branch.vaultManager ? (branch.vaultManager as Address) : undefined;
  return { address, configured: Boolean(address) };
}

/**
 * The collateral token address for a branch — resolved via ContractRegistry when
 * a registry name is set (wFLR → "WNat", no hardcode), else the config/env value.
 */
export function useCollateralToken(branch: CollateralBranch): {
  address?: Address;
  isLoading: boolean;
} {
  const reg = useContractAddress(branch.collateralRegistryName ?? "", {
    enabled: Boolean(branch.collateralRegistryName),
  });
  const address = branch.collateralRegistryName
    ? reg.address
    : ((branch.collateralToken || undefined) as Address | undefined);
  return { address, isLoading: Boolean(branch.collateralRegistryName) && reg.isLoading };
}

export interface VaultParams {
  mcrBps: bigint;
  minDebt18: bigint;
  mintFeeBps: bigint;
  liqBonusBps: bigint;
  redemptionFeeBps: bigint;
  isDefault: boolean;
}

export function useVaultParams(vaultManager?: Address): {
  params: VaultParams;
  isLoading: boolean;
} {
  const configured = Boolean(vaultManager);
  const { data, isLoading } = useReadContract({
    address: vaultManager,
    abi: vaultManagerAbi,
    functionName: "params",
    chainId: COSTON2_CHAIN_ID,
    query: { enabled: configured },
  });

  if (!configured || !data) {
    return { params: { ...DEFAULT_PARAMS, isDefault: true }, isLoading };
  }

  const [mcrBps, minDebt18, mintFeeBps, liqBonusBps, redemptionFeeBps] =
    data as readonly [bigint, bigint, bigint, bigint, bigint];
  return {
    params: { mcrBps, minDebt18, mintFeeBps, liqBonusBps, redemptionFeeBps, isDefault: false },
    isLoading,
  };
}

export interface VaultState {
  /** Collateral in the branch token's own decimals (FXRP 6, wFLR 18). */
  collateral: bigint;
  debt18: bigint;
  active: boolean;
}

export function useVault(owner?: Address, vaultManager?: Address) {
  const configured = Boolean(vaultManager);

  const query = useReadContract({
    address: vaultManager,
    abi: vaultManagerAbi,
    functionName: "getVault",
    args: owner ? [owner] : undefined,
    chainId: COSTON2_CHAIN_ID,
    // Poll so the debt (which grows with accrued V2 interest) stays current.
    query: { enabled: configured && Boolean(owner), refetchInterval: 12_000 },
  });

  const vault = query.data
    ? (() => {
        const [collateral, debt18, active] = query.data as readonly [
          bigint,
          bigint,
          boolean,
        ];
        return { collateral, debt18, active } satisfies VaultState;
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

/**
 * The XRP-path vault for a branch: the vault owned by the connected XRPL
 * wallet's Flare PersonalAccount (a Smart Account derived from the r-address),
 * NOT by any EVM wallet. The VaultManager keys vaults by owner, so the same
 * person can hold a PersonalAccount-owned vault the EVM borrow page's
 * getVault(evmWallet) read can never see — this hook is the shared detection
 * for that position (the market page's position list, the borrow pages'
 * "manage vs open" decision, the /borrow/xrp header). Only meaningful on branches with an
 * XRPL-native mint (FXRP); everywhere else it resolves to "no vault".
 */
export function useXrplPathVault(branch: CollateralBranch) {
  const { address: xrplAddress } = useXrplWalletContext();
  const account = usePersonalAccount(xrplAddress ?? "");
  const pa = account.data?.personalAccount as Address | undefined;
  const enabled = branch.hasXrplMint && Boolean(xrplAddress);
  const { vault, hasVault, refetch } = useVault(
    enabled ? pa : undefined,
    branch.vaultManager || undefined,
  );
  return {
    /** Connected XRPL r-address, if any. */
    xrplAddress,
    /** The derived Flare PersonalAccount that owns the vault. */
    pa,
    vault,
    hasVault: enabled && hasVault,
    refetch,
  };
}

/** One position in a branch's market, tagged with the wallet that owns it. */
export interface BranchPosition {
  /** The on-chain vault owner (EVM wallet, or the derived PersonalAccount). */
  owner: Address;
  vault: VaultState;
}

/**
 * Every position the user holds on ONE branch's market, across both rails.
 * The VaultManager keys vaults by owner, so the same person can hold TWO
 * distinct vaults: one owned by their EVM wallet (opened via wagmi writes) and
 * one owned by their XRPL wallet's PersonalAccount (opened via 0xFE payments).
 * This is the market page's single source of truth for "what do I have here".
 */
export function useBranchPositions(branch: CollateralBranch) {
  const { address } = useAccount();
  const evmQ = useVault(address, branch.vaultManager || undefined);
  const xrplQ = useXrplPathVault(branch);

  const evm: BranchPosition | undefined =
    address && evmQ.hasVault && evmQ.vault
      ? { owner: address, vault: evmQ.vault }
      : undefined;
  const xrpl: (BranchPosition & { rAddress: string }) | undefined =
    xrplQ.pa && xrplQ.xrplAddress && xrplQ.hasVault && xrplQ.vault
      ? { owner: xrplQ.pa, rAddress: xrplQ.xrplAddress, vault: xrplQ.vault }
      : undefined;

  return {
    evm,
    xrpl,
    count: (evm ? 1 : 0) + (xrpl ? 1 : 0),
    isLoading: evmQ.isLoading,
  };
}

/** The FXRP market's positions — the only branch where both rails exist. */
export function useFxrpPositions() {
  return useBranchPositions(BRANCHES.fxrp);
}
