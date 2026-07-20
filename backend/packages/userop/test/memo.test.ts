import { describe, it, expect } from "vitest";
import { size, slice, hexToNumber, hexToBigInt } from "viem";
import {
  encodeMintMemo,
  encodeSkipMemo,
  encodeFastForwardMemo,
  decodeMemo,
  toXrplMemoData,
  MEMO_LENGTH_BYTES,
  MemoOpcode,
} from "../src/memo.js";

const HASH32 =
  "0xabababababababababababababababababababababababababababababababab" as const;

describe("0xFE mint memo layout", () => {
  it("is exactly 42 bytes with the correct byte layout", () => {
    const memo = encodeMintMemo({ walletId: 3, executorFeeUBA: 100_000n, userOpHash: HASH32 });
    expect(size(memo)).toBe(MEMO_LENGTH_BYTES);
    // byte 0 = 0xFE
    expect(hexToNumber(slice(memo, 0, 1))).toBe(MemoOpcode.CustomInstruction);
    // byte 1 = walletId
    expect(hexToNumber(slice(memo, 1, 2))).toBe(3);
    // bytes 2..9 = executorFeeUBA, big-endian uint64
    expect(hexToBigInt(slice(memo, 2, 10))).toBe(100_000n);
    // bytes 10..41 = the 32-byte hash tail
    expect(slice(memo, 10, 42).toLowerCase()).toBe(HASH32);
  });

  it("round-trips through decodeMemo", () => {
    const memo = encodeMintMemo({ walletId: 0, executorFeeUBA: 250_000n, userOpHash: HASH32 });
    const d = decodeMemo(memo);
    expect(d.opcode).toBe(MemoOpcode.CustomInstruction);
    expect(d.walletId).toBe(0);
    expect(d.executorFeeUBA).toBe(250_000n);
    expect(d.tail.toLowerCase()).toBe(HASH32);
  });

  it("emits XRPL MemoData without the 0x prefix, uppercase, 84 hex chars", () => {
    const memo = encodeMintMemo({ walletId: 0, executorFeeUBA: 1n, userOpHash: HASH32 });
    const data = toXrplMemoData(memo);
    expect(data.startsWith("0x")).toBe(false);
    expect(data).toBe(data.toUpperCase());
    expect(data.length).toBe(MEMO_LENGTH_BYTES * 2);
  });
});

describe("memo input validation (a bad byte must throw, not silently mis-encode)", () => {
  it("rejects walletId > 255", () => {
    expect(() => encodeMintMemo({ walletId: 256, executorFeeUBA: 0n, userOpHash: HASH32 })).toThrow();
  });
  it("rejects executorFeeUBA that overflows uint64", () => {
    expect(() =>
      encodeMintMemo({ walletId: 0, executorFeeUBA: 1n << 64n, userOpHash: HASH32 }),
    ).toThrow();
  });
  it("rejects a non-32-byte hash tail", () => {
    expect(() =>
      encodeMintMemo({ walletId: 0, executorFeeUBA: 0n, userOpHash: "0x1234" }),
    ).toThrow();
  });
});

describe("recovery memos share the 42-byte header shape", () => {
  it("0xE0 skip memo targets the stuck tx id", () => {
    const txId = "0xdeadbeef".padEnd(66, "0") as `0x${string}`;
    const memo = encodeSkipMemo({ walletId: 1, executorFeeUBA: 100_000n, targetTxId: txId });
    expect(size(memo)).toBe(MEMO_LENGTH_BYTES);
    const d = decodeMemo(memo);
    expect(d.opcode).toBe(MemoOpcode.SkipMemo);
    expect(d.tail.toLowerCase()).toBe(txId.toLowerCase());
  });

  it("0xE1 fast-forward encodes the new nonce as a 32-byte big-endian value", () => {
    const memo = encodeFastForwardMemo({ walletId: 0, executorFeeUBA: 100_000n, newNonce: 42n });
    const d = decodeMemo(memo);
    expect(d.opcode).toBe(MemoOpcode.FastForwardNonce);
    expect(hexToBigInt(d.tail)).toBe(42n);
  });

  it("0xE1 rejects a nonce that overflows uint256", () => {
    expect(() =>
      encodeFastForwardMemo({ walletId: 0, executorFeeUBA: 0n, newNonce: 1n << 256n }),
    ).toThrow();
  });
});
