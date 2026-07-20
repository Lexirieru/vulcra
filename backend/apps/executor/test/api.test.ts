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
    async buildMint(input) {
      return {
        branch: "FXRP",
        xrplAddress: input.xrplAddress,
        personalAccount: ("0x" + "11".repeat(20)) as Address,
        nonce: "5",
        annualInterestRateBps: (input.annualInterestRateBps ?? 500n).toString(),
        collateral6: input.collateral6.toString(),
        mint18: input.mint18.toString(),
        vusdDestination: ("0x" + "11".repeat(20)) as Address,
        coreVaultXrplAddress: "rDhpmiPq4BVBDWMVdSrmkgt8thKyRzGV1p",
        requiredPaymentDrops: (input.collateral6 + 200_000n).toString(),
        requiredPaymentXrp: "5.2",
        executorFeeUBA: "100000",
        memo: "0xfe00" as `0x${string}`,
        xrplMemoData: "FE00",
        userOpHash: goodHash,
        userOpBytes,
        noDestinationTag: true,
      };
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

  it("POST /mint/build returns the Core Vault destination + 0xFE memo + amount + userOp", async () => {
    const app = buildServer(services);
    const res = await app.inject({
      method: "POST",
      url: "/mint/build",
      payload: { xrplAddress: "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh", collateral6: "5000000", mint18: "3000000000000000000" },
    });
    expect(res.statusCode).toBe(200);
    const b = res.json();
    expect(b.branch).toBe("FXRP");
    expect(b.coreVaultXrplAddress).toMatch(/^r/); // XRPL classic address
    expect(b.xrplMemoData).toBeDefined();
    expect(b.userOpBytes).toBeDefined();
    expect(b.noDestinationTag).toBe(true);
    expect(b.annualInterestRateBps).toBe("500"); // default rate flows through
  });

  it("POST /mint/build validates required fields", async () => {
    const app = buildServer(services);
    const res = await app.inject({ method: "POST", url: "/mint/build", payload: { xrplAddress: "r..." } });
    expect(res.statusCode).toBe(400);
  });

  it("POST /mint/submit surfaces a gated note when the live pipeline is absent", async () => {
    const app = buildServer(services); // no processMint => gated
    const res = await app.inject({
      method: "POST",
      url: "/mint/submit",
      payload: { packedUserOpHex: userOpBytes, xrplTxId: "0xGATED", memoUserOpHash: goodHash },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().note).toMatch(/gated/i);
  });

  it("POST /mint/submit calls processMint when the live pipeline is wired", async () => {
    let called = "";
    const wired: ExecutorServices = { ...services, processMint: (id) => { called = id; } };
    const app = buildServer(wired);
    const res = await app.inject({
      method: "POST",
      url: "/mint/submit",
      payload: { packedUserOpHex: userOpBytes, xrplTxId: "0xWIRED", memoUserOpHash: goodHash },
    });
    expect(res.statusCode).toBe(200);
    expect(called).toBe("mint:0xwired");
    expect(res.json().note).toBeUndefined();
  });
});
