# Vulcra — 3-minute demo script

**Goal:** in three minutes, prove the two things that win — (1) an XRP holder opens a vault, mints
vUSD, and deposits to Earn from **one XRPL Payment** with no Flare wallet, and (2) an **AI agent**,
through the **Vulcra MCP**, monitors and manages that same position.

**Format:** shot list + narration. Screen recording of the real frontend (`/borrow/xrp`) and
Crossmark against live **Coston2**, plus a terminal/agent pane for the MCP segment.

> **Recording note:** record each segment the moment its feature works end-to-end, then stitch. Keep
> the Coston2 explorer open in a background tab so every claim can cut to an on-chain receipt.

**Total: ~180s.** Timings below are targets.

---

## Segment 0 — Hook (0:00–0:15)

| Shot | Narration |
|---|---|
| Title card: "Vulcra — borrow a stablecoin against XRP, in one payment." Cut to the XRP wallet balance in Crossmark. | "This is XRP, on the XRP Ledger. In the next three minutes it becomes collateral for a dollar-stablecoin loan on Flare — without ever touching a Flare wallet, or paying a cent of FLR gas." |

---

## Segment 1 — One XRPL Payment → vault + vUSD + Earn (0:15–1:45)

| Shot | Narration |
|---|---|
| Frontend `/borrow/xrp`. Connect Crossmark (XRPL). Show "no Flare wallet connected." | "I'm on Vulcra's XRP borrow page. The only wallet connected is my XRPL wallet — there is no EVM account here." |
| Enter collateral (e.g. supply XRP) + borrow amount (vUSD) + interest rate. Toggle **"also deposit to Earn."** Panel shows live **FTSOv2** XRP/USD price and resulting collateral ratio. | "I choose how much XRP to supply, how much vUSD to borrow, and — Liquity-V2 style — I set my own interest rate. The price is a live FTSOv2 feed. I'll also tick 'deposit into Earn' so the vUSD goes straight to the Stability Pool." |
| Click Borrow → Crossmark pops up **one** Payment to sign. Zoom the memo field. | "Everything I just chose is compiled into one XRPL Payment. This memo is the commitment — a keccak256 hash of the exact on-chain operation. I sign once." |
| Sign. Mint tracker animates: **Received → Attesting (FDC) → Executing → vUSD delivered.** | "Now Flare takes over. The Data Connector — FDC — proves my XRPL payment actually happened and returns a Merkle proof. The executor settles a FAssets direct-mint-with-data: my XRP becomes FXRP, and in the *same atomic transaction* my PersonalAccount opens the vault, mints vUSD, and deposits it to Earn." |
| Cut to Coston2 explorer: the settlement tx (`executeDirectMintingWithData`), FXRP minted, vUSD minted, Stability Pool deposit. | "One transaction on Coston2: FXRP minted, vault opened, vUSD minted, deposited to the pool. One signature on the XRP Ledger did all of it." |
| Back to frontend: vault card shows collateral, debt, rate, health; Earn shows the deposit + reward APR. | "My position is live — and my vUSD is already earning the pool's rate-based reward stream." |

---

## Segment 2 — AI agent manages the position via the Vulcra MCP (1:45–2:50)

The **Vulcra MCP** (`backend/apps/mcp`, `@vulcra/mcp`) is a **zero-custody stdio MCP server**: it
holds no keys and can sign nothing. **Read** tools (`get_vault`, `get_vault_health`,
`get_at_risk_vaults`, `get_earn_position`, `get_branches`) query Coston2 + the indexer directly;
**intent** tools (`adjust_vault`, `open_vault`, `close_vault`, `earn_deposit`) return an **unsigned
XRPL Payment** the user signs in their own wallet. Same 0xFE mechanism, same one-payment lifecycle.

| Shot | Narration |
|---|---|
| Terminal / Claude pane with the MCP registered (`claude mcp add vulcra …`). Prompt: "How's my FXRP vault doing?" Agent calls the MCP `get_vault` tool. | "Now an AI agent takes over — connected to Vulcra through a zero-custody MCP server. It holds no keys; it can only read, and propose. I ask how my vault is doing, and it reads my position straight from Coston2 and the indexer." |
| Agent returns collateral, debt, rate, and CR; then calls `get_vault_health` (ICR, FTSOv2 liquidation price, price buffer) and `get_at_risk_vaults` — vault is healthy. | "It reports my collateral ratio against the 130% minimum, shows the FTSOv2 price at which I'd be liquidatable, and confirms I'm not on the at-risk list." |
| Prompt: "The price dipped — repay 5 vUSD to be safe." Agent calls MCP `adjust_vault` (repay) → returns an **unsigned** one-payment plan (Core-Vault destination, exact drops, 0xFE memo, packed userOp). | "I tell it to de-risk. The agent builds a repay through the same 0xFE path — a single fees-only XRPL payment. But it can't execute it: it hands me back an unsigned payment. Only I can sign." |
| User signs the payment in their XRP wallet; client submits `{ xrplTxId, packedUserOpHex, memoUserOpHash }` to the executor `/mint/submit`; mint tracker walks to done; explorer shows the repay tx and improved CR. | "I sign once; the executor settles it; my debt drops and my collateral ratio climbs — driven by an agent talking to Vulcra over MCP, without ever surrendering a key." |
| Beat: the **TEE Guardian**. Cut to the FCC/TEE registration (status 2 = PRODUCTION) on the Coston2 `FlareTeeManager`. | "And if I'd rather automate protection, the opt-in TEE Guardian runs this same repay logic inside a Flare Confidential Compute enclave — my private trigger thresholds never touch a public source, so no one can front-run my protection." |

> The read/quote tools only need RPC; the intent tools + `get_at_risk_vaults` need the executor
> (`:8787`) and indexer running. All endpoints they wrap are already live on Coston2.

---

## Segment 3 — Close (2:50–3:00)

| Shot | Narration |
|---|---|
| Split screen: XRPL payment ↔ Coston2 receipts. Title: "Vulcra — FAssets · FTSOv2 · FDC · Smart Accounts · FCC." | "One XRPL signature. Six Flare primitives. A full CDP, an Earn pool, and an AI agent — all on Coston2, all live. That's Vulcra." |

---

## Pre-flight checklist (so the take is clean)

- Backend executor running (`:8787`) with a funded key + FDC/FTSO env; indexer running.
- Frontend on `/borrow/xrp`; Crossmark on **XRPL testnet** with faucet XRP.
- Coston2 explorer tab pre-opened to the FXRP `VaultManager`
  (`0x93e572cDbfb62557E041B53490e5208C147b5388`) and vUSD
  (`0x333FDCf66792122e80654E197Eb6Fa3705f1B6D8`).
- FDC attestation can lag through XRPL indexing — start recording the mint-tracker beat with a little
  buffer; the executor retries automatically.
- For Segment 2, register the Vulcra MCP with your agent client before rolling:
  `claude mcp add vulcra -- npx tsx <repo>/backend/apps/mcp/src/index.ts` (executor + indexer up).
