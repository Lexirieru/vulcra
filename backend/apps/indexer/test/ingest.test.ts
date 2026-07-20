import { describe, it, expect } from "vitest";
import type { Address, Hex } from "viem";
import { InMemoryVaultStore } from "../src/store.js";
import { applyEvent, type DecodedVaultEvent } from "../src/ingest.js";
import { redemptionQueue } from "../src/sortedByCr.js";

const A = "0x1111111111111111111111111111111111111111" as Address;
const B = "0x2222222222222222222222222222222222222222" as Address;
const C = "0x5555555555555555555555555555555555555555" as Address;
const FUNDER = "0x3333333333333333333333333333333333333333" as Address;
const LIQUIDATOR = "0x4444444444444444444444444444444444444444" as Address;

const tx = (n: number): Hex => (`0x${n.toString(16).padStart(64, "0")}`) as Hex;

function open(
  owner: Address,
  overrides: Partial<Extract<DecodedVaultEvent, { eventName: "VaultOpened" }>> = {},
): DecodedVaultEvent {
  return {
    eventName: "VaultOpened",
    owner,
    collateral6: 100_000_000n, // 100 FXRP
    debt18: 100_000000000000000000n, // 100 vUSD recorded debt
    annualInterestRateBps: 500n, // 5% annual
    blockNumber: 1n,
    blockTimestamp: 1_000n,
    transactionHash: tx(0xa1),
    logIndex: 0,
    ...overrides,
  };
}

describe("applyEvent — VaultOpened then DebtMinted", () => {
  it("records rate/debt on open, then debt18 tracks newDebt18 (rate unchanged)", () => {
    const store = new InMemoryVaultStore();

    applyEvent(store, open(A));

    let row = store.getVault(A);
    expect(row?.collateral6).toBe(100_000_000n);
    expect(row?.debt18).toBe(100_000000000000000000n);
    expect(row?.rateBps).toBe(500n);
    expect(row?.lastAccrualTs).toBe(1_000n);
    expect(row?.active).toBe(true);

    applyEvent(store, {
      eventName: "DebtMinted",
      owner: A,
      minted18: 50_000000000000000000n,
      fee18: 250000000000000000n,
      newDebt18: 150_250000000000000000n, // 100 + 50 + 0.25 fee
      blockNumber: 5n,
      blockTimestamp: 2_000n,
      transactionHash: tx(0xb2),
      logIndex: 0,
    });

    row = store.getVault(A);
    expect(row?.debt18).toBe(150_250000000000000000n); // recorded debt = newDebt18
    expect(row?.rateBps).toBe(500n); // unchanged by DebtMinted
    expect(row?.lastAccrualTs).toBe(2_000n); // re-anchored to the debt event
    expect(row?.lastBlock).toBe(5n);
  });
});

describe("applyEvent — DebtRepaid", () => {
  it("sets debt18 = newDebt18 and re-anchors lastAccrualTs", () => {
    const store = new InMemoryVaultStore();
    applyEvent(store, open(A));

    applyEvent(store, {
      eventName: "DebtRepaid",
      owner: A,
      amount18: 40_000000000000000000n,
      newDebt18: 60_000000000000000000n,
      blockNumber: 6n,
      blockTimestamp: 3_000n,
      transactionHash: tx(0xc3),
      logIndex: 0,
    });

    const row = store.getVault(A);
    expect(row?.debt18).toBe(60_000000000000000000n);
    expect(row?.lastAccrualTs).toBe(3_000n);
  });
});

describe("applyEvent — InterestRateAdjusted", () => {
  it("changes rateBps + debt18 and re-orders the redemption queue", () => {
    const store = new InMemoryVaultStore();
    // Three vaults with distinct rates: A=500, B=800, C=1200.
    applyEvent(store, open(A, { annualInterestRateBps: 500n, transactionHash: tx(0x0a) }));
    applyEvent(store, open(B, { annualInterestRateBps: 800n, transactionHash: tx(0x0b) }));
    applyEvent(store, open(C, { annualInterestRateBps: 1200n, transactionHash: tx(0x0c) }));

    expect(redemptionQueue(store.listActive()).map((v) => v.owner)).toEqual([
      A.toLowerCase(),
      B.toLowerCase(),
      C.toLowerCase(),
    ]);

    // A raises its rate above everyone -> it moves to the tail of the queue.
    applyEvent(store, {
      eventName: "InterestRateAdjusted",
      owner: A,
      newAnnualInterestRateBps: 2000n,
      newDebt18: 100_000000000000000000n,
      blockNumber: 9n,
      blockTimestamp: 4_000n,
      transactionHash: tx(0xdd),
      logIndex: 0,
    });

    const rowA = store.getVault(A);
    expect(rowA?.rateBps).toBe(2000n);
    expect(rowA?.lastAccrualTs).toBe(4_000n);
    expect(redemptionQueue(store.listActive()).map((v) => v.owner)).toEqual([
      B.toLowerCase(),
      C.toLowerCase(),
      A.toLowerCase(),
    ]);
  });
});

