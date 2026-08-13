"use client";

// "Your vault lives on the XRP path" — a first-class POSITION card, not a
// warning banner.
//
// A vault opened through the XRPL-native flow (/borrow/xrp) is owned by the
// user's Flare PersonalAccount (a Smart Account derived from their r-address),
// NOT their EVM wallet. So the EVM borrow page — which reads getVault(evmWallet)
// — would show an empty "open a vault" composer even though the user already
// has a live position. That mismatch reads as "my collateral/balance vanished",
// and worse, the composer invites opening a SECOND vault by accident.
//
// This card closes the gap: on an XRPL-capable branch (FXRP), if the connected
// XRP wallet's PersonalAccount holds a vault, surface it as THE position on
// this market — owner, collateral, debt, health — with a primary "Manage vault"
// CTA into /borrow/xrp, the ONLY place its actions work (each one is a signed
// XRPL 0xFE payment, not an EVM writeContract from the wrong owner). It renders
// whether or not an EVM wallet is also connected: the position exists either
// way, and hiding it from an XRPL-only visitor would re-open the same trap.
import { ArrowRight } from "lucide-react";
import { Badge, Card, PillButton, TokenIcon } from "@/components/ui";
import { useXrplPathVault, useVaultParams } from "@/hooks/useVault";
import { useFtsoPrice } from "@/hooks/useFtsoPrice";
import type { CollateralBranch } from "@/config/branches";
import { computeCrBps, healthBand } from "@/lib/vault-math";
import { formatBps, formatToken, shortenAddress } from "@/lib/format";

export function XrplVaultBanner({ branch }: { branch: CollateralBranch }) {
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
          <span className="flex shrink-0 items-center">
            <TokenIcon symbol="vUSD" size={32} alt="" />
            <TokenIcon
              symbol={branch.collateralSymbol}
              size={32}
              alt=""
              className="-ml-2 ring-2 ring-surface"
            />
          </span>
          <div className="min-w-0">
            <p className="font-medium text-ink">
              Your {branch.label} vault{" "}
              <span className="font-normal text-muted">(opened from the XRP Ledger)</span>
            </p>
            <p className="mt-0.5 text-sm text-muted">
              This is your position on this market. It is owned by your Flare
              personal account
              {pa ? (
                <>
                  {" "}
                  <span className="font-mono">{shortenAddress(pa)}</span>
                </>
              ) : null}{" "}
              — derived from your r-address — so every action is one signed XRPL
              payment.
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
            {formatToken(vault.collateral, branch.collateralDecimals, 4)}{" "}
            {branch.collateralSymbol}
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
        Manage vault
        <ArrowRight className="h-4 w-4" aria-hidden />
      </PillButton>
    </Card>
  );
}
