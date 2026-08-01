# src/context — provider tree + shared UI state

React context providers, all `"use client"`. Composed in `layout.tsx` as
`ContextProvider → BranchProvider → AppShell`, with the XRPL wallet and drawer providers
nested inside `ContextProvider`.

## `index.tsx` — `ContextProvider` (the root client tree)
Wraps: `WagmiProvider → QueryClientProvider → XrplWalletProvider → WalletUiProvider`.
- `createAppKit(...)` runs ONCE at module scope (light theme, brand-pink accent, analytics off).
- Hydrates wagmi from the SSR `cookies` prop (`cookieToInitialState`) — no hydration mismatch.
- `reconnectOnMount={false}` on purpose: the mount-time EVM reconnect is what triggers the
  MetaMask/Rabby `window.ethereum` conflict rejection; EVM users click connect once per
  session instead. A module-scope, capture-phase listener also swallows ONLY the benign
  "MetaMask not found" unhandled rejection (so Next's dev overlay doesn't hijack the screen);
  every other error still surfaces.
- **Two wallets live side by side** here: EVM (wagmi/AppKit, Coston2) and XRPL
  (`XrplWalletProvider`) — independent, both connectable at once.

## `xrpl.tsx` — `XrplWalletProvider` / `useXrplWalletContext()`
Instantiates `useXrplWallet()` **exactly once** and shares it app-wide, so connecting in the
wallet drawer and signing in the mint flow are ONE connection (single source of truth).
Behaviour (Crossmark/GemWallet connect + sign, 0xFE memo preserved verbatim) is unchanged —
this only lifts where the state lives. Throws if used outside the provider.

## `branch.tsx` — `BranchProvider` / `useBranch()`
The selected collateral branch (`fxrp`/`wflr`), shared app-wide and persisted to
localStorage (`vulcra.branch`). Read via `useSyncExternalStore` so SSR and first client
render both use `DEFAULT_BRANCH` (no hydration mismatch, no setState-in-effect). Exposes
`{ branchKey, branch, setBranchKey }`; `setBranchKey` persists and dispatches a
`vulcra:branch-change` event so all consumers update.

## `wallet-ui.tsx` — `WalletUiProvider` / `useWalletUi()`
Open/close state for the right-side wallet drawer, lifted out of `AppShell` so ANY surface
can raise it (e.g. the XRP-Ledger flow's "Open wallets"). Auto-closes on route change via a
render-phase setState (only the state owner may do this). Exposes
`{ walletsOpen, openWallets, closeWallets }`.

## Conventions & gotchas
- Each `use*()` accessor throws outside its provider — mount order in `ContextProvider` matters.
- Branch selection is context + localStorage, NOT the URL; `/borrow/[collateral]` seeds from
  the URL then syncs the context for the other branch-scoped routes.
- Don't call `useXrplWallet()` directly anywhere else — go through `useXrplWalletContext()`.

## Security
State/UI only — no secrets. XRPL signing happens in the wallet; the backend owns the 0xFE
memo. Never commit `references/` or `VULCRA_PRD.md`.
