"use client";

// "Your positions" — the Aave-style dashboard anchor: every vault the connected
// wallets hold (EVM-owned per branch + the XRP-path PersonalAccount vault) and
// every stability-pool deposit, each a row with live figures, a health badge and
// a Manage link into its surface. Renders NOTHING until at least one position
// exists — the dashboard stays a clean landing for new users and no fabricated
// zeros ever show.
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Badge, ChainMarks, SectionCard, TokenIcon, type ChainId } from "@/components/ui";
import { Reveal } from "@/components/motion";
import { useStabilityPool } from "@/components/earn/useStabilityPool";
import { BRANCHES, type CollateralBranch } from "@/config/branches";
import {
  useBranchPositions,
  useVaultParams,
  type BranchPosition,
} from "@/hooks/useVault";
import { useFtsoPrice } from "@/hooks/useFtsoPrice";
import { computeCrBps, healthBand } from "@/lib/vault-math";
import { formatBps, formatToken, shortenAddress } from "@/lib/format";

function Cell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span className="flex items-baseline justify-between gap-2 sm:block sm:text-right">
      <span className="text-xs text-muted sm:hidden">{label}</span>
      <span className="tabular-nums">{children}</span>
    </span>
  );
}

const ROW_GRID =
  "group flex flex-col gap-3 border-b border-line px-5 py-4 transition-colors last:border-b-0 hover:bg-surface-2/60 sm:grid sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_1fr_1fr_auto_auto] sm:items-center sm:gap-4";

// The mobile-visible "Chain" cell — left-aligned on desktop (it's identity,
// not a figure), labelled like every other stacked cell on mobile.
function ChainCell({ chain }: { chain: ChainId }) {
  return (
    <span className="flex items-center justify-between gap-2 sm:block">
      <span className="text-xs text-muted sm:hidden">Chain</span>
      <ChainMarks chains={[chain]} />
    </span>
  );
}

function VaultRow({
  branch,
  position,
  ownerLabel,
  href,
  collateralSymbol,
  chain,
}: {
  branch: CollateralBranch;
  position: BranchPosition;
  ownerLabel: string;
  href: string;
  /** "XRP" on the XRP rail, the branch token symbol on the EVM rail. */
  collateralSymbol: string;
  /** Where this position's collateral is supplied from (owner-specific). */
  chain: ChainId;
}) {
  const { price18 } = useFtsoPrice(branch.feedId);
  const { params } = useVaultParams(branch.vaultManager || undefined);
  const crBps = price18
    ? computeCrBps(
        position.vault.collateral,
        branch.collateralDecimals,
        position.vault.debt18,
        price18,
      )
    : null;
  const band = healthBand(crBps, params.mcrBps);
  const riskLabel =
    band === "danger" ? "High risk" : band === "warning" ? "Watch" : "Healthy";

  return (
    <Link href={href} className={ROW_GRID}>
      {/* ONE token logo — the collateral. The Chain cell carries the chain. */}
      <span className="flex min-w-0 items-center gap-3">
        <TokenIcon symbol={collateralSymbol} size={32} alt="" />
        <span className="flex min-w-0 flex-col">
          <span className="font-medium text-ink">{branch.label} vault</span>
          <span className="truncate text-xs text-muted">{ownerLabel}</span>
        </span>
      </span>

      <ChainCell chain={chain} />

      <Cell label="Collateral">
        <span className="text-ink">
          {formatToken(position.vault.collateral, branch.collateralDecimals, 2)}{" "}
          <span className="text-xs text-muted">{collateralSymbol}</span>
        </span>
      </Cell>
      <Cell label="Debt">
        <span className="text-ink">
          {formatToken(position.vault.debt18, 18, 2)}{" "}
          <span className="text-xs text-muted">vUSD</span>
        </span>
      </Cell>

      <Badge tone={band === "danger" ? "danger" : band === "warning" ? "warning" : "green"}>
        {riskLabel}
      </Badge>
      <ChevronRight
        className="hidden h-5 w-5 shrink-0 text-muted transition-colors group-hover:text-ink sm:block"
        aria-hidden
      />
    </Link>
  );
}

