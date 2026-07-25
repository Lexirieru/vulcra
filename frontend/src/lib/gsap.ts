"use client";

// Shared GSAP setup for the dApp's key interactions — the Flare↔XRP toggle, the
// navbar's active-tab indicator, the wallet drawer, and button micro-interactions.
//
// Rules every GSAP call site here follows:
//   • reduced motion is a HARD gate — `prefersReducedMotion()` is re-read at
//     tween time (not captured once), so flipping the OS setting takes effect
//     without a reload. Under reduce we jump straight to the end state with
//     gsap.set() so the UI is still correct, just not animated.
//   • tweens are killed on unmount (`gsap.killTweensOf(target)`), and layout
//     work runs in a layout effect so nothing paints at the wrong position first.
//
// The CSS in globals.css already zeroes *CSS* transitions under reduce; GSAP
// animates via JS and is unaffected by that, hence the explicit gate.
import { useEffect, useLayoutEffect } from "react";
import { gsap } from "gsap";

export { gsap };

/**
 * useLayoutEffect in the browser, useEffect on the server — GSAP positions
 * elements from measured layout, which must happen before paint, but React
 * warns about useLayoutEffect during SSR.
 */
export const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

/** Read the live `prefers-reduced-motion` preference. */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** House easing + durations, so every surface moves with the same character. */
export const EASE = {
  /** Decelerating — entrances, slide-ins, indicator moves. */
  out: "power3.out",
  /** Snappy, slight overshoot — the toggle thumb. */
  thumb: "back.out(1.6)",
  /** Accelerating — exits. */
  in: "power2.in",
} as const;

export const DUR = {
  micro: 0.16,
  fast: 0.28,
  panel: 0.38,
} as const;

/**
 * Tween `target` to `vars`, or jump straight there when the user asked for
 * reduced motion. Returns the tween (or null) so callers can kill it.
 */
export function animate(
  target: gsap.TweenTarget,
  vars: gsap.TweenVars,
): gsap.core.Tween | null {
  gsap.killTweensOf(target);
  if (prefersReducedMotion()) {
    // Strip timing/callback-only props so `set` applies just the end state.
    const { duration: _d, ease: _e, delay: _delay, ...end } = vars;
    void _d;
    void _e;
    void _delay;
    const { onComplete, ...styles } = end;
    gsap.set(target, styles);
    onComplete?.();
    return null;
  }
  return gsap.to(target, vars);
}
