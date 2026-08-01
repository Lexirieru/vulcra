# tee-extension — Guardian confidential keeper (Go / TEE)

The opt-in **Guardian**: a keeper that runs inside a **Trusted Execution Environment** and auto-repays
a vault before liquidation, **without exposing the user's trigger on-chain beforehand**. This is the
hackathon's stretch (Bounty 2). Written in Go; separate from the TS backend.

## Layout

- `cmd/extension/main.go` — entrypoint.
- `internal/guardian/` — the protection rules: `rules.go` (register/store), `eval.go` (evaluate a
  vault's health against a private rule), `keccak.go`.
- `internal/keeper/` — `decide.go` (what action to take), the watch/act loop.
- `internal/chain/client.go` — Coston2 reads/writes.
- `internal/config/`, `pkg/types/` — config + request/response DTOs.
- `config/docker/docker-compose.vulcra.coston2.yaml` — run it on Coston2.
- `docs/` — the run-books: `fcc-production-registration.md` (the **named-tunnel** production procedure,
  host port 6674), `attestation-evidence.md` (reproducible-build attestation for Bounty 2),
  `e2e-coston2-2026-07-22.md` (E2E PASS).

## Operating model

Users register a **private** rule (trigger health ratio + max repay) submitted **once to the TEE over
TLS** via the backend — evaluated only inside the enclave, never published on-chain before execution,
so thresholds aren't front-runnable. Ops: `GUARDIAN/REGISTER`, `GUARDIAN/EVALUATE`.

**Durability = an ops task, not code:** the named-tunnel keeps the TEE reachable 24/7 (see the
run-book). Hackathon posture is **simulated attestation** (judge-approved); production attestation is
the documented next step and needs a live TEE host + tunnel.

## 🔒 Security
The whole point is confidentiality — no trigger data on-chain. Keys/creds only in gitignored `.env`.
Never commit `.env`, `references/`, or `VULCRA_PRD.md`.
