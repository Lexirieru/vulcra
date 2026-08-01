# src/hooks — chain-read/write + XRPL React hooks

All `"use client"`. Chain reads/writes go through **wagmi's own** `useReadContract` /
`useReadContracts` / `useWriteContract` / `usePublicClient` (never the periphery package's
generated hooks). Every hook is real Coston2/XRPL data — no mocks; unresolved → `undefined`
→ UI renders `"—"`.

## Vault reads/writes
- `useVault.ts` — `useVault(owner, vaultManager)` (`getVault`, polled 12s so accruing
  interest stays current), `useVaultParams` (`params()` struct; falls back to
  `DEFAULT_PARAMS` when unconfigured), `useCollateralToken` (resolves via
  `FlareContractRegistry` when a `collateralRegistryName` is set, e.g. wFLR→"WNat"),
  and pure helper `branchVaultManager(branch)`.
- `useVaultAction.ts` — `useVaultAction(vaultManager)`: shared write lifecycle
  (`idle→signing→confirming→success→error` via `useWaitForTransactionReceipt`), `execute(fn, args)`
  typed to the VaultManager ABI. Also `useTokenApproval` (ERC-20 allowance+approve) and
  `useWrapNative` (WNat.deposit, payable — C2FLR→wFLR).
- `useInterest.ts` — V2 user-set rates: `useInterestConfig` (min/max/default bps from
  contract, fallback to branch config), `useVaultRate` (owner's annual rate, polled),
  `useRedeemableBefore` (bounded on-chain walk down the by-rate redemption queue, cap 25).
- `useBranchStats.ts` — dashboard aggregates: `useBranchStats` (`getEntireSystemDebt`,
  `params`, `vaultCount` + debt-weighted avg rate walked highest→lower, cap 50) and
  `useBranchDebt`.

## Prices & balances
- `useFtsoPrice.ts` — live collateral/USD from FTSOv2 (`getFeedById`), resolved via
  registry, polled ~1 block (1800ms), normalized to 18-dec, with a `isStale` flag from the
  feed's own timestamp. Feed id is per-branch (XRP/USD vs FLR/USD).
- `useWalletBalances.ts` — connected Flare wallet's C2FLR + vUSD + FXRP + WC2FLR. vUSD
  address comes from `VaultManager.vusd()`, WNat from the registry. Three ERC-20 reads are
  SEPARATE (not multicalled) so one unresolved token doesn't blank the others.

## XRPL
- `useXrplWallet.ts` — connect/sign with Crossmark/GemWallet. Per-provider `connectingId`
  (not a shared boolean), persists `(providerId, address)` to localStorage, rehydrates on
  mount. **Instantiated once by `XrplWalletProvider`** — never call directly; use
  `useXrplWalletContext()` (context/xrpl) so the drawer and mint flow share one connection.
- `useXrpBalance.ts` — live **spendable** XRP from a CORS-enabled XRPL testnet node
  (`NEXT_PUBLIC_XRPL_RPC_URL`, default xrpl-labs). spendable = Balance − (base + owners×inc)
  reserve, read from `server_state`. Handles `actNotFound` (unfunded) as a real state.
  Exports `useXrplReserves`, `XRPL_RPC_URL`, `XRP_DECIMALS`.
- `usePersonalAccount.ts` — backend `GET /account/:r` → derived Flare PersonalAccount +
  FXRP balance. `isValidRAddress()` gates the query (also reused elsewhere).

## Conventions & gotchas
- Reads are gated by `query.enabled` (need an address/owner); many poll (12–30s) so
  interest-accruing/price data stays fresh.
- `chainId: COSTON2_CHAIN_ID` (114) is passed on every call.
- Amounts are `bigint` in base units (FXRP/XRP 6-dec, vUSD 18-dec, wFLR 18-dec); format via `lib/format`.
- The XRPL RPC MUST send CORS headers (the canonical altnet node does not) — see the
  `useXrpBalance` header comment before changing the endpoint.
- `fxrpBalance` from the backend is optional → render `"—"`, never default to 0.

## Security
Hooks read public chain/backend data only; no secrets. The backend base URL / XRPL RPC come
from env (gitignored `.env*`). XRPL signing happens in the wallet, not here.
