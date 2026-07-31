"use client";

// Fixed bottom stats bar (Enosys-style): protocol TVL, vUSD supply, and live
// FXRP/FLR prices. Every number is a real Coston2 read — TVL is the sum over
// branches of collateralToken.balanceOf(vaultManager) × FTSO price, vUSD supply
// is totalSupply() on the token address the VaultManager itself reports via
// vusd(). Anything unresolved renders "—", never a fabricated number.
import { useReadContract } from "wagmi";
import type { Address } from "viem";
import { BRANCHES } from "@/config/branches";
import { COSTON2_CHAIN_ID } from "@/config/contracts";
import { erc20Abi, vaultManagerAbi } from "@/lib/contracts/abis";
import { useFtsoPrice } from "@/hooks/useFtsoPrice";
import { useCollateralToken } from "@/hooks/useVault";
import { formatPrice, formatToken, formatUsd } from "@/lib/format";
import { StatItem, TokenIcon } from "@/components/ui";

const SLOW_POLL_MS = 30_000; // balances/supply move far slower than prices

function to18(value: bigint, decimals: number): bigint {
  return decimals <= 18
    ? value * 10n ** BigInt(18 - decimals)
    : value / 10n ** BigInt(decimals - 18);
}

/** Muted "stale" marker for an FTSO price whose own timestamp lags. */
function StaleMark() {
  return (
    <span className="text-xs font-normal text-[var(--color-warning)]"> · stale</span>
  );
}

export function StatsBar() {
  const fxrp = BRANCHES.fxrp;
  const wflr = BRANCHES.wflr;

  const xrpPrice = useFtsoPrice(fxrp.feedId);
  const flrPrice = useFtsoPrice(wflr.feedId);

  // Collateral held by each branch's VaultManager (the protocol's TVL legs).
  const wflrToken = useCollateralToken(wflr);
  const fxrpBalance = useReadContract({
    address: (fxrp.collateralToken || undefined) as Address | undefined,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: fxrp.vaultManager ? [fxrp.vaultManager as Address] : undefined,
    chainId: COSTON2_CHAIN_ID,
    query: {
      enabled: Boolean(fxrp.collateralToken && fxrp.vaultManager),
      refetchInterval: SLOW_POLL_MS,
    },
  });
  const wflrBalance = useReadContract({
    address: wflrToken.address,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: wflr.vaultManager ? [wflr.vaultManager as Address] : undefined,
    chainId: COSTON2_CHAIN_ID,
    query: {
      enabled: Boolean(wflrToken.address && wflr.vaultManager),
      refetchInterval: SLOW_POLL_MS,
    },
  });

  // vUSD supply: the VaultManager is the authority on the token address (no
  // env needed) — vusd() → ERC20.totalSupply(). Both branches share one vUSD.
  const vusdSource = (fxrp.vaultManager || wflr.vaultManager) as Address | "";
  const vusdAddress = useReadContract({
    address: vusdSource || undefined,
    abi: vaultManagerAbi,
    functionName: "vusd",
    chainId: COSTON2_CHAIN_ID,
    query: { enabled: Boolean(vusdSource), staleTime: Infinity },
  });
  const vusdSupply = useReadContract({
    address: vusdAddress.data as Address | undefined,
    abi: erc20Abi,
    functionName: "totalSupply",
    chainId: COSTON2_CHAIN_ID,
    query: { enabled: Boolean(vusdAddress.data), refetchInterval: SLOW_POLL_MS },
  });

  // TVL only renders once every leg (both balances AND both prices) is live —
  // a partial sum would read as a real, smaller total.
  const tvl18 = (() => {
    if (fxrpBalance.data === undefined || xrpPrice.price18 === undefined) return undefined;
    if (wflrBalance.data === undefined || flrPrice.price18 === undefined) return undefined;
    const fxrpUsd = to18(fxrpBalance.data, fxrp.collateralDecimals) * xrpPrice.price18;
    const wflrUsd = to18(wflrBalance.data, wflr.collateralDecimals) * flrPrice.price18;
    return (fxrpUsd + wflrUsd) / 10n ** 18n;
  })();

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)]"
      aria-label="Protocol stats"
    >
      <div className="mx-auto flex h-12 max-w-6xl items-center gap-5 overflow-x-auto px-4 sm:gap-7">
        <StatItem label="TVL" value={formatUsd(tvl18)} />
        <StatItem
          label="vUSD supply"
          icon={<TokenIcon symbol="vUSD" size={18} alt="" />}
          value={formatToken(vusdSupply.data, 18, 0)}
        />
        {/* Prices push right on desktop; hidden on mobile so the fixed bar can't
            overflow the viewport (they're also shown on each page's price card). */}
        <div className="ml-auto hidden items-center gap-5 sm:flex sm:gap-7">
          <StatItem
            label={fxrp.feedLabel}
            icon={<TokenIcon symbol="FXRP" size={18} alt="" />}
            value={
              <>
                {formatPrice(xrpPrice.price18)}
                {xrpPrice.isStale ? <StaleMark /> : null}
              </>
            }
          />
          <StatItem
            label={wflr.feedLabel}
            icon={<TokenIcon symbol="FLR" size={18} alt="" />}
            value={
              <>
                {formatPrice(flrPrice.price18)}
                {flrPrice.isStale ? <StaleMark /> : null}
              </>
            }
          />
        </div>
      </div>
    </div>
  );
}
