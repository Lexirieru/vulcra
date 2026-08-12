"use client";

// Send vUSD from the XRPL-native path OUT to any EVM wallet (Rabby / MetaMask).
// The vUSD a borrow delivers lands on the user's Flare PersonalAccount, not their
// EVM wallet — this transfers it to an arbitrary 0x address in ONE signed XRPL
// payment (send: vUSD.transfer committed as a net-0 0xFE call). Auto-signs on
// build, mirroring the Earn deposit flow — one button, no EVM wallet needed.
//
// Uses the same SectionCard shell as XrplEarnDeposit so the two surfaces read
// identically, just wired to a transfer-out instead of a pool deposit.
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Loader2, PenLine } from "lucide-react";
import { Button, Field, Input, PillButton, SectionCard, TokenIcon } from "@/components/ui";
import { MintStatusTracker } from "@/components/xrpl/MintStatusTracker";
import { api } from "@/lib/api/client";
import type { MintBuildResponse } from "@/lib/api/types";
import { useXrplWalletContext } from "@/context/xrpl";
import { usePersonalAccount } from "@/hooks/usePersonalAccount";
import { useWalletBalances } from "@/hooks/useWalletBalances";
import { XRPL_PROVIDERS } from "@/lib/xrpl/wallets";
import { formatToken, parseAmount } from "@/lib/format";

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export function XrplSendVusd() {
  const wallet = useXrplWalletContext();
  const account = usePersonalAccount(wallet.address ?? "");
  const pa = account.data?.personalAccount;
  const balances = useWalletBalances(pa);
  const vusd18 = balances.tokens.find((t) => t.symbol === "vUSD")?.value;

  const [amount, setAmount] = useState("");
  const [to, setTo] = useState("");
  const [xrplTxId, setXrplTxId] = useState("");
  const amt18 = parseAmount(amount, 18);
  const hasVusd = vusd18 !== undefined && vusd18 > 0n;
  const insufficient = amt18 !== null && vusd18 !== undefined && amt18 > vusd18;
  const toTrimmed = to.trim();
  const toValid = EVM_ADDRESS.test(toTrimmed);
  const toDirty = toTrimmed.length > 0;
  const valid = amt18 !== null && amt18 > 0n && !insufficient && hasVusd && toValid;

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
        action: "send",
        amount18: amt18!.toString(),
        to: toTrimmed,
      }),
    onSuccess: (data) => {
      if (wallet.address) void signAndTrack(data);
    },
  });

  const busy = build.isPending || wallet.signing || submit.isPending;
  const providerName = wallet.providerId
    ? XRPL_PROVIDERS[wallet.providerId].name
    : "your XRP wallet";

  // No XRP wallet connected → nothing to show (this is an XRPL-native surface).
  if (!wallet.address) return null;

  return (
    <SectionCard
      title="Send vUSD"
      subtitle="To an EVM wallet"
      icon={<TokenIcon symbol="vUSD" size={36} alt="" />}
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted">
          Move the vUSD on your Flare personal account out to any EVM wallet
          (Rabby / MetaMask) — <span className="text-ink">one XRPL payment</span>,
          no EVM wallet needed to send it.
        </p>

        <Field
          label="Amount"
          htmlFor="send-xrpl-amount"
          error={
            insufficient
              ? `You only have ${formatToken(vusd18!, 18, 2)} vUSD on your personal account.`
              : undefined
          }
          hint="Transferred from your Flare personal account · one XRPL payment (fees only)"
        >
          <div className="relative">
            <Input
              id="send-xrpl-amount"
              inputMode="decimal"
              autoComplete="off"
              placeholder="0.00"
              className="pr-24"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            <span
              aria-hidden
              className="pointer-events-none absolute right-3.5 top-1/2 flex -translate-y-1/2 items-center gap-1.5 text-sm text-muted"
            >
              <TokenIcon symbol="vUSD" size={20} alt="" />
              vUSD
            </span>
          </div>
        </Field>

        {vusd18 !== undefined && (
          <div className="-mt-1 flex items-center justify-between text-xs">
            <span className="text-muted">Available {formatToken(vusd18, 18, 2)} vUSD</span>
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

        <Field
          label="Destination EVM address"
          htmlFor="send-xrpl-to"
          error={toDirty && !toValid ? "Enter a valid 0x… EVM address (40 hex chars)." : undefined}
          hint="Where the vUSD lands on Flare (Coston2) — your Rabby / MetaMask address."
        >
          <Input
            id="send-xrpl-to"
            inputMode="text"
            autoComplete="off"
            spellCheck={false}
            placeholder="0x…"
            className="font-mono"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </Field>

        <PillButton
          className="w-full"
          disabled={!valid || busy}
          onClick={() => build.mutate()}
        >
          {build.isPending
            ? "Generating…"
            : wallet.signing
              ? `Confirm in ${providerName}…`
              : hasVusd
                ? "Send vUSD"
                : "Borrow vUSD first to send"}
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
        {submit.data && <MintStatusTracker mintId={submit.data.mintId} action="send" />}
        {xrplTxId && !submit.data && (
          <p className="text-xs text-muted/70">Signed {xrplTxId.slice(0, 12)}… — submitting…</p>
        )}
      </div>
    </SectionCard>
  );
}
