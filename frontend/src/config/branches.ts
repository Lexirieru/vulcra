// Multi-collateral branch registry. The VaultManager ABI is identical across
// branches (smart contract is authority) — a branch is just a separate deployed
// VaultManager instance plus its collateral token and price feed. Everything is
// env-driven (NEXT_PUBLIC_*) with documented defaults; a blank vaultManager means
// that branch is not deployed yet and its surfaces show a "not configured" state.
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
  /** Collateral token address override; else resolved via ContractRegistry. */
  collateralToken: Address | "";
  /** ContractRegistry name to resolve the collateral token at runtime (no hardcode). */
  collateralRegistryName?: string;
}

// Verified Coston2 feed ids (dev.flare.network/ftso/feeds).
const XRP_USD_FEED =
  "0x015852502f55534400000000000000000000000000" as Hex;
const FLR_USD_FEED =
  "0x01464c522f55534400000000000000000000000000" as Hex;

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
    // Deployed + source-verified on Coston2 (smartcontract/deployments/coston2.json).
    vaultManager: (env("NEXT_PUBLIC_VAULT_MANAGER_FXRP") ||
      env("NEXT_PUBLIC_VAULT_MANAGER_ADDRESS") ||
      "0xB74e100F2C651822082360777dD825c2b24E08E1") as Address,
    // FXRP fAsset; also resolvable via AssetManagerFXRP.fAsset().
    collateralToken: (env("NEXT_PUBLIC_COLLATERAL_TOKEN_FXRP") ||
      "0x0b6A3645c240605887a5532109323A3E12273dc7") as Address,
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
    // Not deployed yet — set NEXT_PUBLIC_VAULT_MANAGER_WFLR once the wFLR
    // branch VaultManager is live on Coston2.
    vaultManager: env("NEXT_PUBLIC_VAULT_MANAGER_WFLR") as Address | "",
    // WNat/wFLR is resolved at runtime via ContractRegistry ("WNat"); the env
    // override / documented default is only a fallback.
    collateralToken: env("NEXT_PUBLIC_COLLATERAL_TOKEN_WFLR") as Address | "",
    collateralRegistryName: "WNat",
  },
};

export const BRANCH_ORDER: BranchKey[] = ["fxrp", "wflr"];

export const DEFAULT_BRANCH: BranchKey = "fxrp";

export function isBranchKey(v: string | null | undefined): v is BranchKey {
  return v === "fxrp" || v === "wflr";
}
