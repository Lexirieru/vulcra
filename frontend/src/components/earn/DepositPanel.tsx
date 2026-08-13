"use client";

// Deposit/withdraw panel for the selected Stability Pool, fully wired to
// useStabilityPool's live deposit/withdraw against the branch's StabilityPool
// on Coston2. A Deposit/Withdraw segmented toggle (matching VaultActions) means
// only the ACTIVE mode's cap, Max, error and button ever show — so a first-time
// depositor never sees the withdraw-side "exceeds your pool deposit" error.
// Aave-grade guards: deposits are capped to the wallet's vUSD, withdrawals to
// the user's pool deposit, buttons explain WHY they are disabled, and the write
// lifecycle renders through the same TxStatus strip every vault action uses (no
// more console-only failures). If a branch ever ships without a pool address the
// actions fall back to the disabled "coming soon" state (spec §4/§5 — no fake flow).
import * as React from "react";
import { useId, useState } from "react";
import { formatUnits } from "viem";
import { useAccount } from "wagmi";
import { Badge, Field, Input, PillButton, SectionCard, TokenIcon, cn } from "@/components/ui";
import { TxStatus } from "@/components/vault/TxStatus";
import type { CollateralBranch } from "@/config/branches";
import { useWalletBalances } from "@/hooks/useWalletBalances";
import { formatToken, parseAmount } from "@/lib/format";
import { useStabilityPool } from "./useStabilityPool";

type Mode = "deposit" | "withdraw";

