import { makePublicClient } from "@vulcra/chain-client";
import { loadEnv, requirePreflightConfig } from "./env.js";
import { buildServer } from "./server.js";
import { buildLiveServices } from "./services.js";
import { InMemoryMintStore, createSqliteMintStore, type MintStore } from "./orchestrator/store.js";

/**
 * Executor entry point. Boots the API for pre-flight + intake + status. Live
 * mint SUBMISSION is gated behind EXECUTOR_PRIVATE_KEY + verifier/DA env
 * (validated in env.ts) — the process still serves read-only endpoints without
 * those keys so the frontend can develop against it.
 */
async function main(): Promise<void> {
  const env = loadEnv();
  const client = makePublicClient(env.rpcUrl);

  let store: MintStore;
  try {
    store = await createSqliteMintStore(env.dbPath);
    // eslint-disable-next-line no-console
    console.log(`[executor] durable store at ${env.dbPath}`);
  } catch (err) {
    store = new InMemoryMintStore();
    // eslint-disable-next-line no-console
    console.warn(`[executor] node:sqlite unavailable (${(err as Error).message}); using in-memory store`);
  }

  try {
    requirePreflightConfig(env);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[executor] pre-flight gated: ${(err as Error).message}`);
  }

  const services = await buildLiveServices(client, env, store);
  const app = buildServer(services, { frontendOrigin: env.frontendOrigin });

  await app.listen({ port: env.port, host: "0.0.0.0" });
  // eslint-disable-next-line no-console
  console.log(`[executor] listening on :${env.port}`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("[executor] fatal:", err);
  process.exit(1);
});
