"use client";

// XRPL-native vault management, extracted from XrplMintFlow so the manage
// surface can mount ANYWHERE the PersonalAccount's vault shows up (the
// /borrow/xrp flow and the unified FXRP market page's position list) — a MOVE,
// not a rewrite: the tabbed Actions panel, its forms, the PaymentPanel and the
// build → sign → track pipeline are byte-identical to what /borrow/xrp always
// ran. Every action is ONE signed XRPL 0xFE payment; the client never builds
// the memo.
//
//   - useXrplPaymentPipeline — the shared build → auto-sign → submit machinery
//     (one build mutation for mint AND manage requests, sign fires on build
//     success when a wallet is connected).
//   - XrplVaultActions — the tabbed Deposit / Withdraw / Borrow / Repay /
//     Interest / Close panel (presentational; the host owns the pipeline).
//   - PaymentPanel — sign-status strip / QR + Xaman manual fallback.
//   - XrplManagePanel — the self-contained composition of all three for
//     mounting outside XrplMintFlow (position list on /borrow/fxrp).
import { useState } from "react";
import QRCode from "react-qr-code";
import { useMutation } from "@tanstack/react-query";
import {
  ChevronDown,
  Copy,
  ExternalLink,
  Loader2,
  PenLine,
  ShieldAlert,
} from "lucide-react";
import { formatUnits, type Address } from "viem";
import {
  Button,
  Card,
  CardTitle,
  Field,
  Input,
  PillButton,
  cn,
} from "@/components/ui";
import { MintStatusTracker } from "@/components/xrpl/MintStatusTracker";
import { api } from "@/lib/api/client";
import type {
  ManageAction,
  ManageBuildRequest,
  MintBuildRequest,
  MintBuildResponse,
} from "@/lib/api/types";
import { useXrplWalletContext } from "@/context/xrpl";
import { useFtsoPrice } from "@/hooks/useFtsoPrice";
import { useVaultRate } from "@/hooks/useInterest";
import { useVaultParams, type VaultParams, type VaultState } from "@/hooks/useVault";
import { useXrpBalance } from "@/hooks/useXrpBalance";
import { annualInterest18, maxMintableVusd18 } from "@/lib/vault-math";
import { XRPL_PROVIDERS } from "@/lib/xrpl/wallets";
import { BRANCHES } from "@/config/branches";
import { formatBps, formatToken, parseAmount } from "@/lib/format";

// XRPL-native collateral is always the FXRP branch (see XrplMintFlow).
const FXRP_VAULT_MANAGER = BRANCHES.fxrp.vaultManager || undefined;
const INTEREST = BRANCHES.fxrp.interest;
// XRP == FXRP: 6 decimals (drops).
const COLL_DEC = 6;

// ─────────────────────────────────────────────────────────────────────────────
// Pipeline — ONE build mutation for both sides (mint request = open, manage
// request = supply / borrow-more / repay / …), auto-sign on build success when
// a wallet is connected, then submit the tx hash for tracking. Extracted
// verbatim from XrplMintFlow, which now consumes this hook.
// ─────────────────────────────────────────────────────────────────────────────

export function useXrplPaymentPipeline() {
  const wallet = useXrplWalletContext();

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

  // Only the action currently being built shows "Generating…" — derive it from
  // the in-flight mutation variables so the sibling buttons stay idle. `busy`
  // disables every action button while a build → sign → submit is in flight.
  const pendingAction: ManageAction | undefined =
    build.isPending && build.variables && "action" in build.variables
      ? (build.variables as ManageBuildRequest).action
      : undefined;
  const busy = build.isPending || wallet.signing || submit.isPending;

  return { wallet, build, submit, xrplTxId, setXrplTxId, signAndTrack, pendingAction, busy };
}

// ─────────────────────────────────────────────────────────────────────────────
// Manage an existing vault — SAME shape as the EVM branch page: a tabbed Actions
// panel (Deposit / Withdraw / Borrow / Repay / Interest / Close). Every action is
// ONE XRPL 0xFE payment (net-0 for everything except supplying collateral).
// ─────────────────────────────────────────────────────────────────────────────

