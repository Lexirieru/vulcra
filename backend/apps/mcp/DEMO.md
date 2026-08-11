# Vulcra MCP — agent demo transcript

A live run of an **AI agent** driving Vulcra's CDP from an **XRP wallet only** (no
EVM wallet, no keys shared) through the Vulcra MCP server. Every write is returned
as an **unsigned XRPL Payment** the user signs in their own wallet — the server is
**zero-custody**. Verified end-to-end against Coston2 (executor + indexer + live
FTSOv2 pricing) on 2026-08-12.

> Setup: `npm -w apps/executor start` (:8787), `npm -w apps/indexer start` (:8788,
> with `VAULT_MANAGER_FXRP_ADDRESS` / `VAULT_MANAGER_WFLR_ADDRESS`), then register
> the MCP with your agent: `claude mcp add vulcra -- tsx apps/mcp/src/index.ts`.

Agent goal: *"I hold XRP. Put it to work as collateral and borrow vUSD on Vulcra —
without touching a Flare/EVM wallet."* r-address `rHS3D3…moog`.

## ✅ Positive path

| Tool | Result |
|------|--------|
| `get_branches` | FXRP (XRP/USD $1.0206, MCR 130%, fee 0.5%, min debt 0.05 vUSD, XRPL-native ✓), wFLR (MCR 150%) |
| `get_vault(fxrp)` | No active vault (smart account `0x6F66…E3d4`) |
| `quote_max_borrow(10 FXRP)` | Max **7.812 vUSD** at 130% MCR (coll value $10.21) |
| `quote_max_borrow(10 FXRP, 200%)` | Max **5.078 vUSD** at a safer 200% CR |
| `quote_open_vault(10 FXRP, 5 vUSD)` | Debt 5.025 vUSD (fee 0.025), **CR 203.11%**, feasible ✅ |
| `open_vault(10 FXRP, 5 vUSD, 5%/yr)` | 🔏 **UNSIGNED** XRPL Payment → Core Vault `rDhpmiPq…`, **10.2 XRP**, memo `0xfe0000…` |
| `adjust_vault(borrow, 2)` | 🔏 UNSIGNED Payment, 0.2 XRP (fees-only), memo `0xfe…` |
| `earn_deposit(3 vUSD)` | 🔏 UNSIGNED Payment — borrow → earn in one signature |
| `get_earn_position(fxrp)` | Deposit 0.2 vUSD · Pool TVL 3.2M · APR 11.02% (7d 11.02%) |
| `get_at_risk_vaults(fxrp)` | 0 vaults below 130% CR — none |

Each intent returns `{ unsignedXrplPayment: {destination, amountDrops/Xrp, memoHex},
summary, memoUserOpHash, packedUserOpHex }`. The 0xFE memo commits
`keccak256(userOp)`, so the executor can only run the exact op the user signed.

## ⚖️ Edge cases

| Tool | Result |
|------|--------|
| `quote_open_vault(10 FXRP, 7.5 vUSD)` — near max | CR **135.44%** (just above MCR), feasible ✅ |
| `quote_open_vault(10 FXRP, 0.05 vUSD)` — min debt | CR 20316%, feasible ✅ (exactly meets min debt) |

## ❌ Negative cases — all rejected cleanly (no crash)

| Tool | Result |
|------|--------|
| `get_vault("notanaddress")` | MCP validation error `-32602`: "Must be an XRPL classic r-address (starts with 'r')" |
| `quote_open_vault(1 FXRP, 100 vUSD)` | **feasible = no** ❌ (CR 1.01%, below MCR) — a quote, not a crash |
| `quote_open_vault(10 FXRP, 0.001 vUSD)` | **feasible = no** ❌ (below min debt) |
| `open_vault(branch=wflr)` | Error: "Branch wFLR has no XRPL-native path. Only FXRP supports the zero-custody 0xFE flow." |
| `adjust_vault(adjustRate)` w/o rate | Error: "newRatePercent is required for adjustRate." |

## Why this matters

Because every Vulcra action is a single XRPL Payment + 42-byte memo, the MCP server
never holds or requests a key. The agent is the brain; the user's XRP wallet (or a
TEE with a confidential risk policy) is the only signer. That is the first DeFi CDP
an AI agent can manage **natively and safely** — and every call re-exercises the
0xFE / FDC / FAssets / FTSOv2 / Smart-Account stack.
