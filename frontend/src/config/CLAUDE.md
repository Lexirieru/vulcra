# src/config — chain constants, branch registry, AppKit/wagmi setup

Static configuration: the Coston2 chain + system-contract entry point, the multi-collateral
branch registry, and the AppKit/wagmi adapter. Everything is env-driven
(`NEXT_PUBLIC_*`) with committed Coston2 fallbacks.

## `contracts.ts`
- `COSTON2_CHAIN_ID = 114`.
- `FLARE_CONTRACT_REGISTRY_ADDRESS` — the ONE hardcoded system address allowed (same on
  every Flare network). Every other Flare system contract is resolved through it at runtime.
- `CONTRACT_NAMES` — registry names (`FtsoV2`, `AssetManagerFXRP`, `MasterAccountController`).
- `XRP_USD_FEED_ID`, optional Vulcra address overrides, `API_BASE_URL`
  (`NEXT_PUBLIC_API_BASE_URL`, default `http://localhost:8787`, prod `https://api.vulcra.xyz`), and
  `GUARDIAN_API_URL` (`NEXT_PUBLIC_GUARDIAN_API_URL`, the separate Guardian keeper, prod
  `https://tee.vulcra.xyz`; falls back to `API_BASE_URL`).

## `branches.ts` — multi-collateral registry
- `BranchKey = "fxrp" | "wflr"`; `BRANCHES`, `BRANCH_ORDER`, `DEFAULT_BRANCH = "fxrp"`,
  `isBranchKey()`. A branch = one deployed **VaultManager** instance + collateral token +
  FTSO feed; the VaultManager ABI is identical across branches (contract is authority).
- Each `CollateralBranch` carries: `collateralSymbol`/`Decimals` (FXRP 6, wFLR 18),
  `feedId`/`feedLabel`, `hasXrplMint` (FXRP only), `wrapNative` (wFLR — obtained via
  `WNat.deposit`), `vaultManager`, `stabilityPool` (blank → "coming soon"), `zap`
  (VulcraZap 0xFE helper), `collateralToken` or `collateralRegistryName` (wFLR resolves
  "WNat" at runtime — no hardcode), and `interest` bounds (fallback; contract getters win).
- Addresses come from `NEXT_PUBLIC_VAULT_MANAGER_FXRP` / `_WFLR` / `_STABILITY_POOL_*` /
  `_ZAP_FXRP` / `_COLLATERAL_TOKEN_*` (legacy `_VAULT_MANAGER_ADDRESS` still honored as the
  FXRP fallback), each with a documented V2 Coston2 default baked in. A blank `vaultManager`
  → the UI shows a "not configured" state. stXRP/sFLR are roadmap ("Soon"), not in `BRANCHES`.

## `index.ts` — AppKit + wagmi
- **No `"use client"`** — imported by both the server layout and the client provider, so the
  `WagmiAdapter` is built once at module scope. SSR-safe: `ssr: true` + `cookieStorage`.
- Exports `coston2` (= AppKit `flareTestnet`), `networks` (Coston2 only), `projectId`
  (`NEXT_PUBLIC_REOWN_PROJECT_ID`, falls back to a public localhost id — replace in prod),
  `isPlaceholderProjectId`, `metadata`, `wagmiAdapter`, `wagmiConfig`. `createAppKit` itself
  is called in `context/index.tsx` (light theme, brand-pink accent).

## Conventions & gotchas
- `env(k)` trims and treats empty as unset; a Vulcra address is only "configured" when non-blank.
- Feed ids are verified Coston2 bytes21 values — re-confirm at dev.flare.network before any mainnet cutover.
- Never hardcode a Flare **system** address other than the registry.
- `NEXT_PUBLIC_*` values are exposed to the browser at build time — only public data belongs here.

## Security
The committed defaults are public testnet addresses/ids. Real production ids (Reown project
id) and any private URLs live ONLY in gitignored `.env*`; `.env.example` documents the keys.
Never commit `references/` or `VULCRA_PRD.md`.
