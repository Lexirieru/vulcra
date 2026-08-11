"use client";

// "Your vault is on the XRP path" bridge.
//
// A vault opened through the XRPL-native flow (/borrow/xrp) is owned by the
// user's Flare PersonalAccount (a Smart Account derived from their r-address),
// NOT their EVM wallet. So the EVM borrow page — which reads getVault(evmWallet)
// — shows an empty "open a vault" composer even though the user already has a
// vault. That mismatch reads as "my collateral/balance vanished".
//
// This banner closes the gap: on an XRPL-capable branch (FXRP), if the EVM
// wallet has no vault but the connected XRP wallet's PersonalAccount does, it
// surfaces that vault (read-only summary) and links to /borrow/xrp — the ONLY
// place its actions work, since managing it requires the 0xFE XRPL path, not an
// EVM writeContract from the wrong owner.
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Card, TokenIcon } from "@/components/ui";
import { useXrplWalletContext } from "@/context/xrpl";
import { usePersonalAccount } from "@/hooks/usePersonalAccount";
import { useVault } from "@/hooks/useVault";
import type { CollateralBranch } from "@/config/branches";
import { formatToken } from "@/lib/format";

export function XrplVaultBanner({ branch }: { branch: CollateralBranch }) {
  const { address: xrplAddress } = useXrplWalletContext();
  const account = usePersonalAccount(xrplAddress ?? "");
  const pa = account.data?.personalAccount as `0x${string}` | undefined;
  const { vault, hasVault } = useVault(pa, branch.vaultManager || undefined);

  // Only meaningful on a branch that has an XRPL-native path, and only when the
  // PersonalAccount actually holds a vault the EVM view can't see.
  if (!branch.hasXrplMint || !xrplAddress || !hasVault || !vault) return null;

  return (
    <Card className="flex flex-col gap-3 border-brand/20">
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
          <p className="font-medium text-ink">You already have a {branch.label} vault</p>
          <p className="mt-0.5 text-sm text-muted">
            Opened from the XRP path, so it lives under your Flare personal account —
            not this EVM wallet. Manage it there.
          </p>
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-3 border-t border-line pt-3 text-sm">
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
      </dl>

      <Link
        href="/borrow/xrp"
        className="inline-flex w-fit items-center gap-1.5 text-sm font-medium text-brand hover:underline"
      >
        Manage on the XRP path
        <ArrowRight className="h-4 w-4" aria-hidden />
      </Link>
    </Card>
  );
}
