"use client";

// Per-pool detail page (Morpho-style: the /earn list links here). A clean stat
// bar, a wallet-aware deposit/withdraw panel, your position, and how-it-works —
// one pool per page instead of everything crammed onto the list.
import Link from "next/link";
import { notFound, useParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Badge, Card, CardTitle, TokenIcon } from "@/components/ui";
import { Reveal } from "@/components/motion";
import { BRANCHES, type BranchKey } from "@/config/branches";
import { useXrplWalletContext } from "@/context/xrpl";
import { useFtsoPrice } from "@/hooks/useFtsoPrice";
import { useStabilityPool } from "@/components/earn/useStabilityPool";
import { DepositPanel } from "@/components/earn/DepositPanel";
import { XrplEarnDeposit } from "@/components/xrpl/XrplEarnDeposit";
import { formatBps, formatPrice, formatToken } from "@/lib/format";

const HOW_IT_WORKS = [
  {
    title: "Deposit vUSD",
    body: "Add vUSD to the pool. Your deposit backs that branch's outstanding loans.",
  },
  {
    title: "Earn loan-fee rewards",
    body: "Borrowing fees and interest paid on the branch flow to depositors, pro-rata to their share.",
  },
  {
    title: "Liquidations convert to collateral",
    body: "When a vault is liquidated, pool vUSD covers its debt and you receive the seized collateral at a bonus.",
  },
  {
    title: "Withdraw any time",
    body: "vUSD not consumed by liquidations, plus earned rewards, can be withdrawn whenever you like.",
  },
] as const;

function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums text-ink">{value}</div>
      {sub && <div className="text-xs text-muted/70">{sub}</div>}
    </div>
  );
}

export default function EarnPoolPage() {
  const { branch: key } = useParams<{ branch: string }>();
  const branch = BRANCHES[key as BranchKey];
  if (!branch) notFound();

  const pool = useStabilityPool(branch);
  const { price18, isStale } = useFtsoPrice(branch.feedId);
  const xrpConnected = Boolean(useXrplWalletContext().address);
  const isFxrp = branch.key === "fxrp";
  const dash = <span className="text-muted">—</span>;

  return (
    <div className="flex flex-col gap-6">
      <Reveal>
        <div className="flex flex-col gap-3">
          <Link
            href="/earn"
            className="inline-flex w-fit items-center gap-1.5 text-sm text-muted hover:text-ink"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden /> All pools
          </Link>
          <div className="flex items-center gap-3">
            <span className="flex items-center">
              <TokenIcon symbol="vUSD" size={40} alt="" />
              <TokenIcon
                symbol={branch.collateralSymbol}
                size={40}
                alt=""
                className="-ml-2.5 ring-2 ring-surface"
              />
            </span>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-semibold tracking-tight text-ink">
                  {branch.label} Stability Pool
                </h1>
                {pool.deployed && <Badge tone="green">Live on-chain</Badge>}
              </div>
              <p className="mt-0.5 text-sm text-muted">
                {`Deposit vUSD, earn a share of the ${branch.label} branch's loan fees.`}
              </p>
            </div>
          </div>
        </div>
      </Reveal>

      {/* Stat bar */}
      <Reveal delay={0.03}>
        <Card>
          <div className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4">
            <Stat
              label="Pool TVL"
              value={pool.tvl18 !== undefined ? `${formatToken(pool.tvl18, 18, 0)}` : dash}
              sub="vUSD"
            />
            <Stat
              label="APR"
              value={pool.aprBps !== undefined ? formatBps(pool.aprBps) : dash}
              sub="from loan fees"
            />
            <Stat
              label="7d APR"
              value={pool.apr7dBps !== undefined ? formatBps(pool.apr7dBps) : dash}
            />
            <Stat
              label="Your deposit"
              value={pool.userDeposit18 !== undefined ? `${formatToken(pool.userDeposit18, 18, 2)}` : dash}
              sub="vUSD"
            />
          </div>
        </Card>
      </Reveal>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex flex-col gap-6">
          <Reveal delay={0.05}>
            <Card className="flex flex-col gap-4">
              <CardTitle>How it works</CardTitle>
              <ol className="flex flex-col gap-4">
                {HOW_IT_WORKS.map((step, i) => (
                  <li key={step.title} className="flex gap-3">
                    <span
                      aria-hidden
                      className="grid size-8 shrink-0 place-items-center rounded-full bg-surface-2 text-sm font-semibold text-ink"
                    >
                      {i + 1}
                    </span>
                    <div>
                      <p className="font-medium text-ink">{step.title}</p>
                      <p className="text-sm text-muted">{step.body}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </Card>
          </Reveal>

          <Reveal delay={0.1}>
            <Card className="flex flex-col gap-3">
              <CardTitle>Pool details</CardTitle>
              <dl className="space-y-1.5 border-t border-line pt-3 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-muted">Backs</dt>
                  <dd className="text-ink">vUSD loans against {branch.label}</dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-muted">Reward token</dt>
                  <dd className="text-ink">vUSD (loan fees)</dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="inline-flex items-center gap-1.5 text-muted">
                    {branch.feedLabel} price {isStale && <Badge tone="warning">stale</Badge>}
                  </dt>
                  <dd className="tabular-nums text-ink">{formatPrice(price18)}</dd>
                </div>
              </dl>
            </Card>
          </Reveal>
        </div>

        <aside className="lg:sticky lg:top-6">
          <Reveal delay={0.08}>
            {isFxrp && xrpConnected ? (
              <XrplEarnDeposit />
            ) : (
              <DepositPanel branch={branch} />
            )}
          </Reveal>
        </aside>
      </div>
    </div>
  );
}
