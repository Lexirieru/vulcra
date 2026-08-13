"use client";

// Vault write actions (U7), branch-aware and mapped 1:1 to the real VaultManager:
// addCollateral / withdrawCollateral / mintMore / repay / adjustInterestRate /
// closeVault. Opening a vault is BorrowComposer's job — this panel only mounts
// when a vault exists. Collateral deposits gate on an ERC-20 approval; the wFLR
// branch also offers a "wrap C2FLR → wFLR" helper (collateral is obtained by
// wrapping, not a faucet). vUSD is burned from the caller by the protocol, so
// repay/close need no approval.
//
// Parity with the XRPL twin (XrplVaultActions): every form bounds its input
// (wallet balance, vault collateral, max borrow at MCR, outstanding debt, the
// min-debt floor) and previews the collateral ratio AFTER the action via the
// shared vault-math — the two rails must feel identical.
import { useEffect, useState } from "react";
import { formatUnits, zeroAddress, type Address } from "viem";
import { Badge, Button, Card, CardTitle, Field, Input, cn } from "@/components/ui";
import { TxStatus } from "./TxStatus";
import { useVaultAction, useTokenApproval, useWrapNative } from "@/hooks/useVaultAction";
import { useWalletBalances } from "@/hooks/useWalletBalances";
import { useInterestConfig, useVaultRate } from "@/hooks/useInterest";
import type { InterestConfig } from "@/hooks/useInterest";
import type { VaultParams, VaultState } from "@/hooks/useVault";
import type { CollateralBranch } from "@/config/branches";
import {
  annualInterest18,
  computeCrBps,
  healthBand,
  maxMintableVusd18,
} from "@/lib/vault-math";
import { formatBps, formatToken, parseAmount } from "@/lib/format";

const HINTS = [zeroAddress, zeroAddress] as const; // contract falls back to a bounded descent

type Tab = "deposit" | "withdraw" | "borrow" | "repay" | "rate" | "close";
const TABS: { id: Tab; label: string }[] = [
  { id: "deposit", label: "Deposit" },
  { id: "withdraw", label: "Withdraw" },
  { id: "borrow", label: "Borrow" },
  { id: "repay", label: "Repay" },
  { id: "rate", label: "Interest" },
  { id: "close", label: "Close" },
];

// Reusable interest-rate slider (Enosys-style "X % per year") with the annual
// cost at the given debt. Bounds come from the contract config.
function InterestSlider({
  config,
  rateBps,
  onChange,
  debt18,
}: {
  config: InterestConfig;
  rateBps: number;
  onChange: (bps: number) => void;
  debt18?: bigint;
}) {
  const annual = debt18 ? annualInterest18(debt18, rateBps) : undefined;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between">
        <label htmlFor="interest-rate" className="text-sm font-medium text-ink">
          Interest rate
        </label>
        <span className="text-sm font-semibold tabular-nums text-brand">
          {formatBps(rateBps)} / year
        </span>
      </div>
      <input
        id="interest-rate"
        type="range"
        min={config.minBps}
        max={config.maxBps}
        step={10}
        value={rateBps}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-valuetext={`${formatBps(rateBps)} per year`}
        className="w-full accent-[var(--color-brand)]"
      />
      <div className="flex justify-between text-xs text-muted/70">
        <span>{formatBps(config.minBps)}</span>
        <span>
          {annual !== undefined
            ? `≈ ${formatToken(annual, 18, 2)} vUSD/yr at current debt`
            : "lower rate = redeemed first"}
        </span>
        <span>{formatBps(config.maxBps)}</span>
      </div>
    </div>
  );
}

// "Collateral ratio after" preview — the Aave-style health read on every form.
// Renders only once a valid amount is typed and the live price is in.
function CrAfterRow({
  collateralAfter,
  debtAfter,
  collDec,
  price18,
  mcrBps,
}: {
  collateralAfter: bigint;
  debtAfter: bigint;
  collDec: number;
  price18?: bigint;
  mcrBps: bigint;
}) {
  if (!price18) return null;
  const crBps = computeCrBps(collateralAfter, collDec, debtAfter, price18);
  const band = healthBand(crBps, mcrBps);
  return (
    <div className="-mt-1 flex items-center justify-between text-xs">
      <span className="text-muted/70">Collateral ratio after</span>
      <span className="inline-flex items-center gap-1.5 tabular-nums text-ink">
        {crBps === null ? "∞ (debt-free)" : formatBps(crBps)}
        {crBps !== null && (
          <Badge tone={band === "danger" ? "danger" : band === "warning" ? "warning" : "green"}>
            {band === "danger" ? "Below MCR" : band === "warning" ? "Watch" : "Healthy"}
          </Badge>
        )}
      </span>
    </div>
  );
}

