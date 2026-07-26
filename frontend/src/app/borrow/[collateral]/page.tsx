"use client";

// Per-collateral borrow page — the FLARE-WALLET path. You deposit a collateral
// token you already hold on Flare (FXRP or WC2FLR) and borrow vUSD.
//
// The XRPL-native path (supply XRP straight from the XRP Ledger) lives on its
// OWN page, /borrow/xrp, deliberately SEPARATE: different source asset (XRP vs
// FXRP), different chain (XRP Ledger vs Flare), different wallet. It is NOT a
// mode of this page.
//
// The collateral selector is LOCAL STATE (`activeKey`), seeded once from the
// [collateral] URL segment. Switching collateral is a setState: no <Link>, no
// router.push, no segment change, so the App Router never remounts the subtree
// and the page genuinely stays put. The URL is the ENTRY POINT, not a mirror of
// in-page state.
import { Suspense, use, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { useAccount } from "wagmi";
import { ArrowLeft } from "lucide-react";
import { Card, Skeleton, TokenIcon } from "@/components/ui";
import { Reveal } from "@/components/motion";
import { BorrowComposer } from "@/components/vault/BorrowComposer";
import { ContractsNotice } from "@/components/vault/ContractsNotice";
import { LivePrice } from "@/components/vault/LivePrice";
import { PositionCard } from "@/components/vault/PositionCard";
import { PriceSimulator } from "@/components/vault/PriceSimulator";
import { RedemptionsExplainer } from "@/components/vault/RedemptionsExplainer";
import { VaultActions } from "@/components/vault/VaultActions";
import { BRANCHES, isBranchKey, type BranchKey } from "@/config/branches";
import { useBranch } from "@/context/branch";
import { useFtsoPrice } from "@/hooks/useFtsoPrice";
import { useCollateralToken, useVault, useVaultParams } from "@/hooks/useVault";
import { useVaultRate, useRedeemableBefore } from "@/hooks/useInterest";
import {
  DUR,
  EASE,
  gsap,
  prefersReducedMotion,
  useIsomorphicLayoutEffect,
} from "@/lib/gsap";

export default function BorrowCollateralPage({
  params,
}: {
  params: Promise<{ collateral: string }>;
}) {
  const { collateral } = use(params);
  if (!isBranchKey(collateral)) notFound();
  return (
    // Suspense boundary for `use(params)`. No `key`: the collateral is state
    // now, not identity, so the subtree must not remount when it changes.
    <Suspense
      fallback={
        <Card>
          <Skeleton className="h-64 w-full" />
        </Card>
      }
    >
      <BranchBorrow urlKey={collateral} />
    </Suspense>
  );
}

function BranchBorrow({ urlKey }: { urlKey: BranchKey }) {
  const { branchKey, setBranchKey } = useBranch();
  const { address, isConnected } = useAccount();

  // The selected collateral. Local, seeded once from the URL — switching it is
  // a plain setState, no navigation.
  const [activeKey, setActiveKey] = useState<BranchKey>(urlKey);
  const branch = BRANCHES[activeKey];

  // Keep the shared branch context in step for OTHER consumers (wallet drawer,
  // /redeem · /guardian · /liquidations). Nothing on this page waits.
  useEffect(() => {
    if (branchKey !== activeKey) setBranchKey(activeKey);
  }, [branchKey, activeKey, setBranchKey]);

  const vaultManager = branch.vaultManager || undefined;
  const { price18 } = useFtsoPrice(branch.feedId);
  const { params } = useVaultParams(vaultManager);
  const { vault, hasVault, notConfigured, isLoading } = useVault(address, vaultManager);
  const { address: collateralToken } = useCollateralToken(branch);
  const { rateBps } = useVaultRate(address, vaultManager);
  const { data: redeemableBefore } = useRedeemableBefore(address, vaultManager, hasVault);

  // Subtle GSAP crossfade over the two regions whose content changes when the
  // collateral is switched. The page no longer remounts, so a plain ref
  // comparison tells a switch from the first render. Reduced-motion gated.
  const headerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const shownKey = useRef(activeKey);
  useIsomorphicLayoutEffect(() => {
    if (shownKey.current === activeKey) return;
    shownKey.current = activeKey;
    if (prefersReducedMotion()) return;
    const targets = [headerRef.current, panelRef.current].filter(Boolean);
    if (!targets.length) return;
    gsap.killTweensOf(targets);
    gsap.fromTo(
      targets,
      { opacity: 0.35, y: 6 },
      {
        opacity: 1,
        y: 0,
        duration: DUR.fast,
        ease: EASE.out,
        clearProps: "opacity,transform",
      },
    );
    return () => {
      gsap.killTweensOf(targets);
    };
  }, [activeKey]);

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
          <div ref={headerRef} className="flex items-center gap-3">
            <TokenIcon symbol={branch.collateralSymbol} size={40} alt="" />
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-ink">
                {hasVault
                  ? `Your ${branch.label} vault`
                  : `Borrow vUSD against ${branch.collateralSymbol}`}
              </h1>
              <p className="mt-0.5 text-sm text-muted">
                {hasVault
                  ? `Manage collateral, debt, and interest — live ${branch.feedLabel} pricing from FTSO.`
                  : `Deposit ${branch.collateralSymbol} you hold on Flare, borrow vUSD, and set your own interest rate.`}
              </p>
            </div>
          </div>
        </div>
      </Reveal>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div ref={panelRef} className="flex flex-col gap-6">
          {notConfigured ? (
            <ContractsNotice branch={branch} />
          ) : isConnected && isLoading ? (
            <Card>
              <Skeleton className="h-64 w-full" />
            </Card>
          ) : hasVault && vault ? (
            <>
              <Reveal>
                <PositionCard
                  vault={vault}
                  price18={price18}
                  params={params}
                  collDec={branch.collateralDecimals}
                  collateralSymbol={branch.collateralSymbol}
                  feedLabel={branch.feedLabel}
                  rateBps={rateBps}
                  redeemableBefore18={redeemableBefore?.debt18}
                />
              </Reveal>
              <div className="grid gap-6 xl:grid-cols-2">
                <Reveal delay={0.05}>
                  <VaultActions
                    vault={vault}
                    price18={price18}
                    params={params}
                    branch={branch}
                    collateralToken={collateralToken}
                    owner={address}
                    disabled={notConfigured}
                  />
                </Reveal>
                <Reveal delay={0.1}>
                  {price18 ? (
                    <PriceSimulator
                      vault={vault}
                      livePrice18={price18}
                      params={params}
                      collDec={branch.collateralDecimals}
                    />
                  ) : (
                    <Card className="flex items-center justify-center text-center text-sm text-muted">
                      Loading live price…
                    </Card>
                  )}
                </Reveal>
              </div>
            </>
          ) : (
            <Reveal>
              <BorrowComposer branch={branch} onSelectBranch={setActiveKey} />
            </Reveal>
          )}
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
