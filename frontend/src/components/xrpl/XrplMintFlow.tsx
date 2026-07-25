"use client";

// XRPL-native mint flow (U8–U10 / R13, AE1, AE2, F1). Enter the flow with an
// XRPL wallet already connected, see the PersonalAccount, pre-flight the mint
// (blocking sub-minimum before any XRP is sent), get a signable Payment (QR +
// Xaman deep link, backend-built 0xFE memo), and track the mint end to end. The
// client never builds the memo. Headingless on purpose — the host page owns h1.
//
// There is NO "connect your XRPL wallet" step any more. The wallet is the
// app-wide one from XrplWalletProvider — the same connection the right-hand
// wallet drawer owns — so the Borrow page's XRP-Ledger rail is a continuation
// of the same session rather than a second, competing connect screen. When
// nothing is connected the flow opens with a compact prompt that either
// connects inline (per provider) or raises the drawer; pasting an r-address you
// don't hold is still supported for the QR / Xaman path.
import { useState } from "react";
import QRCode from "react-qr-code";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  ChevronDown,
  Copy,
  ExternalLink,
  PenLine,
  ShieldAlert,
  Wallet,
} from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardTitle,
  ErrorState,
  Field,
  Input,
  PillButton,
  Skeleton,
  TokenIcon,
} from "@/components/ui";
import { Reveal } from "@/components/motion";
import { MintStatusTracker } from "@/components/xrpl/MintStatusTracker";
import { api } from "@/lib/api/client";
import type { MintBuildResponse } from "@/lib/api/types";
import { usePersonalAccount, isValidRAddress } from "@/hooks/usePersonalAccount";
import { useXrplWalletContext } from "@/context/xrpl";
import { useWalletUi } from "@/context/wallet-ui";
import { XRPL_PROVIDER_ORDER, XRPL_PROVIDERS } from "@/lib/xrpl/wallets";
import { BRANCHES } from "@/config/branches";
import { formatToken, parseAmount, shortenAddress } from "@/lib/format";

// XRPL-native mint is always the FXRP branch; its Zap opens at the default rate.
const XRPL_DEFAULT_RATE_BPS = BRANCHES.fxrp.interest.defaultBps;

