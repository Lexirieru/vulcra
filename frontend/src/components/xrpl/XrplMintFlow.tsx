"use client";

// XRPL-native mint flow (U8–U10 / R13, AE1, AE2, F1). Enter the flow with an
// XRPL wallet already connected, see the PersonalAccount, pre-flight the mint
// (blocking sub-minimum before any XRP is sent), get a signable Payment (QR +
// Xaman deep link, backend-built 0xFE memo), and track the mint end to end. The
// client never builds the memo. Headingless on purpose — the host page owns h1.
//
// There is NO "connect your XRPL wallet" step any more. The wallet is the
// app-wide one from XrplWalletProvider — the same connection the right-hand
// wallet drawer owns — so the Borrow page's XRP-Ledger rail is a continuation
// of the same session rather than a second, competing connect screen. When
// nothing is connected the flow opens with a compact prompt that either
// connects inline (per provider) or raises the drawer; pasting an r-address you
// don't hold is still supported for the QR / Xaman path.
import { useMemo, useState } from "react";
import Link from "next/link";
import { useAccount } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowDown,
  ChevronDown,
  ExternalLink,
  Gauge,
  Info,
  ShieldAlert,
  Wallet,
} from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardTitle,
  ErrorState,
  Field,
  Input,
  PillButton,
  Skeleton,
  TokenIcon,
} from "@/components/ui";
import { Reveal } from "@/components/motion";
import { MintStatusTracker } from "@/components/xrpl/MintStatusTracker";
import {
  PaymentPanel,
  XrplVaultActions,
  useXrplPaymentPipeline,
} from "@/components/xrpl/XrplVaultActions";
import { PositionCard } from "@/components/vault/PositionCard";
import { PriceSimulator } from "@/components/vault/PriceSimulator";
import { api } from "@/lib/api/client";
import type { ManageBuildRequest, ManageAction } from "@/lib/api/types";
import { usePersonalAccount, isValidRAddress } from "@/hooks/usePersonalAccount";
import { useXrplWalletContext } from "@/context/xrpl";
import { useWalletUi } from "@/context/wallet-ui";
import { useFtsoPrice } from "@/hooks/useFtsoPrice";
import { useVaultRate } from "@/hooks/useInterest";
import { useVault, useVaultParams } from "@/hooks/useVault";
import { useWalletBalances } from "@/hooks/useWalletBalances";
import { useXrpBalance } from "@/hooks/useXrpBalance";
import {
  annualInterest18,
  collateralValueUsd18,
  computeCrBps,
  healthBand,
  liquidationPrice18,
  maxMintableVusd18,
} from "@/lib/vault-math";
import { XRPL_PROVIDER_ORDER, XRPL_PROVIDERS } from "@/lib/xrpl/wallets";
import { BRANCHES } from "@/config/branches";
import {
  formatBps,
  formatPrice,
  formatToken,
  formatUsd,
  parseAmount,
  shortenAddress,
} from "@/lib/format";

// XRPL-native collateral is always the FXRP branch. The user supplies XRP on the
// XRP Ledger; it becomes FXRP collateral on Flare (FAssets) and backs vUSD.
const FXRP_VAULT_MANAGER = BRANCHES.fxrp.vaultManager || undefined;
const INTEREST = BRANCHES.fxrp.interest;
// XRP == FXRP: 6 decimals (drops). Used by the shared vault-math for the same
// liquidation preview the Flare-wallet composer shows.
const COLL_DEC = 6;
const RISK_LABEL = { healthy: "Low", warning: "Medium", danger: "High" } as const;

function InfoRow({ left, right }: { left: React.ReactNode; right: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-muted">{left}</span>
      <span className="tabular-nums text-ink">{right}</span>
    </div>
  );
}

