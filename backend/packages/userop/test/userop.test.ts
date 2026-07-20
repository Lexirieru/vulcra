import { describe, it, expect } from "vitest";
import { keccak256, size, type Address } from "viem";
import {
  buildPackedUserOp,
  encodePackedUserOp,
  userOpHash,
} from "../src/packedUserOp.js";
import { buildMintUserOp } from "../src/buildMint.js";
import { decodeMemo } from "../src/memo.js";

const SENDER = "0x1111111111111111111111111111111111111111" as Address;
const FXRP = "0x2222222222222222222222222222222222222222" as Address;
const ZAP = "0x3333333333333333333333333333333333333333" as Address;

function fixtureMint(nonce = 7n) {
  return buildMintUserOp({
    sender: SENDER,
    nonce,
    fxrp: FXRP,
    zap: ZAP,
    collateral6: 1_000_000n, // 1 FXRP
    mint18: 100_000000000000000000n, // 100 vUSD
    annualInterestRateBps: 500n, // V2 default rate
    vusdDestination: SENDER,
    walletId: 0,
    executorFeeUBA: 100_000n, // 0.1 XRP
  });
}

describe("userOpHash", () => {
  it("equals keccak256(abi.encode(userOp)) computed independently", () => {
    const op = buildPackedUserOp({ sender: SENDER, nonce: 1n, callData: "0x1234" });
    expect(userOpHash(op)).toBe(keccak256(encodePackedUserOp(op)));
  });

  it("is deterministic (same inputs -> same 32-byte hash)", () => {
    const a = fixtureMint();
    const b = fixtureMint();
    expect(a.userOpHash).toBe(b.userOpHash);
    expect(size(a.userOpHash)).toBe(32);
  });

  it("changes when the nonce changes (no accidental nonce reuse collapses distinct ops)", () => {
    expect(fixtureMint(7n).userOpHash).not.toBe(fixtureMint(8n).userOpHash);
  });
});

describe("buildMintUserOp — the hash committed in the memo must match the userOp bytes", () => {
  it("memo tail == userOpHash == keccak256(userOpBytes)", () => {
    const m = fixtureMint();
    expect(m.userOpHash).toBe(keccak256(m.userOpBytes));
    expect(decodeMemo(m.memo).tail.toLowerCase()).toBe(m.userOpHash.toLowerCase());
  });

  it("builds the 2-call batch: approve then openVaultAndForward", () => {
    const m = fixtureMint();
    expect(m.calls).toHaveLength(2);
    expect(m.calls[0]!.target.toLowerCase()).toBe(FXRP.toLowerCase()); // approve on FXRP
    expect(m.calls[1]!.target.toLowerCase()).toBe(ZAP.toLowerCase()); // openVaultAndForward on Zap
    expect(m.calls[0]!.value).toBe(0n);
    expect(m.calls[1]!.value).toBe(0n);
  });
});

describe("GOLDEN VECTOR — locks the encoding so a 1-byte change fails loudly", () => {
  // Pinned from a known-good run of the canonical encoder with the fixture above.
  // If this fails, the PackedUserOperation layout, Call encoding, or memo bytes
  // changed — every real mint would revert with CustomInstructionHashMismatch.
  // Re-pin ONLY after deliberately and verifiably changing the encoding.
  // V2 fixture includes annualInterestRateBps=500 in the zap callData.
  const GOLDEN_USEROP_HASH =
    "0xd3188bdff0257cfb2d71863d31ca92f87a4ed27ed4fb8a001dcf45a0bbe87a62";
  const GOLDEN_MEMO =
    "0xfe0000000000000186a0d3188bdff0257cfb2d71863d31ca92f87a4ed27ed4fb8a001dcf45a0bbe87a62";

  it("matches the pinned hash and memo", () => {
    const m = fixtureMint();
    expect(m.userOpHash).toBe(GOLDEN_USEROP_HASH);
    expect(m.memo).toBe(GOLDEN_MEMO);
  });

  it("memo decomposes to 0xFE | walletId=0 | fee=0.1XRP | goldenHash", () => {
    const m = fixtureMint();
    // 0xfe + 00(walletId) + 00000000000186a0 (100000 drops, 8-byte BE) + 32-byte hash
    expect(m.memo.slice(0, 4)).toBe("0xfe");
    expect(m.memo.slice(4, 6)).toBe("00");
    expect(m.memo.slice(6, 22)).toBe("00000000000186a0");
  });
});
