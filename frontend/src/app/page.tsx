"use client";

// EVM vault dashboard (U5–U7 / R17, R18), multi-collateral. Live per-branch FTSO
// price, CR gauge, liquidation price, what-if simulator, and vault actions — all
// scoped to the selected collateral branch (FXRP / wFLR).
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
import { useCollateralToken, useVault, useVaultParams } from "@/hooks/useVault";
import { useBranch } from "@/context/branch";

export default function DashboardPage() {
  const { branch } = useBranch();
  const { address, isConnected } = useAccount();
  const vaultManager = branch.vaultManager || undefined;
  const { price18 } = useFtsoPrice(branch.feedId);
  const { params } = useVaultParams(vaultManager);
  const { vault, hasVault, notConfigured, isLoading } = useVault(address, vaultManager);
  const { address: collateralToken } = useCollateralToken(branch);

  return (
    <div className="flex flex-col gap-6">
      <Reveal>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {branch.label} vault dashboard
          </h1>
          <p className="mt-1 text-sm text-muted">
            Lock {branch.collateralSymbol} as collateral, mint vUSD, and watch your
            position against the live {branch.feedLabel} oracle.
          </p>
        </div>
      </Reveal>

      <Stagger className="grid gap-6 lg:grid-cols-3">
        <LivePrice />

        {notConfigured ? (
          <div className="lg:col-span-2">
            <ContractsNotice branch={branch} />
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
            <PositionCard
              vault={vault}
              price18={price18}
              params={params}
              collDec={branch.collateralDecimals}
              collateralSymbol={branch.collateralSymbol}
              feedLabel={branch.feedLabel}
            />
          </div>
        ) : (
          <div className="lg:col-span-2">
            <EmptyState
              title="No vault yet"
              description={`Open a vault below to deposit ${branch.collateralSymbol} and mint vUSD.`}
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
            branch={branch}
            collateralToken={collateralToken}
            owner={address}
            disabled={notConfigured}
          />
        </Reveal>
        <Reveal delay={0.1}>
          {hasVault && vault && price18 ? (
            <PriceSimulator
              vault={vault}
              livePrice18={price18}
              params={params}
              collDec={branch.collateralDecimals}
            />
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
