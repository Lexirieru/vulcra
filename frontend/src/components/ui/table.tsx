// Enosys-style data table: light header band, hairline row dividers,
// right-aligned numerics, hover rows. Purely presentational (server-safe) —
// put links/buttons in cells instead of row click handlers.
import * as React from "react";
import { cn } from "./cn";

export type DataTableColumn<T> = {
  /** Stable column id (React key). */
  key: string;
  header: React.ReactNode;
  /** "right" also applies tabular-nums — use it for every numeric column. */
  align?: "left" | "right" | "center";
  headerClassName?: string;
  cellClassName?: string;
  cell: (row: T, index: number) => React.ReactNode;
};

const ALIGN: Record<NonNullable<DataTableColumn<unknown>["align"]>, string> = {
  left: "text-left",
  right: "text-right tabular-nums",
  center: "text-center",
};

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  caption,
  empty,
  className,
  rowClassName,
}: {
  columns: Array<DataTableColumn<T>>;
  rows: T[];
  /** Defaults to the row index — pass a real key for dynamic lists. */
  rowKey?: (row: T, index: number) => React.Key;
  /** Screen-reader-only table description (recommended). */
  caption?: string;
  /** Rendered inside the table when `rows` is empty. */
  empty?: React.ReactNode;
  className?: string;
  /** Per-row extra classes, e.g. to grey out "Soon" rows. */
  rowClassName?: (row: T, index: number) => string | undefined;
}) {
  return (
    <div className={cn("w-full overflow-x-auto", className)}>
      <table className="w-full border-collapse text-sm">
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        <thead>
          <tr className="bg-[var(--color-surface-2)]">
            {columns.map((col) => (
              <th
                key={col.key}
                scope="col"
                className={cn(
                  "px-4 py-3 text-xs font-medium whitespace-nowrap text-[var(--color-muted)] first:pl-5 last:pr-5 sm:first:pl-6 sm:last:pr-6",
                  ALIGN[col.align ?? "left"],
                  col.headerClassName,
                )}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td
                colSpan={columns.length}
                className="px-4 py-8 text-center text-sm text-[var(--color-muted)]"
              >
                {empty ?? "—"}
              </td>
            </tr>
          ) : (
            rows.map((row, i) => (
              <tr
                key={rowKey ? rowKey(row, i) : i}
                className={cn(
                  "border-t border-[var(--color-line)] transition-colors hover:bg-[var(--color-surface-2)]",
                  rowClassName?.(row, i),
                )}
              >
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={cn(
                      "px-4 py-3.5 text-[var(--color-ink)] first:pl-5 last:pr-5 sm:first:pl-6 sm:last:pr-6",
                      ALIGN[col.align ?? "left"],
                      col.cellClassName,
                    )}
                  >
                    {col.cell(row, i)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
