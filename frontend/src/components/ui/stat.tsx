import * as React from "react";
import { cn } from "./cn";

type StatTone = "neutral" | "green" | "warning" | "danger" | "brand";

const STAT_TONE: Record<StatTone, string> = {
  neutral: "text-[var(--color-ink)]",
  green: "text-[var(--color-green)]",
  warning: "text-[var(--color-warning)]",
  danger: "text-[var(--color-danger)]",
  brand: "text-[var(--color-brand)]",
};

/** Legacy vertical stat block (label over large value). */
export function Stat({
  label,
  value,
  sub,
  tone = "neutral",
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  tone?: StatTone;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs tracking-wide text-[var(--color-muted)] uppercase">
        {label}
      </span>
      <span className={cn("text-2xl font-semibold tabular-nums", STAT_TONE[tone])}>
        {value}
      </span>
      {sub ? (
        <span className="text-xs text-[var(--color-muted)]">{sub}</span>
      ) : null}
    </div>
  );
}

/** Compact inline stat for the fixed bottom stats bar: icon · label · value. */
export function StatItem({
  label,
  value,
  icon,
  className,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  icon?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 items-center gap-2", className)}>
      {icon}
      <span className="text-xs whitespace-nowrap text-[var(--color-muted)]">{label}</span>
      <span className="text-sm font-semibold tabular-nums whitespace-nowrap text-[var(--color-ink)]">
        {value}
      </span>
    </div>
  );
}
