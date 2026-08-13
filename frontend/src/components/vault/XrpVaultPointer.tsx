"use client";

// Cross-market pointer: "your XRP vault lives on the XRP market".
//
// XRP and FXRP are presented as SEPARATE markets distinguished by supply
// chain — XRP (XRP Ledger, /borrow/xrp) vs FXRP (Flare, /borrow/fxrp) — even
// though both settle on the same FXRP VaultManager on-chain. A vault opened
// from the XRP Ledger is owned by the user's Flare PersonalAccount, so the
// FXRP page's getVault(evmWallet) read can never see it; without this card the
// FXRP page would show an empty composer and invite a duplicate vault.
//
// This card names that position correctly — an XRP vault, on the XRP Ledger —
// shows its live figures, and points to /borrow/xrp, the ONLY place it can be
// managed (every action is one signed XRPL 0xFE payment). It never merges the
// two markets onto one page.
import { ArrowRight } from "lucide-react";
import { Badge, Card, ChainMarks, PillButton, TokenIcon } from "@/components/ui";
import { useXrplPathVault, useVaultParams } from "@/hooks/useVault";
import { useFtsoPrice } from "@/hooks/useFtsoPrice";
import type { CollateralBranch } from "@/config/branches";
import { computeCrBps, healthBand } from "@/lib/vault-math";
import { formatBps, formatToken, shortenAddress } from "@/lib/format";

export function XrpVaultPointer({ branch }: { branch: CollateralBranch }) {
  const { pa, vault, hasVault } = useXrplPathVault(branch);
  const { price18 } = useFtsoPrice(branch.feedId);
  const { params } = useVaultParams(branch.vaultManager || undefined);

  if (!hasVault || !vault) return null;

  const crBps = price18
    ? computeCrBps(vault.collateral, branch.collateralDecimals, vault.debt18, price18)
    : null;
  const band = healthBand(crBps, params.mcrBps);
  const riskLabel =
    band === "danger" ? "High risk" : band === "warning" ? "Watch" : "Healthy";

  return (
    <Card className="flex flex-col gap-4 border-brand/20">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <TokenIcon symbol="XRP" size={32} alt="" />
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-2 font-medium text-ink">
              You also have an XRP vault
              <ChainMarks chains={["xrpl"]} />
            </p>
            <p className="mt-0.5 text-sm text-muted">
              A separate position on the XRP market — owned by your Flare personal
              account
              {pa ? (
                <>
                  {" "}
                  <span className="font-mono">{shortenAddress(pa)}</span>
                </>
              ) : null}{" "}
              (derived from your r-address) and managed with one signed XRPL
              payment per action.
            </p>
          </div>
        </div>
        <Badge tone={band === "danger" ? "danger" : band === "warning" ? "warning" : "green"}>
          {riskLabel}
        </Badge>
      </div>

      <dl className="grid grid-cols-2 gap-3 border-t border-line pt-3 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-xs text-muted">Collateral</dt>
          <dd className="tabular-nums text-ink">
            {formatToken(vault.collateral, branch.collateralDecimals, 4)} XRP
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Debt (incl. interest)</dt>
          <dd className="tabular-nums text-ink">{formatToken(vault.debt18, 18, 2)} vUSD</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Collateral ratio</dt>
          <dd className="tabular-nums text-ink">
            {crBps === null ? "—" : formatBps(crBps)}
          </dd>
        </div>
      </dl>

      <PillButton href="/borrow/xrp" size="md" className="w-fit">
        Manage XRP vault
        <ArrowRight className="h-4 w-4" aria-hidden />
      </PillButton>
    </Card>
  );
}