export function XrplMintFlow() {
  const wallet = useXrplWalletContext();
  // A connected wallet IS the r-address — derived, so a connection made in the
  // wallet drawer shows up here instantly (and vice versa). The typed field is
  // only the no-wallet fallback.
  const [pastedAddress, setPastedAddress] = useState("");
  const rAddress = wallet.address ?? pastedAddress;
  const account = usePersonalAccount(rAddress);
  // Live XRP Ledger balance for the connected/pasted r-address (spendable, the
  // same number the wallet shows) — this is the collateral the user can supply.
  const xrpBalance = useXrpBalance(rAddress);
  const validAddr = isValidRAddress(rAddress);

  // Two amounts, matching the cross-chain flow: the XRP you supply as collateral
  // (drops, 6-dec — "FXRP 6-dec == XRP drops") and the vUSD you borrow (18-dec).
  const [collateral, setCollateral] = useState("");
  const [borrow, setBorrow] = useState("");
  const collateral6 = parseAmount(collateral, 6);
  const mint18 = parseAmount(borrow, 18);

  // Chosen interest rate (bps). The XRPL one-payment opens the vault at this
  // rate; the backend accepts it as annualInterestRateBps. Slider + % field are
  // kept in sync, exactly like the Flare-wallet composer.
  const [rateBps, setRateBps] = useState(INTEREST.defaultBps);
  const [rateText, setRateText] = useState((INTEREST.defaultBps / 100).toString());
  const clampedRate = Math.min(Math.max(rateBps, INTEREST.minBps), INTEREST.maxBps);
  const setRateFromBps = (bps: number) => {
    const next = Math.min(Math.max(bps, INTEREST.minBps), INTEREST.maxBps);
    setRateBps(next);
    setRateText((next / 100).toString());
  };
  const onRateTyped = (text: string) => {
    setRateText(text);
    const pct = Number.parseFloat(text);
    if (Number.isFinite(pct)) setRateBps(Math.round(pct * 100));
  };
  const rateSpan = Math.max(1, INTEREST.maxBps - INTEREST.minBps);
  const ratePos = (clampedRate - INTEREST.minBps) / rateSpan;
  const redemptionRisk = ratePos < 0.15 ? "danger" : ratePos < 0.4 ? "warning" : "green";

  // Live FTSO price + branch params → the SAME liquidation preview the
  // Flare-wallet composer shows (collateral USD, max borrow, CR, liq price).
  const { price18, isStale } = useFtsoPrice(BRANCHES.fxrp.feedId);
  const { params } = useVaultParams(FXRP_VAULT_MANAGER);
  // Does this XRPL wallet's PersonalAccount already hold an FXRP vault? If so the
  // page becomes a MANAGE view (repay / close) — you can't open a second vault.
  const { vault, hasVault, refetch: refetchVault } = useVault(
    account.data?.personalAccount,
    FXRP_VAULT_MANAGER,
  );
  // Current interest rate on the XRPL vault — feeds the position card + rate tab,
  // exactly like the EVM branch page.
  const { rateBps: currentRateBps } = useVaultRate(
    account.data?.personalAccount,
    FXRP_VAULT_MANAGER,
  );
  // The connected EVM wallet may hold its OWN FXRP vault (opened on
  // /borrow/fxrp — vaults are keyed by owner, so it is invisible to the
  // PersonalAccount read above). Opening here would create a SECOND, separate
  // vault; the composer warns first instead of letting that happen silently.
  const { address: evmAddress } = useAccount();
  const { hasVault: evmHasVault } = useVault(evmAddress, FXRP_VAULT_MANAGER);
  // vUSD the borrow delivered to the PersonalAccount — this is what the "Earn"
  // card lets you deposit into the stability pool from your XRP wallet (spDeposit).
  const paBalances = useWalletBalances(account.data?.personalAccount);
  const paVusd18 = paBalances.tokens.find((t) => t.symbol === "vUSD")?.value;
  const derived = useMemo(() => {
    const fee = mint18 !== null ? (mint18 * params.mintFeeBps) / 10_000n : 0n;
    const debt = mint18 !== null ? mint18 + fee : 0n;
    const collateralUsd =
      collateral6 !== null && price18
        ? collateralValueUsd18(collateral6, COLL_DEC, price18)
        : undefined;
    const maxMint =
      collateral6 !== null && price18
        ? maxMintableVusd18(collateral6, COLL_DEC, price18, params.mcrBps, params.mintFeeBps)
        : undefined;
    const crBps =
      collateral6 !== null && mint18 !== null && mint18 > 0n && price18
        ? computeCrBps(collateral6, COLL_DEC, debt, price18)
        : null;
    const liqPrice =
      collateral6 !== null && mint18 !== null && mint18 > 0n
        ? liquidationPrice18(collateral6, COLL_DEC, debt, params.mcrBps)
        : null;
    const annualCost = mint18 !== null ? annualInterest18(debt, clampedRate) : 0n;
    return {
      debt,
      collateralUsd,
      maxMint,
      crBps,
      liqPrice,
      annualCost,
      band: healthBand(crBps, params.mcrBps),
    };
  }, [collateral6, mint18, price18, params.mcrBps, params.mintFeeBps, clampedRate]);

  const overMax =
    derived.maxMint !== undefined && mint18 !== null && mint18 > derived.maxMint;

  const inputsReady =
    collateral6 !== null &&
    collateral6 > 0n &&
    mint18 !== null &&
    mint18 > 0n &&
    Boolean(account.data);

  const preflight = useQuery({
    queryKey: ["preflight", rAddress, collateral, borrow],
    queryFn: () =>
      api.preflight({
        xrplAddress: rAddress.trim(),
        netMintDrops: collateral6!.toString(),
        mint18: mint18!.toString(),
      }),
    enabled: inputsReady && !overMax,
    retry: 0,
  });

  // The shared build → auto-sign → submit pipeline (extracted verbatim into
  // XrplVaultActions.tsx so the manage surface can mount standalone). One build
  // mutation serves both a mint request (open) and every manage request; with a
  // wallet connected the sign fires the instant the payment is built.
  const { build, submit, xrplTxId, setXrplTxId, signAndTrack, pendingAction, busy } =
    useXrplPaymentPipeline();
  const generateMint = () =>
    build.mutate({
      xrplAddress: rAddress.trim(),
      collateral6: collateral6!.toString(),
      mint18: mint18!.toString(),
      annualInterestRateBps: String(clampedRate),
    });

  // Insufficient-balance guard: you can't supply more XRP than your XRP Ledger
  // wallet can actually spend (balance minus the base+owner reserve).
  const spendableDrops = xrpBalance.data?.spendableDrops;
  const composerExceedsBalance =
    collateral6 !== null && spendableDrops !== undefined && collateral6 > spendableDrops;

  const canGenerate =
    inputsReady && !overMax && !composerExceedsBalance && preflight.data?.ok === true;

  return (
    <div className="flex flex-col gap-6">
      <Reveal>
        {wallet.address ? (
          <ConnectedStrip
            address={wallet.address}
            providerName={
              wallet.providerId ? XRPL_PROVIDERS[wallet.providerId].name : undefined
            }
            account={account}
            xrp={xrpBalance}
          />
        ) : (
          <ConnectPrompt
            pastedAddress={pastedAddress}
            onPastedAddress={setPastedAddress}
            invalidPaste={Boolean(pastedAddress) && !validAddr}
          />
        )}
      </Reveal>

      {/* MANAGE — the PersonalAccount already has an FXRP vault. Same shape as the
          EVM branch page: a position card + a tabbed Actions panel + the price
          simulator. Every action is ONE XRPL 0xFE payment instead of an EVM tx. */}
      {account.data && hasVault && vault && (
        <>
          <Reveal>
            <PositionCard
              vault={vault}
              price18={price18}
              params={params}
              collDec={COLL_DEC}
              collateralSymbol="XRP"
              feedLabel={BRANCHES.fxrp.feedLabel}
              rateBps={currentRateBps}
              ownerChip={
                account.data
                  ? `XRP Ledger · personal account ${shortenAddress(account.data.personalAccount)}`
                  : undefined
              }
            />
          </Reveal>
          <div className="grid gap-6 xl:grid-cols-2">
            <Reveal delay={0.05} className="h-full">
              <XrplVaultActions
                vault={vault}
                price18={price18}
                params={params}
                onBuild={(req) => build.mutate(req)}
                busy={busy}
                pendingAction={pendingAction}
                spendableDrops={xrpBalance.data?.spendableDrops}
                currentRateBps={currentRateBps}
                xrplAddress={rAddress.trim()}
              />
            </Reveal>
            <Reveal delay={0.1} className="h-full">
              {price18 ? (
                <PriceSimulator
                  vault={vault}
                  livePrice18={price18}
                  params={params}
                  collDec={COLL_DEC}
                />
              ) : (
                <Card className="flex h-full items-center justify-center text-center text-sm text-muted">
                  Loading live price…
                </Card>
              )}
            </Reveal>
          </div>

          {/* Borrow -> earn, seamless: the vUSD your borrow delivered to the
              PersonalAccount goes straight into the stability pool from your XRP
              wallet, in ONE signed payment (no EVM wallet). */}
          <Reveal delay={0.15}>
            <XrplEarnCard
              vusdBalance18={paVusd18}
              onBuild={(req) => build.mutate(req)}
              busy={busy}
              pendingAction={pendingAction}
              xrplAddress={rAddress.trim()}
            />
          </Reveal>
        </>
      )}

      {/* Composer — Collateral (XRP) → Loan (vUSD) → Interest rate, identical in
          shape to the Flare-wallet borrow composer. The action is ONE XRPL
          payment instead of an EVM tx. Shown only when there is no vault yet. */}
      {account.data && !hasVault && (
        <>
          {/* If the connected EVM wallet already has its own FXRP vault, say so
              BEFORE the composer — this flow opens a separate, PersonalAccount-
              owned vault, and that must never happen by surprise. */}
          {evmHasVault && (
            <Reveal>
              <div className="flex items-start gap-3 rounded-xl border border-brand/20 bg-brand/5 p-4 text-sm">
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-brand" aria-hidden />
                <p className="text-muted">
                  <span className="font-medium text-ink">
                    This opens a separate vault owned by your XRP personal account.
                  </span>{" "}
                  Your connected EVM wallet already has an FXRP vault of its own —{" "}
                  <Link
                    href="/borrow/fxrp"
                    className="font-medium text-brand hover:underline"
                  >
                    manage that one instead
                  </Link>
                  .
                </p>
              </div>
            </Reveal>
          )}

          {/* Card 1 — Collateral (XRP) */}
          <Reveal>
            <Card>
              <span className="text-sm font-medium text-muted">Collateral</span>
              <div className="mt-3 flex items-center gap-3">
                <input
                  inputMode="decimal"
                  placeholder="0.0"
                  value={collateral}
                  onChange={(e) => setCollateral(e.target.value)}
                  aria-label="XRP to supply"
                  className="w-full min-w-0 bg-transparent text-4xl font-semibold tabular-nums text-ink outline-none placeholder:text-muted/50"
                />
                <span className="inline-flex shrink-0 items-center gap-2 rounded-full border border-line bg-surface-2 py-1.5 pl-1.5 pr-3.5 text-base font-semibold text-ink">
                  <TokenIcon symbol="XRP" size={26} alt="" />
                  XRP
                </span>
              </div>
              <div className="mt-1 flex items-center justify-between gap-3">
                <span className="text-sm tabular-nums text-muted/70">
                  {derived.collateralUsd !== undefined ? formatUsd(derived.collateralUsd) : "$0.00"}
                </span>
                {xrpBalance.data && (
                  <button
                    type="button"
                    onClick={() =>
                      setCollateral(formatToken(xrpBalance.data!.spendableDrops, 6, 2).replace(/,/g, ""))
                    }
                    className="min-h-10 rounded-full px-2 text-xs font-medium text-brand hover:underline"
                  >
                    Balance {formatToken(xrpBalance.data.spendableDrops, 6, 2)} XRP
                  </button>
                )}
              </div>
              {composerExceedsBalance && (
                <p className="mt-2 text-xs text-danger">
                  Insufficient balance — you have{" "}
                  {formatToken(spendableDrops!, 6, 2)} XRP spendable.
                </p>
              )}

              <div className="mt-4 space-y-1.5 border-t border-line pt-3">
                <InfoRow
                  left={
                    <span className="inline-flex items-center gap-1.5">
                      XRP/USD price {isStale && <Badge tone="warning">stale</Badge>}
                    </span>
                  }
                  right={formatPrice(price18)}
                />
                <InfoRow left="Min collateral ratio" right={formatBps(params.mcrBps)} />
              </div>

              <a
                href="https://xrpl.org/resources/dev-tools/xrp-faucets"
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 inline-flex items-center gap-1 text-xs text-brand hover:underline"
              >
                Need test XRP? Fund your wallet from the XRPL faucet
                <ExternalLink className="h-3.5 w-3.5" aria-hidden />
              </a>
            </Card>
          </Reveal>

          <div className="-my-1 flex justify-center text-muted/60" aria-hidden>
            <ArrowDown className="h-5 w-5" />
          </div>

          {/* Card 2 — Loan (vUSD) */}
          <Reveal>
            <Card>
              <span className="text-sm font-medium text-muted">Loan</span>
              <div className="mt-3 flex items-center gap-3">
                <input
                  inputMode="decimal"
                  placeholder="0.0"
                  value={borrow}
                  onChange={(e) => setBorrow(e.target.value)}
                  aria-label="vUSD to borrow"
                  className="w-full min-w-0 bg-transparent text-4xl font-semibold tabular-nums text-ink outline-none placeholder:text-muted/50"
                />
                <span className="inline-flex shrink-0 items-center gap-2 rounded-full border border-line bg-surface-2 py-1.5 pl-1.5 pr-3.5 text-base font-semibold text-ink">
                  <TokenIcon symbol="vUSD" size={26} alt="" />
                  vUSD
                </span>
              </div>
              <div className="mt-1 flex items-center justify-between gap-3">
                <span className="text-sm tabular-nums text-muted/70">
                  {mint18 !== null ? formatUsd(mint18) : "$0.00"}
                </span>
                {derived.maxMint !== undefined && (
                  <button
                    type="button"
                    onClick={() => setBorrow(formatToken(derived.maxMint!, 18, 2).replace(/,/g, ""))}
                    className="min-h-10 rounded-full px-2 text-xs font-medium text-brand hover:underline"
                  >
                    Max {formatToken(derived.maxMint, 18, 2)}
                  </button>
                )}
              </div>
              {overMax && (
                <p className="mt-2 text-xs text-danger">
                  Exceeds the max borrow at MCR — lower the vUSD or supply more XRP.
                </p>
              )}

              <div className="mt-4 space-y-1.5 border-t border-line pt-3">
                <InfoRow
                  left={
                    <span className="inline-flex items-center gap-1.5">
                      <Gauge className="h-3.5 w-3.5" aria-hidden /> Liquidation risk
                    </span>
                  }
                  right={
                    <Badge tone={derived.band === "danger" ? "danger" : derived.band === "warning" ? "warning" : "green"}>
                      {derived.crBps === null ? "—" : RISK_LABEL[derived.band]}
                    </Badge>
                  }
                />
                <InfoRow left="Liquidation price" right={formatPrice(derived.liqPrice ?? undefined)} />
                <InfoRow
                  left="Collateral ratio"
                  right={derived.crBps === null ? "—" : formatBps(derived.crBps)}
                />
              </div>
            </Card>
          </Reveal>

          {/* Card 3 — Interest rate */}
          <Reveal>
            <Card>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-medium text-muted">Interest rate</span>
                <Badge tone="neutral">You can change this anytime</Badge>
              </div>
              <div className="mt-3 flex items-center gap-3">
                <input
                  id="xrpl-interest-rate"
                  type="number"
                  inputMode="decimal"
                  min={INTEREST.minBps / 100}
                  max={INTEREST.maxBps / 100}
                  step={0.1}
                  value={rateText}
                  onChange={(e) => onRateTyped(e.target.value)}
                  onBlur={() => setRateFromBps(rateBps)}
                  aria-label="Annual interest rate in percent"
                  className="w-32 bg-transparent text-4xl font-semibold tabular-nums text-ink outline-none [appearance:textfield] placeholder:text-muted/50 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                />
                <span className="text-base text-muted">% per year</span>
              </div>
              <input
                type="range"
                min={INTEREST.minBps}
                max={INTEREST.maxBps}
                step={10}
                value={clampedRate}
                onChange={(e) => setRateFromBps(Number(e.target.value))}
                aria-label="Annual interest rate"
                aria-valuetext={`${formatBps(clampedRate)} per year`}
                className="mt-4 w-full accent-[var(--color-brand)]"
              />
              <div className="mt-1 flex justify-between text-xs text-muted/70">
                <span>{formatBps(INTEREST.minBps)}</span>
                <span>{formatBps(INTEREST.maxBps)}</span>
              </div>

              <div className="mt-4 space-y-1.5 border-t border-line pt-3">
                <InfoRow
                  left="Interest cost"
                  right={`≈ ${formatToken(derived.annualCost, 18, 2)} vUSD / year`}
                />
                <InfoRow
                  left="Redemption risk"
                  right={
                    <Badge tone={redemptionRisk}>
                      {redemptionRisk === "danger" ? "High" : redemptionRisk === "warning" ? "Medium" : "Low"}
                    </Badge>
                  }
                />
              </div>
              <p className="mt-3 flex items-start gap-1.5 text-xs text-muted/80">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                Redemptions hit the lowest-rate vaults first. A higher rate costs more but is
                redeemed later.
              </p>
            </Card>
          </Reveal>

          {/* Pre-flight + Generate the ONE XRPL payment */}
          <Reveal>
            <div className="flex flex-col gap-3">
              {inputsReady && !overMax &&
                (preflight.isLoading ? (
                  <Skeleton className="h-12 w-full" />
                ) : preflight.isError ? (
                  <ErrorState
                    title="Pre-flight unavailable"
                    description="Borrowing is blocked until the backend confirms the limits (fail-closed)."
                    onRetry={() => preflight.refetch()}
                  />
                ) : preflight.data && !preflight.data.ok ? (
                  <div className="flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
                    <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                    <div>
                      <div className="font-medium">Payment blocked</div>
                      <div>
                        {preflight.data.blockedReason ??
                          "A sub-minimum payment would be forfeited irrecoverably."}
                      </div>
                    </div>
                  </div>
                ) : preflight.data?.ok ? (
                  <Badge tone="green">Pre-flight passed — safe to generate</Badge>
                ) : null)}

              <PillButton
                size="lg"
                disabled={!canGenerate || busy}
                onClick={generateMint}
              >
                {build.isPending
                  ? "Generating payment…"
                  : wallet.signing
                    ? `Confirm in ${wallet.providerId ? XRPL_PROVIDERS[wallet.providerId].name : "wallet"}…`
                    : "Generate payment"}
              </PillButton>
              {build.isError && (
                <p className="text-sm text-danger">
                  Couldn&apos;t build the payment — the backend is unavailable.
                </p>
              )}
            </div>
          </Reveal>
        </>
      )}

      {/* Step 2 — payment. With a wallet connected the sign fires automatically
          on build (seamless: click an action → Crossmark opens), so this only
          surfaces once there's something to DO — retry a rejected sign, or pay
          manually from a pasted r-address. It hides the moment tracking begins. */}
      {build.data && !submit.data && (
        <Reveal>
          <PaymentPanel
            intent={build.data}
            xrplTxId={xrplTxId}
            onXrplTxId={setXrplTxId}
            onSubmit={() => submit.mutate({ txId: xrplTxId.trim(), built: build.data! })}
            submitting={submit.isPending}
            submitError={submit.isError}
            walletConnected={Boolean(wallet.address)}
            walletName={wallet.providerId ? XRPL_PROVIDERS[wallet.providerId].name : undefined}
            onWalletSign={() => build.data && signAndTrack(build.data)}
            signing={wallet.signing}
            walletError={wallet.error}
          />
        </Reveal>
      )}

      {/* Step 3 — tracking. On EXECUTED, refetch the vault + balances at once so
          the position updates the instant the mint lands (not on the next poll). */}
      {submit.data && (
        <Reveal>
          <MintStatusTracker
            mintId={submit.data.mintId}
            action={
              build.variables && "action" in build.variables ? build.variables.action : "open"
            }
            onExecuted={() => {
              void refetchVault();
              xrpBalance.refetch();
              void account.refetch();
            }}
          />
        </Reveal>
      )}
    </div>
  );
}

