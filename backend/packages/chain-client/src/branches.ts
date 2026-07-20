import { getAddress, isAddress, type Address, type Hex, type PublicClient } from "viem";
import { XRP_USD_FEED_ID, FLR_USD_FEED_ID, RegistryNames } from "./coston2.js";
import { resolveContract, resolveFxrpToken } from "./registry.js";

/**
 * Multi-collateral branch model.
 *
 * The VaultManager stays collateral-agnostic with the SAME external ABI — going
 * multi-collateral means there are multiple VaultManager INSTANCES, one per
 * collateral "branch". The backend handles a LIST of branches; it does not change
 * any ABI signature.
 *
 * Per branch:
 *   - key                 "FXRP" | "WFLR"
 *   - vaultManager        that branch's VaultManager instance (from env, after deploy)
 *   - collateralDecimals  FXRP 6, wFLR 18 — drives all CR math for the branch
 *   - feedId / feedDecimals  the branch's FTSO USD feed (decimals are a hint; read live)
 *   - hasXrplMint         FXRP true (0xFE atomic mint); wFLR false (EVM-only)
 *
 * Token addresses (FXRP, WNat) are resolved via FlareContractRegistry at runtime —
 * never hardcoded in logic.
 */
export type BranchKey = "FXRP" | "WFLR";

export const BRANCH_KEYS: readonly BranchKey[] = ["FXRP", "WFLR"] as const;

export interface BranchDescriptor {
  key: BranchKey;
  vaultManager: Address;
  collateralDecimals: number;
  feedId: Hex;
  /** Documented hint; the live feed decimals are still read dynamically. */
  feedDecimals: number;
  hasXrplMint: boolean;
}

interface BranchStatic {
  collateralDecimals: number;
  feedId: Hex;
  feedDecimals: number;
  hasXrplMint: boolean;
  /** How the collateral token address is resolved from the registry. */
  collateralViaAssetManagerFXRP?: boolean;
  collateralRegistryName?: string;
}

/** Static per-branch config; only `vaultManager` comes from env (deploy output). */
export const BRANCH_STATIC: Record<BranchKey, BranchStatic> = {
  FXRP: {
    collateralDecimals: 6,
    feedId: XRP_USD_FEED_ID,
    feedDecimals: 6,
    hasXrplMint: true,
    collateralViaAssetManagerFXRP: true,
  },
  WFLR: {
    collateralDecimals: 18,
    feedId: FLR_USD_FEED_ID,
    feedDecimals: 8,
    hasXrplMint: false,
    collateralRegistryName: RegistryNames.WNat,
  },
};

/**
 * Load the configured branches from the environment. A branch is included iff its
 * `VAULT_MANAGER_<KEY>_ADDRESS` is set. Optional overrides: `FEED_ID_<KEY>`,
 * `COLLATERAL_DECIMALS_<KEY>`. Throws on a malformed address (fail-fast at boot).
 *
 * Back-compat: if no per-branch var is set but the legacy `VAULT_MANAGER_ADDRESS`
 * is, it is treated as the FXRP branch.
 */
export function loadBranchesFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): BranchDescriptor[] {
  const out: BranchDescriptor[] = [];
  for (const key of BRANCH_KEYS) {
    const addr = env[`VAULT_MANAGER_${key}_ADDRESS`]?.trim();
    if (!addr) continue;
    if (!isAddress(addr)) {
      throw new Error(`VAULT_MANAGER_${key}_ADDRESS is not a valid address: "${addr}"`);
    }
    const s = BRANCH_STATIC[key];
    const feedOverride = env[`FEED_ID_${key}`]?.trim();
    const decOverride = env[`COLLATERAL_DECIMALS_${key}`]?.trim();
    out.push({
      key,
      vaultManager: getAddress(addr),
      collateralDecimals: decOverride ? Number(decOverride) : s.collateralDecimals,
      feedId: (feedOverride as Hex) || s.feedId,
      feedDecimals: s.feedDecimals,
      hasXrplMint: s.hasXrplMint,
    });
  }

  if (out.length === 0) {
    const legacy = env.VAULT_MANAGER_ADDRESS?.trim();
    if (legacy && isAddress(legacy)) {
      const s = BRANCH_STATIC.FXRP;
      out.push({
        key: "FXRP",
        vaultManager: getAddress(legacy),
        collateralDecimals: s.collateralDecimals,
        feedId: s.feedId,
        feedDecimals: s.feedDecimals,
        hasXrplMint: s.hasXrplMint,
      });
    }
  }
  return out;
}

/** Find the branch flagged for XRPL-native (0xFE) minting — FXRP only. */
export function xrplMintBranch(branches: BranchDescriptor[]): BranchDescriptor | undefined {
  return branches.find((b) => b.hasXrplMint);
}

export function branchByKey(
  branches: BranchDescriptor[],
  key: string,
): BranchDescriptor | undefined {
  return branches.find((b) => b.key === key.toUpperCase());
}

/** Resolve a branch's collateral token address via FlareContractRegistry (never hardcoded). */
export async function resolveBranchCollateralToken(
  client: PublicClient,
  key: BranchKey,
): Promise<Address> {
  const s = BRANCH_STATIC[key];
  if (s.collateralViaAssetManagerFXRP) return resolveFxrpToken(client);
  if (s.collateralRegistryName) return resolveContract(client, s.collateralRegistryName);
  throw new Error(`no collateral resolution configured for branch ${key}`);
}
