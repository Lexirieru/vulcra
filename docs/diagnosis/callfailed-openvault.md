# Diagnosis — XRPL-native `openVault` reverts with `CallFailed(bytes)` (0xa5fa8d2b)

**Date:** 2026-08-12 · **Branch:** FXRP · **Network:** Coston2 (114)
**Symptom:** FDC attestation + proof succeed; `AssetManagerFXRP.executeDirectMintingWithData(proof, data)`
reverts with selector `0xa5fa8d2b` = `CallFailed(bytes)`. The FXRP mint step is logically fine; the
wrapped `PersonalAccount.executeUserOp([approve, Zap.openVaultAndForward])` reverts and bubbles up as
`CallFailed`. Fails identically at collateral 2 FXRP and 0.08 FXRP.

> **TL;DR — most-likely root cause:** the E2E is re-opening a vault on a **PersonalAccount that already
> has an active vault**. `_open` reverts at its very first line (`VaultExists()`, selector `0x4239717c`)
> *before* any amount/collateral logic, so it fails identically regardless of collateral or mint size.
> The XRPL-native `openVault` path itself already works — there are two live vaults on Coston2 that were
> opened through exactly this Zap path. The fix is (a) operationally: use a fresh r-address / close first,
> and (b) code-hardening: guard the executor against building a doomed `openVault` for a PA that already
> has a vault (and against a mint that would fail MCR). Confirm by decoding the inner `CallFailed(bytes)`.

---

## 1. Exact `Call[]` built for `openVault`, and what each call requires

### Build path (backend)

1. **`backend/apps/executor/src/mintBuilder.ts` → `buildMintPlan`**
   - Resolves `personalAccount` (`getPersonalAccount(mac, xrplAddress)`, L94), `nonce` (L95),
     `defaultRate` = `VaultManager.defaultInterestRateBps()` (L98, live = **500**), fees, Core Vault addr.
   - `rateBps = input.annualInterestRateBps ?? defaultRate` (L105) → **500** for the 1-payment UX.
   - `vusdDestination = input.vusdDestination ?? personalAccount` (L106) → the PA.
   - Sets **`netMintDrops: input.collateral6`** (L110) — i.e. it assumes the amount of FXRP credited to
     the PA after fees equals `collateral6`.
   - Calls `buildMintUserOp({sender: PA, nonce, fxrp, zap, collateral6, mint18, rate, vusdDestination, executorFeeUBA})` (L115–126).
   - **No check anywhere that the PA has no existing vault, and no MCR feasibility check.**

2. **`backend/packages/userop/src/buildMint.ts` → `buildMintUserOp`** → `buildZapMintCalls`
   (`backend/packages/userop/src/calls.ts` L59–96) produces exactly two calls:

   - **`Call[0]` — `FXRP.approve(zap, collateral6)`**
     `target = fxrp` (0x0b6A…3dc7), `data = erc20.approve(zap=0xCe4f…9dfE, collateral6)` (calls.ts L70–78).
   - **`Call[1]` — `zap.openVaultAndForward(collateral6, mint18, 500, vusdDestination=PA, prevHint=0, nextHint=0)`**
     `target = zap`, `data = vulcraZap.openVaultAndForward(...)` (calls.ts L79–94).

   Both are wrapped by `encodeExecuteUserOp([Call0, Call1])` (calls.ts L268–274) → `callData`, then
   `buildPackedUserOp({sender: PA, nonce, callData})` (packedUserOp.ts L61–77), ABI-encoded, hashed, and
   committed in the 42-byte memo.

### On-chain execution order

`executeDirectMintingWithData` mints the net FXRP **to the PA**, then runs `PA.executeUserOp([Call0, Call1])`:

- **Call0** `FXRP.approve(zap, collateral6)` — from the PA. Always succeeds.
- **Call1** `VulcraZap.openVaultAndForward` — `smartcontract/src/VulcraZap.sol` L48–63:
  - `fxrpToken.safeTransferFrom(msg.sender /*=PA*/, address(this), collateral6)` (L57)
  - `fxrpToken.forceApprove(vaultManager, collateral6)` (L58)
  - `vaultManager.openVaultFor(msg.sender /*=PA*/, collateral6, mint18, 500, vusdDestination, 0, 0)` (L60–62)
