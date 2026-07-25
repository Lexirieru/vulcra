"use client";

// Per-collateral borrow page (Enosys borrow layout). ONE page, two toggles.
//
// The collateral selector is LOCAL STATE (`activeKey`), seeded once from the
// [collateral] URL segment — exactly the same pattern as the Flare ↔ XRP Ledger
// rail below it. Switching collateral is a setState: no <Link>, no router.push,
// no segment change, so the App Router never remounts the subtree and the page
// genuinely stays put. (It used to navigate /borrow/fxrp → /borrow/wflr, which
// the router serves as a different segment value and therefore a full remount —
// that is what read as "a new page".)
//
// Everything below — header, FTSO/vault/params hooks, composer, rail
// availability, the wrap-C2FLR panel, the XRPL flow — reads off `activeKey`.
// The shared branch context is still synced so the wallet drawer and the
// branch-scoped utility routes stay consistent; nothing here waits on it.
//
// The URL is the ENTRY POINT, not a mirror of in-page state: /borrow/<key>
// seeds the initial asset and the /borrow picker still deep-links into it, but
// toggling does not rewrite it (see the note by `activeKey` for why).
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

export default function BorrowCollateralPage({
  params,
}: {
  params: Promise<{ collateral: string }>;
}) {
  const { collateral } = use(params);
  if (!isBranchKey(collateral)) notFound();
  return (
    // useSearchParams (the ?mode=xrpl deep link) needs a Suspense boundary to
    // prerender. No `key`: the collateral is state now, not identity.
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
  // a plain setState, the same as `rail` below.
  const [activeKey, setActiveKey] = useState<BranchKey>(urlKey);
  const branch = BRANCHES[activeKey];

  // Keep the shared branch context in step for OTHER consumers (wallet drawer,
  // /redeem · /guardian · /liquidations · /xrpl). Nothing on this page waits.
  useEffect(() => {
    if (branchKey !== activeKey) setBranchKey(activeKey);
  }, [branchKey, activeKey, setBranchKey]);

  // The address bar is deliberately NOT rewritten on switch. A bare
  // `history.replaceState` was tried and measurably desyncs: it updates the URL
  // but not the App Router's own history entry, so Back → Forward restores the
  // router's remembered /borrow/<original> and silently drops the choice. The
  // only way to move the segment for real is a navigation, which is exactly the
  // remount we are removing. So the URL is the ENTRY POINT, not a mirror of
  // in-page state — identical to how the rail toggle below reads `?mode=xrpl`
  // once and never writes it back. Deep links and the /borrow picker still work.

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

  // Subtle GSAP crossfade over the two regions whose content actually changes.
  // The page no longer remounts, so a plain ref comparison is enough to tell a
  // switch from the first render. Reduced-motion gated.
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
                  : `Deposit ${branch.collateralSymbol}, mint vUSD, and set your own interest rate.`}
              </p>
            </div>
          </div>
        </div>
      </Reveal>

      {branch.hasXrplMint && (
        <Reveal delay={0.05}>
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
