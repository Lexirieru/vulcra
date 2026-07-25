"use client";

// Live XRP balance of a connected XRPL wallet, read straight from an XRPL
// testnet node: `account_info` → `account_data.Balance`, denominated in drops
// (1 XRP = 1e6 drops). No backend, no indexer, no mock.
//
// Endpoint choice matters in the browser. The canonical
// https://s.altnet.rippletest.net:51234 JSON-RPC returns NO CORS headers
// (verified: no `access-control-allow-origin` on either POST or preflight), so a
// fetch from the dApp origin is blocked before the response is readable.
// https://testnet.xrpl-labs.com is the public XRPL Labs testnet node — same
// ledger (server_info → network_id 1) and it answers with
// `access-control-allow-origin: *`. Point NEXT_PUBLIC_XRPL_RPC_URL at your own
// CORS-enabled node to override.
import { useQuery } from "@tanstack/react-query";
import { isValidRAddress } from "./usePersonalAccount";

export const XRPL_RPC_URL =
  process.env.NEXT_PUBLIC_XRPL_RPC_URL?.trim() || "https://testnet.xrpl-labs.com/";

/** 1 XRP = 1e6 drops. */
export const XRP_DECIMALS = 6;

const POLL_MS = 30_000;

export interface XrpAccountBalance {
  /** Balance in drops. `0n` when the account exists on no validated ledger. */
  drops: bigint;
  /** False when the address has never been funded (no AccountRoot yet). */
  funded: boolean;
}

interface AccountInfoResponse {
  result?: {
    error?: string;
    error_message?: string;
    account_data?: { Balance?: string };
  };
}

async function fetchXrpBalance(
  account: string,
  signal?: AbortSignal,
): Promise<XrpAccountBalance> {
  const res = await fetch(XRPL_RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      method: "account_info",
      params: [{ account, ledger_index: "validated" }],
    }),
    signal,
  });
  if (!res.ok) throw new Error(`XRPL node returned ${res.status}`);

  const { result } = (await res.json()) as AccountInfoResponse;

  // A wallet that has never received XRP has no ledger entry. That is a real,
  // displayable state (0 XRP, "not funded yet") — not a failure.
  if (result?.error === "actNotFound") return { drops: 0n, funded: false };
  if (result?.error) throw new Error(result.error_message || result.error);

  const balance = result?.account_data?.Balance;
  if (typeof balance !== "string") {
    throw new Error("Unexpected account_info response from the XRPL node");
  }
  return { drops: BigInt(balance), funded: true };
}

/**
 * XRP balance for an r-address on XRPL testnet. Disabled until the address is a
 * syntactically valid classic address, so a half-typed address never hits the node.
 */
export function useXrpBalance(address?: string) {
  const enabled = Boolean(address && isValidRAddress(address));
  return useQuery({
    queryKey: ["xrp-balance", XRPL_RPC_URL, address],
    queryFn: ({ signal }) => fetchXrpBalance(address!.trim(), signal),
    enabled,
    staleTime: 15_000,
    refetchInterval: POLL_MS,
    retry: 1,
  });
}
