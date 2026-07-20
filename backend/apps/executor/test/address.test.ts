import { describe, it, expect } from "vitest";
import { isValidXrplClassicAddress } from "../src/preflight/address.js";

describe("isValidXrplClassicAddress", () => {
  it("accepts well-known valid XRPL classic addresses", () => {
    expect(isValidXrplClassicAddress("rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh")).toBe(true); // Genesis
    expect(isValidXrplClassicAddress("rN7n7otQDd6FczFgLdSqtcsAUxDkw6fzRH")).toBe(true);
  });

  it("rejects a valid-looking address with a corrupted checksum (one char changed)", () => {
    expect(isValidXrplClassicAddress("rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTi")).toBe(false);
  });

  it("rejects non-r prefixes, empty, and out-of-alphabet chars", () => {
    expect(isValidXrplClassicAddress("")).toBe(false);
    expect(isValidXrplClassicAddress("nHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh")).toBe(false);
    expect(isValidXrplClassicAddress("r0OIl_not_base58")).toBe(false); // 0, O, I, l are not in the ripple alphabet
  });
});
