"use client";

// Deposit/withdraw panel for the selected Stability Pool, fully wired to
// useStabilityPool's live deposit/withdraw against the branch's StabilityPool
// on Coston2. Aave-grade guards: deposits are capped to the wallet's vUSD
// (balance row + Max), withdrawals to the user's pool deposit, buttons explain
// WHY they are disabled, and the write lifecycle renders through the same
// TxStatus strip every vault action uses (no more console-only failures). If a
// branch ever ships without a pool address the actions fall back to the
// disabled "coming soon" state (spec §4/§5 — no fake flow).
import * as React from "react";
import { useId, useState } from "react";
import { formatUnits } from "viem";
import { useAccount } from "wagmi";
import { Badge, Field, Input, PillButton, SectionCard, TokenIcon } from "@/components/ui";
import { TxStatus } from "@/components/vault/TxStatus";
import type { CollateralBranch } from "@/config/branches";
import { useWalletBalances } from "@/hooks/useWalletBalances";
import { formatToken, parseAmount } from "@/lib/format";
import { useStabilityPool } from "./useStabilityPool";

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
  const [amount, setAmount] = useState("");
  // Which button is mid-flight — so only IT reads "…ing", not both.
  const [pending, setPending] = useState<"deposit" | "withdraw" | null>(null);

  const amount18 = parseAmount(amount, 18);
  const invalid = amount.trim() !== "" && amount18 === null;
  const positive = pool.deployed && amount18 !== null && amount18 > 0n;
  const insufficientBalance =
    amount18 !== null && vusdBalance !== undefined && amount18 > vusdBalance;
  const overDeposit =
    amount18 !== null && pool.userDeposit18 !== undefined && amount18 > pool.userDeposit18;

  const canDeposit = positive && Boolean(address) && !insufficientBalance && !pool.isBusy;
  const canWithdraw = positive && Boolean(address) && !overDeposit && !pool.isBusy;

  async function act(kind: "deposit" | "withdraw") {
    const fn = kind === "deposit" ? pool.deposit : pool.withdraw;
    if (!fn || amount18 === null) return;
    setPending(kind);
    try {
      await fn(amount18);
    } finally {
      setPending(null);
    }
  }

  return (
    <SectionCard
      title="Deposit vUSD"
      subtitle={`${branch.label} Stability Pool`}
      icon={<TokenIcon symbol="vUSD" size={36} alt="" />}
      action={pool.deployed ? null : <Badge tone="neutral">Coming soon</Badge>}
    >
      <div className="flex flex-col gap-4">
        <Field
          label="Amount"
          htmlFor={inputId}
          hint="Amount of vUSD to move into or out of the pool."
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

        {/* Wallet balance (deposit cap) with a full-precision Max. */}
        <div className="-mt-2 flex items-center justify-between text-xs">
          <span className="text-[var(--color-muted)]">
            {address
              ? `Wallet balance ${formatToken(vusdBalance, 18, 2)} vUSD`
              : "Connect a Flare wallet to see your balance"}
          </span>
          {address && vusdBalance !== undefined && vusdBalance > 0n && (
            <button
              type="button"
              onClick={() => setAmount(formatUnits(vusdBalance, 18))}
              className="min-h-8 rounded-full px-2 font-medium text-brand hover:underline"
            >
              Max
            </button>
          )}
        </div>

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

        <div className="flex flex-wrap gap-3">
          <PillButton
            disabled={!canDeposit}
            aria-describedby={pool.deployed && address ? undefined : actionsHintId}
            onClick={() => act("deposit")}
          >
            {pending === "deposit" ? "Depositing…" : "Deposit"}
          </PillButton>
          <PillButton
            variant="ghost"
            disabled={!canWithdraw}
            aria-describedby={pool.deployed && address ? undefined : actionsHintId}
            onClick={() => act("withdraw")}
          >
            {pending === "withdraw" ? "Withdrawing…" : "Withdraw"}
          </PillButton>
        </div>
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
