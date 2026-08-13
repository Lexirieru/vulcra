# src/components — UI primitives + feature components

React components, split into a design-system barrel (`ui/`) and feature folders. Motion is
framer-motion (`motion/`) for entrances and GSAP (`shell/ButtonMotion`, `borrow/RailToggle`)
for interactions. Reduced-motion is honored everywhere.

## `ui/` — shared primitives (Enosys-style light theme)
Import from the barrel: `@/components/ui`. **Server-component-safe** (no `"use client"`,
colors via `--color-*` tokens, ≥40px hit targets). Full prop docs in `ui/README.md`.
- `card.tsx` (`Card`, `CardTitle`, `SectionCard`, `HeroCard`), `button.tsx` (`PillButton`
  preferred; `Button` legacy), `badge.tsx` (`Badge` tones, `RatePill`), `table.tsx`
  (`DataTable<T>` — use `align:"right"` for numeric cols), `form.tsx` (`Input`, `Field`),
  `states.tsx` (`Skeleton`, `EmptyState`, `ErrorState`), `stat.tsx` (`Stat`, `StatItem`),
  `token-icon.tsx` (`TokenIcon` — FXRP/XRP, FLR/wFLR, vUSD chips), `sticker.tsx`,
  `wordmark.tsx`, `cn.ts` (className merge). `index.tsx` re-exports all.

## `motion/` — `index.tsx`
`Reveal` (entrance), `Stagger` (index-based child stagger), `RollingNumber`, `TIMING`
constants. Spring-first, reduced-motion safe. Wrap page sections in these.

## `shell/` — app chrome
- `AppShell.tsx` — nav (Dashboard · Borrow · Earn · Incentives; "More" = Redeem · Guardian ·
  Liquidations; XRPL mint only when `branch.hasXrplMint`), wallet entry, `NetworkGuard`,
  fixed bottom `StatsBar`, `BranchSwitch` on branch-scoped routes, mounts `ButtonMotion`.
- `WalletSidebar.tsx` — the ONE drawer holding BOTH wallets (EVM Coston2 balances via
  `useWalletBalances`; XRP Ledger via `useXrpBalance` + backend PersonalAccount). `WalletsButton` opens it.
- `StatsBar.tsx` — protocol TVL (Σ collateral·price per branch) + vUSD supply + live prices.
- `BranchSwitch.tsx` — FXRP/wFLR selector (writes branch context). `NetworkGuard.tsx` —
  one-click switch to Coston2 when connected elsewhere. `ButtonMotion.tsx` — delegated GSAP
  press/hover via `data-gsap-press`, mounted once (keeps `ui/` server-safe).

## `vault/` — EVM vault surfaces
- `VaultActions.tsx` — tabbed write panel (Deposit / Withdraw / Borrow / Repay / Interest /
  Close) mapped 1:1 to `VaultManager`. Collateral deposits gate on ERC-20 approval; wFLR
  adds a "wrap C2FLR → wFLR" panel. Repay/close need no approval (vUSD is burned).
- `BorrowComposer.tsx` — open-vault composer (Collateral → Loan → interest slider),
  calls `openVault`. `PositionCard.tsx`, `CrGauge.tsx` (semicircular CR gauge),
  `PriceSimulator.tsx` (pure what-if via `lib/vault-math`), `LivePrice.tsx`,
  `TxStatus.tsx` (shared write lifecycle), `ContractsNotice.tsx` (unconfigured branch),
  `RedemptionsExplainer.tsx` (static education).

## `xrpl/` — XRPL-native flow
- `XrplMintFlow.tsx` — the whole XRP-Ledger flow (large file). Connect/derive r-address →
  PersonalAccount → composer (or MANAGE view mirroring `VaultActions` tabs) → pre-flight →
  build → **auto-sign the backend Payment in the connected wallet on build success** →
  submit → track. Every action is ONE 0xFE payment (net-0 except supplying collateral).
  QR + paste-r-address fallback for the no-wallet path.
- `MintStatusTracker.tsx` — polls backend mint status through the state machine
  (INTAKE→…→EXECUTED); DELAYED is a first-class countdown, REVERTED reassures XRP is safe.

## Other feature folders
- `dashboard/` — `BorrowMarketsCard`, `EarnPoolsCard` (live branch/pool tables).
- `earn/` — `EarnView`, `DepositPanel`, and `useStabilityPool.ts`
  (co-located hook: live TVL/APR/deposit reads + approve+provide/withdraw writes).
- `liquidations/LiquidateButton.tsx`, `borrow/RailToggle.tsx` (GSAP Flare↔XRP rail toggle).

## Conventions & gotchas
- **Insufficient-balance guards** everywhere: deposit caps to wallet balance, repay to
  debt/held vUSD, XRP supply to spendable drops; sub-min leaves show inline errors.
- **Connect gates** before actions; buttons disable on invalid/`isBusy`/`busy`.
- **EVM writes vs XRPL 0xFE payments**: `vault/` uses `useVaultAction` (wagmi writes);
  `xrpl/` builds+signs a Payment. Same tab set, different execution.
- **Responsive tables**: `min-w-0` parent + `overflow-x-auto`; numeric cells `tabular-nums`.
- Prefer `PillButton` over legacy `Button`; keep `ui/` free of `"use client"`.

## Security
Presentational only — no secrets. Never log or render private keys/memos beyond what the
backend returns for display. Never commit `references/` or `VULCRA_PRD.md`.
