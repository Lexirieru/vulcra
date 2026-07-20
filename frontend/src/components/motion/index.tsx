"use client";

// Motion primitives implementing the page-load-animations recipes: named TIMING
// constants, spring-first, index-based stagger, reduced-motion safe. No
// staggerChildren+AnimatePresence, no `layout` on parent AND child.
import * as React from "react";
import { motion, useReducedMotion } from "framer-motion";

export const TIMING = {
  base: 0.04, // per-section lead-in
  stagger: 0.06, // per list item
} as const;

const ENTER_SPRING = { type: "spring", stiffness: 380, damping: 30, mass: 0.7 } as const;

/** A single spring entrance. Static when reduced-motion is requested. */
export function Reveal({
  children,
  delay = 0,
  className,
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
}) {
  const reduced = useReducedMotion();
  if (reduced) return <div className={className}>{children}</div>;
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...ENTER_SPRING, delay }}
    >
      {children}
    </motion.div>
  );
}

/** Stagger a list of children with index-based delays. */
export function Stagger({
  children,
  startDelay = 0,
  className,
  itemClassName,
}: {
  children: React.ReactNode;
  startDelay?: number;
  className?: string;
  itemClassName?: string;
}) {
  const items = React.Children.toArray(children);
  return (
    <div className={className}>
      {items.map((child, i) => (
        <Reveal key={i} delay={startDelay + i * TIMING.stagger} className={itemClassName}>
          {child}
        </Reveal>
      ))}
    </div>
  );
}

/**
 * A live-updating number with a subtle tick on change (mount vs update: the
 * mount is a plain render, updates flash briefly). Reduced-motion → plain text.
 */
export function RollingNumber({
  value,
  className,
}: {
  value: string;
  className?: string;
}) {
  const reduced = useReducedMotion();
  if (reduced) return <span className={className}>{value}</span>;
  return (
    <motion.span
      key={value}
      className={className}
      initial={{ opacity: 0.4, y: -2 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, ease: "easeOut" }}
    >
      {value}
    </motion.span>
  );
}
