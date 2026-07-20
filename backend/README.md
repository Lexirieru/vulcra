# Vulcra Backend

Deterministic (no-LLM) backend for **Vulcra** — a CDP stablecoin on Flare Coston2.
Turns an XRPL payment into an on-chain vUSD mint, indexes vault state, and runs a
confidential liquidation keeper + Vault Guardian inside a Flare Confidential
Compute (FCC) TEE.

Implements master requirements **R10–R16** (backend side). Plan:
`backend/docs/plans/2026-07-20-001-feat-vulcra-backend-plan.md`.

> **Smart contracts are the interface authority.** The TypeScript ABIs in
> `packages/interfaces` are aligned to
> `smartcontract/docs/plans/2026-07-20-001-feat-vulcra-smartcontract-plan.md`:
> vault identity is the **owner address** (one vault per address), the Zap entry
> is `openVaultAndForward`, and `delegatedRepay` lives on `VaultManager`
> (there is no separate Guardian contract — the Guardian's encrypted rule stays
> inside the TEE and the repay calls `VaultManager.delegatedRepay`).

## Layout

```
backend/
├── packages/
│   ├── interfaces/     # VaultManager / VulcraZap / ERC20 ABIs + shared types
│   ├── userop/         # 0xFE 42-byte memo + PackedUserOperation hash (frontend depends on this)
│   └── chain-client/   # FlareContractRegistry resolution, FTSOv2, decimal normalization
├── apps/
│   ├── executor/       # pre-flight, FDC attestation, mint state machine, recovery, HTTP API
│   └── indexer/        # VaultManager events -> SQLite; at-risk read API
└── tee-extension/      # Go FCC extension: liquidation keeper + Vault Guardian (Bounty 2)
```

## Requirements

- **Node >= 22** (Node 24 recommended — uses the built-in `node:sqlite`).
- **Go >= 1.24** for `tee-extension` (built with Go 1.25).

## Install & test

```bash
cd backend
npm install
npm test            # all workspaces  (101 unit tests)
npm run typecheck   # all workspaces

# Go TEE extension — pure logic is offline-testable:
cd tee-extension
GOPROXY=off go test ./internal/keeper/... ./internal/guardian/...
```

`npm -w packages/userop test`, `npm -w apps/executor test`, etc. run a single
workspace.

## Run (development)

```bash
npm -w apps/executor start   # HTTP API on :8787 (pre-flight + intake + status)
npm -w apps/indexer start    # HTTP API on :8788 (vault reads)
```

Both boot in a **degraded/read-only mode** if the contract addresses / keys below
are absent, so the frontend can develop against the API before the contracts are
deployed. Live on-chain steps are **gated** (fail-fast with a clear message),
never mocked.

## Environment variables

Copy `.env.example` to `.env` (gitignored) and fill in. **Never commit real values.**

### Public / safe defaults (already in `.env.example`)

| Var | Purpose |
|-----|---------|
| `COSTON2_RPC_URL` | Coston2 RPC (default `https://coston2-api.flare.network/ext/C/rpc`) |
| `COSTON2_CHAIN_ID` | `114` |
| `FLARE_CONTRACT_REGISTRY` | Registry (the only hardcoded system address) |
| `EXECUTOR_PORT` / `INDEXER_PORT` | HTTP ports (`8787` / `8788`) |
| `FTSO_MAX_STALENESS_SECONDS` | Price staleness bound (`120`) |
| `WALLET_ID` | Smart-account wallet id in the memo (`0`) |

### From the smartcontract deploy (needed for pre-flight + indexing)

| Var | Purpose |
|-----|---------|
| `VAULT_MANAGER_ADDRESS` | Vulcra VaultManager (pre-flight params, indexer events) |
| `VULCRA_ZAP_ADDRESS` | Zap target for the userOp |
| `VUSD_ADDRESS` / `PRICE_ORACLE_ADDRESS` | vUSD token / oracle |

### Gated secrets — required only for LIVE mint execution (fail-fast if missing)

| Var | Purpose | Provided by |
|-----|---------|-------------|
| `EXECUTOR_PRIVATE_KEY` | Funded Coston2 EOA that pays gas + FDC fees and calls `executeDirectMintingWithData` | **user** (fund via the Coston2 faucet) |
| `SERVICE_XRPL_SEED` | Service XRPL wallet for service-initiated `0xE0` recovery | **user** |
| `VERIFIER_URL_TESTNET` + `VERIFIER_API_KEY_TESTNET` | FDC XRPPayment verifier | **user** (Flare verifier) |
| `COSTON2_DA_LAYER_URL` | FDC DA-layer proof endpoint | **user** |

Also install `@flarenetwork/flare-wagmi-periphery-package` to enable the live
`executeDirectMintingWithData` submit (it supplies the typed `IXRPPayment.Proof`
ABI; hand-writing it risks a proof-tuple drift that reverts every mint).

### FCC / TEE extension (Bounty 2)

Real FCC indexer-DB credentials are **provisioned out-of-repo** and injected via
env only — never committed. See `tee-extension/.env.example` and
`tee-extension/config/proxy/extension_proxy.coston2.docker.toml.example`. The real
`.env` and `config/proxy/*.toml` are gitignored.

| Var | Purpose |
|-----|---------|
| `FCC_INDEXER_DB_HOST/PORT/NAME/USER/PASSWORD` | Coston2 indexer DB the ext-proxy reads |
| `FCC_TEE_PROXY_URL` | `https://tee-proxy-coston2-1.flare.rocks` |

> **Indexer DB reachability:** the Coston2 indexer DB (host/port from the
> out-of-repo FCC env) is **IP-allowlisted** — from an unlisted host the TCP connect times out
> (`connection refused / timeout = route down`). This does not block development:
> the keeper/Guardian pure logic is offline-tested, and `SIMULATED_TEE=true`
> against live Coston2 is the accepted dev path. Ask Flare support to allowlist
> the deploy host before running the ext-proxy live.

See `tee-extension/README.md` and `tee-extension/docs/attestation-evidence.md`
for the FCC deploy lifecycle and the reproducible-build / code-hash attestation
story.

## Security

- All secrets are env-injected; `.gitignore` blocks `.env*` (except `.env.example`),
  `config/proxy/*.toml` (except `*.example`), and `*.sqlite`.
- Nothing on the Flare integration path is mocked — addresses resolve through
  `FlareContractRegistry` at runtime.
- The single `0xFE` memo encoder in `packages/userop` is golden-vector-locked so a
  one-byte encoding regression fails the test suite loudly.
