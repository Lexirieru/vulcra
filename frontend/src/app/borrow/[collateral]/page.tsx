"use client";

// Per-collateral borrow page (Enosys borrow layout). The URL is the source of
// truth for the selected branch — each collateral keeps its own /borrow/<key>
// URL so it stays shareable — while switching collateral READS as one page:
//
//   • no `key` on this component (it used to force a remount on top of the
//     router's own, doubling the teardown);
//   • every read is driven off the URL's branch directly, so there is never a
//     frame where the branch context hasn't caught up and we render a Skeleton
//     — that gap was the visible "flash";
//   • the branch context is still synced for OTHER consumers (wallet drawer,
//     branch-scoped utility pages), it just never gates what we render;
//   • the App Router still remounts the subtree when the [collateral] segment
//     changes (see `lastRenderedKey`), so a switch is detected and the per-
//     section `Reveal` entrances are suppressed — the whole page no longer
//     replays its entrance choreography every time you change asset. One
//     subtle GSAP crossfade stands in for it, and the selector pill slides
//     from the old chip to the new one. Both reduced-motion gated.
//   • the composer's transient inputs (amounts, rate) reset on branch change.
//
// For the FXRP branch the page is ONE page with a rail toggle: Flare wallet ↔
// XRP Ledger. Flipping the toggle swaps the panel below it — it does not open a
// second flow with its own connect screen, because the XRPL connection is
// app-wide (XrplWalletProvider) and shared with the wallet drawer.
import { Suspense, use, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { notFound, useSearchParams } from "next/navigation";
import { useAccount } from "wagmi";
import { ArrowLeft } from "lucide-react";
import { Card, Skeleton, TokenIcon } from "@/components/ui";
import { Reveal } from "@/components/motion";
import { RailToggle, type Rail } from "@/components/borrow/RailToggle";
import { BorrowComposer } from "@/components/vault/BorrowComposer";
import { ContractsNotice } from "@/components/vault/ContractsNotice";
import { LivePrice } from "@/components/vault/LivePrice";
import { PositionCard } from "@/components/vault/PositionCard";
import { PriceSimulator } from "@/components/vault/PriceSimulator";
import { RedemptionsExplainer } from "@/components/vault/RedemptionsExplainer";
import { VaultActions } from "@/components/vault/VaultActions";
import { XrplMintFlow } from "@/components/xrpl/XrplMintFlow";
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

// The App Router serves /borrow/fxrp and /borrow/wflr as different values of the
// same dynamic segment, and it REMOUNTS the page subtree when that value changes
// (verified: <body>/<header>/<main> survive a switch, the page root does not).
// Removing the old `key` was necessary but can't undo that, so component state
// cannot tell "switched collateral" from "arrived fresh".
//
// This module-scoped memory can: the module is evaluated once and survives soft
// navigations. It is cleared on unmount, so coming back from /borrow (or any
// other route) still counts as a fresh arrival and gets the full entrance.
//
// Only ever WRITTEN from an effect, which never runs on the server — so it
// stays null during SSR, can't leak between requests, and the hydration render
// always agrees with the server (a fresh document load is never a "switch").
let lastRenderedKey: BranchKey | null = null;

export default function BorrowCollateralPage({
  params,
}: {
  params: Promise<{ collateral: string }>;
}) {
  const { collateral } = use(params);
  if (!isBranchKey(collateral)) notFound();
  return (
    // useSearchParams (the ?mode=xrpl deep link) needs a Suspense boundary to
    // prerender. Deliberately NO `key` here: keying on the collateral remounted
    // the entire subtree on every switch, which is what made an in-page swap
    // look like a full page navigation.
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
  // THE branch for this page. Everything below reads from the URL, never from
  // the context, so a collateral switch is correct on the very first frame.
  const branch = BRANCHES[urlKey];

  // Is this mount a collateral SWITCH (came from another collateral) or a fresh
  // arrival? Frozen at mount, before the effect below rewrites the memory.
  const [isSwitch] = useState(
    () => lastRenderedKey !== null && lastRenderedKey !== urlKey,
  );
  useEffect(() => {
    lastRenderedKey = urlKey;
    return () => {
      lastRenderedKey = null;
    };
  }, [urlKey]);

  // URL → context, one way, for other consumers only (wallet drawer, the
  // branch-scoped utility routes). Nothing on this page waits for it.
  useEffect(() => {
    if (branchKey !== urlKey) setBranchKey(urlKey);
  }, [branchKey, urlKey, setBranchKey]);

  // Deep link: /borrow/fxrp?mode=xrpl (read once on mount; the toggle owns it
  // after). `mode=xrpl` is kept as the query name for existing links. The rail
  // deliberately persists across collateral switches.
  const search = useSearchParams();
  const [rail, setRail] = useState<Rail>(() =>
    search.get("mode") === "xrpl" ? "xrpl" : "flare",
  );

  const vaultManager = branch.vaultManager || undefined;
  const { price18 } = useFtsoPrice(branch.feedId);
  const { params } = useVaultParams(vaultManager);
  const { vault, hasVault, notConfigured, isLoading } = useVault(address, vaultManager);
  const { address: collateralToken } = useCollateralToken(branch);
  const { rateBps } = useVaultRate(address, vaultManager);
  const { data: redeemableBefore } = useRedeemableBefore(address, vaultManager, hasVault);

  const xrplMode = rail === "xrpl" && branch.hasXrplMint;

  // On a switch the per-section `Reveal` entrances are off (see `enabled` below)
  // and this ONE subtle GSAP crossfade stands in for them, over the two regions
  // whose content actually changes. No-op on a fresh arrival (the Reveals own
  // that) and under reduced motion.
  const headerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  useIsomorphicLayoutEffect(() => {
    if (!isSwitch || prefersReducedMotion()) return;
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
  }, [isSwitch]);

  return (
    <div className="flex flex-col gap-6">
      <Reveal enabled={!isSwitch}>
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
                  : `Deposit ${branch.collateralSymbol}, mint vUSD, and set your own interest rate.`}
              </p>
            </div>
          </div>
        </div>
      </Reveal>

      {branch.hasXrplMint && (
        <Reveal delay={0.05} enabled={!isSwitch}>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <RailToggle value={rail} onChange={setRail} idPrefix="rail" />
            <p className="text-xs text-muted">
              {xrplMode
                ? "Pay from the XRP Ledger — no Flare wallet or FLR gas needed."
                : `Deposit ${branch.collateralSymbol} you already hold on Flare.`}
            </p>
          </div>
        </Reveal>
      )}

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div
          ref={panelRef}
          role={branch.hasXrplMint ? "tabpanel" : undefined}
          id={branch.hasXrplMint ? `rail-panel-${xrplMode ? "xrpl" : "flare"}` : undefined}
          aria-labelledby={
            branch.hasXrplMint ? `rail-tab-${xrplMode ? "xrpl" : "flare"}` : undefined
          }
          className="flex flex-col gap-6"
        >
          {xrplMode ? (
            <XrplMintFlow />
          ) : notConfigured ? (
            <ContractsNotice branch={branch} />
          ) : isConnected && isLoading ? (
            <Card>
              <Skeleton className="h-64 w-full" />
            </Card>
          ) : hasVault && vault ? (
            <>
              <Reveal enabled={!isSwitch}>
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
                <Reveal delay={0.05} enabled={!isSwitch}>
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
                <Reveal delay={0.1} enabled={!isSwitch}>
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
            <Reveal enabled={!isSwitch}>
              {/* URL-driven, same as the page — never one frame behind. */}
              <BorrowComposer branch={branch} />
            </Reveal>
          )}
        </div>

        <aside className="flex flex-col gap-4" aria-label="Market info">
          <Reveal delay={0.1} enabled={!isSwitch}>
            <LivePrice branch={branch} />
          </Reveal>
          <Reveal delay={0.15} enabled={!isSwitch}>
            <RedemptionsExplainer />
          </Reveal>
        </aside>
      </div>
    </div>
  );
}