- **`VaultManager.openVaultFor`** — `smartcontract/src/VaultManager.sol` L243–254:
  `whenNotPaused nonReentrant onlyRole(ZAP_ROLE)` → `_open(owner=PA, payer=Zap, …)`.
- **`_open`** — VaultManager.sol L256–293, in order:
  1. **L266 `if (vaults[owner].active) revert VaultExists();`**  ← first guard
  2. L267 `if (collateral6 == 0 || mint18 == 0) revert ZeroAmount();`
  3. L268 `_requireRateInBounds(rateBps)` → `InterestRateOutOfBounds` if `rate ∉ [min,max]`
  4. L269–271 `fee = mint18*mintFeeBps/1e4; debt = mint18+fee; if (debt < minDebt18) revert DebtBelowMin();`
  5. L273 `_settleAggInterest()`
  6. L274 `if (debtCeiling != 0 && totalDebt+debt > debtCeiling) revert DebtCeilingExceeded();`
  7. **L275 `_requireHealthy(collateral6, debt)`** → `CRTooLow` if `CR < mcrBps` (L686–690)
  8. L288 `collateralToken.safeTransferFrom(payer=Zap, this, collateral6)`
  9. L289 `vusdToken.mint(debtRecipient=PA, mint18)`; L290 mint fee to feeReceiver.

**Requirements summary for Call1 to succeed:** Zap holds `ZAP_ROLE` (verified ✓); PA holds ≥ `collateral6`
FXRP after mint; **PA has no active vault**; `debt ≥ minDebt18`; `CR ≥ mcrBps`; `rate ∈ [min,max]`; not
paused; ceiling OK.

---

## 2. Hypotheses (with code citations)

### Live Coston2 facts gathered for this diagnosis (via `cast`)

| Value | Source | Result |
|---|---|---|
| `VaultManager.params()` (FXRP) | 0x93e5…5388 | `mcrBps=13000` (130%), **`minDebt18=5e16` (0.05 vUSD)**, `mintFeeBps=50`, `redemptionFeeBps=0` |
| `PriceOracle.price18()` | 0x63Bf…953B | `1.016806e18` → **XRP ≈ $1.0168** |
| `defaultInterestRateBps / min / max` | VM | `500 / 50 / 25000` (500 is in-bounds ✓) |
| `Zap.vaultManager()` / `Zap.fxrpToken()` | 0xCe4f…9dfE | `0x93e5…5388` (FXRP VM ✓) / `0x0b6A…3dc7` (FXRP token ✓) |
| `vaultCount()` | VM | **2 active vaults** |
| vault A `0xecE0…E919` | VM | 30 FXRP, 6.04 vUSD debt, **rate 500**, owner is a **contract** |
| vault B `0x3290…38D2` | VM | 7 FXRP, 5.04 vUSD debt, **rate 500**, owner is a **contract** |
| `previewOpen(80000, 5e16)` | VM | CR **16181 bps (161%)**, meetsMcr=**true**, meetsMinDebt=**true** |
| `previewOpen(2000000, 1e18)` | VM | CR **20226 bps (202%)**, meetsMcr=**true**, meetsMinDebt=**true** |
| `previewOpen(80000, 1e18)` | VM | CR **808 bps (8%)**, meetsMcr=**false** |

Note the deployment note in `smartcontract/deployments/coston2.json` — *"per-collateral minDebt lowered
on-chain for faucet-limited testing"* — is real: config `Coston2Config.fxrpParams()` says `minDebt18=100e18`,
but the **live** value is `5e16` (0.05 vUSD). This is decisive for the feasibility hypotheses below.

---

### H1 — `VaultExists()` — the PA already has a vault  ★ MOST LIKELY

**Claim:** the E2E targeted a PersonalAccount that already holds an active vault, so `_open` reverts at
VaultManager.sol **L266** (`if (vaults[owner].active) revert VaultExists();`) before touching any
amount/collateral/CR logic.

