import Fastify, { type FastifyInstance } from "fastify";
import type { Hex, Address } from "viem";
import type { MintStore } from "./orchestrator/store.js";
import { intakeMint } from "./orchestrator/orchestrator.js";
import type { PreflightParams, PreflightResult } from "./preflight/preflight.js";

/**
 * Executor HTTP API (R11, R13). Chain-dependent work is injected as services so
 * the routing/validation layer is unit-testable via fastify.inject without a
 * live chain (the Flare integration itself is never mocked in production).
 */
export interface ExecutorServices {
  store: MintStore;
  /** Pre-flight a proposed mint (reads limits/fees on-chain in production). */
  preflight(input: {
    xrplAddress: string;
    netMintDrops: bigint;
    mint18: bigint;
  }): Promise<PreflightResult>;
  /** Resolve personal account + nonce for the frontend to build the payment. */
  account(xrplAddress: string): Promise<{ personalAccount: Address; nonce: bigint }>;
}

function serializeBigints(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v)),
  );
}

export function buildServer(services: ExecutorServices, opts: { frontendOrigin?: string } = {}): FastifyInstance {
  const app = Fastify({ logger: false });

  app.get("/health", async () => ({ ok: true }));

  app.get<{ Params: { xrplAddress: string } }>("/account/:xrplAddress", async (req, reply) => {
    try {
      const r = await services.account(req.params.xrplAddress);
      return serializeBigints(r);
    } catch (err) {
      return reply.code(503).send({ error: (err as Error).message });
    }
  });

  app.post<{
    Body: { xrplAddress?: string; netMintDrops?: string; mint18?: string };
  }>("/mint/preflight", async (req, reply) => {
    const { xrplAddress, netMintDrops, mint18 } = req.body ?? {};
    if (!xrplAddress || netMintDrops === undefined || mint18 === undefined) {
      return reply.code(400).send({ error: "xrplAddress, netMintDrops, mint18 are required" });
    }
    try {
      const result = await services.preflight({
        xrplAddress,
        netMintDrops: BigInt(netMintDrops),
        mint18: BigInt(mint18),
      });
      return serializeBigints(result);
    } catch (err) {
      return reply.code(503).send({ error: (err as Error).message });
    }
  });

  app.post<{
    Body: { packedUserOpHex?: Hex; xrplTxId?: string; memoUserOpHash?: Hex };
  }>("/mint/submit", async (req, reply) => {
    const { packedUserOpHex, xrplTxId, memoUserOpHash } = req.body ?? {};
    if (!packedUserOpHex || !xrplTxId || !memoUserOpHash) {
      return reply
        .code(400)
        .send({ error: "packedUserOpHex, xrplTxId, memoUserOpHash are required" });
    }
    const id = `mint:${xrplTxId.toLowerCase()}`;
    const rec = intakeMint(services.store, {
      id,
      xrplTxId,
      userOpBytes: packedUserOpHex,
      memoUserOpHash,
    });
    if (rec.state === "REJECTED") {
      return reply.code(422).send({ mintId: rec.id, state: rec.state, error: rec.lastError });
    }
    return { mintId: rec.id, state: rec.state };
  });

  app.get<{ Params: { id: string } }>("/mint/status/:id", async (req, reply) => {
    const rec = services.store.get(req.params.id);
    if (!rec) return reply.code(404).send({ error: "unknown mintId" });
    return serializeBigints({
      mintId: rec.id,
      state: rec.state,
      delayed: rec.state === "DELAYED",
      executionAllowedAt: rec.executionAllowedAt,
      attempts: rec.attempts,
      lastError: rec.lastError,
    });
  });

  return app;
}

export type { PreflightParams };
