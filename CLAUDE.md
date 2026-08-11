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

### ⚠️ CURRENT STATUS (12 Aug 2026) — XRPL-native `_data` path blocked by the FAssets v1.3 redeploy

Verified E2E on Coston2 (see `docs/diagnosis/callfailed-openvault.md` for the full fact chain):

- **FDC works** (attestation submitted → proof retrieved; the old 401 is gone).
- **Every XRPL-native op that carries a userOp `_data` currently REVERTS** — both `net-mint>0`
  (open/borrow) **and** `net-mint=0` (repay/close/adjust/spDeposit). Inner revert is
  `CallFailed(uint256=1, bytes=0x)` = the committed `Call[]` execution returns empty data.
- **Vulcra's own contracts are PROVEN CORRECT**: an `anvil` fork of live Coston2 opens a vault fine
  when `Zap.openVaultAndForward(...)` is called directly (transferFrom → vUSD mint → `VaultOpened`,
  570k gas). The empty revert is **not** in Vulcra code.
- **Root cause = FAssets v1.3** (the Coston2 redeploy). `executeDirectMintingWithData(proof, _data)`
  now mints FXRP to a NEW `SmartAccountManager` (`IMemoInstructionsFacet`) and calls
  `handleMintedFAssets(..., memoData, executor, fullData)`; that v1.3 contract executes the userOp.
  Our 42-byte 0xFE memo layout matches v1.3 (`UserOpCustomInstruction`: opcode / walletId /
  executorFeeUBA(8) / hash(32)), so the break is in how the v1.3 SmartAccountManager runs the
  `_data` (PackedUserOperation) — the whole 0xFE custom-instruction-with-data execution changed.
- **Fix direction (off-chain only, no Vulcra contract change):** migrate `packages/userop` +
  `apps/executor` mint/manage flow to the v1.3 `IMemoInstructionsFacet` / `@flarenetwork/smart-accounts-encoder`
  `_data` + executor-binding format, then re-run a ≤0.1 FXRP E2E (Coston2 direct-minting caps: 0.1
  FXRP/hr, 0.5/day, large-mint delay >0.1). Needs the deployed `SmartAccountManager` `_data` spec.
- **Unaffected & demoable now:** the EVM open/manage path, Earn, redemption UI, the Vulcra MCP
  server (returns unsigned payloads), and all test suites (forge 171 · backend 151 · FE build ·
  Playwright 23).

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