describe("applyEvent — CollateralAdded / CollateralWithdrawn", () => {
  it("updates collateral without resetting debt or accrual origin", () => {
    const store = new InMemoryVaultStore();
    applyEvent(store, open(A)); // lastAccrualTs = 1_000, debt = 100

    applyEvent(store, {
      eventName: "CollateralAdded",
      owner: A,
      amount6: 50_000_000n,
      newCollateral6: 150_000_000n,
      blockNumber: 7n,
      blockTimestamp: 9_999n, // must NOT become the accrual origin
      transactionHash: tx(0xe4),
      logIndex: 0,
    });

    let row = store.getVault(A);
    expect(row?.collateral6).toBe(150_000_000n);
    expect(row?.debt18).toBe(100_000000000000000000n); // unchanged
    expect(row?.lastAccrualTs).toBe(1_000n); // accrual keeps running from the debt event
    expect(row?.lastBlock).toBe(7n);

    applyEvent(store, {
      eventName: "CollateralWithdrawn",
      owner: A,
      amount6: 30_000_000n,
      newCollateral6: 120_000_000n,
      blockNumber: 8n,
      blockTimestamp: 11_111n,
      transactionHash: tx(0xe5),
      logIndex: 0,
    });

    row = store.getVault(A);
    expect(row?.collateral6).toBe(120_000_000n);
    expect(row?.lastAccrualTs).toBe(1_000n); // still the original debt-event timestamp
  });
});

describe("applyEvent — idempotency on (txHash, logIndex)", () => {
  it("does not double-apply a replayed DelegatedRepay", () => {
    const store = new InMemoryVaultStore();
    applyEvent(store, open(A, { transactionHash: tx(0x01) }));

    const repay: DecodedVaultEvent = {
      eventName: "DelegatedRepay",
      owner: A,
      funder: FUNDER,
      amount18: 10_000000000000000000n, // repay 10 vUSD
      blockNumber: 2n,
      blockTimestamp: 2_000n,
      transactionHash: tx(0x02),
      logIndex: 0,
    };

    const first = applyEvent(store, repay);
    expect(first).toBe(true);
    expect(store.getVault(A)?.debt18).toBe(90_000000000000000000n);
    expect(store.getVault(A)?.lastAccrualTs).toBe(2_000n);

    // Replaying the exact same log must be a no-op (not deducted twice).
    const second = applyEvent(store, repay);
    expect(second).toBe(false);
    expect(store.getVault(A)?.debt18).toBe(90_000000000000000000n);
  });

  it("DelegatedRepay floors debt at 0 when repaying more than owed", () => {
    const store = new InMemoryVaultStore();
    applyEvent(store, open(A));
    applyEvent(store, {
      eventName: "DelegatedRepay",
      owner: A,
      funder: FUNDER,
      amount18: 999_000000000000000000n,
      blockNumber: 2n,
      blockTimestamp: 2_000n,
      transactionHash: tx(0x03),
      logIndex: 0,
    });
    expect(store.getVault(A)?.debt18).toBe(0n);
  });
});

describe("applyEvent — VaultClosed / VaultLiquidated drop out of active", () => {
  it("marks vaults inactive and removes them from listActive", () => {
    const store = new InMemoryVaultStore();
    applyEvent(store, open(A, { transactionHash: tx(0x0a) }));
    applyEvent(store, open(B, { transactionHash: tx(0x0b) }));
    expect(store.listActive()).toHaveLength(2);

    applyEvent(store, {
      eventName: "VaultClosed",
      owner: A,
      collateralReturned6: 100_000_000n,
      debtBurned18: 100_000000000000000000n,
      blockNumber: 3n,
      blockTimestamp: 3_000n,
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
      blockTimestamp: 4_000n,
      transactionHash: tx(0x12),
      logIndex: 0,
    });

    expect(store.listActive()).toHaveLength(0);
    expect(store.getVault(A)?.active).toBe(false);
    expect(store.getVault(B)?.active).toBe(false);
  });
});

describe("applyEvent — Redemption is a no-op on vault rows", () => {
  it("does not alter any vault row but is marked processed", () => {
    const store = new InMemoryVaultStore();
    applyEvent(store, open(A, { transactionHash: tx(0x21) }));

    const applied = applyEvent(store, {
      eventName: "Redemption",
      redeemer: B,
      vusdRedeemed18: 50_000000000000000000n,
      collateralPaid6: 17_000_000n,
      fee6: 50_000n,
      blockNumber: 2n,
      blockTimestamp: 2_000n,
      transactionHash: tx(0x22),
      logIndex: 0,
    });

    expect(applied).toBe(true); // processed
    expect(store.getVault(A)?.debt18).toBe(100_000000000000000000n); // unchanged
    expect(store.hasProcessed(tx(0x22), 0)).toBe(true);
  });
});
