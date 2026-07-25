# FCC PRODUCTION registration run book — Vulcra TEE extension on Coston2

Ordered, verbatim steps to take the Vulcra confidential extension (liquidation
keeper + Vault Guardian) from source to a TEE machine whose on-chain status is
**PRODUCTION** on the **redeployed** Flare TEE manager.

**No secrets in this file.** Every credential lives in the gitignored `.env` /
`config/proxy/*.toml` (templates: `*.example`).

---

## 0. What changed on 2026-07-22 (read this first)

Flare **redeployed** the FCC contracts on Coston2. The diamond that owns every
TEE facet moved:

| | Address | State (verified 2026-07-25) |
|---|---|---|
| **NEW** `FlareTeeManager` | `0x1a9C4A0f9D76c0b1D91d22E24E573a9b377618aE` | **LIVE** — has bytecode; `getTeeMachineStatus(address(0))` reverts `TeeNotFound()` (`0xceb05b68`), i.e. the MachineManager facet is wired |
| **OLD** `FlareTeeManager` | `0x004224faB7BF19a1a67Ee5AF87Cb2b0F0925d41F` | **DEAD** — `eth_getCode` returns `0x`; every call reverts / `FunctionNotFound` |

Reproduce both checks:

```bash
cast code 0x1a9C4A0f9D76c0b1D91d22E24E573a9b377618aE --rpc-url https://coston2-api.flare.network/ext/C/rpc | head -c 20; echo
cast code 0x004224faB7BF19a1a67Ee5AF87Cb2b0F0925d41F --rpc-url https://coston2-api.flare.network/ext/C/rpc
cast call 0x1a9C4A0f9D76c0b1D91d22E24E573a9b377618aE \
  "getTeeMachineStatus(address)(uint8)" 0x0000000000000000000000000000000000000000 \
  --rpc-url https://coston2-api.flare.network/ext/C/rpc
# expected: execution reverted, data: "0xceb05b68"  == TeeNotFound()
```

Two consequences:

1. **The manager address is config-driven, not code-driven.** `tee-node` never
   touches the chain — it only talks to the ext-proxy. The manager address is
   read exclusively by the scaffold's `tools/` binaries from the
   `"FlareTeeManager"` entry of `config/coston2/deployed-addresses.json`
   (`tools/pkg/support` binds *every* TEE facet — MachineManager,
   ExtensionManager, OwnerAllowlist — to that one diamond address). The
   ext-proxy TOML does **not** carry it.
2. **`tee-node` must be current.** The `20260722` commit changed the
   data-provider weight check in `pkg/processorutils/thresholds.go`
   (`if weight <= dpThreshold` → `if dpThreshold > 0 && weight <= dpThreshold`,
   plus removal of the `Wallet/KeyDataProviderRestore` zero-threshold special
   case). An older node rejects votes that the current providers cast, the
   availability check never accrues weight, and the machine never leaves
   REGISTERED. This repo now pins
   `github.com/flare-foundation/tee-node v0.0.23-0.20260722073401-c687a8631bca`
   (develop `c687a8631bca239a6188fccc3469f3a676aa48eb`).

---

## 1. Prerequisites

### 1.1 Tooling

```bash
go version          # >= 1.25.1
forge --version     # Foundry — compiles VulcraInstructionSender.sol
jq --version        # ABI/BIN extraction in generate-bindings.sh
docker --version    # builds + runs redis / ext-proxy / extension-tee
cast --version      # on-chain verification
```

### 1.2 A funded Coston2 key — **you must supply this**

`pre-build.sh` deploys a contract and sends several registration transactions;
`post-build.sh` sends more. The deployer needs C2FLR.

- Faucet: <https://faucet.flare.network/coston2>
- The scaffold's pre-flight enforces a minimum balance (`validate.KeyHasFunds`)
  and aborts before spending anything if it is short.

```bash
# derive + check the address of the key you are about to use
cast wallet address --private-key 0x<YOUR_KEY>
cast balance <THAT_ADDRESS> --rpc-url https://coston2-api.flare.network/ext/C/rpc --ether
```

