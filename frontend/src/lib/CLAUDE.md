# src/lib — ABIs, backend client, XRPL wallets, pure helpers

Non-React building blocks: contract ABIs, the typed backend client, the XRPL browser-wallet
abstraction, and pure format/math with no chain or React dependency.

## `contracts/`
- `abis.ts` — the ABI layer. **Mandate:** consume `@flarenetwork/flare-wagmi-periphery-package`
  only for ABI/feed-id CONSTANTS, never its generated hooks; drive every read/write through
  wagmi's own hooks. Local `as const` fragments (kept minimal, typed `view` where the
  production interface is `payable`):
  - `contractRegistryAbi`, `ftsoV2ReadAbi` (`getFeedById`/`…InWei`), `wnatAbi`
    (`deposit`/`withdraw`), plus `erc20Abi` re-exported from viem.
  - `vaultManagerAbi` — the **real Coston2** VaultManager, SAME ABI for every branch. Reads:
    `params`, `getVault`, `previewOpen`, `collateralRatioBps`, `isLiquidatable`, V2 interest
    getters (`min/max/defaultInterestRateBps`, `annualInterestRateBpsOf`,
    `getEntireSystemDebt`, `pendingAggInterest`), and the by-rate redemption queue
    (`redemptionQueueHead`, `lowest/highestRateVault`, `nextVault`). Writes: `openVault`,
    `adjustInterestRate`, `addCollateral`, `withdrawCollateral`, `mintMore`, `repay`,
    `closeVault`, `liquidate`, `redeem`, `delegatedRepay`, `setGuardianFunder`. Field names
    like `collateral6`/`fxrp` are historical — they hold the branch's collateral in ITS
    decimals (FXRP 6, wFLR 18); interpret per branch.
  - `stabilityPoolAbi` — one UUPS proxy per branch. Reads `totalDeposits`, `depositOf`,
    `earned`, `currentAprBps`, `trailingAprBps(window)`, `vusd`; writes `provideToSP`,
    `withdrawFromSP`, `claimReward`. All 18-dec vUSD.
- `registry.ts` — `useContractAddress(name)`: resolve a Flare system address via
  `FlareContractRegistry.getContractAddressByName` (long staleTime; addresses never move).
  (This file IS `"use client"` — the only React piece under `lib/`.)

## `api/`
- `client.ts` — thin typed `fetch` wrapper for the backend (`API_BASE_URL`, default
  `http://localhost:8787`). `ApiError` normalizes failures; `at-risk` 404 degrades to `[]`.
  Adapts the backend's flat `MintPlan` → the nested `MintBuildResponse` the UI uses.
  Endpoints: `getAccount`, `preflight`, `buildMint`, `buildManage`, `submitMint`,
  `getMintStatus`, `listAtRiskVaults`, `listGuardianRules`, `createGuardianRule`,
  `setGuardianRuleEnabled`.
- `types.ts` — the backend boundary types. **The backend owns the 0xFE memo, pre-flight
  limits, mint tracking, Guardian submission — the client never builds a memo.** Note the
  `MintState` machine (INTAKE→ATTEST_REQUESTED→PROOF_READY→EXECUTING→EXECUTED, with DELAYED
  / REVERTED / REJECTED) MUST match the executor. `ManageAction` = repay/close/adjustRate/
  mintMore/addCollateral/withdrawCollateral — all ride the same 0xFE path as the mint.

## `xrpl/wallets.ts`
Injected XRPL wallet abstraction for **Crossmark** and **GemWallet** (connect + sign
in-browser, no server key). SDKs are dynamically imported inside each method (SSR-safe).
Builds a RAW XRPL Payment tx JSON and submits it verbatim so the **0xFE MemoData bytes are
preserved** (never re-encoded); **intentionally NO DestinationTag** (a tag reroutes the
mint). `deepFindString` robustly extracts r-address / tx-hash across SDK response shapes.
Exports `XRPL_PROVIDERS`, `XRPL_PROVIDER_ORDER`.

## Pure helpers (no React/chain)
- `format.ts` — `formatToken/Usd/Price/Cr/Bps`, `shortenAddress`, `parseAmount(str, decimals)→bigint`.
- `vault-math.ts` — CR, liquidation price, redemption collateral, max-mintable, annual
  interest, `healthBand`. Branch-aware (collateral decimals passed in). Single source shared
  by dashboard, simulator, and previews so numbers never diverge.
- `gsap.ts` — shared GSAP setup: `animate()` (reduced-motion HARD gate, jumps to end state),
  `EASE`/`DUR` house constants, `useIsomorphicLayoutEffect`, `prefersReducedMotion()`.

## Conventions & gotchas
- All amounts are `bigint` base units; convert only at the display edge via `format.ts`.
- Swapping any local ABI fragment for the canonical periphery ABI is a one-line change.
- Keep `lib/` React-free except `contracts/registry.ts`.

## Security
No secrets in code. Base URLs come from env (gitignored `.env*`). The client never
constructs the 0xFE memo or handles a signing key. Never commit `references/`/`VULCRA_PRD.md`.
