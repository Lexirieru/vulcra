import { describe, it, expect } from "vitest";
import type { Address, Hex } from "viem";
import { InMemoryVaultStore } from "../src/store.js";
import { applyEvent, type DecodedVaultEvent } from "../src/ingest.js";

const A = "0x1111111111111111111111111111111111111111" as Address;
const B = "0x2222222222222222222222222222222222222222" as Address;
const FUNDER = "0x3333333333333333333333333333333333333333" as Address;
const LIQUIDATOR = "0x4444444444444444444444444444444444444444" as Address;

const tx = (n: number): Hex => (`0x${n.toString(16).padStart(64, "0")}`) as Hex;

describe("applyEvent — VaultOpened then VaultAdjusted", () => {
  it("row reflects the latest collateral/debt/nicr", () => {
    const store = new InMemoryVaultStore();

    applyEvent(store, {
      eventName: "VaultOpened",
      owner: A,
      collateral6: 100_000_000n, // 100 FXRP
      debt18: 100_000000000000000000n, // 100 vUSD
      nicr: 100n,
      blockNumber: 1n,
      transactionHash: tx(0xa1),
      logIndex: 0,
    });

    let row = store.getVault(A);
    expect(row?.collateral6).toBe(100_000_000n);
    expect(row?.debt18).toBe(100_000000000000000000n);
    expect(row?.active).toBe(true);

    applyEvent(store, {
      eventName: "VaultAdjusted",
      owner: A,
      collateral6: 150_000_000n, // topped up to 150 FXRP
      debt18: 120_000000000000000000n, // borrowed up to 120 vUSD
      nicr: 125n,
      blockNumber: 2n,
      transactionHash: tx(0xb2),
      logIndex: 0,
    });

    row = store.getVault(A);
    expect(row?.collateral6).toBe(150_000_000n);
    expect(row?.debt18).toBe(120_000000000000000000n);
    expect(row?.nicr).toBe(125n);
    expect(row?.active).toBe(true);
    expect(row?.lastBlock).toBe(2n);
  });
});

describe("applyEvent — idempotency on (txHash, logIndex)", () => {
  it("does not double-apply a replayed DelegatedRepay", () => {
    const store = new InMemoryVaultStore();
    applyEvent(store, {
      eventName: "VaultOpened",
      owner: A,
      collateral6: 100_000_000n,
      debt18: 100_000000000000000000n,
      nicr: 100n,
      blockNumber: 1n,
      transactionHash: tx(0x01),
      logIndex: 0,
    });

    const repay: DecodedVaultEvent = {
      eventName: "DelegatedRepay",
      owner: A,
      funder: FUNDER,
      amount18: 10_000000000000000000n, // repay 10 vUSD
      blockNumber: 2n,
      transactionHash: tx(0x02),
      logIndex: 0,
    };

    const first = applyEvent(store, repay);
    expect(first).toBe(true);
    expect(store.getVault(A)?.debt18).toBe(90_000000000000000000n);

    // Replaying the exact same log must be a no-op (not deducted twice).
    const second = applyEvent(store, repay);
    expect(second).toBe(false);
    expect(store.getVault(A)?.debt18).toBe(90_000000000000000000n);
  });
});

describe("applyEvent — VaultClosed / VaultLiquidated drop out of active", () => {
  it("marks vaults inactive and removes them from listActive", () => {
    const store = new InMemoryVaultStore();
    for (const owner of [A, B]) {
      applyEvent(store, {
        eventName: "VaultOpened",
        owner,
        collateral6: 200_000_000n,
        debt18: 100_000000000000000000n,
        nicr: 200n,
        blockNumber: 1n,
        transactionHash: tx(owner === A ? 0x0a : 0x0b),
        logIndex: 0,
      });
    }
    expect(store.listActive()).toHaveLength(2);

    applyEvent(store, {
      eventName: "VaultClosed",
      owner: A,
      blockNumber: 3n,
      transactionHash: tx(0x11),
      logIndex: 0,
    });
    applyEvent(store, {
      eventName: "VaultLiquidated",
      owner: B,
      liquidator: LIQUIDATOR,
      debtCleared18: 100_000000000000000000n,
      collateralToLiquidator6: 180_000_000n,
      collateralToOwner6: 20_000_000n,
      blockNumber: 4n,
      transactionHash: tx(0x12),
      logIndex: 0,
    });

    expect(store.listActive()).toHaveLength(0);
    expect(store.getVault(A)?.active).toBe(false);
    expect(store.getVault(B)?.active).toBe(false);
  });
});

describe("applyEvent — Redeemed is a no-op on vault rows", () => {
  it("does not alter any vault row but is marked processed", () => {
    const store = new InMemoryVaultStore();
    applyEvent(store, {
      eventName: "VaultOpened",
      owner: A,
      collateral6: 100_000_000n,
      debt18: 100_000000000000000000n,
      nicr: 100n,
      blockNumber: 1n,
      transactionHash: tx(0x21),
      logIndex: 0,
    });

    const applied = applyEvent(store, {
      eventName: "Redeemed",
      redeemer: B,
      vusdAmount18: 50_000000000000000000n,
      fxrpPaid6: 17_000_000n,
      blockNumber: 2n,
      transactionHash: tx(0x22),
      logIndex: 0,
    });

    expect(applied).toBe(true); // processed
    expect(store.getVault(A)?.debt18).toBe(100_000000000000000000n); // unchanged
    expect(store.hasProcessed(tx(0x22), 0)).toBe(true);
  });
});