type XrplTab = "deposit" | "withdraw" | "borrow" | "repay" | "rate" | "close";
const XRPL_TABS: { id: XrplTab; label: string }[] = [
  { id: "deposit", label: "Deposit" },
  { id: "withdraw", label: "Withdraw" },
  { id: "borrow", label: "Borrow" },
  { id: "repay", label: "Repay" },
  { id: "rate", label: "Interest" },
  { id: "close", label: "Close" },
];

export function XrplVaultActions({
  vault,
  price18,
  params,
  onBuild,
  busy,
  pendingAction,
  spendableDrops,
  currentRateBps,
  xrplAddress,
}: {
  vault: VaultState;
  price18?: bigint;
  params: VaultParams;
  onBuild: (req: ManageBuildRequest) => void;
  busy: boolean;
  pendingAction?: ManageAction;
  spendableDrops?: bigint;
  currentRateBps?: bigint;
  xrplAddress: string;
}) {
  const [tab, setTab] = useState<XrplTab>("deposit");
  return (
    <Card className="flex h-full flex-col">
      <CardTitle>Actions</CardTitle>
      <div
        className="mt-4 flex overflow-x-auto rounded-full border border-line bg-surface-2 p-1"
        role="tablist"
        aria-label="Vault action"
      >
        {XRPL_TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              "min-h-10 flex-1 whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-medium transition-colors",
              tab === t.id ? "bg-navy text-white" : "text-muted hover:text-ink",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="mt-4">
        {tab === "deposit" && (
          <XrplCollateralForm
            mode="add"
            vault={vault}
            onBuild={onBuild}
            busy={busy}
            pendingAction={pendingAction}
            spendableDrops={spendableDrops}
            xrplAddress={xrplAddress}
          />
        )}
        {tab === "withdraw" && (
          <XrplCollateralForm
            mode="withdraw"
            vault={vault}
            onBuild={onBuild}
            busy={busy}
            pendingAction={pendingAction}
            xrplAddress={xrplAddress}
          />
        )}
        {tab === "borrow" && (
          <XrplDebtForm
            mode="borrow"
            vault={vault}
            price18={price18}
            params={params}
            onBuild={onBuild}
            busy={busy}
            pendingAction={pendingAction}
            xrplAddress={xrplAddress}
          />
        )}
        {tab === "repay" && (
          <XrplDebtForm
            mode="repay"
            vault={vault}
            price18={price18}
            params={params}
            onBuild={onBuild}
            busy={busy}
            pendingAction={pendingAction}
            xrplAddress={xrplAddress}
          />
        )}
        {tab === "rate" && (
          <XrplRateForm
            vault={vault}
            currentRateBps={currentRateBps}
            onBuild={onBuild}
            busy={busy}
            pendingAction={pendingAction}
            xrplAddress={xrplAddress}
          />
        )}
        {tab === "close" && (
          <XrplCloseForm
            vault={vault}
            onBuild={onBuild}
            busy={busy}
            pendingAction={pendingAction}
            xrplAddress={xrplAddress}
          />
        )}
      </div>

      <p className="mt-auto pt-4 text-xs text-muted/80">
        Every action rides ONE XRPL payment (fees only — no FXRP minted, except when
        you supply collateral). No Flare wallet or FLR gas.
      </p>
    </Card>
  );
}

// Compact interest slider — the manage/rate twin of the composer's slider.
function XrplInterestSlider({
  rateBps,
  onChange,
  debt18,
}: {
  rateBps: number;
  onChange: (bps: number) => void;
  debt18?: bigint;
}) {
  const annual = debt18 ? annualInterest18(debt18, rateBps) : undefined;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between">
        <label htmlFor="xrpl-rate" className="text-sm font-medium text-ink">
          Interest rate
        </label>
        <span className="text-sm font-semibold tabular-nums text-brand">
          {formatBps(rateBps)} / year
        </span>
      </div>
      <input
        id="xrpl-rate"
        type="range"
        min={INTEREST.minBps}
        max={INTEREST.maxBps}
        step={10}
        value={rateBps}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-valuetext={`${formatBps(rateBps)} per year`}
        className="w-full accent-[var(--color-brand)]"
      />
      <div className="flex justify-between text-xs text-muted/70">
        <span>{formatBps(INTEREST.minBps)}</span>
        <span>
          {annual !== undefined
            ? `≈ ${formatToken(annual, 18, 2)} vUSD/yr at current debt`
            : "lower rate = redeemed first"}
        </span>
        <span>{formatBps(INTEREST.maxBps)}</span>
      </div>
    </div>
  );
}

