# Vulcra — Flare Summer Signal submission

> **Bring XRP straight from the XRP Ledger, borrow a stablecoin on Flare — in one payment, with no Flare wallet and no FLR gas.**

A multi-collateral CDP stablecoin (**vUSD**) on **Flare Coston2** (chain 114). XRP holders supply
XRP from the XRP Ledger, it becomes **FXRP** on Flare through **FAssets**, and they borrow vUSD —
the whole vault lifecycle rides **one signed XRPL Payment**. Liquity-V2 mechanics: borrowers set
their own interest rate and redemptions hit the lowest rate first.

- **Repo:** https://github.com/Lexirieru/vulcra
- **Explorer:** https://coston2-explorer.flare.network
- **Live entry point:** frontend `/borrow/xrp` (Crossmark) — everything runs against real Coston2.

---

## Selected bounties

| Bounty | Fit | Where it lives |
|---|---|---|
| **Bounty 1 — Interoperable Asset Products** *(primary)* | XRP → FXRP (FAssets) → vUSD CDP, driven cross-chain by a single XRPL payment via Flare Smart Accounts + FDC. An interoperable asset product in the literal sense: the collateral never leaves the user's XRPL control model, yet earns/borrows on Flare. | `smartcontract/`, `backend/apps/executor`, `backend/packages/userop`, `frontend/` |
| **Bounty 2 — Confidential Compute** *(secondary)* | **TEE Guardian** — an opt-in liquidation-protection keeper whose private trigger thresholds are submitted once over TLS into a **Flare Confidential Compute (FCC)** enclave, registered on-chain to **PRODUCTION** status. Protection rules are never front-runnable. | `backend/tee-extension/` |

---

## Product description

Vulcra is a **multi-collateral CDP** that issues one shared stablecoin, **vUSD**, isolated per
collateral market — each market has its own `VaultManager`, price oracle, and Stability Pool,
sharing only vUSD. It runs the **Liquity V2** model: borrowers **choose their own annual interest
rate**, and redemptions are ordered **by rate, lowest first**, so a higher rate buys a place further
back in the redemption queue.

What makes Vulcra different is the **XRPL-native path**: the user never touches a Flare wallet, never
holds FLR for gas, and never manually mints or approves FXRP. They sign **one Payment** on the XRP
Ledger; Flare does the rest, atomically, on-chain.

## Target user

- **The XRP holder who wants a dollar loan against XRP without becoming an EVM power user.** Today
  that requires an EVM wallet, gas funding, a bridge/mint step, an approval, and babysitting a second
  wallet on a second chain. Vulcra collapses all of that into one Crossmark signature.
- **vUSD Earn depositors** who want a rate-based reward stream while backstopping liquidations.
- **AI agents / automated treasuries** that read positions and drive vault management through the
  **Vulcra MCP server** (`backend/apps/mcp`) — a zero-custody Model Context Protocol server whose
  intent tools return unsigned XRPL payments the user signs (it never holds a key).

---

## How it uses Flare — six primitives, concretely

Vulcra is built on **six** distinct Flare primitives. None are mocked; all resolve through the live
`FlareContractRegistry` (`0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019`) or verified Coston2 addresses.

1. **FAssets — FXRP.** The collateral asset is FXRP, minted/redeemed against real XRP through
   `AssetManagerFXRP` (`0xc1Ca88b937d0b528842F95d5731ffB586f4fbDFA`). Vulcra's FXRP market accepts
   FXRP directly as CDP collateral (6 decimals). The FAssets Core Vault XRPL address
   (`rDhpmiPq4BVBDWMVdSrmkgt8thKyRzGV1p`) is the destination the user pays on the XRP Ledger.

2. **Flare Smart Accounts / 0xFE direct-minting.** The user's XRPL key controls a `PersonalAccount`
   on Flare via `MasterAccountController`. The 42-byte memo on the XRPL Payment commits
   `keccak256(PackedUserOperation)`. When settled, FAssets `executeDirectMintingWithData(...)` mints
   the net FXRP **and** runs `PersonalAccount.executeUserOp(Call[])` in the **same atomic transaction**
   — so an XRP holder opens/manages a vault with **no EVM wallet and no FLR gas**. This is the core
   interoperability mechanism.

3. **FDC — Flare Data Connector.** The executor does not trust the client's claim that an XRPL
   payment happened; it requests an **`XRPPayment` attestation** from the FDC and waits for the Merkle
   proof (retrying through XRPL indexing lag) before it will submit the direct mint. Proof-not-trust
   is what makes the cross-chain step safe. (`backend/apps/executor/src/attestation`.)

4. **FTSOv2 — price feeds.** Each market's `PriceOracle` reads **FTSOv2 block-latency feeds**
   (FXRP → `XRP/USD`, wFLR → `FLR/USD`). Collateral ratios, max-LTV enforcement, and redemption math
   all settle on live FTSOv2 prices; stale prices don't settle.

