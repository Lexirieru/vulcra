"use client";

// XRPL-native mint mode (U8–U10 / R13, AE1, AE2, F1). Enter an r-address, see the
// PersonalAccount, pre-flight the mint (blocking sub-minimum before any XRP is
// sent), get a signable Payment (QR + Xaman deep link, backend-built 0xFE memo),
// and track the mint end to end. The client never builds the memo.
import { useState } from "react";
import QRCode from "react-qr-code";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Copy, ExternalLink, ShieldAlert } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardTitle,
  ErrorState,
  Field,
  Input,
  Skeleton,
  Stat,
} from "@/components/ui";
import Link from "next/link";
import { Reveal } from "@/components/motion";
import { MintStatusTracker } from "@/components/xrpl/MintStatusTracker";
import { api } from "@/lib/api/client";
import type { MintBuildResponse } from "@/lib/api/types";
import { usePersonalAccount, isValidRAddress } from "@/hooks/usePersonalAccount";
import { useBranch } from "@/context/branch";
import { formatToken, parseAmount, shortenAddress } from "@/lib/format";

// XRPL-native mint is FXRP-only (XRP → FXRP via the 0xFE custom instruction).
// Other collateral branches (e.g. wFLR) use the EVM flow instead.
export default function XrplPage() {
  const { branch } = useBranch();
  if (!branch.hasXrplMint) {
    return (
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Mint from XRPL</h1>
          <p className="mt-1 text-sm text-muted">
            XRPL-native minting only applies to the FXRP branch (XRP → FXRP).
          </p>
        </div>
        <Card className="flex flex-col items-center gap-3 text-center">
          <ShieldAlert className="h-6 w-6 text-ember" aria-hidden />
          <p className="max-w-md text-sm text-muted">
            The <span className="font-medium text-text">{branch.label}</span> branch has
            no XRPL rail. Wrap C2FLR into {branch.collateralSymbol} and open a vault from
            the EVM dashboard instead.
          </p>
          <Link
            href="/"
            className="rounded-md bg-ember px-4 py-2 text-sm font-medium text-bg hover:bg-ember-bright"
          >
            Go to EVM dashboard
          </Link>
        </Card>
      </div>
    );
  }
  return <XrplFlow />;
}

function XrplFlow() {
  const [rAddress, setRAddress] = useState("");
  const account = usePersonalAccount(rAddress);
  const validAddr = isValidRAddress(rAddress);

  const [amount, setAmount] = useState("");
  const amount6 = parseAmount(amount, 6);
  const amountReady = amount6 !== null && amount6 > 0n && Boolean(account.data);

  const preflight = useQuery({
    queryKey: ["preflight", rAddress, amount],
    queryFn: () =>
      api.preflight({ xrplAddress: rAddress.trim(), amount: amount6!.toString() }),
    enabled: amountReady,
    retry: 0,
  });

  const build = useMutation<MintBuildResponse>({
    mutationFn: () =>
      api.buildMint({ xrplAddress: rAddress.trim(), amount: amount6!.toString() }),
  });

  const [xrplTxId, setXrplTxId] = useState("");
  const submit = useMutation({
    mutationFn: () =>
      api.submitMint({
        packedUserOpHex: build.data!.packedUserOpHex,
        xrplTxId: xrplTxId.trim(),
      }),
  });

  const canGenerate = amountReady && preflight.data?.ok === true;

  return (
    <div className="flex flex-col gap-6">
      <Reveal>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Mint from XRPL</h1>
          <p className="mt-1 text-sm text-muted">
            No EVM wallet or FLR needed. Sign one XRPL Payment and receive vUSD to your
            Flare personal account.
          </p>
        </div>
      </Reveal>

      {/* Step 1 — r-address */}
      <Reveal>
        <Card>
          <CardTitle>1 · Your XRPL account</CardTitle>
          <div className="mt-4 max-w-md">
            <Field
              label="XRPL r-address"
              htmlFor="raddr"
              error={rAddress && !validAddr ? "That doesn't look like a valid r-address." : undefined}
            >
              <Input
                id="raddr"
                placeholder="r..."
                autoComplete="off"
                spellCheck={false}
                value={rAddress}
                onChange={(e) => setRAddress(e.target.value)}
              />
            </Field>
          </div>

          {validAddr && (
            <div className="mt-4">
              {account.isLoading ? (
                <Skeleton className="h-16 w-full" />
              ) : account.isError ? (
                <ErrorState
                  title="Couldn't resolve the personal account"
                  description="The backend is unavailable. It derives the account and FXRP balance."
                  onRetry={() => account.refetch()}
                />
              ) : account.data ? (
                <div className="grid grid-cols-2 gap-4 rounded-lg border border-border bg-surface-2/40 p-4">
                  <Stat
                    label="Personal account"
                    value={<span className="text-base">{shortenAddress(account.data.personalAccount)}</span>}
                    sub="derived on Flare"
                  />
                  <Stat
                    label="FXRP balance"
                    value={formatToken(BigInt(account.data.fxrpBalance || "0"), 6, 2)}
                    sub="FXRP"
                  />
                </div>
              ) : null}
            </div>
          )}
        </Card>
      </Reveal>

      {/* Step 2 — amount + pre-flight (AE2) */}
      {account.data && (
        <Reveal>
          <Card>
            <CardTitle>2 · Amount &amp; pre-flight</CardTitle>
            <div className="mt-4 max-w-md">
              <Field
                label="Mint amount (FXRP)"
                htmlFor="mint-amount"
                hint="Pre-flight checks limits + minimum fee before any XRP is sent"
              >
                <Input
                  id="mint-amount"
                  inputMode="decimal"
                  placeholder="0.0"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </Field>
            </div>

            {amountReady && (
              <div className="mt-4">
                {preflight.isLoading ? (
                  <Skeleton className="h-12 w-full" />
                ) : preflight.isError ? (
                  <ErrorState
                    title="Pre-flight unavailable"
                    description="Minting is blocked until the backend confirms the limits (fail-closed)."
                    onRetry={() => preflight.refetch()}
                  />
                ) : preflight.data && !preflight.data.ok ? (
                  <div className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
                    <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                    <div>
                      <div className="font-medium">Payment blocked</div>
                      <div>
                        {preflight.data.blockingReason ??
                          "A sub-minimum payment would be forfeited irrecoverably."}
                      </div>
                    </div>
                  </div>
                ) : preflight.data?.ok ? (
                  <Badge tone="healthy">Pre-flight passed — safe to generate</Badge>
                ) : null}
              </div>
            )}

            <Button
              className="mt-4"
              disabled={!canGenerate || build.isPending}
              onClick={() => build.mutate()}
            >
              {build.isPending ? "Generating…" : "Generate payment"}
            </Button>
            {build.isError && (
              <p className="mt-2 text-sm text-danger">
                Couldn&apos;t build the payment — the backend is unavailable.
              </p>
            )}
          </Card>
        </Reveal>
      )}

      {/* Step 3 — payment (QR + Xaman) */}
      {build.data && (
        <Reveal>
          <PaymentPanel
            intent={build.data}
            xrplTxId={xrplTxId}
            onXrplTxId={setXrplTxId}
            onSubmit={() => submit.mutate()}
            submitting={submit.isPending}
            submitError={submit.isError}
          />
        </Reveal>
      )}

      {/* Step 4 — tracking */}
      {submit.data && (
        <Reveal>
          <MintStatusTracker mintId={submit.data.mintId} />
        </Reveal>
      )}
    </div>
  );
}

