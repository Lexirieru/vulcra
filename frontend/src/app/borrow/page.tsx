"use client";

// Borrow landing — collateral picker. Live branches (FXRP, wFLR) plus the
// dedicated XRP (XRP Ledger) entry show real data only: FTSO price, MCR-derived
// max LTV, contract interest bounds, min debt. Every live card shares ONE
// presentational frame (LiveCard) so they are pixel-identical. Roadmap assets
// (stXRP, sFLR) render "Soon" cards — no fabricated numbers.
import Link from "next/link";
import { Badge, Card, PillButton, TokenIcon } from "@/components/ui";
import { Reveal, Stagger } from "@/components/motion";
import { BRANCH_ORDER, BRANCHES, type CollateralBranch } from "@/config/branches";
import { useFtsoPrice } from "@/hooks/useFtsoPrice";
import { useVaultParams, type VaultParams } from "@/hooks/useVault";
import { useInterestConfig } from "@/hooks/useInterest";
import { formatBps, formatPrice, formatToken } from "@/lib/format";

const SOON = [
  {
    symbol: "STXRP",
    label: "stXRP",
    sub: "Staked XRP · Firelight",
    note: "Liquid-staked XRP as collateral — on the Vulcra roadmap.",
  },
  {
    symbol: "SFLR",
    label: "sFLR",
    sub: "Staked FLR · Sceptre",
    note: "Liquid-staked FLR as collateral — on the Vulcra roadmap.",
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

function ltvFromMcr(params: VaultParams): string {
  return params.isDefault
    ? "—"
    : `${((100 * 10_000) / Number(params.mcrBps)).toLocaleString("en-US", {
        maximumFractionDigits: 1,
      })}%`;
}

// Shared frame for every LIVE collateral card — one source of truth so the XRP
// card and the FXRP/wFLR cards are structurally identical (same header, same
// four rows, same full-width CTA). No chain badges, no per-card ornaments.
function LiveCard({
  symbol,
  label,
  subtitle,
  feedLabel,
  price18,
  isStale,
  params,
  interest,
  ctaLabel,
  ctaHref,
}: {
  symbol: string;
  label: string;
  subtitle: string;
  feedLabel: string;
  price18?: bigint;
  isStale: boolean;
  params: VaultParams;
  interest: { isDefault: boolean; minBps: number; maxBps: number };
  ctaLabel: string;
  ctaHref: string;
}) {
  return (
    <Card className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <TokenIcon symbol={symbol} size={40} alt="" />
        <span>
          <span className="block text-lg font-semibold text-ink">{label}</span>
          <span className="block text-xs text-muted">{subtitle}</span>
        </span>
      </div>

      <div className="space-y-1.5 border-t border-line pt-3">
        <PickerRow
          left={
            <span className="inline-flex items-center gap-1.5">
              {feedLabel} price {isStale && <Badge tone="warning">stale</Badge>}
            </span>
          }
          right={formatPrice(price18)}
        />
        <PickerRow left="Max LTV" right={ltvFromMcr(params)} />
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

      <div className="mt-auto">
        <PillButton href={ctaHref} size="sm" className="w-full">
          {ctaLabel}
        </PillButton>
      </div>
    </Card>
  );
}

function BranchCard({ branch }: { branch: CollateralBranch }) {
  const vaultManager = branch.vaultManager || undefined;
  const { price18, isStale } = useFtsoPrice(branch.feedId);
  const { params } = useVaultParams(vaultManager);
  const { config: interest } = useInterestConfig(vaultManager, branch.interest);

  return (
    <LiveCard
      symbol={branch.collateralSymbol}
      label={branch.label}
      subtitle={
        branch.hasXrplMint ? "FXRP on Flare · via FAssets" : `${branch.collateralSymbol} · Coston2`
      }
      feedLabel={branch.feedLabel}
      price18={price18}
      isStale={isStale}
      params={params}
      interest={interest}
      ctaLabel={`Borrow against ${branch.label}`}
      ctaHref={`/borrow/${branch.key}`}
    />
  );
}

// XRP (XRP Ledger) — the XRPL-native entry, a SEPARATE card from FXRP: what you
// supply is XRP on the XRP Ledger (Crossmark/GemWallet), which becomes FXRP
// collateral on Flare via FAssets. It reads the FXRP branch's live price/params
// but frames everything as XRP and deep-links into the dedicated /borrow/xrp page.
function XrpLedgerCard() {
  const branch = BRANCHES.fxrp;
  const vaultManager = branch.vaultManager || undefined;
  const { price18, isStale } = useFtsoPrice(branch.feedId);
  const { params } = useVaultParams(vaultManager);
  const { config: interest } = useInterestConfig(vaultManager, branch.interest);

  return (
    <LiveCard
      symbol="XRP"
      label="XRP"
      subtitle="On the XRP Ledger · testnet"
      feedLabel={branch.feedLabel}
      price18={price18}
      isStale={isStale}
      params={params}
      interest={interest}
      ctaLabel="Borrow with XRP"
      ctaHref="/borrow/xrp"
    />
  );
}

function SoonCard({ symbol, label, sub, note }: (typeof SOON)[number]) {
  return (
    <Card className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-3">
          <TokenIcon symbol={symbol} size={40} alt="" />
          <span>
            <span className="block text-lg font-semibold text-ink">{label}</span>
            <span className="block text-xs text-muted">{sub}</span>
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
            Coston2. Deposit collateral, borrow vUSD, and set your own interest rate.
            Hold XRP? <span className="text-ink">Supply it straight from the XRP
            Ledger</span> as collateral — one payment, no EVM wallet or FLR required.
          </p>
        </div>
      </Reveal>

      <Reveal delay={0.03}>
        <Link
          href="/borrow/xrp"
          className="group flex flex-col gap-4 rounded-[20px] bg-navy p-5 text-white shadow-[0_12px_30px_-16px_rgb(16_20_43/0.6)] transition-transform hover:-translate-y-0.5 sm:flex-row sm:items-center sm:justify-between sm:p-6"
        >
          <div className="flex items-center gap-4">
            <span className="grid size-12 shrink-0 place-items-center rounded-full bg-white">
              <TokenIcon symbol="XRP" size={30} alt="" />
            </span>
            <div>
              <div className="text-base font-semibold sm:text-lg">
                Have XRP? Borrow vUSD straight from your XRP wallet
              </div>
              <p className="mt-0.5 max-w-xl text-sm text-white/75">
                Connect an XRPL wallet (Crossmark / GemWallet) and borrow vUSD against
                your XRP in a single XRP Ledger payment — no EVM wallet or FLR needed.
              </p>
            </div>
          </div>
          <span className="inline-flex shrink-0 items-center gap-2 self-start rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-navy sm:self-auto">
            Connect XRP wallet
          </span>
        </Link>
      </Reveal>

      <Stagger className="grid gap-4 sm:grid-cols-2" startDelay={0.05}>
        <XrpLedgerCard key="xrp" />
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
