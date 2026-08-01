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
