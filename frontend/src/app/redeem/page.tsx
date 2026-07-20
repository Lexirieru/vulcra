"use client";

// Redemption UI (NEW unit / R5). Any vUSD holder swaps vUSD → FXRP at face value,
// drawn from the lowest-CR vaults first. Pure preview via shared vault-math; the
// on-chain redeem() call goes through the shared tx lifecycle.
import { useState } from "react";
import { zeroAddress } from "viem";
import { ArrowDown } from "lucide-react";
import { Badge, Button, Card, CardTitle, Field, Input, Stat } from "@/components/ui";
import { Reveal } from "@/components/motion";
import { TxStatus } from "@/components/vault/TxStatus";
import { ContractsNotice } from "@/components/vault/ContractsNotice";
import { LivePrice } from "@/components/vault/LivePrice";
import { useFtsoPrice } from "@/hooks/useFtsoPrice";
import { useVaultManagerAddress } from "@/hooks/useVault";
import { useVaultAction } from "@/hooks/useVaultAction";
import { fxrpForVusd } from "@/lib/vault-math";
import { formatToken, parseAmount } from "@/lib/format";

export default function RedeemPage() {
  const { price18 } = useFtsoPrice();
  const { configured } = useVaultManagerAddress();
  const action = useVaultAction();
  const [amount, setAmount] = useState("");

  const vusd18 = parseAmount(amount, 18);
  const fxrpOut = vusd18 !== null && price18 ? fxrpForVusd(vusd18, price18) : null;
  const valid = vusd18 !== null && vusd18 > 0n;
  const blocked = !configured;

  return (
    <div className="flex flex-col gap-6">
      <Reveal>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Redeem vUSD</h1>
          <p className="mt-1 text-sm text-muted">
            Redeem vUSD for FXRP at face value. Redemptions draw from the riskiest
            vaults first — this is the arbitrage that holds the peg floor.
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
              <CardTitle>Redemption</CardTitle>
              <Badge tone="ember">face value · $1</Badge>
            </div>

            {!configured && (
              <div className="mt-4">
                <ContractsNotice />
              </div>
            )}

            <form
              className="mt-4 flex flex-col gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (!valid || blocked) return;
                action.execute("redeem", [vusd18, zeroAddress]);
              }}
            >
              <Field label="Redeem vUSD" htmlFor="redeem-amount" hint="Burned at $1 each">
                <Input
                  id="redeem-amount"
                  inputMode="decimal"
                  placeholder="0.0"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </Field>

              <div className="flex justify-center text-faint">
                <ArrowDown className="h-4 w-4" aria-hidden />
              </div>

              <div className="rounded-lg border border-border bg-surface-2/60 p-4">
                <Stat
                  label="You receive (est.)"
                  value={fxrpOut !== null ? formatToken(fxrpOut, 6, 4) : "—"}
                  sub="FXRP at the live oracle price"
                  tone="ember"
                />
              </div>

              <Button type="submit" disabled={!valid || blocked || action.isBusy}>
                {action.isBusy ? "Redeeming…" : "Redeem"}
              </Button>
            </form>

            <TxStatus phase={action.phase} hash={action.hash} error={action.error} />
          </Card>
        </Reveal>
      </div>
    </div>
  );
}
