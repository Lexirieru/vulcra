import { describe, it, expect } from "vitest";
import type { Address } from "viem";
import { InMemoryVaultStore, type VaultRow } from "../src/store.js";

const addr = (n: number): Address =>
  (`0x${n.toString(16).padStart(40, "0")}`) as Address;

function row(owner: number, nicr: bigint, overrides: Partial<VaultRow> = {}): VaultRow {
  return {
    owner: addr(owner),
    collateral6: 100_000_000n,
    debt18: 100_000000000000000000n,
    nicr,
    active: true,
    lastBlock: 1n,
    lastTxHash: "0x",
    ...overrides,
  };
}

describe("InMemoryVaultStore — upsert / get", () => {
  it("round-trips a row and preserves large bigints exactly", () => {
    const store = new InMemoryVaultStore();
    const big = 123_456_789_012_345_678_901_234_567_890n; // > 64-bit
    store.upsertVault(row(1, 15000n, { debt18: big }));
    const got = store.getVault(addr(1));
    expect(got?.debt18).toBe(big);
    expect(got?.nicr).toBe(15000n);
  });

  it("keys by lowercased owner (case-insensitive lookup)", () => {
    const store = new InMemoryVaultStore();
    const mixed = "0xAbCdEf0000000000000000000000000000000001" as Address;
    store.upsertVault(row(1, 15000n, { owner: mixed }));
    expect(store.getVault(mixed.toLowerCase() as Address)?.owner).toBe(
      mixed.toLowerCase(),
    );
    expect(store.getVault(mixed)).toBeDefined();
  });

  it("upsert replaces an existing row", () => {
    const store = new InMemoryVaultStore();
    store.upsertVault(row(1, 15000n, { debt18: 100n }));
    store.upsertVault(row(1, 16000n, { debt18: 200n }));
    expect(store.getVault(addr(1))?.debt18).toBe(200n);
    expect(store.getVault(addr(1))?.nicr).toBe(16000n);
  });
});

describe("InMemoryVaultStore — active listing", () => {
  it("closeVault marks inactive and excludes from listActive", () => {
    const store = new InMemoryVaultStore();
    store.upsertVault(row(1, 15000n));
    store.upsertVault(row(2, 16000n));
    expect(store.listActive()).toHaveLength(2);

    store.closeVault(addr(1));
    const active = store.listActive();
    expect(active).toHaveLength(1);
    expect(active[0]?.owner).toBe(addr(2));
    expect(store.getVault(addr(1))?.active).toBe(false);
  });

  it("closeVault on an unknown owner is a no-op", () => {
    const store = new InMemoryVaultStore();
    expect(() => store.closeVault(addr(99))).not.toThrow();
  });
});

describe("InMemoryVaultStore — listAtRiskByNicr", () => {
  it("returns active vaults ascending by nicr (riskiest first)", () => {
    const store = new InMemoryVaultStore();
    // nicr proxies CR 135 / 180 / 129 / 300 — inserted out of order.
    store.upsertVault(row(1, 13500n));
    store.upsertVault(row(2, 18000n));
    store.upsertVault(row(3, 12900n));
    store.upsertVault(row(4, 30000n));

    expect(store.listAtRiskByNicr().map((v) => v.nicr)).toEqual([
      12900n,
      13500n,
      18000n,
      30000n,
    ]);
  });

  it("respects the limit and excludes inactive vaults", () => {
    const store = new InMemoryVaultStore();
    store.upsertVault(row(1, 13500n));
    store.upsertVault(row(2, 18000n));
    store.upsertVault(row(3, 12900n));
    store.upsertVault(row(4, 30000n, { active: false }));

    expect(store.listAtRiskByNicr(2).map((v) => v.nicr)).toEqual([12900n, 13500n]);
    // the inactive nicr=30000 vault never appears
    expect(store.listAtRiskByNicr().map((v) => v.nicr)).toEqual([
      12900n,
      13500n,
      18000n,
    ]);
  });
});

describe("InMemoryVaultStore — cursor", () => {
  it("defaults to 0 and persists a set value", () => {
    const store = new InMemoryVaultStore();
    expect(store.getCursor()).toBe(0n);
    store.setCursor(123456n);
    expect(store.getCursor()).toBe(123456n);
  });
});

describe("InMemoryVaultStore — processed-log idempotency guard", () => {
  it("tracks (txHash, logIndex) pairs case-insensitively", () => {
    const store = new InMemoryVaultStore();
    const hash = "0xDEADBEEF";
    expect(store.hasProcessed(hash, 0)).toBe(false);
    store.markProcessed(hash, 0);
    expect(store.hasProcessed(hash, 0)).toBe(true);
    expect(store.hasProcessed(hash.toLowerCase(), 0)).toBe(true);
    // different logIndex is a distinct entry
    expect(store.hasProcessed(hash, 1)).toBe(false);
  });
});
