# Vulcra TEE Extension — Attestation Evidence (Bounty 2)

This document is the confidentiality-verifiability evidence for the Vulcra
Vault Guardian + liquidation keeper (requirement U14 / master R16). It contains
**no secrets**. Its claim: the confidential logic that holds users' private
protection rules runs inside an attested TEE whose code is reproducibly built
and whose measured code hash is whitelisted on-chain.

## The trust chain in one line

> Reproducible Go build → deterministic code hash → hash whitelisted on-chain →
> the TEE (GCP Confidential Space / AMD SEV) attests it runs exactly that hash →
> Flare's data providers only accept results from that attested hash.

Because the build is bit-for-bit reproducible, **anyone** can rebuild from
source, compute the hash, and confirm it equals the whitelisted one — without
trusting us.

## 1. Reproducible build

Go produces a single static binary that is bit-for-bit reproducible across
machines when the timestamp is pinned:

```bash
# from backend/tee-extension/
SOURCE_DATE_EPOCH="$(git log -1 --format=%ct)" ./scripts/reproducible-build.sh
```

The script sets `SOURCE_DATE_EPOCH` (last commit time), then builds with
`CGO_ENABLED=0 -trimpath -buildvcs=false -ldflags="-s -w -buildid="` and prints
the SHA-256 of the binary. Two independent runs of the same commit on different
machines produce the **same** hash. (Contrast: Python/TypeScript extensions only
reach same-machine determinism — the Go path is the strong Bounty-2 story.)

## 2. Dev vs prod mode

| Setting        | Dev (development)                         | Prod (mainnet/testnet real attestation) |
| -------------- | ----------------------------------------- | --------------------------------------- |
| `SIMULATED_TEE`| `true`                                    | `false`                                 |
| `MODE`         | `1` (simulated attestation)               | `0` (production attestation backend)    |
| `LOCAL_MODE`   | `false` (real Coston2 chain)              | `false`                                 |
| codeHash       | simulated `0x194844cf…`                   | real measured hash (from the VM)        |

Dev mode runs against the **real Coston2 chain** but with **simulated
attestation** — the FTDC data providers reject simulated results, which is why
dev is for wiring/verification only. Production bakes `MODE=0` /
`SIMULATED_TEE=false` into the image so the measured hash is real.

## 3. Code-hash whitelisting flow

After building the image and starting the stack (`pre-build.sh` →
`start-services.sh`), the machine registration whitelists the hash and registers
the TEE:

```bash
./scripts/post-build.sh
# internally:
#   allow-tee-version   # whitelist this code hash on-chain for the extension
#   set-governance      # register (GOVERNANCE_SIGNERS, GOVERNANCE_THRESHOLD);
#                       # must match what the TEE node signs with, or register-tee
#                       # reverts with InvalidGovernanceHash
#   register-tee        # default -command rap: register machine (or re-attest if
#                       # already registered), run the FTDC availability check,
#                       # promote to production. Resumable via -state.
```

`allow-tee-version` is what binds "this exact code hash is allowed to serve this
extension." The `r` step re-attests when the machine already exists, so re-runs
do not hit `Verification.ChallengeExpired`; pass `-command rRap` to force a fresh
attestation challenge explicitly.

> **Manager address (2026-07-22 redeploy):** all of the above target the
> `FlareTeeManager` diamond at
> `0x1a9C4A0f9D76c0b1D91d22E24E573a9b377618aE`, read from the scaffold's
> `config/coston2/deployed-addresses.json`. The old
> `0x004224faB7BF19a1a67Ee5AF87Cb2b0F0925d41F` has no bytecode. Full procedure:
> [`fcc-production-registration.md`](fcc-production-registration.md).

## 4. Verify the running TEE (`/info` machineData)

Curl the proxy and inspect `machineData`:

```bash
curl -s "$EXT_PROXY_URL/info" | jq '.machineData'
```

Confirm, for a **production** deploy:

- `platform` starts with `0x4743505f414d445f534556…` — ASCII `GCP_AMD_SEV`, i.e.
  a real GCP Confidential Space AMD SEV enclave (not a local/simulated node).
- `codeHash` is a **real measured hash**, NOT the simulated `0x194844cf…`, and
  **equals** the hash produced by `reproducible-build.sh` for the deployed commit.
- `extensionId` matches `config/extension.env`.
- `initialOwner` matches your deployer address.

For a **dev** deploy, `codeHash` is the simulated `0x194844cf…` and
`extensionId`/`initialOwner` still match `config/extension.env`.

## 5. Why the private rules stay private

- The protection rule (trigger CR, max repay) is **ECIES-encrypted to the
  extension public key off-chain**; only the ciphertext is sent on-chain in a
  `GUARDIAN/REGISTER` instruction.
- The enclave decrypts it via the TEE node and keeps the plaintext **only in
  enclave memory**, keyed by `termsCommitment =
  keccak256(abi.encode(owner, triggerCRBps, maxRepay18))`.
- On-chain, only the `termsCommitment` is ever visible — never the trigger or
  the max-repay. A `delegatedRepay` only appears when protection actually fires.
- Because the enclave code is attested to the whitelisted hash, an observer
  knows the private rule cannot be exfiltrated or front-run by the operator.

## 6. Verify it yourself

1. Check out the deployed commit of `backend/tee-extension/`.
2. Run `SOURCE_DATE_EPOCH="$(git log -1 --format=%ct)" ./scripts/reproducible-build.sh`.
3. Note the printed SHA-256.
4. `curl -s "$EXT_PROXY_URL/info" | jq -r '.machineData.codeHash'`.
5. Confirm the on-chain whitelisted hash (via `allow-tee-version` records / the
   registry) equals what you built. Equality = the confidential logic you can
   read is exactly what is running.

_No credentials, keys, or private rule contents appear anywhere in this
evidence. The keeper wallet key never leaves the enclave; it is used only via
the TEE sign port._
