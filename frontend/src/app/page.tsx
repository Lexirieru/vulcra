"use client";

// EVM vault dashboard, multi-collateral. Two clean states: an Enosys-style
// single-column borrow composer when there is no vault, and a manage view
// (position + actions + what-if) when a vault exists. All data is live per-branch
// (FTSO price, params, interest) — wiring unchanged.
import { useAccount } from "wagmi";
import { Card, Skeleton } from "@/components/ui";
import { Reveal } from "@/components/motion";
import { PositionCard } from "@/components/vault/PositionCard";
import { PriceSimulator } from "@/components/vault/PriceSimulator";
import { VaultActions } from "@/components/vault/VaultActions";
import { BorrowComposer } from "@/components/vault/BorrowComposer";
import { ContractsNotice } from "@/components/vault/ContractsNotice";
import { useFtsoPrice } from "@/hooks/useFtsoPrice";
import { useCollateralToken, useVault, useVaultParams } from "@/hooks/useVault";
import { useVaultRate, useRedeemableBefore } from "@/hooks/useInterest";
import { useBranch } from "@/context/branch";

export default function DashboardPage() {
  const { branch } = useBranch();
  const { address, isConnected } = useAccount();
  const vaultManager = branch.vaultManager || undefined;
  const { price18 } = useFtsoPrice(branch.feedId);
  const { params } = useVaultParams(vaultManager);
  const { vault, hasVault, notConfigured, isLoading } = useVault(address, vaultManager);
  const { address: collateralToken } = useCollateralToken(branch);
  const { rateBps } = useVaultRate(address, vaultManager);
  const { data: redeemableBefore } = useRedeemableBefore(address, vaultManager, hasVault);

  return (
    <div className="flex flex-col gap-8">
      <Reveal>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {hasVault ? `Your ${branch.label} vault` : `Borrow vUSD against ${branch.collateralSymbol}`}
          </h1>
          <p className="mt-1 text-sm text-muted">
            {hasVault
              ? `Manage collateral, debt, and interest — live ${branch.feedLabel} pricing from FTSO.`
              : `Deposit ${branch.collateralSymbol}, mint vUSD, and set your own interest rate.`}
          </p>
        </div>
      </Reveal>

      {notConfigured ? (
        <ContractsNotice branch={branch} />
      ) : isConnected && isLoading ? (
        <Card>
          <Skeleton className="h-64 w-full" />
        </Card>
      ) : hasVault && vault ? (
        <div className="flex flex-col gap-6">
          <Reveal>
            <PositionCard
              vault={vault}
              price18={price18}
              params={params}
              collDec={branch.collateralDecimals}
              collateralSymbol={branch.collateralSymbol}
              feedLabel={branch.feedLabel}
              rateBps={rateBps}
              redeemableBefore18={redeemableBefore?.debt18}
            />
          </Reveal>
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
              {price18 ? (
                <PriceSimulator
                  vault={vault}
                  livePrice18={price18}
                  params={params}
                  collDec={branch.collateralDecimals}
                />
              ) : (
                <Card className="flex items-center justify-center text-center text-sm text-muted">
                  Loading live price…
                </Card>
              )}
            </Reveal>
          </div>
        </div>
      ) : (
        <Reveal>
          <BorrowComposer />
        </Reveal>
      )}
    </div>
  );
}
