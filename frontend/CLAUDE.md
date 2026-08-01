# Vulcra frontend

Next.js dApp for **Vulcra** — an XRPL-native, multi-collateral CDP stablecoin (**vUSD**)
on **Flare Coston2** (testnet, chain id **114**, native token C2FLR). Users borrow vUSD
against FXRP or wFLR collateral, set their own interest rate (Liquity-V2 style), earn in
stability pools, redeem, liquidate, and run private "Guardian" auto-repay rules. The
headline feature: supply **XRP straight from the XRP Ledger** as collateral in a single
signed Payment — no EVM wallet, no FLR gas.

> Next.js here is bleeding-edge (v16). APIs differ from older training data — read
> `node_modules/next/dist/docs/` before writing Next-specific code (see `AGENTS.md`).

## Stack
- **Next.js 16.2.10** App Router · **React 19.2.4** · **TypeScript 5** (strict).
  React Compiler is ON (`next.config.ts` `reactCompiler: true` + `babel-plugin-react-compiler`).
- **wagmi 3.7 + viem 2.48 + Reown AppKit 1.8** — EVM wallets, **Coston2 only**
  (`flareTestnet` === Coston2).
- **@crossmarkio/sdk + @gemwallet/api** — XRPL wallets (connect + sign in-browser, no server key).
- **@tanstack/react-query 5** for all async/chain reads.
- **Tailwind CSS 4** (`@tailwindcss/postcss`) — single **light theme**, no dark mode
  (tokens in `src/app/globals.css`).
- **framer-motion 12** (page/entrance motion) + **gsap 3.15** (toggle, nav indicator,
  drawer, button micro-interactions). `lucide-react` icons, `react-qr-code`.

## Run
- `npm run dev` → dev server on **http://localhost:3000** (webpack: `next dev --webpack`).
- `npm run build` (`next build --webpack`) · `npm start` · `npm run lint` (eslint 9).
- Package manager: **bun** (`bun.lock`) or npm (`package-lock.json`) both present.
- Needs a running backend executor (default `http://localhost:8787`) for the XRPL mint,
  pre-flight, Guardian, and at-risk endpoints. EVM reads/writes work without it.

## Layout (`src/`)
- `app/` — App Router routes + root `layout.tsx` + `globals.css`. See `app/CLAUDE.md`.
- `components/` — UI primitives + feature components. See `components/CLAUDE.md`.
- `hooks/` — chain-read/write + XRPL React hooks. See `hooks/CLAUDE.md`.
- `lib/` — ABIs, backend API client, XRPL wallet abstraction, pure math/format. See `lib/CLAUDE.md`.
- `config/` — chain constants, branch registry, AppKit/wagmi setup. See `config/CLAUDE.md`.
- `context/` — provider tree (wagmi, Query, XRPL wallet, branch, drawer). See `context/CLAUDE.md`.
- `stubs/empty.ts` — empty module aliased over optional x402/Base-Account deps the
  wagmi/AppKit graph pulls but Vulcra never uses (see `next.config.ts`).

## Core architecture ideas
- **Two independent wallets, side by side.** EVM (AppKit/wagmi, Coston2) and XRPL
  (Crossmark/GemWallet) connect separately and can both be live at once. Both drivers
  live in the wallet drawer (`components/shell/WalletSidebar.tsx`).
- **EVM writes vs XRPL 0xFE payments.** FXRP/wFLR branches use direct `VaultManager`
  writes via wagmi (`useVaultAction`). The XRP-Ledger path instead has the backend build
  ONE signed XRPL Payment carrying a `0xFE` custom-instruction memo — verbatim, no
  destination tag — for every action (open / deposit / withdraw / borrow / repay / rate / close).
- **Multi-collateral branches** (`config/branches.ts`): a branch = one deployed VaultManager
  instance + its collateral token + FTSO feed. Same ABI across branches; only the address
  differs. Selected branch is app-wide context, persisted to localStorage.
- **No mocks, no fabricated numbers.** Every figure is a live Coston2/XRPL read; unresolved
  values render `"—"`. Unconfigured branches render an honest "not configured / coming soon".
- **Contract is the authority.** Flare system addresses resolve at runtime via
  `FlareContractRegistry`; Vulcra addresses come from `NEXT_PUBLIC_*` env with committed
  Coston2 fallbacks. Never hardcode a Flare system address (registry is the one exception).

## Security
- Secrets/config live ONLY in gitignored `.env*` files (`.gitignore` ignores `.env*`).
  Never commit real values; `.env.example` documents the keys.
- Never commit `references/` or `VULCRA_PRD.md`.
- The frontend NEVER builds the 0xFE memo or holds a signing key — the backend owns the
  memo; XRPL wallets sign in-browser.
