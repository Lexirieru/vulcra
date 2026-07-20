import Fastify, { type FastifyInstance } from "fastify";
import type { FeedReading } from "@vulcra/chain-client";
import type { VaultRow, VaultStore } from "./store.js";
import { atRisk, vaultCrBps } from "./sortedByCr.js";

/** A live XRP/USD reading, or a reason it is unavailable/unusable. */
export type PriceResult =
  | { ok: true; feed: FeedReading }
  | { ok: false; reason: string };

export interface ApiDeps {
  store: VaultStore;
  /**
   * Fetch the current XRP/USD feed. Should resolve `{ ok: false }` (never throw)
   * when the chain/price is unavailable or stale, so price-dependent routes can
   * answer 503 instead of crashing.
   */
  getPrice: () => Promise<PriceResult>;
  /** False when VAULT_MANAGER_ADDRESS is unset — API runs, indexing is gated. */
  indexingEnabled: boolean;
}

/** Serialize a vault row to a JSON-safe object (bigint → decimal string). */
function serializeVault(row: VaultRow): Record<string, unknown> {
  return {
    owner: row.owner,
    collateral6: row.collateral6.toString(),
    debt18: row.debt18.toString(),
    nicr: row.nicr.toString(),
    active: row.active,
    lastBlock: row.lastBlock.toString(),
    lastTxHash: row.lastTxHash,
  };
}

function serializeFeed(feed: FeedReading): Record<string, unknown> {
  return {
    value: feed.value.toString(),
    decimals: feed.decimals,
    price18: feed.price18.toString(),
    timestamp: feed.timestamp.toString(),
    stale: feed.stale,
  };
}

/** Parse `belowCrBps` query (positive integer). Returns null on invalid input. */
function parseBelowCrBps(raw: unknown, fallback: bigint): bigint | null {
  if (raw === undefined) return fallback;
  const s = String(raw);
  if (!/^\d+$/.test(s)) return null;
  const v = BigInt(s);
  return v > 0n ? v : null;
}

/**
 * Build the indexer HTTP API.
 *   GET /health              — always 200; reports gating + cursor + active count.
 *   GET /vaults/at-risk       — price-dependent; 503 when no live/fresh price.
 *   GET /vaults/:owner        — stored row (200/404); CR added when price available.
 */
export function buildApi(deps: ApiDeps): FastifyInstance {
  const app = Fastify({ logger: false });
  const { store, getPrice } = deps;

  app.get("/health", async () => {
    return {
      status: "ok",
      indexingEnabled: deps.indexingEnabled,
      cursor: store.getCursor().toString(),
      activeVaults: store.listActive().length,
    };
  });

  app.get("/vaults/at-risk", async (request, reply) => {
    const query = request.query as Record<string, unknown>;
    const belowCrBps = parseBelowCrBps(query.belowCrBps, 13000n);
    if (belowCrBps === null) {
      return reply.code(400).send({ error: "belowCrBps must be a positive integer" });
    }

    const price = await getPrice();
    if (!price.ok) {
      return reply.code(503).send({ error: "price feed unavailable", reason: price.reason });
    }

    const flagged = atRisk(
      store.listActive(),
      price.feed.value,
      price.feed.decimals,
      belowCrBps,
    );
    return {
      belowCrBps: belowCrBps.toString(),
      price: serializeFeed(price.feed),
      count: flagged.length,
      vaults: flagged.map((x) => ({ ...serializeVault(x.vault), crBps: x.crBps.toString() })),
    };
  });

  app.get("/vaults/:owner", async (request, reply) => {
    const { owner } = request.params as { owner: string };
    const row = store.getVault(owner);
    if (!row) {
      return reply.code(404).send({ error: "vault not found", owner: owner.toLowerCase() });
    }

    // CR is computed on read from the live price. If the price is unavailable we
    // still return the stored row (the primary resource) with crBps: null rather
    // than failing the whole lookup.
    const price = await getPrice();
    const body: Record<string, unknown> = serializeVault(row);
    if (price.ok) {
      body.crBps = vaultCrBps(row, price.feed.value, price.feed.decimals).toString();
      body.price = serializeFeed(price.feed);
    } else {
      body.crBps = null;
      body.crUnavailable = price.reason;
    }
    return body;
  });

  return app;
}
