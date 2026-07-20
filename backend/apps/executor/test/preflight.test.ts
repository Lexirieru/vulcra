import { describe, it, expect } from "vitest";
import { preflightMint, type PreflightParams } from "../src/preflight/preflight.js";

const VALID_ADDR = "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh";
const NOW = 1_000_000n;

function base(overrides: Partial<PreflightParams> = {}): PreflightParams {
  return {
    xrplAddress: VALID_ADDR,
    netMintDrops: 50_000_000n, // 50 XRP
    mint18: 100_000000000000000000n, // 100 vUSD
    minFeeUBA: 100_000n, // 0.1 XRP
    mintFeeBips: 25n,
    executorFeeUBA: 100_000n,
    hourly: { limit: 100_000_000_000n, consumed: 0n, windowStart: NOW },
    daily: { limit: 500_000_000_000n, consumed: 0n, windowStart: NOW },
    largeThreshold: 100_000_000_000n,
    largeDelaySeconds: 3600n,
    unblockUntil: 0n,
    minDebt18: 100_000000000000000000n,
    nowSeconds: NOW,
    ...overrides,
  };
}

describe("preflightMint (R12)", () => {
  it("passes a normal mint and returns the required payment", () => {
    const r = preflightMint(base());
    expect(r.ok).toBe(true);
    expect(r.willDelay).toBe(false);
    expect(r.requiredPaymentDrops).toBeGreaterThan(50_000_000n);
  });

  it("AE2: blocks a sub-minimum-fee mint BEFORE any memo/payment is issued", () => {
    const r = preflightMint(base({ netMintDrops: 50_000n })); // below 0.1 XRP floor
    expect(r.ok).toBe(false);
    expect(r.blockedReason).toMatch(/minimum minting fee|unrecoverable/i);
    expect(r.willDelay).toBe(false);
  });

  it("blocks an invalid recipient address (unrecoverable wrong recipient)", () => {
    const r = preflightMint(base({ xrplAddress: "rNotARealAddress000000" }));
    expect(r.ok).toBe(false);
    expect(r.blockedReason).toMatch(/invalid XRPL/i);
  });

  it("blocks debt below the protocol minimum (vault-open would revert)", () => {
    const r = preflightMint(base({ mint18: 1n }));
    expect(r.ok).toBe(false);
    expect(r.blockedReason).toMatch(/below the protocol minimum/i);
  });

  it("flags a delayed-not-failed mint when it exceeds the large threshold", () => {
    const r = preflightMint(base({ netMintDrops: 100_000_000_001n }));
    expect(r.ok).toBe(true);
    expect(r.willDelay).toBe(true);
    expect(r.delayReasons).toContain("large-mint");
  });
});