5. **FCC / TEE Guardian — Confidential Compute.** The opt-in Guardian runs inside a Flare
   Confidential Compute enclave (`backend/tee-extension`). Its TEE machine is registered on-chain to
   **status 2 = PRODUCTION** on the `FlareTeeManager`
   (`0x1a9C4A0f9D76c0b1D91d22E24E573a9b377618aE`), teeId
   `0xEAAEF13871e71db24FC47e7c76Be8a925057caa6`, extension `65701`, reached through the on-chain
   `InstructionSender` (`0x978Ad6Ae225BEA5745a7fb87A66BC7a57FA7c555`). Private trigger thresholds
   live only inside the enclave, so protection rules can't be front-run.

6. **Flare as the execution/settlement layer.** vUSD, the `VaultManager`s, Zap, and Stability Pools
   are all deployed and verified on **Coston2 (114)** and read/settle against the above Flare
   services — a full application, not a demo stub.

---

## What we newly built / ported / integrated during the hackathon

**Newly built (ours, from scratch):**
- **Liquity-V2 multi-collateral CDP core** — `VaultManager` (per-user vault accounting, user-set
  interest rate accrual on-chain, by-rate redemption "lowest first"), `PriceOracle` (FTSOv2 adapter),
  `VulcraZap` (atomic open+forward), and the shared **vUSD** token. UUPS + AccessControl.
- **Per-branch `StabilityPool`** (UUPS proxy, shared implementation) with a **rate-based vUSD reward
  stream**; each branch routes its `interestReceiver` to its pool. Seeded live and **upgraded live**
  via `upgradeToAndCall` as an on-chain UUPS rehearsal.
- **Executor** (`backend/apps/executor`, Fastify + viem): builds the 0xFE plan, drives FDC
  attestation with indexing-lag retry, and submits `executeDirectMintingWithData`.
- **`packages/userop`**: 0xFE memo encoding + `PackedUserOperation` build/hash + the vault call
  batches (open / add / withdraw / mint-more / repay / adjust-rate / close).
- **Indexer** (`backend/apps/indexer`, SQLite): exposes `/branches`, `/vaults/:branch/:owner`,
  `/vaults/at-risk`, `/vaults/redemption-queue`.
- **TEE Guardian** (`backend/tee-extension`, Go): confidential liquidation-protection keeper +
  `VulcraInstructionSender.sol`, with the `ShouldRepay` protection-window logic.
- **Frontend** (Next.js 16): EVM borrow (FXRP/wFLR), XRPL-native XRP borrow, unified manage panels,
  Earn, live FTSO prices, and a mint tracker.

**Ported / integrated (Flare building blocks we wired in, not mocked):**
- FAssets `AssetManagerFXRP` direct-minting-with-data path.
- Flare Smart Accounts (`MasterAccountController` / `PersonalAccount`) for the XRPL-controlled account.
- FDC `XRPPayment` attestation request + Merkle-proof verification flow.
- FTSOv2 feed consumption via the `FlareContractRegistry`.
- FCC scaffold → registered a PRODUCTION TEE machine on the Coston2 `FlareTeeManager`.

**Key insight we implemented:** *0xFE is a general arbitrary-call instruction, not just a mint.* So
the **entire** vault lifecycle (open / supply / borrow-more / repay / withdraw / adjust-rate / close)
is driven from the XRP Ledger with **zero smart-contract changes** — `net-mint > 0` mints FXRP and
opens/adds; `net-mint = 0` is a fees-only "memo-only" payment that still runs the committed calls.

---

## Verified Coston2 contract addresses

Network: **Coston2**, chainId **114**, explorer `https://coston2-explorer.flare.network`.
Deployment source of truth: [`smartcontract/deployments/coston2.json`](../../smartcontract/deployments/coston2.json).

### Shared

| Contract | Address |
|---|---|
| **vUSD** (shared stablecoin) | `0x333FDCf66792122e80654E197Eb6Fa3705f1B6D8` |
| **StabilityPool implementation** (shared, UUPS) | `0xAfC0d66405CB687c9208534f2c086d402A0172f7` |

### FXRP market (XRPL-native)

| Component | Address / value |
|---|---|
| Collateral token (FXRP, 6 dec) | `0x0b6A3645c240605887a5532109323A3E12273dc7` |
| **VaultManager (FXRP)** | `0x93e572cDbfb62557E041B53490e5208C147b5388` |
| **VulcraZap** (atomic open+forward) | `0xCe4f886e67dE51418751314eEb19aC2D75B59dfE` |
| **StabilityPool (FXRP)** | `0xfA2dCc4B93909ACc1dd6b2e92178D04cD1D851E4` |
| PriceOracle (`XRP/USD`) | `0x63Bf4a9d716Ce16C0E091EF9C3281f44829f953B` |
| Interest bounds | min 50 bps · max 25000 bps · default 500 bps |

### wFLR market