function PaymentPanel({
  intent,
  xrplTxId,
  onXrplTxId,
  onSubmit,
  submitting,
  submitError,
}: {
  intent: MintBuildResponse;
  xrplTxId: string;
  onXrplTxId: (v: string) => void;
  onSubmit: () => void;
  submitting: boolean;
  submitError: boolean;
}) {
  return (
    <Card>
      <CardTitle>3 · Sign the XRPL Payment</CardTitle>
      <p className="mt-2 text-sm text-muted">
        The 0xFE memo was built by the backend — scan or open in Xaman to sign. Never
        add a destination tag.
      </p>

      <div className="mt-4 grid gap-6 sm:grid-cols-[auto_1fr] sm:items-start">
        <div className="rounded-lg bg-white p-3">
          <QRCode value={intent.qrData} size={160} />
        </div>
        <div className="flex flex-col gap-3">
          <a
            href={intent.xamanDeepLink}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex w-fit items-center gap-2 rounded-md bg-ember px-4 py-2 text-sm font-medium text-bg hover:bg-ember-bright"
          >
            Open in Xaman <ExternalLink className="h-4 w-4" aria-hidden />
          </a>
          <div className="rounded-lg border border-border bg-surface-2/50 p-3">
            <div className="text-xs uppercase text-muted">0xFE memo</div>
            <div className="mt-1 flex items-center gap-2">
              <code className="truncate font-mono text-xs text-faint">{intent.payment.memoHex}</code>
              <button
                type="button"
                aria-label="Copy memo"
                onClick={() => navigator.clipboard?.writeText(intent.payment.memoHex)}
                className="text-muted hover:text-text"
              >
                <Copy className="h-4 w-4" aria-hidden />
              </button>
            </div>
          </div>

          <Field
            label="XRPL transaction id (after signing)"
            htmlFor="xrpltx"
            hint="Xaman returns this once the Payment is submitted"
          >
            <Input
              id="xrpltx"
              placeholder="tx hash"
              value={xrplTxId}
              onChange={(e) => onXrplTxId(e.target.value)}
            />
          </Field>
          <Button disabled={!xrplTxId.trim() || submitting} onClick={onSubmit}>
            {submitting ? "Submitting…" : "Track my mint"}
          </Button>
          {submitError && (
            <p className="text-sm text-danger">
              Couldn&apos;t submit — the backend is unavailable.
            </p>
          )}
        </div>
      </div>
    </Card>
  );
}