### 1.3 A **named** public HTTPS tunnel — **you must supply this**

The URL you register is written **on-chain** in the TEE machine record, and
Flare's data providers call it to deliver cosigned responses. It must be
**stable**: an ephemeral `trycloudflare.com` URL or a rotating free ngrok URL
dies on every restart, and when it does the on-chain URL points at nothing —
the availability check fails and the machine never reaches (or silently drops
out of) PRODUCTION.

The tunnel targets the ext-proxy's **host** port **6674**.

> Port map, so it is unambiguous: the proxy TOML's `[ports]` are *container*
> ports (`internal = 6663`, `external = 6664`). `docker-compose.yaml` publishes
> them on the host as `6673 -> 6663` and `6674 -> 6664`. **Tunnel to host 6674.**

Option A — cloudflared **named** tunnel (stable hostname on your own domain):

```bash
cloudflared tunnel login
cloudflared tunnel create vulcra-fcc
cloudflared tunnel route dns vulcra-fcc fcc.<your-domain>
cloudflared tunnel run --url http://localhost:6674 vulcra-fcc
# => https://fcc.<your-domain>
```

Option B — ngrok **reserved** domain (paid tier; free URLs rotate):

```bash
ngrok config add-authtoken <YOUR_TOKEN>
ngrok http 6674 --domain=vulcra-fcc.ngrok.app
# => https://vulcra-fcc.ngrok.app
```

Leave the tunnel running for the whole procedure **and afterwards** — the
machine stays PRODUCTION only while it is reachable.

### 1.4 FCC indexer DB credentials

Shared Flare hackathon infrastructure. Already filled into the gitignored
`config/proxy/extension_proxy.coston2.docker.toml`. Verified reachable
2026-07-25: TCP connect ≈ 0.2–0.4 s, MySQL ping 0.86–1.22 s, `SELECT 1` ≈ 0.23 s,
server `8.0.44-google`, `last_database_block == last_chain_block == 33232404`
against a live head of `33232407` (lag ≈ 3 blocks).

```bash
set -a; source "$VULCRA_EXT_DIR/.env"; set +a   # host/user/password stay out of git
nc -vz "$FCC_INDEXER_DB_HOST" "$FCC_INDEXER_DB_PORT"
```

The DB is connection-capped: an intermittent `connection refused` is
route/limit pressure, not a config error — retry. A *persistent* refusal means
the route is down.

---

## 2. Build the FCC workspace

The registration lifecycle (`pre-build.sh`, `start-services.sh`,
`post-build.sh`, and the `tools/` binaries they call) lives in Flare's
`fce-extension-scaffold`, not in this repo. Clone it next to this repo and
overlay Vulcra's payload.

```bash
export VULCRA_EXT_DIR="$(git rev-parse --show-toplevel)/backend/tee-extension"
export FCC_WORKSPACE="$HOME/fcc-workspace"

mkdir -p "$FCC_WORKSPACE" && cd "$FCC_WORKSPACE"
git clone https://github.com/flare-foundation/fce-extension-scaffold
cd fce-extension-scaffold
git checkout 3d0d8f2babde42298c934b15ebf4d4398eb52efe   # main @ 2026-07-22, post-redeploy
```

**Assert the address book carries the NEW manager before spending any gas:**

```bash
jq -r '.[] | select(.name=="FlareTeeManager") | .address' config/coston2/deployed-addresses.json
# MUST print: 0x1a9C4A0f9D76c0b1D91d22E24E573a9b377618aE
```

If it prints `0x004224fa…`, the checkout predates the redeploy — `git pull` or
patch that one entry. Everything downstream (extension registration, TEE
registration, `toProduction`) targets whatever this field says.

---

## 3. Overlay the Vulcra payload

Three surgical edits. The scaffold's own Go module and `tools/` module stay
untouched, so nothing has to be re-tidied.

