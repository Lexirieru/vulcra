# packages/userop — the 0xFE custom-instruction core

Builds everything the XRPL-native path commits to: the **0xFE memo**, the **PackedUserOperation**, and
the **vault call batches** that run from the PersonalAccount when the direct mint settles. Pure,
chain-read-free construction (viem encoding only) — resolution/reads live in `@vulcra/chain-client`.

## What's here (`src/`, re-exported via `index.ts`)

- `calls.ts` — `Call[]` batches for the whole lifecycle (each is what `PersonalAccount.executeUserOp`
  runs): `buildZapMintCalls` (open: approve FXRP + `zap.openVaultAndForward`), `buildAddCollateralCalls`,
  `buildWithdrawCollateralCalls`, `buildMintMoreCalls`, `buildRepayCalls`, `buildCloseCalls`
  (reads full debt → approve + `closeVault`), `buildAdjustRateCalls`. Plus `encodeExecuteUserOp`.
- `buildMint.ts` — `buildManageUserOp({sender, nonce, calls, executorFeeUBA})`: the generic 0xFE wrapper
  (encodeExecuteUserOp → buildPackedUserOp → encode → userOpHash → `encodeMintMemo`). Open-vault uses the mint variant.
- `memo.ts` — the 42-byte 0xFE memo: opcode `0xFE` + walletId + 8-byte executorFeeUBA + 32-byte userOpHash = `keccak256(PackedUserOperation)`.
- `packedUserOp.ts` — ABI-encode / hash the EIP-4337-style `PackedUserOperation`.
- `payment.ts` — `computeRequiredXrpDrops({netMintDrops, mintFeeBips, minFeeUBA, executorFeeUBA})`, drops↔XRP helpers.
- `personalAccount.ts` — `getPersonalAccount` / `getNonce` (against MasterAccountController).

## The one rule to remember

**net-mint > 0** → the XRPL payment carries collateral, FXRP is minted, calls open/add-collateral.
**net-mint = 0** → fees-only "memo-only": no FXRP minted, but the committed calls still run
(borrow-more / repay / withdraw / adjust-rate / close). Same 0xFE path for the entire vault lifecycle.

The XRPL Payment must carry **NO destination tag** (a tag reroutes the direct mint).

## 🔒 Security
No secrets here (pure construction). Never commit `.env`, `references/`, or `VULCRA_PRD.md`.
