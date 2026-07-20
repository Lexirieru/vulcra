import { describe, it, expect } from "vitest";
import {
  scaleBy10,
  xrpUsdPrice18,
  collateralValueUsd18,
  collateralValueUsd18At,
  usd18ToCollateral,
  crBps,
  usd18ToFxrp6,
} from "../src/decimals.js";

describe("scaleBy10", () => {
  it("multiplies for positive exponent, divides for negative", () => {
    expect(scaleBy10(5n, 0)).toBe(5n);
    expect(scaleBy10(5n, 3)).toBe(5000n);
    expect(scaleBy10(5000n, -3)).toBe(5n);
  });
});

describe("xrpUsdPrice18", () => {
  it("normalizes a 5-decimal feed to 18 decimals", () => {
    // value 284000 at 5 decimals = $2.84 -> 2.84e18
    expect(xrpUsdPrice18(284_000n, 5)).toBe(2_840000000000000000n);
  });
  it("handles feed decimals == 18 (no scaling)", () => {
    expect(xrpUsdPrice18(2_840000000000000000n, 18)).toBe(2_840000000000000000n);
  });
  it("handles feed decimals == 0", () => {
    expect(xrpUsdPrice18(3n, 0)).toBe(3_000000000000000000n);
  });
  it("handles feed decimals > 12 (negative exponent branch in collateral math)", () => {
    // price18 for 24-decimal feed divides by 10^6
    expect(xrpUsdPrice18(2_840000000000000000000000n, 24)).toBe(2_840000000000000000n);
  });
});

describe("collateralValueUsd18", () => {
  it("1 FXRP (1e6) at $2.84 (5-dec feed) is worth 2.84e18 USD", () => {
    expect(collateralValueUsd18(1_000_000n, 284_000n, 5)).toBe(2_840000000000000000n);
  });
  it("returns 0 for zero collateral", () => {
    expect(collateralValueUsd18(0n, 284_000n, 5)).toBe(0n);
  });
  it("is precise across the 18-6-decimals sign boundary (decimals 8 vs 5)", () => {
    // decimals 8: exp = 18-6-8 = 4 (>0); $2.84 at 8dp = 284_000_000
    expect(collateralValueUsd18(1_000_000n, 284_000_000n, 8)).toBe(2_840000000000000000n);
    // decimals 5: exp = 18-6-5 = 7 (>0), same USD value
    expect(collateralValueUsd18(1_000_000n, 284_000n, 5)).toBe(2_840000000000000000n);
  });
});

describe("collateralValueUsd18At (branch-aware collateral decimals)", () => {
  it("FXRP: 1 FXRP (6-dec) at $2.84 (6-dec feed) = $2.84", () => {
    // $2.84 at 6-dec feed => value 2_840_000
    expect(collateralValueUsd18At(1_000_000n, 6, 2_840_000n, 6)).toBe(2_840000000000000000n);
  });

  it("wFLR: 1000 wFLR (18-dec) at $0.02 (8-dec feed) = $20", () => {
    // $0.02 at 8-dec feed => value 2_000_000 (0.02 * 1e8)
    expect(collateralValueUsd18At(1000_000000000000000000n, 18, 2_000_000n, 8)).toBe(
      20_000000000000000000n,
    );
  });

  it("matches the legacy 6-dec helper for FXRP inputs", () => {
    expect(collateralValueUsd18At(1_000_000n, 6, 284_000n, 5)).toBe(
      collateralValueUsd18(1_000_000n, 284_000n, 5),
    );
  });
});

describe("usd18ToCollateral (branch-aware)", () => {
  it("wFLR: $20 buys 1000 wFLR at $0.02", () => {
    expect(usd18ToCollateral(20_000000000000000000n, 18, 2_000_000n, 8)).toBe(
      1000_000000000000000000n,
    );
  });
});

describe("crBps", () => {
  it("computes collateral ratio in bps", () => {
    // collateral $130, debt $100 -> 13000 bps (130%)
    expect(crBps(130_000000000000000000n, 100_000000000000000000n)).toBe(13000n);
  });
  it("just below MCR", () => {
    expect(crBps(129_000000000000000000n, 100_000000000000000000n)).toBe(12900n);
  });
  it("treats zero debt as 0 (caller: not-liquidatable / not-at-risk)", () => {
    expect(crBps(100n, 0n)).toBe(0n);
  });
});

describe("usd18ToFxrp6", () => {
  it("converts a USD amount to FXRP at the current price", () => {
    // $2.84 of value at $2.84/XRP = 1 FXRP = 1e6
    expect(usd18ToFxrp6(2_840000000000000000n, 284_000n, 5)).toBe(1_000_000n);
  });
  it("throws on zero price", () => {
    expect(() => usd18ToFxrp6(1n, 0n, 5)).toThrow();
  });
});
