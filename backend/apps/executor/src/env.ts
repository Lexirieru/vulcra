import {
  loadBranchesFromEnv,
  xrplMintBranch,
  type BranchDescriptor,
} from "@vulcra/chain-client";

/**
 * Executor environment + boot validation.
 *
 * The executor owns ONLY the XRPL-native (0xFE) mint path, which is FXRP-only
 * (wFLR is EVM-only — there is no 0xFE atomic mint for it). So while config is
 * multi-collateral aware (a list of branches), the executor operates on the
 * FXRP branch. `vaultManagerAddress` below is the FXRP branch's VaultManager.
 *
 * Live on-chain steps require keys that may not be provisioned yet
 * (EXECUTOR_PRIVATE_KEY, SERVICE_XRPL_SEED, verifier/DA config). These are
 * GATED: the process still boots for read-only / pre-flight use, but any live
 * submit throws a clear error naming the missing variable. Nothing is mocked.
 */

export interface ExecutorEnv {
  rpcUrl: string;
  chainId: number;
  port: number;
  frontendOrigin: string;
  dbPath: string;
  walletId: number;
  ftsoMaxStalenessSeconds: number;

  /** All configured collateral branches. */
  branches: BranchDescriptor[];
  /** The FXRP branch (the only one that supports XRPL-native minting), if configured. */
  xrplBranch?: BranchDescriptor;
  /** FXRP branch VaultManager (for pre-flight param reads). Convenience alias. */
  vaultManagerAddress?: string;

  vulcraZapAddress?: string;
  vusdAddress?: string;

  // Gated live-execution secrets
  executorPrivateKey?: string;
  serviceXrplSeed?: string;
  verifierUrl?: string;
  verifierApiKey?: string;
  daLayerUrl?: string;

  // FDC round timing / fee (optional; resolved live or defaulted for a real submit)
  fdcFirstVotingRoundStartTs?: bigint;
  fdcVotingEpochDurationSeconds?: bigint;
  fdcRequestFeeWei?: bigint;
}

function optBigint(v: string | undefined): bigint | undefined {
  if (v === undefined || v === "") return undefined;
  return BigInt(v);
}

function num(v: string | undefined, dflt: number): number {
  if (v === undefined || v === "") return dflt;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`expected a number, got "${v}"`);
  return n;
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): ExecutorEnv {
  const branches = loadBranchesFromEnv(source);
  const xrplBranch = xrplMintBranch(branches);
  return {
    rpcUrl: source.COSTON2_RPC_URL ?? "https://coston2-api.flare.network/ext/C/rpc",
    chainId: num(source.COSTON2_CHAIN_ID, 114),
    port: num(source.EXECUTOR_PORT, 8787),
    frontendOrigin: source.FRONTEND_ORIGIN ?? "http://localhost:3000",
    dbPath: source.EXECUTOR_DB_PATH ?? "./data/executor.sqlite",
    walletId: num(source.WALLET_ID, 0),
    ftsoMaxStalenessSeconds: num(source.FTSO_MAX_STALENESS_SECONDS, 120),
    branches,
    xrplBranch,
    vaultManagerAddress: xrplBranch?.vaultManager,
    vulcraZapAddress: source.VULCRA_ZAP_ADDRESS || undefined,
    vusdAddress: source.VUSD_ADDRESS || undefined,
    executorPrivateKey: source.EXECUTOR_PRIVATE_KEY || undefined,
    serviceXrplSeed: source.SERVICE_XRPL_SEED || undefined,
    verifierUrl: source.VERIFIER_URL_TESTNET || undefined,
    verifierApiKey: source.VERIFIER_API_KEY_TESTNET || undefined,
    daLayerUrl: source.COSTON2_DA_LAYER_URL || undefined,
    fdcFirstVotingRoundStartTs: optBigint(source.FDC_FIRST_VOTING_ROUND_START_TS),
    fdcVotingEpochDurationSeconds: optBigint(source.FDC_VOTING_EPOCH_DURATION_SECONDS),
    fdcRequestFeeWei: optBigint(source.FDC_REQUEST_FEE_WEI),
  };
}

/** Read-only / pre-flight surface (no signing) needs the FXRP branch + Zap. */
export function requirePreflightConfig(env: ExecutorEnv): void {
  if (!env.xrplBranch) {
    throw new Error(
      "No FXRP branch configured — set VAULT_MANAGER_FXRP_ADDRESS (the FXRP VaultManager) for XRPL-native mint pre-flight. " +
        "wFLR is EVM-only and does not use the executor.",
    );
  }
  if (!env.vulcraZapAddress) {
    throw new Error("VULCRA_ZAP_ADDRESS must be set (FXRP atomic-mint Zap) for pre-flight.");
  }
}

/** What is needed to actually submit a mint on-chain. Fail-fast, never mock. */
export function requireLiveExecutionConfig(env: ExecutorEnv): void {
  const missing: string[] = [];
  if (!env.executorPrivateKey) missing.push("EXECUTOR_PRIVATE_KEY");
  if (!env.verifierUrl) missing.push("VERIFIER_URL_TESTNET");
  if (!env.verifierApiKey) missing.push("VERIFIER_API_KEY_TESTNET");
  if (!env.daLayerUrl) missing.push("COSTON2_DA_LAYER_URL");
  if (!env.xrplBranch) missing.push("VAULT_MANAGER_FXRP_ADDRESS");
  if (!env.vulcraZapAddress) missing.push("VULCRA_ZAP_ADDRESS");
  if (missing.length > 0) {
    throw new Error(
      `Live mint execution is gated: set ${missing.join(", ")} in .env (gitignored). ` +
        "These are not mocked — real mint needs real Flare access.",
    );
  }
}
