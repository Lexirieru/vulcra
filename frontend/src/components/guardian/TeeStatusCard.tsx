"use client";

// Reusable on-chain status card for a Flare Confidential Compute (FCC) TEE machine.
// Built from the shared UI kit (Card / Badge / Stat) and reads the FlareTeeManager
// directly via useTeeMachine, so it shows the Guardian's PRODUCTION registration
// even when the enclave endpoint or the shared indexer is unavailable. Defaults to
// the Guardian machine; pass teeId/manager to reuse it for any FCC extension.
import { ShieldCheck } from "lucide-react";
import type { Address } from "viem";
import { Badge, Card, CardTitle, Skeleton, Stat, cn } from "@/components/ui";
import { shortenAddress } from "@/lib/format";
import { useTeeMachine } from "@/hooks/useTeeMachine";

export function TeeStatusCard({
  teeId,
  manager,
  className,
}: {
  teeId?: Address;
  manager?: Address;
  className?: string;
}) {
  const tee = useTeeMachine(teeId, manager);
  const dash = <span className="text-muted">—</span>;
  const host = tee.url
    ? tee.url.replace(/^https?:\/\//, "").replace(/\/$/, "")
    : undefined;

  return (
    <Card className={cn("flex flex-col gap-4", className)}>
      <div className="flex items-center justify-between gap-2">
        <CardTitle>
          <span className="inline-flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-brand" aria-hidden />
            Confidential keeper (TEE)
          </span>
        </CardTitle>
        {tee.isLoading ? (
          <Skeleton className="h-6 w-28" />
        ) : tee.isProduction ? (
          <Badge tone="green">PRODUCTION</Badge>
        ) : tee.status !== undefined ? (
          <Badge tone="warning">{`status ${tee.status}`}</Badge>
        ) : (
          <Badge tone="neutral">not registered</Badge>
        )}
      </div>

      <p className="text-sm text-muted">
        The Guardian runs as a Flare Compute Extension. This is its live on-chain
        registration on the FCC manager, read straight from the contract, with no
        proxy and no indexer.
      </p>

      {tee.isLoading ? (
        <Skeleton className="h-16 w-full" />
      ) : (
        <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
          <Stat
            label="Status"
            tone={tee.isProduction ? "green" : "neutral"}
            value={
              tee.isProduction
                ? "PRODUCTION"
                : tee.status !== undefined
                  ? String(tee.status)
                  : dash
            }
          />
          <Stat
            label="Extension"
            value={tee.extensionId !== undefined ? String(tee.extensionId) : dash}
          />
          <Stat
            label="TEE id"
            value={<span className="font-mono text-base">{shortenAddress(tee.teeId)}</span>}
          />
          <Stat
            label="Endpoint"
            value={host ? <span className="truncate text-base">{host}</span> : dash}
          />
        </div>
      )}

      <p className="text-xs text-muted/70">
        Attestation is simulated for the hackathon, the posture Flare approves on
        Coston2; hardware attestation on a Confidential Space VM is the post-hackathon
        step. Verify on-chain via FlareTeeManager {shortenAddress(tee.manager)} →
        getTeeMachineStatus(teeId).
      </p>
    </Card>
  );
}
