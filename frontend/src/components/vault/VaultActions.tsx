"use client";

// Vault write actions (U7). Open / adjust / repay / close through one shared tx
// lifecycle (useVaultAction), with client-side MCR + min-debt guardrails that
// mirror the on-chain checks so users see the limit before signing.
import { useState } from "react";
import { zeroAddress } from "viem";
import { Button, Card, CardTitle, Field, Input, cn } from "@/components/ui";
import { TxStatus } from "./TxStatus";
import { useVaultAction } from "@/hooks/useVaultAction";
import type { VaultParams, VaultState } from "@/hooks/useVault";
import { maxMintableVusd18 } from "@/lib/vault-math";
import { formatToken, parseAmount } from "@/lib/format";

type Tab = "open" | "adjust" | "repay" | "close";
const TABS: { id: Tab; label: string }[] = [
  { id: "open", label: "Open" },
  { id: "adjust", label: "Adjust" },
  { id: "repay", label: "Repay" },
  { id: "close", label: "Close" },
];

export function VaultActions({
  vault,
  price18,
  params,
  disabled,
}: {
  vault?: VaultState;
  price18?: bigint;
  params: VaultParams;
  disabled?: boolean;
}) {
  const hasVault = Boolean(vault);
  const [tab, setTab] = useState<Tab>(hasVault ? "adjust" : "open");
  const action = useVaultAction();
  const blocked = disabled || !action.configured;

  return (
    <Card>
      <CardTitle>Actions</CardTitle>
      <div
        className="mt-3 flex rounded-lg border border-border bg-surface p-0.5"
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
              "flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              tab === t.id ? "bg-ember text-bg" : "text-muted hover:text-text",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="mt-4">
        {tab === "open" && (
          <OpenForm price18={price18} params={params} action={action} blocked={blocked} />
        )}
        {tab === "adjust" && (
          <AdjustForm action={action} blocked={blocked || !hasVault} />
        )}
        {tab === "repay" && (
          <RepayForm vault={vault} action={action} blocked={blocked || !hasVault} />
        )}
        {tab === "close" && (
          <CloseForm vault={vault} action={action} blocked={blocked || !hasVault} />
        )}
      </div>

      <TxStatus phase={action.phase} hash={action.hash} error={action.error} />
    </Card>
  );
}

type Action = ReturnType<typeof useVaultAction>;

function OpenForm({
  price18,
  params,
  action,
  blocked,
}: {
  price18?: bigint;
  params: VaultParams;
  action: Action;
  blocked: boolean;
}) {
  const [collateral, setCollateral] = useState("");
  const [mint, setMint] = useState("");

  const collateral6 = parseAmount(collateral, 6);
  const mint18 = parseAmount(mint, 18);
  const maxMint =
    collateral6 !== null && price18
      ? maxMintableVusd18(collateral6, price18, params.mcrBps)
      : null;

  let error: string | undefined;
  if (mint18 !== null && mint18 < params.minDebt18 && mint18 > 0n)
    error = `Minimum debt is ${formatToken(params.minDebt18, 18, 0)} vUSD.`;
  else if (maxMint !== null && mint18 !== null && mint18 > maxMint)
    error = `Exceeds max mint (${formatToken(maxMint, 18, 2)} vUSD at MCR).`;

  const valid =
    collateral6 !== null && collateral6 > 0n && mint18 !== null && mint18 > 0n && !error;

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid || blocked) return;
        action.execute("openVault", [collateral6, mint18, zeroAddress, zeroAddress]);
      }}
    >
      <Field label="Deposit FXRP" htmlFor="open-collateral" hint="6-decimal collateral">
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
      <Button type="submit" disabled={!valid || blocked || action.isBusy}>
        {action.isBusy ? "Opening…" : "Open vault"}
      </Button>
    </form>
  );
}

function AdjustForm({ action, blocked }: { action: Action; blocked: boolean }) {
  const [collateralDelta, setCollateralDelta] = useState("");
  const [debtDelta, setDebtDelta] = useState("");

  function signedParse(input: string, decimals: number): bigint | null {
    const neg = input.trim().startsWith("-");
    const mag = parseAmount(input.replace("-", ""), decimals);
    if (mag === null) return null;
    return neg ? -mag : mag;
  }

  const cDelta = signedParse(collateralDelta, 6);
  const dDelta = signedParse(debtDelta, 18);
  const valid = cDelta !== null && dDelta !== null && (cDelta !== 0n || dDelta !== 0n);

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid || blocked) return;
        action.execute("adjustVault", [cDelta, dDelta, zeroAddress, zeroAddress]);
      }}
    >
      <Field
        label="Collateral delta (FXRP)"
        htmlFor="adj-col"
        hint="Positive deposits, negative withdraws"
      >
        <Input
          id="adj-col"
          inputMode="decimal"
          placeholder="e.g. 100 or -50"
          value={collateralDelta}
          onChange={(e) => setCollateralDelta(e.target.value)}
        />
      </Field>
      <Field
        label="Debt delta (vUSD)"
        htmlFor="adj-debt"
        hint="Positive mints, negative repays"
      >
        <Input
          id="adj-debt"
          inputMode="decimal"
          placeholder="e.g. 25 or -25"
          value={debtDelta}
          onChange={(e) => setDebtDelta(e.target.value)}
        />
      </Field>
      <Button type="submit" disabled={!valid || blocked || action.isBusy}>
        {action.isBusy ? "Adjusting…" : "Adjust vault"}
      </Button>
    </form>
  );
}

function RepayForm({
  vault,
  action,
  blocked,
}: {
  vault?: VaultState;
  action: Action;
  blocked: boolean;
}) {
  const [amount, setAmount] = useState("");
  const amount18 = parseAmount(amount, 18);
  const valid = amount18 !== null && amount18 > 0n;

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid || blocked) return;
        action.execute("repay", [amount18]);
      }}
    >
      <Field
        label="Repay vUSD"
        htmlFor="repay-amount"
        hint={vault ? `Outstanding debt ${formatToken(vault.debt18, 18, 2)} vUSD` : undefined}
      >
        <Input
          id="repay-amount"
          inputMode="decimal"
          placeholder="0.0"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
      </Field>
      <Button type="submit" disabled={!valid || blocked || action.isBusy}>
        {action.isBusy ? "Repaying…" : "Repay"}
      </Button>
    </form>
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
        onClick={() => action.execute("closeVault", [zeroAddress, zeroAddress])}
      >
        {action.isBusy ? "Closing…" : "Close vault"}
      </Button>
    </div>
  );
}
