import { describe, it, expect } from "vitest";
import type { Address } from "viem";
import { SECONDS_PER_YEAR } from "@vulcra/chain-client";
import type { VaultRow } from "../src/store.js";
import { atRisk, redemptionQueue, vaultCrBps } from "../src/sortedByCr.js";

// Price fixture: XRP/USD = $1.00 expressed as feedValue=1, feedDecimals=0.
// Then collateralValueUsd18At(collateral6, 6, 1, 0) = collateral6 * 1e12, i.e. each
// FXRP unit (1e6) is worth $1e18. With debt fixed at 100 vUSD (100e18), a vault
// holding N FXRP has CR = N * 100 bps  (e.g. 129 FXRP -> 12900 bps = 129%).
const FEED_VALUE = 1n;
const FEED_DECIMALS = 0;
const FXRP_DEC = 6; // FXRP collateral decimals
const DEBT_100 = 100_000000000000000000n;

// A fixed "now". Fixtures set lastAccrualTs = NOW so dt = 0 (no accrual) unless a
// test deliberately reads at a later timestamp to exercise interest accrual.
const NOW = 1_000_000n;

const addr = (n: number): Address =>
  (`0x${n.toString(16).padStart(40, "0")}`) as Address;

function vault(
  owner: number,
  collateral: bigint,
  opts: { rateBps?: bigint; debt18?: bigint; lastAccrualTs?: bigint; active?: boolean } = {},
): VaultRow {
  return {
    owner: addr(owner),
    collateral6: collateral,
    debt18: opts.debt18 ?? DEBT_100,
    rateBps: opts.rateBps ?? 500n,
    lastAccrualTs: opts.lastAccrualTs ?? NOW,
    active: opts.active ?? true,
    lastBlock: 1n,
    lastTxHash: "0x",
  };
}

// CR 120 / 129 / 135 / 180 / 300 percent at the $1 fixture, all read at t=NOW (dt=0).
const v120 = vault(120, 120_000_000n);
const v129 = vault(129, 129_000_000n);
const v135 = vault(135, 135_000_000n);
const v180 = vault(180, 180_000_000n);
const v300 = vault(300, 300_000_000n);

describe("vaultCrBps (FXRP 6-dec, no accrual at dt=0)", () => {
  it("computes CR in bps from the supplied price", () => {
    expect(vaultCrBps(v129, FXRP_DEC, FEED_VALUE, FEED_DECIMALS, NOW)).toBe(12900n);
    expect(vaultCrBps(v135, FXRP_DEC, FEED_VALUE, FEED_DECIMALS, NOW)).toBe(13500n);
    expect(vaultCrBps(v300, FXRP_DEC, FEED_VALUE, FEED_DECIMALS, NOW)).toBe(30000n);
  });
});

describe("vaultCrBps (wFLR 18-dec) — branch-aware decimals", () => {
  // 150 wFLR (18-dec) at FLR/USD $1, debt 100 vUSD -> CR 150%. Using the wrong
  // (6-dec) scale would grossly mis-compute; the collateralDecimals arg fixes it.
  const wflrVault = vault(0xf1, 150_000000000000000000n);
  it("computes 150% for a healthy wFLR vault", () => {
    expect(vaultCrBps(wflrVault, 18, FEED_VALUE, FEED_DECIMALS, NOW)).toBe(15000n);
  });
  it("flags it once the price halves (75% CR < MCR)", () => {
    // FLR/USD $0.50 => feedValue 5, feedDecimals 1
    expect(vaultCrBps(wflrVault, 18, 5n, 1, NOW)).toBe(7500n);
    const flagged = atRisk([wflrVault], 18, 5n, 1, NOW, 13000n);
    expect(flagged.map((r) => r.crBps)).toEqual([7500n]);
  });
});

