# Vulcra TEE Extension (Go / Flare Confidential Compute)

Confidential **liquidation keeper** (U11/U12) and **Vault Guardian** (U13) for
Vulcra, built on the [fce-extension-scaffold](https://github.com/flare-foundation/fce-extension-scaffold)
pattern (GCP Confidential Space / AMD SEV). One Go TEE extension, two
responsibilities, plus the reproducible-build attestation evidence (U14) for
Bounty 2.

- **Keeper (KEEPER/SCAN):** scan candidate under-collateralized vaults, re-read
  authoritative state (`getVault` + FTSO price) **inside the enclave**, and
  `liquidate(vaultOwner)` any vault strictly below MCR via the TEE keeper wallet.
- **Guardian (GUARDIAN/REGISTER, GUARDIAN/EVALUATE):** users register **private**
  protection rules (ECIES-encrypted to the extension key). The rule (trigger CR,
  max repay) is decrypted and stored **only in enclave memory**, keyed by a
  `termsCommitment` (keccak256). Nothing about the rule is on-chain. When a
  vault's CR falls below its private trigger but is still above MCR, the enclave
  calls `VaultManager.delegatedRepay(vaultOwner, amount)` (gated to
  `GUARDIAN_EXECUTOR_ROLE`, held by the TEE keeper wallet). **There is no
  separate guardian contract.**

## Layout

```
backend/tee-extension/
├── go.mod                          # module github.com/vulcra/tee-extension (framework deps pinned)
├── internal/
│   ├── keeper/    decide.go        # Liquidatable / ComputeCRBps — PURE, offline-tested
│   ├── guardian/  rules.go eval.go # Rule store + ShouldRepay + local keccak256 — PURE, offline-tested
│   ├── config/    config.go        # OP identifiers, env wiring (stdlib only)
│   ├── chain/     client.go        # authoritative Coston2 reads: getVault + FTSO via registry
│   └── extension/ extension.go     # POST /action server + OPType/OPCommand router
├── cmd/extension/ main.go          # entry point (extension server + optional tee-node sidecar)
├── tools/cmd/e2e-live/             # live Coston2 E2E driver (framework wire format, dry-run)
├── pkg/types/     types.go register.go  # request/response DTOs (stdlib json)
├── contracts/     VulcraInstructionSender.sol
├── config/proxy/  *.toml.example   # ext-proxy template (real .toml is gitignored)
├── scripts/       reproducible-build.sh
└── docs/          attestation-evidence.md, e2e-coston2-2026-07-22.md
```

**The `internal/keeper` and `internal/guardian` packages are dependency-free**
(Go stdlib only, including a self-contained Keccak-256) so their decision logic
tests run OFFLINE. The framework wiring (`internal/extension`, `internal/chain`,
`cmd/extension`, `tools/`) uses the same modules as fce-extension-scaffold —
`go-flare-common` (instruction encoding), `tee-node` (Action types, ToHash,
/decrypt wire types, server bootstrap) and `go-ethereum` — pinned in `go.mod`.

## Build & test

Full build (fetches the pinned framework modules once):

```bash
cd backend/tee-extension
go build ./...
```

Offline pure-logic tests (no network, no module downloads):

```bash
GOPROXY=off go test ./internal/keeper/... ./internal/guardian/...
# also offline-buildable:
GOPROXY=off go build ./internal/keeper/... ./internal/guardian/... ./internal/config/... ./pkg/...
```

Reproducible build (deterministic code hash — verified: two runs, same SHA-256):

```bash
SOURCE_DATE_EPOCH="$(git log -1 --format=%ct)" ./scripts/reproducible-build.sh
```

Live Coston2 E2E (dry-run, submits no transactions; see
[docs/e2e-coston2-2026-07-22.md](docs/e2e-coston2-2026-07-22.md) for the
recorded evidence):

```bash
set -a; source .env; set +a
go run ./tools/cmd/e2e-live
```

## Decision logic (must match the smart-contract interface)

- Vault identity = **owner address** (one vault per address):
  `getVault(address owner) -> (uint256 collateral6, uint256 debt18, bool active)`.
- `liquidate(address vaultOwner)` — permissionless.
- `delegatedRepay(address vaultOwner, uint256 maxAmount)` on **VaultManager**,
  gated to `GUARDIAN_EXECUTOR_ROLE`.
- Params: MCR = 13000 bps (130%), FXRP = 6 decimals, vUSD = 18 decimals.
- `collateralValueUsd18 = collateral6 * xrpUsdPrice18 / 1e6`;
  `CR(bps) = collateralValueUsd18 * 10000 / debt18`. All math in `math/big`.
- **Liquidatable** iff CR **strictly** below MCR; exactly at MCR is safe; zero
  debt or a zero/stale authoritative price → not liquidatable (KTD5).
- **Guardian repay** iff `mcr < currentCR < trigger`; amount =
  `min(maxRepay18, debt*(trigger-currentCR)/trigger)`.

## OP identifiers (three-layer contract — must match exactly)

| OPType     | OPCommand  | Solidity                                | Go config              |
| ---------- | ---------- | --------------------------------------- | ---------------------- |
| `KEEPER`   | `SCAN`     | `bytes32("KEEPER")` / `bytes32("SCAN")` | `OPTypeKeeper` / `OPCommandScan` |
| `GUARDIAN` | `REGISTER` | `bytes32("GUARDIAN")` / `bytes32("REGISTER")` | `OPTypeGuardian` / `OPCommandRegister` |
| `GUARDIAN` | `EVALUATE` | `bytes32("GUARDIAN")` / `bytes32("EVALUATE")` | `OPTypeGuardian` / `OPCommandEvaluate` |

## Environment

Copy `.env.example` → `.env` and fill. **Real FCC indexer DB credentials and the
proxy URL come from the out-of-repo, gitignored `vulcra-fcc.env`** — never paste
secrets into a committed file. Every Flare address is resolved at runtime via the
`FlareContractRegistry` (`0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019` on Coston2)
or via env after deploy; nothing else is hardcoded.

**Live execution is gated:** `liquidate` / `delegatedRepay` require
`VAULT_MANAGER_ADDRESS` and a funded `KEEPER_TEE_ADDRESS` holding
`GUARDIAN_EXECUTOR_ROLE`. With those unset, the extension still computes
decisions but does not submit transactions (`config.CanExecuteOnChain` gate).
Nothing is mocked.

## Proxy config (secrets)

```bash
cp config/proxy/extension_proxy.coston2.docker.toml.example \
   config/proxy/extension_proxy.coston2.docker.toml   # this real file is GITIGNORED
# fill the [db] block from vulcra-fcc.env (FCC_INDEXER_DB_*)
```

> **Reachability (verified 2026-07-22):** the admin-provisioned Coston2 indexer
> DB accepts connections + MySQL auth from this network and is fully caught up
> with the chain (lag ≈ 3 blocks) — see
> [docs/e2e-coston2-2026-07-22.md](docs/e2e-coston2-2026-07-22.md). The shared
> DB is connection-capped: intermittent `connection refused`/timeouts happen and
> retries succeed. A persistent refusal means the **route to the indexer is
> down** (VPN/allowlist), not a config error.

## Dev deploy lifecycle (Coston2, simulated attestation)

Dev mode: `SIMULATED_TEE=true`, `LOCAL_MODE=false` (real Coston2 chain).

```bash
./scripts/use-chain.sh local coston2 go   # activate: SIMULATED_TEE=true, LOCAL_MODE=false
# reserve a public HTTPS tunnel to port 6674 (ngrok/cloudflared); set EXT_PROXY_URL
./scripts/pre-build.sh                     # deploy VulcraInstructionSender, register extension
./scripts/start-services.sh               # redis + ext-proxy + extension-tee
./scripts/post-build.sh                   # allow-tee-version + register-tee -command rRap
./scripts/test.sh                          # end-to-end round trip
```

Verify the deploy: `curl -s "$EXT_PROXY_URL/info" | jq '.machineData'` — see
`docs/attestation-evidence.md`.

## Attestation / Bounty 2

See [`docs/attestation-evidence.md`](docs/attestation-evidence.md): reproducible
Go build → deterministic code hash → on-chain whitelisting → `/info` machineData
verification, with a "verify it yourself" section. No secrets.
