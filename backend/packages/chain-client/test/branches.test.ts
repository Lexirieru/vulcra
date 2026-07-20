import { describe, it, expect } from "vitest";
import {
  loadBranchesFromEnv,
  xrplMintBranch,
  branchByKey,
  BRANCH_STATIC,
  XRP_USD_FEED_ID,
  FLR_USD_FEED_ID,
} from "../src/index.js";

const FXRP_VM = "0x0b6a3645c240605887a5532109323a3e12273dc7";
const WFLR_VM = "0xc67dce33d7a8efa5ffeb961899c73fe01bce9273";

describe("loadBranchesFromEnv", () => {
  it("loads both branches with per-branch decimals + feed ids", () => {
    const branches = loadBranchesFromEnv({
      VAULT_MANAGER_FXRP_ADDRESS: FXRP_VM,
      VAULT_MANAGER_WFLR_ADDRESS: WFLR_VM,
    } as NodeJS.ProcessEnv);
    expect(branches.map((b) => b.key)).toEqual(["FXRP", "WFLR"]);

    const fxrp = branchByKey(branches, "FXRP")!;
    expect(fxrp.collateralDecimals).toBe(6);
    expect(fxrp.feedId).toBe(XRP_USD_FEED_ID);
    expect(fxrp.feedDecimals).toBe(6);
    expect(fxrp.hasXrplMint).toBe(true);

    const wflr = branchByKey(branches, "WFLR")!;
    expect(wflr.collateralDecimals).toBe(18);
    expect(wflr.feedId).toBe(FLR_USD_FEED_ID);
    expect(wflr.feedDecimals).toBe(8);
    expect(wflr.hasXrplMint).toBe(false);
  });

  it("includes only branches whose VaultManager env is set", () => {
    const branches = loadBranchesFromEnv({ VAULT_MANAGER_WFLR_ADDRESS: WFLR_VM } as NodeJS.ProcessEnv);
    expect(branches.map((b) => b.key)).toEqual(["WFLR"]);
  });

  it("falls back to legacy VAULT_MANAGER_ADDRESS as the FXRP branch", () => {
    const branches = loadBranchesFromEnv({ VAULT_MANAGER_ADDRESS: FXRP_VM } as NodeJS.ProcessEnv);
    expect(branches).toHaveLength(1);
    expect(branches[0]!.key).toBe("FXRP");
  });

  it("throws on a malformed per-branch address (fail-fast at boot)", () => {
    expect(() =>
      loadBranchesFromEnv({ VAULT_MANAGER_FXRP_ADDRESS: "0xnotanaddress" } as NodeJS.ProcessEnv),
    ).toThrow(/not a valid address/i);
  });

  it("honors feed + decimals overrides", () => {
    const branches = loadBranchesFromEnv({
      VAULT_MANAGER_FXRP_ADDRESS: FXRP_VM,
      COLLATERAL_DECIMALS_FXRP: "7",
      FEED_ID_FXRP: FLR_USD_FEED_ID,
    } as NodeJS.ProcessEnv);
    expect(branches[0]!.collateralDecimals).toBe(7);
    expect(branches[0]!.feedId).toBe(FLR_USD_FEED_ID);
  });
});

describe("xrplMintBranch", () => {
  it("returns the FXRP branch and never wFLR (wFLR is EVM-only, no 0xFE)", () => {
    const branches = loadBranchesFromEnv({
      VAULT_MANAGER_FXRP_ADDRESS: FXRP_VM,
      VAULT_MANAGER_WFLR_ADDRESS: WFLR_VM,
    } as NodeJS.ProcessEnv);
    expect(xrplMintBranch(branches)?.key).toBe("FXRP");
  });

  it("returns undefined when only wFLR is configured (no XRPL mint offered)", () => {
    const branches = loadBranchesFromEnv({ VAULT_MANAGER_WFLR_ADDRESS: WFLR_VM } as NodeJS.ProcessEnv);
    expect(xrplMintBranch(branches)).toBeUndefined();
  });
});

describe("BRANCH_STATIC", () => {
  it("resolves FXRP collateral via AssetManager and wFLR via the WNat registry name", () => {
    expect(BRANCH_STATIC.FXRP.collateralViaAssetManagerFXRP).toBe(true);
    expect(BRANCH_STATIC.WFLR.collateralRegistryName).toBe("WNat");
  });
});
