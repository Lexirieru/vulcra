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
import type { ManageAction, MintState } from "@/lib/api/types";

// The tracker drives the SAME backend state machine for every XRPL 0xFE action,
// but the labels must match what the user actually did — a repay showing
// "vUSD delivered" or a rate change showing "Executing mint" reads as broken.
export type TrackedAction = ManageAction | "open";
const ACTION_META: Record<TrackedAction, { title: string; executing: string; done: string }> = {
  open: { title: "Mint status", executing: "Executing mint", done: "vUSD delivered" },
  mintMore: { title: "Borrow status", executing: "Executing borrow", done: "vUSD delivered" },
  addCollateral: { title: "Supply status", executing: "Minting FXRP collateral", done: "Collateral added" },
  withdrawCollateral: { title: "Withdraw status", executing: "Executing withdrawal", done: "Collateral returned" },
  repay: { title: "Repay status", executing: "Executing repayment", done: "Debt repaid" },
  adjustRate: { title: "Rate update", executing: "Applying new rate", done: "Rate updated" },
  close: { title: "Close status", executing: "Closing the vault", done: "Vault closed" },
  spDeposit: { title: "Earn deposit", executing: "Depositing to the pool", done: "Earning in the pool" },
  send: { title: "Send status", executing: "Sending vUSD", done: "vUSD sent to your EVM wallet" },
};

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
  action = "open",
  onExecuted,
}: {
  mintId: string;
  /** Which XRPL action is being tracked — drives the labels. */
  action?: TrackedAction;
  /** Fired exactly once when the mint reaches EXECUTED — lets the parent refetch
      the vault / balances immediately instead of waiting on their poll. */
  onExecuted?: () => void;
}) {
  const meta = ACTION_META[action] ?? ACTION_META.open;
  const steps: { state: MintState; label: string }[] = [
    { state: "INTAKE", label: "Received" },
    { state: "ATTEST_REQUESTED", label: "Attesting (FDC)" },
    { state: "EXECUTING", label: meta.executing },
    { state: "EXECUTED", label: meta.done },
  ];
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
        <CardTitle>{meta.title}</CardTitle>
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
            The action reverted on Flare, so your vault is unchanged. No FXRP was minted
            and any XRP you sent stays recoverable at the Core Vault (executor 0xE0/0xE1).
          </div>
        </div>
      )}

      <ol className="mt-4 flex flex-col gap-3">
        {steps.map((step) => {
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
