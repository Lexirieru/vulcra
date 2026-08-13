# Vulcra — repo context for Claude

XRPL-native, multi-collateral **CDP stablecoin** (`vUSD`) on **Flare Coston2 testnet (chain 114)**.
Headline: supply XRP straight from the XRP Ledger as collateral — it becomes FXRP on Flare via
FAssets — and borrow vUSD in **one signed XRPL payment**, with no Flare wallet and no FLR gas.
Liquity-V2 model: borrowers set their own interest rate; redemptions hit the lowest rate first.

> Each top-level module has its own `CLAUDE.md` with deeper detail — read the relevant one when you
> work there: [`backend/`](backend/CLAUDE.md) · [`frontend/`](frontend/CLAUDE.md) ·
> [`smartcontract/`](smartcontract/CLAUDE.md) · [`landingpage/`](landingpage/CLAUDE.md).

## Monorepo layout

| Folder | What it is | Runs on |
|---|---|---|
| `smartcontract/` | Solidity + Foundry. VaultManager, VulcraZap, PriceOracle, StabilityPool (UUPS), vUSD, by-rate redemption. **Already deployed & live on Coston2.** | — |
| `backend/` | Node + `tsx` workspace. `apps/executor` (Fastify API), `packages/userop` (0xFE memo + userOp), `packages/chain-client`, `packages/interfaces`, `tee-extension` (Go Guardian TEE). | executor `:8787` |
| `frontend/` | Next.js 16 dApp — borrow (EVM + XRPL-native), earn, redeem, guardian, liquidations. | `:3000` |
| `landingpage/` | Marketing/landing experience (separate app). | its own dev server |

## 🚀 Live in production (deployed 13 Aug 2026)

The full stack runs on real domains — verified end-to-end from the browser:

| Service | URL | Host | Source |
|---|---|---|---|
| Landing | `https://vulcra.xyz` | Vercel | `landingpage/` |
| dApp | `https://app.vulcra.xyz` | Vercel | `frontend/` |
| Executor API | `https://api.vulcra.xyz` (`/health`) | Railway (root `backend/`, nixpacks) | `backend/apps/executor` |
| Guardian TEE | `https://tee.vulcra.xyz` (`/health`) | Railway (root `backend/tee-extension`, Dockerfile via `railway.json`) | `backend/tee-extension/tools/cmd/guardian-service` |
| Vault indexer | Goldsky subgraph `vulcra-vaults-fxrp` (public GraphQL) | Goldsky | `frontend/src/graphql/` |

- **FE env** (Vercel): `NEXT_PUBLIC_API_BASE_URL=https://api.vulcra.xyz`, `NEXT_PUBLIC_GUARDIAN_API_URL=https://tee.vulcra.xyz`. Goldsky URL is a committed public default in `frontend/src/graphql/subgraphs.ts`.
- **CORS**: `FRONTEND_ORIGIN=https://app.vulcra.xyz` on both Railway services.
- **Liquidations**: at-risk vaults come from the Goldsky subgraph (fold events → current-state, CR via live FTSO), REST `/vaults/at-risk` as fallback.
- **Guardian**: `guardian-service` = TEE node (sim) + keeper in-process + REST `/guardian/rules` + watch loop. FE calls it via `GUARDIAN_API_URL`.
- Deploy notes / envs live in `frontend/.env.example`, `backend/.env.example`, and the guardian-service `README.md`. Push to `main` → Vercel + Railway auto-redeploy.

## The core idea — the 0xFE custom instruction

XRPL-native minting rides Flare's **0xFE direct-minting custom instruction** through **Flare Smart
Accounts**. The user's XRPL key controls a `PersonalAccount` on Flare. A 42-byte memo on the XRPL
Payment commits `keccak256(PackedUserOperation)`; the executor proves the payment with the **FDC**
(Flare Data Connector) and calls `AssetManagerFXRP.executeDirectMintingWithData(proof, data)`, which
mints the net FXRP **and** runs the committed `Call[]` from the PersonalAccount **atomically**.

- **net-mint > 0** → XRP carries collateral, FXRP is minted, calls open a vault / add collateral.
- **net-mint = 0** → fees-only "memo-only" payment; no FXRP minted, but the calls still run
  (borrow-more, repay, withdraw, adjust-rate, close).

