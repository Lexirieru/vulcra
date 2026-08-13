"use client";

// Redemption UI (R5), multi-collateral. Any vUSD holder swaps vUSD → the selected
// branch's collateral at face value, drawn from the lowest-CR vaults first. Pure
// preview via shared vault-math; the on-chain redeem() goes through the shared tx
// lifecycle. Real ABI: redeem(vusdAmount18, maxIterations).
import { useState } from "react";
import { formatUnits } from "viem";
import { useAccount } from "wagmi";
import { useAppKit } from "@reown/appkit/react";
import { ArrowDown } from "lucide-react";
import { Badge, Button, Card, CardTitle, Field, Input, Stat } from "@/components/ui";
import { Reveal } from "@/components/motion";
import { TxStatus } from "@/components/vault/TxStatus";
import { ContractsNotice } from "@/components/vault/ContractsNotice";
import { LivePrice } from "@/components/vault/LivePrice";
import { useFtsoPrice } from "@/hooks/useFtsoPrice";
import { branchVaultManager, useVaultParams } from "@/hooks/useVault";
import { useVaultAction } from "@/hooks/useVaultAction";
import { useWalletBalances } from "@/hooks/useWalletBalances";
import { useBranch } from "@/context/branch";
import { collateralForVusd } from "@/lib/vault-math";
import { formatBps, formatToken, parseAmount } from "@/lib/format";

const MAX_ITERATIONS = 25n; // bounded walk down the sorted list

export default function RedeemPage() {
  const { branch } = useBranch();
  const { address: owner } = useAccount();
  const { open } = useAppKit();
  const { price18 } = useFtsoPrice(branch.feedId);
  const { address: vaultManager, configured } = branchVaultManager(branch);
  const { params } = useVaultParams(vaultManager);
  const action = useVaultAction(vaultManager);
  const balances = useWalletBalances(owner);
  const vusdBalance = balances.tokens.find((t) => t.symbol === "vUSD")?.value;
  const [amount, setAmount] = useState("");

  const vusd18 = parseAmount(amount, 18);
  const collDec = branch.collateralDecimals;
  // Estimate NET of the on-chain redemption fee, so "you receive" is honest.
  const collGross =
    vusd18 !== null && price18 ? collateralForVusd(vusd18, price18, collDec) : null;
  const collOut =
    collGross !== null
      ? (collGross * (10_000n - params.redemptionFeeBps)) / 10_000n
      : null;
  // You can only redeem vUSD you actually hold — it's burned from your wallet.
  const insufficient = vusd18 !== null && vusdBalance !== undefined && vusd18 > vusdBalance;
  const valid = vusd18 !== null && vusd18 > 0n && !insufficient;
  const blocked = !configured;

  return (
    <div className="flex flex-col gap-6">
      <Reveal>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Redeem vUSD</h1>
          <p className="mt-1 text-sm text-muted">
            Redeem vUSD for {branch.collateralSymbol} at face value. In V2, redemptions
            are <span className="font-medium text-ink">by interest rate</span> — the
            lowest-rate {branch.label} vaults are redeemed first (borrowers who chose a
            lower rate accept redemption risk in exchange for cheaper debt). This is the
            arbitrage that holds the peg floor.
          </p>
        </div>
      </Reveal>

      <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
        <Reveal>
          <LivePrice />
        </Reveal>

        <Reveal delay={0.05}>
          <Card>
            <div className="flex items-center justify-between">
              <CardTitle>Redemption · {branch.label}</CardTitle>
              <Badge tone="brand">face value · $1</Badge>
            </div>

            {!configured && (
              <div className="mt-4">
                <ContractsNotice branch={branch} />
              </div>
            )}

            <form
              className="mt-4 flex flex-col gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (!valid || blocked) return;
                action.execute("redeem", [vusd18, MAX_ITERATIONS]);
              }}
            >
              <Field
                label="Redeem vUSD"
                htmlFor="redeem-amount"
                error={
                  insufficient
                    ? `Insufficient vUSD — you have ${formatToken(vusdBalance!, 18, 2)}.`
                    : undefined
                }
                hint="Burned at $1 each"
              >
                <Input
                  id="redeem-amount"
                  inputMode="decimal"
                  placeholder="0.0"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </Field>
              {owner && vusdBalance !== undefined && (
                <div className="-mt-2 flex items-center justify-between text-xs">
                  <span className="text-muted/70">Balance {formatToken(vusdBalance, 18, 2)} vUSD</span>
                  {/* Full-precision string so "Max" redeems the whole balance,
                      not a 2-dp rounding of it. */}
                  <button
                    type="button"
                    onClick={() => setAmount(formatUnits(vusdBalance, 18))}
                    className="min-h-8 rounded-full px-2 font-medium text-brand hover:underline"
                  >
                    Max
                  </button>
                </div>
              )}

              <div className="flex justify-center text-muted">
                <ArrowDown className="h-4 w-4" aria-hidden />
              </div>

              <div className="rounded-lg border border-line bg-surface-2/60 p-4">
                <Stat
                  label="You receive (est.)"
                  value={collOut !== null ? formatToken(collOut, collDec, 4) : "—"}
                  sub={`${branch.collateralSymbol} at the live oracle price · ${
                    params.redemptionFeeBps > 0n
                      ? `after the ${formatBps(params.redemptionFeeBps)} redemption fee`
                      : "no redemption fee"
                  }`}
                  tone="brand"
                />
              </div>

              <p className="-mt-2 text-xs text-muted/80">
                Each redemption walks at most {MAX_ITERATIONS.toString()} vaults (lowest
                interest rate first), so a very large redemption may fill partially —
                any unredeemed vUSD simply stays in your wallet.
              </p>

              {!owner ? (
                <Button type="button" onClick={() => open()}>
                  Connect wallet to redeem
                </Button>
              ) : (
                <Button type="submit" disabled={!valid || blocked || action.isBusy}>
                  {action.isBusy ? "Redeeming…" : "Redeem"}
                </Button>
              )}
            </form>

            <TxStatus phase={action.phase} hash={action.hash} error={action.error} />
          </Card>
        </Reveal>
      </div>
    </div>
  );
}
