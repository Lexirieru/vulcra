"use client";

// App shell: brand, collateral branch selector, primary EVM⇄XRPL mode switch,
// secondary nav, connect button, and the wrong-network guard. The XRPL mint mode
// only applies to branches that support it (FXRP); it is disabled otherwise.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Flame } from "lucide-react";
import { cn } from "@/components/ui";
import { useBranch } from "@/context/branch";
import { BranchSwitch } from "./BranchSwitch";
import { ConnectButton } from "./ConnectButton";
import { NetworkGuard } from "./NetworkGuard";

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
  const { branch } = useBranch();

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-40 border-b border-border bg-bg/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          {/* Left: brand + what you're looking at (collateral + interaction mode) */}
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="flex shrink-0 items-center gap-2 font-semibold tracking-tight"
            >
              <Flame className="h-5 w-5 text-ember" aria-hidden />
              <span className="text-lg">Vulcra</span>
            </Link>
            <span className="hidden h-6 w-px bg-border sm:block" aria-hidden />
            <BranchSwitch />
            <div
              className="hidden rounded-lg border border-border bg-surface p-0.5 sm:flex"
              role="tablist"
              aria-label="Interaction mode"
            >
              <Link
                href="/"
                role="tab"
                aria-selected={isActive(pathname, "/")}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
                  isActive(pathname, "/") ? "bg-ember text-bg" : "text-muted hover:text-text",
                )}
              >
                EVM
              </Link>
              {branch.hasXrplMint ? (
                <Link
                  href="/xrpl"
                  role="tab"
                  aria-selected={isActive(pathname, "/xrpl")}
                  className={cn(
                    "rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
                    isActive(pathname, "/xrpl") ? "bg-ember text-bg" : "text-muted hover:text-text",
                  )}
                >
                  XRPL
                </Link>
              ) : (
                <span
                  role="tab"
                  aria-disabled
                  title="XRPL-native mint is only available on the FXRP collateral"
                  className="cursor-not-allowed rounded-md px-3 py-1.5 text-sm font-medium text-faint"
                >
                  XRPL
                </span>
              )}
            </div>
          </div>

          {/* Right: section nav + wallet */}
          <div className="flex shrink-0 items-center gap-2">
            <nav className="hidden items-center gap-1 lg:flex" aria-label="Sections">
              {NAV.map((n) => (
                <Link
                  key={n.href}
                  href={n.href}
                  className={cn(
                    "rounded-md px-3 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
                    isActive(pathname, n.href) ? "text-ember" : "text-muted hover:text-text",
                  )}
                >
                  {n.label}
                </Link>
              ))}
            </nav>
            <ConnectButton />
          </div>
        </div>
        <NetworkGuard />
        <nav
          className="flex items-center gap-1 overflow-x-auto border-t border-border px-4 py-2 lg:hidden"
          aria-label="Sections"
        >
          <Link
            href="/"
            className={cn(
              "whitespace-nowrap rounded-md px-3 py-1.5 text-sm sm:hidden",
              isActive(pathname, "/") ? "text-ember" : "text-muted",
            )}
          >
            EVM
          </Link>
          {branch.hasXrplMint && (
            <Link
              href="/xrpl"
              className={cn(
                "whitespace-nowrap rounded-md px-3 py-1.5 text-sm sm:hidden",
                isActive(pathname, "/xrpl") ? "text-ember" : "text-muted",
              )}
            >
              XRPL
            </Link>
          )}
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
          <span>Vulcra — multi-collateral CDP stablecoin on Flare Coston2. Testnet only.</span>
          <span className="font-mono">Chain 114 · {branch.collateralSymbol} → vUSD</span>
        </div>
      </footer>
    </div>
  );
}
