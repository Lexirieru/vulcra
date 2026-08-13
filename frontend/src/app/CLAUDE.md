# src/app — routes (Next.js App Router)

App Router pages for the Vulcra dApp. `layout.tsx` is the only server root; most pages are
`"use client"` because they read chain/XRPL state. Every page renders inside `AppShell`
(centered tab nav + dual-wallet drawer + fixed bottom `StatsBar`).

## Root
- `layout.tsx` — server component. Loads local fonts (Epilogue, DM Sans via
  `next/font/local`), sets metadata, reads the SSR `cookie` header and passes it to
  `ContextProvider` (wagmi cookie hydration). Wraps children in
  `ContextProvider → BranchProvider → AppShell`. `<body>` uses `overflow-x-clip` so no
  page scrolls horizontally.
- `globals.css` — Tailwind 4 + the single light-theme token set (`--color-*`, `--font-*`).
  No dark mode. Also zeroes CSS transitions under `prefers-reduced-motion`.
- `icon.svg` — app icon.

## Routes
- `/` (`page.tsx`) — dashboard. Hero cards → Borrow/Earn, plus live `BorrowMarketsCard`
  and `EarnPoolsCard` tables. Server component; live reads live in the client subcomponents.
- `/borrow` (`page.tsx`) — collateral picker. Live cards for XRP-Ledger, FXRP, wFLR (FTSO
  price, max-LTV from MCR, contract interest bounds, min debt) + "Soon" cards for stXRP/sFLR.
- `/borrow/[collateral]` — the **EVM/Flare-wallet** branch page (`fxrp` | `wflr`; anything
  else → `notFound()`). Deposit a token you already hold on Flare + borrow vUSD. The
  collateral segment is the ENTRY POINT only — switching collateral is local `useState`
  (no navigation/remount); a GSAP crossfade animates the swap. Shows composer, then (if a
  vault exists) `PositionCard` + `VaultActions` + `PriceSimulator`.
- `/borrow/xrp` — the **XRPL-native** flow (`XrplMintFlow`). Supply XRP from the XR
  Ledger → becomes FXRP on Flare → borrow vUSD, in one signed Payment. Deliberately a
  SEPARATE route from `/borrow/fxrp` (different asset, chain, wallet), not a tab.
- `/earn` (`page.tsx` → `EarnView`) — per-collateral stability pools (deposit/withdraw vUSD).
- `/redeem` — swap vUSD → the selected branch's collateral at face value
  (`redeem(vusdAmount18, maxIterations=25)`); insufficient-vUSD guard, live preview.
- `/guardian` — create/list private TEE auto-repay rules (backend `/guardian/rules`).
  Trigger CR must exceed MCR. Branch-scoped.
- `/liquidations` — at-risk vaults for the active branch, riskiest first; one-click liquidate
  re-checks CR on-chain. Source is env-gated via `useAtRiskVaults`: the **Goldsky** subgraph
  (`src/graphql/` — fold events → current-state, CR from live FTSO) when the branch has one (FXRP),
  else the backend indexer `/vaults/at-risk`. Shows a "via Goldsky subgraph" tag when live.
- `/incentives` — static "coming soon" placeholders (no live program yet, no fake APRs).
- `/borrow/xrp` — the XRPL-native mint (`XrplMintFlow`) with a LivePrice + redemptions
  sidebar. This is the single XRPL entry point; the old standalone `/xrpl` route was
  removed and now 301-redirects here (see `next.config.ts`).

## Conventions & gotchas
- **`"use client"`** on any page touching wagmi/XRPL/Query; keep `layout`, `/earn`,
  `/incentives` (and dashboard shell) as server components where possible.
- **Branch context**: `/borrow/[collateral]` seeds `activeKey` from the URL and syncs it
  back into the shared branch context for the utility routes (`/redeem`, `/guardian`,
  `/liquidations`), which act on the active branch.
- **Responsive tables**: wrap wide content in `min-w-0` parents + `overflow-x-auto` so
  tables scroll inside their card instead of stretching the page.
- **Connect gates**: pages offer "Connect wallet" (EVM via `useAppKit().open()`, XRPL via
  the drawer / inline provider buttons) before any action; forms disable on
  invalid/insufficient/`isBusy`.
- **Motion**: wrap sections in `<Reveal>` / `<Stagger>` (framer-motion) for entrances.

## Security
Never introduce secrets into route code. All addresses/URLs come from `config/` + env; the
backend base URL and any keys stay in gitignored `.env*`. Never commit `references/` or `VULCRA_PRD.md`.
