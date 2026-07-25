"use client";

import { Activity } from "lucide-react";
import { Badge, Card, CardTitle, Skeleton } from "@/components/ui";
import { RollingNumber } from "@/components/motion";
import { formatPrice } from "@/lib/format";
import { useFtsoPrice } from "@/hooks/useFtsoPrice";
import { useBranch } from "@/context/branch";
import type { CollateralBranch } from "@/config/branches";

/**
 * Live FTSO price for a collateral branch. Defaults to the shared branch
 * context; pass `branch` to pin it (the borrow page drives everything off the
 * URL branch so a collateral switch is never one frame behind the context).
 */
export function LivePrice({ branch: pinned }: { branch?: CollateralBranch } = {}) {
  const { branch: contextBranch } = useBranch();
  const branch = pinned ?? contextBranch;
  const { price18, timestamp, isStale, isLoading, isError } = useFtsoPrice(branch.feedId);

  return (
    <Card>
      <div className="flex items-center justify-between">
        <CardTitle>{branch.feedLabel} · FTSOv2</CardTitle>
        {isError ? (
          <Badge tone="danger">feed error</Badge>
        ) : isStale ? (
          <Badge tone="warning">stale</Badge>
        ) : (
          <Badge tone="green">
            <Activity className="h-3 w-3" aria-hidden /> live
          </Badge>
        )}
      </div>
      <div className="mt-3 text-4xl font-semibold tabular-nums text-ink">
        {isLoading ? (
          <Skeleton className="h-10 w-40" />
        ) : (
          <RollingNumber value={formatPrice(price18)} />
        )}
      </div>
      <p className="mt-2 text-xs text-muted/70">
        {timestamp
          ? `Updated ${new Date(timestamp * 1000).toLocaleTimeString()} · block-latency feed`
          : "Reading FlareContractRegistry → FtsoV2 on Coston2"}
      </p>
    </Card>
  );
}
