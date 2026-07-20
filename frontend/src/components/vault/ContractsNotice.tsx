import { Info } from "lucide-react";

// Honest state for the pre-deploy window: the Vulcra core contracts are not yet
// live on Coston2, so vault reads/writes are unavailable. Live Flare data (FTSO)
// still works. Shown wherever a VaultManager address is required.
export function ContractsNotice() {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-ember-soft/50 bg-ember-soft/10 px-4 py-3">
      <Info className="mt-0.5 h-4 w-4 shrink-0 text-ember-bright" aria-hidden />
      <div className="text-sm text-muted">
        <span className="font-medium text-text">Vulcra core not yet deployed on Coston2.</span>{" "}
        Vault actions unlock once the VaultManager address is set
        (<code className="font-mono text-xs">NEXT_PUBLIC_VAULT_MANAGER_ADDRESS</code>).
        Live FTSO pricing is real and already working.
      </div>
    </div>
  );
}
