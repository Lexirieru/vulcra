import { describe, it, expect } from "vitest";
import { loadEnv, requirePreflightConfig } from "../src/env.js";

const FXRP_VM = "0x0b6a3645c240605887a5532109323a3e12273dc7";
const WFLR_VM = "0xc67dce33d7a8efa5ffeb961899c73fe01bce9273";
const ZAP = "0xf362477e81afd7dc08ec57af834bac7185dfadf5";

describe("executor env (multi-collateral, XRPL mint FXRP-only)", () => {
  it("exposes all branches but picks FXRP as the XRPL-mint branch", () => {
    const env = loadEnv({
      VAULT_MANAGER_FXRP_ADDRESS: FXRP_VM,
      VAULT_MANAGER_WFLR_ADDRESS: WFLR_VM,
      VULCRA_ZAP_ADDRESS: ZAP,
    } as NodeJS.ProcessEnv);
    expect(env.branches.map((b) => b.key)).toEqual(["FXRP", "WFLR"]);
    expect(env.xrplBranch?.key).toBe("FXRP");
    expect(env.vaultManagerAddress?.toLowerCase()).toBe(FXRP_VM);
  });

  it("requirePreflightConfig passes when the FXRP branch + Zap are set", () => {
    const env = loadEnv({
      VAULT_MANAGER_FXRP_ADDRESS: FXRP_VM,
      VULCRA_ZAP_ADDRESS: ZAP,
    } as NodeJS.ProcessEnv);
    expect(() => requirePreflightConfig(env)).not.toThrow();
  });

  it("rejects pre-flight when only wFLR is configured (no XRPL mint for wFLR)", () => {
    const env = loadEnv({
      VAULT_MANAGER_WFLR_ADDRESS: WFLR_VM,
      VULCRA_ZAP_ADDRESS: ZAP,
    } as NodeJS.ProcessEnv);
    expect(env.xrplBranch).toBeUndefined();
    expect(() => requirePreflightConfig(env)).toThrow(/No FXRP branch/i);
  });

  it("honors the legacy VAULT_MANAGER_ADDRESS as the FXRP branch", () => {
    const env = loadEnv({
      VAULT_MANAGER_ADDRESS: FXRP_VM,
      VULCRA_ZAP_ADDRESS: ZAP,
    } as NodeJS.ProcessEnv);
    expect(env.xrplBranch?.key).toBe("FXRP");
  });
});
