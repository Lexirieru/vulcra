"use client";

import { useEffect } from "react";
import type { Address } from "viem";
import { Button } from "@/components/ui";
import { useVaultAction } from "@/hooks/useVaultAction";

export function LiquidateButton({
  owner,
  vaultManager,
  liquidatable,
  onDone,
}: {
  owner: Address;
  vaultManager?: Address;
  liquidatable: boolean;
  onDone?: () => void;
}) {
  const action = useVaultAction(vaultManager);

  useEffect(() => {
    if (action.phase === "success") onDone?.();
  }, [action.phase, onDone]);

  return (
    <Button
      variant="danger"
      size="sm"
      disabled={!liquidatable || !action.configured || action.isBusy}
      title={
        !action.configured
          ? "VaultManager not deployed yet"
          : !liquidatable
            ? "Above MCR — not liquidatable"
            : undefined
      }
      onClick={() => action.execute("liquidate", [owner])}
    >
      {action.isBusy ? "Liquidating…" : "Liquidate"}
    </Button>
  );
}
