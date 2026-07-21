"use client";

// Per-collateral Stability Pool card (Enosys Earn look). Pool TVL/APR/7d APR
// are live reads from the branch's StabilityPool contract (useStabilityPool);
// the price + branch-debt row is live on-chain data as well.
import { Badge, Card, PillButton, Skeleton, TokenIcon, cn } from "@/components/ui";
import type { CollateralBranch } from "@/config/branches";
import { useFtsoPrice } from "@/hooks/useFtsoPrice";
import { branchVaultManager } from "@/hooks/useVault";
import { formatBps, formatPrice, formatToken } from "@/lib/format";
import { useBranchDebt } from "@/hooks/useBranchStats";
import { useStabilityPool } from "./useStabilityPool";

function PoolStat({ label, value }: { label: string; value?: string }) {
  return (
    <div>
      <dt className="text-xs text-[var(--color-muted)]">{label}</dt>
      <dd className="mt-0.5 text-lg font-semibold tabular-nums text-[var(--color-ink)]">
        {value ?? (
          <>
            <span aria-hidden>—</span>
            <span className="sr-only">not available yet</span>
          </>
        )}
      </dd>
    </div>
  );
}

export function StabilityPoolCard({
  branch,
  selected,
  onPick,
  onDeposit,
}: {
  branch: CollateralBranch;
  selected: boolean;
  /** Clicking anywhere on the card selects this pool (drives the deposit panel). */
  onPick: () => void;
  /** The Deposit button: select + jump to and focus the deposit form. */
  onDeposit: () => void;
}) {
  const pool = useStabilityPool(branch);
  const price = useFtsoPrice(branch.feedId);
  const { address: vaultManager } = branchVaultManager(branch);
  const debt = useBranchDebt(vaultManager);

  return (
    <Card
      onClick={onPick}
      aria-current={selected ? "true" : undefined}
      className={cn(
        "flex cursor-pointer flex-col gap-5 transition-[transform,box-shadow,border-color]",
        "hover:-translate-y-0.5",
        selected
          ? "border-[var(--color-blue)] ring-1 ring-[var(--color-blue)]"
          : "hover:border-[var(--color-blue)]/50",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <TokenIcon symbol={branch.collateralSymbol} size={36} alt="" />
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-[var(--color-ink)]">
              {branch.label} Stability Pool
              {selected ? <span className="sr-only"> (selected)</span> : null}
            </h3>
            <p className="text-sm text-[var(--color-muted)]">
              Backs vUSD loans against {branch.label}
            </p>
          </div>
        </div>
        {pool.deployed ? null : <Badge tone="blue">Coming soon</Badge>}
      </div>

      <dl className="grid grid-cols-3 gap-3">
        <PoolStat
          label="Pool TVL"
          value={
            pool.tvl18 !== undefined
              ? `${formatToken(pool.tvl18, 18, 2)} vUSD`
              : undefined
          }
        />
        <PoolStat
          label="APR"
          value={pool.aprBps !== undefined ? formatBps(pool.aprBps) : undefined}
        />
        <PoolStat
          label="7d APR"
          value={pool.apr7dBps !== undefined ? formatBps(pool.apr7dBps) : undefined}
        />
      </dl>

      {/* FTSO price + VaultManager branch debt, read live like the pool stats. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-[var(--color-line)] pt-3 text-xs text-[var(--color-muted)]">
        <Badge tone="green">Live on-chain</Badge>
        <span className="flex items-center gap-1.5">
          {branch.feedLabel}
          {price.isLoading ? (
            <Skeleton className="h-3.5 w-14" />
          ) : (
            <span className="font-medium tabular-nums text-[var(--color-ink)]">
              {formatPrice(price.price18)}
            </span>
          )}
          {price.isStale ? <Badge tone="warning">stale</Badge> : null}
        </span>
        <span className="flex items-center gap-1.5">
          Branch debt
          {debt.isLoading ? (
            <Skeleton className="h-3.5 w-16" />
          ) : (
            <span className="font-medium tabular-nums text-[var(--color-ink)]">
              {formatToken(debt.debt18, 18, 0)} vUSD
            </span>
          )}
        </span>
      </div>

      <div className="mt-auto">
        <PillButton
          size="sm"
          variant={selected ? "primary" : "ghost"}
          onClick={(e) => {
            e.stopPropagation();
            onDeposit();
          }}
        >
          Deposit
          <span className="sr-only"> into the {branch.label} Stability Pool</span>
        </PillButton>
      </div>
    </Card>
  );
}