export function VaultActions({
  vault,
  price18,
  params,
  branch,
  collateralToken,
  owner,
  disabled,
}: {
  vault: VaultState;
  price18?: bigint;
  params: VaultParams;
  branch: CollateralBranch;
  collateralToken?: Address;
  owner?: Address;
  disabled?: boolean;
}) {
  const [tab, setTab] = useState<Tab>("deposit");
  const action = useVaultAction(branch.vaultManager || undefined);
  const blocked = disabled || !action.configured;
  const collDec = branch.collateralDecimals;
  const { config: interest } = useInterestConfig(
    branch.vaultManager || undefined,
    branch.interest,
  );
  const { rateBps: currentRate } = useVaultRate(owner, branch.vaultManager || undefined);
  // Live wallet balances to cap deposit (collateral) and repay (vUSD) inputs.
  const balances = useWalletBalances(owner);
  const collBalance = balances.tokens.find((t) => t.symbol === branch.collateralSymbol)?.value;
  const vusdBalance = balances.tokens.find((t) => t.symbol === "vUSD")?.value;

  return (
    <Card className="flex h-full flex-col">
      <CardTitle>Actions</CardTitle>

      {branch.wrapNative && (
        <WrapPanel wnat={collateralToken} disabled={blocked} symbol={branch.collateralSymbol} />
      )}

      <div
        className="mt-4 flex overflow-x-auto rounded-full border border-line bg-surface-2 p-1"
        role="tablist"
        aria-label="Vault action"
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => {
              // A stale "Confirmed"/error from the previous tab must not haunt
              // the next one — reset the shared tx lifecycle on every switch.
              if (tab !== t.id) action.reset();
              setTab(t.id);
            }}
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
          <CollateralForm
            mode="add"
            vault={vault}
            price18={price18}
            params={params}
            collDec={collDec}
            symbol={branch.collateralSymbol}
            action={action}
            collateralToken={collateralToken}
            vaultManager={branch.vaultManager || undefined}
            owner={owner}
            collBalance={collBalance}
            blocked={blocked}
          />
        )}
        {tab === "withdraw" && (
          <CollateralForm
            mode="withdraw"
            vault={vault}
            price18={price18}
            params={params}
            collDec={collDec}
            symbol={branch.collateralSymbol}
            action={action}
            blocked={blocked}
          />
        )}
        {tab === "borrow" && (
          <DebtForm
            mode="borrow"
            vault={vault}
            price18={price18}
            params={params}
            collDec={collDec}
            action={action}
            blocked={blocked}
          />
        )}
        {tab === "repay" && (
          <DebtForm
            mode="repay"
            vault={vault}
            price18={price18}
            params={params}
            collDec={collDec}
            action={action}
            vusdBalance={vusdBalance}
            blocked={blocked}
          />
        )}
        {tab === "rate" && (
          <RateForm
            key={String(currentRate)}
            action={action}
            interest={interest}
            currentRateBps={currentRate}
            debt18={vault.debt18}
            blocked={blocked}
          />
        )}
        {tab === "close" && <CloseForm vault={vault} action={action} blocked={blocked} />}
      </div>

      <TxStatus phase={action.phase} hash={action.hash} error={action.error} />
    </Card>
  );
}

type Action = ReturnType<typeof useVaultAction>;

// ── Wrap C2FLR → wFLR (WNat.deposit) ─────────────────────────────────────────
function WrapPanel({
  wnat,
  symbol,
  disabled,
}: {
  wnat?: Address;
  symbol: string;
  disabled?: boolean;
}) {
  const [amount, setAmount] = useState("");
  const wei = parseAmount(amount, 18);
  const wrap = useWrapNative(wnat);
  const valid = wei !== null && wei > 0n && Boolean(wnat);

  return (
    <div className="mt-4 rounded-xl border border-line bg-surface-2/70 p-4">
      <div className="text-sm font-medium text-ink">Wrap C2FLR → {symbol}</div>
      <p className="mt-1 text-xs text-muted">
        {symbol} is wrapped native C2FLR. Wrap here, then deposit it as collateral.
      </p>
      <form
        className="mt-3 flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid && !disabled) wrap.wrap(wei);
        }}
      >
        <div className="flex-1">
          <Field label="C2FLR to wrap" htmlFor="wrap-amount">
            <Input
              id="wrap-amount"
              inputMode="decimal"
              placeholder="0.0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </Field>
        </div>
        <Button type="submit" variant="secondary" disabled={!valid || disabled || wrap.isBusy}>
          {wrap.isBusy ? "Wrapping…" : "Wrap"}
        </Button>
      </form>
      <TxStatus phase={wrap.phase} hash={wrap.hash} error={wrap.error} />
    </div>
  );
}

