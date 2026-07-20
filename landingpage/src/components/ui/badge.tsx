import type { ReactNode } from "react";

type BadgeProps = {
  children: ReactNode;
  variant?: "muted" | "ember";
  mono?: boolean;
  className?: string;
};

const variants = {
  muted:
    "border-border bg-secondary/40 text-muted-foreground",
  ember:
    "border-primary/30 bg-primary/10 text-primary",
} as const;

export function Badge({
  children,
  variant = "muted",
  mono = false,
  className = "",
}: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs ${
        mono ? "font-mono" : "font-medium"
      } ${variants[variant]} ${className}`}
    >
      {children}
    </span>
  );
}
