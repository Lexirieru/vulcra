import { keccak256, type Hex } from "viem";
import { transition, type MintRecord } from "./state.js";
import type { MintStore } from "./store.js";

/**
 * Mint orchestrator — intake + state transitions. Chain I/O (attestation,
 * submit, recovery) is injected so this core is unit-testable without a chain.
 */

export interface IntakeArgs {
  id: string;
  xrplTxId: string;
  userOpBytes: Hex;
  /** The 32-byte hash committed in the XRPL 0xFE memo. */
  memoUserOpHash: Hex;
}

/**
 * Intake a submitted mint. Recomputes keccak256(userOpBytes) and requires it
 * equals the memo hash — a mismatch would revert on-chain with
 * CustomInstructionHashMismatch, so it is REJECTED here (R10 hash check).
 * Idempotent on xrplTxId.
 */
export function intakeMint(store: MintStore, args: IntakeArgs): MintRecord {
  const existing = store.getByXrplTxId(args.xrplTxId);
  if (existing) return existing; // idempotent — no duplicate submit

  const recomputed = keccak256(args.userOpBytes);
  const now = Date.now();
  const base: MintRecord = {
    id: args.id,
    xrplTxId: args.xrplTxId,
    userOpBytes: args.userOpBytes,
    userOpHash: recomputed,
    state: "INTAKE",
    attempts: 0,
    createdAt: now,
    updatedAt: now,
  };

  if (recomputed.toLowerCase() !== args.memoUserOpHash.toLowerCase()) {
    store.create({ ...base, state: transition("INTAKE", "HASH_MISMATCH"), lastError: "hash mismatch: userOp bytes do not match the 0xFE memo commitment" });
    return store.get(args.id)!;
  }
  store.create({ ...base, state: transition("INTAKE", "HASH_OK") });
  return store.get(args.id)!;
}

export type ExecuteOutcome =
  | { kind: "executed"; txHash: Hex }
  | { kind: "delayed"; executionAllowedAt: bigint }
  | { kind: "reverted"; error: string };

/** Apply the on-chain execution outcome to a mint that is EXECUTING. */
export function applyExecuteOutcome(
  store: MintStore,
  id: string,
  outcome: ExecuteOutcome,
): MintRecord {
  const rec = store.get(id);
  if (!rec) throw new Error(`mint ${id} not found`);
  switch (outcome.kind) {
    case "executed":
      return store.update(id, { state: transition(rec.state, "EXECUTED") });
    case "delayed":
      return store.update(id, {
        state: transition(rec.state, "DELAYED"),
        executionAllowedAt: outcome.executionAllowedAt,
      });
    case "reverted":
      return store.update(id, {
        state: transition(rec.state, "REVERTED"),
        lastError: outcome.error,
      });
  }
}

/** Move a DELAYED mint back to EXECUTING for a same-proof retry (AE1). */
export function beginRetry(store: MintStore, id: string): MintRecord {
  const rec = store.get(id);
  if (!rec) throw new Error(`mint ${id} not found`);
  return store.update(id, {
    state: transition(rec.state, "RETRY"),
    attempts: rec.attempts + 1,
  });
}

/** Move PROOF_READY -> EXECUTING (submitting). */
export function beginExecute(store: MintStore, id: string): MintRecord {
  const rec = store.get(id);
  if (!rec) throw new Error(`mint ${id} not found`);
  return store.update(id, { state: transition(rec.state, "SUBMIT") });
}
