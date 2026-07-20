import { describe, it, expect } from "vitest";
import { transition, isTerminal } from "../src/orchestrator/state.js";

describe("mint state machine", () => {
  it("walks the happy path INTAKE -> EXECUTED", () => {
    let s = transition("INTAKE", "HASH_OK");
    expect(s).toBe("ATTEST_REQUESTED");
    s = transition(s, "ATTEST_SUBMITTED");
    s = transition(s, "FINALIZED");
    s = transition(s, "SUBMIT");
    expect(s).toBe("EXECUTING");
    s = transition(s, "EXECUTED");
    expect(s).toBe("EXECUTED");
    expect(isTerminal(s)).toBe(true);
  });

  it("delays then retries the same proof (AE1)", () => {
    const delayed = transition("EXECUTING", "DELAYED");
    expect(delayed).toBe("DELAYED");
    expect(transition(delayed, "RETRY")).toBe("EXECUTING");
  });

  it("reverts then recovers (AE4)", () => {
    const reverted = transition("EXECUTING", "REVERTED");
    const recovering = transition(reverted, "RECOVER_START");
    expect(recovering).toBe("RECOVERING");
    expect(transition(recovering, "RECOVERED")).toBe("RECOVERED");
  });

  it("rejects a hash mismatch at intake", () => {
    expect(transition("INTAKE", "HASH_MISMATCH")).toBe("REJECTED");
    expect(isTerminal("REJECTED")).toBe(true);
  });

  it("throws on an illegal transition", () => {
    expect(() => transition("EXECUTED", "RETRY")).toThrow(/illegal/);
    expect(() => transition("INTAKE", "EXECUTED")).toThrow(/illegal/);
  });
});
