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
 * FTSOv2 feed ids (category 0x01 crypto). Feed decimals are DYNAMIC — always
 * read them from the feed at runtime; the per-branch `feedDecimals` is only a
 * documented hint. VERIFY against dev.flare.network/ftso/feeds at build time.
 */
export const XRP_USD_FEED_ID =
  "0x015852502f55534400000000000000000000000000" as const; // XRP/USD (feed 6 dec on Coston2)
export const FLR_USD_FEED_ID =
  "0x01464c522f55534400000000000000000000000000" as const; // FLR/USD (feed 8 dec on Coston2)

/** Registry contract-name keys. */
export const RegistryNames = {
  AssetManagerFXRP: "AssetManagerFXRP",
  FtsoV2: "FtsoV2",
  MasterAccountController: "MasterAccountController",
  FdcHub: "FdcHub",
  FdcVerification: "FdcVerification",
  Relay: "Relay",
  WNat: "WNat",
} as const;
