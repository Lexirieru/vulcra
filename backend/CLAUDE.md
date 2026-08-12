# backend/ — executor, userOp packages, Guardian TEE

Node + `tsx` **npm workspace** (`packages/*` + `apps/*`) that turns a signed XRPL Payment into an
on-chain FXRP mint + vault operation on Flare Coston2, and hosts the confidential Guardian keeper.
No build step — TypeScript runs directly via `tsx`. **Node ≥ 22.**

## Layout

| Path | Role | Its own CLAUDE.md |
|---|---|---|
| `apps/executor/` | Fastify HTTP API (`:8787`): build / submit / track mints + manage ops, FDC attestation, `executeDirectMintingWithData`. | [`apps/executor/CLAUDE.md`](apps/executor/CLAUDE.md) |
| `apps/indexer/` | (scaffold) event/at-risk indexer (R19); the `/vaults/at-risk` endpoint the FE calls. | — |
| `packages/userop/` | The 0xFE core: memo + `PackedUserOperation` + vault call batches. | [`packages/userop/CLAUDE.md`](packages/userop/CLAUDE.md) |
| `packages/chain-client/` | Resolve Flare system contracts via `FlareContractRegistry`. | [`packages/chain-client/CLAUDE.md`](packages/chain-client/CLAUDE.md) |
| `packages/interfaces/` | Shared viem ABIs (VaultManager, Zap, ERC-20, PersonalAccount). | [`packages/interfaces/CLAUDE.md`](packages/interfaces/CLAUDE.md) |
| `tee-extension/` | Go — Guardian confidential keeper (TEE). | [`tee-extension/CLAUDE.md`](tee-extension/CLAUDE.md) |
| `docs/` | FDC/TEE run-books + E2E evidence. | — |

## Run

```bash
npm install
npm -w apps/executor start          # Fastify on :8787 — needs backend/.env
npm -w apps/executor test           # unit tests (fastify.inject, no live chain)
```
`apps/executor/src/main.ts` loads `backend/.env` by absolute path (workspace scripts run from the
workspace dir, so a relative dotenv path misses it). With a funded key + FDC/FTSO env present, the
executor logs `live mint pipeline ENABLED`; without it, mints queue with a clear gated status.

## How a mint/manage flows (mental model)

1. FE calls `POST /mint/build` (open) or `POST /manage/build` (supply/withdraw/borrow/repay/rate/close)
   → executor returns an XRPL Payment (Core Vault destination, drops, **0xFE memo**, and the
   `PackedUserOperation` bytes). Client never builds the memo.
2. User signs the Payment in Crossmark; FE calls `POST /mint/submit` with the XRPL tx hash.
3. Executor requests an **FDC XRPPayment attestation** (retries on verifier indexing lag ~1-3 min),
   then calls `AssetManagerFXRP.executeDirectMintingWithData(proof, data)` → FXRP minted **and** the
   userOp runs from the PersonalAccount, atomically. FE polls `GET /mint/status/:id`.

**net-mint = 0** = fees-only "memo-only" op (no FXRP minted); **net-mint > 0** mints FXRP. Same path.

### ✅ RESOLVED (12 Aug 2026) — Step 3 works end-to-end on live Coston2

XRPL-native openVault via 0xFE is proven on-chain: tx `0xc6f4b988…6fb8e391` (status 1), vault active
(0.08 FXRP / 0.05025 vUSD / 5% p.a.) for PA `0x6f6639…e3d4`. Our `packages/userop` encoding was
**correct all along** — byte-for-byte identical to `flare-viem-starter@c13a046`'s
`PACKED_USER_OPERATION_TUPLE` (9-field packed, single-tuple param, `keccak256(_data)` in the memo);
attestationType `XRPPayment`, proofOwner = executor EOA. The earlier persistent revert was **transient**
(the exact reverting calldata later passed `cast call` + `cast estimate` and the mined submit succeeded),
not a v1.3 `_data` incompatibility. NO contract or encoding change was needed.

**Robustness (Flare-admin guidance) — IMPLEMENTED:**
- **balanceOf-at-execution ✅** — `packages/userop` `buildZapMintCalls` now emits
  `[FXRP.approve(zap, MAX_UINT256), zap.openVaultAndForwardAll(mint18, rate, dest, hints)]`; the Zap reads
  `FXRP.balanceOf(msg.sender)` at execution rather than a baked `collateral6` (UUPS upgrade, impl
  `0xb2ade4c5…`). `collateral6` stays only to size the XRP payment (`computeRequiredXrpDrops`).
- **carrier-mint ✅** — `manageBuilder.ts` gives net-0 ops a small `CARRIER_NET_MINT_DROPS` so they aren't
  fee-only. Mechanism verified live (adjustRate); minimal size is being tuned on-chain (a ~0.001 XRP
  carrier persistently reverted, so FAssets enforces a higher effective minimum than the fee floor).
- **FDC hardening ✅** — `attestation/fdc.ts` reads the protocol id from `FdcVerification.fdcProtocolId()`
  (fallback 200) and no longer falls back to the raw `response_hex` blob for the proof.
- **Still predicted (future work):** `addCollateral` calls the VaultManager directly (not the Zap), so it
  keeps a predicted amount until a `VaultManager.addCollateralFor` exists. Exact below 40 XRP.
- `submitDirectMinting` retries on tx revert across the FDC finality window (no operator step needed).

Full analysis + source refs: root `docs/diagnosis/callfailed-openvault.md`.

## Gotchas

- A repeated `/mint/submit` for the same txId must NOT re-attest (nonce collision strands the mint) —
  the store dedups by `xrplTxId` (`alreadyKnown` guard).
- `isTransactionIdUsed` reads `MasterAccountController`, not `AssetManager` (the latter reverts
  `FunctionNotFound`).
- CORS allowlist (localhost:3000/3210) lives in `apps/executor/src/server.ts`.

## 🔒 Security

Executor/deployer/admin keys, XRPL seeds, and the FCC indexer DB creds live ONLY in gitignored
`.env` files — **never commit them**. Test scripts (`.mjs`/`.mts`) belong in the scratchpad, not the
repo. Never commit `references/` or `VULCRA_PRD.md`. The FCC DB creds are shared Flare-admin hackathon
infra (fine to use, still gitignored).
