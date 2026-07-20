import { describe, it, expect } from "vitest";
import type { Address } from "viem";
import type { VaultRow } from "../src/store.js";
import { atRisk, sortByNicrAsc, vaultCrBps } from "../src/sortedByCr.js";

// Price fixture: XRP/USD = $1.00 expressed as feedValue=1, feedDecimals=0.
// Then collateralValueUsd18(collateral6, 1, 0) = collateral6 * 1e12, i.e. each
// FXRP unit (1e6) is worth $1e18. With debt fixed at 100 vUSD (100e18), a vault
// holding N FXRP has CR = N * 100 bps  (e.g. 129 FXRP -> 12900 bps = 129%).
const FEED_VALUE = 1n;
const FEED_DECIMALS = 0;
const DEBT_100 = 100_000000000000000000n;

const addr = (n: number): Address =>
  (`0x${n.toString(16).padStart(40, "0")}`) as Address;

function vault(owner: number, fxrp: bigint, nicr: bigint, debt18 = DEBT_100): VaultRow {
  return {
    owner: addr(owner),
    collateral6: fxrp,
    debt18,
    nicr,
    active: true,
    lastBlock: 1n,
    lastTxHash: "0x",
  };
}

// CR 120 / 129 / 135 / 180 / 300 percent at the $1 fixture.
const v120 = vault(120, 120_000_000n, 12000n);
const v129 = vault(129, 129_000_000n, 12900n);
const v135 = vault(135, 135_000_000n, 13500n);
const v180 = vault(180, 180_000_000n, 18000n);
const v300 = vault(300, 300_000_000n, 30000n);

describe("vaultCrBps", () => {
  it("computes CR in bps from the supplied price", () => {
    expect(vaultCrBps(v129, FEED_VALUE, FEED_DECIMALS)).toBe(12900n);
    expect(vaultCrBps(v135, FEED_VALUE, FEED_DECIMALS)).toBe(13500n);
    expect(vaultCrBps(v300, FEED_VALUE, FEED_DECIMALS)).toBe(30000n);
  });
});

describe("atRisk — threshold 130% (MCR)", () => {
  it("flags only the 129% vault; 135/180/300 are safe", () => {
    const result = atRisk([v135, v300, v129, v180], FEED_VALUE, FEED_DECIMALS, 13000n);
    expect(result.map((r) => r.vault.owner)).toEqual([v129.owner]);
    expect(result[0]?.crBps).toBe(12900n);
  });

  it("returns multiple below-threshold vaults ordered riskiest-first (ascending CR)", () => {
    const result = atRisk([v129, v300, v120, v135], FEED_VALUE, FEED_DECIMALS, 13000n);
    expect(result.map((r) => r.vault.owner)).toEqual([v120.owner, v129.owner]);
    expect(result.map((r) => r.crBps)).toEqual([12000n, 12900n]);
  });

  it("excludes zero-debt vaults (crBps sentinel 0 is not real risk)", () => {
    const zeroDebt = vault(999, 50_000_000n, 0n, 0n);
    const result = atRisk([zeroDebt, v129], FEED_VALUE, FEED_DECIMALS, 13000n);
    expect(result.map((r) => r.vault.owner)).toEqual([v129.owner]);
  });

  it("excludes inactive vaults", () => {
    const closed: VaultRow = { ...v120, active: false };
    const result = atRisk([closed, v129], FEED_VALUE, FEED_DECIMALS, 13000n);
    expect(result.map((r) => r.vault.owner)).toEqual([v129.owner]);
  });
});

describe("sortByNicrAsc", () => {
  it("orders ascending by nicr (riskiest first) without mutating input", () => {
    const input = [v300, v129, v180, v135];
    const sorted = sortByNicrAsc(input);
    expect(sorted.map((v) => v.nicr)).toEqual([12900n, 13500n, 18000n, 30000n]);
    // input untouched
    expect(input.map((v) => v.nicr)).toEqual([30000n, 12900n, 18000n, 13500n]);
  });
});
