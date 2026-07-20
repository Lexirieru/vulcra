"use client";

import { useEffect, useState } from "react";
import { Button } from "./ui/button";
import { NAV, SITE } from "@/lib/content";

function Logo() {
  return (
    <a
      href="#top"
      className="inline-flex items-center gap-2 rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      aria-label={`${SITE.name} — home`}
    >
      <svg width="26" height="26" viewBox="0 0 32 32" fill="none" aria-hidden="true">
        <defs>
          <linearGradient id="hdr-ember" x1="4" y1="4" x2="28" y2="28" gradientUnits="userSpaceOnUse">
            <stop stopColor="#f07c2a" />
            <stop offset="1" stopColor="#f3ad3f" />
          </linearGradient>
        </defs>
        <rect width="32" height="32" rx="8" fill="oklch(0.195 0.016 47)" />
        <path
          d="M8.5 9 L16 23 L23.5 9"
          stroke="url(#hdr-ember)"
          strokeWidth="3.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span className="text-lg font-bold tracking-tight">{SITE.name}</span>
    </a>
  );
}

export function SiteHeader() {
  const [open, setOpen] = useState(false);

  // Close the mobile menu on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <header className="sticky top-0 z-50 border-b border-border/60 bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-4 sm:px-6">
        <Logo />

        <nav className="hidden items-center gap-8 md:flex" aria-label="Primary">
          {NAV.links.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="rounded-md text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              {link.label}
            </a>
          ))}
        </nav>

        <div className="hidden md:block">
          <Button href={NAV.cta.href} external={NAV.cta.external} comingSoon={NAV.cta.isPlaceholder} size="md">
            {NAV.cta.label}
          </Button>
        </div>

        <button
          type="button"
          className="inline-flex h-11 w-11 items-center justify-center rounded-md text-foreground md:hidden focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          aria-expanded={open}
          aria-controls="mobile-menu"
          aria-label={open ? "Close menu" : "Open menu"}
          onClick={() => setOpen((v) => !v)}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            {open ? (
              <>
                <line x1="6" y1="6" x2="18" y2="18" />
                <line x1="6" y1="18" x2="18" y2="6" />
              </>
            ) : (
              <>
                <line x1="3" y1="7" x2="21" y2="7" />
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="17" x2="21" y2="17" />
              </>
            )}
          </svg>
        </button>
      </div>

      {open ? (
        <div id="mobile-menu" className="border-t border-border/60 bg-background/95 md:hidden">
          <nav className="mx-auto flex w-full max-w-6xl flex-col gap-1 px-4 py-4" aria-label="Mobile">
            {NAV.links.map((link) => (
              <a
                key={link.href}
                href={link.href}
                onClick={() => setOpen(false)}
                className="rounded-md px-2 py-3 text-base text-foreground/90 transition-colors hover:bg-accent/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                {link.label}
              </a>
            ))}
            <div className="pt-2">
              <Button
                href={NAV.cta.href}
                external={NAV.cta.external}
                comingSoon={NAV.cta.isPlaceholder}
                size="md"
                className="w-full"
              >
                {NAV.cta.label}
              </Button>
            </div>
          </nav>
        </div>
      ) : null}
    </header>
  );
}