### 3.1 The on-chain entry point → `VulcraInstructionSender`

```bash
cd "$FCC_WORKSPACE/fce-extension-scaffold"
cp "$VULCRA_EXT_DIR/contracts/VulcraInstructionSender.sol" contracts/InstructionSender.sol
# our file declares both registry interfaces inline, so the scaffold's copies are
# now dead weight — remove them to keep `forge build` output unambiguous
rm -f contracts/interfaces/ITeeExtensionRegistry.sol contracts/interfaces/ITeeMachineRegistry.sol
```

`generate-bindings.sh` greps for `contract <CONTRACT_NAME>` in
`contracts/InstructionSender.sol` and reads
`out/InstructionSender.sol/<CONTRACT_NAME>.json`, so keeping the *file* name and
changing only `CONTRACT_NAME` is exactly what it expects. The scaffold's
`foundry.toml` (`src = "contracts"`, `via-ir = true`) needs no change.

Point the binding generator at our contract while keeping the *Go type name*
the scaffold's `tools/pkg/utils` expects (`HelloWorldInstructionSender`), so the
tools module still compiles against our ABI and bytecode:

```bash
# macOS/BSD sed shown; on GNU sed drop the '' argument
sed -i '' 's/^CONTRACT_NAME=.*/CONTRACT_NAME="VulcraInstructionSender"/' scripts/generate-bindings.sh

cat > tools/pkg/contracts/helloworld/helloworld.go <<'EOF'
//go:generate go run github.com/ethereum/go-ethereum/cmd/abigen --abi=VulcraInstructionSender.abi --bin=VulcraInstructionSender.bin --pkg=helloworld --type=HelloWorldInstructionSender --out=autogen.go

package helloworld
EOF
```

Both constructors take `(ITeeExtensionRegistry, ITeeMachineRegistry)`, and
`tools/pkg/utils.DeployInstructionSender` passes the FlareTeeManager diamond for
**both** — the diamond routes each call to the right facet — so the deploy path
is ABI-compatible as-is.

> Note: our `setExtensionId(uint256)` is `onlyOwner` and takes the id, whereas
> the scaffold's is a no-arg self-discovering `setExtensionId()`. That only
> affects `scripts/test.sh`, which is **not** part of this run book;
> `pre-build.sh` / `post-build.sh` never call it.

### 3.2 The enclave image → this repo

`config/docker/docker-compose.vulcra.coston2.yaml` (in this repo) repoints the
`extension-tee` build at `$VULCRA_EXT_DIR` and injects the Vulcra runtime env.
It is layered as a third compose file in step 6 — no edit needed here.

### 3.3 Config files

```bash
cd "$FCC_WORKSPACE/fce-extension-scaffold"
cp "$VULCRA_EXT_DIR/.env" .env
cp "$VULCRA_EXT_DIR/config/proxy/extension_proxy.coston2.docker.toml" \
   config/proxy/extension_proxy.coston2.docker.toml
```

---

## 4. Fill the two placeholders in `.env`

Edit `$FCC_WORKSPACE/fce-extension-scaffold/.env` (and keep
`$VULCRA_EXT_DIR/.env` in sync — both are gitignored):

```bash
DEPLOYMENT_PRIVATE_KEY=0x<your funded Coston2 key>
INITIAL_OWNER=0x<address derived from that key>
PROXY_PRIVATE_KEY=0x<same key is fine>
EXT_PROXY_URL=https://<your stable tunnel hostname>
```

Everything else is already set and verified:

```
CHAIN_URL=https://coston2-api.flare.network/ext/C/rpc
CHAIN_ID=114
ADDRESSES_FILE=./config/coston2/deployed-addresses.json
LOCAL_MODE=false
SIMULATED_TEE=true
MODE=1
NORMAL_PROXY_URL=https://tee-proxy-coston2-1.flare.rocks
TEE_VERSION=v0.1.0
GOVERNANCE_THRESHOLD=1        # GOVERNANCE_SIGNERS empty => INITIAL_OWNER alone
VAULT_MANAGER_FXRP_ADDRESS=0x93e572cDbfb62557E041B53490e5208C147b5388
VAULT_MANAGER_WFLR_ADDRESS=0x1F079F205ca2857a3A199937Ace956ed51B0b3b8
VULCRA_EXT_DIR=<absolute path to backend/tee-extension>
```