**Supporting evidence:**
- `_open`'s first statement is the `VaultExists` guard (L266) — it fires *identically* for any
  `collateral6`/`mint18`, matching "2 FXRP and 0.08 FXRP fail identically."
- **The XRPL Zap path demonstrably works:** both live vaults (`0xecE0…E919`, `0x3290…38D2`) are owned by
  **smart-account contracts** (bytecode present) and both carry `annualInterestRateBps = 500` — the
  `defaultInterestRateBps` that VaultManager.sol L77–78 documents as *"applied to XRPL-native (Zap) opens
  so the 1-payment UX needs no rate choice."* An EVM open lets the user pick a rate; a value of exactly
  500 on both is the Zap fingerprint. So `openVaultFor` via the Zap has already succeeded on-chain.
- **`CLAUDE.md` states the canonical test address's PA already has a live vault:** *"paste
  `TEST_XRPL_ADDRESS`; its PersonalAccount has a live vault on Coston2."* If the E2E used `TEST_XRPL_ADDRESS`
  (the obvious, documented choice), every re-open reverts with `VaultExists()`.
- **No pre-payment guard exists:** `mintBuilder.buildMintPlan` and `preflightMint`
  (`backend/apps/executor/src/preflight/preflight.ts` L45–108) never read `vaults[owner].active`, so the
  executor cheerfully builds a doomed `openVault` userOp for an already-open PA.

**Refuting evidence:** none found. The only way to refute is to confirm the E2E used a fresh PA (then see H2/H3).

---

### H2 — `CRTooLow()` / `DebtBelowMin()` — `mint18` mis-sized for the collateral

**Claim:** with a fresh PA, `_open` could still revert at L271 (`DebtBelowMin`) or L275/`_requireHealthy`
(`CRTooLow`) if `mint18` is outside the valid window for the collateral.

**Supporting/limiting evidence:**
- Feasibility window **is non-empty** at the live params for *both* test amounts (`previewOpen` above), so
  a correctly-sized `mint18` opens fine (0.08 FXRP + 0.05 vUSD → 161%; 2 FXRP + 1 vUSD → 202%). This means
  the amounts themselves are **not** the problem — it would require the harness to pick a bad `mint18`.
- To fail *identically at both* amounts via this path, the harness would need a **fixed** `mint18` that is
  invalid at both: e.g. a fixed `mint18 > ~1.556 vUSD` (CRTooLow at both — `previewOpen(80000,1e18)`
  already shows meetsMcr=false at 0.08 FXRP), or a fixed `mint18` in the wrong decimals so `debt < minDebt`
  at both (`DebtBelowMin`). The frontend, however, sizes `mint18` against `maxMintableVusd18`
  (`frontend/src/components/xrpl/XrplMintFlow.tsx` L162–164, L187, L460 "Exceeds the max borrow at MCR"),
  so a UI-driven test would not do this. A raw script hitting `/mint/build` could.
- **Gap:** `preflightMint` only blocks `mint18 < minDebt18` (preflight.ts L77–81). It does **not** check
  the MCR ceiling (`CR ≥ mcrBps`) — so an over-borrow that yields `CRTooLow` passes preflight and reverts
  on-chain.

**Verdict:** plausible only if the harness fed a bad `mint18`; refuted for correctly-sized mints. Decide via §4 decode.

---

### H3 — mint-fee reduces credited FXRP below `collateral6` (approve/transferFrom shortfall)

**Claim:** `Call0` approves `collateral6` and `Zap` pulls `collateral6` (VulcraZap.sol L57), but if the PA
is credited **less** than `collateral6` FXRP after fees, the `safeTransferFrom` reverts with
`ERC20InsufficientBalance` (`0xe450d38c`).

