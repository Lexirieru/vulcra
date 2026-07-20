/**
 * Central motion system for the landing page (plan KTD6).
 *
 * Every timing value lives here — no magic numbers in components
 * (page-load-animations non-negotiable). Springs are the default for
 * entrances; durations are only for fades. Components read
 * `useReducedMotion()` from "motion/react" directly and degrade to the
 * `static` variant below.
 */

import type { Transition, Variants } from "motion/react";

export const TIMING = {
  /** Seconds between successive hero reveal stages. */
  heroStageStep: 0.12,
  /** Seconds between staggered list/grid items. */
  stagger: 0.09,
  /** Root margin for in-view triggers (reveal a little before fully visible). */
  inViewMargin: "-80px",
  duration: {
    fast: 0.2,
    base: 0.4,
    slow: 0.6,
  },
} as const;

export const SPRING: Record<"entrance" | "gentle", Transition> = {
  entrance: { type: "spring", stiffness: 260, damping: 30 },
  gentle: { type: "spring", stiffness: 180, damping: 26 },
};

/** Fade + rise reveal. Used by in-view sections and staggered items. */
export const fadeRise: Variants = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0, transition: SPRING.entrance },
};

/** Reduced-motion reveal: visible immediately, no transform. */
export const staticReveal: Variants = {
  hidden: { opacity: 1, y: 0 },
  visible: { opacity: 1, y: 0 },
};

/** Delay for the i-th staggered item. */
export function staggerDelay(i: number): number {
  return i * TIMING.stagger;
}
