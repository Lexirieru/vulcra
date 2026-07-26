"use client";

// Dedicated XRPL-native borrow page. You supply XRP straight from the XRP Ledger
// (Crossmark / GemWallet) as collateral; it becomes FXRP on Flare via FAssets and
// backs vUSD you borrow cross-chain — a single XRPL payment, no Flare wallet or
// FLR gas.
//
// This is intentionally SEPARATE from /borrow/fxrp (the Flare-wallet FXRP
// composer): different source asset (XRP vs FXRP), different chain (XRP Ledger
// vs Flare), different wallet. Same visual layout, its own route — the two paths
// are never merged onto one page.
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { TokenIcon } from "@/components/ui";
import { Reveal } from "@/components/motion";
import { LivePrice } from "@/components/vault/LivePrice";
import { RedemptionsExplainer } from "@/components/vault/RedemptionsExplainer";
import { XrplMintFlow } from "@/components/xrpl/XrplMintFlow";
import { BRANCHES } from "@/config/branches";

export default function BorrowXrpPage() {
  // XRPL-native collateral settles on the FXRP branch on Flare — the price feed
  // and redemption mechanics shown here are that branch's, framed as XRP.
  const branch = BRANCHES.fxrp;

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
                Borrow vUSD with your XRP
              </h1>
              <p className="mt-0.5 text-sm text-muted">
                Supply XRP from the XRP Ledger as collateral — it becomes FXRP on
                Flare — and borrow vUSD cross-chain. One payment, no Flare wallet
                or FLR gas.
              </p>
            </div>
          </div>
        </div>
      </Reveal>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex flex-col gap-6">
          <XrplMintFlow />
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
