import { describe, it, expect } from "vitest";
import { computeRequiredXrpDrops, dropsToXrpString } from "../src/payment.js";

describe("computeRequiredXrpDrops", () => {
  it("uses the percentage fee when it exceeds the floor", () => {
    // 100 XRP net, 0.25% = 0.25 XRP > 0.1 XRP floor
    const r = computeRequiredXrpDrops({
      netMintDrops: 100_000_000n,
      mintFeeBips: 25n,
      minFeeUBA: 100_000n,
      executorFeeUBA: 100_000n,
    });
    expect(r.mintFeeDrops).toBe(250_000n);
    expect(r.totalDrops).toBe(100_000_000n + 250_000n + 100_000n);
  });

  it("uses the floor when the percentage is below it (small mint)", () => {
    // 1 XRP net, 0.25% = 0.0025 XRP < 0.1 XRP floor => floor applies
    const r = computeRequiredXrpDrops({
      netMintDrops: 1_000_000n,
      mintFeeBips: 25n,
      minFeeUBA: 100_000n,
      executorFeeUBA: 100_000n,
    });
    expect(r.mintFeeDrops).toBe(100_000n);
    expect(r.totalDrops).toBe(1_000_000n + 100_000n + 100_000n);
  });

  it("rejects negative net mint", () => {
    expect(() =>
      computeRequiredXrpDrops({ netMintDrops: -1n, mintFeeBips: 25n, minFeeUBA: 0n, executorFeeUBA: 0n }),
    ).toThrow();
  });
});

describe("dropsToXrpString", () => {
  it("formats whole and fractional drops", () => {
    expect(dropsToXrpString(1_000_000n)).toBe("1");
    expect(dropsToXrpString(1_500_000n)).toBe("1.5");
    expect(dropsToXrpString(100_000n)).toBe("0.1");
    expect(dropsToXrpString(1_234_567n)).toBe("1.234567");
  });
});
