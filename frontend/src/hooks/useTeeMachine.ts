"use client";

// Reads a Flare Confidential Compute (FCC) TEE machine's on-chain registration
// straight from the FlareTeeManager, so it reflects the Guardian's PRODUCTION
// status even when the enclave endpoint (proxy) or the shared indexer is down.
// Defaults to the Guardian's registered machine; pass teeId/manager to reuse it
// for any FCC extension.
import { useReadContracts } from "wagmi";
import type { Address } from "viem";
import {
  COSTON2_CHAIN_ID,
  GUARDIAN_TEE_ID,
  GUARDIAN_TEE_MANAGER_ADDRESS,
} from "@/config/contracts";
import { flareTeeManagerAbi } from "@/lib/contracts/abis";

type Machine = { teeId: Address; teeProxyId: Address; url: string };

export interface TeeMachineState {
  /** On-chain machine status. 2 = PRODUCTION on the FCC manager. */
  status?: number;
  isProduction: boolean;
  teeId: Address;
  teeProxyId?: Address;
  /** Registered public URL data providers call. `undefined` when not registered. */
  url?: string;
  /** FCC compute-extension id this machine belongs to. */
  extensionId?: bigint;
  manager: Address;
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
}

export function useTeeMachine(
  teeId: Address = GUARDIAN_TEE_ID,
  manager: Address = GUARDIAN_TEE_MANAGER_ADDRESS,
): TeeMachineState {
  const base = {
    address: manager,
    abi: flareTeeManagerAbi,
    chainId: COSTON2_CHAIN_ID,
  } as const;

  const { data, isLoading, isError, refetch } = useReadContracts({
    contracts: [
      { ...base, functionName: "getTeeMachineStatus", args: [teeId] },
      { ...base, functionName: "getTeeMachine", args: [teeId] },
      { ...base, functionName: "getExtensionId", args: [teeId] },
    ],
    // The manager reverts TeeNotFound for an unregistered id, so a "failure"
    // result is a legitimate "not registered" signal, not a transport error.
    query: { refetchInterval: 30_000 },
  });

  const status = data?.[0]?.status === "success" ? Number(data[0].result) : undefined;
  const machine = data?.[1]?.status === "success" ? (data[1].result as Machine) : undefined;
  const extensionId = data?.[2]?.status === "success" ? (data[2].result as bigint) : undefined;

  return {
    status,
    isProduction: status === 2,
    teeId,
    teeProxyId: machine?.teeProxyId,
    url: machine?.url,
    extensionId,
    manager,
    isLoading,
    isError,
    refetch: () => void refetch(),
  };
}
