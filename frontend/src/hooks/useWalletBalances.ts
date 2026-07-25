"use client";

// The connected Flare wallet's live Coston2 balances for the wallet sidebar:
// native C2FLR plus the three ERC-20s Vulcra actually deals in — vUSD, FXRP and
// WC2FLR. Every number is a real chain read; nothing here is hardcoded that the
// chain can answer for itself:
//   • C2FLR  ← wagmi useBalance (native)
//   • vUSD   ← VaultManager.vusd() → ERC20.balanceOf   (the contract is the
//              authority on the shared vUSD address — same pattern as StatsBar)
//   • FXRP   ← branches.ts collateralToken → ERC20.balanceOf
//   • WC2FLR ← FlareContractRegistry("WNat") → ERC20.balanceOf
//
// The three ERC-20 reads are deliberately separate calls rather than one
// multicall batch: a token whose address hasn't resolved yet (WNat via the
// registry) would otherwise fail-encode the whole batch and blank out the
// balances that ARE known. Each leg loads and fails on its own; an unresolved
// leg stays `undefined` so the UI renders "—", never a fabricated 0.
import { useBalance, useReadContract } from "wagmi";
import type { Address } from "viem";
import { BRANCHES } from "@/config/branches";
import { COSTON2_CHAIN_ID } from "@/config/contracts";
import { erc20Abi, vaultManagerAbi } from "@/lib/contracts/abis";
import { useCollateralToken } from "./useVault";

const POLL_MS = 20_000;

export interface TokenBalance {
  symbol: string;
  decimals: number;
  /** Base units. `undefined` → render "—" (loading or unresolved), never 0. */
  value?: bigint;
  isLoading: boolean;
}

export interface WalletBalances {
  /** Native Coston2 gas token. */
  native: TokenBalance;
  /** vUSD, FXRP, WC2FLR — in sidebar display order. */
  tokens: TokenBalance[];
}

function useErc20Balance(
  token: Address | undefined,
  account: Address | undefined,
  addressLoading: boolean,
) {
  const query = useReadContract({
    address: token,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: account ? [account] : undefined,
    chainId: COSTON2_CHAIN_ID,
    query: {
      enabled: Boolean(token && account),
      refetchInterval: POLL_MS,
    },
  });
  return {
    value: query.data as bigint | undefined,
    isLoading: Boolean(account) && (addressLoading || query.isLoading),
  };
}

export function useWalletBalances(account?: Address): WalletBalances {
  const fxrp = BRANCHES.fxrp;
  const wflr = BRANCHES.wflr;

  // vUSD is shared by both branches; whichever VaultManager is configured can
  // name it. staleTime Infinity — a deployed token address never moves.
  const vusdSource = (fxrp.vaultManager || wflr.vaultManager) as Address | "";
  const vusdAddress = useReadContract({
    address: vusdSource || undefined,
    abi: vaultManagerAbi,
    functionName: "vusd",
    chainId: COSTON2_CHAIN_ID,
    query: { enabled: Boolean(vusdSource), staleTime: Infinity },
  });

  // WNat/wFLR resolves through FlareContractRegistry (no hardcoded address).
  const wnat = useCollateralToken(wflr);

  const native = useBalance({
    address: account,
    chainId: COSTON2_CHAIN_ID,
    query: { enabled: Boolean(account), refetchInterval: POLL_MS },
  });

  const vusd = useErc20Balance(
    vusdAddress.data as Address | undefined,
    account,
    vusdAddress.isLoading,
  );
  const fxrpBalance = useErc20Balance(
    (fxrp.collateralToken || undefined) as Address | undefined,
    account,
    false,
  );
  const wflrBalance = useErc20Balance(wnat.address, account, wnat.isLoading);

  return {
    native: {
      symbol: native.data?.symbol ?? "C2FLR",
      decimals: native.data?.decimals ?? 18,
      value: native.data?.value,
      isLoading: Boolean(account) && native.isLoading,
    },
    tokens: [
      { symbol: "vUSD", decimals: 18, ...vusd },
      {
        symbol: fxrp.collateralSymbol,
        decimals: fxrp.collateralDecimals,
        ...fxrpBalance,
      },
      {
        symbol: wflr.collateralSymbol,
        decimals: wflr.collateralDecimals,
        ...wflrBalance,
      },
    ],
  };
}
