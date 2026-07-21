"use client";

// EVM wallet connect (Reown AppKit → MetaMask / Rabby / WalletConnect). Three
// clear states: connect · connecting · connected (address chip). One button per
// context — the XRPL wallet connect lives on the /xrpl page.
import { useAppKit, useAppKitAccount } from "@reown/appkit/react";
import { Wallet } from "lucide-react";
import { Button } from "@/components/ui";
import { shortenAddress } from "@/lib/format";

export function ConnectButton() {
  const { open } = useAppKit();
  const { address, isConnected, status } = useAppKitAccount();
  const connecting = status === "connecting" || status === "reconnecting";

  if (isConnected && address) {
    return (
      <Button
        variant="secondary"
        size="sm"
        onClick={() => open()}
        aria-label="Manage EVM wallet"
        title={address}
      >
        <span className="h-2 w-2 rounded-full bg-healthy" aria-hidden />
        <span className="font-mono">{shortenAddress(address)}</span>
      </Button>
    );
  }

  return (
    <Button
      size="sm"
      onClick={() => open()}
      disabled={connecting}
      aria-label="Connect EVM wallet"
    >
      <Wallet className="h-4 w-4" aria-hidden />
      {connecting ? "Connecting…" : "Connect wallet"}
    </Button>
  );
}
