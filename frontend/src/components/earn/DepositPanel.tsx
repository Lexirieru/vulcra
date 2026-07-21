"use client";

// Deposit/withdraw panel for the selected Stability Pool, fully wired to
// useStabilityPool's live deposit/withdraw against the branch's StabilityPool
// on Coston2. If a branch ever ships without a pool address the actions fall
// back to the disabled "coming soon" state (spec §4/§5 — no fake flow).
import * as React from "react";
import { useId, useState } from "react";
import { Badge, Field, Input, PillButton, SectionCard, TokenIcon } from "@/components/ui";
import type { CollateralBranch } from "@/config/branches";
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
  const inputId = useId();
  const actionsHintId = useId();
  const [amount, setAmount] = useState("");

  const amount18 = parseAmount(amount, 18);
  const invalid = amount.trim() !== "" && amount18 === null;
  const actionable = pool.deployed && amount18 !== null && amount18 > 0n;

  async function act(kind: "deposit" | "withdraw") {
    const fn = kind === "deposit" ? pool.deposit : pool.withdraw;
    if (!fn || amount18 === null) return;
    await fn(amount18);
  }

  return (
    <SectionCard
      title="Deposit vUSD"
      subtitle={`${branch.label} Stability Pool`}
      icon={<TokenIcon symbol="vUSD" size={36} alt="" />}
      action={pool.deployed ? null : <Badge tone="blue">Coming soon</Badge>}
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

        <div className="flex flex-wrap gap-3">
          <PillButton
            disabled={!actionable}
            aria-describedby={pool.deployed ? undefined : actionsHintId}
            onClick={() => act("deposit")}
          >
            Deposit
          </PillButton>
          <PillButton
            variant="ghost"
            disabled={!actionable}
            aria-describedby={pool.deployed ? undefined : actionsHintId}
            onClick={() => act("withdraw")}
          >
            Withdraw
          </PillButton>
        </div>
        {pool.deployed ? null : (
          <p id={actionsHintId} className="text-xs text-[var(--color-muted)]">
            Deposits and withdrawals unlock when the {branch.label} stability pool
            contract goes live on Coston2.
          </p>
        )}
      </div>
    </SectionCard>
  );
}
