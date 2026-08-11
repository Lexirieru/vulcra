# Vulcra frontend — Playwright E2E

End-to-end coverage for the wallet-gated dApp (Next.js 16, App Router). The
suite drives real routes in Chromium and asserts structure + graceful states, so
it is resilient to the live Coston2 RPC / backend indexer being slow or partially
unavailable.

## Prerequisites

1. **Install deps** (the PM runs installs — do not run these yourself in a
   worker): `@playwright/test` is in `devDependencies`.
2. **Install the browser binary** (one-time): `npx playwright install chromium`
3. **Start the dev server yourself on :3000** — the suite does NOT start it
   (no `webServer` in `playwright.config.ts`), because the app needs the repo
   `.env` (`NEXT_PUBLIC_*`) and outbound Coston2 RPC that only your shell has:

   ```bash
   npm run dev        # http://localhost:3000
   ```

## Run

```bash
npm run e2e            # headless, all specs
npm run e2e:ui         # Playwright UI mode (pick/inspect tests)
npm run e2e:report     # open the last HTML report
```

Point at a non-default origin with `E2E_BASE_URL` (e.g. a preview deploy).

## What's covered

| Spec | Coverage |
| --- | --- |
| `routes.spec.ts` | All **13 routes** (`/`, `/borrow`, `/borrow/xrp`, `/borrow/fxrp`, `/borrow/wflr`, `/earn`, `/earn/fxrp`, `/earn/wflr`, `/guardian`, `/incentives`, `/liquidations`, `/redeem`, `/xrpl`) return **HTTP 200**, mount the app shell, and raise **no uncaught pageerror** and **no hydration mismatch**. |
| `earn.spec.ts` | `/earn` list renders **both pool rows** (FXRP, wFLR) with **TVL/APR** columns and links to `/earn/[branch]`; row click navigates. `/earn/[branch]` detail renders the **stat bar** (Pool TVL / APR / Your deposit), **How it works**, and the **deposit panel**. |
| `borrow.spec.ts` | `/borrow/fxrp` renders the collateral→loan→interest composer; entering collateral surfaces a **"Max"** borrow value (live FTSO chain); the **CTA shows a not-ready reason and never "Open vault"** while the loan is empty; the collateral selector switches asset **without navigating**. |
| `xrpl-wallet.spec.ts` | Injecting the XRPL wallet `localStorage` for an r-address; the injected key hydrates the connection; a **placeholder r-address with no vault → no `XrplVaultBanner`** (graceful) with the page intact; baseline (no wallet) and non-XRPL branch (`/borrow/wflr`) also show no banner. |

Shared helpers live in `e2e/support.ts` (page-error / hydration probes, the
route list, and the wallet injector). Selectors are resilient
(`getByRole` / `getByText` / `getByLabel`), not brittle CSS.

## Wallet-injection approach

The dApp has **two** wallets. Only one is forgeable headlessly:

- **XRPL wallet (Crossmark / GemWallet)** — the connection is a plain
  `(providerId, address)` pair persisted under `localStorage["vulcra:xrpl-wallet"]`
  as `{"providerId":"crossmark","address":"<r-address>"}`. `useXrplWallet()`
  rehydrates from it **after mount**. We inject it via
  `context.addInitScript(...)` (see `injectXrplWallet` in `support.ts`) so it is
  present **before** app scripts run and every navigation comes up "connected".

## Known limitations

- **EVM wallet (Reown / wagmi) cannot be injected.** Its session lives in the
  WalletConnect relay + IndexedDB behind a signing handshake, so there is no
  localStorage shortcut. Consequently, states gated on `useAccount().address`
  are **not** reachable headlessly:
  - the **full set of dynamic CTA reasons** on `/borrow/[collateral]`
    ("Enter a loan amount", "Enter a collateral amount", "Not enough FXRP",
    "Adjust the loan amount", "Approve FXRP", "Open vault"). Without an EVM
    wallet the CTA is the wallet gate ("Connect wallet to borrow"). The spec
    therefore asserts the deterministic invariant — with an empty loan the CTA
    is **never** the ready-state "Open vault" — which holds in both worlds.
  - EVM vault management (PositionCard / VaultActions), on-chain writes, and the
    connected-EVM branch of `XrplVaultBanner`.
  To exercise those, add a wallet-mock fixture (inject a fake EIP-1193 provider
  on `window.ethereum` + a wagmi mock connector) or run against a wallet
  extension in a persistent context — out of scope for this suite.
- **`XrplVaultBanner` positive case** (banner *shown*) needs an r-address whose
  Flare PersonalAccount actually owns a vault on Coston2, plus a reachable
  backend `/account/:xrplAddress`. With a placeholder address we assert the
  negative/graceful path. To cover the positive case, inject a **real** funded
  r-address (env-provided) once one exists.
- **Live-value assertions** (TVL/APR numbers, the "Max" mint) depend on the dev
  server reaching Coston2 RPC. The suite asserts labels/structure everywhere and
  only asserts a concrete numeric affordance for "Max" (with a generous
  timeout); if RPC is unreachable that single check will flake — start the dev
  server with a working `NEXT_PUBLIC_*` RPC.
