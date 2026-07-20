import { describe, it, expect } from "vitest";
import { size, slice, hexToNumber } from "viem";
import {
  decideRecovery,
  validateFastForward,
  buildSkipMemo,
  buildFastForwardMemo,
} from "../src/recovery/recovery.js";

const STUCK_TX = ("0x" + "de".repeat(32)) as `0x${string}`;

describe("decideRecovery (AE4)", () => {
  it("recovers via 0xE0 when the stuck txId is not yet used on-chain", () => {
    expect(decideRecovery({ isTxIdUsed: false })).toBe("SKIP_0xE0");
  });
  it("no-ops when the txId is already used (someone finalized it)", () => {
    expect(decideRecovery({ isTxIdUsed: true })).toBe("ALREADY_MINTED");
  });
});

describe("0xE0 skip memo", () => {
  it("is a 42-byte memo (opcode 0xE0) targeting the stuck tx id", () => {
    const memo = buildSkipMemo({ walletId: 0, executorFeeUBA: 100_000n, stuckTxId: STUCK_TX });
    expect(size(memo)).toBe(42);
    expect(hexToNumber(slice(memo, 0, 1))).toBe(0xe0);
    expect(slice(memo, 10, 42).toLowerCase()).toBe(STUCK_TX);
  });
});

describe("0xE1 fast-forward validation", () => {
  it("requires the stuck payment to be minted first", () => {
    expect(() =>
      validateFastForward({ currentNonce: 1n, newNonce: 2n, isTxIdUsed: false }),
    ).toThrow(/0xE0 recovery first/);
  });
  it("requires newNonce strictly greater than current", () => {
    expect(() =>
      validateFastForward({ currentNonce: 5n, newNonce: 5n, isTxIdUsed: true }),
    ).toThrow(/strictly greater/);
  });
  it("rejects a jump beyond uint32.max", () => {
    expect(() =>
      validateFastForward({ currentNonce: 0n, newNonce: (1n << 32n) + 1n, isTxIdUsed: true }),
    ).toThrow(/uint32/);
  });
  it("builds a valid 0xE1 memo after passing validation", () => {
    const memo = buildFastForwardMemo({
      walletId: 0,
      executorFeeUBA: 100_000n,
      currentNonce: 3n,
      newNonce: 7n,
      isTxIdUsed: true,
    });
    expect(size(memo)).toBe(42);
    expect(hexToNumber(slice(memo, 0, 1))).toBe(0xe1);
  });
});
