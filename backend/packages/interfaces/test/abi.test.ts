import { describe, it, expect } from "vitest";
import { getAbiItem, encodeFunctionData, type Address } from "viem";
import { vaultManagerAbi, vulcraZapAbi, erc20Abi } from "../src/index.js";

const OWNER = "0x1111111111111111111111111111111111111111" as Address;
const ZERO = "0x0000000000000000000000000000000000000000" as Address;

describe("VaultManager ABI V2 (owner identity, interest rates, by-rate redemption)", () => {
  it("getVault returns (collateral6, debt18=ENTIRE incl interest, active)", () => {
    const item = getAbiItem({ abi: vaultManagerAbi, name: "getVault" });
    expect(item?.inputs[0]?.type).toBe("address");
    expect(item?.outputs.map((o) => o.type)).toEqual(["uint256", "uint256", "bool"]);
  });

  it("openVault / openVaultFor carry annualInterestRateBps (V2)", () => {
    const open = getAbiItem({ abi: vaultManagerAbi, name: "openVault" });
    expect(open?.inputs.map((i) => i.name)).toEqual([
      "collateral6",
      "mint18",
      "annualInterestRateBps",
      "prevHint",
      "nextHint",
    ]);
    const openFor = getAbiItem({ abi: vaultManagerAbi, name: "openVaultFor" });
    expect(openFor?.inputs.map((i) => i.name)).toContain("annualInterestRateBps");
  });

  it("adjustInterestRate exists and redeem is by-rate (amount + maxIterations)", () => {
    expect(getAbiItem({ abi: vaultManagerAbi, name: "adjustInterestRate" })).toBeDefined();
    const redeem = getAbiItem({ abi: vaultManagerAbi, name: "redeem" });
    expect(redeem?.inputs.map((i) => i.type)).toEqual(["uint256", "uint256"]);
  });

  it("exposes V2 interest getters + settlement", () => {
    for (const name of [
      "getTroveEntireDebt",
      "annualInterestRateBpsOf",
      "getEntireSystemDebt",
      "pendingAggInterest",
      "mintInterest",
      "defaultInterestRateBps",
      "redemptionQueueHead",
      "lowestRateVault",
      "params",
    ] as const) {
      expect(getAbiItem({ abi: vaultManagerAbi, name })).toBeDefined();
    }
  });

  it("delegatedRepay(owner, maxAmount18, prevHint, nextHint) — V2 signature", () => {
    const item = getAbiItem({ abi: vaultManagerAbi, name: "delegatedRepay" });
    expect(item?.inputs.map((i) => i.type)).toEqual(["address", "uint256", "address", "address"]);
  });

  it("liquidate targets an owner address", () => {
    expect(() =>
      encodeFunctionData({ abi: vaultManagerAbi, functionName: "liquidate", args: [OWNER] }),
    ).not.toThrow();
  });

  it("exposes the V2 events the indexer consumes", () => {
    for (const name of [
      "VaultOpened",
      "CollateralAdded",
      "CollateralWithdrawn",
      "DebtMinted",
      "DebtRepaid",
      "InterestRateAdjusted",
      "VaultLiquidated",
      "Redemption",
      "DelegatedRepay",
    ] as const) {
      expect(getAbiItem({ abi: vaultManagerAbi, name })).toBeDefined();
    }
    // VaultOpened's 4th field is now the interest rate (not nicr).
    const opened = getAbiItem({ abi: vaultManagerAbi, name: "VaultOpened" });
    expect(opened?.inputs[3]?.name).toBe("annualInterestRateBps");
  });
});

describe("VulcraZap ABI V2", () => {
  it("openVaultAndForward carries annualInterestRateBps and encodes cleanly", () => {
    const item = getAbiItem({ abi: vulcraZapAbi, name: "openVaultAndForward" });
    expect(item?.inputs.map((i) => i.name)).toEqual([
      "collateral6",
      "mint18",
      "annualInterestRateBps",
      "vusdDestination",
      "prevHint",
      "nextHint",
    ]);
    expect(() =>
      encodeFunctionData({
        abi: vulcraZapAbi,
        functionName: "openVaultAndForward",
        args: [1_000_000n, 100n, 500n, OWNER, ZERO, ZERO],
      }),
    ).not.toThrow();
  });
});

describe("ERC20 ABI", () => {
  it("encodes approve", () => {
    expect(() =>
      encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [OWNER, 1n] }),
    ).not.toThrow();
  });
});
