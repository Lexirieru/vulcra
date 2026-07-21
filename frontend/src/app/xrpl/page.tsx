"use client";

// Standalone XRPL-native mint page. The actual flow lives in
// components/xrpl/XrplMintFlow so the Borrow page (/borrow/fxrp) can surface the
// same real components as its "Pay from XRPL" mode. XRPL-native mint is
// FXRP-only (XRP → FXRP via the 0xFE custom instruction); other collateral
// branches use the EVM flow instead.
import { ShieldAlert } from "lucide-react";
import { Card, PillButton } from "@/components/ui";
import { Reveal } from "@/components/motion";
import { XrplMintFlow } from "@/components/xrpl/XrplMintFlow";
import { useBranch } from "@/context/branch";

export default function XrplPage() {
  const { branch } = useBranch();

  if (!branch.hasXrplMint) {
    return (
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">Mint from XRPL</h1>
          <p className="mt-1 text-sm text-muted">
            XRPL-native minting only applies to the FXRP branch (XRP → FXRP).
          </p>
        </div>
        <Card className="flex flex-col items-center gap-3 text-center">
          <ShieldAlert className="h-6 w-6 text-brand" aria-hidden />
          <p className="max-w-md text-sm text-muted">
            The <span className="font-medium text-ink">{branch.label}</span> branch has
            no XRPL rail. Wrap C2FLR into {branch.collateralSymbol} and open a vault from
            the Borrow page instead.
          </p>
          <PillButton href="/borrow/wflr" size="sm">
            Go to Borrow
          </PillButton>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <Reveal>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">Mint from XRPL</h1>
          <p className="mt-1 text-sm text-muted">
            No EVM wallet or FLR needed. Sign one XRPL Payment and receive vUSD to your
            Flare personal account.
          </p>
        </div>
      </Reveal>
      <XrplMintFlow />
    </div>
  );
}