// Borrow -> earn in one payment: deposit the vUSD your borrow delivered to the
// PersonalAccount straight into the FXRP stability pool (spDeposit), signed once
// in Crossmark. No EVM wallet, no moving funds around.
function XrplEarnCard({
  vusdBalance18,
  onBuild,
  busy,
  pendingAction,
  xrplAddress,
}: {
  vusdBalance18?: bigint;
  onBuild: (req: ManageBuildRequest) => void;
  busy: boolean;
  pendingAction?: ManageAction;
  xrplAddress: string;
}) {
  const [amount, setAmount] = useState("");
  const amt18 = parseAmount(amount, 18);
  const hasVusd = vusdBalance18 !== undefined && vusdBalance18 > 0n;
  const insufficient = amt18 !== null && vusdBalance18 !== undefined && amt18 > vusdBalance18;
  const valid = amt18 !== null && amt18 > 0n && !insufficient && hasVusd;

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <CardTitle>Put your vUSD to work</CardTitle>
        <Badge tone="brand">FXRP pool · earn</Badge>
      </div>
      <p className="text-sm text-muted">
        The vUSD your borrow delivered to your Flare personal account can go straight
        into the FXRP stability pool — <span className="text-ink">one XRPL payment</span>,
        no EVM wallet. It earns a share of the branch&apos;s loan fees.
      </p>

      <Field
        label="Deposit vUSD to Earn"
        htmlFor="xrpl-earn"
        error={
          insufficient
            ? `You only have ${formatToken(vusdBalance18!, 18, 2)} vUSD on your personal account.`
            : undefined
        }
        hint="Burned from your Flare personal account into the pool · one XRPL payment (fees only)"
      >
        <Input
          id="xrpl-earn"
          inputMode="decimal"
          placeholder="0.0"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
      </Field>
      {vusdBalance18 !== undefined && (
        <div className="-mt-1 flex items-center justify-between text-xs">
          <span className={hasVusd ? "text-muted/70" : "text-muted/70"}>
            Available {formatToken(vusdBalance18, 18, 2)} vUSD
          </span>
          {hasVusd && (
            <button
              type="button"
              onClick={() => setAmount(formatToken(vusdBalance18, 18, 2).replace(/,/g, ""))}
              className="min-h-8 rounded-full px-2 font-medium text-brand hover:underline"
            >
              Max
            </button>
          )}
        </div>
      )}
      <PillButton
        size="md"
        className="w-full"
        disabled={!valid || busy}
        onClick={() => onBuild({ xrplAddress, action: "spDeposit", amount18: amt18!.toString() })}
      >
        {pendingAction === "spDeposit"
          ? "Generating…"
          : hasVusd
            ? "Deposit to Earn"
            : "Borrow vUSD first to earn"}
      </PillButton>
    </Card>
  );
}