// Deposit (addCollateral, net>0) / Withdraw (withdrawCollateral, net-0).
function XrplCollateralForm({
  mode,
  vault,
  onBuild,
  busy,
  pendingAction,
  spendableDrops,
  xrplAddress,
}: {
  mode: "add" | "withdraw";
  vault: VaultState;
  onBuild: (req: ManageBuildRequest) => void;
  busy: boolean;
  pendingAction?: ManageAction;
  spendableDrops?: bigint;
  xrplAddress: string;
}) {
  const [amount, setAmount] = useState("");
  const amt6 = parseAmount(amount, COLL_DEC);
  const isAdd = mode === "add";
  const busyAction: ManageAction = isAdd ? "addCollateral" : "withdrawCollateral";
  const insufficient =
    isAdd && amt6 !== null && spendableDrops !== undefined && amt6 > spendableDrops;
  const overVault = !isAdd && amt6 !== null && amt6 > vault.collateral;
  const valid = amt6 !== null && amt6 > 0n && !insufficient && !overVault;
  const cap = isAdd ? spendableDrops : vault.collateral;
  // The XRP path reasons in XRP end-to-end (collateral is FXRP on Flare, 1:1 with
  // XRP); the amount label stays "XRP", the hint explains the FXRP mechanic.
  const capSymbol = "XRP";
  const error = insufficient
    ? `Insufficient balance — you have ${formatToken(spendableDrops!, COLL_DEC, 2)} XRP spendable.`
    : overVault
      ? `You only have ${formatToken(vault.collateral, COLL_DEC, 2)} XRP in the vault.`
      : undefined;

  return (
    <div className="flex flex-col gap-3">
      <Field
        label={isAdd ? "Supply collateral (XRP)" : "Withdraw collateral (XRP)"}
        htmlFor={`xrpl-coll-${mode}`}
        error={error}
        hint={
          isAdd
            ? "Sent from your XRP Ledger wallet · becomes FXRP collateral on Flare"
            : "Returned as FXRP (1:1 with XRP) to your Flare personal account · one XRPL payment (fees only)"
        }
      >
        <Input
          id={`xrpl-coll-${mode}`}
          inputMode="decimal"
          placeholder="0.0"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
      </Field>
      {cap !== undefined && (
        <div className="-mt-1 flex items-center justify-between text-xs">
          <span className="text-muted/70">
            Balance {formatToken(cap, COLL_DEC, isAdd ? 2 : 4)} {capSymbol}
          </span>
          <button
            type="button"
            onClick={() => setAmount(formatToken(cap, COLL_DEC, isAdd ? 2 : 6).replace(/,/g, ""))}
            className="min-h-8 rounded-full px-2 font-medium text-brand hover:underline"
          >
            Max
          </button>
        </div>
      )}
      <Button
        disabled={!valid || busy}
        onClick={() => amt6 && onBuild({ xrplAddress, action: busyAction, collateral6: amt6.toString() })}
      >
        {pendingAction === busyAction
          ? "Generating…"
          : isAdd
            ? "Supply collateral"
            : "Withdraw collateral"}
      </Button>
    </div>
  );
}

