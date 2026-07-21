"use client";

// ─────────────────────────────────────────────────────────────────────────────
// EXTENSION POINT — real Stability Pool staking plugs in HERE.
//
// The Earn page is a structural scaffold (FE_ENOSYS_SPEC §4): the UI is fully
// wired to this hook's return shape, so shipping real staking is a change to
// THIS FILE ONLY:
//
//   1. Deploy a StabilityPool contract per collateral branch and add its
//      address to `src/config/branches.ts` (e.g. `stabilityPool: Address | ""`).
//   2. Add its ABI to `src/lib/contracts/abis.ts`.
//   3. Replace the stub below with real wagmi reads/writes:
//        - tvl18         ← pool.totalDeposits()          (useReadContract)
//        - aprBps        ← derived from branch fee income
//        - apr7dBps      ← trailing 7-day APR (needs an indexer / history)
//        - userDeposit18 ← pool.depositOf(account)
//        - deposit()     ← pool.provideToSP(amount)      (useWriteContract)
//        - withdraw()    ← pool.withdrawFromSP(amount)
//      then flip `deployed: true`.
//
// Every consumer (StabilityPoolCard, DepositPanel) renders "—" and disabled
// actions while `deployed` is false — no fake numbers, per spec §5.
// ─────────────────────────────────────────────────────────────────────────────
import type { BranchKey, CollateralBranch } from "@/config/branches";

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
  /** Wire to StabilityPool.provideToSP — absent while the stub is in place. */
  deposit?: (amount18: bigint) => Promise<void>;
  /** Wire to StabilityPool.withdrawFromSP — absent while the stub is in place. */
  withdraw?: (amount18: bigint) => Promise<void>;
}

export function useStabilityPool(branch: CollateralBranch): StabilityPoolState {
  // TODO(EARN-STAKING): replace this stub with real contract reads/writes as
  // described in the header comment.
  return { poolKey: branch.key, deployed: false, isLoading: false };
}
