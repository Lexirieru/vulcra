import Fastify, { type FastifyInstance } from "fastify";
import type { FeedReading } from "@vulcra/chain-client";
import type { VaultRow, VaultStore } from "./store.js";
import { atRisk, vaultCrBps } from "./sortedByCr.js";

/** A live feed reading for a branch, or a reason it is unavailable/unusable. */
export type PriceResult =
  | { ok: true; feed: FeedReading }
  | { ok: false; reason: string };

/** One indexed collateral branch exposed by the API. */
export interface BranchApi {
  key: string; // "FXRP" | "WFLR"
  store: VaultStore;
  collateralDecimals: number;
  /** Branch feed reader; resolves `{ ok: false }` (never throws) when unavailable. */
  getPrice: () => Promise<PriceResult>;
}

export interface ApiDeps {
  /** All configured branches (each has its own store + feed). */
  branches: BranchApi[];
  /** False when no VaultManager branch is configured — API runs, indexing gated. */
  indexingEnabled: boolean;
}

function serializeVault(row: VaultRow): Record<string, unknown> {
  return {
    owner: row.owner,
    // Raw collateral in the branch's native decimals (field name is legacy).
    collateral: row.collateral6.toString(),
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

function parseBelowCrBps(raw: unknown, fallback: bigint): bigint | null {
  if (raw === undefined) return fallback;
  const s = String(raw);
  if (!/^\d+$/.test(s)) return null;
  const v = BigInt(s);
  return v > 0n ? v : null;
}

/**
 * Build the branch-aware indexer HTTP API.
 *   GET /health                    — per-branch cursor + active count.
 *   GET /branches                  — configured branch keys + metadata.
 *   GET /vaults/at-risk?branch=KEY  — price-dependent; 503 when no live/fresh price.
 *   GET /vaults/:branch/:owner      — one vault in a branch; CR added when price available.
 */
export function buildApi(deps: ApiDeps): FastifyInstance {
  const app = Fastify({ logger: false });
  const byKey = new Map(deps.branches.map((b) => [b.key.toUpperCase(), b]));

  /** Resolve a branch by key; default to the first configured branch when omitted. */
  const resolveBranch = (raw: unknown): BranchApi | undefined => {
    if (raw === undefined || raw === "") return deps.branches[0];
    return byKey.get(String(raw).toUpperCase());
  };

  app.get("/health", async () => ({
    status: "ok",
    indexingEnabled: deps.indexingEnabled,
    branches: deps.branches.map((b) => ({
      key: b.key,
      collateralDecimals: b.collateralDecimals,
      cursor: b.store.getCursor().toString(),
      activeVaults: b.store.listActive().length,
    })),
  }));

  app.get("/branches", async () => ({
    branches: deps.branches.map((b) => ({ key: b.key, collateralDecimals: b.collateralDecimals })),
  }));

  app.get("/vaults/at-risk", async (request, reply) => {
    const query = request.query as Record<string, unknown>;
    const branch = resolveBranch(query.branch);
    if (!branch) {
      return reply.code(404).send({ error: "unknown branch", branch: query.branch ?? null });
    }
    const belowCrBps = parseBelowCrBps(query.belowCrBps, 13000n);
    if (belowCrBps === null) {
      return reply.code(400).send({ error: "belowCrBps must be a positive integer" });
    }

    const price = await branch.getPrice();
    if (!price.ok) {
      return reply
        .code(503)
        .send({ error: "price feed unavailable", branch: branch.key, reason: price.reason });
    }

    const flagged = atRisk(
      branch.store.listActive(),
      branch.collateralDecimals,
      price.feed.value,
      price.feed.decimals,
      belowCrBps,
    );
    return {
      branch: branch.key,
      belowCrBps: belowCrBps.toString(),
      price: serializeFeed(price.feed),
      count: flagged.length,
      vaults: flagged.map((x) => ({ ...serializeVault(x.vault), crBps: x.crBps.toString() })),
    };
  });

  app.get("/vaults/:branch/:owner", async (request, reply) => {
    const { branch: branchKey, owner } = request.params as { branch: string; owner: string };
    const branch = resolveBranch(branchKey);
    if (!branch) {
      return reply.code(404).send({ error: "unknown branch", branch: branchKey });
    }
    const row = branch.store.getVault(owner);
    if (!row) {
      return reply
        .code(404)
        .send({ error: "vault not found", branch: branch.key, owner: owner.toLowerCase() });
    }

    const price = await branch.getPrice();
    const body: Record<string, unknown> = { branch: branch.key, ...serializeVault(row) };
    if (price.ok) {
      body.crBps = vaultCrBps(
        row,
        branch.collateralDecimals,
        price.feed.value,
        price.feed.decimals,
      ).toString();
      body.price = serializeFeed(price.feed);
    } else {
      body.crBps = null;
      body.crUnavailable = price.reason;
    }
    return body;
  });

  return app;
}
