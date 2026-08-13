"use client";

// Dedicated XRPL-native borrow page — the FXRP market surface PINNED to the
// XRP Ledger rail. You supply XRP straight from the XRP Ledger (Crossmark /
// GemWallet) as collateral; it becomes FXRP on Flare via FAssets and backs vUSD
// you borrow cross-chain — a single XRPL payment, no Flare wallet or FLR gas.
//
// A thin wrapper: it mounts the SAME XrplMintFlow the unified market page
// (/borrow/fxrp) offers behind its rail toggle — connect / QR / paste-r-address
// paths included — plus the XRP-framed market aside and the vUSD send-out card.
// Deep links and the headline "borrow from your XRP wallet" story keep this
// route; the market page reaches the identical surface via the toggle.
import { useEffect } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { TokenIcon } from "@/components/ui";
import { Reveal } from "@/components/motion";
import { LivePrice } from "@/components/vault/LivePrice";
import { RedemptionsExplainer } from "@/components/vault/RedemptionsExplainer";
import { XrplMintFlow } from "@/components/xrpl/XrplMintFlow";
import { XrplSendVusd } from "@/components/xrpl/XrplSendVusd";
import { BRANCHES } from "@/config/branches";
import { useBranch } from "@/context/branch";
import { useXrplPathVault } from "@/hooks/useVault";

export default function BorrowXrpPage() {
  // XRPL-native collateral settles on the FXRP branch on Flare — the price feed
  // and redemption mechanics shown here are that branch's, framed as XRP.
  const branch = BRANCHES.fxrp;

  // Does the connected XRPL wallet's PersonalAccount already hold a vault?
  // Then this page is the MANAGE surface for that position — the header must
  // say so (mirroring the EVM branch page), or arriving via "Manage vault"
  // reads as "the XRP pool" instead of "my vault".
  const { hasVault } = useXrplPathVault(branch);

  // Sync the app-wide branch context to FXRP so the utility routes (/redeem,
  // /guardian, /liquidations) don't keep operating on a stale wFLR context after
  // the user came here from /borrow/wflr.
  const { setBranchKey } = useBranch();
  useEffect(() => {
    setBranchKey("fxrp");
  }, [setBranchKey]);

  return (
    <div className="flex flex-col gap-6">
      <Reveal>
        <div className="flex flex-col gap-3">
          <Link
            href="/borrow"
            className="inline-flex w-fit items-center gap-1.5 text-sm text-muted hover:text-ink"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden /> All collateral
          </Link>
          <div className="flex items-center gap-3">
            <TokenIcon symbol="XRP" size={40} alt="" />
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-ink">
                {hasVault ? "Your XRP vault" : "Borrow vUSD with your XRP"}
              </h1>
              <p className="mt-0.5 text-sm text-muted">
                {hasVault
                  ? "Manage collateral, debt, and interest — every action is one signed XRPL payment, no Flare wallet or FLR gas."
                  : "Supply XRP from the XRP Ledger as collateral — it becomes FXRP on Flare — and borrow vUSD cross-chain. One payment, no Flare wallet or FLR gas."}
              </p>
            </div>
          </div>
        </div>
      </Reveal>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex flex-col gap-6">
          <XrplMintFlow />
          <Reveal delay={0.1}>
            <XrplSendVusd />
          </Reveal>
        </div>

        <aside className="flex flex-col gap-4" aria-label="Market info">
          <Reveal delay={0.1}>
            <LivePrice branch={branch} />
          </Reveal>
          <Reveal delay={0.15}>
            <RedemptionsExplainer />
          </Reveal>
        </aside>
      </div>
    </div>
  );
}
