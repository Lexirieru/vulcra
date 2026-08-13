"use client";

// Enosys-style "Borrow" markets table. fxrp + wflr rows are LIVE (Coston2
// VaultManager reads via useBranchStats); stXRP + sFLR are roadmap rows,
// clearly disabled. Values that cannot be sourced live render "—" — never a
// fabricated number.
import { BRANCHES } from "@/config/branches";
import {
  SectionCard,
  DataTable,
  TokenIcon,
  ChainMarks,
  PillButton,
  RatePill,
  Badge,
  Skeleton,
  type ChainId,
  type DataTableColumn,
} from "@/components/ui";
import { formatBps, formatToken } from "@/lib/format";
import { useBranchStats, type BranchStats } from "@/hooks/useBranchStats";

type Row = {
  key: string;
  name: string;
  symbol: string;
  sub?: string;
  /** Chain(s) the collateral is supplied FROM — the "Chain" column. */
  chains: ChainId[];
  href?: string;
  live: boolean;
  stats?: BranchStats;
};

const Dash = () => <span className="text-muted">—</span>;

function RateCell({ row }: { row: Row }) {
  if (!row.live || !row.stats) return <Dash />;
  if (row.stats.isLoading) return <Skeleton className="ml-auto h-4 w-16" />;
  if (row.stats.avgRateBps === undefined) return <Dash />;
  return (
    <RatePill
      value={`${row.stats.avgCapped ? "≈" : ""}${formatBps(row.stats.avgRateBps)} p.a.`}
    />
  );
}

function LtvCell({ row }: { row: Row }) {
  if (!row.live || !row.stats) return <Dash />;
  if (row.stats.isLoading && row.stats.mcrBps === undefined)
    return <Skeleton className="ml-auto h-4 w-12" />;
  if (row.stats.mcrBps === undefined || row.stats.mcrBps === 0n) return <Dash />;
  // Max LTV is the inverse of the minimum collateral ratio: 1e8 / mcrBps → bps.
  return <span>{formatBps(1e8 / Number(row.stats.mcrBps))}</span>;
}

function DebtCell({ row }: { row: Row }) {
  if (!row.live || !row.stats) return <Dash />;
  if (row.stats.isLoading && row.stats.totalDebt18 === undefined)
    return <Skeleton className="ml-auto h-4 w-20" />;
  if (row.stats.totalDebt18 === undefined) return <Dash />;
  return <span>{formatToken(row.stats.totalDebt18, 18, 2)} vUSD</span>;
}

const COLUMNS: Array<DataTableColumn<Row>> = [
  {
    key: "collateral",
    header: "Collateral",
    cell: (row) => (
      <span className="flex items-center gap-2.5">
        <TokenIcon symbol={row.symbol} size={32} alt="" />
        <span className="flex min-w-0 flex-col">
          <span className="flex items-center gap-2 font-medium">
            {row.name}
            {!row.live && (
              <Badge tone="neutral" className="normal-case">
                Soon
              </Badge>
            )}
          </span>
          {row.sub ? <span className="text-xs text-muted">{row.sub}</span> : null}
        </span>
      </span>
    ),
  },
  {
    // Which chain the collateral is supplied FROM. FXRP shows BOTH marks — the
    // same market is fundable with FXRP on Flare or XRP from the XRP Ledger.
    key: "chain",
    header: "Chain",
    cell: (row) => <ChainMarks chains={row.chains} />,
  },
  {
    key: "rate",
    header: "Avg rate p.a.",
    align: "right",
    cell: (row) => <RateCell row={row} />,
  },
  {
    key: "ltv",
    header: "Max LTV",
    align: "right",
    cell: (row) => <LtvCell row={row} />,
  },
  {
    key: "debt",
    header: "Total debt",
    align: "right",
    cell: (row) => <DebtCell row={row} />,
  },
  {
    key: "action",
    header: <span className="sr-only">Action</span>,
    align: "right",
    cell: (row) =>
      row.live && row.href ? (
        <PillButton href={row.href} variant="ghost" size="sm">
          Borrow
        </PillButton>
      ) : (
        <PillButton href="#" variant="ghost" size="sm" disabled>
          Borrow
        </PillButton>
      ),
  },
];

export function BorrowMarketsCard() {
  const fxrp = useBranchStats(BRANCHES.fxrp);
  const wflr = useBranchStats(BRANCHES.wflr);

  const rows: Row[] = [
    {
      // ONE row for the FXRP market — the XRPL-native path funds this same
      // market (XRP becomes FXRP via FAssets), so the Chain column carries
      // both marks instead of a second row with identical numbers.
      key: "fxrp",
      name: "FXRP",
      symbol: "FXRP",
      sub: "FAssets XRP",
      chains: ["flare", "xrpl"],
      href: "/borrow/fxrp",
      live: true,
      stats: fxrp,
    },
    {
      key: "wflr",
      name: "wFLR",
      symbol: "WFLR",
      sub: "Wrapped C2FLR",
      chains: ["flare"],
      href: "/borrow/wflr",
      live: true,
      stats: wflr,
    },
    {
      key: "stxrp",
      name: "stXRP",
      symbol: "STXRP",
      sub: "Staked XRP",
      chains: ["xrpl"],
      live: false,
    },
    {
      key: "sflr",
      name: "sFLR",
      symbol: "SFLR",
      sub: "Staked FLR",
      chains: ["flare"],
      live: false,
    },
  ];

  return (
    <SectionCard
      title="Borrow vUSD against various collateral assets"
      subtitle="Live Coston2 markets — borrowers set their own interest rate."
      bleed
    >
      <DataTable
        columns={COLUMNS}
        rows={rows}
        rowKey={(row) => row.key}
        rowClassName={(row) => (row.live ? undefined : "opacity-60")}
        caption="Borrow markets: collateral assets with average interest rate, maximum LTV, and total debt"
      />
    </SectionCard>
  );
}
