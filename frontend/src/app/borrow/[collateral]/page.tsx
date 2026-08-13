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
import { ArrowLeft, CheckCircle2, ChevronDown, ExternalLink, X } from "lucide-react";
import { Card, Skeleton, TokenIcon } from "@/components/ui";
import { Reveal } from "@/components/motion";
import { BorrowComposer } from "@/components/vault/BorrowComposer";
import { ContractsNotice } from "@/components/vault/ContractsNotice";
import { LivePrice } from "@/components/vault/LivePrice";
import { PositionCard } from "@/components/vault/PositionCard";
import { PriceSimulator } from "@/components/vault/PriceSimulator";
import { RedemptionsExplainer } from "@/components/vault/RedemptionsExplainer";
import { VaultActions } from "@/components/vault/VaultActions";
import { XrplVaultBanner } from "@/components/vault/XrplVaultBanner";
import { BRANCHES, isBranchKey, type BranchKey } from "@/config/branches";
import { useBranch } from "@/context/branch";
import { useFtsoPrice } from "@/hooks/useFtsoPrice";
import {
  useCollateralToken,
  useVault,
  useVaultParams,
  useXrplPathVault,
} from "@/hooks/useVault";
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
  const {
    vault,
    hasVault,
    notConfigured,
    isLoading,
    refetch: refetchVault,
  } = useVault(address, vaultManager);
  const { address: collateralToken } = useCollateralToken(branch);
  const { rateBps } = useVaultRate(address, vaultManager);
  const { data: redeemableBefore } = useRedeemableBefore(address, vaultManager, hasVault);

  // The XRP-path position: a vault on this branch owned by the connected XRPL
  // wallet's PersonalAccount (not this EVM wallet). When it exists and the EVM
  // wallet has none, it IS the user's position — show it instead of an
  // open-vault composer so a second vault can't be opened by accident.
  const xrplPath = useXrplPathVault(branch);

  // Set when the composer's openVault confirms, so the "Confirmed + Explorer"
  // proof survives the composer → PositionCard swap (the composer unmounts the
  // moment the vault read flips to active).
  const [openedHash, setOpenedHash] = useState<`0x${string}` | undefined>(undefined);
  const onOpened = (hash?: `0x${string}`) => {
    setOpenedHash(hash);
    // Refetch getVault immediately — waiting on the 12s poll leaves the user
    // staring at a stale composer after the tx confirmed.
    void refetchVault();
  };

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
              {openedHash && (
                <Reveal>
                  <div className="flex flex-wrap items-center gap-2 rounded-xl border border-green/30 bg-green/10 px-4 py-3 text-sm">
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-green" aria-hidden />
                    <span className="font-medium text-ink">Vault opened.</span>
                    <a
                      href={`https://coston2-explorer.flare.network/tx/${openedHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 font-medium text-brand hover:underline"
                    >
                      Explorer <ExternalLink className="h-3 w-3" aria-hidden />
                    </a>
                    <button
                      type="button"
                      onClick={() => setOpenedHash(undefined)}
                      aria-label="Dismiss"
                      className="ml-auto grid size-8 place-items-center rounded-full text-muted transition-colors hover:bg-surface-2 hover:text-ink"
                    >
                      <X className="h-4 w-4" aria-hidden />
                    </button>
                  </div>
                </Reveal>
              )}
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
                <Reveal delay={0.05} className="h-full">
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
                <Reveal delay={0.1} className="h-full">
                  {price18 ? (
                    <PriceSimulator
                      vault={vault}
                      livePrice18={price18}
                      params={params}
                      collDec={branch.collateralDecimals}
                    />
                  ) : (
                    <Card className="flex h-full items-center justify-center text-center text-sm text-muted">
                      Loading live price…
                    </Card>
                  )}
                </Reveal>
              </div>
            </>
          ) : xrplPath.hasVault ? (
            <Reveal>
              <div className="flex flex-col gap-6">
                {/* This EVM wallet has no vault but the connected XRP wallet's
                    PersonalAccount does — that IS the user's position on this
                    market, so it renders as the primary card. The open-vault
                    composer never sits next to it: opening a second,
                    EVM-owned vault stays possible but only behind an explicit
                    disclosure, so it can't happen by accident. */}
                <XrplVaultBanner branch={branch} />
                <details className="group rounded-2xl border border-dashed border-line px-4 py-3">
                  <summary className="flex min-h-10 cursor-pointer list-none items-center gap-1.5 text-sm font-medium text-muted transition-colors hover:text-ink [&::-webkit-details-marker]:hidden">
                    <ChevronDown
                      className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180"
                      aria-hidden
                    />
                    Open a separate {branch.label} vault with this EVM wallet
                  </summary>
                  <p className="mt-1 text-xs text-muted/80">
                    This creates a second vault owned by the connected EVM wallet,
                    independent of the XRP-path vault above.
                  </p>
                  <div className="mt-4">
                    <BorrowComposer
                      branch={branch}
                      onSelectBranch={setActiveKey}
                      onOpened={onOpened}
                    />
                  </div>
                </details>
              </div>
            </Reveal>
          ) : (
            <Reveal>
              <BorrowComposer
                branch={branch}
                onSelectBranch={setActiveKey}
                onOpened={onOpened}
              />
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