// Borrow more (mintMore) / Repay — both net-0 fees-only payments.
function XrplDebtForm({
  mode,
  vault,
  price18,
  params,
  onBuild,
  busy,
  pendingAction,
  xrplAddress,
}: {
  mode: "borrow" | "repay";
  vault: VaultState;
  price18?: bigint;
  params: VaultParams;
  onBuild: (req: ManageBuildRequest) => void;
  busy: boolean;
  pendingAction?: ManageAction;
  xrplAddress: string;
}) {
  const [amount, setAmount] = useState("");
  const amt18 = parseAmount(amount, 18);
  const isBorrow = mode === "borrow";
  const busyAction: ManageAction = isBorrow ? "mintMore" : "repay";

  const maxMint = price18
    ? maxMintableVusd18(vault.collateral, COLL_DEC, price18, params.mcrBps, params.mintFeeBps)
    : undefined;
  const maxMore = maxMint !== undefined && maxMint > vault.debt18 ? maxMint - vault.debt18 : 0n;
  const overMore = isBorrow && amt18 !== null && maxMint !== undefined && amt18 > maxMore;

  const remaining = amt18 !== null ? vault.debt18 - amt18 : vault.debt18;
  const overRepay = !isBorrow && amt18 !== null && amt18 > vault.debt18;
  const belowMin = !isBorrow && amt18 !== null && remaining > 0n && remaining < params.minDebt18;

  const valid = isBorrow
    ? amt18 !== null && amt18 > 0n && !overMore
    : amt18 !== null &&
      amt18 > 0n &&
      amt18 <= vault.debt18 &&
      (remaining === 0n || remaining >= params.minDebt18);

  const error = isBorrow
    ? overMore
      ? `Exceeds the max borrow for this collateral (${formatToken(maxMore, 18, 2)} vUSD).`
      : undefined
    : overRepay
      ? `You can't repay more than the ${formatToken(vault.debt18, 18, 2)} vUSD debt.`
      : belowMin
        ? `That leaves the debt below the ${formatToken(params.minDebt18, 18, 0)} vUSD minimum — repay less, or close the vault.`
        : undefined;

  return (
    <div className="flex flex-col gap-3">
      <Field
        label={isBorrow ? "Borrow more vUSD" : "Repay vUSD"}
        htmlFor={`xrpl-debt-${mode}`}
        error={error}
        hint={
          isBorrow
            ? maxMint !== undefined
              ? `Max +${formatToken(maxMore, 18, 2)} vUSD at the current price`
              : "Borrow more against your collateral"
            : `Outstanding debt ${formatToken(vault.debt18, 18, 2)} vUSD`
        }
      >
        <Input
          id={`xrpl-debt-${mode}`}
          inputMode="decimal"
          placeholder="0.0"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
      </Field>
      {!isBorrow && (
        <div className="-mt-1 flex items-center justify-end text-xs">
          {/* Full-precision string (not a rounded display value) so a full
              repay leaves zero debt, never dust below the minimum. */}
          <button
            type="button"
            onClick={() => setAmount(formatUnits(vault.debt18, 18))}
            className="min-h-8 rounded-full px-2 font-medium text-brand hover:underline"
          >
            Repay full debt
          </button>
        </div>
      )}
      <Button
        disabled={!valid || busy}
        onClick={() => amt18 && onBuild({ xrplAddress, action: busyAction, amount18: amt18.toString() })}
      >
        {pendingAction === busyAction ? "Generating…" : isBorrow ? "Borrow" : "Repay"}
      </Button>
    </div>
  );
}

