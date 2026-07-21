/* eslint-disable @next/next/no-img-element -- static local SVGs gain nothing from next/image */
import * as React from "react";
import { cn } from "./cn";

// Matches the landing page's cursive stack; used as the var() fallback so the
// wordmark renders even before the theme tokens load.
const SCRIPT_STACK =
  "var(--font-script, 'Brush Script MT', 'Snell Roundhand', 'Segoe Script', cursive)";

/**
 * The Vulcra brand mark. `variant="script"` (default) is the cursive
 * "Vulcra" wordmark from the landing nav; `variant="mark"` is the small
 * coin: white vUSD "V" on a brand-pink circle.
 * `size` = rendered height in px (script keeps the landing's 4:1 ratio).
 */
export function Wordmark({
  className,
  variant = "script",
  size,
}: {
  className?: string;
  variant?: "script" | "mark";
  size?: number;
}) {
  if (variant === "mark") {
    const s = size ?? 28;
    const glyph = Math.round(s * 0.88);
    return (
      <span
        role="img"
        aria-label="Vulcra"
        className={cn(
          "inline-flex shrink-0 items-center justify-center rounded-full bg-[var(--color-brand)]",
          className,
        )}
        style={{ width: s, height: s }}
      >
        <img
          src="/brand/logos/vusd-mark.svg"
          alt=""
          aria-hidden
          width={glyph}
          height={glyph}
          className="object-contain"
          style={{ width: glyph, height: glyph }}
        />
      </span>
    );
  }

  const h = size ?? 40;
  return (
    <svg
      className={cn("shrink-0", className)}
      width={h * 4}
      height={h}
      viewBox="0 0 160 40"
      fill="none"
      role="img"
      aria-label="Vulcra"
      xmlns="http://www.w3.org/2000/svg"
    >
      <text
        x="80"
        y="31"
        textAnchor="middle"
        fontStyle="italic"
        fontWeight={700}
        fontSize="40"
        fill="currentColor"
        style={{ fontFamily: SCRIPT_STACK }}
      >
        Vulcra
      </text>
    </svg>
  );
}
