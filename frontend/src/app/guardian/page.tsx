"use client";

// Vault Guardian (U12 / R20). Create/manage private protection rules submitted to
// the TEE via the backend. Privacy claim is scoped (A-7): parameters go once over
// TLS and are never read back from a public on-chain source.
import { useState } from "react";
import { useAccount } from "wagmi";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldCheck, Lock } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardTitle,
  EmptyState,
  ErrorState,
  Field,
  Input,
  Skeleton,
} from "@/components/ui";
import { Reveal } from "@/components/motion";
import { api } from "@/lib/api/client";
import { useVaultParams } from "@/hooks/useVault";
import { useBranch } from "@/context/branch";
import { formatCr, parseAmount } from "@/lib/format";

export default function GuardianPage() {
  const { branch } = useBranch();
  const { address, isConnected } = useAccount();
  const qc = useQueryClient();
  const { params } = useVaultParams(branch.vaultManager || undefined);
  const mcrBps = Number(params.mcrBps);

  const rulesQuery = useQuery({
    queryKey: ["guardian-rules", address, branch.key],
    queryFn: () => api.listGuardianRules(address!),
    enabled: Boolean(address),
    retry: 1,
  });

  const [triggerPct, setTriggerPct] = useState("150");
  const [maxRepay, setMaxRepay] = useState("");

  const triggerCrBps = Math.round(Number(triggerPct) * 100);
  const maxRepay18 = parseAmount(maxRepay, 18);
  const triggerError =
    Number.isFinite(triggerCrBps) && triggerCrBps <= mcrBps
      ? `Trigger must be above the ${formatCr(params.mcrBps)} liquidation threshold to protect you.`
      : undefined;
  const valid =
    Boolean(address) &&
    !triggerError &&
    triggerCrBps > mcrBps &&
    maxRepay18 !== null &&
    maxRepay18 > 0n;

  const createMutation = useMutation({
    mutationFn: () =>
      api.createGuardianRule({
        owner: address!,
        triggerCrBps,
        maxRepay18: maxRepay18!.toString(),
        branch: branch.key,
        vaultManager: branch.vaultManager || undefined,
      }),
    onSuccess: () => {
      setMaxRepay("");
      qc.invalidateQueries({ queryKey: ["guardian-rules", address, branch.key] });
    },
  });

  return (
    <div className="flex flex-col gap-6">
      <Reveal>
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <ShieldCheck className="h-6 w-6 text-ember" aria-hidden /> Vault Guardian
          </h1>
          <p className="mt-1 text-sm text-muted">
            Private, TEE-enforced protection rules. Auto-repay before liquidation —
            without exposing your trigger on-chain beforehand. Guardian works across
            every collateral branch; the rule below protects your{" "}
            <span className="font-medium text-text">{branch.label}</span> vault (switch
            branches to manage others).
          </p>
        </div>
      </Reveal>

      <div className="grid gap-6 lg:grid-cols-2">
        <Reveal>
          <Card>
            <CardTitle>New protection rule</CardTitle>
            <p className="mt-2 flex items-start gap-2 rounded-lg border border-border bg-surface-2/50 p-3 text-xs text-muted">
              <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ember-bright" aria-hidden />
              Parameters are sent once to the TEE via the backend over TLS. They are
              evaluated only inside the enclave and are never published on-chain
              before execution.
            </p>

            {!isConnected ? (
              <p className="mt-4 text-sm text-muted">Connect a wallet to create a rule.</p>
            ) : (
              <form
                className="mt-4 flex flex-col gap-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (valid) createMutation.mutate();
                }}
              >
                <Field
                  label="Auto-repay trigger (CR %)"
                  htmlFor="trigger"
                  error={triggerError}
                  hint="When your CR falls to this level, the Guardian repays"
                >
                  <Input
                    id="trigger"
                    inputMode="decimal"
                    value={triggerPct}
                    onChange={(e) => setTriggerPct(e.target.value)}
                  />
                </Field>
                <Field
                  label="Max repay (vUSD)"
                  htmlFor="max-repay"
                  hint="Upper bound the Guardian may pull from your funder"
                >
                  <Input
                    id="max-repay"
                    inputMode="decimal"
                    placeholder="0.0"
                    value={maxRepay}
                    onChange={(e) => setMaxRepay(e.target.value)}
                  />
                </Field>
                <Button type="submit" disabled={!valid || createMutation.isPending}>
                  {createMutation.isPending ? "Submitting…" : "Create private rule"}
                </Button>
                {createMutation.isError && (
                  <p className="text-sm text-danger">
                    Couldn&apos;t submit the rule — the backend is unavailable.
                  </p>
                )}
              </form>
            )}
          </Card>
        </Reveal>

        <Reveal delay={0.05}>
          <Card>
            <CardTitle>Your rules</CardTitle>
            <div className="mt-4">
              {!isConnected ? (
                <p className="text-sm text-muted">Connect a wallet to view your rules.</p>
              ) : rulesQuery.isLoading ? (
                <Skeleton className="h-24 w-full" />
              ) : rulesQuery.isError ? (
                <ErrorState
                  title="Couldn't load rules"
                  description="The backend is unavailable."
                  onRetry={() => rulesQuery.refetch()}
                />
              ) : (rulesQuery.data ?? []).length === 0 ? (
                <EmptyState
                  title="No protection rules yet"
                  description="Create a rule to auto-repay before liquidation territory."
                />
              ) : (
                <ul className="flex flex-col gap-2">
                  {rulesQuery.data!.map((r) => (
                    <li
                      key={r.id}
                      className="flex items-center justify-between rounded-lg border border-border bg-surface-2/40 px-4 py-3"
                    >
                      <div className="text-sm">
                        <div className="font-medium text-text">
                          Auto-repay at CR {formatCr(BigInt(r.triggerCrBps))}
                        </div>
                        <div className="text-xs text-muted">
                          up to {r.maxRepay18} base-unit vUSD
                        </div>
                      </div>
                      <Badge tone={r.enabled ? "healthy" : "neutral"}>
                        {r.enabled ? "active" : "paused"}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>
        </Reveal>
      </div>
    </div>
  );
}
