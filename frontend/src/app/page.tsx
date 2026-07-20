"use client";

// EVM vault dashboard (U5–U7 / R17, R18). Live FTSO price, CR gauge, liquidation
// price, what-if simulator, and open/adjust/repay/close actions.
import { useAccount } from "wagmi";
import { useAppKit } from "@reown/appkit/react";
import { Button, Card, EmptyState, Skeleton } from "@/components/ui";
import { Reveal, Stagger } from "@/components/motion";
import { LivePrice } from "@/components/vault/LivePrice";
import { PositionCard } from "@/components/vault/PositionCard";
import { PriceSimulator } from "@/components/vault/PriceSimulator";
import { VaultActions } from "@/components/vault/VaultActions";
import { ContractsNotice } from "@/components/vault/ContractsNotice";
import { useFtsoPrice } from "@/hooks/useFtsoPrice";
import { useVault, useVaultParams } from "@/hooks/useVault";

export default function DashboardPage() {
  const { address, isConnected } = useAccount();
  const { price18 } = useFtsoPrice();
  const { params } = useVaultParams();
  const { vault, hasVault, notConfigured, isLoading } = useVault(address);

  return (
    <div className="flex flex-col gap-6">
      <Reveal>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Vault dashboard</h1>
          <p className="mt-1 text-sm text-muted">
            Lock FXRP as collateral, mint vUSD, and watch your position against the
            live oracle.
          </p>
        </div>
      </Reveal>

      <Stagger className="grid gap-6 lg:grid-cols-3">
        <LivePrice />

        {notConfigured ? (
          <div className="lg:col-span-2">
            <ContractsNotice />
          </div>
        ) : !isConnected ? (
          <Card className="lg:col-span-2 flex flex-col items-center justify-center gap-3 text-center">
            <p className="text-sm text-muted">Connect a wallet to view your vault.</p>
            <ConnectPrompt />
          </Card>
        ) : isLoading ? (
          <Card className="lg:col-span-2">
            <Skeleton className="h-40 w-full" />
          </Card>
        ) : hasVault && vault ? (
          <div className="lg:col-span-2">
            <PositionCard vault={vault} price18={price18} params={params} />
          </div>
        ) : (
          <div className="lg:col-span-2">
            <EmptyState
              title="No vault yet"
              description="Open a vault below to deposit FXRP and mint vUSD."
            />
          </div>
        )}
      </Stagger>

      <div className="grid gap-6 lg:grid-cols-2">
        <Reveal delay={0.05}>
          <VaultActions
            vault={vault}
            price18={price18}
            params={params}
            disabled={notConfigured}
          />
        </Reveal>
        <Reveal delay={0.1}>
          {hasVault && vault && price18 ? (
            <PriceSimulator vault={vault} livePrice18={price18} params={params} />
          ) : (
            <Card className="flex items-center justify-center text-center text-sm text-muted">
              The what-if simulator appears once you have an open vault.
            </Card>
          )}
        </Reveal>
      </div>
    </div>
  );
}

function ConnectPrompt() {
  const { open } = useAppKit();
  return (
    <Button size="sm" onClick={() => open()}>
      Connect wallet
    </Button>
  );
}
