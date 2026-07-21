"use client";

// Enosys-style borrow composer for opening a vault: three clean, spacious cards
// (Collateral → Borrow vUSD → Interest rate) in a single column, with big number
// inputs, a live collateral selector, projected liquidation price / CR, and the
// interest slider with per-year cost. Wiring is unchanged — it reuses the same
// hooks and calls openVault(collateral, mint, rateBps, prevHint, nextHint).
import { useEffect, useMemo, useState } from "react";
import { useAccount } from "wagmi";
import { useAppKit } from "@reown/appkit/react";
import { zeroAddress } from "viem";
import { ArrowDown, Gauge, Info, Percent } from "lucide-react";
import { Badge, Button, Card, cn } from "@/components/ui";
import { TxStatus } from "./TxStatus";
import { BRANCH_ORDER, BRANCHES } from "@/config/branches";
import { useBranch } from "@/context/branch";
import { useFtsoPrice } from "@/hooks/useFtsoPrice";
import { useCollateralToken, useVaultParams } from "@/hooks/useVault";
import { useTokenApproval, useVaultAction, useWrapNative } from "@/hooks/useVaultAction";
import { useInterestConfig } from "@/hooks/useInterest";
import {
  annualInterest18,
  collateralValueUsd18,
  computeCrBps,
  healthBand,
  liquidationPrice18,
  maxMintableVusd18,
} from "@/lib/vault-math";
import { formatBps, formatPrice, formatToken, formatUsd, parseAmount } from "@/lib/format";

const HINTS = [zeroAddress, zeroAddress] as const;
const RISK_LABEL = { healthy: "Low", warning: "Medium", danger: "High" } as const;

function InfoRow({ left, right }: { left: React.ReactNode; right: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted">{left}</span>
      <span className="font-mono tabular-nums text-text">{right}</span>
    </div>
  );
}

