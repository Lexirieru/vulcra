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
import QRCode from "react-qr-code";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  ArrowDown,
  ChevronDown,
  Copy,
  ExternalLink,
  Gauge,
  Info,
  Loader2,
  PenLine,
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
import { api } from "@/lib/api/client";
import type { MintBuildRequest, MintBuildResponse, ManageBuildRequest, ManageAction } from "@/lib/api/types";
import { usePersonalAccount, isValidRAddress } from "@/hooks/usePersonalAccount";
import { useXrplWalletContext } from "@/context/xrpl";
import { useWalletUi } from "@/context/wallet-ui";
import { useFtsoPrice } from "@/hooks/useFtsoPrice";
import { useVault, useVaultParams, type VaultParams, type VaultState } from "@/hooks/useVault";
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
  const derived = useMemo(() => {
    const fee = mint18 !== null ? (mint18 * params.mintFeeBps) / 10_000n : 0n;
    const debt = mint18 !== null ? mint18 + fee : 0n;
    const collateralUsd =
      collateral6 !== null && price18
        ? collateralValueUsd18(collateral6, COLL_DEC, price18)
        : undefined;
    const maxMint =
      collateral6 !== null && price18
        ? maxMintableVusd18(collateral6, COLL_DEC, price18, params.mcrBps)
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

  const [xrplTxId, setXrplTxId] = useState("");
  const submit = useMutation({
    mutationFn: ({ txId, built }: { txId: string; built: MintBuildResponse }) =>
      api.submitMint({
        packedUserOpHex: built.packedUserOpHex,
        memoUserOpHash: built.memoUserOpHash,
        xrplTxId: txId.trim(),
      }),
  });

  // Sign the backend-built Payment in the connected XRPL wallet, then submit the
  // resulting tx hash for tracking. Takes the built plan explicitly so it can run
  // straight from build.onSuccess (auto-sign) without waiting on a state flush.
  async function signAndTrack(built: MintBuildResponse) {
    const hash = await wallet.signPayment({
      destination: built.payment.destination,
      amountDrops: built.payment.amountDrops,
      memoHex: built.payment.memoHex,
    });
    if (hash) {
      setXrplTxId(hash);
      submit.mutate({ txId: hash, built });
    }
  }

  // ONE build mutation for both sides: a mint request (open) or a manage request
  // (supply / borrow-more / repay / close). Both return the identical
  // MintBuildResponse. With a wallet connected the sign fires the instant the
  // payment is built, so clicking an action opens Crossmark directly — there is
  // no separate "sign the payment" step to hunt for.
  const build = useMutation<MintBuildResponse, Error, MintBuildRequest | ManageBuildRequest>({
    mutationFn: (req) => ("action" in req ? api.buildManage(req) : api.buildMint(req)),
    onSuccess: (data) => {
      if (wallet.address) void signAndTrack(data);
    },
  });
  const generateMint = () =>
    build.mutate({
      xrplAddress: rAddress.trim(),
      collateral6: collateral6!.toString(),
      mint18: mint18!.toString(),
      annualInterestRateBps: String(clampedRate),
    });

  // Only the action currently being built shows "Generating…" — derive it from
  // the in-flight mutation variables so the sibling buttons stay idle. `busy`
  // disables every action button while a build → sign → submit is in flight.
  const pendingAction: ManageAction | undefined =
    build.isPending && build.variables && "action" in build.variables
      ? (build.variables as ManageBuildRequest).action
      : undefined;
  const busy = build.isPending || wallet.signing || submit.isPending;

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

      {/* MANAGE — the PersonalAccount already has an FXRP vault: repay / close
          from the XRP Ledger (0xFE net-0, fees-only payment). No second vault. */}
      {account.data && hasVault && vault && (
        <Reveal>
          <XrplManagePanel
            vault={vault}
            price18={price18}
            params={params}
            onBuild={(req) => build.mutate(req)}
            busy={busy}
            pendingAction={pendingAction}
            spendableDrops={xrpBalance.data?.spendableDrops}
            xrplAddress={rAddress.trim()}
          />
        </Reveal>
      )}

      {/* Composer — Collateral (XRP) → Loan (vUSD) → Interest rate, identical in
          shape to the Flare-wallet borrow composer. The action is ONE XRPL
          payment instead of an EVM tx. Shown only when there is no vault yet. */}
      {account.data && !hasVault && (
        <>
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

// ─────────────────────────────────────────────────────────────────────────────
// Manage an existing vault — repay / close from the XRP Ledger (0xFE net-0)
// ─────────────────────────────────────────────────────────────────────────────

function XrplManagePanel({
  vault,
  price18,
  params,
  onBuild,
  busy,
  pendingAction,
  spendableDrops,
  xrplAddress,
}: {
  vault: VaultState;
  price18?: bigint;
  params: VaultParams;
  onBuild: (req: ManageBuildRequest) => void;
  busy: boolean;
  /** The action whose payment is currently building — only its button spins. */
  pendingAction?: ManageAction;
  /** Spendable XRP (drops) in the connected wallet — caps the supply input. */
  spendableDrops?: bigint;
  xrplAddress: string;
}) {
  const [repay, setRepay] = useState("");
  const [borrow, setBorrow] = useState("");
  const [supply, setSupply] = useState("");
  const repay18 = parseAmount(repay, 18);
  const borrow18 = parseAmount(borrow, 18);
  const supply6 = parseAmount(supply, 6);
  const supplyExceedsBalance =
    supply6 !== null && spendableDrops !== undefined && supply6 > spendableDrops;
  const supplyValid = supply6 !== null && supply6 > 0n && !supplyExceedsBalance;
  const crBps = price18 ? computeCrBps(vault.collateral, COLL_DEC, vault.debt18, price18) : null;
  const band = healthBand(crBps, params.mcrBps);
  const remaining = repay18 !== null ? vault.debt18 - repay18 : vault.debt18;
  const belowMin = repay18 !== null && remaining > 0n && remaining < params.minDebt18;
  const repayValid =
    repay18 !== null &&
    repay18 > 0n &&
    repay18 <= vault.debt18 &&
    (remaining === 0n || remaining >= params.minDebt18);

  // Borrow-more headroom: max total debt at MCR minus the current debt.
  const maxMint = price18
    ? maxMintableVusd18(vault.collateral, COLL_DEC, price18, params.mcrBps)
    : undefined;
  const maxMore = maxMint !== undefined && maxMint > vault.debt18 ? maxMint - vault.debt18 : 0n;
  const overMore = borrow18 !== null && maxMint !== undefined && borrow18 > maxMore;
  const borrowValid = borrow18 !== null && borrow18 > 0n && !overMore;

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <CardTitle>Your XRP vault</CardTitle>
        <Badge tone={band === "danger" ? "danger" : band === "warning" ? "warning" : "green"}>
          {crBps === null ? "—" : `${formatBps(crBps)} CR`}
        </Badge>
      </div>

      <div className="space-y-1.5 border-t border-line pt-3">
        <InfoRow left="Collateral" right={`${formatToken(vault.collateral, COLL_DEC, 2)} FXRP`} />
        <InfoRow left="Debt" right={`${formatToken(vault.debt18, 18, 2)} vUSD`} />
        <InfoRow left="Min debt" right={`${formatToken(params.minDebt18, 18, 0)} vUSD`} />
      </div>

      {/* Supply MORE collateral (send XRP → mint FXRP → addCollateral) */}
      <div className="space-y-2 border-t border-line pt-3">
        <Field
          label="Supply collateral (XRP)"
          htmlFor="xrpl-supply"
          hint="Sent from your XRP Ledger wallet · becomes FXRP collateral on Flare"
        >
          <Input
            id="xrpl-supply"
            inputMode="decimal"
            placeholder="0.0"
            value={supply}
            onChange={(e) => setSupply(e.target.value)}
          />
        </Field>
        {spendableDrops !== undefined && (
          <div className="flex items-center justify-between text-xs">
            <span className={supplyExceedsBalance ? "text-danger" : "text-muted/70"}>
              {supplyExceedsBalance
                ? `Insufficient balance — you have ${formatToken(spendableDrops, 6, 2)} XRP spendable.`
                : `Balance ${formatToken(spendableDrops, 6, 2)} XRP`}
            </span>
            <button
              type="button"
              onClick={() => setSupply(formatToken(spendableDrops, 6, 2).replace(/,/g, ""))}
              className="min-h-8 rounded-full px-2 font-medium text-brand hover:underline"
            >
              Max
            </button>
          </div>
        )}
        <PillButton
          size="md"
          className="w-full"
          disabled={!supplyValid || busy}
          onClick={() => onBuild({ xrplAddress, action: "addCollateral", collateral6: supply6!.toString() })}
        >
          {pendingAction === "addCollateral" ? "Generating…" : "Supply collateral"}
        </PillButton>
      </div>

      {/* Borrow MORE against the existing collateral (mintMore) */}
      <div className="space-y-2 border-t border-line pt-3">
        <Field
          label="Borrow more (vUSD)"
          htmlFor="xrpl-mintmore"
          hint={
            maxMint !== undefined
              ? `Max +${formatToken(maxMore, 18, 2)} vUSD at the current price`
              : "Borrow more against your collateral"
          }
        >
          <Input
            id="xrpl-mintmore"
            inputMode="decimal"
            placeholder="0.0"
            value={borrow}
            onChange={(e) => setBorrow(e.target.value)}
          />
        </Field>
        {overMore && (
          <p className="text-xs text-danger">
            Exceeds the max borrow for this collateral — add collateral or borrow less.
          </p>
        )}
        <PillButton
          size="md"
          className="w-full"
          disabled={!borrowValid || busy}
          onClick={() => onBuild({ xrplAddress, action: "mintMore", amount18: borrow18!.toString() })}
        >
          {pendingAction === "mintMore" ? "Generating…" : "Borrow more"}
        </PillButton>
      </div>

      {/* Repay / close */}
      <div className="space-y-2 border-t border-line pt-3">
        <Field
          label="Repay (vUSD)"
          htmlFor="xrpl-repay"
          hint="Burned from your Flare personal account · one XRPL payment (fees only)"
        >
          <Input
            id="xrpl-repay"
            inputMode="decimal"
            placeholder="0.0"
            value={repay}
            onChange={(e) => setRepay(e.target.value)}
          />
        </Field>
        {belowMin && (
          <p className="text-xs text-danger">
            That would leave the debt below the {formatToken(params.minDebt18, 18, 0)} vUSD
            minimum — repay less, or close the vault.
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <PillButton
            size="md"
            className="flex-1"
            disabled={!repayValid || busy}
            onClick={() => onBuild({ xrplAddress, action: "repay", amount18: repay18!.toString() })}
          >
            {pendingAction === "repay" ? "Generating…" : "Repay"}
          </PillButton>
          <PillButton
            size="md"
            variant="ghost"
            className="flex-1"
            disabled={busy}
            onClick={() => onBuild({ xrplAddress, action: "close" })}
          >
            {pendingAction === "close" ? "Generating…" : "Close vault"}
          </PillButton>
        </div>
      </div>
      <p className="text-xs text-muted/80">
        Borrow-more, repay and close each ride ONE XRPL payment (fees only — no FXRP minted).
        Closing repays the full debt and returns your FXRP collateral to the personal account.
      </p>
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

function PaymentPanel({
  intent,
  xrplTxId,
  onXrplTxId,
  onSubmit,
  submitting,
  submitError,
  walletConnected,
  walletName,
  onWalletSign,
  signing,
  walletError,
}: {
  intent: MintBuildResponse;
  xrplTxId: string;
  onXrplTxId: (v: string) => void;
  onSubmit: () => void;
  submitting: boolean;
  submitError: boolean;
  walletConnected: boolean;
  walletName?: string;
  onWalletSign: () => void;
  signing: boolean;
  walletError?: string;
}) {
  // With a wallet connected the in-wallet sign is THE path; the QR / paste
  // fallback tucks behind a disclosure so the panel stays clean. With no wallet
  // (pasted r-address) the manual path is shown outright.
  const [showManual, setShowManual] = useState(!walletConnected);

  const manual = (
    <div className="mt-3 grid gap-5 sm:grid-cols-[auto_1fr] sm:items-start">
      <div className="flex flex-col items-center gap-2 rounded-xl border border-line bg-white p-3">
        <QRCode value={intent.qrData} size={148} />
        <p className="max-w-[148px] text-center text-[11px] leading-tight text-muted">
          Core Vault — send exactly {intent.requiredPaymentXrp} XRP with the memo, no
          destination tag.
        </p>
      </div>
      <div className="flex flex-col gap-3">
        {intent.xamanDeepLink && (
          <PillButton
            href={intent.xamanDeepLink}
            target="_blank"
            rel="noopener noreferrer"
            size="sm"
            className="w-fit"
          >
            Open in Xaman <ExternalLink className="h-4 w-4" aria-hidden />
          </PillButton>
        )}
        <div className="rounded-xl border border-line bg-surface-2/60 p-3">
          <div className="text-xs uppercase tracking-wide text-muted">0xFE memo</div>
          <div className="mt-1 flex items-center gap-2">
            <code className="truncate font-mono text-xs text-muted/80">{intent.payment.memoHex}</code>
            <button
              type="button"
              aria-label="Copy memo"
              onClick={() => navigator.clipboard?.writeText(intent.payment.memoHex)}
              className="grid size-9 shrink-0 place-items-center rounded-full text-muted hover:text-ink"
            >
              <Copy className="h-4 w-4" aria-hidden />
            </button>
          </div>
        </div>
        <Field
          label="XRPL transaction id (after signing)"
          htmlFor="xrpltx"
          hint="Your wallet returns this once the Payment is submitted"
        >
          <Input
            id="xrpltx"
            placeholder="tx hash"
            value={xrplTxId}
            onChange={(e) => onXrplTxId(e.target.value)}
          />
        </Field>
        <Button disabled={!xrplTxId.trim() || submitting} onClick={onSubmit}>
          {submitting ? "Submitting…" : "Track my mint"}
        </Button>
        {submitError && (
          <p className="text-sm text-danger">
            Couldn&apos;t submit — the backend is unavailable.
          </p>
        )}
      </div>
    </div>
  );

  // Connected wallet → the sign already fired automatically the instant the
  // payment was built (the parent calls signAndTrack in build.onSuccess). This is
  // a slim STATUS strip, not an extra step: it shows "confirm in your wallet"
  // while the popup is open, and only turns into a real button if the user
  // rejected it and needs to try again. The QR/manual path stays behind a
  // disclosure for anyone who'd rather pay from a different XRPL wallet.
  if (walletConnected) {
    return (
      <Card className="flex flex-col gap-3">
        {walletError ? (
          <div className="flex flex-col gap-2 rounded-xl border border-danger/30 bg-danger/5 p-4">
            <div className="flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-danger" aria-hidden />
              <span className="text-sm font-medium text-ink">Signing didn&apos;t go through</span>
            </div>
            <p className="text-xs text-danger">{walletError}</p>
            <Button onClick={onWalletSign} disabled={signing || submitting} className="mt-1">
              <PenLine className="h-4 w-4" aria-hidden />
              {signing ? "Confirm in wallet…" : `Sign again in ${walletName ?? "wallet"}`}
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-3 rounded-xl border border-brand/20 bg-brand/5 p-4">
            <Loader2 className="h-5 w-5 shrink-0 text-brand motion-safe:animate-spin" aria-hidden />
            <div className="min-w-0">
              <p className="text-sm font-medium text-ink">
                Confirm in {walletName ?? "your wallet"}
              </p>
              <p className="text-xs text-muted">
                Approve the Payment to finish — the 0xFE memo is already set, don&apos;t add a
                destination tag. Vulcra tracks it automatically once you sign.
              </p>
              <p className="mt-1 text-[11px] leading-tight text-muted/80">
                Can&apos;t reach the Approve button? Crossmark&apos;s popup doesn&apos;t always
                scroll — two-finger scroll inside it or drag it taller, or pay via QR below.
              </p>
            </div>
          </div>
        )}

        <div>
          <button
            type="button"
            aria-expanded={showManual}
            onClick={() => setShowManual((v) => !v)}
            className="inline-flex min-h-10 items-center gap-1 text-xs font-medium text-muted hover:text-ink"
          >
            <ChevronDown
              className={`h-4 w-4 transition-transform ${showManual ? "rotate-180" : ""}`}
              aria-hidden
            />
            Pay from a different XRPL wallet (QR / Xaman)
          </button>
          {showManual && manual}
        </div>
      </Card>
    );
  }

  // No wallet (pasted r-address) → the manual QR / paste path outright.
  return (
    <Card>
      <CardTitle>Sign the payment</CardTitle>
      <p className="mt-2 text-sm text-muted">
        The 0xFE memo is built by the backend and sent to your wallet verbatim.
        Never add a destination tag.
      </p>
      <p className="mt-4 text-xs font-medium uppercase tracking-wide text-muted/80">
        Pay from any XRPL wallet
      </p>
      {manual}
    </Card>
  );
}
