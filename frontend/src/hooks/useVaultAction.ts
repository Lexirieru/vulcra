"use client";

// Shared write-transaction lifecycle for every Vulcra action (U7 / KTD8), plus
// ERC-20 approval and native-wrap helpers. All writes target a branch's
// VaultManager instance (address passed in), so open/adjust/repay/close/liquidate/
// redeem/delegatedRepay behave identically across collateral branches.
import { useMemo } from "react";
import {
  useReadContract,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import type { Address } from "viem";
import { COSTON2_CHAIN_ID } from "@/config/contracts";
import { erc20Abi, vaultManagerAbi, wnatAbi } from "@/lib/contracts/abis";

export type TxPhase = "idle" | "signing" | "confirming" | "success" | "error";

type WriteFn = (typeof vaultManagerAbi)[number] extends {
  type: "function";
  name: infer N;
}
  ? N
  : never;

type WriteConfig = Parameters<
  ReturnType<typeof useWriteContract>["writeContract"]
>[0];

function phaseOf(
  writeError: unknown,
  receiptError: unknown,
  isSuccess: boolean,
  isConfirming: boolean,
  isPending: boolean,
): TxPhase {
  if (writeError || receiptError) return "error";
  if (isSuccess) return "success";
  if (isConfirming) return "confirming";
  if (isPending) return "signing";
  return "idle";
}

export function useVaultAction(vaultManager?: Address) {
  const configured = Boolean(vaultManager);
  const { writeContract, data: hash, error: writeError, isPending, reset } =
    useWriteContract();
  const {
    isLoading: isConfirming,
    isSuccess,
    error: receiptError,
  } = useWaitForTransactionReceipt({ hash, chainId: COSTON2_CHAIN_ID });

  const phase = useMemo(
    () => phaseOf(writeError, receiptError, isSuccess, isConfirming, isPending),
    [writeError, receiptError, isSuccess, isConfirming, isPending],
  );

  function execute(functionName: WriteFn, args: readonly unknown[]) {
    if (!vaultManager) return;
    writeContract({
      address: vaultManager,
      abi: vaultManagerAbi,
      functionName,
      args,
      chainId: COSTON2_CHAIN_ID,
    } as unknown as WriteConfig);
  }

  return {
    execute,
    phase,
    hash,
    error: writeError ?? receiptError ?? null,
    reset,
    configured,
    isBusy: phase === "signing" || phase === "confirming",
  };
}

/** Read allowance and approve an ERC-20 spender (collateral deposits). */
export function useTokenApproval(
  token?: Address,
  spender?: Address,
  owner?: Address,
) {
  const enabled = Boolean(token && spender && owner);
  const allowanceQuery = useReadContract({
    address: token,
    abi: erc20Abi,
    functionName: "allowance",
    args: owner && spender ? [owner, spender] : undefined,
    chainId: COSTON2_CHAIN_ID,
    query: { enabled },
  });

  const { writeContract, data: hash, error, isPending } = useWriteContract();
  const { isLoading: confirming, isSuccess } = useWaitForTransactionReceipt({
    hash,
    chainId: COSTON2_CHAIN_ID,
  });

  function approve(amount: bigint) {
    if (!token || !spender) return;
    writeContract({
      address: token,
      abi: erc20Abi,
      functionName: "approve",
      args: [spender, amount],
      chainId: COSTON2_CHAIN_ID,
    });
  }

  return {
    allowance: allowanceQuery.data as bigint | undefined,
    refetchAllowance: allowanceQuery.refetch,
    approve,
    isApproving: isPending || confirming,
    approved: isSuccess,
    error,
  };
}

/** Wrap native C2FLR → wFLR via WNat.deposit() (payable). */
export function useWrapNative(wnat?: Address) {
  const { writeContract, data: hash, error, isPending, reset } = useWriteContract();
  const {
    isLoading: confirming,
    isSuccess,
    error: receiptError,
  } = useWaitForTransactionReceipt({ hash, chainId: COSTON2_CHAIN_ID });

  const phase = phaseOf(error, receiptError, isSuccess, confirming, isPending);

  function wrap(amountWei: bigint) {
    if (!wnat) return;
    writeContract({
      address: wnat,
      abi: wnatAbi,
      functionName: "deposit",
      args: [],
      value: amountWei,
      chainId: COSTON2_CHAIN_ID,
    });
  }

  return {
    wrap,
    phase,
    hash,
    error: error ?? receiptError ?? null,
    reset,
    isBusy: phase === "signing" || phase === "confirming",
  };
}
