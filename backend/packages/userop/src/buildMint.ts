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
export function buildMintUserOp(args: {
  sender: Address; // PersonalAccount
  nonce: bigint; // getNonce(personalAccount)
  fxrp: Address;
  zap: Address;
  collateral6: bigint;
  mint18: bigint;
  vusdDestination: Address;
  walletId?: number;
  executorFeeUBA: bigint;
  prevHint?: Address;
  nextHint?: Address;
}): BuiltMint {
  const calls = buildZapMintCalls({
    fxrp: args.fxrp,
    zap: args.zap,
    collateral6: args.collateral6,
    mint18: args.mint18,
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