| Component | Address / value |
|---|---|
| Collateral token (wFLR / WNat, 18 dec) | `0xC67DCE33D7A8efA5FfEB961899C73fe01bCe9273` |
| **VaultManager (wFLR)** | `0x1F079F205ca2857a3A199937Ace956ed51B0b3b8` |
| **StabilityPool (wFLR)** | `0xB963D913CFb4688634184aB7b22e554B34557e07` |
| PriceOracle (`FLR/USD`) | `0x914cd3509727afeED74267FDF5c9E7f1fB4453Df` |
| Interest bounds | min 50 bps · max 25000 bps · default 800 bps |

### Flare system contracts we build on (not ours)

| Contract | Address |
|---|---|
| FlareContractRegistry | `0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019` |
| AssetManagerFXRP (FAssets) | `0xc1Ca88b937d0b528842F95d5731ffB586f4fbDFA` |
| WNat | `0xC67DCE33D7A8efA5FfEB961899C73fe01bCe9273` |
| FAssets Core Vault (XRPL direct-minting address) | `rDhpmiPq4BVBDWMVdSrmkgt8thKyRzGV1p` |

### TEE Guardian / FCC (Bounty 2)

| Field | Value |
|---|---|
| FlareTeeManager | `0x1a9C4A0f9D76c0b1D91d22E24E573a9b377618aE` |
| teeId | `0xEAAEF13871e71db24FC47e7c76Be8a925057caa6` |
| status | **2 — PRODUCTION** |
| extensionId | `65701` |
| VulcraInstructionSender | `0x978Ad6Ae225BEA5745a7fb87A66BC7a57FA7c555` |
| TEE version | `v0.1.0` |

> Verify any of the above with `cast call` against `https://coston2-api.flare.network/ext/C/rpc`, or
> click through on the explorer. On-chain receipts for the full XRPL-native lifecycle
> (supply / borrow-more / withdraw / adjust-rate / close) are linked in the repo root `README.md`.

---

## Risk parameters (live on Coston2)

| Parameter | Value |
|---|---|
| Min collateral ratio (MCR) | **130%** (≈ 76.9% max LTV) |
| Interest rate | **user-set**, 0.5%–250% (default 5% FXRP / 8% wFLR) |
| Redemption order | **by interest rate — lowest first** |
| Prices | **FTSOv2 block-latency feeds**; stale prices don't settle |

Stability Pools seeded live: FXRP 3.2M vUSD deposit / 58k reward / 60d (~11.02% APR at seed);
wFLR 850k vUSD deposit / 21k reward / 60d (~15.02% APR at seed).

---

## Roadmap / next steps

- **More FAssets collateral:** FBTC and additional FAssets as isolated markets (the architecture is
  branch-per-collateral, so new markets don't put existing ones at risk). `stXRP` on the roadmap.
- **Real Confidential Space attestation:** move the Guardian from the judge-approved Coston2
  simulated-attestation posture (`SIMULATED_TEE=true`) to a measured code-hash on a real GCP
  Confidential Space VM (`SIMULATED_TEE=false`), matching `scripts/reproducible-build.sh`.
- **Agent-native management (MCP):** the **Vulcra MCP server** (`backend/apps/mcp`, `@vulcra/mcp`) is
  built — a zero-custody stdio server whose read tools query Coston2 + the indexer and whose intent
  tools return **unsigned** XRPL payments the user signs in their own wallet (it holds no keys).
  Roadmap: delegated/policy-bounded auto-management and richer agent quoting.
- **Mainnet:** promote the Coston2 deployment to Flare/Songbird mainnet once FAssets FXRP is live
  there, with real minDebt and full risk parameters.
- **Redemption + liquidation UX polish** and a public analytics indexer.

---

## Judging-criteria map

| Criterion | Where it's demonstrated in this submission |
|---|---|
| **Product usefulness** | *Product description* + *Target user* — a real, painful UX problem (borrow against XRP without becoming an EVM power user) solved by one signature; Earn + agent management extend the audience. |
| **Flare integration quality** | *How it uses Flare — six primitives* + *Verified Coston2 addresses* — six distinct Flare primitives (FAssets, Smart Accounts/0xFE, FDC, FTSOv2, FCC/TEE, Flare settlement), all live and resolved through the registry, no mocks. |
| **Technical execution** | *Verified addresses* (deployed + verified, live-seeded Stability Pools, live UUPS upgrade rehearsal, PRODUCTION-status TEE) + [`architecture.md`](architecture.md) — a full atomic cross-chain flow, not a stub. |
| **Evidence of new work** | *What we newly built / ported / integrated* — an explicit split of from-scratch code vs integrated Flare building blocks, plus the 0xFE "one primitive, whole lifecycle" insight and on-chain lifecycle receipts. |
| **Clarity & future potential** | This document + [`architecture.md`](architecture.md) + [`demo-script.md`](demo-script.md) + *Roadmap* — concrete diagrams, a 3-minute demo, and a credible expansion path (more FAssets markets, real attestation, agent-native, mainnet). |
