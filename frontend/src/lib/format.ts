// Centralized display formatting (U3). Token amounts, USD, percentages, and
// addresses format in one place so every surface reads consistently.
import { formatUnits } from "viem";

/** Format a bigint token amount to a trimmed, grouped string. */
export function formatToken(
  value: bigint | undefined,
  decimals: number,
  maxFractionDigits = 4,
): string {
  if (value === undefined) return "—";
  const raw = formatUnits(value, decimals);
  const n = Number(raw);
  if (!Number.isFinite(n)) return raw;
  return n.toLocaleString("en-US", { maximumFractionDigits: maxFractionDigits });
}

/** Format an 18-decimal USD value as "$1,234.56". */
export function formatUsd(value18: bigint | undefined, maxFractionDigits = 2): string {
  if (value18 === undefined) return "—";
  const n = Number(formatUnits(value18, 18));
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: maxFractionDigits,
  });
}

/** Format an 18-decimal XRP/USD price with sensible precision. */
export function formatPrice(value18: bigint | undefined): string {
  if (value18 === undefined) return "—";
  const n = Number(formatUnits(value18, 18));
  if (!Number.isFinite(n)) return "—";
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 4 })}`;
}

/** Format a basis-points collateral ratio as a percentage; null → "∞". */
export function formatCr(crBps: bigint | null): string {
  if (crBps === null) return "∞";
  const pct = Number(crBps) / 100;
  return `${pct.toLocaleString("en-US", { maximumFractionDigits: 1 })}%`;
}

/** Format basis points as a percentage, e.g. 130% or 0.5%. */
export function formatBps(bps: bigint | number): string {
  const n = typeof bps === "bigint" ? Number(bps) : bps;
  const pct = n / 100;
  return `${pct.toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;
}

/** 0x1234…abcd */
export function shortenAddress(address?: string, chars = 4): string {
  if (!address) return "—";
  if (address.length < 2 * chars + 2) return address;
  return `${address.slice(0, chars + 2)}…${address.slice(-chars)}`;
}

/** Parse a user-entered decimal string to a bigint of `decimals` places. */
export function parseAmount(input: string, decimals: number): bigint | null {
  const trimmed = input.trim();
  if (!trimmed || !/^\d*\.?\d*$/.test(trimmed)) return null;
  const [whole = "0", frac = ""] = trimmed.split(".");
  const fracPadded = (frac + "0".repeat(decimals)).slice(0, decimals);
  try {
    return BigInt(whole || "0") * 10n ** BigInt(decimals) + BigInt(fracPadded || "0");
  } catch {
    return null;
  }
}
