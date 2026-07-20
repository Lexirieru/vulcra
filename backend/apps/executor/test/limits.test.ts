import { describe, it, expect } from "vitest";
import { evaluateMintDelay, type LimiterState } from "../src/preflight/limits.js";

const NOW = 1_000_000n; // arbitrary UTC seconds
const fresh = (limit: bigint): LimiterState => ({ limit, consumed: 0n, windowStart: NOW });

describe("evaluateMintDelay", () => {
  it("does not delay a mint within all headroom", () => {
    const r = evaluateMintDelay({
      amount: 10n,
      hourly: fresh(100n),
      daily: fresh(500n),
      largeThreshold: 1000n,
      largeDelaySeconds: 3600n,
      unblockUntil: 0n,
      nowSeconds: NOW,
    });
    expect(r.willDelay).toBe(false);
    expect(r.executionAllowedAt).toBe(NOW);
  });

  it("delays past remaining hourly headroom to the next hourly window", () => {
    const r = evaluateMintDelay({
      amount: 80n,
      hourly: { limit: 100n, consumed: 50n, windowStart: NOW }, // headroom 50 < 80
      daily: fresh(500n),
      largeThreshold: 1000n,
      largeDelaySeconds: 3600n,
      unblockUntil: 0n,
      nowSeconds: NOW,
    });
    expect(r.willDelay).toBe(true);
    expect(r.reasons).toContain("hourly-limit");
    // next hourly boundary
    expect(r.executionAllowedAt).toBe((NOW / 3600n) * 3600n + 3600n);
  });

  it("resets a stale on-chain window to full headroom", () => {
    const r = evaluateMintDelay({
      amount: 90n,
      hourly: { limit: 100n, consumed: 100n, windowStart: NOW - 7200n }, // 2h old -> resets to 0
      daily: fresh(500n),
      largeThreshold: 1000n,
      largeDelaySeconds: 3600n,
      unblockUntil: 0n,
      nowSeconds: NOW,
    });
    expect(r.willDelay).toBe(false);
  });

  it("applies the large-mint delay even with full window headroom (strictly above threshold)", () => {
    const r = evaluateMintDelay({
      amount: 1001n,
      hourly: fresh(100_000n),
      daily: fresh(500_000n),
      largeThreshold: 1000n,
      largeDelaySeconds: 3600n,
      unblockUntil: 0n,
      nowSeconds: NOW,
    });
    expect(r.willDelay).toBe(true);
    expect(r.reasons).toContain("large-mint");
    expect(r.executionAllowedAt).toBe(NOW + 3600n);
  });

  it("does not treat exactly-at-threshold as large", () => {
    const r = evaluateMintDelay({
      amount: 1000n,
      hourly: fresh(100_000n),
      daily: fresh(500_000n),
      largeThreshold: 1000n,
      largeDelaySeconds: 3600n,
      unblockUntil: 0n,
      nowSeconds: NOW,
    });
    expect(r.willDelay).toBe(false);
  });

  it("governance unblock frees the windows but NOT the large-mint delay", () => {
    const r = evaluateMintDelay({
      amount: 2000n,
      hourly: { limit: 100n, consumed: 100n, windowStart: NOW }, // would delay, but unblocked
      daily: { limit: 100n, consumed: 100n, windowStart: NOW },
      largeThreshold: 1000n,
      largeDelaySeconds: 3600n,
      unblockUntil: NOW + 10n,
      nowSeconds: NOW,
    });
    expect(r.reasons).toContain("hourly-daily-unblocked");
    expect(r.reasons).toContain("large-mint");
    expect(r.executionAllowedAt).toBe(NOW + 3600n);
  });

  it("binds to the furthest-out delay when multiple rules apply", () => {
    const r = evaluateMintDelay({
      amount: 2000n,
      hourly: { limit: 100n, consumed: 100n, windowStart: NOW },
      daily: fresh(1_000_000n),
      largeThreshold: 1000n,
      largeDelaySeconds: 100_000n, // large delay pushes further than the next hour
      unblockUntil: 0n,
      nowSeconds: NOW,
    });
    expect(r.executionAllowedAt).toBe(NOW + 100_000n);
  });
});
