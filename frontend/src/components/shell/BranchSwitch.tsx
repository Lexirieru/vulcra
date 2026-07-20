"use client";

// Collateral branch selector (FXRP / wFLR). Drives every vault surface via the
// branch context. Persisted to localStorage by the provider.
import { Layers } from "lucide-react";
import { BRANCH_ORDER, BRANCHES } from "@/config/branches";
import { useBranch } from "@/context/branch";
import { cn } from "@/components/ui";

export function BranchSwitch() {
  const { branchKey, setBranchKey } = useBranch();

  return (
    <div className="flex items-center gap-2">
      <Layers className="h-4 w-4 text-faint" aria-hidden />
      <div
        className="flex rounded-lg border border-border bg-surface p-0.5"
        role="tablist"
        aria-label="Collateral branch"
      >
        {BRANCH_ORDER.map((key) => {
          const b = BRANCHES[key];
          const active = branchKey === key;
          return (
            <button
              key={key}
              role="tab"
              aria-selected={active}
              onClick={() => setBranchKey(key)}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                active ? "bg-surface-2 text-ember" : "text-muted hover:text-text",
              )}
            >
              {b.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
