"use client";

import { Badge, Card, CardTitle, Stat } from "@/components/ui";
import { CrGauge } from "./CrGauge";
import type { VaultParams, VaultState } from "@/hooks/useVault";
import {
  annualInterest18,
  collateralValueUsd18,
  computeCrBps,
  healthBand,
  liquidationPrice18,
} from "@/lib/vault-math";
import { formatBps, formatPrice, formatToken, formatUsd } from "@/lib/format";

export function PositionCard({
  vault,
  price18,
  params,
  collDec,
  collateralSymbol,
  feedLabel,
  rateBps,
  redeemableBefore18,
}: {
  vault: VaultState;
  price18?: bigint;
  params: VaultParams;
  collDec: number;
  collateralSymbol: string;
  feedLabel: string;
  rateBps?: bigint;
  redeemableBefore18?: bigint;
}) {
  const crBps = price18
    ? computeCrBps(vault.collateral, collDec, vault.debt18, price18)
    : null;
  const band = healthBand(crBps, params.mcrBps);
  const liqPrice = liquidationPrice18(vault.collateral, collDec, vault.debt18, params.mcrBps);
  const annualCost =
    rateBps !== undefined ? annualInterest18(vault.debt18, rateBps) : undefined;

  const riskLabel = band === "danger" ? "High risk" : band === "warning" ? "Watch" : "Healthy";

  return (
    <Card className="p-6">
      <div className="flex items-center justify-between">
        <CardTitle>Your vault</CardTitle>
        <Badge tone={band === "danger" ? "danger" : band === "warning" ? "warning" : "green"}>
          {riskLabel}
        </Badge>
      </div>
      <div className="mt-4 grid gap-6 sm:grid-cols-[1fr_1.2fr] sm:items-center">
        <CrGauge crBps={crBps} mcrBps={params.mcrBps} />
        <div className="grid grid-cols-2 gap-5">
          <Stat
            label="Collateral"
            value={formatToken(vault.collateral, collDec, 2)}
            sub={collateralSymbol}
          />
          <Stat
            label="Debt (incl. interest)"
            value={formatToken(vault.debt18, 18, 2)}
            sub="vUSD · live"
          />
          <Stat
            label="Liquidation price"
            value={formatPrice(liqPrice ?? undefined)}
            sub={feedLabel}
            tone={band === "danger" ? "danger" : undefined}
          />
          <Stat
            label="Interest rate"
            value={rateBps !== undefined ? `${formatBps(Number(rateBps))}` : "—"}
            sub={
              annualCost !== undefined
                ? `≈ ${formatToken(annualCost, 18, 2)} vUSD/yr`
                : "per year"
            }
          />
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-surface-2/60 px-4 py-3 text-sm">
        <span className="text-muted">
          Collateral value:{" "}
          <span className="font-medium tabular-nums text-ink">
            {price18
              ? formatUsd(collateralValueUsd18(vault.collateral, collDec, price18))
              : "—"}
          </span>
        </span>
        <span className="text-muted">
          Redeemable before you:{" "}
          <span className="font-medium tabular-nums text-ink">
            {redeemableBefore18 !== undefined
              ? `${formatToken(redeemableBefore18, 18, 0)} vUSD`
              : "—"}
          </span>{" "}
          <span className="text-muted/70">(lower-rate debt, redeemed first)</span>
        </span>
      </div>
    </Card>
  );
}
