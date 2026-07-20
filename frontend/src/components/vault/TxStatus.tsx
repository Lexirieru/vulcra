"use client";

// Shared transaction lifecycle display (KTD8). Same look for every write action.
import { CheckCircle2, ExternalLink, Loader2, XCircle } from "lucide-react";
import type { TxPhase } from "@/hooks/useVaultAction";

const EXPLORER = "https://coston2-explorer.flare.network/tx";

export function TxStatus({
  phase,
  hash,
  error,
}: {
  phase: TxPhase;
  hash?: `0x${string}`;
  error?: Error | null;
}) {
  if (phase === "idle") return null;

  return (
    <div className="mt-3 flex items-center gap-2 text-sm">
      {phase === "signing" && (
        <>
          <Loader2 className="h-4 w-4 animate-spin text-ember" aria-hidden />
          <span className="text-muted">Confirm in your wallet…</span>
        </>
      )}
      {phase === "confirming" && (
        <>
          <Loader2 className="h-4 w-4 animate-spin text-ember" aria-hidden />
          <span className="text-muted">Waiting for confirmation…</span>
        </>
      )}
      {phase === "success" && (
        <>
          <CheckCircle2 className="h-4 w-4 text-healthy" aria-hidden />
          <span className="text-healthy">Confirmed</span>
        </>
      )}
      {phase === "error" && (
        <>
          <XCircle className="h-4 w-4 text-danger" aria-hidden />
          <span className="text-danger">
            {error?.message?.split("\n")[0] ?? "Transaction failed"}
          </span>
        </>
      )}
      {hash && (
        <a
          href={`${EXPLORER}/${hash}`}
          target="_blank"
          rel="noopener noreferrer"
          className="ml-auto inline-flex items-center gap-1 text-ember hover:text-ember-bright"
        >
          Explorer <ExternalLink className="h-3 w-3" aria-hidden />
        </a>
      )}
    </div>
  );
}