export function DepositPanel({
  branch,
  inputRef,
}: {
  branch: CollateralBranch;
  /** Lets the pool cards move focus here when a pool is picked. */
  inputRef?: React.Ref<HTMLInputElement>;
}) {
  const pool = useStabilityPool(branch);
  const { address } = useAccount();
  // Live wallet vUSD — the deposit cap (withdraw is capped by the pool deposit).
  const balances = useWalletBalances(address);
  const vusdBalance = balances.tokens.find((t) => t.symbol === "vUSD")?.value;
  const inputId = useId();
  const actionsHintId = useId();
  const [mode, setMode] = useState<Mode>("deposit");
  const [amount, setAmount] = useState("");
  const isDeposit = mode === "deposit";

  const amount18 = parseAmount(amount, 18);
  const invalid = amount.trim() !== "" && amount18 === null;
  const positive = pool.deployed && amount18 !== null && amount18 > 0n;
  // The cap + its error are mode-scoped, so the two constraints are mutually
  // exclusive and can never contradict the button that's actually showing.
  const cap = isDeposit ? vusdBalance : pool.userDeposit18;
  const insufficientBalance =
    isDeposit && amount18 !== null && vusdBalance !== undefined && amount18 > vusdBalance;
  const overDeposit =
    !isDeposit &&
    amount18 !== null &&
    pool.userDeposit18 !== undefined &&
    amount18 > pool.userDeposit18;

  const canSubmit =
    positive &&
    Boolean(address) &&
    !pool.isBusy &&
    (isDeposit ? !insufficientBalance : !overDeposit);

  function switchMode(next: Mode) {
    if (next === mode) return;
    // A stale amount / "Confirmed" strip from the other mode must not haunt this
    // one — reset both, exactly like VaultActions resets on tab switch.
    setAmount("");
    pool.resetTx();
    setMode(next);
  }

  async function submit() {
    const fn = isDeposit ? pool.deposit : pool.withdraw;
    if (!fn || amount18 === null) return;
    await fn(amount18);
  }

  return (
    <SectionCard
      title={`${branch.label} Stability Pool`}
      subtitle="Deposit or withdraw vUSD"
      icon={<TokenIcon symbol="vUSD" size={36} alt="" />}
      action={pool.deployed ? null : <Badge tone="neutral">Coming soon</Badge>}
    >
      <div className="flex flex-col gap-4">
        <div
          className="flex rounded-full border border-line bg-surface-2 p-1"
          role="tablist"
          aria-label="Deposit or withdraw"
        >
          {(["deposit", "withdraw"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              onClick={() => switchMode(m)}
              className={cn(
                "min-h-10 flex-1 rounded-full px-3 py-1.5 text-sm font-medium capitalize transition-colors",
                mode === m ? "bg-navy text-white" : "text-muted hover:text-ink",
              )}
            >
              {m}
            </button>
          ))}
        </div>

        <Field
          label="Amount"
          htmlFor={inputId}
          hint={
            isDeposit
              ? "Amount of vUSD to move into the pool."
              : "Amount of vUSD to withdraw from the pool."
          }
          error={invalid ? "Enter a valid vUSD amount." : undefined}
        >
          <div className="relative">
            <Input
              ref={inputRef}
              id={inputId}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
              autoComplete="off"
              placeholder="0.00"
              className="pr-24"
            />
            <span
              aria-hidden
              className="pointer-events-none absolute right-3.5 top-1/2 flex -translate-y-1/2 items-center gap-1.5 text-sm text-[var(--color-muted)]"
            >
              <TokenIcon symbol="vUSD" size={20} alt="" />
              vUSD
            </span>
          </div>
        </Field>

        {/* Mode-scoped cap (wallet balance to deposit, pool deposit to withdraw)
            with a full-precision Max. */}
        <div className="-mt-2 flex items-center justify-between text-xs">
          <span className="text-[var(--color-muted)]">
            {address
              ? isDeposit
                ? `Wallet balance ${formatToken(vusdBalance, 18, 2)} vUSD`
                : `Your pool deposit ${formatToken(pool.userDeposit18, 18, 2)} vUSD`
              : "Connect a Flare wallet to see your balance"}
          </span>
          {address && cap !== undefined && cap > 0n && (
            <button
              type="button"
              onClick={() => setAmount(formatUnits(cap, 18))}
              className="min-h-8 rounded-full px-2 font-medium text-brand hover:underline"
            >
              Max
            </button>
          )}
        </div>

        {/* Position readout — helpful context while depositing; the withdraw cap
            line above already surfaces it, so it's redundant in withdraw mode. */}
        {isDeposit && (
          <dl className="flex items-center justify-between rounded-xl bg-[var(--color-surface-2)] px-3.5 py-2.5 text-sm">
            <dt className="text-[var(--color-muted)]">Your deposit</dt>
            <dd className="font-medium tabular-nums text-[var(--color-ink)]">
              {pool.userDeposit18 !== undefined ? (
                `${formatToken(pool.userDeposit18, 18, 2)} vUSD`
              ) : (
                <>
                  <span aria-hidden>—</span>
                  <span className="sr-only">not available yet</span>
                </>
              )}
            </dd>
          </dl>
        )}

        {insufficientBalance && (
          <p className="-mt-2 text-xs text-danger">
            Exceeds your wallet balance ({formatToken(vusdBalance!, 18, 2)} vUSD) — you
            can&apos;t deposit that much.
          </p>
        )}
        {overDeposit && (
          <p className="-mt-2 text-xs text-danger">
            Exceeds your pool deposit ({formatToken(pool.userDeposit18!, 18, 2)} vUSD) —
            you can&apos;t withdraw that much.
          </p>
        )}

        <PillButton
          disabled={!canSubmit}
          aria-describedby={pool.deployed && address ? undefined : actionsHintId}
          onClick={submit}
        >
          {pool.isBusy
            ? isDeposit
              ? "Depositing…"
              : "Withdrawing…"
            : isDeposit
              ? "Deposit"
              : "Withdraw"}
        </PillButton>
        {pool.deployed && !address ? (
          <p id={actionsHintId} className="text-xs text-[var(--color-muted)]">
            Connect a Flare wallet (top right) to deposit or withdraw.
          </p>
        ) : null}
        {pool.deployed ? null : (
          <p id={actionsHintId} className="text-xs text-[var(--color-muted)]">
            Deposits and withdrawals unlock when the {branch.label} stability pool
            contract goes live on Coston2.
          </p>
        )}

        {/* The same lifecycle strip every vault action shows — a rejected or
            reverted pool write is never silent. */}
        <TxStatus phase={pool.phase} hash={pool.txHash} error={pool.txError} />
      </div>
    </SectionCard>
  );
}