describe("vaultCrBps — on-read interest accrual lowers CR at unchanged price", () => {
  // 150 FXRP, 100 vUSD debt, 20% annual rate. At t=open CR = 150%. After one full
  // year of accrual (same $1 price), debt grows to ~120 vUSD -> CR ~125%.
  const v = vault(1, 150_000_000n, { rateBps: 2000n, lastAccrualTs: 0n });

  it("reads 150% at the accrual origin (dt = 0)", () => {
    expect(vaultCrBps(v, FXRP_DEC, FEED_VALUE, FEED_DECIMALS, 0n)).toBe(15000n);
  });

  it("reads ~125% after one year of interest (debt grew -> CR dropped)", () => {
    const cr = vaultCrBps(v, FXRP_DEC, FEED_VALUE, FEED_DECIMALS, SECONDS_PER_YEAR);
    expect(cr).toBe(12500n); // 150e18 * 10000 / 120e18
  });
});

describe("atRisk — threshold 130% (MCR), FXRP 6-dec", () => {
  it("flags only the 129% vault; 135/180/300 are safe", () => {
    const result = atRisk([v135, v300, v129, v180], FXRP_DEC, FEED_VALUE, FEED_DECIMALS, NOW, 13000n);
    expect(result.map((r) => r.vault.owner)).toEqual([v129.owner]);
    expect(result[0]?.crBps).toBe(12900n);
  });

  it("returns multiple below-threshold vaults ordered riskiest-first (ascending CR)", () => {
    const result = atRisk([v129, v300, v120, v135], FXRP_DEC, FEED_VALUE, FEED_DECIMALS, NOW, 13000n);
    expect(result.map((r) => r.vault.owner)).toEqual([v120.owner, v129.owner]);
    expect(result.map((r) => r.crBps)).toEqual([12000n, 12900n]);
  });

  it("excludes zero-debt vaults (crBps sentinel 0 is not real risk)", () => {
    const zeroDebt = vault(999, 50_000_000n, { debt18: 0n });
    const result = atRisk([zeroDebt, v129], FXRP_DEC, FEED_VALUE, FEED_DECIMALS, NOW, 13000n);
    expect(result.map((r) => r.vault.owner)).toEqual([v129.owner]);
  });

  it("excludes inactive vaults", () => {
    const closed: VaultRow = { ...v120, active: false };
    const result = atRisk([closed, v129], FXRP_DEC, FEED_VALUE, FEED_DECIMALS, NOW, 13000n);
    expect(result.map((r) => r.vault.owner)).toEqual([v129.owner]);
  });

  it("a vault healthy at open becomes at-risk after enough interest accrues (same price)", () => {
    // 150 FXRP / 100 vUSD @ 20% annual: 150% at open, ~125% after a year.
    const v = vault(7, 150_000_000n, { rateBps: 2000n, lastAccrualTs: 0n });
    // At the accrual origin it is healthy -> not flagged.
    expect(atRisk([v], FXRP_DEC, FEED_VALUE, FEED_DECIMALS, 0n, 13000n)).toEqual([]);
    // A year later the accrued debt drags CR below 130% -> flagged.
    const later = atRisk([v], FXRP_DEC, FEED_VALUE, FEED_DECIMALS, SECONDS_PER_YEAR, 13000n);
    expect(later.map((r) => r.vault.owner)).toEqual([v.owner]);
    expect(later[0]?.crBps).toBe(12500n);
  });
});

describe("redemptionQueue — ascending by interest rate (lowest first)", () => {
  it("orders vaults 500/800/1200 as 500,800,1200 without mutating input", () => {
    const a = vault(1, 100_000_000n, { rateBps: 1200n });
    const b = vault(2, 100_000_000n, { rateBps: 500n });
    const c = vault(3, 100_000_000n, { rateBps: 800n });
    const input = [a, b, c];
    const queue = redemptionQueue(input);
    expect(queue.map((v) => v.rateBps)).toEqual([500n, 800n, 1200n]);
    // input untouched
    expect(input.map((v) => v.rateBps)).toEqual([1200n, 500n, 800n]);
  });

  it("excludes inactive vaults", () => {
    const a = vault(1, 100_000_000n, { rateBps: 500n });
    const b = vault(2, 100_000_000n, { rateBps: 800n, active: false });
    const c = vault(3, 100_000_000n, { rateBps: 1200n });
    expect(redemptionQueue([a, b, c]).map((v) => v.rateBps)).toEqual([500n, 1200n]);
  });
});