So the whole vault lifecycle is one primitive — the frontend's XRPL manage panel mirrors the EVM one
(Deposit / Withdraw / Borrow / Repay / Interest / Close), each tab a different `Call[]` behind one
XRPL payment. **No contract changes are needed to manage a vault from the XRP Ledger.**

### ✅ RESOLVED (12 Aug 2026) — XRPL-native openVault via 0xFE works end-to-end on live Coston2

Proven on-chain: tx [`0xc6f4b988…6fb8e391`](https://coston2-explorer.flare.network/tx/0xc6f4b9881aed9c287df83de2ca3f317d9d48f20a298e9ab09f461eee6fb8e391)
(status 1, 25 logs incl. `VaultManager` + vUSD mint + `MasterAccountController.UserOperationExecuted`).
`getVault(PA 0x6f6639…e3d4)` on VaultManager FXRP = **active, 0.08 FXRP collateral, 0.05025 vUSD debt,
5% p.a.** One signed XRPL Payment (r-address `rHS3D3…moog`) → FDC proof → `executeDirectMintingWithData`
minted FXRP **and** ran the committed `[FXRP.approve(zap), zap.openVaultAndForward(...)]` batch atomically.

- **Our 0xFE encoding was correct all along — NOT a v1.3 break.** `packages/userop/packedUserOp.ts`
  is byte-for-byte identical to the `flare-viem-starter@c13a046` `PACKED_USER_OPERATION_TUPLE`
  (9-field packed, single-tuple `encodeAbiParameters`, `keccak256(_data)` in the 42-byte memo).
  attestationType = `XRPPayment` ✓, proofOwner = executor EOA ✓. (Flare admin confirmed the reference
  0xFE flow runs clean on live Coston2 and v1.3 did not touch that path; a revert at Call index 1
  itself proves hash-match, decode, sender/nonce, and the index-0 approve all succeeded.)
- **The earlier persistent revert was transient**, not a code bug: the *exact* reverting calldata that
  failed 57× in the E2E later passed `cast call` (eth_call) + `cast estimate` (1.19M gas) cleanly, then
  the mined submit succeeded. Most likely FDC proof finality relative to when we mined.
- **Correction:** Coston2 direct-minting caps are ~100k FXRP/hr, 500k/day (the earlier "0.1 FXRP/hr"
  was a `formatUnits` misread). Our mint was 0.08 FXRP.

**Robustness (Flare-admin guidance) — IMPLEMENTED & verified:**
- **balanceOf-at-execution ✅** — the Zap has `openVaultAndForwardAll(mint18, rate, dest, hints)` which
  reads `FXRP.balanceOf(msg.sender)` at execution instead of a baked-in collateral amount (the 0xFE memo
  commits `keccak256(userOp)` *before* the mint, so any amount is only a prediction of net-after-fees).
  Mint batch is now `[FXRP.approve(zap, MAX_UINT256), zap.openVaultAndForwardAll(...)]`. Shipped as a UUPS
  upgrade (proxy `0xCe4f886e…` unchanged, impl `0xb2ade4c5…`).
- **carrier-mint ✅** — net-mint=0 manage ops (repay/close/adjust/withdraw/spDeposit) ride a small carrier
  mint (`CARRIER_NET_MINT_DROPS` in `manageBuilder.ts`) so they aren't fee-only (which can't run the
  instruction on-chain). The mechanism is verified live (adjustRate 5%→6%). The *minimal* carrier size is
  being tuned: `mintedToSAM = netMint + executorFee` suggests any netMint>0 clears the SAM gate, but on
  Coston2 a ~0.001 XRP carrier reverted (persistent, not transient), so FAssets enforces a higher
  effective minimum — keep the carrier at a value proven on-chain. One mechanism for the whole lifecycle.
- **Still predicted (future work):** `addCollateral` goes straight to the VaultManager, not the Zap, so
  it can't use the Zap's balance-read; a `VaultManager.addCollateralFor(owner, …)` would be needed. Exact
  below 40 XRP (flat min-fee regime), so safe for the demo.
- Vaults are owned by the **PersonalAccount**; drive all downstream ops from the PA.

