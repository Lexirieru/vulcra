"use client";

// Liquidations (U11 / R19), per selected collateral branch. At-risk vaults from
// the backend indexer (scoped to the branch), riskiest first, with one-click
// liquidation through the shared tx lifecycle. liquidate() re-checks CR on-chain.
import { useQuery } from "@tanstack/react-query";
import type { Address } from "viem";
import { Badge, Card, CardTitle, EmptyState, ErrorState, Skeleton } from "@/components/ui";
import { Reveal } from "@/components/motion";
import { LiquidateButton } from "@/components/liquidations/LiquidateButton";
import { ContractsNotice } from "@/components/vault/ContractsNotice";
import { api } from "@/lib/api/client";
import { useVaultParams } from "@/hooks/useVault";
import { useBranch } from "@/context/branch";
import { formatCr, formatToken, shortenAddress } from "@/lib/format";

export default function LiquidationsPage() {
  const { branch } = useBranch();
  const vaultManager = branch.vaultManager || undefined;
  const { params } = useVaultParams(vaultManager);
  const mcrBps = Number(params.mcrBps);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["at-risk-vaults", branch.key],
    queryFn: () => api.listAtRiskVaults(Math.round(mcrBps * 1.2), branch.key),
    retry: 1,
    refetchInterval: 15_000,
  });

  const rows = (data ?? []).slice().sort((a, b) => a.crBps - b.crBps);

  return (
    <div className="flex flex-col gap-6">
      <Reveal>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {branch.label} liquidations
          </h1>
          <p className="mt-1 text-sm text-muted">
            {branch.label} vaults below the {formatCr(params.mcrBps)} minimum collateral
            ratio can be liquidated for the debt plus a bonus. Riskiest first.
          </p>
        </div>
      </Reveal>

      {!branch.vaultManager && (
        <Reveal>
          <ContractsNotice branch={branch} />
        </Reveal>
      )}

      <Reveal delay={0.05}>
        <Card>
          <CardTitle>At-risk vaults</CardTitle>
          <div className="mt-4">
            {isLoading ? (
              <div className="flex flex-col gap-2">
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-14 w-full" />
                ))}
              </div>
            ) : isError ? (
              <ErrorState
                title="Couldn't load at-risk vaults"
                description="The indexer/backend is unavailable. Retry once it's running."
                onRetry={() => refetch()}
              />
            ) : rows.length === 0 ? (
              <EmptyState
                title="No at-risk vaults"
                description="Every vault is currently above the minimum collateral ratio."
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs uppercase text-muted">
                      <th className="py-2 pr-4 font-medium">Owner</th>
                      <th className="py-2 pr-4 font-medium">Collateral</th>
                      <th className="py-2 pr-4 font-medium">Debt</th>
                      <th className="py-2 pr-4 font-medium">CR</th>
                      <th className="py-2 pr-4 font-medium sr-only">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((v) => {
                      const liquidatable = v.crBps < mcrBps;
                      return (
                        <tr key={v.owner} className="border-b border-border/60">
                          <td className="py-3 pr-4 font-mono">{shortenAddress(v.owner)}</td>
                          <td className="py-3 pr-4 font-mono tabular-nums">
                            {formatToken(BigInt(v.collateral6), branch.collateralDecimals, 2)}{" "}
                            {branch.collateralSymbol}
                          </td>
                          <td className="py-3 pr-4 font-mono tabular-nums">
                            {formatToken(BigInt(v.debt18), 18, 2)}
                          </td>
                          <td className="py-3 pr-4">
                            <Badge tone={liquidatable ? "danger" : "warning"}>
                              {formatCr(BigInt(v.crBps))}
                            </Badge>
                          </td>
                          <td className="py-3 pr-4 text-right">
                            <LiquidateButton
                              owner={v.owner as Address}
                              vaultManager={vaultManager}
                              liquidatable={liquidatable}
                              onDone={() => refetch()}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </Card>
      </Reveal>
    </div>
  );
}
