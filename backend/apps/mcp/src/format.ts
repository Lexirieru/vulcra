import { formatUnits, parseUnits } from "viem";

/**
 * Human <-> base-unit helpers. An AI agent speaks in whole tokens ("100 FXRP",
 * "50 vUSD", "5% APR"); the contracts speak in base units (FXRP 6-dec, vUSD
 * 18-dec) and basis points. These conversions live in one place so every tool
 * accepts natural amounts and reports natural amounts.
 */

/** vUSD is always 18 decimals. */
export const VUSD_DECIMALS = 18;

/** Parse a human decimal amount ("100", "12.5") into base units for `decimals`. */
export function toBaseUnits(amount: string | number, decimals: number): bigint {
  const s = typeof amount === "number" ? formatPlain(amount) : amount.trim();
  if (!/^\d+(\.\d+)?$/.test(s)) {
    throw new Error(`Not a valid non-negative decimal amount: "${amount}"`);
  }
  return parseUnits(s, decimals);
}

/** Format base units back to a trimmed human string (no trailing zeros). */
export function fromBaseUnits(value: bigint, decimals: number, maxFractionDigits = 6): string {
  const full = formatUnits(value, decimals);
  const dot = full.indexOf(".");
  if (dot === -1) return full;
  const whole = full.slice(0, dot);
  const trimmed = full.slice(dot + 1).slice(0, maxFractionDigits).replace(/0+$/, "");
  return trimmed.length > 0 ? `${whole}.${trimmed}` : whole;
}

/** Number -> plain decimal string (avoids scientific notation for parseUnits). */
function formatPlain(n: number): string {
  if (!Number.isFinite(n)) throw new Error(`Not a finite number: ${n}`);
  if (Number.isInteger(n)) return n.toString();
  return n.toLocaleString("en-US", { useGrouping: false, maximumFractionDigits: 18 });
}

/** Basis points -> percent string, e.g. 11000n -> "110". */
export function bpsToPercentStr(bps: bigint): string {
  const whole = bps / 100n;
  const frac = (bps % 100n).toString().padStart(2, "0").replace(/0+$/, "");
  return frac.length > 0 ? `${whole}.${frac}` : `${whole}`;
}

/** Percent (number or string) -> basis points, e.g. 5 -> 500n, 1.5 -> 150n. */
export function percentToBps(percent: string | number): bigint {
  const s = typeof percent === "number" ? percent.toString() : percent.trim();
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error(`Not a valid percent: "${percent}"`);
  // Multiply by 100 with 2-dp precision, integer-safe.
  const dot = s.indexOf(".");
  const whole = dot === -1 ? s : s.slice(0, dot);
  const frac = dot === -1 ? "" : s.slice(dot + 1);
  const padded = (frac + "00").slice(0, 2);
  return BigInt(whole) * 100n + BigInt(padded);
}

/** Format an 18-dec USD value as "$1.2345". */
export function usd18(value: bigint, maxFractionDigits = 4): string {
  return `$${fromBaseUnits(value, 18, maxFractionDigits)}`;
}
