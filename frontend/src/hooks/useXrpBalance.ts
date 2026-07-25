"use client";

// Live XRP balance of a connected XRPL wallet, read straight from an XRPL
// testnet node. No backend, no indexer, no mock.
//
// SPENDABLE, not total. `account_data.Balance` is the whole AccountRoot balance,
// but the XRPL locks part of it as the account reserve — which is exactly why
// the drawer used to read "100 XRP" while Crossmark read "99". The wallet-facing
// number is:
//
//     spendable = Balance − (reserve_base + OwnerCount × reserve_inc)
//
// `OwnerCount` comes from `account_info`; the two reserve constants come from
// `server_state.validated_ledger` (they're network parameters that can change by
// amendment, so they are read, never hardcoded — on this testnet they are
// currently 1 XRP base + 0.2 XRP per owned object).
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

const BALANCE_POLL_MS = 30_000;
// Reserve parameters change only by amendment — poll them rarely.
const RESERVE_STALE_MS = 10 * 60_000;

async function rpc<T>(body: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(XRPL_RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) throw new Error(`XRPL node returned ${res.status}`);
  return (await res.json()) as T;
}

// ── Network reserve parameters ───────────────────────────────────────────────

export interface XrplReserves {
  /** Base reserve every funded account locks, in drops. */
  baseDrops: bigint;
  /** Additional reserve per owned ledger object, in drops. */
  incDrops: bigint;
}

interface ServerStateResponse {
  result?: {
    error?: string;
    error_message?: string;
    state?: {
      validated_ledger?: { reserve_base?: number; reserve_inc?: number };
    };
  };
}

async function fetchReserves(signal?: AbortSignal): Promise<XrplReserves> {
  const { result } = await rpc<ServerStateResponse>({ method: "server_state" }, signal);
  if (result?.error) throw new Error(result.error_message || result.error);
  const ledger = result?.state?.validated_ledger;
  if (
    typeof ledger?.reserve_base !== "number" ||
    typeof ledger?.reserve_inc !== "number"
  ) {
    throw new Error("XRPL node did not report validated-ledger reserves");
  }
  return {
    baseDrops: BigInt(Math.round(ledger.reserve_base)),
    incDrops: BigInt(Math.round(ledger.reserve_inc)),
  };
}

/** The network's current reserve parameters (shared/deduped across components). */
export function useXrplReserves() {
  return useQuery({
    queryKey: ["xrpl-reserves", XRPL_RPC_URL],
    queryFn: ({ signal }) => fetchReserves(signal),
    staleTime: RESERVE_STALE_MS,
    gcTime: 2 * RESERVE_STALE_MS,
    retry: 1,
  });
}

// ── Account balance ──────────────────────────────────────────────────────────

interface AccountSnapshot {
  /** Whole AccountRoot balance, in drops. */
  totalDrops: bigint;
  /** Ledger objects the account owns — each costs `reserve_inc`. */
  ownerCount: number;
  /** False when the address has never been funded (no AccountRoot yet). */
  funded: boolean;
}

interface AccountInfoResponse {
  result?: {
    error?: string;
    error_message?: string;
    account_data?: { Balance?: string; OwnerCount?: number };
  };
}

async function fetchAccount(
  account: string,
  signal?: AbortSignal,
): Promise<AccountSnapshot> {
  const { result } = await rpc<AccountInfoResponse>(
    { method: "account_info", params: [{ account, ledger_index: "validated" }] },
    signal,
  );

  // A wallet that has never received XRP has no ledger entry. That is a real,
  // displayable state (0 XRP, "not funded yet") — not a failure.
  if (result?.error === "actNotFound") {
    return { totalDrops: 0n, ownerCount: 0, funded: false };
  }
  if (result?.error) throw new Error(result.error_message || result.error);

  const balance = result?.account_data?.Balance;
  if (typeof balance !== "string") {
    throw new Error("Unexpected account_info response from the XRPL node");
  }
  return {
    totalDrops: BigInt(balance),
    ownerCount: result?.account_data?.OwnerCount ?? 0,
    funded: true,
  };
}

export interface XrpAccountBalance {
  /** Whole AccountRoot balance, in drops. */
  totalDrops: bigint;
  /** Locked by the network: base + ownerCount × inc, in drops. */
  reserveDrops: bigint;
  /** What the wallet calls the balance — total minus reserve, floored at 0. */
  spendableDrops: bigint;
  ownerCount: number;
  funded: boolean;
}

/**
 * Spendable XRP for an r-address on XRPL testnet — the same number the wallet
 * shows. Disabled until the address is a syntactically valid classic address,
 * so a half-typed address never hits the node.
 *
 * `data` stays undefined until BOTH the balance and the reserve parameters have
 * resolved: showing the raw total while the reserve is still in flight would be
 * showing an unspendable number as if it were spendable.
 */
export function useXrpBalance(address?: string) {
  const enabled = Boolean(address && isValidRAddress(address));

  const account = useQuery({
    queryKey: ["xrp-account", XRPL_RPC_URL, address],
    queryFn: ({ signal }) => fetchAccount(address!.trim(), signal),
    enabled,
    staleTime: 15_000,
    refetchInterval: BALANCE_POLL_MS,
    retry: 1,
  });

  const reserves = useXrplReserves();

  const data: XrpAccountBalance | undefined =
    account.data && reserves.data
      ? (() => {
          const { totalDrops, ownerCount, funded } = account.data;
          const reserveDrops = funded
            ? reserves.data.baseDrops + BigInt(ownerCount) * reserves.data.incDrops
            : 0n;
          const spendableDrops =
            totalDrops > reserveDrops ? totalDrops - reserveDrops : 0n;
          return { totalDrops, reserveDrops, spendableDrops, ownerCount, funded };
        })()
      : undefined;

  return {
    data,
    isLoading: enabled && (account.isLoading || reserves.isLoading),
    isError: account.isError || reserves.isError,
    refetch: () => {
      void account.refetch();
      void reserves.refetch();
    },
  };
}
