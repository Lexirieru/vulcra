"use client";

// Per-collateral borrow page (Enosys borrow layout). The URL is the source of
// truth for the selected branch: the shared branch context is synced to the
// [collateral] segment on mount. Two clean states, wiring unchanged from the
// pre-reskin dashboard: the Enosys-style composer when there is no vault, and a
// manage view (position + actions + what-if) when one exists.
//
// For the FXRP branch the page is ONE page with a rail toggle: Flare wallet ↔
// XRP Ledger. Flipping the toggle swaps the panel below it — it does not open a
// second flow with its own connect screen, because the XRPL connection is
// app-wide (XrplWalletProvider) and shared with the wallet drawer.
import { Suspense, use, useEffect, useState } from "react";
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

export default function BorrowCollateralPage({
  params,
}: {
  params: Promise<{ collateral: string }>;
}) {
  const { collateral } = use(params);
  if (!isBranchKey(collateral)) notFound();
  return (
    // useSearchParams (the ?mode=xrpl deep link) needs a Suspense boundary to
    // prerender; key= resets composer inputs and mode when the collateral changes.
    <Suspense
      fallback={
        <Card>
          <Skeleton className="h-64 w-full" />
        </Card>
      }
    >
      <BranchBorrow key={collateral} urlKey={collateral} />
    </Suspense>
  );
}

function BranchBorrow({ urlKey }: { urlKey: BranchKey }) {
  const { branch, branchKey, setBranchKey } = useBranch();
  const { address, isConnected } = useAccount();
  // Display reads the URL's branch directly so SSR/first paint never shows the
  // other collateral while the context is still syncing below.
  const urlBranch = BRANCHES[urlKey];

  // URL → context, one way. The composer's selector navigates (Link) and syncs
  // the context itself, so there is no context → URL write-back to race with.
  useEffect(() => {
    if (branchKey !== urlKey) setBranchKey(urlKey);
  }, [branchKey, urlKey, setBranchKey]);

  // Deep link: /borrow/fxrp?mode=xrpl (read once on mount; the toggle owns it
  // after). `mode=xrpl` is kept as the query name for existing links.
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

  const synced = branchKey === urlKey;
  const xrplMode = rail === "xrpl" && urlBranch.hasXrplMint;
  // Vault state comes from the context branch's hooks — only meaningful for
  // this page once the context has caught up with the URL.
  const showVault = synced && hasVault;

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
            <TokenIcon symbol={urlBranch.collateralSymbol} size={40} alt="" />
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-ink">
                {showVault
                  ? `Your ${urlBranch.label} vault`
                  : `Borrow vUSD against ${urlBranch.collateralSymbol}`}
              </h1>
              <p className="mt-0.5 text-sm text-muted">
                {showVault
                  ? `Manage collateral, debt, and interest — live ${urlBranch.feedLabel} pricing from FTSO.`
                  : `Deposit ${urlBranch.collateralSymbol}, mint vUSD, and set your own interest rate.`}
              </p>
            </div>
          </div>
        </div>
      </Reveal>

      {urlBranch.hasXrplMint && (
        <Reveal delay={0.05}>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <RailToggle value={rail} onChange={setRail} idPrefix="rail" />
            <p className="text-xs text-muted">
              {xrplMode
                ? "Pay from the XRP Ledger — no Flare wallet or FLR gas needed."
                : `Deposit ${urlBranch.collateralSymbol} you already hold on Flare.`}
            </p>
          </div>
        </Reveal>
      )}

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div
          role={urlBranch.hasXrplMint ? "tabpanel" : undefined}
          id={urlBranch.hasXrplMint ? `rail-panel-${xrplMode ? "xrpl" : "flare"}` : undefined}
          aria-labelledby={
            urlBranch.hasXrplMint ? `rail-tab-${xrplMode ? "xrpl" : "flare"}` : undefined
          }
          className="flex flex-col gap-6"
        >
          {!synced ? (
            <Card>
              <Skeleton className="h-64 w-full" />
            </Card>
          ) : xrplMode ? (
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
              <BorrowComposer />
            </Reveal>
          )}
        </div>

        <aside className="flex flex-col gap-4" aria-label="Market info">
          <Reveal delay={0.1}>
            <LivePrice />
          </Reveal>
          <Reveal delay={0.15}>
            <RedemptionsExplainer />
          </Reveal>
        </aside>
      </div>
    </div>
  );
}

