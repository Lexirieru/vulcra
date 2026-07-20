import { describe, it, expect } from "vitest";
import { keccak256, toHex } from "viem";
import { InMemoryMintStore } from "../src/orchestrator/store.js";
import {
  intakeMint,
  applyExecuteOutcome,
  beginExecute,
  beginRetry,
} from "../src/orchestrator/orchestrator.js";

const userOpBytes = toHex("some-userop-bytes-placeholder");
const goodHash = keccak256(userOpBytes);

describe("intakeMint (R10 hash check)", () => {
  it("accepts a userOp whose keccak matches the 0xFE memo commitment", () => {
    const store = new InMemoryMintStore();
    const rec = intakeMint(store, {
      id: "mint:1",
      xrplTxId: "0xTX1",
      userOpBytes,
      memoUserOpHash: goodHash,
    });
    expect(rec.state).toBe("ATTEST_REQUESTED");
  });

  it("REJECTS a userOp whose hash does not match the memo (would revert on-chain)", () => {
    const store = new InMemoryMintStore();
    const rec = intakeMint(store, {
      id: "mint:2",
      xrplTxId: "0xTX2",
      userOpBytes,
      memoUserOpHash: keccak256(toHex("different-bytes")),
    });
    expect(rec.state).toBe("REJECTED");
    expect(rec.lastError).toMatch(/hash mismatch/i);
  });

  it("is idempotent on xrplTxId (no duplicate on-chain submit)", () => {
    const store = new InMemoryMintStore();
    const a = intakeMint(store, { id: "mint:3", xrplTxId: "0xTX3", userOpBytes, memoUserOpHash: goodHash });
    const b = intakeMint(store, { id: "mint:3b", xrplTxId: "0xTX3", userOpBytes, memoUserOpHash: goodHash });
    expect(b.id).toBe(a.id);
  });
});

describe("delay-retry cycle (AE1)", () => {
  it("DELAYED persists executionAllowedAt, retry increments attempts and re-executes", () => {
    const store = new InMemoryMintStore();
    intakeMint(store, { id: "m", xrplTxId: "0xT", userOpBytes, memoUserOpHash: goodHash });
    // advance to EXECUTING
    store.update("m", { state: "PROOF_READY" });
    beginExecute(store, "m");
    expect(store.get("m")!.state).toBe("EXECUTING");

    // rate-limit delay
    applyExecuteOutcome(store, "m", { kind: "delayed", executionAllowedAt: 2_000_000n });
    let rec = store.get("m")!;
    expect(rec.state).toBe("DELAYED");
    expect(rec.executionAllowedAt).toBe(2_000_000n);

    // due retries picked up when time passes
    expect(store.dueRetries(1_999_999n)).toHaveLength(0);
    expect(store.dueRetries(2_000_000n).map((r) => r.id)).toContain("m");

    // retry with the SAME proof
    beginRetry(store, "m");
    rec = store.get("m")!;
    expect(rec.state).toBe("EXECUTING");
    expect(rec.attempts).toBe(1);

    // eventually executes
    applyExecuteOutcome(store, "m", { kind: "executed", txHash: "0xabc" });
    expect(store.get("m")!.state).toBe("EXECUTED");
  });

  it("resumable() returns non-terminal mints for restart recovery (durability)", () => {
    const store = new InMemoryMintStore();
    intakeMint(store, { id: "r1", xrplTxId: "0xR1", userOpBytes, memoUserOpHash: goodHash });
    store.update("r1", { state: "DELAYED", executionAllowedAt: 5n });
    intakeMint(store, { id: "r2", xrplTxId: "0xR2", userOpBytes, memoUserOpHash: goodHash });
    store.update("r2", { state: "EXECUTED" });
    expect(store.resumable().map((r) => r.id)).toEqual(["r1"]);
  });
});

describe("revert path (AE4)", () => {
  it("EXECUTING -> REVERTED records the error", () => {
    const store = new InMemoryMintStore();
    intakeMint(store, { id: "x", xrplTxId: "0xX", userOpBytes, memoUserOpHash: goodHash });
    store.update("x", { state: "EXECUTING" });
    applyExecuteOutcome(store, "x", { kind: "reverted", error: "CallFailed: debt below minimum" });
    const rec = store.get("x")!;
    expect(rec.state).toBe("REVERTED");
    expect(rec.lastError).toMatch(/debt below minimum/);
  });
});
