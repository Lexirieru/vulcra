"use client";

// Earn pools table — one stability pool per collateral branch. TVL and APR are
// read LIVE from the StabilityPool contracts on Coston2 via useStabilityPool,
// the same source the /earn page uses (no placeholders once a pool is seeded).
import {
  SectionCard,
  DataTable,
  TokenIcon,
  ChainMarks,
  PillButton,
  Badge,
  type DataTableColumn,
} from "@/components/ui";
import { BRANCHES } from "@/config/branches";
import { useStabilityPool } from "@/components/earn/useStabilityPool";
import { formatBps, formatToken } from "@/lib/format";

type PoolRow = {
  key: string;
  name: string;
  sub: string;
  aprBps?: number;
  apr7dBps?: number;
  tvl18?: bigint;
};

const Dash = () => <span className="text-muted">—</span>;

const COLUMNS: Array<DataTableColumn<PoolRow>> = [
  {
    key: "pool",
    header: "Pool",
    // ONE token logo — the deposit asset (vUSD); the branch is in the name.
    cell: (row) => (
      <span className="flex items-center gap-2.5">
        <TokenIcon symbol="vUSD" size={32} alt="" />
        <span className="flex min-w-0 flex-col">
          <span className="flex items-center gap-2 font-medium">
            {row.name}
            {row.tvl18 !== undefined && <Badge tone="green">live</Badge>}
          </span>
          <span className="text-xs text-muted">{row.sub}</span>
        </span>
      </span>
    ),
  },
  {
    key: "chain",
    header: "Chain",
    cell: () => <ChainMarks chains={["flare"]} />,
  },
  {
    key: "apr",
    header: "APR",
    align: "right",
    cell: (row) =>
      row.aprBps !== undefined ? (
        <span className="tabular-nums">{formatBps(row.aprBps)}</span>
      ) : (
        <Dash />
      ),
  },
  {
    key: "apr7d",
    header: "7d APR",
    align: "right",
    cell: (row) =>
      row.apr7dBps !== undefined ? (
        <span className="tabular-nums">{formatBps(row.apr7dBps)}</span>
      ) : (
        <Dash />
      ),
  },
  {
    key: "size",
    header: "Pool size",
    align: "right",
    cell: (row) =>
      row.tvl18 !== undefined ? (
        <span className="tabular-nums">{formatToken(row.tvl18, 18, 0)} vUSD</span>
      ) : (
        <Dash />
      ),
  },
  {
    key: "action",
    header: <span className="sr-only">Action</span>,
    align: "right",
    cell: (row) => (
      <PillButton href={`/earn/${row.key}`} variant="ghost" size="sm">
        Earn
      </PillButton>
    ),
  },
];

export function EarnPoolsCard() {
  const fxrp = useStabilityPool(BRANCHES.fxrp);
  const wflr = useStabilityPool(BRANCHES.wflr);

  const rows: PoolRow[] = [
    {
      key: "fxrp",
      name: "FXRP stability pool",
      sub: "Deposit vUSD · rewards in FXRP",
      aprBps: fxrp.aprBps,
      apr7dBps: fxrp.apr7dBps,
      tvl18: fxrp.tvl18,
    },
    {
      key: "wflr",
      name: "wFLR stability pool",
      sub: "Deposit vUSD · rewards in wFLR",
      aprBps: wflr.aprBps,
      apr7dBps: wflr.apr7dBps,
      tvl18: wflr.tvl18,
    },
  ];

  return (
    <SectionCard
      title="Earn rewards with vUSD"
      subtitle="Stability pools per collateral — TVL and APR read live from Coston2."
      bleed
    >
      <DataTable
        columns={COLUMNS}
        rows={rows}
        rowKey={(row) => row.key}
        caption="Earn pools: vUSD stability pools with APR and pool size"
      />
    </SectionCard>
  );
}
