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
├── Dockerfile                      # reproducible enclave image (entry ./cmd/extension)
├── config/proxy/  *.toml.example   # ext-proxy template (real .toml is gitignored)
├── config/docker/ docker-compose.vulcra.coston2.yaml  # overlay for the scaffold stack
├── scripts/       reproducible-build.sh
└── docs/          attestation-evidence.md, e2e-coston2-2026-07-22.md,
                   fcc-production-registration.md
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

The template follows the schema `tee-proxy` v0.0.18 actually parses:
`[db]` keys are `database` / `username` / `password` (not `name` / `user`), and
`[ports]` holds the **container** ports (`internal = 6663`, `external = 6664`).
Docker publishes those on the **host** as `6673 -> 6663` and `6674 -> 6664`, so
the public tunnel targets **host port 6674**.

> **Reachability (re-verified 2026-07-25):** the admin-provisioned Coston2
> indexer DB accepts connections + MySQL auth from this network and is fully
> caught up with the chain. TCP connect ≈ 0.2–0.4 s, MySQL ping 0.86–1.22 s,
> `SELECT 1` ≈ 0.23 s, server `8.0.44-google`, `last_database_block ==
> last_chain_block == 33 232 404` against a live head of 33 232 407 (lag ≈ 3
> blocks) — see [docs/e2e-coston2-2026-07-22.md](docs/e2e-coston2-2026-07-22.md)
> for the original run. The shared DB is connection-capped: intermittent
> `connection refused`/timeouts happen and retries succeed. A persistent refusal
> means the **route to the indexer is down** (VPN/allowlist), not a config error.

## Deploy lifecycle (Coston2, simulated attestation)

Mode: `SIMULATED_TEE=true`, `LOCAL_MODE=false` (real Coston2 chain, simulated
attestation — the judge-approved posture for the hackathon).

The lifecycle scripts (`pre-build.sh`, `start-services.sh`, `post-build.sh`) and
the `tools/` binaries they call live in Flare's
[`fce-extension-scaffold`](https://github.com/flare-foundation/fce-extension-scaffold),
**not** in this repo. This repo supplies the payload: the enclave `Dockerfile`,
`contracts/VulcraInstructionSender.sol`, and the compose overlay in
`config/docker/`.

```bash
# in an fce-extension-scaffold checkout, with this repo's .env + proxy .toml copied in:
./scripts/pre-build.sh          # deploy VulcraInstructionSender, register extension → EXTENSION_ID
docker compose -f docker-compose.yaml -f docker-compose.coston2.yaml \
  -f "$VULCRA_EXT_DIR/config/docker/docker-compose.vulcra.coston2.yaml" up -d --build
./scripts/post-build.sh         # allow-tee-version → set-governance → register-tee (rap)
```

> **`FlareTeeManager` was redeployed on 2026-07-22** to
> `0x1a9C4A0f9D76c0b1D91d22E24E573a9b377618aE`; the old
> `0x004224faB7BF19a1a67Ee5AF87Cb2b0F0925d41F` has no bytecode any more. The
> address is config-driven — it comes from the scaffold's
> `config/coston2/deployed-addresses.json`, never from `tee-node`. `tee-node`
> must also be current (this repo pins the `20260722` develop commit) or every
> data-provider vote in the availability check is rejected.

**The full, verbatim, ordered procedure — prerequisites, the named-tunnel
requirement, governance, and the `getTeeMachineStatus == 2` verification — is
[`docs/fcc-production-registration.md`](docs/fcc-production-registration.md).**

Verify the deploy: `curl -s "$EXT_PROXY_URL/info" | jq '.machineData'` — see
`docs/attestation-evidence.md`.

## Attestation / Bounty 2

See [`docs/attestation-evidence.md`](docs/attestation-evidence.md): reproducible
Go build → deterministic code hash → on-chain whitelisting → `/info` machineData
verification, with a "verify it yourself" section. No secrets.