**Refuting evidence (strong):**
- FAssets deducts both the minting fee and executor fee **from the payment** (confirmed via `flare-fassets`
  skill: *"Percentage-based minting fee (with a minimum floor) + a flat executor fee, both deducted from the
  payment."*). `computeRequiredXrpDrops` (`backend/packages/userop/src/payment.ts` L14–25) sets
  `total = collateral6 + max(minFee, collateral6·bips/1e4) + executorFee`, so the intended net credited to
  the PA is exactly `collateral6`.
- On Coston2 the **minimum-fee floor dominates** for these amounts: `minFeeUBA = 0.1 FXRP = 100000 UBA`,
  while `0.5% × 2 FXRP = 10000 UBA` (and `× 0.08 FXRP = 400 UBA`). With the floor binding, the contract's
  actual fee equals the executor's assumed fee, so `net credited = collateral6` **exactly** → no shortfall.
- **The "supply" (addCollateral, net-mint>0) manage op is proven on-chain** (`CLAUDE.md`, root `README.md`):
  it also does `FXRP.approve(amount6)` + `VaultManager.addCollateral(amount6)` pulling freshly-minted FXRP
  from the PA. If net-credited were ever short of the approved amount, `supply` would fail too. It doesn't.

**Residual risk:** AMG (asset-minting-granularity) rounding could floor the credited amount by sub-UBA dust,
but that is tiny and would also break `supply`. Low likelihood. Decide via §4 (would show `0xe450d38c`).

---

### H4 — role / wiring / decimals / pause / rate / ceiling — ruled out

- `ZAP_ROLE`: task confirmed `hasRole(ZAP_ROLE, Zap)=true`; `Zap.vaultManager()`=FXRP VM (verified here).
- Decimals: `collateral6`/approve/transferFrom all 6-dec FXRP; `mint18` 18-dec vUSD. Consistent (calls.ts,
  VulcraZap.sol, VaultManager.sol).
- `paused()` = **false** (checked live) → not `EnforcedPause` (`0xd93c0665`).
- Rate 500 ∈ [50, 25000] → not `InterestRateOutOfBounds` (`0x2e9d5a4e`).
- FXRP `debtCeiling = 0` (unlimited, `Coston2Config` L27) → not `DebtCeilingExceeded` (`0xe24734c2`).
- Token mismatch: `mintBuilder` uses `resolveFxrpToken` = `0x0b6A…3dc7` = `Zap.fxrpToken()` = VM
  `collateralToken`. Consistent.

---

## 3. Recommended root cause + concrete proposed fix (DO NOT APPLY — PM reviews)

**Root cause (single most-likely): `VaultExists()` — the E2E re-opens a vault on a PersonalAccount that
already holds one** (the documented `TEST_XRPL_ADDRESS` PA, or one of the two live Zap-opened vaults).
`_open` reverts at VaultManager.sol L266 before any amount logic, which is exactly why 2 FXRP and 0.08 FXRP
fail identically.

### Fix A — operational (unblocks immediately, no code change)
Run the openVault E2E with a **fresh XRPL r-address whose PersonalAccount has no vault**, or **close the
existing vault first** (`buildCloseCalls`, `backend/packages/userop/src/calls.ts` L154–171) before re-opening.
Pick a valid `mint18` with `previewOpen` (see §4).

### Fix B — code hardening (the real gap; recommended patch)
Make the executor refuse to build a doomed `openVault` *before* the user pays, mirroring the on-chain guards.

- **File:** `backend/apps/executor/src/services.ts`, inside the `preflight(input)` closure (around L56–101).
  Additionally read, in the same `Promise.all`:
  - `VaultManager.getVault(personalAccount)` → `active` (the PA must be resolved here, as
    `account()` already does via `getPersonalAccount`), and
  - `VaultManager.previewOpen(netMintDrops /*collateral6*/, mint18)` → `(debt18, crBps, meetsMcr, meetsMinDebt)`.
  Pass `alreadyHasVault` and `meetsMcr` into `preflightMint`.

- **File:** `backend/apps/executor/src/preflight/preflight.ts`
  - Add fields `alreadyHasVault: boolean` and `meetsMcr: boolean` to `PreflightParams` (L15–31).
  - Add two blocks alongside the existing `mint18 < minDebt18` check (after L81):
    ```ts
    if (p.alreadyHasVault) {
      return blocked(
        "this XRPL address already has an open vault — the open would revert (VaultExists). " +
          "Use manage (add collateral / borrow more) instead.",
      );
    }
    if (!p.meetsMcr) {
      return blocked(
        "requested vUSD exceeds the max borrow at MCR for this collateral — the open would revert (CRTooLow). " +
          "Lower the vUSD amount or supply more XRP.",
      );
    }
    ```

- **File:** `backend/apps/executor/src/mintBuilder.ts` — optional belt-and-braces: in `buildMintPlan`,
  after resolving `personalAccount` (L94), read `VaultManager.getVault(personalAccount).active` and throw a
  typed error if active, so `/mint/build` cannot hand back a userOp that is guaranteed to revert.

No smart-contract change is needed — the contract behaviour is correct. This is purely a pre-payment guard
so the executor stops emitting `openVault` userOps that on-chain `_open` will reject.

> Note: `preflightMint` currently checks `mint18 < minDebt18` but **not** the MCR ceiling; adding the
> `meetsMcr` block also closes the H2/`CRTooLow` gap regardless of which error is confirmed in §4.

---

## 4. Cheap reproduction + how to decode the inner `CallFailed(bytes)`

### Reproduce within testnet limits (net mint ≤ 0.1 FXRP)
Direct-minting caps: hourly/daily/large-mint threshold all `0.1 FXRP`, min fee `0.1 FXRP`. Keep
`collateral6 = 80000` (**0.08 FXRP < 0.1**), so no large-mint delay and within the hourly window.

1. Off-chain, pick a valid mint with a **free** `previewOpen` (no XRP spent):
   ```bash
   cast call 0x93e572cDbfb62557E041B53490e5208C147b5388 \
     "previewOpen(uint256,uint256)(uint256,uint256,bool,bool)" \
     80000 50000000000000000 --rpc-url https://coston2-api.flare.network/ext/C/rpc
   # -> debt 5.025e16, CR 16181 bps, meetsMcr=true, meetsMinDebt=true  (collateral6=0.08 FXRP, mint18=0.05 vUSD)
   ```
2. To reproduce the **failure**, aim the open at a PA that already has a vault (e.g. the `TEST_XRPL_ADDRESS`
   PA). To reproduce a **success**, use a fresh r-address (new PA). Total XRP ≈ `0.08 + 0.1 (minFee) +
   executorFee` ≈ < 0.2 XRP.

### Decode the inner error (decisive step)
`CallFailed(bytes)` wraps the inner call's raw returndata; for a no-arg custom error the inner bytes are
just its 4-byte selector. From the reverted `executeDirectMintingWithData` returndata (from the executor's
captured error, `cast run <txhash>`, or an explorer trace):

```bash
# strip the outer 0xa5fa8d2b, ABI-decode the single `bytes` arg to get the inner returndata:
cast abi-decode "f(bytes)" 0x<full CallFailed returndata>
# then map the first 4 bytes of the decoded value to:
```

| Inner selector | Error | Meaning → which hypothesis |
|---|---|---|
| `0x4239717c` | `VaultExists()` | **H1 — PA already has a vault (expected)** |
| `0x513fbea3` | `CRTooLow()` | H2 — `mint18` too large for collateral |
| `0xf1e41913` | `DebtBelowMin()` | H2 — `debt < minDebt18` |
| `0x1f2a2005` | `ZeroAmount()` | collateral6 or mint18 == 0 |
| `0xe450d38c` | `ERC20InsufficientBalance(address,uint256,uint256)` | H3 — PA credited < collateral6 (mint recipient/amount) |
| `0xfb8f41b2` | `ERC20InsufficientAllowance(address,uint256,uint256)` | Call0 approve didn't land / wrong spender |
| `0xe2517d3f` | `AccessControlUnauthorizedAccount(address,bytes32)` | Zap lacks `ZAP_ROLE` (ruled out) |
| `0xd93c0665` | `EnforcedPause()` | VM paused (live: false) |

Selectors verified with `cast sig` against the live contracts. If the decoded inner selector is
`0x4239717c`, H1 is confirmed and Fix A unblocks immediately; Fix B prevents recurrence.

---

## PM CORRECTION (fact-verified, 12 Aug) — VaultExists is REFUTED

The "VaultExists()" root-cause above is **wrong for the real test PA**. Verified on-chain, not assumed:

- Executor resolves `rHS3D3sFavuMHP8jwK2vauHGuUDAsnmoog` → PA `0x6F6639e41facC53017823eb5dcF9da7e3F95E3d4` (`/account` endpoint), and `getVault(0x6F66).active = false`. So the PA has NO vault → `VaultExists` cannot be the cause.
- Captured the **real inner revert bytes** (temporary executor log patch, since reverted): outer `CallFailed(bytes)` `0xa5fa8d2b` wraps inner `CallFailed(uint256,bytes)` `0x5c0dee5d` with args **(index = 1, reason = 0x empty)**. So `executeUserOp` reports **Call index 1 (`Zap.openVaultAndForward`) reverted with EMPTY data**.
- Simulated `VaultManager.openVaultFor` from the Zap (`eth_call`): all checks (VaultExists/ZeroAmount/rate/DebtBelowMin/DebtCeiling/CRTooLow) **PASS** for the test amounts (0.08 FXRP / 0.05 vUSD → CR 161%). Higher mint (0.5 vUSD) correctly returns `CRTooLow` — proving the sim is faithful.
- `openVaultAndForward` from the PA with allowance=0 returns a **reason'd** `ERC20: insufficient allowance` — so the transfer path gives reasons. In the real flow Call[0] sets the allowance, so the transfer succeeds.
- `SortedVaults.insert` reverts with `AlreadyInList()`/`ZeroId()` (reason'd), never empty — ruled out.
- `executeUserOp` itself works: the spDeposit E2E (net-0) went through this exact PA. Two live vaults at rate 500 prove the Zap-open path succeeded before.

**Conclusion (fact-grounded):** FDC + FXRP mint + all vault checks + the collateral transfer PASS. The failure is an **EMPTY revert inside `openVaultAndForward` specific to the net-mint>0 path**, occurring after checks+transfer — consistent with the Coston2 FCC/Smart-Account **redeploy** breaking the direct-minting↔executeUserOp integration (empty reverts are characteristic of a call into changed/mismatched code). Definitive next step: `debug_traceCall` of the exact userOp to name the precise opcode/frame, then align the executor's direct-minting components with the redeployed stack (cf. the FCC re-register the admin flagged). No Vulcra contract change is implicated by the evidence so far.

**Note on `debug_traceCall`:** the Coston2 public RPC (`coston2-api.flare.network`)
returns `-32601 method does not exist` for `debug_traceCall`/`debug_traceTransaction`,
so a full opcode-level trace of the empty revert is not possible on the public
endpoint — it would need an archive/debug-enabled Coston2 node. The isolation above
(inner `CallFailed(1, 0x)` = empty revert at `openVaultAndForward`, after checks +
transfer pass) is the strongest fact-based diagnosis available without one.

---

## BREAKTHROUGH (anvil fork trace, current Coston2 state) — Vulcra contracts are CORRECT

Forked Coston2 at the live block with `anvil`, impersonated the PA, set the FXRP
allowance to the Zap, and called `Zap.openVaultAndForward(0.08 FXRP, 0.05 vUSD, 500, PA, 0, 0)`
**directly**. Full trace result:

```
transferFrom(Zap -> VaultManager, 80000)  ✓
vusd.mint(PA, 5e16)                        ✓   (borrowed vUSD)
vusd.mint(feeReceiver, 2.5e14)            ✓   (mint fee)
emit VaultOpened(PA, 80000, 5.025e16, 500) ✓
Transaction successfully executed. Gas used: 570059
```

So on the **current** deployed state, the Vulcra path (Zap → VaultManager → SortedVaults
→ vUSD) opens a vault **successfully**. The empty revert therefore does NOT originate in
any Vulcra contract — it originates in the **wrapping layer that Vulcra does not own**:
the FAssets `executeDirectMintingWithData` mint step and/or the Flare Smart Account userOp
executor that runs the committed `Call[]`. That is exactly the layer the Coston2 redeploy
touched.

**Final conclusion (fact-grounded):** Vulcra's own contracts are proven correct against
live state; the XRPL-native `net-mint>0` open is blocked by the redeployed Flare
Smart-Account / FAssets direct-minting layer, not by Vulcra code. "Re-sync the stack"
means aligning with (or waiting for) that redeployed Flare layer — a Flare-infra matter
to raise with the hackathon admins (whose guides are still catching up), NOT a Vulcra
contract change. The EVM open path and all net-0 XRPL manage ops (repay/close/adjust/
spDeposit) are unaffected.

---

## ROOT CAUSE FOUND (FAssets v1.3 source) + fix plan

Researched the current Flare docs + the `flare-foundation/fassets` source. The Coston2
redeploy is **FAssets v1.3**, which restructured direct-minting-with-data.

**What v1.3 changed** (`contracts/assetManager/facets/DirectMintingFacet.sol`):
- `executeDirectMintingWithData(IXRPPayment.Proof, bytes _data)` still exists, but the
  with-data (smart-account) path now runs `_mintToSmartAccounts`:
  - requires a `mintingTagManager` **and** a `smartAccountManager` to be set (new);
  - **mints the FXRP to the `smartAccountManager`** (a new `IMemoInstructionsFacet`
    contract), NOT directly to the PersonalAccount;
  - calls `smartAccountManager.handleMintedFAssets(txId, sourceAddress, amount, ts,
    memoData, executor, fullData)`, and that contract parses `memoData` + `fullData`
    to route the FXRP to the PA and execute the committed calls.
- New gates confirmed in source/tests: `InvalidExecutor` (allowed-executor set in the
  memo via `PaymentReference.directMintingEx(minter, executor)`), `OnlyProofOwner`
  (proof-use binding), hourly/daily mint caps (0.1 / 0.5 FXRP on Coston2), and
  large-mint delays (>0.1 FXRP threshold).

**Why spDeposit works but openVault does not:** net-0 ops (repay/close/adjust/spDeposit)
go through the MasterAccountController custom-instruction path, which still accepts
Vulcra's 0xFE memo. net-mint>0 open goes through the NEW DirectMintingFacet →
`smartAccountManager.handleMintedFAssets` path, whose expected `memoData`/`fullData`
format Vulcra's pre-v1.3 encoding no longer matches → the committed call reverts with
empty data. This matches every fact: FDC ok, checks ok, transfer ok, `openVaultAndForward`
succeeds in isolation (anvil), but the wrapped execution via the v1.3 smartAccountManager
fails.

**Fix plan (off-chain only — NO Vulcra contract change):**
1. `backend/packages/userop` + `backend/apps/executor/src/mintBuilder.ts`: re-encode the
   XRPL memo and the `_data` (fullData) to the v1.3 `IMemoInstructionsFacet` /
   `PaymentReference.directMinting[Ex]` format the current `smartAccountManager` expects
   (set minter + allowed executor in the memo; commit the userOp the way v1.3 parses it).
2. Bind the executor: set the executor address in the memo and as the FDC proof's
   `proofOwner` (v1.3 `InvalidExecutor` / `OnlyProofOwner`).
3. Keep mints ≤ 0.1 FXRP/hr on Coston2, or handle the large-mint delay event.
4. Remaining unknown for an exact byte layout: the deployed `smartAccountManager`
   (`IMemoInstructionsFacet`) implementation — pull it from the flare-smart-accounts
   deployment or use `@flarenetwork/smart-accounts-encoder`, then re-run the ≤0.1 FXRP
   E2E to confirm a real vault opens.

Source refs: flare-foundation/fassets — `DirectMintingFacet.sol`, `IDirectMinting.sol`,
`mock/SmartAccountManagerMock.sol` (`handleMintedFAssets` signature),
`test/integration/assetManager/14-DirectMinting.ts`; Flare docs "Direct Mint FXRP" +
"How FAssets evolves in v1.3".
