import { describe, it, expect } from "vitest";
import { getAbiItem, encodeFunctionData, type Address } from "viem";
import { vaultManagerAbi, vulcraZapAbi, erc20Abi } from "../src/index.js";

const OWNER = "0x1111111111111111111111111111111111111111" as Address;
const ZERO = "0x0000000000000000000000000000000000000000" as Address;

describe("VaultManager ABI (owner-address vault identity)", () => {
  it("getVault takes an owner address and returns (collateral6, debt18, active)", () => {
    const item = getAbiItem({ abi: vaultManagerAbi, name: "getVault" });
    expect(item?.inputs[0]?.type).toBe("address");
    expect(item?.outputs.map((o) => o.type)).toEqual(["uint256", "uint256", "bool"]);
  });

  it("delegatedRepay lives on VaultManager and is keyed by vault owner address", () => {
    const item = getAbiItem({ abi: vaultManagerAbi, name: "delegatedRepay" });
    expect(item?.inputs.map((i) => i.type)).toEqual(["address", "uint256"]);
  });

  it("liquidate targets a vault owner address, not a numeric id", () => {
    const item = getAbiItem({ abi: vaultManagerAbi, name: "liquidate" });
    expect(item?.inputs[0]?.type).toBe("address");
    // encodes cleanly
    expect(() =>
      encodeFunctionData({ abi: vaultManagerAbi, functionName: "liquidate", args: [OWNER] }),
    ).not.toThrow();
  });

  it("exposes the events the indexer consumes", () => {
    for (const name of ["VaultOpened", "VaultLiquidated", "DelegatedRepay", "Redeemed"] as const) {
      expect(getAbiItem({ abi: vaultManagerAbi, name })).toBeDefined();
    }
  });
});

describe("VulcraZap ABI", () => {
  it("uses openVaultAndForward (not zapMint) and encodes cleanly", () => {
    expect(getAbiItem({ abi: vulcraZapAbi, name: "openVaultAndForward" })).toBeDefined();
    expect(() =>
      encodeFunctionData({
        abi: vulcraZapAbi,
        functionName: "openVaultAndForward",
        args: [1_000_000n, 100n, OWNER, ZERO, ZERO],
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
