import { describe, it, expect, beforeEach } from "vitest";
import { keccak256, toHex, type Address } from "viem";
import { buildServer, type ExecutorServices } from "../src/server.js";
import { InMemoryMintStore } from "../src/orchestrator/store.js";

const userOpBytes = toHex("api-test-userop");
const goodHash = keccak256(userOpBytes);

function makeServices(): ExecutorServices {
  const store = new InMemoryMintStore();
  return {
    store,
    async preflight(input) {
      const ok = input.netMintDrops >= 100_000n;
      return {
        ok,
        blockedReason: ok ? undefined : "net mint below the minimum minting fee — unrecoverable",
        willDelay: false,
        executionAllowedAt: 0n,
        delayReasons: [],
        requiredPaymentDrops: input.netMintDrops + 200_000n,
        requiredPaymentXrp: "x",
        mintFeeDrops: 100_000n,
        warnings: [],
      };
    },
    async account(_xrplAddress) {
      return { personalAccount: ("0x" + "11".repeat(20)) as Address, nonce: 5n };
    },
  };
}

describe("executor API", () => {
  let services: ExecutorServices;
  beforeEach(() => {
    services = makeServices();
  });

  it("GET /health", async () => {
    const app = buildServer(services);
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it("POST /mint/preflight blocks a sub-minimum mint (AE2 at the API layer)", async () => {
    const app = buildServer(services);
    const res = await app.inject({
      method: "POST",
      url: "/mint/preflight",
      payload: { xrplAddress: "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh", netMintDrops: "50000", mint18: "100" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(false);
  });

  it("POST /mint/preflight rejects missing fields with 400", async () => {
    const app = buildServer(services);
    const res = await app.inject({ method: "POST", url: "/mint/preflight", payload: {} });
    expect(res.statusCode).toBe(400);
  });

  it("POST /mint/submit accepts a matching hash and tracks status through GET /mint/status/:id", async () => {
    const app = buildServer(services);
    const submit = await app.inject({
      method: "POST",
      url: "/mint/submit",
      payload: { packedUserOpHex: userOpBytes, xrplTxId: "0xTXAPI", memoUserOpHash: goodHash },
    });
    expect(submit.statusCode).toBe(200);
    const { mintId, state } = submit.json();
    expect(state).toBe("ATTEST_REQUESTED");

    const status = await app.inject({ method: "GET", url: `/mint/status/${encodeURIComponent(mintId)}` });
    expect(status.statusCode).toBe(200);
    expect(status.json().state).toBe("ATTEST_REQUESTED");
  });

  it("POST /mint/submit rejects a hash mismatch with 422", async () => {
    const app = buildServer(services);
    const res = await app.inject({
      method: "POST",
      url: "/mint/submit",
      payload: { packedUserOpHex: userOpBytes, xrplTxId: "0xBAD", memoUserOpHash: keccak256(toHex("nope")) },
    });
    expect(res.statusCode).toBe(422);
  });

  it("GET /mint/status/:id returns 404 for an unknown id", async () => {
    const app = buildServer(services);
    const res = await app.inject({ method: "GET", url: "/mint/status/unknown" });
    expect(res.statusCode).toBe(404);
  });

  it("GET /account/:xrplAddress returns personal account + nonce (bigint serialized)", async () => {
    const app = buildServer(services);
    const res = await app.inject({ method: "GET", url: "/account/rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh" });
    expect(res.statusCode).toBe(200);
    expect(res.json().nonce).toBe("5");
  });
});
