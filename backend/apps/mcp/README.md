# @vulcra/mcp — Vulcra CDP MCP server (zero-custody)

A [Model Context Protocol](https://modelcontextprotocol.io) **stdio** server that lets an
AI agent manage [Vulcra](../../..) CDP positions — Vulcra is an XRPL-native,
multi-collateral CDP stablecoin (vUSD) on Flare **Coston2** — in natural language,
**without ever holding a private key**.

## Zero-custody security model

This is the whole point, so it is worth being precise:

- **The server holds no keys and can sign nothing.** It has read/RPC access to Coston2
  and talks to the Vulcra backend HTTP services. That is all.
- **Read tools** (`get_*`, `quote_*`) only query on-chain state (FTSOv2 price, the
  VaultManager, the StabilityPool) and the indexer.
- **Intent tools** (`open_vault`, `adjust_vault`, `close_vault`, `earn_deposit`,
  `earn_withdraw`) do **not** execute anything. Each returns an **UNSIGNED XRPL
  Payment**:

  ```jsonc
  {
    "unsignedXrplPayment": {
      "destination": "r… (FAssets Core Vault)",
      "amountDrops": "1234567",
      "amountXrp": "1.234567",
      "memoHex": "0xfe00…",           // 42-byte 0xFE custom-instruction memo
      "xrplMemoData": "FE00…",         // same memo as XRPL MemoData (no 0x, upper)
      "destinationTag": null,          // MUST be none — a tag reroutes the mint
      "noDestinationTag": true
    },
    "summary": "Open FXRP vault …",
    "memoUserOpHash": "0x…",           // keccak256(userOp), committed in the memo
    "packedUserOpHex": "0x…"           // ABI-encoded PackedUserOperation
  }
  ```

  The **user signs that one payment in their own XRP wallet** (Xaman, etc.). Because the
  0xFE memo commits `keccak256(userOp)`, the executor can only run the exact operation the
  user approved — it cannot substitute a different action. The worst this MCP server can do
  is *propose* a payment the user must explicitly sign.

- **No EVM wallet is ever needed.** The XRPL r-address maps deterministically to an EVM
  smart account (PersonalAccount) on-chain; the 0xFE direct-minting path mints FXRP **and**
  runs the vault operation atomically from that account.

After the user signs and broadcasts the XRPL payment, the client submits
`{ xrplTxId, packedUserOpHex, memoUserOpHash }` to the executor's `POST /mint/submit`
(returned as `submit` in each intent tool's structured result) to drive execution.

## Tools

| Tool | Kind | What it does |
|------|------|--------------|
| `get_branches` | read | List branches (FXRP, wFLR) with live price, MCR, mint fee, min debt, rate bounds |
| `get_vault` | read | A CDP position for an r-address: collateral, debt, rate, CR, active |
| `get_vault_health` | read | ICR, FTSOv2 liquidation price, price buffer, is-liquidatable |
| `get_at_risk_vaults` | read | Vaults below a CR threshold (indexer), riskiest first |
| `get_earn_position` | read | Stability-Pool deposit, pool TVL, live + trailing-7d APR |
| `quote_open_vault` | quote | Preview debt/CR/fee/feasibility for a proposed open (`previewOpen`) |
| `quote_max_borrow` | quote | Max vUSD borrowable at a target CR (new collateral or existing vault) |
| `open_vault` | intent | Unsigned XRPL payment to open a vault + mint vUSD |
| `adjust_vault` | intent | Unsigned payment: borrow / repay / add- or withdraw-collateral / adjust-rate |
| `close_vault` | intent | Unsigned payment to repay all debt and return collateral |
| `earn_deposit` | intent | Unsigned payment to deposit vUSD into the Stability Pool |
| `earn_withdraw` | intent | Unsigned payment to withdraw vUSD (+ rewards) from the Stability Pool |

Amounts are **natural**: whole tokens (`100` FXRP, `50` vUSD) and percents (`5` = 5%/yr).
Intent tools are **FXRP-only** (the XRPL-native 0xFE path); wFLR is EVM-only.

## How it reuses the backend

- Intent tools call the **executor** `POST /mint/build` and `POST /manage/build` — which
  already return the Core-Vault destination, exact drops, 0xFE memo and packed user-op — so
  the direct-minting encoding is never reimplemented here.
- `get_at_risk_vaults` calls the **indexer** `GET /vaults/at-risk`.
- Read/quote tools read Coston2 directly via `@vulcra/chain-client` (FTSOv2, VaultManager,
  StabilityPool) and resolve the r-address → smart account via `@vulcra/userop`.
- `earn_withdraw` is the one action the executor does not (yet) expose; it is assembled
  locally from `@vulcra/userop`'s shared user-op builder (still just an unsigned payload).

## Install & run

> The PM installs deps for the whole backend. To install:

```bash
# from backend/ (workspaces already glob apps/*, so @vulcra/mcp is included)
npm install
```

Deps added by this package: `@modelcontextprotocol/sdk`, `zod` (**v3**, required by the SDK),
`viem`, and the workspace packages `@vulcra/chain-client`, `@vulcra/userop`,
`@vulcra/interfaces`; dev: `tsx`, `typescript`, `@types/node`.

Run (stdio — a client spawns it; it speaks JSON-RPC on stdout, logs to stderr):

```bash
cd backend/apps/mcp
npx tsx src/index.ts       # or: npm run start
```

### Configuration (env, all optional — Coston2 defaults are baked in)

| Var | Default |
|-----|---------|
| `VULCRA_EXECUTOR_URL` | `http://localhost:8787` |
| `VULCRA_INDEXER_URL` | `http://localhost:8788` |
| `VULCRA_RPC_URL` / `COSTON2_RPC_URL` | `https://coston2-api.flare.network/ext/C/rpc` |
| `VULCRA_VAULT_MANAGER_FXRP` / `_WFLR` | live Coston2 deployments |
| `VULCRA_STABILITY_POOL_FXRP` / `_WFLR` | live Coston2 deployments |

No secret is ever read. The executor + indexer must be running for intent tools /
`get_at_risk_vaults`; the read/quote tools only need RPC.

### Register with Claude Code

```bash
claude mcp add vulcra -- npx tsx /Users/…/vulcra/backend/apps/mcp/src/index.ts
```

Or, once deps are installed, via the bin:

```bash
claude mcp add vulcra -- vulcra-mcp
```

### Register with Claude Desktop (`claude_desktop_config.json`)

```jsonc
{
  "mcpServers": {
    "vulcra": {
      "command": "npx",
      "args": ["tsx", "/Users/…/vulcra/backend/apps/mcp/src/index.ts"],
      "env": { "VULCRA_EXECUTOR_URL": "http://localhost:8787" }
    }
  }
}
```

## Example agent flow

1. `get_branches` → see FXRP MCR / price / fees.
2. `quote_open_vault { collateralAmount: "100", mintAmount: "40" }` → CR + feasibility.
3. `open_vault { rAddress: "rUser…", collateralAmount: "100", mintAmount: "40" }` →
   returns the unsigned XRPL payment.
4. User signs it in their XRP wallet; client `POST`s `{ xrplTxId, packedUserOpHex,
   memoUserOpHash }` to the executor `/mint/submit`.
5. `get_vault_health { rAddress: "rUser…" }` → confirm the new position's buffer.
