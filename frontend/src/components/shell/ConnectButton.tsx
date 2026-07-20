"use client";

import { useAppKit, useAppKitAccount } from "@reown/appkit/react";
import { Wallet } from "lucide-react";
import { Button } from "@/components/ui";
import { shortenAddress } from "@/lib/format";

export function ConnectButton() {
  const { open } = useAppKit();
  const { address, isConnected } = useAppKitAccount();

  return (
    <Button
      variant={isConnected ? "secondary" : "primary"}
      size="sm"
      onClick={() => open()}
      aria-label={isConnected ? "Manage wallet" : "Connect wallet"}
    >
      <Wallet className="h-4 w-4" aria-hidden />
      {isConnected ? shortenAddress(address) : "Connect wallet"}
    </Button>
  );
}
