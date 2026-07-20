"use client";

import { useEffect } from "react";
import type { Address } from "viem";
import { Button } from "@/components/ui";
import { useVaultAction } from "@/hooks/useVaultAction";

export function LiquidateButton({
  vault,
  liquidatable,
  onDone,
}: {
  vault: Address;
  liquidatable: boolean;
  onDone?: () => void;
}) {
  const action = useVaultAction();

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
      onClick={() => action.execute("liquidate", [vault])}
    >
      {action.isBusy ? "Liquidating…" : "Liquidate"}
    </Button>
  );
}
