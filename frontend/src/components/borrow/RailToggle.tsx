"use client";

// The Flare ↔ XRP Ledger rail toggle on the Borrow page — ONE control that
// flips which rail you fund the vault from, replacing the old two-tab layout
// that felt like two separate pages.
//
// Semantics stay `tablist`/`tab`: the control genuinely swaps the panel below
// it, so that is the correct ARIA (a `switch` would claim on/off, and a
// `radiogroup` would not associate the panel). Arrow keys move between rails,
// exactly as before.
//
// Motion is GSAP: a thumb slides under the active label — measured from real
// layout so it stays correct at any font size or viewport, re-measured on
// resize. Reduced motion snaps the thumb instead of sliding it.
import { useRef, useState } from "react";
import { TokenIcon, cn } from "@/components/ui";
import {
  DUR,
  EASE,
  animate,
  gsap,
  prefersReducedMotion,
  useIsomorphicLayoutEffect,
} from "@/lib/gsap";

export type Rail = "flare" | "xrpl";

const RAILS = [
  { id: "flare" as const, label: "Flare wallet", symbol: "FLR" },
  { id: "xrpl" as const, label: "XRP Ledger", symbol: "XRP" },
];

export function RailToggle({
  value,
  onChange,
  idPrefix = "rail",
}: {
  value: Rail;
  onChange: (rail: Rail) => void;
  /** Prefix for the tab/panel id pair, so a page can wire aria-controls. */
  idPrefix?: string;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLSpanElement>(null);
  const tabRefs = useRef<Partial<Record<Rail, HTMLButtonElement | null>>>({});
  // First paint positions the thumb without a tween; later changes slide it.
  const positioned = useRef(false);

  // Re-measure on container resize (font loading, viewport changes).
  const [resizeTick, setResizeTick] = useState(0);
  useIsomorphicLayoutEffect(() => {
    const list = listRef.current;
    if (!list || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setResizeTick((n) => n + 1));
    ro.observe(list);
    return () => ro.disconnect();
  }, []);

  useIsomorphicLayoutEffect(() => {
    const thumb = thumbRef.current;
    const active = tabRefs.current[value];
    if (!thumb || !active) return;

    const to = { x: active.offsetLeft, width: active.offsetWidth };
    if (!positioned.current || prefersReducedMotion()) {
      positioned.current = true;
      gsap.set(thumb, { ...to, autoAlpha: 1 });
    } else {
      animate(thumb, {
        ...to,
        autoAlpha: 1,
        duration: DUR.fast,
        ease: EASE.thumb,
      });
    }
    return () => {
      gsap.killTweensOf(thumb);
    };
  }, [value, resizeTick]);

  const select = (rail: Rail) => {
    onChange(rail);
    tabRefs.current[rail]?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    select(value === "flare" ? "xrpl" : "flare");
  };

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label="Funding rail"
      onKeyDown={onKeyDown}
      className="relative inline-flex w-fit max-w-full items-center rounded-full border border-line bg-surface p-1"
    >
      {/* Sliding thumb — GSAP owns x/width; invisible until measured. */}
      <span
        ref={thumbRef}
        aria-hidden
        className="pointer-events-none absolute top-1 bottom-1 left-0 invisible rounded-full bg-navy"
      />
      {RAILS.map((rail) => {
        const active = rail.id === value;
        return (
          <button
            key={rail.id}
            ref={(el) => {
              tabRefs.current[rail.id] = el;
            }}
            type="button"
            role="tab"
            id={`${idPrefix}-tab-${rail.id}`}
            aria-selected={active}
            aria-controls={`${idPrefix}-panel-${rail.id}`}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(rail.id)}
            className={cn(
              "relative z-10 inline-flex min-h-10 items-center gap-2 rounded-full px-4 text-sm font-medium whitespace-nowrap transition-colors",
              active ? "text-white" : "text-muted hover:text-ink",
            )}
          >
            <TokenIcon symbol={rail.symbol} size={18} alt="" />
            {rail.label}
          </button>
        );
      })}
    </div>
  );
}
