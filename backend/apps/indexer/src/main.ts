import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { isAddress, type Address } from "viem";
import { makePublicClient, readXrpUsd } from "@vulcra/chain-client";
import { SqliteVaultStore, type VaultStore } from "./store.js";
import { pollOnce } from "./ingest.js";
import { buildApi, type PriceResult } from "./api.js";

interface Env {
  rpcUrl: string | undefined;
  vaultManagerAddress: string | undefined;
  port: number;
  dbPath: string;
  maxStalenessSeconds: number;
  confirmations: number;
  pollIntervalMs: number;
  startBlock: bigint;
}

function readEnv(): Env {
  const e = process.env;
  return {
    rpcUrl: e.COSTON2_RPC_URL,
    vaultManagerAddress: e.VAULT_MANAGER_ADDRESS?.trim() || undefined,
    port: Number(e.INDEXER_PORT ?? 8788),
    dbPath: e.INDEXER_DB_PATH ?? "./data/indexer.sqlite",
    maxStalenessSeconds: Number(e.FTSO_MAX_STALENESS_SECONDS ?? 120),
    confirmations: Number(e.INDEXER_CONFIRMATIONS ?? 3),
    pollIntervalMs: Number(e.INDEXER_POLL_INTERVAL_MS ?? 5000),
    startBlock: BigInt(e.INDEXER_START_BLOCK ?? 0),
  };
}

function openStore(dbPath: string): VaultStore {
  if (dbPath !== ":memory:") {
    mkdirSync(dirname(dbPath), { recursive: true });
  }
  return new SqliteVaultStore(dbPath);
}

async function main(): Promise<void> {
  const env = readEnv();
  const store = openStore(env.dbPath);

  const indexingEnabled = !!env.vaultManagerAddress && isAddress(env.vaultManagerAddress);
  if (!indexingEnabled) {
    console.warn(
      "[indexer] VAULT_MANAGER_ADDRESS is missing/invalid — indexing is GATED. " +
        "Starting API in degraded mode (no poll loop).",
    );
  }

  const client = makePublicClient(env.rpcUrl);

  const getPrice = async (): Promise<PriceResult> => {
    try {
      const feed = await readXrpUsd(client, {
        maxStalenessSeconds: env.maxStalenessSeconds,
        nowSeconds: BigInt(Math.floor(Date.now() / 1000)),
      });
      if (feed.stale) return { ok: false, reason: "price feed is stale" };
      return { ok: true, feed };
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : String(err) };
    }
  };

  const app = buildApi({ store, getPrice, indexingEnabled });
  await app.listen({ port: env.port, host: "0.0.0.0" });
  console.log(`[indexer] API listening on :${env.port}`);

  if (indexingEnabled) {
    const vaultManager = env.vaultManagerAddress as Address;
    if (store.getCursor() === 0n && env.startBlock > 0n) {
      store.setCursor(env.startBlock);
      console.log(`[indexer] seeded cursor at block ${env.startBlock}`);
    }
    void runPollLoop(client, store, vaultManager, env);
  }
}

async function runPollLoop(
  client: ReturnType<typeof makePublicClient>,
  store: VaultStore,
  vaultManager: Address,
  env: Env,
): Promise<void> {
  console.log(`[indexer] polling VaultManager ${vaultManager} every ${env.pollIntervalMs}ms`);
  // eslint-disable-next-line no-constant-condition
  for (;;) {
    try {
      const res = await pollOnce(client, store, vaultManager, {
        confirmations: env.confirmations,
      });
      if (res.applied > 0) {
        console.log(
          `[indexer] applied ${res.applied} event(s) over blocks ${res.fromBlock}..${res.toBlock}`,
        );
      }
    } catch (err) {
      console.error("[indexer] poll error:", err instanceof Error ? err.message : err);
    }
    await sleep(env.pollIntervalMs);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((err) => {
  console.error("[indexer] fatal:", err);
  process.exit(1);
});
