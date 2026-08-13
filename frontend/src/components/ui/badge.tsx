import * as React from "react";
import { cn } from "./cn";

export type BadgeTone =
  | "neutral"
  | "brand"
  | "navy"
  | "green"
  | "orange"
  | "warning"
  | "danger";

// Tailwind only sees literal class strings, so every tone is written out.
const BRAND_TINT =
  "bg-[color-mix(in_srgb,var(--color-brand)_10%,transparent)] text-[var(--color-brand)] border-[color-mix(in_srgb,var(--color-brand)_28%,transparent)]";
const GREEN_TINT =
  "bg-[color-mix(in_srgb,var(--color-green)_10%,transparent)] text-[var(--color-green)] border-[color-mix(in_srgb,var(--color-green)_28%,transparent)]";

const TONE: Record<BadgeTone, string> = {
  neutral:
    "bg-[var(--color-surface-2)] text-[var(--color-muted)] border-[var(--color-line)]",
  brand: BRAND_TINT,
  navy: "bg-[color-mix(in_srgb,var(--color-navy)_8%,transparent)] text-[var(--color-navy)] border-[color-mix(in_srgb,var(--color-navy)_25%,transparent)]",
  green: GREEN_TINT,
  orange:
    "bg-[color-mix(in_srgb,var(--color-orange)_10%,transparent)] text-[var(--color-orange)] border-[color-mix(in_srgb,var(--color-orange)_28%,transparent)]",
  warning:
    "bg-[color-mix(in_srgb,var(--color-warning)_12%,transparent)] text-[color-mix(in_srgb,var(--color-warning)_70%,var(--color-ink))] border-[color-mix(in_srgb,var(--color-warning)_35%,transparent)]",
  danger:
    "bg-[color-mix(in_srgb,var(--color-danger)_10%,transparent)] text-[var(--color-danger)] border-[color-mix(in_srgb,var(--color-danger)_28%,transparent)]",
};

export function Badge({
  tone = "neutral",
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium",
        TONE[tone],
        className,
      )}
      {...props}
    />
  );
}

/** Rate/percentage chip with tabular digits, e.g. <RatePill value="5.2% p.a." />. */
export function RatePill({
  value,
  tone = "green",
  className,
}: {
  value: React.ReactNode;
  tone?: BadgeTone;
  className?: string;
}) {
  return (
    <Badge tone={tone} className={cn("font-semibold tabular-nums", className)}>
      {value}
    </Badge>
  );
}
