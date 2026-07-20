import { describe, it, expect } from "vitest";
import type { Address } from "viem";
import { buildApi, type BranchApi, type PriceResult } from "../src/api.js";
import { InMemoryVaultStore, type VaultRow } from "../src/store.js";

const addr = (n: number): Address => (`0x${n.toString(16).padStart(40, "0")}`) as Address;

function row(
  owner: number,
  collateralRaw: bigint,
  debt18: bigint,
  rateBps: bigint,
  lastAccrualTs = 0n,
): VaultRow {
  return {
    owner: addr(owner),
    collateral6: collateralRaw,
    debt18,
    rateBps,
    lastAccrualTs,
    active: true,
    lastBlock: 1n,
    lastTxHash: "0x",
  };
}

// $1 price fixture: feedValue=1, feedDecimals=0.
const price$1: PriceResult = {
  ok: true,
  feed: { value: 1n, decimals: 0, timestamp: 0n, price18: 1_000000000000000000n, stale: false },
};
const priceDown: PriceResult = { ok: false, reason: "stale" };

function makeBranches(): { fxrp: InMemoryVaultStore; wflr: InMemoryVaultStore; apis: BranchApi[] } {
  const fxrp = new InMemoryVaultStore();
  const wflr = new InMemoryVaultStore();
  // rate 0 -> on-read accrual is a no-op, so CR is the pure price-based ratio (deterministic).
  // FXRP: 129 FXRP (6-dec) / 100 vUSD -> 129%.
  fxrp.upsertVault(row(0x1, 129_000_000n, 100_000000000000000000n, 0n));
  // wFLR: 150 wFLR (18-dec) / 100 vUSD -> 150%.
  wflr.upsertVault(row(0x2, 150_000000000000000000n, 100_000000000000000000n, 0n));
  const apis: BranchApi[] = [
    { key: "FXRP", store: fxrp, collateralDecimals: 6, getPrice: async () => price$1 },
    { key: "WFLR", store: wflr, collateralDecimals: 18, getPrice: async () => price$1 },
  ];
  return { fxrp, wflr, apis };
}

describe("indexer API (branch-aware)", () => {
  it("GET /branches lists both branches with decimals", async () => {
    const app = buildApi({ branches: makeBranches().apis, indexingEnabled: true });
    const res = await app.inject({ method: "GET", url: "/branches" });
    expect(res.statusCode).toBe(200);
    expect(res.json().branches).toEqual([
      { key: "FXRP", collateralDecimals: 6 },
      { key: "WFLR", collateralDecimals: 18 },
    ]);
  });

  it("GET /vaults/at-risk uses the branch's own decimals (wFLR 18-dec computes 150%, not at-risk)", async () => {
    const app = buildApi({ branches: makeBranches().apis, indexingEnabled: true });
    const wflr = await app.inject({ method: "GET", url: "/vaults/at-risk?branch=WFLR&belowCrBps=13000" });
    expect(wflr.statusCode).toBe(200);
    expect(wflr.json().count).toBe(0); // 150% > 130%

    const fxrp = await app.inject({ method: "GET", url: "/vaults/at-risk?branch=FXRP&belowCrBps=13000" });
    expect(fxrp.json().count).toBe(1); // 129% < 130%
    expect(fxrp.json().vaults[0].crBps).toBe("12900");
    // V2 fields present on each serialized vault.
    expect(fxrp.json().vaults[0].rateBps).toBe("0");
    expect(fxrp.json().vaults[0].currentDebt18).toBe("100000000000000000000");
  });

  it("GET /vaults/:branch/:owner returns the branch vault with CR + V2 fields", async () => {
    const { apis } = makeBranches();
    const app = buildApi({ branches: apis, indexingEnabled: true });
    const res = await app.inject({ method: "GET", url: `/vaults/WFLR/${addr(0x2)}` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.branch).toBe("WFLR");
    expect(body.crBps).toBe("15000"); // 150% with 18-dec collateral
    expect(body.rateBps).toBe("0");
    expect(body.currentDebt18).toBe("100000000000000000000");
    expect(body.debt18).toBe("100000000000000000000");
  });

  it("currentDebt18 reflects accrued interest on read (rate > 0, old accrual origin)", async () => {
    const store = new InMemoryVaultStore();
    // 20% annual, anchored at t=0 -> by now (2026) it has accrued far above 100 vUSD.
    store.upsertVault(row(0x9, 100_000_000n, 100_000000000000000000n, 2000n, 0n));
    const apis: BranchApi[] = [
      { key: "FXRP", store, collateralDecimals: 6, getPrice: async () => price$1 },
    ];
    const app = buildApi({ branches: apis, indexingEnabled: true });
    const res = await app.inject({ method: "GET", url: `/vaults/FXRP/${addr(0x9)}` });
    const body = res.json();
    expect(BigInt(body.currentDebt18)).toBeGreaterThan(BigInt(body.debt18));
    expect(body.rateBps).toBe("2000");
  });

  it("GET /vaults/redemption-queue orders active vaults by rate ascending (lowest first)", async () => {
    const store = new InMemoryVaultStore();
    store.upsertVault(row(0x1, 100_000_000n, 100_000000000000000000n, 1200n));
    store.upsertVault(row(0x2, 100_000_000n, 100_000000000000000000n, 500n));
    store.upsertVault(row(0x3, 100_000_000n, 100_000000000000000000n, 800n));
    const apis: BranchApi[] = [
      { key: "FXRP", store, collateralDecimals: 6, getPrice: async () => price$1 },
    ];
    const app = buildApi({ branches: apis, indexingEnabled: true });
    const res = await app.inject({ method: "GET", url: "/vaults/redemption-queue?branch=FXRP" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.count).toBe(3);
    expect(body.vaults.map((v: { rateBps: string }) => v.rateBps)).toEqual(["500", "800", "1200"]);
  });

  it("GET /vaults/redemption-queue on an unknown branch -> 404", async () => {
    const app = buildApi({ branches: makeBranches().apis, indexingEnabled: true });
    const res = await app.inject({ method: "GET", url: "/vaults/redemption-queue?branch=DOGE" });
    expect(res.statusCode).toBe(404);
  });

  it("unknown branch -> 404", async () => {
    const app = buildApi({ branches: makeBranches().apis, indexingEnabled: true });
    const res = await app.inject({ method: "GET", url: "/vaults/at-risk?branch=DOGE" });
    expect(res.statusCode).toBe(404);
  });

  it("price unavailable -> 503 on at-risk", async () => {
    const fxrp = new InMemoryVaultStore();
    const apis: BranchApi[] = [
      { key: "FXRP", store: fxrp, collateralDecimals: 6, getPrice: async () => priceDown },
    ];
    const app = buildApi({ branches: apis, indexingEnabled: true });
    const res = await app.inject({ method: "GET", url: "/vaults/at-risk?branch=FXRP" });
    expect(res.statusCode).toBe(503);
  });

  it("GET /health reports per-branch active counts", async () => {
    const app = buildApi({ branches: makeBranches().apis, indexingEnabled: true });
    const res = await app.inject({ method: "GET", url: "/health" });
    const body = res.json();
    expect(body.branches.map((b: { key: string }) => b.key)).toEqual(["FXRP", "WFLR"]);
    expect(body.branches[0].activeVaults).toBe(1);
  });
});