// ─────────────────────────────────────────────────────────────────────────────
// Wallet header — connected strip vs compact connect prompt
// ─────────────────────────────────────────────────────────────────────────────

function ConnectedStrip({
  address,
  providerName,
  account,
  xrp,
}: {
  address: string;
  providerName?: string;
  account: ReturnType<typeof usePersonalAccount>;
  xrp: ReturnType<typeof useXrpBalance>;
}) {
  const { openWallets } = useWalletUi();
  // The backend omits fxrpBalance on some builds — absent is "—", never 0.
  const fxrp = account.data?.fxrpBalance;
  const reservedXrp =
    xrp.data && xrp.data.reserveDrops > 0n
      ? formatToken(xrp.data.reserveDrops, 6, 0)
      : null;

  return (
    <Card className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
      <div className="flex min-w-0 items-center gap-3">
        <TokenIcon symbol="XRP" size={28} alt="" />
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm text-ink">
            <span className="h-2 w-2 shrink-0 rounded-full bg-green" aria-hidden />
            <span className="font-medium">{providerName ?? "XRPL wallet"}</span>
            <span className="truncate font-mono text-muted" title={address}>
              {shortenAddress(address)}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-muted">
            {account.isLoading ? (
              "Resolving your Flare personal account…"
            ) : account.isError ? (
              "Personal account unavailable — the backend is offline."
            ) : account.data ? (
              <>
                Personal account{" "}
                <span className="font-mono">
                  {shortenAddress(account.data.personalAccount)}
                </span>{" "}
                · FXRP {fxrp === undefined ? "—" : formatToken(BigInt(fxrp), 6, 2)}
              </>
            ) : (
              "Paying from the XRP Ledger — no Flare gas needed."
            )}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-4">
        {/* Live XRP Ledger balance — the collateral available to supply. */}
        <div className="text-right">
          <div className="text-sm font-semibold tabular-nums text-ink">
            {xrp.isLoading
              ? "…"
              : xrp.data
                ? `${formatToken(xrp.data.spendableDrops, 6, 2)} XRP`
                : "— XRP"}
          </div>
          <div className="text-[11px] text-muted">
            {xrp.isError
              ? "XRP Ledger unreachable"
              : xrp.data
                ? xrp.data.funded
                  ? `spendable${reservedXrp ? ` · ${reservedXrp} reserved` : ""}`
                  : "not funded yet — use the faucet"
                : "XRP Ledger balance"}
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={openWallets}>
          <Wallet className="h-4 w-4" aria-hidden />
          Manage wallets
        </Button>
      </div>
    </Card>
  );
}

