"use client";

// Borrow landing — Enosys-style collateral picker. Live branches (FXRP, wFLR)
// show real data only: FTSO price, MCR-derived max LTV, contract interest
// bounds, min debt. Roadmap assets (stXRP, sFLR) render greyed "Soon" cards —
// no fabricated numbers (spec §5).
import Link from "next/link";
import { Badge, Card, PillButton, TokenIcon } from "@/components/ui";
import { Reveal, Stagger } from "@/components/motion";
import { BRANCH_ORDER, BRANCHES, type CollateralBranch } from "@/config/branches";
import { useFtsoPrice } from "@/hooks/useFtsoPrice";
import { useVaultParams } from "@/hooks/useVault";
import { useInterestConfig } from "@/hooks/useInterest";
import { formatBps, formatPrice, formatToken } from "@/lib/format";

const SOON = [
  {
    symbol: "STXRP",
    label: "stXRP",
    note: "Staked XRP collateral — on the Vulcra roadmap.",
  },
  {
    symbol: "SFLR",
    label: "sFLR",
    note: "Staked FLR collateral — on the Vulcra roadmap.",
  },
] as const;

function PickerRow({ left, right }: { left: React.ReactNode; right: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-muted">{left}</span>
      <span className="tabular-nums text-ink">{right}</span>
    </div>
  );
}

function BranchCard({ branch }: { branch: CollateralBranch }) {
  const vaultManager = branch.vaultManager || undefined;
  const { price18, isStale } = useFtsoPrice(branch.feedId);
  const { params } = useVaultParams(vaultManager);
  const { config: interest } = useInterestConfig(vaultManager, branch.interest);

  // Max LTV is the inverse of the minimum collateral ratio (both from chain).
  const maxLtv = params.isDefault
    ? "—"
    : `${((100 * 10_000) / Number(params.mcrBps)).toLocaleString("en-US", {
        maximumFractionDigits: 1,
      })}%`;

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-3">
          <TokenIcon symbol={branch.collateralSymbol} size={40} alt="" />
          <span>
            <span className="block text-lg font-semibold text-ink">{branch.label}</span>
            <span className="block text-xs text-muted">
              {branch.hasXrplMint
                ? "Your XRP on Flare · via FAssets"
                : `${branch.collateralSymbol} · Coston2`}
            </span>
          </span>
        </span>
        {branch.hasXrplMint && <Badge tone="blue">XRPL-native mint</Badge>}
      </div>

      <div className="space-y-1.5 border-t border-line pt-3">
        <PickerRow
          left={
            <span className="inline-flex items-center gap-1.5">
              {branch.feedLabel} price {isStale && <Badge tone="warning">stale</Badge>}
            </span>
          }
          right={formatPrice(price18)}
        />
        <PickerRow left="Max LTV" right={maxLtv} />
        <PickerRow
          left="Interest rate"
          right={
            interest.isDefault
              ? "you set it"
              : `you set it · ${formatBps(interest.minBps)}–${formatBps(interest.maxBps)}`
          }
        />
        <PickerRow
          left="Min debt"
          right={params.isDefault ? "—" : `${formatToken(params.minDebt18, 18, 0)} vUSD`}
        />
      </div>

      <div className="mt-auto flex flex-wrap gap-2">
        <PillButton href={`/borrow/${branch.key}`} size="sm" className="flex-1">
          Borrow against {branch.label}
        </PillButton>
        {branch.hasXrplMint && (
          <PillButton
            href={`/borrow/${branch.key}?mode=xrpl`}
            size="sm"
            variant="ghost"
            className="flex-1"
          >
            <TokenIcon symbol="XRP" size={16} alt="" />
            Pay from XRPL
          </PillButton>
        )}
      </div>
    </Card>
  );
}

function SoonCard({ symbol, label, note }: (typeof SOON)[number]) {
  return (
    <Card className="flex flex-col gap-4 opacity-70" aria-disabled>
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-3">
          <TokenIcon symbol={symbol} size={40} alt="" className="opacity-60" />
          <span>
            <span className="block text-lg font-semibold text-ink">{label}</span>
            <span className="block text-xs text-muted">{symbol}</span>
          </span>
        </span>
        <Badge tone="neutral">Soon</Badge>
      </div>
      <p className="border-t border-line pt-3 text-sm text-muted">{note}</p>
    </Card>
  );
}

export default function BorrowPage() {
  return (
    <div className="flex flex-col gap-8">
      <Reveal>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
            Borrow vUSD
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            Choose a collateral asset — each runs its own Vulcra branch on Flare
            Coston2. Deposit collateral, mint vUSD, and set your own interest rate.
            Hold XRP? <span className="text-ink">FXRP is your XRP on Flare</span> —
            mint straight from the XRP Ledger with a single payment, no EVM wallet
            or FLR required.
          </p>
        </div>
      </Reveal>

      <Stagger className="grid gap-4 sm:grid-cols-2" startDelay={0.05}>
        {BRANCH_ORDER.map((k) => (
          <BranchCard key={k} branch={BRANCHES[k]} />
        ))}
        {SOON.map((s) => (
          <SoonCard key={s.symbol} {...s} />
        ))}
      </Stagger>

      <Reveal delay={0.15}>
        <p className="text-xs text-muted/80">
          Rates and limits are read live from each branch&apos;s VaultManager;
          &ldquo;—&rdquo; means the value hasn&apos;t loaded or the branch isn&apos;t
          configured. Manage an existing vault from its{" "}
          <Link href="/borrow/fxrp" className="text-brand hover:underline">
            collateral page
          </Link>
          .
        </p>
      </Reveal>
    </div>
  );
}
