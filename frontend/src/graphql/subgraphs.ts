// Goldsky subgraph endpoints per collateral branch. These are PUBLIC read endpoints
// (no auth key in the URL), committed as documented defaults with NEXT_PUBLIC_*
// overrides — the same pattern as the branch addresses in config/branches.ts.
//
// Only the FXRP branch has a subgraph today: `vulcra-vaults-fxrp`, fully synced on
// flare-coston2 (indexes the FXRP VaultManager 0x93e572cD…5388). wFLR has none yet,
// so the Liquidations page transparently falls back to the backend indexer for it.
import type { BranchKey } from "@/config/branches";

const env = (k: string) => process.env[k]?.trim() || "";

const DEFAULT_FXRP_SUBGRAPH =
  "https://api.goldsky.com/api/public/project_cmf7w213gukw101tb0u5m7760/subgraphs/vulcra-vaults-fxrp/1.0.0/gn";

const SUBGRAPH_URL: Record<BranchKey, string> = {
  fxrp: env("NEXT_PUBLIC_GOLDSKY_SUBGRAPH_FXRP") || DEFAULT_FXRP_SUBGRAPH,
  wflr: env("NEXT_PUBLIC_GOLDSKY_SUBGRAPH_WFLR") || "",
};

/** Goldsky GraphQL endpoint for a branch, or "" when none is configured (→ REST fallback). */
export function subgraphUrl(key: BranchKey): string {
  return SUBGRAPH_URL[key];
}
