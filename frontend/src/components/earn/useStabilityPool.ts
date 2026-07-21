"use client";

// Real Stability Pool wiring (was the EARN-STAKING extension point; see git
// history for the stub). Each branch's `stabilityPool` (config/branches.ts) is
// a live UUPS proxy on Coston2 — deployed, verified and seeded — so every
// figure here is on-chain state:
//   - tvl18         ← pool.totalDeposits()
//   - aprBps        ← pool.currentAprBps()      (live reward rate vs live TVL)
//   - apr7dBps      ← pool.trailingAprBps(7d)   (realized, from the on-chain
//                                                accumulator history — no indexer)
//   - userDeposit18 ← pool.depositOf(account)
//   - deposit()     ← vUSD.approve (if needed) + pool.provideToSP(amount)
//   - withdraw()    ← pool.withdrawFromSP(amount)  (also pays pending rewards)
// The vUSD address is resolved from the pool itself (pool.vusd(), the same
// no-env pattern as StatsBar). A blank `stabilityPool` renders the honest
// "coming soon" state — no fake numbers, per spec §5.
import { useAccount, useConfig, useReadContracts } from "wagmi";
import {
  readContract,
  waitForTransactionReceipt,
  writeContract,
} from "wagmi/actions";
import { zeroAddress, type Address } from "viem";
import { COSTON2_CHAIN_ID } from "@/config/contracts";
import { erc20Abi, stabilityPoolAbi } from "@/lib/contracts/abis";
import type { BranchKey, CollateralBranch } from "@/config/branches";

const SEVEN_DAYS = 7n * 24n * 60n * 60n;
const POLL_MS = 15_000;

export interface StabilityPoolState {
  poolKey: BranchKey;
  /** False until a StabilityPool contract is deployed + wired (see header). */
  deployed: boolean;
  /** Total vUSD in the pool, 18 dec. `undefined` renders as "—". */
  tvl18?: bigint;
  /** Current APR in basis points. `undefined` renders as "—". */
  aprBps?: number;
  /** Trailing 7-day APR in basis points. `undefined` renders as "—". */
  apr7dBps?: number;
  /** Connected account's deposit, 18 dec. `undefined` renders as "—". */
  userDeposit18?: bigint;
  isLoading: boolean;
  /** approve (when allowance is short) + StabilityPool.provideToSP. */
  deposit?: (amount18: bigint) => Promise<void>;
  /** StabilityPool.withdrawFromSP (principal + pending rewards). */
  withdraw?: (amount18: bigint) => Promise<void>;
}

export function useStabilityPool(branch: CollateralBranch): StabilityPoolState {
  const pool = (branch.stabilityPool || undefined) as Address | undefined;
  const { address: account } = useAccount();
  const config = useConfig();

  const base = { address: pool, abi: stabilityPoolAbi, chainId: COSTON2_CHAIN_ID } as const;
  const { data, isLoading, refetch } = useReadContracts({
    contracts: [
      { ...base, functionName: "totalDeposits" },
      { ...base, functionName: "currentAprBps" },
      { ...base, functionName: "trailingAprBps", args: [SEVEN_DAYS] },
      { ...base, functionName: "vusd" },
      { ...base, functionName: "depositOf", args: [account ?? zeroAddress] },
    ],
    query: { enabled: Boolean(pool), refetchInterval: POLL_MS },
  });

  const read = <T,>(i: number): T | undefined =>
    data?.[i]?.status === "success" ? (data[i].result as T) : undefined;

  const tvl18 = read<bigint>(0);
  const aprRaw = read<bigint>(1);
  const apr7dRaw = read<bigint>(2);
  const vusd = read<Address>(3);
  const userDeposit18 = account ? read<bigint>(4) : undefined;

  // The deposit panel has no error slot (scaffold contract): failures — user
  // rejection included — surface on the console instead of crashing the tree.
  async function deposit(amount18: bigint) {
    if (!pool || !account || !vusd) return;
    try {
      await runDeposit(amount18);
    } catch (err) {
      console.error("[earn] deposit failed", err);
    }
  }

  async function runDeposit(amount18: bigint) {
    if (!pool || !account || !vusd) return;
    const allowance = await readContract(config, {
      address: vusd,
      abi: erc20Abi,
      functionName: "allowance",
      args: [account, pool],
      chainId: COSTON2_CHAIN_ID,
    });
    if (allowance < amount18) {
      const approveHash = await writeContract(config, {
        address: vusd,
        abi: erc20Abi,
        functionName: "approve",
        args: [pool, amount18],
        chainId: COSTON2_CHAIN_ID,
      });
      await waitForTransactionReceipt(config, {
        hash: approveHash,
        chainId: COSTON2_CHAIN_ID,
      });
    }
    const hash = await writeContract(config, {
      ...base,
      address: pool,
      functionName: "provideToSP",
      args: [amount18],
    });
    await waitForTransactionReceipt(config, { hash, chainId: COSTON2_CHAIN_ID });
    await refetch();
  }

  async function withdraw(amount18: bigint) {
    if (!pool || !account) return;
    try {
      const hash = await writeContract(config, {
        ...base,
        address: pool,
        functionName: "withdrawFromSP",
        args: [amount18],
      });
      await waitForTransactionReceipt(config, { hash, chainId: COSTON2_CHAIN_ID });
      await refetch();
    } catch (err) {
      console.error("[earn] withdraw failed", err);
    }
  }

  return {
    poolKey: branch.key,
    deployed: Boolean(pool),
    tvl18,
    aprBps: aprRaw !== undefined ? Number(aprRaw) : undefined,
    apr7dBps: apr7dRaw !== undefined ? Number(apr7dRaw) : undefined,
    userDeposit18,
    isLoading,
    deposit: pool ? deposit : undefined,
    withdraw: pool ? withdraw : undefined,
  };
}
