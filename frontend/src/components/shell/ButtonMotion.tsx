"use client";

// GSAP hover/press micro-interactions for every Button / PillButton in the app.
//
// Delegated on purpose. `@/components/ui` is documented as server-component-safe
// (no "use client"), and two surfaces — /incentives and EarnPoolsCard — are
// server components, so a per-instance hook inside button.tsx would have forced
// the whole primitive client-side. Instead the primitives carry a static
// `data-gsap-press` attribute and this one client component, mounted once by
// AppShell, listens on the document. Buttons rendered by server components,
// portals (the wallet drawer) and future call sites all get it for free.
//
// Reduced motion is a hard gate — the pointer handlers return early, so no
// transform is ever written.
import { useEffect } from "react";
import { DUR, EASE, gsap, prefersReducedMotion } from "@/lib/gsap";

/** Marker the ui/ primitives stamp on their root element. */
export const PRESS_ATTR = "data-gsap-press";

const SELECTOR = `[${PRESS_ATTR}]`;
const HOVER_SCALE = 1.025;
const PRESS_SCALE = 0.965;

function target(e: Event): HTMLElement | null {
  const node = e.target;
  if (!(node instanceof Element)) return null;
  const el = node.closest<HTMLElement>(SELECTOR);
  if (!el || el.hasAttribute("disabled") || el.getAttribute("aria-disabled") === "true") {
    return null;
  }
  return el;
}

function to(el: HTMLElement, scale: number, duration: number) {
  gsap.killTweensOf(el);
  gsap.to(el, { scale, duration, ease: EASE.out, overwrite: "auto" });
}

/** Return to rest and drop the inline transform GSAP wrote. */
function rest(el: HTMLElement) {
  gsap.killTweensOf(el);
  gsap.to(el, {
    scale: 1,
    duration: DUR.micro,
    ease: EASE.out,
    overwrite: "auto",
    onComplete: () => gsap.set(el, { clearProps: "transform" }),
  });
}

export function ButtonMotion() {
  useEffect(() => {
    if (prefersReducedMotion()) return;

    // pointerover/out bubble (pointerenter/leave do not), so one pair of
    // document-level listeners covers the whole tree.
    const onOver = (e: PointerEvent) => {
      const el = target(e);
      if (el) to(el, HOVER_SCALE, DUR.micro);
    };
    const onOut = (e: PointerEvent) => {
      const el = target(e);
      if (el) rest(el);
    };
    const onDown = (e: PointerEvent) => {
      const el = target(e);
      if (el) to(el, PRESS_SCALE, 0.09);
    };
    const onUp = (e: PointerEvent) => {
      const el = target(e);
      if (!el) return;
      // Still hovered after a click → settle at hover, else back to rest.
      if (el.matches(":hover")) to(el, HOVER_SCALE, DUR.micro);
      else rest(el);
    };

    document.addEventListener("pointerover", onOver);
    document.addEventListener("pointerout", onOut);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onUp);

    return () => {
      document.removeEventListener("pointerover", onOver);
      document.removeEventListener("pointerout", onOut);
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onUp);
      // Leave no element mid-tween with a stray inline transform.
      document.querySelectorAll<HTMLElement>(SELECTOR).forEach((el) => {
        gsap.killTweensOf(el);
        gsap.set(el, { clearProps: "transform" });
      });
    };
  }, []);

  return null;
}
