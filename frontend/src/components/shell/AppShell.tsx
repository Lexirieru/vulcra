"use client";

// App shell, Enosys structure on the light theme: cursive Vulcra wordmark,
// centered tab nav (Dashboard · Borrow · Earn · Incentives), a "More"
// disclosure for the utility routes (Redeem / Guardian / Liquidations / XRPL
// mint), the dual-wallet entry point + wrong-network guard, and a fixed bottom
// stats bar. The XRPL entry only exists on branches that support the native
// mint (FXRP). BranchSwitch appears on the branch-scoped utility routes, which
// act on the active collateral branch.
//
// Wallets: one header button opens the right-side WalletSidebar, which holds
// BOTH the Flare (EVM · Coston2) and XRP Ledger connections — they connect
// independently and can be live at the same time.
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { cn, Wordmark } from "@/components/ui";
import { useBranch } from "@/context/branch";
import { BranchSwitch } from "./BranchSwitch";
import { NetworkGuard } from "./NetworkGuard";
import { StatsBar } from "./StatsBar";
import { WalletSidebar, WalletsButton } from "./WalletSidebar";

const TABS = [
  { href: "/", label: "Dashboard" },
  { href: "/borrow", label: "Borrow" },
  { href: "/earn", label: "Earn" },
  { href: "/incentives", label: "Incentives" },
] as const;

const UTILITIES = [
  { href: "/redeem", label: "Redeem" },
  { href: "/guardian", label: "Guardian" },
  { href: "/liquidations", label: "Liquidations" },
] as const;

/** Routes that operate on the active collateral branch → show BranchSwitch. */
const BRANCH_SCOPED = ["/redeem", "/guardian", "/liquidations", "/xrpl"] as const;

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { branch } = useBranch();

  const utilityLinks = branch.hasXrplMint
    ? [...UTILITIES, { href: "/xrpl", label: "XRPL mint" }]
    : [...UTILITIES];
  const onUtilityRoute = utilityLinks.some((u) => isActive(pathname, u.href));
  const onBranchScopedRoute = BRANCH_SCOPED.some((p) => pathname.startsWith(p));

  // "More" disclosure (APG disclosure-navigation pattern: plain links, no menu
  // roles). Closes on route change, Escape, and pointer-down outside.
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);

  // The wallet drawer's open state lives here so the route-change close below
  // is a render-phase setState in the SAME component (calling a parent setter
  // from the child's render is what React warns about).
  const [walletsOpen, setWalletsOpen] = useState(false);

  const [lastPathname, setLastPathname] = useState(pathname);
  if (lastPathname !== pathname) {
    setLastPathname(pathname);
    setMoreOpen(false);
    setWalletsOpen(false);
  }
  useEffect(() => {
    if (!moreOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!moreRef.current?.contains(e.target as Node)) setMoreOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMoreOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [moreOpen]);

  return (
    <div className="flex min-h-dvh flex-col pb-14">
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-surface px-3 py-2 text-sm font-medium text-ink focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Skip to content
      </a>

      <header className="sticky top-0 z-40 border-b border-line bg-bg/85 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4">
          {/* Left: cursive brand */}
          <Link href="/" className="flex shrink-0 items-center rounded-md">
            <Wordmark size={32} className="text-ink" />
          </Link>

          {/* Center: primary tabs (Enosys pill nav) */}
          <nav
            aria-label="Primary"
            className="absolute left-1/2 hidden -translate-x-1/2 items-center rounded-full border border-line bg-surface p-1 md:flex"
          >
            {TABS.map((t) => {
              const active = isActive(pathname, t.href);
              return (
                <Link
                  key={t.href}
                  href={t.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "rounded-full px-4 py-2 text-sm font-medium whitespace-nowrap transition-colors",
                    active
                      ? "bg-navy text-white"
                      : "text-muted hover:text-ink",
                  )}
                >
                  {t.label}
                </Link>
              );
            })}
          </nav>

          {/* Right: utilities disclosure + wallet */}
          <div className="flex shrink-0 items-center gap-2">
            <div className="relative hidden md:block" ref={moreRef}>
              <button
                type="button"
                aria-expanded={moreOpen}
                aria-controls="shell-more-menu"
                onClick={() => setMoreOpen((v) => !v)}
                className={cn(
                  "flex min-h-10 items-center gap-1 rounded-full px-3 py-2 text-sm font-medium transition-colors",
                  onUtilityRoute ? "text-brand" : "text-muted hover:text-ink",
                )}
              >
                More
                <ChevronDown
                  className={cn("h-4 w-4 transition-transform", moreOpen && "rotate-180")}
                  aria-hidden
                />
              </button>
              {moreOpen ? (
                <div
                  id="shell-more-menu"
                  className="absolute right-0 top-full mt-2 w-48 rounded-2xl border border-line bg-surface p-1.5 shadow-lg"
                >
                  {utilityLinks.map((u) => {
                    const active = isActive(pathname, u.href);
                    return (
                      <Link
                        key={u.href}
                        href={u.href}
                        aria-current={active ? "page" : undefined}
                        className={cn(
                          "flex min-h-10 items-center rounded-xl px-3 py-2 text-sm font-medium transition-colors",
                          active
                            ? "bg-surface-2 text-brand"
                            : "text-ink hover:bg-surface-2",
                        )}
                      >
                        {u.label}
                      </Link>
                    );
                  })}
                </div>
              ) : null}
            </div>
            <WalletsButton open={walletsOpen} onOpen={() => setWalletsOpen(true)} />
          </div>
        </div>

        {/* Mobile: every destination in one scrollable row (no dropdown) */}
        <nav
          aria-label="Primary"
          className="flex items-center gap-1 overflow-x-auto border-t border-line px-3 py-2 md:hidden"
        >
          {TABS.map((t) => {
            const active = isActive(pathname, t.href);
            return (
              <Link
                key={t.href}
                href={t.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "rounded-full px-3 py-2 text-sm font-medium whitespace-nowrap",
                  active ? "bg-navy text-white" : "text-muted",
                )}
              >
                {t.label}
              </Link>
            );
          })}
          <span className="mx-1 h-5 w-px shrink-0 bg-line" aria-hidden />
          {utilityLinks.map((u) => {
            const active = isActive(pathname, u.href);
            return (
              <Link
                key={u.href}
                href={u.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "rounded-full px-3 py-2 text-sm whitespace-nowrap",
                  active ? "text-brand" : "text-muted",
                )}
              >
                {u.label}
              </Link>
            );
          })}
        </nav>

        <NetworkGuard />

        {/* Branch-scoped utility pages act on the active collateral branch. */}
        {onBranchScopedRoute ? (
          <div className="border-t border-line bg-surface-2/60">
            <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-2">
              <BranchSwitch />
              <span className="hidden text-xs text-muted sm:block">
                This page acts on the selected collateral branch.
              </span>
            </div>
          </div>
        ) : null}
      </header>

      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
        {children}
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto max-w-6xl px-4 py-5 text-xs text-muted">
          Vulcra — multi-collateral CDP stablecoin on Flare Coston2 · Chain 114 ·
          testnet
        </div>
      </footer>

      <StatsBar />

      <WalletSidebar open={walletsOpen} onClose={() => setWalletsOpen(false)} />
    </div>
  );
}
