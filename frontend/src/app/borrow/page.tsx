"use client";

// Borrow landing — market picker. Markets are SEPARATE per supply chain:
// XRP (XRP Ledger → /borrow/xrp), FXRP (Flare → /borrow/fxrp), wFLR (Flare),
// plus stXRP/sFLR "Soon" cards. The XRP and FXRP markets settle on the same
// VaultManager on-chain, but each card carries ONE chain, its own route, and
// its own position-awareness (XRP card watches the PersonalAccount vault; the
// Flare cards watch the EVM wallet's vault). Live figures only — FTSO price,
// MCR-derived max LTV, contract interest bounds, min debt; no fabricated
// numbers on the roadmap cards.
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
  // Flare-market card → EVM-wallet position ONLY. A PersonalAccount vault
  // belongs to the separate XRP market card, never here.
  const { evm } = useBranchPositions(branch);
  const hasPosition = Boolean(evm);

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
      chains={["flare"]}
      badge={hasPosition ? <Badge tone="green">You have a position</Badge> : undefined}
      ctaLabel={
        hasPosition ? `Manage your ${branch.label} vault` : `Borrow against ${branch.label}`
      }
      ctaHref={`/borrow/${branch.key}`}
    />
  );
}

// XRP — its own market card, distinguished by supply chain (XRP Ledger): you
// supply XRP from Crossmark/GemWallet, no EVM wallet. Settles on the FXRP
// VaultManager on Flare, so it reads that branch's live price/params, but the
// route, wallet, position (PersonalAccount vault) and framing are all its own.
function XrpLedgerCard() {
  const branch = BRANCHES.fxrp;
  const vaultManager = branch.vaultManager || undefined;
  const { price18, isStale } = useFtsoPrice(branch.feedId);
  const { params } = useVaultParams(vaultManager);
  const { config: interest } = useInterestConfig(vaultManager, branch.interest);
  const { xrpl } = useBranchPositions(branch);
  const hasPosition = Boolean(xrpl);

  return (
    <LiveCard
      symbol="XRP"
      label="XRP"
      subtitle="On the XRP Ledger · becomes FXRP via FAssets"
      feedLabel={branch.feedLabel}
      price18={price18}
      isStale={isStale}
      params={params}
      interest={interest}
      chains={["xrpl"]}
      badge={hasPosition ? <Badge tone="green">You have a position</Badge> : undefined}
      ctaLabel={hasPosition ? "Manage your XRP vault" : "Borrow with XRP"}
      ctaHref="/borrow/xrp"
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
            Choose a market — each is set apart by the chain you supply from.
            Deposit collateral, borrow vUSD, and set your own interest rate.
            Hold XRP? <span className="text-ink">Supply it straight from the XRP
            Ledger</span> on the XRP market — one payment, no EVM wallet or FLR
            required.
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
                  ? "Your XRP vault is live — manage collateral, debt, and interest in a single XRP Ledger payment."
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
        <XrpLedgerCard key="xrp" />
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
            manage {totalPositions > 1 ? "them" : "it"} on{" "}
            {[
              fxrpPositions.xrpl && { label: "the XRP market", href: "/borrow/xrp" },
              fxrpPositions.evm && { label: "the FXRP market", href: "/borrow/fxrp" },
              wflrPositions.evm && { label: "the wFLR market", href: "/borrow/wflr" },
            ]
              .filter((m): m is { label: string; href: string } => Boolean(m))
              .map((m, i, all) => (
                <span key={m.href}>
                  {i > 0 && (i === all.length - 1 ? " and " : ", ")}
                  <Link href={m.href} className="text-brand underline underline-offset-2">
                    {m.label}
                  </Link>
                </span>
              ))}
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
