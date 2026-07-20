import { defineChain } from "viem";

/** Flare Coston2 testnet. */
export const coston2 = defineChain({
  id: 114,
  name: "Flare Testnet Coston2",
  nativeCurrency: { name: "Coston2 Flare", symbol: "C2FLR", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://coston2-api.flare.network/ext/C/rpc"] },
  },
  blockExplorers: {
    default: { name: "Coston2 Explorer", url: "https://coston2-explorer.flare.network" },
  },
  testnet: true,
});

/** The ONLY hardcoded Flare system address. Everything else resolves via the registry. */
export const FLARE_CONTRACT_REGISTRY =
  "0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019" as const;

/**
 * XRP/USD FTSOv2 feed id (category 0x01 crypto).
 * VERIFY against dev.flare.network/ftso/feeds at build time before relying on it.
 */
export const XRP_USD_FEED_ID =
  "0x015852502f55534400000000000000000000000000" as const;

/** Registry contract-name keys. */
export const RegistryNames = {
  AssetManagerFXRP: "AssetManagerFXRP",
  FtsoV2: "FtsoV2",
  MasterAccountController: "MasterAccountController",
  FdcHub: "FdcHub",
  FdcVerification: "FdcVerification",
  Relay: "Relay",
} as const;
