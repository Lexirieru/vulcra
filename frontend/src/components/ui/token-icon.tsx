/* eslint-disable @next/next/no-img-element -- static local SVGs gain nothing from next/image */
import * as React from "react";
import { cn } from "./cn";

// vusd-mark.svg is a WHITE glyph with no background — it is only visible on
// the brand-pink coin chip, hence the per-token chip overrides below.
const SURFACE_CHIP = "border-[var(--color-line)] bg-[var(--color-surface)]";
const XRP = { src: "/brand/logos/xrp.svg", chipClassName: SURFACE_CHIP, glyphScale: 0.56 };
const FLARE = { src: "/brand/logos/flare.svg", chipClassName: SURFACE_CHIP, glyphScale: 0.58 };

const LOGO: Record<string, { src: string; chipClassName: string; glyphScale: number }> = {
  FXRP: XRP,
  XRP,
  STXRP: XRP,
  FLR: FLARE,
  WFLR: FLARE,
  C2FLR: FLARE,
  WC2FLR: FLARE,
  SFLR: FLARE,
  VUSD: {
    src: "/brand/logos/vusd-mark.svg",
    chipClassName: "border-transparent bg-[var(--color-brand)]",
    glyphScale: 0.9,
  },
};

/**
 * Circular token chip. Known symbols (case-insensitive): FXRP, XRP, STXRP,
 * FLR, WFLR, C2FLR, WC2FLR, SFLR, vUSD. Unknown symbols fall back to a
 * lettered chip. Pass alt="" when the symbol text is already next to it.
 */
export function TokenIcon({
  symbol,
  size = 28,
  className,
  alt,
}: {
  symbol: string;
  size?: number;
  className?: string;
  alt?: string;
}) {
  const entry = LOGO[symbol.toUpperCase()];
  const label = alt ?? `${symbol} logo`;
  const chipBase = "inline-flex shrink-0 items-center justify-center rounded-full border";

  if (!entry) {
    return (
      <span
        role="img"
        aria-label={label || undefined}
        aria-hidden={label === "" || undefined}
        className={cn(
          chipBase,
          "border-[var(--color-line)] bg-[var(--color-surface-2)] font-semibold text-[var(--color-muted)] uppercase select-none",
          className,
        )}
        style={{ width: size, height: size, fontSize: Math.max(9, size * 0.32) }}
      >
        {symbol.slice(0, 2)}
      </span>
    );
  }

  const glyph = Math.round(size * entry.glyphScale);
  return (
    <span
      className={cn(chipBase, entry.chipClassName, className)}
      style={{ width: size, height: size }}
    >
      <img
        src={entry.src}
        alt={label}
        aria-hidden={label === "" || undefined}
        width={glyph}
        height={glyph}
        className="object-contain"
        style={{ width: glyph, height: glyph }}
      />
    </span>
  );
}