export function BorrowComposer() {
  const { branch, branchKey, setBranchKey } = useBranch();
  const { address: owner } = useAccount();
  const { open } = useAppKit();
  const vaultManager = branch.vaultManager || undefined;
  const collDec = branch.collateralDecimals;

  const { price18, isStale } = useFtsoPrice(branch.feedId);
  const { params } = useVaultParams(vaultManager);
  const { config: interest } = useInterestConfig(vaultManager, branch.interest);
  const { address: collateralToken } = useCollateralToken(branch);

  const action = useVaultAction(vaultManager);
  const approval = useTokenApproval(collateralToken, vaultManager, owner);
  const wrap = useWrapNative(branch.wrapNative ? collateralToken : undefined);

  const [collateral, setCollateral] = useState("");
  const [mint, setMint] = useState("");
  const [rateBps, setRateBps] = useState(interest.defaultBps);
  const clampedRate = Math.min(Math.max(rateBps, interest.minBps), interest.maxBps);

  const [wrapAmount, setWrapAmount] = useState("");

  useEffect(() => {
    if (approval.approved) approval.refetchAllowance();
  }, [approval.approved]); // eslint-disable-line react-hooks/exhaustive-deps

  const collateralAmt = parseAmount(collateral, collDec);
  const mint18 = parseAmount(mint, 18);

  const derived = useMemo(() => {
    const fee = mint18 !== null ? (mint18 * params.mintFeeBps) / 10_000n : 0n;
    const debt = mint18 !== null ? mint18 + fee : 0n;
    const collateralUsd =
      collateralAmt !== null && price18
        ? collateralValueUsd18(collateralAmt, collDec, price18)
        : undefined;
    const maxMint =
      collateralAmt !== null && price18
        ? maxMintableVusd18(collateralAmt, collDec, price18, params.mcrBps)
        : undefined;
    const crBps =
      collateralAmt !== null && mint18 !== null && mint18 > 0n && price18
        ? computeCrBps(collateralAmt, collDec, debt, price18)
        : null;
    const liqPrice =
      collateralAmt !== null && mint18 !== null && mint18 > 0n
        ? liquidationPrice18(collateralAmt, collDec, debt, params.mcrBps)
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
  }, [collateralAmt, mint18, price18, collDec, params.mcrBps, params.mintFeeBps, clampedRate]);

  let mintError: string | undefined;
  if (mint18 !== null && mint18 > 0n && mint18 < params.minDebt18)
    mintError = `Minimum debt is ${formatToken(params.minDebt18, 18, 0)} vUSD.`;
  else if (derived.maxMint !== undefined && mint18 !== null && mint18 > derived.maxMint)
    mintError = `Exceeds the max mint at MCR (${formatToken(derived.maxMint, 18, 2)} vUSD).`;

  const valid =
    Boolean(owner) &&
    collateralAmt !== null &&
    collateralAmt > 0n &&
    mint18 !== null &&
    mint18 > 0n &&
    !mintError;

  const needsApproval =
    collateralAmt !== null &&
    collateralAmt > 0n &&
    (approval.allowance === undefined || approval.allowance < collateralAmt);

  // Redemption-risk read from where the chosen rate sits in [min, max].
  const rateSpan = Math.max(1, interest.maxBps - interest.minBps);
  const ratePos = (clampedRate - interest.minBps) / rateSpan; // 0 lowest .. 1 highest
  const redemptionRisk = ratePos < 0.15 ? "danger" : ratePos < 0.4 ? "warning" : "healthy";

  const wrapWei = parseAmount(wrapAmount, 18);

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-4">
      {/* Card 1 — Collateral */}
      <Card className="p-6">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-muted">Collateral</span>
          <div
            className="flex rounded-lg border border-border bg-surface p-0.5"
            role="tablist"
            aria-label="Collateral token"
          >
            {BRANCH_ORDER.map((k) => (
              <button
                key={k}
                role="tab"
                aria-selected={branchKey === k}
                onClick={() => setBranchKey(k)}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
                  branchKey === k ? "bg-surface-2 text-ember" : "text-muted hover:text-text",
                )}
              >
                {BRANCHES[k].collateralSymbol}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-3 flex items-baseline gap-3">
          <input
            inputMode="decimal"
            placeholder="0.0"
            value={collateral}
            onChange={(e) => setCollateral(e.target.value)}
            aria-label={`${branch.collateralSymbol} to deposit`}
            className="w-full bg-transparent font-mono text-4xl tabular-nums text-text outline-none placeholder:text-faint"
          />
          <span className="shrink-0 text-lg font-semibold text-muted">{branch.collateralSymbol}</span>
        </div>
        <div className="mt-1 font-mono text-sm text-faint">
          {derived.collateralUsd !== undefined ? formatUsd(derived.collateralUsd) : "$0.00"}
        </div>

        <div className="mt-4 space-y-1 border-t border-border pt-3">
          <InfoRow
            left={
              <span className="inline-flex items-center gap-1">
                Price {isStale && <Badge tone="warning">stale</Badge>}
              </span>
            }
            right={formatPrice(price18)}
          />
          <InfoRow left="Min collateral ratio" right={formatBps(params.mcrBps)} />
        </div>

        {branch.wrapNative && (
          <div className="mt-4 rounded-lg border border-ember-soft/50 bg-ember-soft/10 p-3">
            <div className="text-xs text-muted">
              {branch.collateralSymbol} is wrapped C2FLR — wrap first, then deposit.
            </div>
            <form
              className="mt-2 flex items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (wrapWei && wrapWei > 0n) wrap.wrap(wrapWei);
              }}
            >
              <input
                inputMode="decimal"
                placeholder="C2FLR amount"
                value={wrapAmount}
                onChange={(e) => setWrapAmount(e.target.value)}
                aria-label="C2FLR to wrap"
                className="h-9 w-full rounded-md border border-border bg-bg px-3 font-mono text-sm tabular-nums text-text outline-none placeholder:text-faint focus:border-ember"
              />
              <Button
                type="submit"
                variant="secondary"
                size="sm"
                disabled={!wrapWei || wrapWei <= 0n || wrap.isBusy}
              >
                {wrap.isBusy ? "Wrapping…" : "Wrap"}
              </Button>
            </form>
            <TxStatus phase={wrap.phase} hash={wrap.hash} error={wrap.error} />
          </div>
        )}
      </Card>

      <div className="-my-1 flex justify-center text-faint" aria-hidden>
        <ArrowDown className="h-5 w-5" />
      </div>

      {/* Card 2 — Borrow vUSD */}
      <Card className="p-6">
        <span className="text-sm font-medium text-muted">Borrow</span>
        <div className="mt-3 flex items-baseline gap-3">
          <input
            inputMode="decimal"
            placeholder="0.0"
            value={mint}
            onChange={(e) => setMint(e.target.value)}
            aria-label="vUSD to mint"
            className="w-full bg-transparent font-mono text-4xl tabular-nums text-text outline-none placeholder:text-faint"
          />
          <span className="shrink-0 text-lg font-semibold text-muted">vUSD</span>
        </div>
        <div className="mt-1 flex items-center justify-between">
          <span className="font-mono text-sm text-faint">
            {mint18 !== null ? formatUsd(mint18) : "$0.00"}
          </span>
          {derived.maxMint !== undefined && (
            <button
              type="button"
              onClick={() => setMint(formatToken(derived.maxMint, 18, 2).replace(/,/g, ""))}
              className="text-xs text-ember hover:text-ember-bright focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember"
            >
              Max {formatToken(derived.maxMint, 18, 2)}
            </button>
          )}
        </div>
        {mintError && <p className="mt-2 text-xs text-danger">{mintError}</p>}

        <div className="mt-4 space-y-1 border-t border-border pt-3">
          <InfoRow
            left={
              <span className="inline-flex items-center gap-1">
                <Gauge className="h-3.5 w-3.5" aria-hidden /> Liquidation risk
              </span>
            }
            right={
              <Badge tone={derived.band === "danger" ? "danger" : derived.band === "warning" ? "warning" : "healthy"}>
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

      {/* Card 3 — Interest rate */}
      <Card className="p-6">
        <div className="flex items-center justify-between">
          <span className="inline-flex items-center gap-1.5 text-sm font-medium text-muted">
            <Percent className="h-4 w-4" aria-hidden /> Interest rate
          </span>
          <Badge tone="neutral">You can change this anytime</Badge>
        </div>
        <div className="mt-2 font-mono text-4xl tabular-nums text-text">
          {formatBps(clampedRate)}
          <span className="ml-2 text-base font-normal text-muted">per year</span>
        </div>
        <input
          type="range"
          min={interest.minBps}
          max={interest.maxBps}
          step={10}
          value={clampedRate}
          onChange={(e) => setRateBps(Number(e.target.value))}
          aria-label="Annual interest rate"
          aria-valuetext={`${formatBps(clampedRate)} per year`}
          className="mt-4 w-full accent-[var(--color-ember)]"
        />
        <div className="mt-1 flex justify-between text-xs text-faint">
          <span>{formatBps(interest.minBps)}</span>
          <span>{formatBps(interest.maxBps)}</span>
        </div>

        <div className="mt-4 space-y-1 border-t border-border pt-3">
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
        <p className="mt-3 flex items-start gap-1.5 text-xs text-faint">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          Redemptions hit the lowest-rate vaults first. A higher rate costs more but is
          redeemed later.
        </p>
      </Card>

      {/* CTA */}
      <div className="mt-1 flex flex-col gap-2">
        {!owner ? (
          <Button size="lg" onClick={() => open()}>
            Connect wallet to borrow
          </Button>
        ) : needsApproval && collateralToken ? (
          <Button
            size="lg"
            variant="secondary"
            disabled={!collateralAmt || approval.isApproving}
            onClick={() => collateralAmt && approval.approve(collateralAmt)}
          >
            {approval.isApproving ? "Approving…" : `Approve ${branch.collateralSymbol}`}
          </Button>
        ) : (
          <Button
            size="lg"
            disabled={!valid || action.isBusy}
            onClick={() =>
              collateralAmt !== null &&
              mint18 !== null &&
              action.execute("openVault", [collateralAmt, mint18, BigInt(clampedRate), ...HINTS])
            }
          >
            {action.isBusy ? "Opening vault…" : "Open vault"}
          </Button>
        )}
        {approval.error && !action.error && (
          <p className="text-sm text-danger">{approval.error.message.split("\n")[0]}</p>
        )}
        <TxStatus phase={action.phase} hash={action.hash} error={action.error} />
      </div>
    </div>
  );
}
