"use client";

// Shared write-transaction lifecycle for every Vulcra action (U7 / KTD8):
// open / adjust / repay / close / liquidate / redeem / delegatedRepay all flow
// through one hook so the pending → confirming → success/error UX is identical.
import { useMemo } from "react";
import {
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import { COSTON2_CHAIN_ID } from "@/config/contracts";
import { vaultManagerAbi } from "@/lib/contracts/abis";
import { useVaultManagerAddress } from "./useVault";

export type TxPhase = "idle" | "signing" | "confirming" | "success" | "error";

type WriteFn = (typeof vaultManagerAbi)[number] extends { type: "function"; name: infer N }
  ? N
  : never;

type WriteConfig = Parameters<
  ReturnType<typeof useWriteContract>["writeContract"]
>[0];

export function useVaultAction() {
  const { address, configured } = useVaultManagerAddress();
  const { writeContract, data: hash, error: writeError, isPending, reset } =
    useWriteContract();
  const {
    isLoading: isConfirming,
    isSuccess,
    error: receiptError,
  } = useWaitForTransactionReceipt({ hash, chainId: COSTON2_CHAIN_ID });

  const phase: TxPhase = useMemo(() => {
    if (writeError || receiptError) return "error";
    if (isSuccess) return "success";
    if (isConfirming) return "confirming";
    if (isPending) return "signing";
    return "idle";
  }, [writeError, receiptError, isSuccess, isConfirming, isPending]);

  function execute(functionName: WriteFn, args: readonly unknown[]) {
    if (!address) return;
    writeContract({
      address,
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
