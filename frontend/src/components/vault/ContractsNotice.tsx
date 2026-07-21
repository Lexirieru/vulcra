import { Info } from "lucide-react";
import type { CollateralBranch } from "@/config/branches";

// Honest state for a branch whose VaultManager isn't deployed yet (e.g. wFLR):
// vault reads/writes are unavailable, but live Flare data (FTSO) still works.
const ENV_VAR: Record<string, string> = {
  fxrp: "NEXT_PUBLIC_VAULT_MANAGER_FXRP",
  wflr: "NEXT_PUBLIC_VAULT_MANAGER_WFLR",
};

export function ContractsNotice({ branch }: { branch: CollateralBranch }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-warning/35 bg-warning/10 px-4 py-3">
      <Info className="mt-0.5 h-4 w-4 shrink-0 text-orange" aria-hidden />
      <div className="text-sm text-muted">
        <span className="font-medium text-ink">
          The {branch.label} branch is not deployed on Coston2 yet.
        </span>{" "}
        Its vault actions unlock once the VaultManager address is set
        (<code className="font-mono text-xs">{ENV_VAR[branch.key]}</code>). Live{" "}
        {branch.feedLabel} FTSO pricing is real and already working.
      </div>
    </div>
  );
}
