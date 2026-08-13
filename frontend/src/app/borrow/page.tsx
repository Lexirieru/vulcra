"use client";

// Borrow landing — collateral picker. ONE card per market (FXRP, wFLR): live
// FTSO price, MCR-derived max LTV, contract interest bounds, min debt. The
// XRPL-native entry is the navy hero banner (→ /borrow/xrp), NOT a second card
// — the XRP path funds the same FXRP market, so a separate card read as a
// separate pool. Cards are position-aware: when you already hold a vault on a
// market (either owner — EVM wallet or the XRP-path PersonalAccount), the card
// says so and its CTA flips to "Manage". Roadmap assets (stXRP, sFLR) render
// "Soon" cards — no fabricated numbers.
import Link from "next/link";
import { Badge, Card, ChainMarks, PillButton, TokenIcon, type ChainId } from "@/components/ui";
import { Reveal, Stagger } from "@/components/motion";
import { BRANCH_ORDER, BRANCHES, type CollateralBranch } from "@/config/branches";
import { useFtsoPrice } from "@/hooks/useFtsoPrice";
import {
  useBranchPositions,
  useFxrpPositions,
  useVaultParams,
  type VaultParams,
} from "@/hooks/useVault";
import { useInterestConfig } from "@/hooks/useInterest";
import { useXrplWalletContext } from "@/context/xrpl";
import { XRPL_PROVIDERS } from "@/lib/xrpl/wallets";
import { formatBps, formatPrice, formatToken } from "@/lib/format";

const SOON: {
  symbol: string;
  label: string;
  sub: string;
  note: string;
  chains: ChainId[];
}[] = [
  {
    symbol: "STXRP",
    label: "stXRP",
    sub: "Staked XRP · Firelight",
    note: "Liquid-staked XRP as collateral — on the Vulcra roadmap.",
    chains: ["xrpl"],
  },
  {
    symbol: "SFLR",
    label: "sFLR",
    sub: "Staked FLR · Sceptre",
    note: "Liquid-staked FLR as collateral — on the Vulcra roadmap.",
    chains: ["flare"],
  },
];

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

// Shared frame for every LIVE market card — one source of truth so the FXRP
// and wFLR cards are structurally identical (same header, same four rows, same
// full-width CTA). No chain badges, no per-card ornaments.
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
  badge,
  chains,
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
  /** e.g. "You have a position" — position-aware markets show it here. */
  badge?: React.ReactNode;
  /** Chain(s) the collateral is supplied FROM. */
  chains: ChainId[];
}) {
  return (
    <Card className="flex h-full flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-3">
          <TokenIcon symbol={symbol} size={40} alt="" />
          <span>
            <span className="block text-lg font-semibold text-ink">{label}</span>
            <span className="block text-xs text-muted">{subtitle}</span>
          </span>
        </span>
        {badge}
      </div>

      <div className="space-y-1.5 border-t border-line pt-3">
        <PickerRow left="Supply from" right={<ChainMarks chains={chains} />} />
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
  // Aave-style position awareness: the market card knows when you already hold
  // a vault here (either owner) and flips its CTA to "Manage" — a second vault
  // is never the default path.
  const { count } = useBranchPositions(branch);
  const hasPosition = count > 0;

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
      chains={branch.hasXrplMint ? ["flare", "xrpl"] : ["flare"]}
      badge={hasPosition ? <Badge tone="green">You have a position</Badge> : undefined}
      ctaLabel={
        hasPosition
          ? `Manage your ${branch.label} position${count > 1 ? "s" : ""}`
          : `Borrow against ${branch.label}`
      }
      ctaHref={`/borrow/${branch.key}`}
    />
  );
}

function SoonCard({ symbol, label, sub, note, chains }: (typeof SOON)[number]) {
  return (
    <Card className="flex h-full flex-col gap-4">
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
      <div className="space-y-1.5 border-t border-line pt-3">
        <PickerRow left="Supply from" right={<ChainMarks chains={chains} />} />
      </div>
      <p className="mt-auto text-sm text-muted">{note}</p>
    </Card>
  );
}

export default function BorrowPage() {
  const wallet = useXrplWalletContext();
  const xrpConnected = Boolean(wallet.address);
  const providerName = wallet.providerId
    ? XRPL_PROVIDERS[wallet.providerId].name
    : "your XRP wallet";
  // Position awareness for the hero + footer: the XRP hero flips to "manage"
  // when the PersonalAccount vault exists, and the footer names the markets
  // where the user actually has something to manage.
  const fxrpPositions = useFxrpPositions();
  const wflrPositions = useBranchPositions(BRANCHES.wflr);
  const totalPositions = fxrpPositions.count + wflrPositions.count;
  const xrplHasVault = Boolean(fxrpPositions.xrpl);
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
                {xrplHasVault
                  ? "Your XRP-path vault is live — manage collateral, debt, and interest in a single XRP Ledger payment."
                  : xrpConnected
                    ? `${providerName} is connected — borrow vUSD against your XRP in a single XRP Ledger payment, no EVM wallet or FLR needed.`
                    : "Connect an XRPL wallet (Crossmark / GemWallet) and borrow vUSD against your XRP in a single XRP Ledger payment — no EVM wallet or FLR needed."}
              </p>
            </div>
          </div>
          <span className="inline-flex shrink-0 items-center gap-2 self-start rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-navy sm:self-auto">
            {xrplHasVault
              ? "Manage your XRP vault →"
              : xrpConnected
                ? "Borrow with XRP →"
                : "Connect XRP wallet"}
          </span>
        </Link>
      </Reveal>

      <Stagger className="grid items-stretch gap-4 sm:grid-cols-2" startDelay={0.05} itemClassName="h-full">
        {BRANCH_ORDER.map((k) => (
          <BranchCard key={k} branch={BRANCHES[k]} />
        ))}
        {SOON.map((s) => (
          <SoonCard key={s.symbol} {...s} />
        ))}
      </Stagger>

      <Reveal delay={0.15}>
        {totalPositions > 0 ? (
          <p className="text-xs text-muted/80">
            You have {totalPositions} open position{totalPositions > 1 ? "s" : ""} —
            manage {totalPositions > 1 ? "them" : "it"} on the{" "}
            {fxrpPositions.count > 0 && (
              <Link
                href="/borrow/fxrp"
                className="text-brand underline underline-offset-2"
              >
                FXRP market
              </Link>
            )}
            {fxrpPositions.count > 0 && wflrPositions.count > 0 && " and the "}
            {wflrPositions.count > 0 && (
              <Link
                href="/borrow/wflr"
                className="text-brand underline underline-offset-2"
              >
                wFLR market
              </Link>
            )}
            .
          </p>
        ) : (
          <p className="text-xs text-muted/80">
            Rates and limits are read live from each branch&apos;s VaultManager;
            &ldquo;—&rdquo; means the value hasn&apos;t loaded or the branch isn&apos;t
            configured. Open a vault and this page will point you back to it.
          </p>
        )}
      </Reveal>
    </div>
  );
}