// ── Add / withdraw collateral ────────────────────────────────────────────────
function CollateralForm({
  mode,
  vault,
  price18,
  params,
  collDec,
  symbol,
  action,
  collateralToken,
  vaultManager,
  owner,
  collBalance,
  blocked,
}: {
  mode: "add" | "withdraw";
  vault: VaultState;
  price18?: bigint;
  params: VaultParams;
  collDec: number;
  symbol: string;
  action: Action;
  collateralToken?: Address;
  vaultManager?: Address;
  owner?: Address;
  collBalance?: bigint;
  blocked: boolean;
}) {
  const [amount, setAmount] = useState("");
  const amt = parseAmount(amount, collDec);
  const isAdd = mode === "add";
  // "Add" spends wallet balance; "withdraw" is bounded by the vault collateral.
  const insufficient =
    isAdd && amt !== null && collBalance !== undefined && amt > collBalance;
  const overVault = !isAdd && amt !== null && amt > vault.collateral;
  const valid = amt !== null && amt > 0n && !insufficient && !overVault;
  const cap = isAdd ? collBalance : vault.collateral;

  // Collateral after the action — feeds the CR preview.
  const collateralAfter =
    amt !== null && amt > 0n && !overVault
      ? isAdd
        ? vault.collateral + amt
        : vault.collateral - amt
      : undefined;

  const approval = useTokenApproval(
    mode === "add" ? collateralToken : undefined,
    vaultManager,
    owner,
  );
  useEffect(() => {
    if (approval.approved) approval.refetchAllowance();
  }, [approval.approved]); // eslint-disable-line react-hooks/exhaustive-deps
  const needsApproval =
    mode === "add" &&
    amt !== null &&
    amt > 0n &&
    !insufficient &&
    (approval.allowance === undefined || approval.allowance < amt);

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid || blocked) return;
        action.execute(mode === "add" ? "addCollateral" : "withdrawCollateral", [amt, ...HINTS]);
      }}
    >
      <Field
        label={`${mode === "add" ? "Add" : "Withdraw"} ${symbol}`}
        htmlFor={`col-${mode}`}
        error={
          insufficient
            ? `Insufficient ${symbol} — you have ${formatToken(collBalance!, collDec, 4)}.`
            : overVault
              ? `You only have ${formatToken(vault.collateral, collDec, 4)} ${symbol} in the vault.`
              : undefined
        }
      >
        <Input
          id={`col-${mode}`}
          inputMode="decimal"
          placeholder="0.0"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
      </Field>
      {cap !== undefined && (
        <div className="-mt-1 flex items-center justify-between text-xs">
          <span className="text-muted/70">
            {isAdd ? "Balance" : "In vault"} {formatToken(cap, collDec, 4)} {symbol}
          </span>
          <button
            type="button"
            onClick={() => setAmount(formatUnits(cap, collDec))}
            className="min-h-8 rounded-full px-2 font-medium text-brand hover:underline"
          >
            Max
          </button>
        </div>
      )}
      {collateralAfter !== undefined && (
        <CrAfterRow
          collateralAfter={collateralAfter}
          debtAfter={vault.debt18}
          collDec={collDec}
          price18={price18}
          mcrBps={params.mcrBps}
        />
      )}
      {needsApproval && collateralToken ? (
        <Button
          type="button"
          variant="secondary"
          disabled={!valid || blocked || approval.isApproving}
          onClick={() => amt && approval.approve(amt)}
        >
          {approval.isApproving ? "Approving…" : `Approve ${symbol}`}
        </Button>
      ) : (
        <Button type="submit" disabled={!valid || blocked || action.isBusy}>
          {action.isBusy ? "Submitting…" : mode === "add" ? "Deposit" : "Withdraw"}
        </Button>
      )}
    </form>
  );
}

