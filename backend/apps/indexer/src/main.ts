import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import {
  loadBranchesFromEnv,
  makePublicClient,
  readBranchPrice,
  type BranchDescriptor,
} from "@vulcra/chain-client";
import { SqliteVaultStore, type VaultStore } from "./store.js";
import { pollOnce } from "./ingest.js";
import { buildApi, type BranchApi, type PriceResult } from "./api.js";

interface Env {
  rpcUrl: string | undefined;
  port: number;
  dbPath: string;
  maxStalenessSeconds: number;
  confirmations: number;
  pollIntervalMs: number;
}

function readEnv(): Env {
  const e = process.env;
  return {
    rpcUrl: e.COSTON2_RPC_URL,
    port: Number(e.INDEXER_PORT ?? 8788),
    dbPath: e.INDEXER_DB_PATH ?? "./data/indexer.sqlite",
    maxStalenessSeconds: Number(e.FTSO_MAX_STALENESS_SECONDS ?? 120),
    confirmations: Number(e.INDEXER_CONFIRMATIONS ?? 3),
    pollIntervalMs: Number(e.INDEXER_POLL_INTERVAL_MS ?? 5000),
  };
}

/** Per-branch DB path: ./data/indexer.sqlite -> ./data/indexer-FXRP.sqlite (":memory:" stays as-is). */
function branchDbPath(base: string, key: string): string {
  if (base === ":memory:") return ":memory:";
  return base.replace(/(\.[^./]+)?$/, `-${key}$1`);
}

function startBlockFor(key: string): bigint {
  const per = process.env[`INDEXER_START_BLOCK_${key}`];
  const global = process.env.INDEXER_START_BLOCK;
  return BigInt(per ?? global ?? 0);
}

function openStore(dbPath: string): VaultStore {
  if (dbPath !== ":memory:") mkdirSync(dirname(dbPath), { recursive: true });
  return new SqliteVaultStore(dbPath);
}

async function main(): Promise<void> {
  const env = readEnv();
  const branches = loadBranchesFromEnv();
  const indexingEnabled = branches.length > 0;

  if (!indexingEnabled) {
    console.warn(
      "[indexer] no VAULT_MANAGER_<BRANCH>_ADDRESS configured — indexing is GATED. " +
        "Starting API in degraded mode (no poll loops).",
    );
  } else {
    console.log(`[indexer] branches: ${branches.map((b) => b.key).join(", ")}`);
  }

  const client = makePublicClient(env.rpcUrl);

  const branchApis: BranchApi[] = branches.map((branch) => {
    const store = openStore(branchDbPath(env.dbPath, branch.key));
    const getPrice = async (): Promise<PriceResult> => {
      try {
        const feed = await readBranchPrice(client, branch, {
          maxStalenessSeconds: env.maxStalenessSeconds,
          nowSeconds: BigInt(Math.floor(Date.now() / 1000)),
        });
        if (feed.stale) return { ok: false, reason: `${branch.key} price feed is stale` };
        return { ok: true, feed };
      } catch (err) {
        return { ok: false, reason: err instanceof Error ? err.message : String(err) };
      }
    };
    return { key: branch.key, store, collateralDecimals: branch.collateralDecimals, getPrice };
  });

  const app = buildApi({ branches: branchApis, indexingEnabled });
  await app.listen({ port: env.port, host: "0.0.0.0" });
  console.log(`[indexer] API listening on :${env.port}`);

  branches.forEach((branch, i) => {
    const store = branchApis[i]!.store;
    const seed = startBlockFor(branch.key);
    if (store.getCursor() === 0n && seed > 0n) {
      store.setCursor(seed);
      console.log(`[indexer:${branch.key}] seeded cursor at block ${seed}`);
    }
    void runPollLoop(client, store, branch, env);
  });
}

async function runPollLoop(
  client: ReturnType<typeof makePublicClient>,
  store: VaultStore,
  branch: BranchDescriptor,
  env: Env,
): Promise<void> {
  console.log(
    `[indexer:${branch.key}] polling VaultManager ${branch.vaultManager} every ${env.pollIntervalMs}ms`,
  );
  for (;;) {
    try {
      const res = await pollOnce(client, store, branch.vaultManager, {
        confirmations: env.confirmations,
      });
      if (res.applied > 0) {
        console.log(
          `[indexer:${branch.key}] applied ${res.applied} event(s) over blocks ${res.fromBlock}..${res.toBlock}`,
        );
      }
    } catch (err) {
      console.error(`[indexer:${branch.key}] poll error:`, err instanceof Error ? err.message : err);
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
