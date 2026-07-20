"use client";

import { Card, CardTitle, Stat } from "@/components/ui";
import { CrGauge } from "./CrGauge";
import type { VaultParams, VaultState } from "@/hooks/useVault";
import {
  collateralValueUsd18,
  computeCrBps,
  healthBand,
  liquidationPrice18,
} from "@/lib/vault-math";
import { formatPrice, formatToken, formatUsd } from "@/lib/format";

export function PositionCard({
  vault,
  price18,
  params,
  collDec,
  collateralSymbol,
  feedLabel,
}: {
  vault: VaultState;
  price18?: bigint;
  params: VaultParams;
  collDec: number;
  collateralSymbol: string;
  feedLabel: string;
}) {
  const crBps = price18
    ? computeCrBps(vault.collateral, collDec, vault.debt18, price18)
    : null;
  const band = healthBand(crBps, params.mcrBps);
  const liqPrice = liquidationPrice18(vault.collateral, collDec, vault.debt18, params.mcrBps);

  return (
    <Card>
      <CardTitle>Your vault</CardTitle>
      <div className="mt-4 grid gap-6 sm:grid-cols-[1fr_1.2fr] sm:items-center">
        <CrGauge crBps={crBps} mcrBps={params.mcrBps} />
        <div className="grid grid-cols-2 gap-5">
          <Stat
            label="Collateral"
            value={formatToken(vault.collateral, collDec, 2)}
            sub={collateralSymbol}
          />
          <Stat label="Debt" value={formatToken(vault.debt18, 18, 2)} sub="vUSD" />
          <Stat
            label="Liquidation price"
            value={formatPrice(liqPrice ?? undefined)}
            sub={feedLabel}
            tone={band === "danger" ? "danger" : undefined}
          />
          <Stat
            label="Collateral value"
            value={
              price18
                ? formatUsd(collateralValueUsd18(vault.collateral, collDec, price18))
                : "—"
            }
            sub="at live price"
          />
        </div>
      </div>
    </Card>
  );
}
