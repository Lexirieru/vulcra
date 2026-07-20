import { createHash } from "node:crypto";

/**
 * XRPL classic r-address validation via base58check (real checksum, no deps).
 *
 * A wrong recipient is UNRECOVERABLE by design, so pre-flight must reject a
 * malformed address before any XRP is sent. Pure & offline-testable.
 */
const XRPL_ALPHABET = "rpshnaf39wBUDNEGHJKLM4PQRST7VWXYZ2bcdeCg65jkm8oFqi1tuvAxyz";

function base58Decode(input: string): Uint8Array | null {
  const bytes: number[] = [0];
  for (const ch of input) {
    const value = XRPL_ALPHABET.indexOf(ch);
    if (value === -1) return null;
    let carry = value;
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j]! * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  // account for leading 'r' (zero) characters
  for (let k = 0; k < input.length && input[k] === XRPL_ALPHABET[0]; k++) {
    bytes.push(0);
  }
  return new Uint8Array(bytes.reverse());
}

function sha256(data: Uint8Array): Uint8Array {
  return new Uint8Array(createHash("sha256").update(data).digest());
}

/** True iff `address` is a valid XRPL classic address (version 0x00, good checksum). */
export function isValidXrplClassicAddress(address: string): boolean {
  if (typeof address !== "string" || address.length < 25 || address.length > 35) return false;
  if (!address.startsWith("r")) return false;
  const decoded = base58Decode(address);
  if (!decoded || decoded.length !== 25) return false;
  if (decoded[0] !== 0x00) return false; // classic account prefix
  const payload = decoded.slice(0, 21);
  const checksum = decoded.slice(21, 25);
  const expected = sha256(sha256(payload)).slice(0, 4);
  for (let i = 0; i < 4; i++) {
    if (checksum[i] !== expected[i]) return false;
  }
  return true;
}
