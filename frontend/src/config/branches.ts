// Multi-collateral branch registry (Vulcra V2). The VaultManager ABI is identical
// across branches (smart contract is authority) — a branch is a separate deployed
// VaultManager instance plus its collateral token and price feed. Everything is
// env-driven (NEXT_PUBLIC_*) with documented V2 defaults from
// smartcontract/deployments/coston2.json; a blank vaultManager shows a
// "not configured" state.
import type { Address, Hex } from "viem";

const env = (k: string) => process.env[k]?.trim() || "";

export type BranchKey = "fxrp" | "wflr";

export interface CollateralBranch {
  key: BranchKey;
  label: string;
  /** Display symbol for the collateral token. */
  collateralSymbol: string;
  /** Decimals of the collateral token (FXRP 6, wFLR 18). */
  collateralDecimals: number;
  /** FTSO block-latency feed for this collateral's USD price. */
  feedId: Hex;
  feedLabel: string;
  /** XRPL-native 0xFE mint only exists for the XRP→FXRP branch. */
  hasXrplMint: boolean;
  /** wFLR is obtained by wrapping native C2FLR via WNat.deposit(). */
  wrapNative: boolean;
  /** Vulcra VaultManager instance for this branch (env; not in ContractRegistry). */
  vaultManager: Address | "";
  /** VulcraZap (0xFE atomic-mint helper) for XRPL-native branches. */
  zap: Address | "";
  /** Collateral token address override; else resolved via ContractRegistry. */
  collateralToken: Address | "";
  /** ContractRegistry name to resolve the collateral token at runtime (no hardcode). */
  collateralRegistryName?: string;
  /** Interest bounds (bps/yr) — fallback; the contract getters are authoritative. */
  interest: { minBps: number; maxBps: number; defaultBps: number };
}

// Verified Coston2 feed ids (dev.flare.network/ftso/feeds).
const XRP_USD_FEED = "0x015852502f55534400000000000000000000000000" as Hex;
const FLR_USD_FEED = "0x01464c522f55534400000000000000000000000000" as Hex;

export const BRANCHES: Record<BranchKey, CollateralBranch> = {
  fxrp: {
    key: "fxrp",
    label: "FXRP",
    collateralSymbol: "FXRP",
    collateralDecimals: 6,
    feedId: XRP_USD_FEED,
    feedLabel: "XRP/USD",
    hasXrplMint: true,
    wrapNative: false,
    // Vulcra V2, deployed + verified on Coston2 (deployments/coston2.json).
    vaultManager: (env("NEXT_PUBLIC_VAULT_MANAGER_FXRP") ||
      env("NEXT_PUBLIC_VAULT_MANAGER_ADDRESS") ||
      "0x93e572cDbfb62557E041B53490e5208C147b5388") as Address,
    zap: (env("NEXT_PUBLIC_ZAP_FXRP") ||
      "0xCe4f886e67dE51418751314eEb19aC2D75B59dfE") as Address,
    // FXRP fAsset; also resolvable via AssetManagerFXRP.fAsset().
    collateralToken: (env("NEXT_PUBLIC_COLLATERAL_TOKEN_FXRP") ||
      "0x0b6A3645c240605887a5532109323A3E12273dc7") as Address,
    interest: { minBps: 50, maxBps: 25_000, defaultBps: 500 },
  },
  wflr: {
    key: "wflr",
    label: "wFLR",
    collateralSymbol: "WC2FLR",
    collateralDecimals: 18,
    feedId: FLR_USD_FEED,
    feedLabel: "FLR/USD",
    hasXrplMint: false,
    wrapNative: true,
    // Vulcra V2, deployed + verified on Coston2 (deployments/coston2.json).
    vaultManager: (env("NEXT_PUBLIC_VAULT_MANAGER_WFLR") ||
      "0x1F079F205ca2857a3A199937Ace956ed51B0b3b8") as Address,
    zap: "",
    // WNat/wFLR is resolved at runtime via ContractRegistry ("WNat"); the env
    // override / documented default is only a fallback.
    collateralToken: env("NEXT_PUBLIC_COLLATERAL_TOKEN_WFLR") as Address | "",
    collateralRegistryName: "WNat",
    interest: { minBps: 50, maxBps: 25_000, defaultBps: 800 },
  },
};

export const BRANCH_ORDER: BranchKey[] = ["fxrp", "wflr"];

export const DEFAULT_BRANCH: BranchKey = "fxrp";

export function isBranchKey(v: string | null | undefined): v is BranchKey {
  return v === "fxrp" || v === "wflr";
}
