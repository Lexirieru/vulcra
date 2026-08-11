"use client";

// Earn — a clean pool LIST (Morpho-style). Each stability pool is a row with its
// live TVL / APR; clicking a row opens its detail page (/earn/[branch]) where the
// deposit / withdraw / position / how-it-works live. No deposit form crammed here.
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Card, TokenIcon } from "@/components/ui";
import { Reveal } from "@/components/motion";
import { BRANCHES, BRANCH_ORDER, type CollateralBranch } from "@/config/branches";
import { useStabilityPool } from "./useStabilityPool";
import { formatBps, formatToken } from "@/lib/format";

function Cell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span className="flex items-baseline justify-between gap-2 sm:block sm:text-right">
      <span className="text-xs text-muted sm:hidden">{label}</span>
      <span className="tabular-nums">{children}</span>
    </span>
  );
}

function PoolRow({ branch }: { branch: CollateralBranch }) {
  const pool = useStabilityPool(branch);
  const dash = <span className="text-muted">—</span>;
  return (
    <Link
      href={`/earn/${branch.key}`}
      className="group flex flex-col gap-3 border-b border-line px-5 py-4 transition-colors last:border-b-0 hover:bg-surface-2/60 sm:grid sm:grid-cols-[minmax(0,2fr)_1fr_1fr_auto] sm:items-center sm:gap-4 sm:py-5"
    >
      <span className="flex min-w-0 items-center gap-3">
        <span className="flex shrink-0 items-center">
          <TokenIcon symbol="vUSD" size={32} alt="" />
          <TokenIcon
            symbol={branch.collateralSymbol}
            size={32}
            alt=""
            className="-ml-2 ring-2 ring-surface"
          />
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="font-medium text-ink">{branch.label} Stability Pool</span>
          <span className="truncate text-xs text-muted">
            Backs vUSD loans against {branch.label}
          </span>
        </span>
      </span>

      <Cell label="Pool TVL">
        {pool.tvl18 !== undefined ? (
          <span className="text-ink">
            {formatToken(pool.tvl18, 18, 0)} <span className="text-xs text-muted">vUSD</span>
          </span>
        ) : (
          dash
        )}
      </Cell>
      <Cell label="APR">
        {pool.aprBps !== undefined ? (
          <span className="font-medium text-ink">{formatBps(pool.aprBps)}</span>
        ) : (
          dash
        )}
      </Cell>

      <ChevronRight
        className="hidden h-5 w-5 shrink-0 text-muted transition-colors group-hover:text-ink sm:block"
        aria-hidden
      />
    </Link>
  );
}

export function EarnView() {
  return (
    <div className="flex flex-col gap-8">
      <Reveal>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">Earn</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            Deposit vUSD into a stability pool and earn a share of that branch&apos;s loan
            fees. Pools back outstanding loans and take on seized collateral at a bonus
            during liquidations. TVL and APR are read live from Coston2.
          </p>
        </div>
      </Reveal>

      <Reveal delay={0.05}>
        <Card padded={false} className="overflow-hidden">
          <div className="hidden grid-cols-[minmax(0,2fr)_1fr_1fr_auto] gap-4 border-b border-line bg-surface-2/50 px-5 py-3 text-xs font-medium text-muted sm:grid">
            <span>Pool</span>
            <span className="text-right">Pool TVL</span>
            <span className="text-right">APR</span>
            <span className="w-5" aria-hidden />
          </div>
          {BRANCH_ORDER.map((key) => (
            <PoolRow key={key} branch={BRANCHES[key]} />
          ))}
        </Card>
      </Reveal>
    </div>
  );
}
