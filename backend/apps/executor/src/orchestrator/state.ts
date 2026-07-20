/**
 * Mint lifecycle state machine (pure) — the durable core of the executor (KTD2).
 *
 * A delayed mint is NOT a failure: on DirectMintingDelayed / LargeDirectMintingDelayed
 * the machine goes DELAYED and later RETRYs the SAME proof at executionAllowedAt
 * (AE1). A revert goes REVERTED -> RECOVERING (0xE0) -> RECOVERED (AE4).
 */

export type MintState =
  | "INTAKE"
  | "ATTEST_REQUESTED"
  | "ATTEST_FINALIZING"
  | "PROOF_READY"
  | "EXECUTING"
  | "DELAYED"
  | "EXECUTED"
  | "REVERTED"
  | "RECOVERING"
  | "RECOVERED"
  | "REJECTED";

export type MintEvent =
  | "HASH_OK"
  | "HASH_MISMATCH"
  | "ATTEST_SUBMITTED"
  | "FINALIZED"
  | "PROOF_FETCHED"
  | "SUBMIT"
  | "EXECUTED"
  | "DELAYED"
  | "RETRY"
  | "REVERTED"
  | "RECOVER_START"
  | "RECOVERED";

const TRANSITIONS: Record<MintState, Partial<Record<MintEvent, MintState>>> = {
  INTAKE: { HASH_OK: "ATTEST_REQUESTED", HASH_MISMATCH: "REJECTED" },
  ATTEST_REQUESTED: { ATTEST_SUBMITTED: "ATTEST_FINALIZING" },
  ATTEST_FINALIZING: { FINALIZED: "PROOF_READY" },
  PROOF_READY: { PROOF_FETCHED: "PROOF_READY", SUBMIT: "EXECUTING" },
  EXECUTING: { EXECUTED: "EXECUTED", DELAYED: "DELAYED", REVERTED: "REVERTED" },
  DELAYED: { RETRY: "EXECUTING" },
  REVERTED: { RECOVER_START: "RECOVERING" },
  RECOVERING: { RECOVERED: "RECOVERED", REVERTED: "REVERTED" },
  EXECUTED: {},
  RECOVERED: {},
  REJECTED: {},
};

export const TERMINAL_STATES: ReadonlySet<MintState> = new Set([
  "EXECUTED",
  "RECOVERED",
  "REJECTED",
]);

export function isTerminal(state: MintState): boolean {
  return TERMINAL_STATES.has(state);
}

/** Apply an event; throws on an illegal transition (guards against silent corruption). */
export function transition(state: MintState, event: MintEvent): MintState {
  const next = TRANSITIONS[state][event];
  if (!next) {
    throw new Error(`illegal mint transition: ${state} --${event}-->`);
  }
  return next;
}

export interface MintRecord {
  id: string;
  xrplTxId: string;
  userOpBytes: `0x${string}`;
  userOpHash: `0x${string}`;
  state: MintState;
  proofJson?: string;
  executionAllowedAt?: bigint;
  attempts: number;
  lastError?: string;
  createdAt: number;
  updatedAt: number;
}
