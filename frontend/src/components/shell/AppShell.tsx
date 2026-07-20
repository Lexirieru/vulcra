"use client";

// App shell: brand, primary EVM⇄XRPL mode switch, secondary nav, connect
// button, and the wrong-network guard. Present on every route (U3).
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Flame } from "lucide-react";
import { cn } from "@/components/ui";
import { ConnectButton } from "./ConnectButton";
import { NetworkGuard } from "./NetworkGuard";

const MODES = [
  { href: "/", label: "EVM" },
  { href: "/xrpl", label: "XRPL" },
] as const;

const NAV = [
  { href: "/liquidations", label: "Liquidations" },
  { href: "/redeem", label: "Redeem" },
  { href: "/guardian", label: "Guardian" },
] as const;

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-40 border-b border-border bg-bg/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
            <Flame className="h-5 w-5 text-ember" aria-hidden />
            <span className="text-lg">Vulcra</span>
          </Link>

          <div
            className="flex rounded-lg border border-border bg-surface p-0.5"
            role="tablist"
            aria-label="Interaction mode"
          >
            {MODES.map((m) => {
              const active = isActive(pathname, m.href);
              return (
                <Link
                  key={m.href}
                  href={m.href}
                  role="tab"
                  aria-selected={active}
                  className={cn(
                    "rounded-md px-4 py-1.5 text-sm font-medium transition-colors",
                    active ? "bg-ember text-bg" : "text-muted hover:text-text",
                  )}
                >
                  {m.label}
                </Link>
              );
            })}
          </div>

          <nav className="hidden items-center gap-1 md:flex" aria-label="Sections">
            {NAV.map((n) => {
              const active = isActive(pathname, n.href);
              return (
                <Link
                  key={n.href}
                  href={n.href}
                  className={cn(
                    "rounded-md px-3 py-1.5 text-sm transition-colors",
                    active ? "text-ember" : "text-muted hover:text-text",
                  )}
                >
                  {n.label}
                </Link>
              );
            })}
          </nav>

          <ConnectButton />
        </div>
        <NetworkGuard />
        <nav
          className="flex items-center gap-1 overflow-x-auto border-t border-border px-4 py-2 md:hidden"
          aria-label="Sections"
        >
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={cn(
                "whitespace-nowrap rounded-md px-3 py-1.5 text-sm",
                isActive(pathname, n.href) ? "text-ember" : "text-muted",
              )}
            >
              {n.label}
            </Link>
          ))}
        </nav>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">{children}</main>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-6 text-xs text-faint">
          <span>Vulcra — CDP stablecoin on Flare Coston2. Testnet only.</span>
          <span className="font-mono">Chain 114 · FXRP → vUSD</span>
        </div>
      </footer>
    </div>
  );
}
