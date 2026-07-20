"use client";

// Wrong-network guard: when a wallet is connected to anything other than
// Coston2 (114), prompt a one-click switch. Uses wagmi's own hooks.
import { useAccount, useSwitchChain } from "wagmi";
import { AlertTriangle } from "lucide-react";
import { COSTON2_CHAIN_ID } from "@/config/contracts";
import { Button } from "@/components/ui";

export function NetworkGuard() {
  const { isConnected, chainId } = useAccount();
  const { switchChain, isPending } = useSwitchChain();

  if (!isConnected || chainId === COSTON2_CHAIN_ID) return null;

  return (
    <div className="border-b border-warning/30 bg-warning/10">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-2.5">
        <p className="flex items-center gap-2 text-sm text-warning">
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
          Wrong network — Vulcra runs on Flare Coston2.
        </p>
        <Button
          variant="secondary"
          size="sm"
          disabled={isPending}
          onClick={() => switchChain({ chainId: COSTON2_CHAIN_ID })}
        >
          {isPending ? "Switching…" : "Switch to Coston2"}
        </Button>
      </div>
    </div>
  );
}
