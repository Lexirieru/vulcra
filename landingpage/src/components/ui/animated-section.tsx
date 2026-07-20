"use client";

import type { ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import { fadeRise, staticReveal, TIMING } from "@/lib/motion";

type AnimatedSectionProps = {
  children: ReactNode;
  /** Extra delay before the reveal fires (seconds). */
  delay?: number;
  className?: string;
  as?: "div" | "section" | "li";
};

/**
 * In-view fade + rise wrapper. Reveals once when scrolled into view and
 * degrades to an instant, transform-free reveal under prefers-reduced-motion.
 */
export function AnimatedSection({
  children,
  delay = 0,
  className = "",
  as = "div",
}: AnimatedSectionProps) {
  const reduce = useReducedMotion();
  const MotionTag = motion[as];

  return (
    <MotionTag
      className={className}
      variants={reduce ? staticReveal : fadeRise}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, margin: TIMING.inViewMargin }}
      transition={reduce ? { duration: 0 } : { delay }}
    >
      {children}
    </MotionTag>
  );
}
