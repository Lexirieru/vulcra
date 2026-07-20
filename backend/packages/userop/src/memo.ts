import {
  concat,
  numberToHex,
  size,
  slice,
  hexToBigInt,
  hexToNumber,
  isHex,
  type Hex,
} from "viem";

/**
 * Smart-account direct-minting memo encoders.
 *
 * All memos share the same 42-byte header shape:
 *   [ opcode(1B) | walletId(1B) | executorFeeUBA(8B big-endian) | tail(32B) ]
 *
 * Verified against the flare-smart-accounts skill (mirrors smart-accounts/
 * custom-instruction docs):
 *   0xFE  Custom Instruction   tail = keccak256(abi.encode(userOp))   (hash-commit)
 *   0xE0  Skip memo (recover)  tail = stuck XRPL transaction id
 *   0xE1  Fast-forward nonce   tail = new nonce (uint256)
 *
 * CRITICAL: XRPL payments to a smart account MUST NOT carry a destination tag —
 * a tag reroutes the direct mint to the tag holder. These encoders never emit one.
 */

export const MEMO_LENGTH_BYTES = 42;

export const MemoOpcode = {
  CustomInstruction: 0xfe,
  SkipMemo: 0xe0,
  FastForwardNonce: 0xe1,
} as const;

function assertUint(value: bigint | number, bits: number, label: string): void {
  const v = typeof value === "number" ? BigInt(value) : value;
  if (v < 0n || v >= 1n << BigInt(bits)) {
    throw new Error(`${label} out of range for uint${bits}: ${v}`);
  }
}

function assertBytes32(value: Hex, label: string): void {
  if (!isHex(value) || size(value) !== 32) {
    throw new Error(`${label} must be a 32-byte hex value`);
  }
}

function encodeMemo(opcode: number, walletId: number, executorFeeUBA: bigint, tail32: Hex): Hex {
  assertUint(walletId, 8, "walletId");
  assertUint(executorFeeUBA, 64, "executorFeeUBA");
  assertBytes32(tail32, "memo tail");
  const memo = concat([
    numberToHex(opcode, { size: 1 }),
    numberToHex(walletId, { size: 1 }),
    numberToHex(executorFeeUBA, { size: 8 }), // big-endian uint64
    tail32,
  ]);
  if (size(memo) !== MEMO_LENGTH_BYTES) {
    throw new Error(`encoded memo is ${size(memo)} bytes, expected ${MEMO_LENGTH_BYTES}`);
  }
  return memo;
}

/** 0xFE — commit `keccak256(abi.encode(userOp))`. */
export function encodeMintMemo(args: {
  walletId: number;
  executorFeeUBA: bigint;
  userOpHash: Hex;
}): Hex {
  return encodeMemo(
    MemoOpcode.CustomInstruction,
    args.walletId,
    args.executorFeeUBA,
    args.userOpHash,
  );
}

/** 0xE0 — mark a stuck transaction's memo to be skipped on recovery. */
export function encodeSkipMemo(args: {
  walletId: number;
  executorFeeUBA: bigint;
  targetTxId: Hex;
}): Hex {
  return encodeMemo(MemoOpcode.SkipMemo, args.walletId, args.executorFeeUBA, args.targetTxId);
}

/** 0xE1 — fast-forward the PersonalAccount memo-instruction nonce past an abandoned slot. */
export function encodeFastForwardMemo(args: {
  walletId: number;
  executorFeeUBA: bigint;
  newNonce: bigint;
}): Hex {
  assertUint(args.newNonce, 256, "newNonce");
  const nonce32 = numberToHex(args.newNonce, { size: 32 });
  return encodeMemo(
    MemoOpcode.FastForwardNonce,
    args.walletId,
    args.executorFeeUBA,
    nonce32,
  );
}

export interface DecodedMemo {
  opcode: number;
  walletId: number;
  executorFeeUBA: bigint;
  tail: Hex; // 32-byte hash / txId / nonce
}

/** Decode any 42-byte Vulcra memo back into its fields. */
export function decodeMemo(memo: Hex): DecodedMemo {
  if (!isHex(memo) || size(memo) !== MEMO_LENGTH_BYTES) {
    throw new Error(`memo must be ${MEMO_LENGTH_BYTES} bytes`);
  }
  return {
    opcode: hexToNumber(slice(memo, 0, 1)),
    walletId: hexToNumber(slice(memo, 1, 2)),
    executorFeeUBA: hexToBigInt(slice(memo, 2, 10)),
    tail: slice(memo, 10, 42),
  };
}

/** XRPL MemoData carries hex WITHOUT the `0x` prefix. */
export function toXrplMemoData(memo: Hex): string {
  return memo.slice(2).toUpperCase();
}
