"use client";

// Vault write actions (U7), branch-aware and mapped 1:1 to the real VaultManager:
// openVault / addCollateral / withdrawCollateral / mintMore / repay / closeVault.
// Collateral deposits gate on an ERC-20 approval; the wFLR branch also offers a
// "wrap C2FLR → wFLR" helper (collateral is obtained by wrapping, not a faucet).
// vUSD is burned from the caller by the protocol, so repay/close need no approval.
import { useEffect, useState } from "react";
import { zeroAddress, type Address } from "viem";
import { Button, Card, CardTitle, Field, Input, cn } from "@/components/ui";
import { TxStatus } from "./TxStatus";
import { useVaultAction, useTokenApproval, useWrapNative } from "@/hooks/useVaultAction";
import { useInterestConfig, useVaultRate } from "@/hooks/useInterest";
import type { InterestConfig } from "@/hooks/useInterest";
import type { VaultParams, VaultState } from "@/hooks/useVault";
import type { CollateralBranch } from "@/config/branches";
import { annualInterest18, maxMintableVusd18 } from "@/lib/vault-math";
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

export function VaultActions({
  vault,
  price18,
  params,
  branch,
  collateralToken,
  owner,
  disabled,
}: {
  vault?: VaultState;
  price18?: bigint;
  params: VaultParams;
  branch: CollateralBranch;
  collateralToken?: Address;
  owner?: Address;
  disabled?: boolean;
}) {
  const hasVault = Boolean(vault);
  const [tab, setTab] = useState<Tab>("deposit");
  const action = useVaultAction(branch.vaultManager || undefined);
  const blocked = disabled || !action.configured;
  const collDec = branch.collateralDecimals;
  const { config: interest } = useInterestConfig(
    branch.vaultManager || undefined,
    branch.interest,
  );
  const { rateBps: currentRate } = useVaultRate(owner, branch.vaultManager || undefined);

  return (
    <Card>
      <CardTitle>Actions</CardTitle>

      {branch.wrapNative && (
        <WrapPanel wnat={collateralToken} disabled={blocked} symbol={branch.collateralSymbol} />
      )}

      {!hasVault ? (
        <div className="mt-4">
          <OpenForm
            price18={price18}
            params={params}
            branch={branch}
            action={action}
            collateralToken={collateralToken}
            owner={owner}
            interest={interest}
            blocked={blocked}
          />
        </div>
      ) : (
        <>
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
              <CollateralForm
                mode="add"
                collDec={collDec}
                symbol={branch.collateralSymbol}
                action={action}
                collateralToken={collateralToken}
                vaultManager={branch.vaultManager || undefined}
                owner={owner}
                blocked={blocked}
              />
            )}
            {tab === "withdraw" && (
              <CollateralForm
                mode="withdraw"
                collDec={collDec}
                symbol={branch.collateralSymbol}
                action={action}
                blocked={blocked}
              />
            )}
            {tab === "borrow" && (
              <DebtForm mode="borrow" action={action} blocked={blocked} />
            )}
            {tab === "repay" && (
              <DebtForm mode="repay" action={action} vault={vault} blocked={blocked} />
            )}
            {tab === "rate" && (
              <RateForm
                key={String(currentRate)}
                action={action}
                interest={interest}
                currentRateBps={currentRate}
                debt18={vault?.debt18}
                blocked={blocked}
              />
            )}
            {tab === "close" && <CloseForm vault={vault} action={action} blocked={blocked} />}
          </div>
        </>
      )}

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

