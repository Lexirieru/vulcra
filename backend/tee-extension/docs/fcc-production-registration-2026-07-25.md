# PRODUCTION registration — executed evidence (Coston2, 2026-07-25)

The run book [`fcc-production-registration.md`](fcc-production-registration.md)
was executed end-to-end against the **redeployed** Flare TEE manager. The Vulcra
confidential extension's TEE machine reached **status 2 = PRODUCTION**.

Machine-readable: [`fcc-production-registration-2026-07-25.json`](fcc-production-registration-2026-07-25.json).
**No secrets in this file.**

## Result

| Field | Value |
|---|---|
| FlareTeeManager | `0x1a9C4A0f9D76c0b1D91d22E24E573a9b377618aE` |
| **teeId** | `0xEAAEF13871e71db24FC47e7c76Be8a925057caa6` |
| **status** | **2 — PRODUCTION** |
| on-chain url | `https://zoloft-harbor-prior-educators.trycloudflare.com` |
| owner / teeProxyId | `0x77d85445B801064a2190750f3581c4c63b8976F9` |
| extensionId | `65701` (`0x…000100a5`) |
| InstructionSender | `0x978Ad6Ae225BEA5745a7fb87A66BC7a57FA7c555` |
| TEE version | `v0.1.0` |
| initialSigningPolicyId | `5856` |
| lastStatusChangeTs | `1784978699` |
| gas spent | `1.868152652` C2FLR (8 → 6.131847348) |

```
$ cast call 0x1a9C4A0f9D76c0b1D91d22E24E573a9b377618aE \
    "getTeeMachineStatus(address)(uint8)" 0xEAAEF13871e71db24FC47e7c76Be8a925057caa6 \
    --rpc-url https://coston2-api.flare.network/ext/C/rpc
2

$ cast call 0x1a9C4A0f9D76c0b1D91d22E24E573a9b377618aE \
    "getTeeMachine(address)((address,address,string))" 0xEAAEF13871e71db24FC47e7c76Be8a925057caa6 \
    --rpc-url https://coston2-api.flare.network/ext/C/rpc
(0xEAAEF13871e71db24FC47e7c76Be8a925057caa6,
 0x77d85445B801064a2190750f3581c4c63b8976F9,
 "https://zoloft-harbor-prior-educators.trycloudflare.com")

$ cast call 0x1a9C4A0f9D76c0b1D91d22E24E573a9b377618aE \
    "getActiveTeeMachines(uint256)(address[],string[])" 65701 \
    --rpc-url https://coston2-api.flare.network/ext/C/rpc
[0xEAAEF13871e71db24FC47e7c76Be8a925057caa6]
["https://zoloft-harbor-prior-educators.trycloudflare.com"]

$ cast call 0x1a9C4A0f9D76c0b1D91d22E24E573a9b377618aE \
    "getExtensionId(address)(uint256)" 0xEAAEF13871e71db24FC47e7c76Be8a925057caa6 \
    --rpc-url https://coston2-api.flare.network/ext/C/rpc
65701
```

The on-chain `url` is byte-identical to the live tunnel, and the machine appears
in the extension's **active** set — the two checks that together prove data
providers can actually reach this enclave.

## Attestation posture

`SIMULATED_TEE=true`, `MODE=1` — the judge-approved Coston2 posture. Therefore:

- `codeHash = 0x194844cf417dde867073e5ab7199fa4d21fd82b5dbe2bdea8b3d7fc18d10fdc2`
  (the simulated hash, **not** a measured one)
- `platform = 0x544553545f504c4154464f524d…` = ASCII `TEST_PLATFORM`
  (a real Confidential Space enclave reads `GCP_AMD_SEV`)

`allow-tee-version` whitelisted exactly that hash for extension 65701 at
`v0.1.0`, and its own log carries the honest caveat:
`NOTE: Code hash is from proxy /info response — not independently verified against attestation`.
Only a real Confidential Space VM (`SIMULATED_TEE=false`, `MODE=0`) produces the
measured hash that must equal `scripts/reproducible-build.sh`'s output.

## Governance

`GOVERNANCE_SIGNERS` unset ⇒ deployer as sole signer, threshold 1.
`set-governance` registered hash
`0xb74d1df9e8c2580b9d7b2afd27db95a9b1e4f0441f1698d51fa18ba1a4b4a080`, identical
to the `governanceHash` the node reports in `/info` — so `register-tee` never hit
`InvalidGovernanceHash`.

## Availability check — the step a stale tee-node breaks

```
policy consistency OK: FTDC proxy signing policy 5858 matches on-chain reward epoch 5858 (tolerance +1)
tee-attestation requested, instructionId: 0x8f22107739b5f52c344c24334ad3edc757325e16dc4a40c48550c0a178e88dde
availability check sent,  instructionId: 0xc1b402f24677c11eb931790d9efd7071aa2f11e0712daa72a0399c2054778a90
availability check proof obtained
Registered TEE node with id 0xEAAEF13871e71db24FC47e7c76Be8a925057caa6
```

`register-tee` ran with post-build's default `-command rap` and needed **no**
retry — no `ChallengeExpired`, no `404 no round`. Data-provider votes were
accepted on the first attempt, with the node pinned at
`tee-node v0.0.23-0.20260722073401-c687a8631bca`. Scaffold at
`3d0d8f2babde42298c934b15ebf4d4398eb52efe`.

## Two corrections the execution forced on the run book

**1. Overlaying the contract breaks the `tools` module compile — not just
`test.sh`.** §3.1 originally said the `setExtensionId` signature divergence
"only affects `scripts/test.sh`". That is wrong: `tools/pkg/utils` is one
package, and `cmd/deploy-contract` imports it, so `pre-build.sh` **Step 1
pre-flight** dies before spending any gas with:

```
pkg/utils/instructions.go:59:35: not enough arguments in call to sender.SetExtensionId
pkg/utils/instructions.go:117:20: sender.SendSayHello undefined
pkg/utils/instructions.go:186:20: sender.SendSayGoodbye undefined
```

The run book now carries the exact patch (§3.1). Applied here, `pre-build.sh`
completed on the next run.

**2. The arm64 Mac path works, and is cheap.** `local/tee-proxy` builds and runs
**natively arm64**; only `extension-tee` needs `linux/amd64`. A mixed-arch
compose stack is fine. The amd64 enclave image built under emulation in about
four minutes and the container ran without incident (tee-node polled the proxy,
`INITIALIZE_POLICY` returned status 1). See §6 for the host overlay.

## Known fragility of THIS deployment

The tunnel is a cloudflared **quick** tunnel
(`*.trycloudflare.com`) — chosen because it needs no account, which is what made
this run autonomous. It is exactly what run book §1.3 warns against: the
hostname is bound to that one `cloudflared` process. **If that process dies or
restarts, the hostname changes, the on-chain `url` above becomes unreachable,
and the machine stops being servable** — status may still read `2` for a while,
which is precisely the silent-failure mode §1.3 describes.

To make this durable, re-point at a **named** tunnel (cloudflared named tunnel
or an ngrok reserved domain) and update the record:

```bash
cast send 0x1a9C4A0f9D76c0b1D91d22E24E573a9b377618aE \
  "updateTeeMachineSettings(address,address,string)" \
  0xEAAEF13871e71db24FC47e7c76Be8a925057caa6 \
  0x77d85445B801064a2190750f3581c4c63b8976F9 \
  "https://<your-stable-hostname>" \
  --rpc-url https://coston2-api.flare.network/ext/C/rpc \
  --private-key "$DEPLOYMENT_PRIVATE_KEY"
```

Re-verify with §8.2 afterwards.