// ── Borrow more / repay ──────────────────────────────────────────────────────
function DebtForm({
  mode,
  vault,
  price18,
  params,
  collDec,
  action,
  vusdBalance,
  blocked,
}: {
  mode: "borrow" | "repay";
  vault: VaultState;
  price18?: bigint;
  params: VaultParams;
  collDec: number;
  action: Action;
  vusdBalance?: bigint;
  blocked: boolean;
}) {
  const [amount, setAmount] = useState("");
  const amt = parseAmount(amount, 18);
  const isBorrow = mode === "borrow";

  // Borrow-more is bounded by the max debt the collateral supports at MCR
  // (mirrors the XRPL twin — the contract would revert past it anyway).
  const maxMint = price18
    ? maxMintableVusd18(vault.collateral, collDec, price18, params.mcrBps, params.mintFeeBps)
    : undefined;
  const maxMore = maxMint !== undefined && maxMint > vault.debt18 ? maxMint - vault.debt18 : 0n;
  const overMore = isBorrow && amt !== null && maxMint !== undefined && amt > maxMore;

  // Repay pulls vUSD from the wallet — can't repay more than you hold, more
  // than the debt, or into the sub-minimum band (repay less, or close).
  const insufficient =
    !isBorrow && amt !== null && vusdBalance !== undefined && amt > vusdBalance;
  const overRepay = !isBorrow && amt !== null && amt > vault.debt18;
  const remaining =
    amt !== null ? (vault.debt18 > amt ? vault.debt18 - amt : 0n) : vault.debt18;
  const belowMin = !isBorrow && amt !== null && remaining > 0n && remaining < params.minDebt18;

  const valid = isBorrow
    ? amt !== null && amt > 0n && !overMore
    : amt !== null &&
      amt > 0n &&
      !insufficient &&
      !overRepay &&
      (remaining === 0n || remaining >= params.minDebt18);

  const error = isBorrow
    ? overMore
      ? `Exceeds the max borrow for this collateral (${formatToken(maxMore, 18, 2)} vUSD).`
      : undefined
    : insufficient
      ? `Insufficient vUSD — you have ${formatToken(vusdBalance!, 18, 2)}.`
      : overRepay
        ? `You can't repay more than the ${formatToken(vault.debt18, 18, 2)} vUSD debt.`
        : belowMin
          ? `That leaves the debt below the ${formatToken(params.minDebt18, 18, 0)} vUSD minimum — repay less, or close the vault.`
          : undefined;

  // Debt after the action — the borrow side includes the mint fee the contract
  // adds on top of what you receive.
  const debtAfter =
    amt !== null && amt > 0n
      ? isBorrow
        ? vault.debt18 + amt + (amt * params.mintFeeBps) / 10_000n
        : remaining
      : undefined;

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid || blocked) return;
        action.execute(mode === "borrow" ? "mintMore" : "repay", [amt, ...HINTS]);
      }}
    >
      <Field
        label={mode === "borrow" ? "Borrow more vUSD" : "Repay vUSD"}
        htmlFor={`debt-${mode}`}
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
          id={`debt-${mode}`}
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
      {debtAfter !== undefined && (
        <CrAfterRow
          collateralAfter={vault.collateral}
          debtAfter={debtAfter}
          collDec={collDec}
          price18={price18}
          mcrBps={params.mcrBps}
        />
      )}
      <Button type="submit" disabled={!valid || blocked || action.isBusy}>
        {action.isBusy ? "Submitting…" : mode === "borrow" ? "Borrow" : "Repay"}
      </Button>
    </form>
  );
}

// ── Adjust interest rate (V2) ────────────────────────────────────────────────
function RateForm({
  action,
  interest,
  currentRateBps,
  debt18,
  blocked,
}: {
  action: Action;
  interest: InterestConfig;
  currentRateBps?: bigint;
  debt18?: bigint;
  blocked: boolean;
}) {
  const initial = currentRateBps !== undefined ? Number(currentRateBps) : interest.defaultBps;
  const [rateBps, setRateBps] = useState(initial);
  const clampedRate = Math.min(Math.max(rateBps, interest.minBps), interest.maxBps);
  const changed = currentRateBps === undefined || BigInt(clampedRate) !== currentRateBps;

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted">
        Your current rate is{" "}
        <span className="font-medium text-ink">
          {currentRateBps !== undefined ? `${formatBps(Number(currentRateBps))} / year` : "—"}
        </span>
        . A lower rate is cheaper to carry but is redeemed first (redemption is by
        rate, lowest first).
      </p>
      <InterestSlider config={interest} rateBps={clampedRate} onChange={setRateBps} debt18={debt18} />
      <Button
        disabled={blocked || !changed || action.isBusy}
        onClick={() => action.execute("adjustInterestRate", [BigInt(clampedRate), ...HINTS])}
      >
        {action.isBusy ? "Updating…" : "Update interest rate"}
      </Button>
    </div>
  );
}

function CloseForm({
  vault,
  action,
  blocked,
}: {
  vault: VaultState;
  action: Action;
  blocked: boolean;
}) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted">
        Closing repays the full debt ({formatToken(vault.debt18, 18, 2)} vUSD) and
        returns all collateral. You must hold enough vUSD to cover the debt.
      </p>
      <Button
        variant="secondary"
        disabled={blocked || action.isBusy}
        onClick={() => action.execute("closeVault", [])}
      >
        {action.isBusy ? "Closing…" : "Close vault"}
      </Button>
    </div>
  );
}