function ConnectPrompt({
  pastedAddress,
  onPastedAddress,
  invalidPaste,
}: {
  pastedAddress: string;
  onPastedAddress: (v: string) => void;
  invalidPaste: boolean;
}) {
  const wallet = useXrplWalletContext();
  const { openWallets } = useWalletUi();
  const [showPaste, setShowPaste] = useState(false);

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <TokenIcon symbol="XRP" size={28} alt="" />
          <div className="min-w-0">
            <CardTitle>Connect your XRP wallet</CardTitle>
            <p className="mt-0.5 text-sm text-muted">
              Bring XRP straight from the XRP Ledger — no Flare wallet, no FLR gas.
            </p>
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={openWallets}>
          <Wallet className="h-4 w-4" aria-hidden />
          Open wallets
        </Button>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {XRPL_PROVIDER_ORDER.map((id) => {
          // Per-provider: only the clicked wallet reports progress.
          const busy = wallet.connectingId === id;
          return (
            <Button
              key={id}
              variant={id === "crossmark" ? "primary" : "secondary"}
              disabled={wallet.connectingId !== undefined}
              onClick={() => wallet.connect(id)}
            >
              <Wallet className="h-4 w-4" aria-hidden />
              {busy ? "Confirm in wallet…" : `Connect ${XRPL_PROVIDERS[id].name}`}
            </Button>
          );
        })}
      </div>

      {wallet.error && (
        <p className="mt-2 text-xs text-danger" role="alert">
          {wallet.error}
        </p>
      )}

      <div className="mt-4">
        <button
          type="button"
          aria-expanded={showPaste}
          onClick={() => setShowPaste((v) => !v)}
          className="inline-flex min-h-10 items-center gap-1 text-xs text-muted hover:text-ink"
        >
          <ChevronDown
            className={`h-4 w-4 transition-transform ${showPaste ? "rotate-180" : ""}`}
            aria-hidden
          />
          …or paste an r-address (sign later in Xaman)
        </button>
        {showPaste && (
          <div className="mt-2 max-w-md">
            <Field
              label="XRPL r-address"
              htmlFor="raddr"
              error={invalidPaste ? "That doesn't look like a valid r-address." : undefined}
            >
              <Input
                id="raddr"
                placeholder="r..."
                autoComplete="off"
                spellCheck={false}
                value={pastedAddress}
                onChange={(e) => onPastedAddress(e.target.value)}
              />
            </Field>
          </div>
        )}
      </div>
    </Card>
  );
}
