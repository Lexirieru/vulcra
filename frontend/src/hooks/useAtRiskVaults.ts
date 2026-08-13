"use client";

// At-risk vault discovery for the Liquidations page. Two interchangeable sources,
// both yielding the same AtRiskVault[] the UI renders:
//   • Goldsky subgraph (when the branch has one) — pull every vault lifecycle event,
//     fold to current state, and compute CR with the live FTSO price. Fully client-
//     side, no backend needed.
//   • Backend indexer (REST) — the original path; the fallback for branches without a
//     subgraph (e.g. wFLR today) or when NEXT_PUBLIC_GOLDSKY_SUBGRAPH_* is unset.
// Either way the on-chain liquidate() re-checks CR, so this is candidate discovery only.
import { useQuery } from "@tanstack/react-query";
import type { CollateralBranch } from "@/config/branches";
import type { AtRiskVault } from "@/lib/api/types";
import { api } from "@/lib/api/client";
import { subgraphUrl } from "@/graphql/subgraphs";
import { fetchVaultEvents, foldVaults, toAtRiskVaults } from "@/graphql/vaults";
import { useFtsoPrice } from "./useFtsoPrice";

export type AtRiskSource = "goldsky" | "backend";

export interface UseAtRiskVaults {
  data: AtRiskVault[] | undefined;
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
  source: AtRiskSource;
}

export function useAtRiskVaults(branch: CollateralBranch, crThresholdBps: number): UseAtRiskVaults {
  const url = subgraphUrl(branch.key);
  const useGoldsky = Boolean(url);
  const enabled = crThresholdBps > 0;

  // Goldsky needs the live collateral price to turn folded state into CRs.
  const { price18, isError: priceError } = useFtsoPrice(branch.feedId);

  const goldsky = useQuery({
    queryKey: ["at-risk", "goldsky", branch.key, crThresholdBps, price18?.toString() ?? ""],
    enabled: enabled && useGoldsky && price18 !== undefined,
    queryFn: async (): Promise<AtRiskVault[]> => {
      const events = await fetchVaultEvents(url);
      return toAtRiskVaults(foldVaults(events), branch.collateralDecimals, price18!, crThresholdBps);
    },
    retry: 1,
    refetchInterval: 15_000,
  });

  const rest = useQuery({
    queryKey: ["at-risk", "backend", branch.key, crThresholdBps],
    enabled: enabled && !useGoldsky,
    queryFn: () => api.listAtRiskVaults(crThresholdBps, branch.key),
    retry: 1,
    refetchInterval: 15_000,
  });

  if (useGoldsky) {
    // Surface loading while the FTSO price resolves (the query is gated on it), and
    // treat a price feed failure as an error rather than an endless spinner.
    const waitingForPrice = enabled && price18 === undefined && !priceError;
    return {
      data: goldsky.data,
      isLoading: goldsky.isLoading || waitingForPrice,
      isError: goldsky.isError || priceError,
      refetch: () => void goldsky.refetch(),
      source: "goldsky",
    };
  }

  return {
    data: rest.data,
    isLoading: rest.isLoading,
    isError: rest.isError,
    refetch: () => void rest.refetch(),
    source: "backend",
  };
}
