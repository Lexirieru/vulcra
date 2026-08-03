"use client";

// XRPL-native Earn deposit. The vUSD a borrow delivers lands on the user's Flare
// PersonalAccount (not their EVM wallet), so the EVM Earn panel never sees it.
// This deposits that vUSD into the FXRP stability pool from the XRP wallet in ONE
// signed payment (spDeposit: approve + provideToSP, net-0 0xFE). Auto-signs on
// build, like the borrow flow — one button, no EVM wallet.
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Loader2, PenLine } from "lucide-react";
import { Badge, Button, Card, CardTitle, Field, Input, PillButton } from "@/components/ui";
import { Reveal } from "@/components/motion";
import { MintStatusTracker } from "@/components/xrpl/MintStatusTracker";
import { api } from "@/lib/api/client";
import type { MintBuildResponse } from "@/lib/api/types";
import { useXrplWalletContext } from "@/context/xrpl";
import { usePersonalAccount } from "@/hooks/usePersonalAccount";
import { useWalletBalances } from "@/hooks/useWalletBalances";
import { XRPL_PROVIDERS } from "@/lib/xrpl/wallets";
import { formatToken, parseAmount } from "@/lib/format";

export function XrplEarnDeposit() {
  const wallet = useXrplWalletContext();
  const account = usePersonalAccount(wallet.address ?? "");
  const pa = account.data?.personalAccount;
  const balances = useWalletBalances(pa);
  const vusd18 = balances.tokens.find((t) => t.symbol === "vUSD")?.value;

  const [amount, setAmount] = useState("");
  const [xrplTxId, setXrplTxId] = useState("");
  const amt18 = parseAmount(amount, 18);
  const hasVusd = vusd18 !== undefined && vusd18 > 0n;
  const insufficient = amt18 !== null && vusd18 !== undefined && amt18 > vusd18;
  const valid = amt18 !== null && amt18 > 0n && !insufficient && hasVusd;

  const submit = useMutation({
    mutationFn: ({ txId, built }: { txId: string; built: MintBuildResponse }) =>
      api.submitMint({
        packedUserOpHex: built.packedUserOpHex,
        memoUserOpHash: built.memoUserOpHash,
        xrplTxId: txId.trim(),
      }),
  });

  async function signAndTrack(built: MintBuildResponse) {
    const hash = await wallet.signPayment({
      destination: built.payment.destination,
      amountDrops: built.payment.amountDrops,
      memoHex: built.payment.memoHex,
    });
    if (hash) {
      setXrplTxId(hash);
      submit.mutate({ txId: hash, built });
    }
  }

  const build = useMutation<MintBuildResponse, Error, void>({
    mutationFn: () =>
      api.buildManage({
        xrplAddress: wallet.address!,
        action: "spDeposit",
        amount18: amt18!.toString(),
      }),
    onSuccess: (data) => {
      if (wallet.address) void signAndTrack(data);
    },
  });

  const busy = build.isPending || wallet.signing || submit.isPending;
  const providerName = wallet.providerId
    ? XRPL_PROVIDERS[wallet.providerId].name
    : "your XRP wallet";

  // No XRP wallet connected → nothing to show here (the EVM panel handles that case).
  if (!wallet.address) return null;

  return (
    <Reveal>
      <Card className="flex flex-col gap-3 border-brand/20 bg-brand/[0.03]">
        <div className="flex items-center justify-between gap-3">
          <CardTitle>Deposit from your XRP wallet</CardTitle>
          <Badge tone="brand">FXRP pool</Badge>
        </div>
        <p className="text-sm text-muted">
          The vUSD your borrow delivered to your Flare personal account goes straight
          into the FXRP stability pool — <span className="text-ink">one XRPL payment</span>,
          no EVM wallet.
        </p>

        <Field
          label="Deposit vUSD to Earn"
          htmlFor="earn-xrpl-amount"
          error={
            insufficient
              ? `You only have ${formatToken(vusd18!, 18, 2)} vUSD on your personal account.`
              : undefined
          }
          hint="Burned from your Flare personal account into the pool · one XRPL payment (fees only)"
        >
          <Input
            id="earn-xrpl-amount"
            inputMode="decimal"
            placeholder="0.0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </Field>
        {vusd18 !== undefined && (
          <div className="-mt-1 flex items-center justify-between text-xs">
            <span className="text-muted/70">
              Available {formatToken(vusd18, 18, 2)} vUSD
            </span>
            {hasVusd && (
              <button
                type="button"
                onClick={() => setAmount(formatToken(vusd18, 18, 2).replace(/,/g, ""))}
                className="min-h-8 rounded-full px-2 font-medium text-brand hover:underline"
              >
                Max
              </button>
            )}
          </div>
        )}
        <PillButton
          size="md"
          className="w-full"
          disabled={!valid || busy}
          onClick={() => build.mutate()}
        >
          {build.isPending
            ? "Generating…"
            : wallet.signing
              ? `Confirm in ${providerName}…`
              : hasVusd
                ? "Deposit to Earn"
                : "Borrow vUSD first to earn"}
        </PillButton>

        {/* Slim status strip once the sign fires; the tracker replaces it on submit. */}
        {build.data && !submit.data && (
          <div className="flex items-center gap-2 rounded-xl border border-brand/20 bg-brand/5 p-3 text-sm">
            {wallet.error ? (
              <>
                <span className="text-danger">{wallet.error}</span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="ml-auto"
                  onClick={() => build.data && signAndTrack(build.data)}
                >
                  <PenLine className="h-4 w-4" aria-hidden /> Sign again
                </Button>
              </>
            ) : (
              <>
                <Loader2 className="h-4 w-4 shrink-0 text-brand motion-safe:animate-spin" aria-hidden />
                <span className="text-muted">Confirm the Payment in {providerName} to finish.</span>
              </>
            )}
          </div>
        )}
        {submit.data && <MintStatusTracker mintId={submit.data.mintId} action="spDeposit" />}
        {xrplTxId && !submit.data && (
          <p className="text-xs text-muted/70">Signed {xrplTxId.slice(0, 12)}… — submitting…</p>
        )}
      </Card>
    </Reveal>
  );
}
