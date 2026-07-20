"use client";

import { Card, CardTitle, Stat } from "@/components/ui";
import { CrGauge } from "./CrGauge";
import type { VaultState } from "@/hooks/useVault";
import type { VaultParams } from "@/hooks/useVault";
import {
  computeCrBps,
  healthBand,
  liquidationPrice18,
} from "@/lib/vault-math";
import { formatPrice, formatToken, formatUsd } from "@/lib/format";

export function PositionCard({
  vault,
  price18,
  params,
}: {
  vault: VaultState;
  price18?: bigint;
  params: VaultParams;
}) {
  const crBps = price18 ? computeCrBps(vault.collateral6, vault.debt18, price18) : null;
  const band = healthBand(crBps, params.mcrBps);
  const liqPrice = liquidationPrice18(vault.collateral6, vault.debt18, params.mcrBps);

  return (
    <Card>
      <CardTitle>Your vault</CardTitle>
      <div className="mt-4 grid gap-6 sm:grid-cols-[1fr_1.2fr] sm:items-center">
        <CrGauge crBps={crBps} mcrBps={params.mcrBps} />
        <div className="grid grid-cols-2 gap-5">
          <Stat
            label="Collateral"
            value={formatToken(vault.collateral6, 6, 2)}
            sub="FXRP"
          />
          <Stat label="Debt" value={formatToken(vault.debt18, 18, 2)} sub="vUSD" />
          <Stat
            label="Liquidation price"
            value={formatPrice(liqPrice ?? undefined)}
            sub="XRP/USD"
            tone={band === "danger" ? "danger" : undefined}
          />
          <Stat
            label="Collateral value"
            value={price18 ? formatUsd((vault.collateral6 * price18) / 1_000_000n) : "—"}
            sub="at live price"
          />
        </div>
      </div>
    </Card>
  );
}
