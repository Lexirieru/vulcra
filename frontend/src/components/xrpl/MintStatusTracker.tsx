"use client";

// End-to-end mint tracking (U10 / AE1). Polls backend status and renders the
// state machine. A rate-limit DELAY is a first-class status with a countdown —
// never presented as a failure. REVERTED explains XRP is safe at the Core Vault.
import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Clock, Loader2, ShieldAlert } from "lucide-react";
import { Badge, Card, CardTitle, ErrorState } from "@/components/ui";
import { cn } from "@/components/ui";
import { api } from "@/lib/api/client";
import type { MintState } from "@/lib/api/types";

const STEPS: { state: MintState; label: string }[] = [
  { state: "INTAKE", label: "Received" },
  { state: "ATTEST_REQUESTED", label: "Attesting (FDC)" },
  { state: "EXECUTING", label: "Executing mint" },
  { state: "EXECUTED", label: "vUSD delivered" },
];

const ORDER: MintState[] = [
  "INTAKE",
  "ATTEST_REQUESTED",
  "PROOF_READY",
  "EXECUTING",
  "DELAYED",
  "EXECUTED",
];

function rank(state: MintState): number {
  const i = ORDER.indexOf(state);
  return i < 0 ? 0 : i;
}

const TERMINAL: MintState[] = ["EXECUTED", "REVERTED", "REJECTED"];

export function MintStatusTracker({
  mintId,
  onExecuted,
}: {
  mintId: string;
  /** Fired exactly once when the mint reaches EXECUTED — lets the parent refetch
      the vault / balances immediately instead of waiting on their poll. */
  onExecuted?: () => void;
}) {
  const { data, isError, refetch } = useQuery({
    queryKey: ["mint-status", mintId],
    queryFn: () => api.getMintStatus(mintId),
    refetchInterval: (q) => {
      const s = q.state.data?.state;
      return s && TERMINAL.includes(s) ? false : 3000;
    },
  });

  const state = data?.state ?? "INTAKE";
  // Nudge the parent to refresh on-chain reads the moment execution lands, so the
  // vault/collateral update feels realtime rather than lagging the 12s poll.
  const firedRef = useRef(false);
  useEffect(() => {
    if (state === "EXECUTED" && !firedRef.current) {
      firedRef.current = true;
      onExecuted?.();
    }
  }, [state, onExecuted]);

  if (isError) {
    return (
      <Card>
        <ErrorState
          title="Couldn't read mint status"
          description="The backend is unavailable. Your XRP is safe — retry when it's back."
          onRetry={() => refetch()}
        />
      </Card>
    );
  }

  const current = rank(state);

  return (
    <Card>
      <div className="flex items-center justify-between">
        <CardTitle>Mint status</CardTitle>
        <Badge tone={state === "EXECUTED" ? "green" : state === "REVERTED" ? "danger" : "brand"}>
          {data?.stage ?? "tracking…"}
        </Badge>
      </div>

      {state === "DELAYED" && (
        <div className="mt-4 flex items-start gap-2 rounded-xl border border-warning/35 bg-warning/10 p-3 text-sm text-ink">
          <Clock className="mt-0.5 h-4 w-4 shrink-0 text-orange" aria-hidden />
          <div>
            <div className="font-medium">Delayed, not failed.</div>
            <div className="text-muted">
              FAssets rate-limited this mint. The executor retries the same proof
              automatically
              {data?.executionAllowedAt
                ? ` at ${new Date(data.executionAllowedAt * 1000).toLocaleTimeString()}`
                : ""}
              .
            </div>
          </div>
        </div>
      )}

      {state === "REVERTED" && (
        <div className="mt-4 flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <div>
            No FXRP was minted and your XRP remains recoverable at the Core Vault.
            Recovery is handled by the executor (0xE0/0xE1).
          </div>
        </div>
      )}

      <ol className="mt-4 flex flex-col gap-3">
        {STEPS.map((step) => {
          const done = current > rank(step.state);
          // "Attesting" stays the active step across the whole attest→proof span.
          const active =
            state === step.state ||
            (step.state === "ATTEST_REQUESTED" && state === "PROOF_READY");
          return (
            <li key={step.state} className="flex items-center gap-3">
              <span className="flex h-6 w-6 items-center justify-center">
                {done ? (
                  <CheckCircle2 className="h-5 w-5 text-green" aria-hidden />
                ) : active ? (
                  <Loader2 className="h-5 w-5 animate-spin text-brand" aria-hidden />
                ) : (
                  <span className="h-2 w-2 rounded-full bg-line" aria-hidden />
                )}
              </span>
              <span
                className={cn(
                  "text-sm",
                  done ? "text-muted" : active ? "text-ink" : "text-muted/60",
                )}
              >
                {step.label}
              </span>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}