function PoolRow({
  branch,
  deposit18,
  aprBps,
}: {
  branch: CollateralBranch;
  deposit18: bigint;
  aprBps?: number;
}) {
  return (
    <Link href={`/earn/${branch.key}`} className={ROW_GRID}>
      {/* ONE token logo — the deposit asset (vUSD). Pools live on Flare. */}
      <span className="flex min-w-0 items-center gap-3">
        <TokenIcon symbol="vUSD" size={32} alt="" />
        <span className="flex min-w-0 flex-col">
          <span className="font-medium text-ink">{branch.label} Stability Pool</span>
          <span className="truncate text-xs text-muted">
            vUSD deposit · earning loan fees
          </span>
        </span>
      </span>

      <ChainCell chain="flare" />

      <Cell label="Deposit">
        <span className="text-ink">
          {formatToken(deposit18, 18, 2)}{" "}
          <span className="text-xs text-muted">vUSD</span>
        </span>
      </Cell>
      <Cell label="APR">
        {aprBps !== undefined ? (
          <span className="font-medium text-ink">{formatBps(aprBps)}</span>
        ) : (
          <span className="text-muted">—</span>
        )}
      </Cell>

      <Badge tone="brand">Earning</Badge>
      <ChevronRight
        className="hidden h-5 w-5 shrink-0 text-muted transition-colors group-hover:text-ink sm:block"
        aria-hidden
      />
    </Link>
  );
}

export function YourPositionsCard() {
  const fxrp = useBranchPositions(BRANCHES.fxrp);
  const wflr = useBranchPositions(BRANCHES.wflr);
  const fxrpPool = useStabilityPool(BRANCHES.fxrp);
  const wflrPool = useStabilityPool(BRANCHES.wflr);

  const fxrpDeposit =
    fxrpPool.userDeposit18 !== undefined && fxrpPool.userDeposit18 > 0n
      ? fxrpPool.userDeposit18
      : undefined;
  const wflrDeposit =
    wflrPool.userDeposit18 !== undefined && wflrPool.userDeposit18 > 0n
      ? wflrPool.userDeposit18
      : undefined;

  const any =
    fxrp.count + wflr.count > 0 ||
    fxrpDeposit !== undefined ||
    wflrDeposit !== undefined;
  if (!any) return null;

  return (
    <Reveal className="min-w-0">
      <SectionCard
        title="Your positions"
        subtitle="Live from Coston2 — vaults on both rails, plus stability-pool deposits."
        bleed
      >
        <div className="hidden grid-cols-[minmax(0,2fr)_minmax(0,1fr)_1fr_1fr_auto_auto] gap-4 border-b border-line bg-surface-2/50 px-5 py-3 text-xs font-medium text-muted sm:grid">
          <span>Position</span>
          <span>Chain</span>
          <span className="text-right">Collateral / Deposit</span>
          <span className="text-right">Debt / APR</span>
          <span>Health</span>
          <span className="w-5" aria-hidden />
        </div>
        {fxrp.evm && (
          <VaultRow
            branch={BRANCHES.fxrp}
            position={fxrp.evm}
            ownerLabel={`EVM wallet · ${shortenAddress(fxrp.evm.owner)}`}
            href="/borrow/fxrp"
            collateralSymbol="FXRP"
            chain="flare"
          />
        )}
        {fxrp.xrpl && (
          <VaultRow
            branch={BRANCHES.fxrp}
            position={fxrp.xrpl}
            ownerLabel={`XRP Ledger · personal account ${shortenAddress(fxrp.xrpl.owner)}`}
            href="/borrow/xrp"
            collateralSymbol="XRP"
            chain="xrpl"
          />
        )}
        {wflr.evm && (
          <VaultRow
            branch={BRANCHES.wflr}
            position={wflr.evm}
            ownerLabel={`EVM wallet · ${shortenAddress(wflr.evm.owner)}`}
            href="/borrow/wflr"
            collateralSymbol="wFLR"
            chain="flare"
          />
        )}
        {fxrpDeposit !== undefined && (
          <PoolRow branch={BRANCHES.fxrp} deposit18={fxrpDeposit} aprBps={fxrpPool.aprBps} />
        )}
        {wflrDeposit !== undefined && (
          <PoolRow branch={BRANCHES.wflr} deposit18={wflrDeposit} aprBps={wflrPool.aprBps} />
        )}
      </SectionCard>
    </Reveal>
  );
}
