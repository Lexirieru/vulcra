"use client";

// Per-collateral MARKET page — the FLARE-chain markets (FXRP, wFLR). You
// deposit a collateral token you already hold on Flare and borrow vUSD with
// your EVM wallet.
//
// The XRP market is a SEPARATE market on its own page (/borrow/xrp): you
// supply XRP from the XRP Ledger there, and its vault is owned by your Flare
// PersonalAccount. The two markets share the FXRP VaultManager on-chain, but
// the UI never merges them — when the connected XRP wallet's PersonalAccount
// holds a vault, this page shows a POINTER card to the XRP market (correctly
// labelled "XRP vault"), not an inline manage surface.
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
import { Card, ErrorState, Skeleton, TokenIcon } from "@/components/ui";
import { Reveal } from "@/components/motion";
import { BorrowComposer } from "@/components/vault/BorrowComposer";
import { ContractsNotice } from "@/components/vault/ContractsNotice";
import { LivePrice } from "@/components/vault/LivePrice";
import { PositionCard } from "@/components/vault/PositionCard";
import { PriceSimulator } from "@/components/vault/PriceSimulator";
import { RedemptionsExplainer } from "@/components/vault/RedemptionsExplainer";
import { VaultActions } from "@/components/vault/VaultActions";
import { XrpVaultPointer } from "@/components/vault/XrpVaultPointer";
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
    isError: vaultReadError,
    refetch: refetchVault,
  } = useVault(address, vaultManager);
  const { address: collateralToken } = useCollateralToken(branch);
  const { rateBps } = useVaultRate(address, vaultManager);
  const { data: redeemableBefore } = useRedeemableBefore(address, vaultManager, hasVault);

  // The XRP-market position (owned by the connected XRP wallet's
  // PersonalAccount). The XRP market is SEPARATE (/borrow/xrp) — this page only
  // uses the read to show the pointer card, so an empty composer never hides an
  // existing position or invites a duplicate vault.
  const xrplPath = useXrplPathVault(branch);

  // Keep the URL in step with the locally-switched collateral. The native
  // history API is App-Router-aware (shallow) — no navigation, no remount —
  // so refresh/share lands on the collateral actually shown.
  useEffect(() => {
    const want = `/borrow/${activeKey}`;
    if (window.location.pathname !== want) window.history.replaceState(null, "", want);
  }, [activeKey]);

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
            <ArrowLeft className="h-4 w-4" aria-hidden /> All markets
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

              {/* Separate market, helpful pointer: the connected XRP wallet's
                  PersonalAccount may also hold an XRP vault — point to the XRP
                  market rather than rendering it here. Gated so an empty
                  pointer never leaves a blank Reveal wrapper (a phantom gap
                  in this flex column). */}
              {xrplPath.hasVault && (
                <Reveal delay={0.15}>
                  <XrpVaultPointer branch={branch} />
                </Reveal>
              )}
            </>
          ) : isConnected && vaultReadError ? (
            // Fail CLOSED before anything that could open a vault: if the EVM
            // vault read errored, this page cannot know whether one already
            // exists — never fall through to a composer (even a disclosed one).
            <div className="flex flex-col gap-6">
              <Card>
                <ErrorState
                  title="Couldn't read your vault"
                  description="The RPC read failed, so this page can't tell whether you already have a vault here. Retry before opening a new one."
                  onRetry={() => void refetchVault()}
                />
              </Card>
              {xrplPath.hasVault && <XrpVaultPointer branch={branch} />}
            </div>
          ) : xrplPath.hasVault ? (
            <Reveal>
              <div className="flex flex-col gap-6">
                {/* No FXRP (Flare) vault, but the XRP market has one — show the
                    correctly-labelled pointer instead of a bare composer, and
                    keep opening an FXRP vault behind an explicit disclosure so
                    a duplicate can't happen by accident. */}
                <XrpVaultPointer branch={branch} />
                <details className="group rounded-2xl border border-dashed border-line px-4 py-3">
                  <summary className="flex min-h-10 cursor-pointer list-none items-center gap-1.5 text-sm font-medium text-muted transition-colors hover:text-ink [&::-webkit-details-marker]:hidden">
                    <ChevronDown
                      className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180"
                      aria-hidden
                    />
                    Open a {branch.label} vault with this EVM wallet
                  </summary>
                  <p className="mt-1 text-xs text-muted/80">
                    This opens a separate vault on the {branch.label} (Flare) market,
                    owned by the connected EVM wallet — independent of the XRP vault
                    above.
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
              <div className="flex flex-col gap-6">
                <BorrowComposer
                  branch={branch}
                  onSelectBranch={setActiveKey}
                  onOpened={onOpened}
                />
                {/* Separate market, light cross-link: holding XRP on the XRP
                    Ledger belongs on the XRP market, not in this composer. */}
                {branch.hasXrplMint && (
                  <p className="text-xs text-muted/80">
                    Hold XRP on the XRP Ledger instead?{" "}
                    <Link
                      href="/borrow/xrp"
                      className="font-medium text-brand hover:underline"
                    >
                      Borrow on the XRP market
                    </Link>{" "}
                    — one signed XRPL payment, no EVM wallet.
                  </p>
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