**Alignment audit (Flare Foundation repos):** core paths are byte-for-byte aligned — smart-accounts 0xFE
(`flare-smart-accounts@fa301c5`), FAssets direct-minting (`fassets@6d5c103`), FDC `XRPPayment`
attestation + periphery (`flare-foundry-starter` / `flare-viem-starter@c13a046`), and the FCC extension
(`fce-extension-scaffold`, manager `0x1a9C4A…`). FDC protocol id is read live from
`FdcVerification.fdcProtocolId()` (fallback 200). Coston2 direct-minting caps: 100k XRP/hr, 500k/day,
uncapped `mintingCap` (the "0.1 XRP" figures are fees, not caps).

**RPC:** Coston2 reads/writes go through a viem `fallback` transport — thirdweb's Coston2 endpoint
(`flare-testnet-coston2.rpc.thirdweb.com`, faster + more concurrency-tolerant than the shared Flare
public RPC) primary, Flare public backup. Set in `frontend/src/config/index.ts` (`WagmiAdapter`
transports) and `backend/packages/chain-client/src/clients.ts` (`coston2Transport`); override the
primary with `NEXT_PUBLIC_COSTON2_RPC_URL` / `COSTON2_RPC_URL`.

Full fact chain: `docs/diagnosis/callfailed-openvault.md`. Also solid: EVM open/manage, Earn, redemption
UI, the Vulcra MCP server, and all test suites (forge 177 · backend green · FE build · Playwright 25).

## Live on Coston2 (chain 114 · https://coston2-explorer.flare.network)

Authoritative address list: `smartcontract/deployments/coston2.json`. Key ones:
- vUSD `0x333FDCf66792122e80654E197Eb6Fa3705f1B6D8`
- VaultManager FXRP `0x93e572cDbfb62557E041B53490e5208C147b5388` · wFLR `0x1F079F205ca2857a3A199937Ace956ed51B0b3b8`
- FlareContractRegistry `0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019` · AssetManagerFXRP `0xc1Ca88b937d0b528842F95d5731ffB586f4fbDFA`
- RPC `https://coston2-api.flare.network/ext/C/rpc` · FAssets Core Vault (XRPL) `rDhpmiPq4BVBDWMVdSrmkgt8thKyRzGV1p`

The full XRPL manage lifecycle (supply / borrow / withdraw / adjust-rate / close) was proven end-to-end
on-chain **before the FAssets v1.3 redeploy** (receipts in the root `README.md`). It is currently
blocked by that redeploy — see the ⚠️ status box above. The EVM path is unaffected.

## Run the stack

```bash
# contracts are already live on Coston2 (addresses above)
cd smartcontract && forge build && forge test          # rebuild/test only
cd ../backend && npm install && npm -w apps/executor start   # executor :8787 (needs backend/.env)
cd ../frontend && npm install && npm run dev                 # dApp :3000 → /borrow/xrp
```
Node ≥ 22, TypeScript run directly via `tsx` (no build step) on the backend. Frontend is Next.js 16.

## Conventions

- **Language when replying to the user: Bahasa Indonesia.** Code identifiers/comments stay in English.
- End commit messages with: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Frontend is a **single light theme** (no dark mode by design). Tailwind + a hand-rolled UI kit.
- Verify FE changes by **rendering headless** (puppeteer-core drives Google Chrome) before claiming
  done — the Claude-in-Chrome extension is not connected here. To reach a has-vault state without a
  wallet, open `/borrow/xrp`, click "paste an r-address", and paste `TEST_XRPL_ADDRESS` (in
  `backend/.env`); its PersonalAccount has a live vault on Coston2.

## 🔒 Security — do not violate

- **Never commit** `.env` files, the `references/` folder, or `VULCRA_PRD.md`. Secrets (executor /
  deployer / admin keys, XRPL seeds, FCC indexer DB creds) live ONLY in gitignored `.env` files.
- When committing, stage ONLY `backend/` and `frontend/` (and docs you intend), then sanity-check:
  `git diff --cached --name-only | grep -iE "\.env|VULCRA_PRD|references/|\.mjs|\.mts"` must return nothing.
- Test scripts (`.mjs`/`.mts`) and screenshots live in the scratchpad, never in the repo.
- The FCC indexer DB creds are SHARED Flare-admin hackathon infra — fine to use, still gitignored.
- Commit/push only when the user asks.

## Context / hackathon

Built for the Flare hackathon (FAssets · XRPL-native DeFi track). Bounty 1 = the XRPL-native CDP;
stretch = the TEE Guardian (opt-in confidential auto-repay).
