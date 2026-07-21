// Enosys-style "Earn" pools table — one stability pool per collateral branch.
// The stability-pool contracts are not deployed yet, so every figure is an
// honest "—" placeholder (spec §5: no fabricated numbers); the Earn page (B4)
// wires the real flows.
import {
  SectionCard,
  DataTable,
  TokenIcon,
  PillButton,
  Badge,
  type DataTableColumn,
} from "@/components/ui";

type PoolRow = {
  key: string;
  name: string;
  collateralSymbol: string;
  sub: string;
};

const Dash = () => <span className="text-muted">—</span>;

const COLUMNS: Array<DataTableColumn<PoolRow>> = [
  {
    key: "pool",
    header: "Pool",
    cell: (row) => (
      <span className="flex items-center gap-2.5">
        <span className="flex items-center">
          <TokenIcon symbol="vUSD" size={32} alt="" />
          <TokenIcon
            symbol={row.collateralSymbol}
            size={32}
            alt=""
            className="-ml-2 ring-2 ring-surface"
          />
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="flex items-center gap-2 font-medium">
            {row.name}
            <Badge tone="neutral">soon</Badge>
          </span>
          <span className="text-xs text-muted">{row.sub}</span>
        </span>
      </span>
    ),
  },
  { key: "apr", header: "APR", align: "right", cell: () => <Dash /> },
  { key: "apr7d", header: "7d APR", align: "right", cell: () => <Dash /> },
  { key: "size", header: "Pool size", align: "right", cell: () => <Dash /> },
  {
    key: "action",
    header: <span className="sr-only">Action</span>,
    align: "right",
    cell: () => (
      <PillButton href="/earn" variant="ghost" size="sm">
        Earn
      </PillButton>
    ),
  },
];

const ROWS: PoolRow[] = [
  {
    key: "fxrp",
    name: "FXRP stability pool",
    collateralSymbol: "FXRP",
    sub: "Deposit vUSD · rewards in FXRP",
  },
  {
    key: "wflr",
    name: "wFLR stability pool",
    collateralSymbol: "WFLR",
    sub: "Deposit vUSD · rewards in wFLR",
  },
];

export function EarnPoolsCard() {
  return (
    <SectionCard
      title="Earn rewards with vUSD"
      subtitle="Stability pools per collateral — figures appear once the pools go live."
      bleed
    >
      <DataTable
        columns={COLUMNS}
        rows={ROWS}
        rowKey={(row) => row.key}
        caption="Earn pools: vUSD stability pools with APR and pool size"
      />
    </SectionCard>
  );
}