// Adjust interest rate (adjustRate, net-0).
function XrplRateForm({
  vault,
  currentRateBps,
  onBuild,
  busy,
  pendingAction,
  xrplAddress,
}: {
  vault: VaultState;
  currentRateBps?: bigint;
  onBuild: (req: ManageBuildRequest) => void;
  busy: boolean;
  pendingAction?: ManageAction;
  xrplAddress: string;
}) {
  const initial = currentRateBps !== undefined ? Number(currentRateBps) : INTEREST.defaultBps;
  const [rateBps, setRateBps] = useState(initial);
  const clamped = Math.min(Math.max(rateBps, INTEREST.minBps), INTEREST.maxBps);
  const changed = currentRateBps === undefined || BigInt(clamped) !== currentRateBps;

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted">
        Your current rate is{" "}
        <span className="font-medium text-ink">
          {currentRateBps !== undefined ? `${formatBps(Number(currentRateBps))} / year` : "—"}
        </span>
        . A lower rate is cheaper to carry but is redeemed first.
      </p>
      <XrplInterestSlider rateBps={clamped} onChange={setRateBps} debt18={vault.debt18} />
      <Button
        disabled={busy || !changed}
        onClick={() => onBuild({ xrplAddress, action: "adjustRate", newRateBps: String(clamped) })}
      >
        {pendingAction === "adjustRate" ? "Generating…" : "Update interest rate"}
      </Button>
    </div>
  );
}

// Close the vault (repay full debt + return collateral, net-0).
function XrplCloseForm({
  vault,
  onBuild,
  busy,
  pendingAction,
  xrplAddress,
}: {
  vault: VaultState;
  onBuild: (req: ManageBuildRequest) => void;
  busy: boolean;
  pendingAction?: ManageAction;
  xrplAddress: string;
}) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted">
        Closing repays the full debt ({formatToken(vault.debt18, 18, 2)} vUSD) and returns
        all collateral to your personal account. One XRPL payment (fees only) — you must
        hold enough vUSD to cover the debt.
      </p>
      <Button
        variant="secondary"
        disabled={busy}
        onClick={() => onBuild({ xrplAddress, action: "close" })}
      >
        {pendingAction === "close" ? "Generating…" : "Close vault"}
      </Button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PaymentPanel — sign-status strip (connected wallet) / QR + Xaman manual path
// ─────────────────────────────────────────────────────────────────────────────

export function PaymentPanel({
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

// ─────────────────────────────────────────────────────────────────────────────
// XrplManagePanel — the standalone composition: Actions + sign strip + tracker,
// with its own pipeline. Mount it wherever the PA vault surfaces outside
// /borrow/xrp (the unified market page's position list).
// ─────────────────────────────────────────────────────────────────────────────

export function XrplManagePanel({
  rAddress,
  personalAccount,
  vault,
  onVaultChanged,
}: {
  /** The XRPL r-address the payments are built for (the connected wallet). */
  rAddress: string;
  /** The derived Flare PersonalAccount that owns the vault. */
  personalAccount: Address;
  vault: VaultState;
  /** Fired when an action lands on-chain (EXECUTED) — refetch the vault. */
  onVaultChanged?: () => void;
}) {
  const { wallet, build, submit, xrplTxId, setXrplTxId, signAndTrack, pendingAction, busy } =
    useXrplPaymentPipeline();
  const { price18 } = useFtsoPrice(BRANCHES.fxrp.feedId);
  const { params } = useVaultParams(FXRP_VAULT_MANAGER);
  const { rateBps: currentRateBps } = useVaultRate(personalAccount, FXRP_VAULT_MANAGER);
  const xrpBalance = useXrpBalance(rAddress);

  return (
    <div className="flex h-full flex-col gap-6">
      <XrplVaultActions
        vault={vault}
        price18={price18}
        params={params}
        onBuild={(req) => build.mutate(req)}
        busy={busy}
        pendingAction={pendingAction}
        spendableDrops={xrpBalance.data?.spendableDrops}
        currentRateBps={currentRateBps}
        xrplAddress={rAddress}
      />

      {build.data && !submit.data && (
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
      )}

      {submit.data && (
        <MintStatusTracker
          mintId={submit.data.mintId}
          action={
            build.variables && "action" in build.variables ? build.variables.action : "open"
          }
          onExecuted={() => {
            onVaultChanged?.();
            xrpBalance.refetch();
          }}
        />
      )}
    </div>
  );
}
