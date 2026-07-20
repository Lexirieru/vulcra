// Chain + contract-resolution constants (U2). Nothing here is a Flare *system*
// address except the ContractRegistry, which is the one stable, documented
// entry point — every other system contract is resolved at runtime via it.
import type { Address, Hex } from "viem";

export const COSTON2_CHAIN_ID = 114 as const;

// FlareContractRegistry — same address on every Flare network (verified).
// Docs: dev.flare.network. This is the only hardcoded system address allowed.
export const FLARE_CONTRACT_REGISTRY_ADDRESS =
  "0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019" as const satisfies Address;

// Names resolved through ContractRegistry.getContractAddressByName(name).
export const CONTRACT_NAMES = {
  ftsoV2: "FtsoV2",
  assetManagerFxrp: "AssetManagerFXRP",
  masterAccountController: "MasterAccountController",
} as const;

// XRP/USD block-latency feed id (bytes21). Verified value; re-confirm against
// dev.flare.network/ftso/feeds before any mainnet cutover.
export const XRP_USD_FEED_ID =
  "0x015852502f55534400000000000000000000000000" as const satisfies Hex;

// Optional deploy-time overrides for the Vulcra core contracts. Blank until the
// smartcontract plan deploys on Coston2 — see src/lib/contracts for how these
// are consumed and the placeholder-ABI seam.
export const VAULT_MANAGER_ADDRESS = (
  process.env.NEXT_PUBLIC_VAULT_MANAGER_ADDRESS?.trim() || ""
) as Address | "";
export const VUSD_ADDRESS = (
  process.env.NEXT_PUBLIC_VUSD_ADDRESS?.trim() || ""
) as Address | "";
export const PRICE_ORACLE_ADDRESS = (
  process.env.NEXT_PUBLIC_PRICE_ORACLE_ADDRESS?.trim() || ""
) as Address | "";

export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL?.trim() || "http://localhost:8787";
