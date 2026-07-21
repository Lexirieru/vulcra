import * as React from "react";
import { cn } from "./cn";
import { Button } from "./button";

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn("animate-pulse rounded-md bg-[var(--color-surface-2)]", className)}
      aria-hidden
    />
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-[20px] border border-dashed border-[var(--color-line)] bg-[var(--color-surface-2)] px-6 py-10 text-center">
      <h3 className="text-base font-semibold text-[var(--color-ink)]">{title}</h3>
      {description ? (
        <p className="max-w-sm text-sm text-[var(--color-muted)]">{description}</p>
      ) : null}
      {action}
    </div>
  );
}

export function ErrorState({
  title = "Something went wrong",
  description,
  onRetry,
}: {
  title?: string;
  description?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-[20px] border border-[color-mix(in_srgb,var(--color-danger)_30%,transparent)] bg-[color-mix(in_srgb,var(--color-danger)_5%,transparent)] px-6 py-8 text-center">
      <h3 className="text-base font-semibold text-[var(--color-danger)]">{title}</h3>
      {description ? (
        <p className="max-w-sm text-sm text-[var(--color-muted)]">{description}</p>
      ) : null}
      {onRetry ? (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          Retry
        </Button>
      ) : null}
    </div>
  );
}
