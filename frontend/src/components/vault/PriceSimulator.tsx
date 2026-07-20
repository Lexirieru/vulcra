"use client";

// What-if price simulator (U6 / KTD7). Pure client-side — scrubs a hypothetical
// XRP price through the SAME vault-math as the dashboard. No chain interaction.
import { useState } from "react";
import { Badge, Button, Card, CardTitle } from "@/components/ui";
import type { VaultParams, VaultState } from "@/hooks/useVault";
import { computeCrBps, healthBand } from "@/lib/vault-math";
import { formatCr, formatPrice } from "@/lib/format";

export function PriceSimulator({
  vault,
  livePrice18,
  params,
  collDec,
}: {
  vault: VaultState;
  livePrice18: bigint;
  params: VaultParams;
  collDec: number;
}) {
  const [pct, setPct] = useState(100); // % of live price

  const simPrice18 = (livePrice18 * BigInt(Math.round(pct * 100))) / 10_000n;
  const crBps = computeCrBps(vault.collateral, collDec, vault.debt18, simPrice18);
  const band = healthBand(crBps, params.mcrBps);
  const liquidatable = crBps !== null && crBps < params.mcrBps;

  return (
    <Card>
      <div className="flex items-center justify-between">
        <CardTitle>What-if simulator</CardTitle>
        <Badge tone="neutral">simulation only</Badge>
      </div>

      <div className="mt-4 flex items-baseline justify-between">
        <span className="font-mono text-2xl tabular-nums text-text">
          {formatPrice(simPrice18)}
        </span>
        <span
          className="font-mono text-lg tabular-nums"
          style={{
            color:
              band === "danger"
                ? "var(--color-danger)"
                : band === "warning"
                  ? "var(--color-warning)"
                  : "var(--color-healthy)",
          }}
        >
          CR {formatCr(crBps)}
        </span>
      </div>

      <label htmlFor="sim-price" className="sr-only">
        Hypothetical XRP price, percent of live
      </label>
      <input
        id="sim-price"
        type="range"
        min={25}
        max={200}
        step={1}
        value={pct}
        onChange={(e) => setPct(Number(e.target.value))}
        aria-valuetext={`${pct}% of live price`}
        className="mt-4 w-full accent-[var(--color-ember)]"
      />
      <div className="mt-1 flex justify-between text-xs text-faint">
        <span>−75%</span>
        <span>live</span>
        <span>+100%</span>
      </div>

      <p className="mt-3 text-sm">
        {liquidatable ? (
          <span className="text-danger">
            At this price your vault would be liquidatable (CR below MCR{" "}
            {formatCr(params.mcrBps)}).
          </span>
        ) : (
          <span className="text-muted">Vault stays above the liquidation threshold.</span>
        )}
      </p>

      {pct !== 100 && (
        <Button variant="ghost" size="sm" className="mt-2" onClick={() => setPct(100)}>
          Reset to live
        </Button>
      )}
    </Card>
  );
}
