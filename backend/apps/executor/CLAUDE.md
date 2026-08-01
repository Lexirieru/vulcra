# apps/executor — Fastify API for XRPL-native minting & vault management

The service the frontend talks to (`:8787`). Chain-dependent work is injected as **services** so the
routing/validation layer is unit-testable via `fastify.inject` without a live chain (the real Flare
integration is never mocked in production).

## Routes (`src/server.ts`)

| Route | Purpose |
|---|---|
| `GET /health` | liveness |
| `GET /account/:xrplAddress` | resolve PersonalAccount + nonce for the r-address |
| `POST /mint/preflight` | limits/fees check before building |
| `POST /mint/build` | build the ONE XRPL payment to OPEN a vault (collateral6, mint18, rate) |
| `POST /manage/build` | build a manage op: `repay` / `mintMore` / `addCollateral` / `withdrawCollateral` / `close` / `adjustRate` |
| `POST /mint/submit` | intake a signed XRPL txId → kicks off attestation→execute |
| `GET /mint/status/:id` | state machine: INTAKE→ATTEST_REQUESTED→PROOF_READY→EXECUTING→EXECUTED (+ DELAYED / REVERTED / REJECTED) |
| `GET/POST /guardian/rules` | Guardian protection rules (submitted to the TEE) |

## Key files (`src/`)

- `server.ts` — routes + validation + CORS; `ExecutorServices` interface (all chain work injected).
- `mintBuilder.ts` — build the open-vault plan (Core Vault dest, memo, amount, userOp).
- `manageBuilder.ts` — `buildManagePlan(...)`: builds the memo-only/net>0 manage ops via `@vulcra/userop` call batches; reads live vault debt for `close`, resolves fees.
- `services.ts` / `main.ts` — wire the real chain client + dotenv (absolute path) + start.
- `liveProcessor.ts` — the attestation→`executeDirectMintingWithData` pipeline (FDC retry on indexing lag; recovery via MasterAccountController).
- `orchestrator/` — mint intake + durable store (dedup by xrplTxId).
- `preflight/` — mint limit/fee checks.
- `test/` — `fastify.inject` unit tests with a mocked services object.

## Gotchas

- `ManageAction` = `"repay" | "close" | "adjustRate" | "mintMore" | "addCollateral" | "withdrawCollateral"`.
- `addCollateral` is net>0 (mint-priced payment); every other manage action is net-0 (fees only).
- Re-submitting the same `xrplTxId` returns status without re-attesting (`alreadyKnown` guard).

## 🔒 Security
Keys / seeds / DB creds only in gitignored `backend/.env`. Never commit `.env`, `references/`, or `VULCRA_PRD.md`.
