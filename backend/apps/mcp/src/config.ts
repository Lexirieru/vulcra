import { getAddress, isAddress, type Address, type Hex } from "viem";
import { XRP_USD_FEED_ID, FLR_USD_FEED_ID } from "@vulcra/chain-client";

/**
 * MCP server configuration — all runtime knobs come from the environment (never a
 * committed secret; this server holds NO keys). Sensible Coston2 defaults let the
 * server run out of the box against the deployed Vulcra V2 contracts.
 *
 * The MCP process only ever needs read/RPC access + the two backend HTTP services
 * (executor for building the unsigned XRPL payment, indexer for the at-risk list).
 */

export type BranchKey = "FXRP" | "WFLR";

export interface McpBranch {
  key: BranchKey;
  label: string;
  /** Collateral token symbol shown to the user. */
  collateralSymbol: string;
  /** Collateral token decimals (FXRP 6, wFLR 18) — drives all base-unit math. */
  collateralDecimals: number;
  /** FTSOv2 block-latency USD feed id for this branch's collateral. */
  feedId: Hex;
  feedLabel: string;
  /** Deployed VaultManager instance for this branch on Coston2. */
  vaultManager: Address;
  /** Earn StabilityPool (UUPS proxy) for this branch. */
  stabilityPool: Address;
  /** Only the FXRP branch supports the XRPL-native 0xFE atomic mint / manage path. */
  hasXrplMint: boolean;
}

export interface McpConfig {
  /** Fastify executor base URL — builds the unsigned XRPL payment (/mint/build, /manage/build). */
  executorUrl: string;
  /** Indexer base URL — serves the at-risk / branch views. */
  indexerUrl: string;
  /** Coston2 JSON-RPC endpoint for direct on-chain reads (FTSO price, vault state). */
  rpcUrl: string;
  /** Coston2 explorer base for building human links. */
  explorerUrl: string;
  /** Direct-minting walletId committed in the 0xFE memo (matches the executor). */
  walletId: number;
  branches: Record<BranchKey, McpBranch>;
}

const env = (k: string): string | undefined => {
  const v = process.env[k]?.trim();
  return v && v.length > 0 ? v : undefined;
};

/** First env var that is set, else the fallback. */
const pick = (keys: string[], fallback: string): string => {
  for (const k of keys) {
    const v = env(k);
    if (v) return v;
  }
  return fallback;
};

function resolveAddress(keys: string[], fallback: string): Address {
  const raw = pick(keys, fallback);
  if (!isAddress(raw)) {
    throw new Error(`Configured address is invalid: "${raw}" (from ${keys.join(" / ")})`);
  }
  return getAddress(raw);
}

/**
 * Build the effective config from the environment. Contract addresses default to
 * the live Coston2 deployments (same values the dApp ships in
 * frontend/src/config/branches.ts); override any of them via env for a fresh
 * deploy. No secret is ever read here.
 */
export function loadConfig(): McpConfig {
  const branches: Record<BranchKey, McpBranch> = {
    FXRP: {
      key: "FXRP",
      label: "FXRP",
      collateralSymbol: "FXRP",
      collateralDecimals: 6,
      feedId: XRP_USD_FEED_ID,
      feedLabel: "XRP/USD",
      vaultManager: resolveAddress(
        ["VULCRA_VAULT_MANAGER_FXRP", "VAULT_MANAGER_FXRP_ADDRESS", "VAULT_MANAGER_ADDRESS"],
        "0x93e572cDbfb62557E041B53490e5208C147b5388",
      ),
      stabilityPool: resolveAddress(
        ["VULCRA_STABILITY_POOL_FXRP", "STABILITY_POOL_FXRP_ADDRESS"],
        "0xfA2dCc4B93909ACc1dd6b2e92178D04cD1D851E4",
      ),
      hasXrplMint: true,
    },
    WFLR: {
      key: "WFLR",
      label: "wFLR",
      collateralSymbol: "WC2FLR",
      collateralDecimals: 18,
      feedId: FLR_USD_FEED_ID,
      feedLabel: "FLR/USD",
      vaultManager: resolveAddress(
        ["VULCRA_VAULT_MANAGER_WFLR", "VAULT_MANAGER_WFLR_ADDRESS"],
        "0x1F079F205ca2857a3A199937Ace956ed51B0b3b8",
      ),
      stabilityPool: resolveAddress(
        ["VULCRA_STABILITY_POOL_WFLR", "STABILITY_POOL_WFLR_ADDRESS"],
        "0xB963D913CFb4688634184aB7b22e554B34557e07",
      ),
      hasXrplMint: false,
    },
  };

  return {
    executorUrl: pick(["VULCRA_EXECUTOR_URL", "EXECUTOR_URL"], "http://localhost:8787").replace(/\/$/, ""),
    indexerUrl: pick(["VULCRA_INDEXER_URL", "INDEXER_URL"], "http://localhost:8788").replace(/\/$/, ""),
    rpcUrl: pick(
      ["VULCRA_RPC_URL", "COSTON2_RPC_URL", "RPC_URL"],
      "https://coston2-api.flare.network/ext/C/rpc",
    ),
    explorerUrl: pick(["VULCRA_EXPLORER_URL"], "https://coston2-explorer.flare.network").replace(/\/$/, ""),
    walletId: Number(pick(["VULCRA_WALLET_ID", "WALLET_ID"], "0")),
    branches,
  };
}

/** Resolve a branch key (case-insensitive), defaulting to FXRP. Throws on unknown. */
export function resolveBranch(cfg: McpConfig, raw?: string): McpBranch {
  const key = (raw ?? "FXRP").toUpperCase();
  const branch = cfg.branches[key as BranchKey];
  if (!branch) {
    throw new Error(`Unknown branch "${raw}". Known branches: ${Object.keys(cfg.branches).join(", ")}.`);
  }
  return branch;
}
