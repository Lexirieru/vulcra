import type { Address, Hex } from "viem";
import { buildZapMintCalls, encodeExecuteUserOp, type Call } from "./calls.js";
import {
  buildPackedUserOp,
  encodePackedUserOp,
  userOpHash,
  type PackedUserOperation,
} from "./packedUserOp.js";
import { encodeMintMemo, toXrplMemoData } from "./memo.js";

export interface BuiltMint {
  calls: Call[];
  userOp: PackedUserOperation;
  /** ABI-encoded userOp bytes — the `_data` the executor passes to executeDirectMintingWithData. */
  userOpBytes: Hex;
  /** keccak256(userOpBytes) — committed in the memo and re-checked on-chain. */
  userOpHash: Hex;
  /** 42-byte 0xFE memo (0x-prefixed). */
  memo: Hex;
  /** XRPL MemoData hex (no 0x prefix, uppercase). */
  xrplMemoData: string;
}

/**
 * THE canonical mint builder — shared by the frontend (to render the QR / Xaman
 * deep link) and the executor (to verify keccak256(_data) == memo hash before
 * submitting). Pure given (sender, nonce, addresses): no chain access here, so
 * the hash is fully unit-testable and identical on both sides.
 */
/**
 * Generic 0xFE user-op builder for a ready-made Call[] batch (the MANAGE side:
 * repay / close / add-collateral / adjust-rate). Identical wrapping to the mint
 * — same executeUserOp callData, same PackedUserOperation, same 42-byte memo —
 * so the executor path (attest -> executeDirectMintingWithData) is unchanged.
 * The caller supplies the calls; net mint is decided by the XRPL payment amount
 * (0 for a memo-only manage transaction).
 */
export function buildManageUserOp(args: {
  sender: Address; // PersonalAccount
  nonce: bigint;
  calls: Call[];
  walletId?: number;
  executorFeeUBA: bigint;
}): BuiltMint {
  const callData = encodeExecuteUserOp(args.calls);
  const userOp = buildPackedUserOp({ sender: args.sender, nonce: args.nonce, callData });
  const userOpBytes = encodePackedUserOp(userOp);
  const hash = userOpHash(userOp);
  const memo = encodeMintMemo({
    walletId: args.walletId ?? 0,
    executorFeeUBA: args.executorFeeUBA,
    userOpHash: hash,
  });
  return { calls: args.calls, userOp, userOpBytes, userOpHash: hash, memo, xrplMemoData: toXrplMemoData(memo) };
}

export function buildMintUserOp(args: {
  sender: Address; // PersonalAccount
  nonce: bigint; // getNonce(personalAccount)
  fxrp: Address;
  zap: Address;
  /**
   * The collateral the XRPL payment funds. Used by the CALLER to size the XRP
   * amount (via computeRequiredXrpDrops); it is NOT baked into the userOp calls
   * anymore — the Zap reads the PA's live FXRP balance at execution
   * (openVaultAndForwardAll), so fee/AMG rounding can't strand the mint.
   */
  collateral6: bigint;
  mint18: bigint;
  /** V2 interest rate for the new vault (bps/year). Pass VaultManager.defaultInterestRateBps() for XRPL UX. */
  annualInterestRateBps: bigint;
  vusdDestination: Address;
  walletId?: number;
  executorFeeUBA: bigint;
  prevHint?: Address;
  nextHint?: Address;
}): BuiltMint {
  const calls = buildZapMintCalls({
    fxrp: args.fxrp,
    zap: args.zap,
    mint18: args.mint18,
    annualInterestRateBps: args.annualInterestRateBps,
    vusdDestination: args.vusdDestination,
    prevHint: args.prevHint,
    nextHint: args.nextHint,
  });
  const callData = encodeExecuteUserOp(calls);
  const userOp = buildPackedUserOp({ sender: args.sender, nonce: args.nonce, callData });
  const userOpBytes = encodePackedUserOp(userOp);
  const hash = userOpHash(userOp);
  const memo = encodeMintMemo({
    walletId: args.walletId ?? 0,
    executorFeeUBA: args.executorFeeUBA,
    userOpHash: hash,
  });
  return {
    calls,
    userOp,
    userOpBytes,
    userOpHash: hash,
    memo,
    xrplMemoData: toXrplMemoData(memo),
  };
}
