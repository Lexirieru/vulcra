import Fastify, { type FastifyInstance } from "fastify";
import type { Hex, Address } from "viem";
import type { MintStore } from "./orchestrator/store.js";
import { intakeMint } from "./orchestrator/orchestrator.js";
import type { PreflightParams, PreflightResult } from "./preflight/preflight.js";
import type { MintPlan } from "./mintBuilder.js";
import type { ManagePlan, ManageAction } from "./manageBuilder.js";

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
  /** Build the full XRPL 0xFE mint plan (Core Vault destination, memo, amount, userOp). */
  buildMint(input: {
    xrplAddress: string;
    collateral6: bigint;
    mint18: bigint;
    annualInterestRateBps?: bigint;
    vusdDestination?: Address;
  }): Promise<MintPlan>;
  /**
   * Build the XRPL payment that MANAGES an existing vault (repay / close /
   * adjust-rate) via the 0xFE path with net mint 0. Never mocked.
   */
  buildManage(input: {
    xrplAddress: string;
    action: ManageAction;
    amount18?: bigint;
    collateral6?: bigint;
    newRateBps?: bigint;
  }): Promise<ManagePlan>;
  /**
   * Drive a submitted mint through attestation -> executeDirectMintingWithData
   * (fire-and-forget). Absent/no-op when live execution is gated (no funded key);
   * the mint then stays queued with a clear gated status. Never mocked.
   */
  processMint?: (mintId: string) => void;
}

function serializeBigints(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v)),
  );
}

export function buildServer(services: ExecutorServices, opts: { frontendOrigin?: string } = {}): FastifyInstance {
  const app = Fastify({ logger: false });

  // CORS (dev). The dApp runs on a different origin (localhost:3210 / :3000)
  // than this executor (:8787). Without these headers the browser blocks the
  // response and the frontend reads the rejected fetch as "backend offline".
  // JSON POSTs (mint/build, mint/submit) send a preflight OPTIONS too, answered
  // by the wildcard route below. No credentials are used, so we only echo an
  // allow-listed localhost origin (falls back to the configured frontendOrigin).
  const allowOrigins = new Set(
    [
      opts.frontendOrigin,
      "http://localhost:3000",
      "http://localhost:3210",
      "http://127.0.0.1:3000",
      "http://127.0.0.1:3210",
    ].filter((o): o is string => Boolean(o)),
  );
  app.addHook("onRequest", async (req, reply) => {
    const origin = req.headers.origin;
    if (origin && allowOrigins.has(origin)) {
      reply.header("Access-Control-Allow-Origin", origin);
      reply.header("Vary", "Origin");
      reply.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      reply.header("Access-Control-Allow-Headers", "Content-Type");
      reply.header("Access-Control-Max-Age", "86400");
    }
  });
  // Preflight for every route (a JSON request body triggers it). onRequest above
  // has already stamped the CORS headers on this reply.
  app.options("/*", async (_req, reply) => reply.code(204).send());

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

  // Build the ONE XRPL payment (destination Core Vault + 0xFE memo + amount) for an
  // r-address + collateral + mint + optional rate. FXRP-only (XRPL-native).
  app.post<{
    Body: {
      xrplAddress?: string;
      collateral6?: string;
      mint18?: string;
      annualInterestRateBps?: string;
      vusdDestination?: Address;
    };
  }>("/mint/build", async (req, reply) => {
    const { xrplAddress, collateral6, mint18, annualInterestRateBps, vusdDestination } = req.body ?? {};
    if (!xrplAddress || collateral6 === undefined || mint18 === undefined) {
      return reply.code(400).send({ error: "xrplAddress, collateral6, mint18 are required" });
    }
    try {
      const plan = await services.buildMint({
        xrplAddress,
        collateral6: BigInt(collateral6),
        mint18: BigInt(mint18),
        annualInterestRateBps: annualInterestRateBps !== undefined ? BigInt(annualInterestRateBps) : undefined,
        vusdDestination,
      });
      return serializeBigints(plan);
    } catch (err) {
      return reply.code(503).send({ error: (err as Error).message });
    }
  });

  // Build the ONE XRPL payment that MANAGES an existing vault (repay / close /
  // adjust-rate) via the 0xFE net-0 path. The returned plan is signed + tracked
  // through the SAME /mint/submit + /mint/status endpoints as the mint.
  app.post<{
    Body: {
      xrplAddress?: string;
      action?: ManageAction;
      amount18?: string;
      collateral6?: string;
      newRateBps?: string;
    };
  }>("/manage/build", async (req, reply) => {
    const { xrplAddress, action, amount18, collateral6, newRateBps } = req.body ?? {};
    if (
      !xrplAddress ||
      !action ||
      !["repay", "close", "adjustRate", "mintMore", "addCollateral", "withdrawCollateral", "spDeposit"].includes(action)
    ) {
      return reply.code(400).send({ error: "xrplAddress and action (repay|mintMore|addCollateral|withdrawCollateral|spDeposit|close|adjustRate) are required" });
    }
    if ((action === "repay" || action === "mintMore" || action === "spDeposit") && amount18 === undefined) {
      return reply.code(400).send({ error: `amount18 is required for ${action}` });
    }
    if ((action === "addCollateral" || action === "withdrawCollateral") && collateral6 === undefined) {
      return reply.code(400).send({ error: `collateral6 is required for ${action}` });
    }
    if (action === "adjustRate" && newRateBps === undefined) {
      return reply.code(400).send({ error: "newRateBps is required for adjustRate" });
    }
    try {
      const plan = await services.buildManage({
        xrplAddress,
        action,
        amount18: amount18 !== undefined ? BigInt(amount18) : undefined,
        collateral6: collateral6 !== undefined ? BigInt(collateral6) : undefined,
        newRateBps: newRateBps !== undefined ? BigInt(newRateBps) : undefined,
      });
      return serializeBigints(plan);
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
    // Was this txId already submitted? Re-submitting the SAME payment (a
    // double-click, a manual "Track" after an in-wallet sign) must NOT kick off
    // a second attestation: two requestAttestation txs from the executor wallet
    // collide on nonce ("already known"), which strands the mint. Only a
    // genuinely new intake drives the pipeline; a repeat just returns status.
    const alreadyKnown = Boolean(services.store.getByXrplTxId(xrplTxId));
    const rec = intakeMint(services.store, {
      id,
      xrplTxId,
      userOpBytes: packedUserOpHex,
      memoUserOpHash,
    });
    if (rec.state === "REJECTED") {
      return reply.code(422).send({ mintId: rec.id, state: rec.state, error: rec.lastError });
    }
    // Kick off the attestation -> submit pipeline (no-op / gated when unfunded).
    if (!alreadyKnown) services.processMint?.(rec.id);
    const gated = services.processMint === undefined;
    return { mintId: rec.id, state: rec.state, ...(gated ? { note: "live submit gated: set EXECUTOR_PRIVATE_KEY + verifier/DA env to process" } : {}) };
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
