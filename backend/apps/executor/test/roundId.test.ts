import { describe, it, expect } from "vitest";
import { computeRoundId } from "../src/attestation/roundId.js";

describe("computeRoundId", () => {
  it("floors (blockTs - firstStart)/epochDuration", () => {
    expect(
      computeRoundId({
        blockTimestamp: 1000n + 90n * 42n + 30n,
        firstVotingRoundStartTs: 1000n,
        votingEpochDurationSeconds: 90n,
      }),
    ).toBe(42n);
  });
  it("throws on zero epoch duration", () => {
    expect(() =>
      computeRoundId({ blockTimestamp: 100n, firstVotingRoundStartTs: 0n, votingEpochDurationSeconds: 0n }),
    ).toThrow();
  });
  it("throws when the block precedes the first round", () => {
    expect(() =>
      computeRoundId({ blockTimestamp: 10n, firstVotingRoundStartTs: 100n, votingEpochDurationSeconds: 90n }),
    ).toThrow();
  });
});