> **Governance.** `GOVERNANCE_SIGNERS` / `GOVERNANCE_THRESHOLD` are read by
> **both** the TEE node (it derives a `governanceHash` and signs its machine
> data with it) **and** `post-build.sh`'s `set-governance` step (which registers
> the set on-chain). If they ever disagree, `register-tee` reverts with
> `InvalidGovernanceHash`. Keeping them in the single `.env` that compose and
> the scripts both source is what keeps them consistent — do not set them in
> only one place.

Sanity-check what got loaded:

```bash
cd "$FCC_WORKSPACE/fce-extension-scaffold"
set -a; source .env; set +a
echo "deployer  $(cast wallet address --private-key "$DEPLOYMENT_PRIVATE_KEY")"
echo "balance   $(cast balance "$INITIAL_OWNER" --rpc-url "$CHAIN_URL" --ether) C2FLR"
echo "tunnel    $EXT_PROXY_URL"
```

---

## 5. Start the tunnel, then `pre-build.sh`

Start the tunnel from §1.3 **first** (`start-services.sh` health-checks
`$EXT_PROXY_URL/info`, so it must resolve).

```bash
cd "$FCC_WORKSPACE/fce-extension-scaffold"
./scripts/pre-build.sh
```

What it does, in order:

1. `generate-bindings.sh` — `forge build`, extract ABI/BIN, `abigen`.
2. Pre-flight — asserts `FlareTeeManager` is non-zero, **has code**, and the
   deployer is funded. This is the gate that would have caught the dead old
   manager.
3. `deploy-contract` — deploys `VulcraInstructionSender`.
4. `register-extension` — registers the extension on the TeeExtensionRegistry
   facet, allowlists the deployer as TEE-machine owner and wallet-project
   owner, enables the EVM key type.
5. Writes `config/extension.env`:

```bash
cat config/extension.env
# EXTENSION_ID=0x…64 hex   <- FRESH; the pre-redeploy id is void
# INSTRUCTION_SENDER=0x…40 hex
```

> A **fresh** `EXTENSION_ID` is mandatory. Extension ids are issued by the
> registry that just got redeployed; any id from before 2026-07-22 refers to
> nothing.

---

## 6. Start the stack (three compose files)

```bash
cd "$FCC_WORKSPACE/fce-extension-scaffold"
set -a; source .env; set +a
export SOURCE_DATE_EPOCH="$(git -C "$VULCRA_EXT_DIR" log -1 --format=%ct)"

docker compose \
  -f docker-compose.yaml \
  -f docker-compose.coston2.yaml \
  -f "$VULCRA_EXT_DIR/config/docker/docker-compose.vulcra.coston2.yaml" \
  up -d --build
```

- `docker-compose.yaml` — redis, ext-proxy (`local/tee-proxy`), extension-tee;
  publishes host `6673 -> 6663` and `6674 -> 6664`.
- `docker-compose.coston2.yaml` — mounts
  `config/proxy/extension_proxy.coston2.docker.toml`, sets `CHAIN_URL` and
  `CHAIN_ID=114`.