export function XrplMintFlow() {
  const wallet = useXrplWalletContext();
  // A connected wallet IS the r-address — derived, so a connection made in the
  // wallet drawer shows up here instantly (and vice versa). The typed field is
  // only the no-wallet fallback.
  const [pastedAddress, setPastedAddress] = useState("");
  const rAddress = wallet.address ?? pastedAddress;
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
    mutationFn: (txId: string) =>
      api.submitMint({
        packedUserOpHex: build.data!.packedUserOpHex,
        xrplTxId: txId.trim(),
      }),
  });

  // Sign the backend-built Payment in the connected XRPL wallet, then submit the
  // resulting tx hash for tracking (replaces the manual paste for wallet users).
  async function signAndTrack() {
    if (!build.data) return;
    const hash = await wallet.signPayment({
      destination: build.data.payment.destination,
      amountDrops: build.data.payment.amountDrops,
      memoHex: build.data.payment.memoHex,
    });
    if (hash) {
      setXrplTxId(hash);
      submit.mutate(hash);
    }
  }

  const canGenerate = amountReady && preflight.data?.ok === true;

  return (
    <div className="flex flex-col gap-6">
      <Reveal>
        {wallet.address ? (
          <ConnectedStrip
            address={wallet.address}
            providerName={
              wallet.providerId ? XRPL_PROVIDERS[wallet.providerId].name : undefined
            }
            account={account}
          />
        ) : (
          <ConnectPrompt
            pastedAddress={pastedAddress}
            onPastedAddress={setPastedAddress}
            invalidPaste={Boolean(pastedAddress) && !validAddr}
          />
        )}
      </Reveal>

      {/* Step 1 — amount + pre-flight (AE2) */}
      {account.data && (
        <Reveal>
          <Card>
            <CardTitle>1 · Amount &amp; pre-flight</CardTitle>
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
              <p className="mt-2 text-xs text-muted/80">
                Your vault opens at the default interest rate (
                {(XRPL_DEFAULT_RATE_BPS / 100).toFixed(1)}% / year) for a smooth
                one-payment mint — you can change it later from the Borrow page.
              </p>
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
                  <div className="flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
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
                  <Badge tone="green">Pre-flight passed — safe to generate</Badge>
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

      {/* Step 2 — payment: sign in wallet, or QR/Xaman fallback */}
      {build.data && (
        <Reveal>
          <PaymentPanel
            intent={build.data}
            xrplTxId={xrplTxId}
            onXrplTxId={setXrplTxId}
            onSubmit={() => submit.mutate(xrplTxId.trim())}
            submitting={submit.isPending}
            submitError={submit.isError}
            walletConnected={Boolean(wallet.address)}
            walletName={wallet.providerId ? XRPL_PROVIDERS[wallet.providerId].name : undefined}
            onWalletSign={signAndTrack}
            signing={wallet.signing}
            walletError={wallet.error}
          />
        </Reveal>
      )}

      {/* Step 3 — tracking */}
      {submit.data && (
        <Reveal>
          <MintStatusTracker mintId={submit.data.mintId} />
        </Reveal>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Wallet header — connected strip vs compact connect prompt
// ─────────────────────────────────────────────────────────────────────────────

function ConnectedStrip({
  address,
  providerName,
  account,
}: {
  address: string;
  providerName?: string;
  account: ReturnType<typeof usePersonalAccount>;
}) {
  const { openWallets } = useWalletUi();
  // The backend omits fxrpBalance on some builds — absent is "—", never 0.
  const fxrp = account.data?.fxrpBalance;

  return (
    <Card className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
      <div className="flex min-w-0 items-center gap-3">
        <TokenIcon symbol="XRP" size={28} alt="" />
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm text-ink">
            <span className="h-2 w-2 shrink-0 rounded-full bg-green" aria-hidden />
            <span className="font-medium">{providerName ?? "XRPL wallet"}</span>
            <span className="truncate font-mono text-muted" title={address}>
              {shortenAddress(address)}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-muted">
            {account.isLoading ? (
              "Resolving your Flare personal account…"
            ) : account.isError ? (
              "Personal account unavailable — the backend is offline."
            ) : account.data ? (
              <>
                Personal account{" "}
                <span className="font-mono">
                  {shortenAddress(account.data.personalAccount)}
                </span>{" "}
                · FXRP {fxrp === undefined ? "—" : formatToken(BigInt(fxrp), 6, 2)}
              </>
            ) : (
              "Paying from the XRP Ledger — no Flare gas needed."
            )}
          </p>
        </div>
      </div>
      <Button variant="ghost" size="sm" onClick={openWallets}>
        <Wallet className="h-4 w-4" aria-hidden />
        Manage wallets
      </Button>
    </Card>
  );
}

function ConnectPrompt({
  pastedAddress,
  onPastedAddress,
  invalidPaste,
}: {
  pastedAddress: string;
  onPastedAddress: (v: string) => void;
  invalidPaste: boolean;
}) {
  const wallet = useXrplWalletContext();
  const { openWallets } = useWalletUi();
  const [showPaste, setShowPaste] = useState(false);

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <TokenIcon symbol="XRP" size={28} alt="" />
          <div className="min-w-0">
            <CardTitle>Connect your XRP wallet</CardTitle>
            <p className="mt-0.5 text-sm text-muted">
              Bring XRP straight from the XRP Ledger — no Flare wallet, no FLR gas.
            </p>
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={openWallets}>
          <Wallet className="h-4 w-4" aria-hidden />
          Open wallets
        </Button>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {XRPL_PROVIDER_ORDER.map((id) => {
          // Per-provider: only the clicked wallet reports progress.
          const busy = wallet.connectingId === id;
          return (
            <Button
              key={id}
              variant={id === "crossmark" ? "primary" : "secondary"}
              disabled={wallet.connectingId !== undefined}
              onClick={() => wallet.connect(id)}
            >
              <Wallet className="h-4 w-4" aria-hidden />
              {busy ? "Confirm in wallet…" : `Connect ${XRPL_PROVIDERS[id].name}`}
            </Button>
          );
        })}
      </div>

      {wallet.error && (
        <p className="mt-2 text-xs text-danger" role="alert">
          {wallet.error}
        </p>
      )}

      <div className="mt-4">
        <button
          type="button"
          aria-expanded={showPaste}
          onClick={() => setShowPaste((v) => !v)}
          className="inline-flex min-h-10 items-center gap-1 text-xs text-muted hover:text-ink"
        >
          <ChevronDown
            className={`h-4 w-4 transition-transform ${showPaste ? "rotate-180" : ""}`}
            aria-hidden
          />
          …or paste an r-address (sign later in Xaman)
        </button>
        {showPaste && (
          <div className="mt-2 max-w-md">
            <Field
              label="XRPL r-address"
              htmlFor="raddr"
              error={invalidPaste ? "That doesn't look like a valid r-address." : undefined}
            >
              <Input
                id="raddr"
                placeholder="r..."
                autoComplete="off"
                spellCheck={false}
                value={pastedAddress}
                onChange={(e) => onPastedAddress(e.target.value)}
              />
            </Field>
          </div>
        )}
      </div>
    </Card>
  );
}

function PaymentPanel({
  intent,
  xrplTxId,
  onXrplTxId,
  onSubmit,
  submitting,
  submitError,
  walletConnected,
  walletName,
  onWalletSign,
  signing,
  walletError,
}: {
  intent: MintBuildResponse;
  xrplTxId: string;
  onXrplTxId: (v: string) => void;
  onSubmit: () => void;
  submitting: boolean;
  submitError: boolean;
  walletConnected: boolean;
  walletName?: string;
  onWalletSign: () => void;
  signing: boolean;
  walletError?: string;
}) {
  return (
    <Card>
      <CardTitle>2 · Sign the XRPL Payment</CardTitle>
      <p className="mt-2 text-sm text-muted">
        The 0xFE memo was built by the backend and is sent to your wallet verbatim.
        Never add a destination tag.
      </p>

      {walletConnected && (
        <div className="mt-4 rounded-xl border border-brand/20 bg-brand/5 p-4">
          <Button onClick={onWalletSign} disabled={signing || submitting}>
            <PenLine className="h-4 w-4" aria-hidden />
            {signing ? "Confirm in wallet…" : `Sign in ${walletName ?? "wallet"}`}
          </Button>
          <p className="mt-2 text-xs text-muted">
            {walletName} signs and submits the Payment, then Vulcra tracks the mint
            automatically — no copy/paste.
          </p>
          {walletError && <p className="mt-1 text-xs text-danger">{walletError}</p>}
        </div>
      )}

      <p className="mt-4 text-xs uppercase tracking-wide text-muted/80">
        {walletConnected ? "Or sign another way" : "Scan or open in Xaman (mobile)"}
      </p>

      <div className="mt-3 grid gap-6 sm:grid-cols-[auto_1fr] sm:items-start">
        <div className="rounded-xl border border-line bg-white p-3">
          <QRCode value={intent.qrData} size={160} />
        </div>
        <div className="flex flex-col gap-3">
          <PillButton
            href={intent.xamanDeepLink}
            target="_blank"
            rel="noopener noreferrer"
            size="sm"
            className="w-fit"
          >
            Open in Xaman <ExternalLink className="h-4 w-4" aria-hidden />
          </PillButton>
          <div className="rounded-xl border border-line bg-surface-2/60 p-3">
            <div className="text-xs uppercase text-muted">0xFE memo</div>
            <div className="mt-1 flex items-center gap-2">
              <code className="truncate font-mono text-xs text-muted/80">{intent.payment.memoHex}</code>
              <button
                type="button"
                aria-label="Copy memo"
                onClick={() => navigator.clipboard?.writeText(intent.payment.memoHex)}
                className="grid size-10 shrink-0 place-items-center rounded-full text-muted hover:text-ink"
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