// ── Open (collateral + mint) with approval gate ──────────────────────────────
function OpenForm({
  price18,
  params,
  branch,
  action,
  collateralToken,
  owner,
  interest,
  blocked,
}: {
  price18?: bigint;
  params: VaultParams;
  branch: CollateralBranch;
  action: Action;
  collateralToken?: Address;
  owner?: Address;
  interest: InterestConfig;
  blocked: boolean;
}) {
  const collDec = branch.collateralDecimals;
  const [collateral, setCollateral] = useState("");
  const [mint, setMint] = useState("");
  const [rateBps, setRateBps] = useState(interest.defaultBps);
  const clampedRate = Math.min(Math.max(rateBps, interest.minBps), interest.maxBps);

  const collateralAmt = parseAmount(collateral, collDec);
  const mint18 = parseAmount(mint, 18);
  const maxMint =
    collateralAmt !== null && price18
      ? maxMintableVusd18(collateralAmt, collDec, price18, params.mcrBps)
      : null;

  let error: string | undefined;
  if (mint18 !== null && mint18 < params.minDebt18 && mint18 > 0n)
    error = `Minimum debt is ${formatToken(params.minDebt18, 18, 0)} vUSD.`;
  else if (maxMint !== null && mint18 !== null && mint18 > maxMint)
    error = `Exceeds max mint (${formatToken(maxMint, 18, 2)} vUSD at MCR).`;

  const valid =
    collateralAmt !== null && collateralAmt > 0n && mint18 !== null && mint18 > 0n && !error;

  const approval = useTokenApproval(collateralToken, branch.vaultManager || undefined, owner);
  useEffect(() => {
    if (approval.approved) approval.refetchAllowance();
  }, [approval.approved]); // eslint-disable-line react-hooks/exhaustive-deps
  const needsApproval =
    collateralAmt !== null &&
    collateralAmt > 0n &&
    (approval.allowance === undefined || approval.allowance < collateralAmt);

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid || blocked) return;
        action.execute("openVault", [collateralAmt, mint18, BigInt(clampedRate), ...HINTS]);
      }}
    >
      <Field
        label={`Deposit ${branch.collateralSymbol}`}
        htmlFor="open-collateral"
        hint={`${collDec}-decimal collateral`}
      >
        <Input
          id="open-collateral"
          inputMode="decimal"
          placeholder="0.0"
          value={collateral}
          onChange={(e) => setCollateral(e.target.value)}
        />
      </Field>
      <Field
        label="Mint vUSD"
        htmlFor="open-mint"
        error={error}
        hint={maxMint !== null ? `Max ${formatToken(maxMint, 18, 2)} at MCR` : undefined}
      >
        <Input
          id="open-mint"
          inputMode="decimal"
          placeholder="0.0"
          value={mint}
          onChange={(e) => setMint(e.target.value)}
        />
      </Field>
      <InterestSlider
        config={interest}
        rateBps={clampedRate}
        onChange={setRateBps}
        debt18={mint18 ?? undefined}
      />
      {needsApproval && collateralToken ? (
        <Button
          type="button"
          variant="secondary"
          disabled={!valid || blocked || approval.isApproving}
          onClick={() => collateralAmt && approval.approve(collateralAmt)}
        >
          {approval.isApproving ? "Approving…" : `Approve ${branch.collateralSymbol}`}
        </Button>
      ) : (
        <Button type="submit" disabled={!valid || blocked || action.isBusy}>
          {action.isBusy ? "Opening…" : "Open vault"}
        </Button>
      )}
    </form>
  );
}

// ── Add / withdraw collateral ────────────────────────────────────────────────
function CollateralForm({
  mode,
  collDec,
  symbol,
  action,
  collateralToken,
  vaultManager,
  owner,
  blocked,
}: {
  mode: "add" | "withdraw";
  collDec: number;
  symbol: string;
  action: Action;
  collateralToken?: Address;
  vaultManager?: Address;
  owner?: Address;
  blocked: boolean;
}) {
  const [amount, setAmount] = useState("");
  const amt = parseAmount(amount, collDec);
  const valid = amt !== null && amt > 0n;

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
      >
        <Input
          id={`col-${mode}`}
          inputMode="decimal"
          placeholder="0.0"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
      </Field>
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
  action,
  vault,
  blocked,
}: {
  mode: "borrow" | "repay";
  action: Action;
  vault?: VaultState;
  blocked: boolean;
}) {
  const [amount, setAmount] = useState("");
  const amt = parseAmount(amount, 18);
  const valid = amt !== null && amt > 0n;

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
        hint={
          mode === "repay" && vault
            ? `Outstanding debt ${formatToken(vault.debt18, 18, 2)} vUSD`
            : undefined
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
  vault?: VaultState;
  action: Action;
  blocked: boolean;
}) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted">
        Closing repays the full debt
        {vault ? ` (${formatToken(vault.debt18, 18, 2)} vUSD)` : ""} and returns all
        collateral. You must hold enough vUSD to cover the debt.
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
