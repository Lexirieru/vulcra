"use client";

import { Activity } from "lucide-react";
import { Badge, Card, CardTitle, Skeleton } from "@/components/ui";
import { RollingNumber } from "@/components/motion";
import { formatPrice } from "@/lib/format";
import { useFtsoPrice } from "@/hooks/useFtsoPrice";

export function LivePrice() {
  const { price18, timestamp, isStale, isLoading, isError } = useFtsoPrice();

  return (
    <Card>
      <div className="flex items-center justify-between">
        <CardTitle>XRP / USD · FTSOv2</CardTitle>
        {isError ? (
          <Badge tone="danger">feed error</Badge>
        ) : isStale ? (
          <Badge tone="warning">stale</Badge>
        ) : (
          <Badge tone="healthy">
            <Activity className="h-3 w-3" aria-hidden /> live
          </Badge>
        )}
      </div>
      <div className="mt-3 font-mono text-4xl tabular-nums text-text">
        {isLoading ? (
          <Skeleton className="h-10 w-40" />
        ) : (
          <RollingNumber value={formatPrice(price18)} />
        )}
      </div>
      <p className="mt-2 text-xs text-faint">
        {timestamp
          ? `Updated ${new Date(timestamp * 1000).toLocaleTimeString()} · block-latency feed`
          : "Reading FlareContractRegistry → FtsoV2 on Coston2"}
      </p>
    </Card>
  );
}
