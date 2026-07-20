import { describe, it, expect } from "vitest";
import { keccak256, toHex } from "viem";
import { InMemoryMintStore } from "../src/orchestrator/store.js";
import { intakeMint } from "../src/orchestrator/orchestrator.js";
import { makeMintProcessor, type ProcessorHooks } from "../src/processor.js";

const userOpBytes = toHex("processor-userop");
const goodHash = keccak256(userOpBytes);

function seed() {
  const store = new InMemoryMintStore();
  intakeMint(store, { id: "m", xrplTxId: "0xTX", userOpBytes, memoUserOpHash: goodHash });
  return store;
}

function baseHooks(overrides: Partial<ProcessorHooks> = {}): ProcessorHooks {
  return {
    attest: async () => ({ proof: { data: { ok: true } } }),
    submit: async () => ({ kind: "executed", txHash: "0xabc" }),
    scheduleRetry: (_at, fn) => fn(), // fire immediately for the test
    isTxIdUsed: async () => false,
    recover: async () => {},
    now: () => 1_000_000n,
    ...overrides,
  };
}

describe("mint processor control flow", () => {
  it("drives attest -> submit -> EXECUTED on the happy path", async () => {
    const store = seed();
    const p = makeMintProcessor(store, baseHooks());
    await p.processMint("m");
    expect(store.get("m")!.state).toBe("EXECUTED");
  });

  it("AE1: on DirectMintingDelayed retries the SAME proof at executionAllowedAt until EXECUTED", async () => {
    const store = seed();
    let submitCalls = 0;
    const proofs: unknown[] = [];
    const p = makeMintProcessor(
      store,
      baseHooks({
        submit: async ({ proof }) => {
          submitCalls += 1;
          proofs.push(proof);
          return submitCalls === 1
            ? { kind: "delayed", executionAllowedAt: 2_000_000n }
            : { kind: "executed", txHash: "0xdone" };
        },
      }),
    );
    await p.processMint("m");
    expect(submitCalls).toBe(2); // delayed then retried
    expect(proofs[0]).toEqual(proofs[1]); // SAME proof reused
    expect(store.get("m")!.state).toBe("EXECUTED");
    expect(store.get("m")!.attempts).toBe(1);
  });

  it("AE4: on revert enters recovery (0xE0) when the stuck tx is not yet used", async () => {
    const store = seed();
    let recovered = false;
    const p = makeMintProcessor(
      store,
      baseHooks({
        submit: async () => ({ kind: "reverted", error: "CallFailed: debt below minimum" }),
        isTxIdUsed: async () => false,
        recover: async () => {
          recovered = true;
        },
      }),
    );
    await p.processMint("m");
    expect(store.get("m")!.state).toBe("REVERTED");
    expect(recovered).toBe(true);
  });

  it("skips recovery when the stuck tx is already minted (ALREADY_MINTED)", async () => {
    const store = seed();
    let recoverCalled = false;
    const p = makeMintProcessor(
      store,
      baseHooks({
        submit: async () => ({ kind: "reverted", error: "revert" }),
        isTxIdUsed: async () => true, // already minted
        recover: async () => {
          recoverCalled = true;
        },
      }),
    );
    await p.processMint("m");
    expect(recoverCalled).toBe(false);
  });

  it("records a pipeline error without throwing", async () => {
    const store = seed();
    const p = makeMintProcessor(
      store,
      baseHooks({
        attest: async () => {
          throw new Error("verifier rejected: TRANSACTION DOES NOT EXIST");
        },
      }),
    );
    await p.processMint("m");
    expect(store.get("m")!.lastError).toMatch(/TRANSACTION DOES NOT EXIST/);
  });
});