- **Vulcra overlay** — swaps the image build context to `$VULCRA_EXT_DIR` (this
  repo's `Dockerfile`, entry point `./cmd/extension`) and injects
  `VAULT_MANAGER_*`, `MCR_BPS`, `KEEPER_TEE_ADDRESS`, `SIMULATED_TEE`.

> **Apple Silicon / any arm64 host.** The enclave `Dockerfile` builds the Go
> binary with `GOARCH=amd64` (Confidential Space is x86) but the final
> `gcr.io/distroless/static` layer is pulled for the *host* platform, so on an
> arm64 Mac you get an arm64 image wrapping an x86-64 binary that will not run
> locally. Verified 2026-07-25: the image builds clean and the binary inside is
> `ELF 64-bit LSB executable, x86-64, statically linked, stripped`. Add
> `--platform linux/amd64` (via `docker compose build --platform linux/amd64`,
> or `platforms: [linux/amd64]` under the overlay's `build:`) when you need the
> container to actually start on such a host. A standalone build check:
>
> ```bash
> cd "$VULCRA_EXT_DIR"
> SOURCE_DATE_EPOCH="$(git log -1 --format=%ct)" \
>   docker build --build-arg SOURCE_DATE_EPOCH -t vulcra/extension-tee:verify .
> ```

The `local/tee-proxy` image is built automatically by `start-services.sh` from
`proxy/Dockerfile`, which self-clones `tee-proxy` at `v0.0.18` — no access to
Flare's private monorepo is required (this removed the blocker recorded in
`docs/e2e-coston2-2026-07-22.md`). If you prefer that script:

```bash
./scripts/start-services.sh --chain coston2
```
…but then add the Vulcra overlay manually, since the script hardcodes the two
scaffold compose files.

Verify the proxy is live through the **public** URL before continuing:

```bash
curl -sf "$EXT_PROXY_URL/info" | jq '.machineData, .teeInfo.publicKey' | head -20
curl -s "$EXT_PROXY_URL/info" | grep -q "$EXTENSION_ID" && echo "EXTENSION_ID OK" || echo "EXTENSION_ID MISMATCH"
docker compose -f docker-compose.yaml -f docker-compose.coston2.yaml logs -f extension-tee
```

---

## 7. `post-build.sh` — allow version, set governance, register TEE

```bash
cd "$FCC_WORKSPACE/fce-extension-scaffold"
./scripts/post-build.sh
```

In order:

1. Waits for `$EXT_PROXY_URL/info` and `$NORMAL_PROXY_URL/info`.
2. `allow-tee-version` — whitelists the running **code hash** on-chain for this
   extension at `TEE_VERSION`. This is the Bounty-2 attestation binding.
3. `set-governance` — registers `(GOVERNANCE_SIGNERS, GOVERNANCE_THRESHOLD)`.
4. `register-tee` — with `SIMULATED_TEE` exported and a resumable state file:

```
go run ./cmd/register-tee -a "$ADDRESSES_FILE" -c "$CHAIN_URL" \
    -p "$EXT_PROXY_URL" -h "${EXT_PROXY_HOST_URL:-$EXT_PROXY_URL}" \
    -ep "$NORMAL_PROXY_URL" -state "$PROJECT_DIR/config/register-tee.state"
```

`register-tee`'s default `-command rap` walks the whole lifecycle:

| letter | step | effect |
|---|---|---|
| `r` | pre-registration | `register()` the machine; if it already exists, request a **fresh** attestation instead (avoids `ChallengeExpired`) |
| `R` | re-attest | request a fresh attestation challenge explicitly |
| `a` | availability check | pre-flights the FTDC proxy's signing-policy consistency, then asks the data providers to cosign — **this is the step a stale `tee-node` breaks** |
| `p` | `toProduction` | submits the FDC proof; status becomes PRODUCTION |

If it stops part-way, re-run the same command; only when you need to force a
brand-new attestation on an already-registered machine, run the explicit form:

```bash
cd "$FCC_WORKSPACE/fce-extension-scaffold/tools"
set -a; source ../.env; set +a
go run ./cmd/register-tee \
    -a ../config/coston2/deployed-addresses.json \
    -c "$CHAIN_URL" \
    -p "$EXT_PROXY_URL" \
    -h "$EXT_PROXY_URL" \
    -ep "$NORMAL_PROXY_URL" \
    -command rRap \
    -state ../config/register-tee.state
```

---

## 8. Verify PRODUCTION on-chain

### 8.1 Get the teeId

`/info` does **not** expose a `teeId` field. The teeId *is* the Ethereum address
of the enclave's secp256k1 public key:
`teeId = keccak256(x ‖ y)[12:]` (`fccutils.TeeProxyId` →
`crypto.PubkeyToAddress`). Two ways to obtain it:

**(i) From `post-build.sh`'s own output** — `register-tee` logs
`Registration of TEE with ID <hex>` and `Registered TEE node with id <addr>`.

**(ii) Derive it from `/info`, verbatim:**

```bash
cd "$FCC_WORKSPACE/fce-extension-scaffold"
set -a; source .env; set +a

INFO="$(curl -s "$EXT_PROXY_URL/info")"
PUBX="$(echo "$INFO" | jq -r '.teeInfo.publicKey.x' | sed 's/^0x//')"
PUBY="$(echo "$INFO" | jq -r '.teeInfo.publicKey.y' | sed 's/^0x//')"
KEC="$(cast keccak "0x${PUBX}${PUBY}")"
TEE_ID="$(cast to-check-sum-address "0x${KEC: -40}")"
echo "teeId = $TEE_ID"
```

### 8.2 Read the manager

The returned `getTeeMachine` tuple is `(teeId, teeProxyId, url)`.

```bash
# (a) status — 2 == PRODUCTION
cast call 0x1a9C4A0f9D76c0b1D91d22E24E573a9b377618aE \
  "getTeeMachineStatus(address)(uint8)" "$TEE_ID" \
  --rpc-url https://coston2-api.flare.network/ext/C/rpc

# (b) the URL recorded on-chain MUST equal your live tunnel
cast call 0x1a9C4A0f9D76c0b1D91d22E24E573a9b377618aE \
  "getTeeMachine(address)((address,address,string))" "$TEE_ID" \
  --rpc-url https://coston2-api.flare.network/ext/C/rpc

# (c) extension id + owner
cast call 0x1a9C4A0f9D76c0b1D91d22E24E573a9b377618aE \
  "getExtensionId(address)(uint256)" "$TEE_ID" \
  --rpc-url https://coston2-api.flare.network/ext/C/rpc
cast call 0x1a9C4A0f9D76c0b1D91d22E24E573a9b377618aE \
  "getTeeMachineOwner(address)(address)" "$TEE_ID" \
  --rpc-url https://coston2-api.flare.network/ext/C/rpc
```

Pass criteria:

- **(a) returns `2`** — PRODUCTION. `TeeNotFound()` (`0xceb05b68`) means the
  machine was never registered against this manager; a lower value means
  registration stopped before `toProduction`.
- **(b)** the `string` field equals your tunnel URL **exactly** (scheme,
  host, no trailing slash). A mismatch means data providers are calling a dead
  address; fix with `updateTeeMachineSettings` or re-register.
- **(c)** extension id matches `config/extension.env`, owner is your deployer.

### 8.3 A worked reference (run it today, before your own deploy)

Flare's own Coston2 FTDC TEE is already PRODUCTION on the new manager, so the
whole verification chain can be rehearsed end-to-end with no gas and no deploy.
Executed 2026-07-25:

```bash
INFO="$(curl -s https://tee-proxy-coston2-1.flare.rocks/info)"
PUBX="$(echo "$INFO" | jq -r '.teeInfo.publicKey.x' | sed 's/^0x//')"
PUBY="$(echo "$INFO" | jq -r '.teeInfo.publicKey.y' | sed 's/^0x//')"
KEC="$(cast keccak "0x${PUBX}${PUBY}")"
REF_TEE="$(cast to-check-sum-address "0x${KEC: -40}")"   # 0xC869a5db4A82055046209d12216624fD400e57C5

cast call 0x1a9C4A0f9D76c0b1D91d22E24E573a9b377618aE \
  "getTeeMachine(address)((address,address,string))" "$REF_TEE" \
  --rpc-url https://coston2-api.flare.network/ext/C/rpc
# (0xC869a5db4A82055046209d12216624fD400e57C5,
#  0xF4E021377420Afe90c1A7D2b8968904946633a64,
#  "https://tee-proxy-coston2-1.flare.rocks")

cast call 0x1a9C4A0f9D76c0b1D91d22E24E573a9b377618aE \
  "getTeeMachineStatus(address)(uint8)" "$REF_TEE" \
  --rpc-url https://coston2-api.flare.network/ext/C/rpc
# 2
```

That single result proves three things at once: the new manager really is the
live one, `2` really is PRODUCTION (read off a machine that is demonstrably
serving), and the on-chain `url` field really does hold the public proxy URL —
which is why §1.3 insists the tunnel be stable. Its `/info` also shows
`platform = 0x4743505f414d445f534556…` (ASCII `GCP_AMD_SEV`), i.e. what a real
non-simulated Confidential Space enclave looks like.

### 8.4 Cross-checks

A status-value-independent cross-check — the machine should appear in the
extension's active set (`extensionId` in decimal from `config/extension.env`):

```bash
cd "$FCC_WORKSPACE/fce-extension-scaffold/tools"
go run ./cmd/query-tee \
  -rpc https://coston2-api.flare.network/ext/C/rpc \
  -reg 0x1a9C4A0f9D76c0b1D91d22E24E573a9b377618aE \
  -ext <EXTENSION_ID_DECIMAL> "$TEE_ID"
```

Note `query-tee`'s `-reg` default is a stale address — **always pass `-reg`
explicitly**.

Finally, record the attestation evidence (see
[`attestation-evidence.md`](attestation-evidence.md)):

```bash
cd "$VULCRA_EXT_DIR"
SOURCE_DATE_EPOCH="$(git log -1 --format=%ct)" ./scripts/reproducible-build.sh
curl -s "$EXT_PROXY_URL/info" | jq '.machineData.codeHash, .machineData.platform'
```

With `SIMULATED_TEE=true` the `codeHash` is the simulated one and `platform` is
not `GCP_AMD_SEV` — that is the expected, judge-approved Coston2 posture. Only a
real Confidential Space VM with `SIMULATED_TEE=false` / `MODE=0` yields the
measured hash that must equal `reproducible-build.sh`'s output.

---

## 9. Failure modes → cause

| Symptom | Cause | Fix |
|---|---|---|
| `FunctionNotFound` / `register()` reverts | pointing at the dead `0x004224fa…` | assert §2's `jq` check |
| `InvalidGovernanceHash` | node's `GOVERNANCE_*` ≠ on-chain set | one `.env`, sourced by both compose and the scripts; re-run `set-governance` |
| `Verification.ChallengeExpired` | attestation challenge is one-shot and went stale | re-run with `-command rRap` |
| availability check yields no proof; queue stays empty | **stale `tee-node`** — provider votes rejected by the old weight check | confirm `go.mod` pins `tee-node v0.0.23-0.20260722073401-c687a8631bca` and rebuild the image |
| `404 no round` during the availability check | FTDC proxy signing policy out of sync with the reward epoch | wait for the next epoch and re-run; `CheckFTDCProxyPolicyConsistency` fails fast on purpose |
| proxy panics / `InvalidTeePublicKeyOrSignature` | `CHAIN_ID` mismatch between node (114), proxy TOML (114) and chain | all three must be 114 |
| `EXTENSION_ID not found in proxy /info` | proxy filtering a different extension | re-run `pre-build.sh`, restart the stack so `config/extension.env` is re-read |
| DB `connection refused` (intermittent) | shared, connection-capped indexer | retry; persistent refusal = route down |
| machine silently leaves PRODUCTION | tunnel died → on-chain URL unreachable | keep the **named** tunnel up; ephemeral URLs guarantee this |

---

## 10. Teardown

```bash
cd "$FCC_WORKSPACE/fce-extension-scaffold"
docker compose -f docker-compose.yaml -f docker-compose.coston2.yaml down
```

Leave the tunnel running if you want the machine to stay PRODUCTION.
