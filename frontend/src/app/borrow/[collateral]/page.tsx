"use client";

// Per-collateral MARKET page — the single surface for one branch's market.
//
// One market, one position surface: the VaultManager keys vaults by owner, so
// the same person can hold an EVM-wallet vault AND a PersonalAccount vault
// (opened from the XRP Ledger). Both render here as first-class positions with
// an owner chip, each managed on its own rail (wagmi writes vs ONE signed XRPL
// 0xFE payment). With no position, a rail toggle picks how a new vault is
// funded: FXRP from the Flare wallet, or XRP from the XRP Ledger (the same
// XrplMintFlow that /borrow/xrp — the XRPL-pinned entry — mounts).
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
import { RailToggle, type Rail } from "@/components/borrow/RailToggle";
import { BorrowComposer } from "@/components/vault/BorrowComposer";
import { ContractsNotice } from "@/components/vault/ContractsNotice";
import { LivePrice } from "@/components/vault/LivePrice";
import { PositionCard } from "@/components/vault/PositionCard";
import { PriceSimulator } from "@/components/vault/PriceSimulator";
import { RedemptionsExplainer } from "@/components/vault/RedemptionsExplainer";
import { VaultActions } from "@/components/vault/VaultActions";
import { XrplMintFlow } from "@/components/xrpl/XrplMintFlow";
import { XrplManagePanel } from "@/components/xrpl/XrplVaultActions";
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
import { shortenAddress } from "@/lib/format";
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
  // wallet's PersonalAccount (not this EVM wallet). It renders as a first-class
  // position in the list below, managed inline via 0xFE payments — never as an
  // invitation to open a second vault by accident.
  const xrplPath = useXrplPathVault(branch);
  const { rateBps: xrplRateBps } = useVaultRate(xrplPath.pa, vaultManager);
  const positionCount = (hasVault && vault ? 1 : 0) + (xrplPath.hasVault && xrplPath.vault ? 1 : 0);

  // Which rail funds a NEW vault (no-position state only): the Flare wallet
  // (FXRP composer) or the XRP Ledger (the XRPL-native flow). FXRP-only —
  // wFLR has no XRPL rail.
  const [rail, setRail] = useState<Rail>("flare");

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
                {positionCount > 1
                  ? `Your ${branch.label} vaults`
                  : positionCount === 1
                    ? `Your ${branch.label} vault`
                    : `Borrow vUSD against ${branch.collateralSymbol}`}
              </h1>
              <p className="mt-0.5 text-sm text-muted">
                {positionCount > 0
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
          ) : positionCount > 0 ? (
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

              {/* EVM-owned position — managed with wagmi writes. */}
              {hasVault && vault && (
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
                      ownerChip={
                        address ? `EVM wallet · ${shortenAddress(address)}` : undefined
                      }
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
              )}

              {/* XRP-path position — owned by the PersonalAccount derived from
                  the connected r-address; every action is ONE signed XRPL 0xFE
                  payment, managed right here (no EVM wallet involved). */}
              {xrplPath.hasVault && xrplPath.vault && xrplPath.pa && xrplPath.xrplAddress && (
                <>
                  <Reveal delay={hasVault ? 0.1 : 0}>
                    <PositionCard
                      vault={xrplPath.vault}
                      price18={price18}
                      params={params}
                      collDec={branch.collateralDecimals}
                      collateralSymbol="XRP"
                      feedLabel={branch.feedLabel}
                      rateBps={xrplRateBps}
                      ownerChip={`XRP Ledger · personal account ${shortenAddress(xrplPath.pa)}`}
                    />
                  </Reveal>
                  <div className="grid gap-6 xl:grid-cols-2">
                    <Reveal delay={0.05} className="h-full">
                      <XrplManagePanel
                        rAddress={xrplPath.xrplAddress}
                        personalAccount={xrplPath.pa}
                        vault={xrplPath.vault}
                        onVaultChanged={() => void xrplPath.refetch()}
                      />
                    </Reveal>
                    <Reveal delay={0.1} className="h-full">
                      {price18 ? (
                        <PriceSimulator
                          vault={xrplPath.vault}
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
              )}

              {/* Only the XRP-path vault exists → opening a second, EVM-owned
                  vault stays possible, but only behind an explicit disclosure,
                  so it can't happen by accident. */}
              {!hasVault && xrplPath.hasVault && (
                <Reveal delay={0.15}>
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
                </Reveal>
              )}
            </>
          ) : (
            <Reveal>
              <div className="flex flex-col gap-6">
                {/* No position yet. On the FXRP market the vault can be funded
                    from EITHER rail — the toggle flips between the Flare-wallet
                    composer (FXRP) and the XRPL-native flow (XRP). wFLR has no
                    XRPL rail, so it renders the composer alone. */}
                {branch.hasXrplMint && (
                  <RailToggle value={rail} onChange={setRail} idPrefix="borrow-rail" />
                )}
                {branch.hasXrplMint && rail === "xrpl" ? (
                  <div
                    role="tabpanel"
                    id="borrow-rail-panel-xrpl"
                    aria-labelledby="borrow-rail-tab-xrpl"
                  >
                    <XrplMintFlow />
                  </div>
                ) : (
                  <div
                    role="tabpanel"
                    id="borrow-rail-panel-flare"
                    aria-labelledby="borrow-rail-tab-flare"
                  >
                    <BorrowComposer
                      branch={branch}
                      onSelectBranch={setActiveKey}
                      onOpened={onOpened}
                    />
                  </div>
                )}
              </div>
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
