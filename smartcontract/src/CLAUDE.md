# src/ — Vulcra contracts

The on-chain protocol. All contracts are Solidity 0.8.28, UUPS-upgradeable (ERC1967 proxy +
`UPGRADER_ROLE`-gated `_authorizeUpgrade`), OpenZeppelin `AccessControl`, with storage `__gap`s. USD
amounts are 18-dec; collateral amounts are raw token units (per-branch decimals). Deployed live per
`../deployments/coston2.json`.

## Contracts

- **`VaultManager.sol`** — the CDP core, one instance per collateral branch. Holds all vault state
  and the sorted list; the single storage owner. Key functions:
  - Borrow: `openVault(collateral6, mint18, rateBps, prevHint, nextHint)`,
    `openVaultFor(...)` (ZAP_ROLE only, for VulcraZap), `addCollateral`, `withdrawCollateral`,
    `mintMore`, `repay`, `closeVault`, `adjustInterestRate(newRateBps, prevHint, nextHint)`.
  - Keeper: `liquidate(owner)` (CR < MCR, burns entire debt, seizes debt+bonus, remainder to owner),
    `redeem(vusdAmount18, maxIterations)` (by rate, lowest first), `delegatedRepay(...)`
    (GUARDIAN_EXECUTOR_ROLE, CR-improving repay from a nominated `guardianFunder`), `mintInterest()`
    (permissionless settle poke).
  - Views: `getVault` (returns **entire** interest-inclusive debt), `annualInterestRateBpsOf`,
    `collateralRatioBps`, `isLiquidatable`, `previewOpen`, `getEntireSystemDebt`,
    `redemptionQueueHead`/`lowestRateVault`, `highestRateVault`, `nextVault`/`prevVault`. V1 aliases
    (`riskiestVault`, `safestVault`, `nominalCr`, `fxrp`, `vusd`) kept for ABI compat.
  - **Interest (aggregate O(1) model):** `totalDebt` = recorded debt; `aggWeightedDebtSum` = Σ
    recordedDebt·rate; `pendingAggInterest = aggWeightedDebtSum·dt/year`. Every state-changing op
    calls `_settleAggInterest()` (mints pending to `interestReceiver`, folds into `totalDebt`),
    keeping `VUSD.totalSupply() == totalDebt` continuously and `== Σ vault entire debt` after settle.
  - Admin (PARAM_ADMIN_ROLE): `setParams`, `setInterestConfig`, `setFeeReceiver`, `setDebtCeiling`;
    PAUSER_ROLE: `pause`/`unpause`. Roles: `DEFAULT_ADMIN`, `PARAM_ADMIN`, `PAUSER`, `UPGRADER`,
    `GUARDIAN_EXECUTOR`, `ZAP`.

- **`VUSD.sol`** — shared 18-dec ERC-20 stablecoin. ERC20Permit (EIP-2612) + EIP-3009
  (`modules/EIP3009Upgradeable.sol`, random-nonce authorized transfers) over one EIP-712 domain
  (name "Vulcra USD", version "1"). `mint`/`burn` are `MINTER_ROLE`-only, granted **only to branch
  VaultManagers** at deploy — vUSD exists solely as vault debt.

- **`PriceOracle.sol`** — per-branch, feed-agnostic FTSOv2 wrapper. `price18()` reads the branch
  `feedId` via `ContractRegistry.getTestFtsoV2().getFeedById` (no hardcoded system addresses; free
  view read on Coston2), normalizes to 18-dec, and **reverts `StalePrice` past `maxStalenessSeconds`**
  (3600s) or `ZeroPrice`. `setMaxStalenessSeconds` is PARAM_ADMIN-only.

- **`StabilityPool.sol`** — per-branch Earn pool (UUPS, shared implementation). Depositors provide
  vUSD (`provideToSP`) and earn vUSD via a classic rate-based accumulator (`rewardPerTokenStored`,
  `rewardRate`/sec streamed to `periodFinish`). Rewards funded from real protocol income: the branch
  `interestReceiver` points here, and `notifySurplus`/`notifyRewardAmount` (REWARDS_DISTRIBUTOR_ROLE)
  roll it into the stream. `withdrawFromSP` never pause-gated. APR getters `currentAprBps` /
  `trailingAprBps` derive on-chain from the live rate and checkpoint history. Principal can never be
  paid as rewards (`rewardsOutstanding` accounting). *First line of defense in liquidations per the
  Liquity model.*

- **`VulcraZap.sol`** — stateless, hold-free helper (FXRP branch only). `openVaultAndForward(...)`
  pulls freshly minted FXRP from the caller (the XRPL PersonalAccount), opens a vault it owns via
  `openVaultFor`, and delivers vUSD to a destination — atomically in the 0xFE Smart Accounts custom
  instruction. Any inner revert bubbles up so the direct-mint tx rolls back and no FXRP is minted.

## libraries/ and interfaces/

- `libraries/SortedVaults.sol` — Liquity `SortedTroves`-style doubly-linked list over caller-owned
  storage (VaultManager stays sole storage owner). **In V2 the key is the annual interest rate
  (ascending): `getLast()`/tail = lowest rate = first redemption target;** `getFirst()`/head = highest.
  Node fields/docs still say `nicr` (generic key); hint-validated O(1) insert with bounded head-descent
  fallback (`MAX_SEARCH_STEPS`).
- `libraries/VulcraMath.sol` — decimal + CR math: `WAD`, `BPS`, `toPrice18`, `collateralValueUsd18`,
  `collateralForUsd18`, `crBps`, `nicr`. Single source of truth for scale conversions.
- `interfaces/` — `IVaultManager` (incl. `Params`, `InterestConfig` structs), `IVUSD`, `IPriceOracle`,
  `IVulcraZap`.

## Conventions & gotchas

- **Redemption is by interest rate, not CR** — the sorted list is keyed by rate. Liquidation is still
  by CR. `getVault`/`collateralRatioBps` reflect the **entire** (interest-inclusive) debt.
- Pass `prevHint`/`nextHint` for O(1) sorted-list placement (open / adjustInterestRate); collateral-
  only ops ignore the hint args (vestigial in the ABI).
- Rate must be within the branch `[min,max]`; XRPL Zap opens use the branch `defaultInterestRateBps`.
- **UUPS:** never add state above existing vars; shrink the `__gap` when adding storage. `_authorizeUpgrade`
  is UPGRADER_ROLE-only. All branch pools share one implementation.
- **Testnet:** per-branch `minDebt` is intentionally low (100/200 vUSD) for faucet-limited demos.
- vUSD `mint`/`burn` are MINTER_ROLE-only (VaultManagers only) — never grant to an EOA except the
  Seed script's transient, same-broadcast-revoked treasury mint.
