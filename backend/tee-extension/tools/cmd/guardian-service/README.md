# guardian-service — Guardian confidential-keeper backend

The long-running service the Vulcra frontend's `/guardian` page talks to. One
process bundles:

1. **TEE node key** (simulated attestation) serving `/decrypt` + `/sign` on the
   sign port — the same in-enclave key management the real tee-node runs.
2. **The keeper** (`internal/extension`), invoked in-process, which decrypts
   rules through the sign port and re-reads authoritative on-chain vault state.
3. **A REST facade** matching the frontend's api client:
   - `GET  /guardian/rules?owner=0x…` → `GuardianRule[]`
   - `POST /guardian/rules` (`GuardianRuleInput`) → `GuardianRule` (ECIES-encrypts
     the private terms, runs `GUARDIAN/REGISTER`, stores owner-facing metadata)
   - `PATCH /guardian/rules/{id}` (`{enabled}`) → toggle
   - `POST /guardian/rules/{id}/evaluate` → one-off live decision
   - `GET  /health`
4. **A watch loop** that re-evaluates every enabled rule on an interval and logs
   the auto-repay decision (dry-run unless a funded keeper wallet holds
   `GUARDIAN_EXECUTOR_ROLE` — the same gate as the keeper).

The private terms (trigger CR, max repay) are ECIES-encrypted to the TEE key,
decrypted ONLY inside the keeper, and committed on-chain only as
`keccak256(owner, trigger, maxRepay)` — never the plaintext trigger.

## Run locally

```bash
cd backend/tee-extension
COSTON2_RPC_URL=https://coston2-api.flare.network/ext/C/rpc \
CHAIN_ID=114 \
VAULT_MANAGER_FXRP_ADDRESS=0x93e572cDbfb62557E041B53490e5208C147b5388 \
VAULT_MANAGER_WFLR_ADDRESS=0x1F079F205ca2857a3A199937Ace956ed51B0b3b8 \
MCR_BPS=13000 SIMULATED_TEE=true LOCAL_MODE=false MODE=1 \
SIGN_PORT=7701 EXTENSION_PORT=7702 GUARDIAN_API_PORT=8790 \
GUARDIAN_EVAL_INTERVAL_SECONDS=30 FRONTEND_ORIGIN=http://localhost:3000 \
go run ./tools/cmd/guardian-service
```

Then point the frontend at it: `NEXT_PUBLIC_GUARDIAN_API_URL=http://localhost:8790`.

## Env vars

| Var | Purpose | Default |
|---|---|---|
| `COSTON2_RPC_URL` | Coston2 RPC (authoritative reads) | Flare public |
| `VAULT_MANAGER_FXRP_ADDRESS` / `_WFLR_ADDRESS` | branch VaultManagers | — (≥1 required) |
| `MCR_BPS` | min collateral ratio (trigger must exceed it) | 13000 |
| `SIMULATED_TEE` | `true` = simulated attestation (judge-approved) | — |
| `SIGN_PORT` / `EXTENSION_PORT` | internal ports (in-container) | 7701 / 7702 |
| `PORT` / `GUARDIAN_API_PORT` | REST facade port (`$PORT` wins, for Railway) | 8790 |
| `GUARDIAN_EVAL_INTERVAL_SECONDS` | watch-loop cadence | 30 |
| `FRONTEND_ORIGIN` | CORS allow-list (comma-separated) | http://localhost:3000 |
| `KEEPER_TEE_ADDRESS` | funded keeper wallet → un-gates live `delegatedRepay` | unset (decision-only) |

## Deploy on Railway (2nd service)

- New service in the same project → same repo.
- **Root Directory** = `backend/tee-extension`.
- **Dockerfile path** = `tools/cmd/guardian-service/Dockerfile`.
- Env vars: the branch addresses + `MCR_BPS` + `SIMULATED_TEE=true` + `FRONTEND_ORIGIN`
  (your FE origin). `$PORT` is injected. No FCC indexer DB creds needed — the
  keeper reads chain via RPC directly.
- Point the frontend's `NEXT_PUBLIC_GUARDIAN_API_URL` at this service's URL.
