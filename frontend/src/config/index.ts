// AppKit + wagmi configuration (KTD1 / U1). This module is imported by both the
// server layout and the client context provider, so it must NOT carry a
// 'use client' directive and must construct the adapter once at module scope.
import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";
import { flareTestnet } from "@reown/appkit/networks";
import type { AppKitNetwork } from "@reown/appkit/networks";
import { cookieStorage, createStorage, fallback, http } from "wagmi";

// `flareTestnet` in viem/AppKit IS Coston2 (chain id 114, native C2FLR).
// Verified at build time: @reown/appkit/networks exports it directly (A-6).
export const coston2 = flareTestnet;

// Coston2 RPCs, tried in order via a viem `fallback` transport. thirdweb's public
// endpoint is faster and handles concurrent bursts better than Flare's shared
// public RPC under load (benchmarked: 25 parallel reads in ~0.9s vs ~1.4s), so it
// leads; the Flare public RPC is the always-available fallback. Override the
// primary with NEXT_PUBLIC_COSTON2_RPC_URL.
const COSTON2_RPCS: string[] = [
  process.env.NEXT_PUBLIC_COSTON2_RPC_URL?.trim(),
  "https://flare-testnet-coston2.rpc.thirdweb.com",
  "https://coston2-api.flare.network/ext/C/rpc",
].filter((u): u is string => Boolean(u));

export const networks: [AppKitNetwork, ...AppKitNetwork[]] = [coston2];

// Gate: a real Reown Cloud project id is required for production wallet
// connection. We fall back to Reown's public localhost id so the build and
// local dev never break (documented in .env.example).
export const projectId =
  process.env.NEXT_PUBLIC_REOWN_PROJECT_ID?.trim() ||
  "b56e18d47c72ab683b10814fe9495694"; // localhost-only public id — replace in prod

export const isPlaceholderProjectId =
  !process.env.NEXT_PUBLIC_REOWN_PROJECT_ID?.trim();

export const metadata = {
  name: "Vulcra",
  description: "Forge dollars from your XRP — a CDP stablecoin on Flare.",
  url: "https://vulcra.xyz",
  icons: ["https://vulcra.xyz/icon.png"],
};

// SSR-safe adapter: cookie storage + ssr flag are required for Next.js App
// Router hydration without mismatches (KTD1 SSR checklist).
export const wagmiAdapter = new WagmiAdapter({
  networks,
  projectId,
  ssr: true,
  storage: createStorage({ storage: cookieStorage }),
  transports: {
    [coston2.id]: fallback(COSTON2_RPCS.map((url) => http(url))),
  },
});

export const wagmiConfig = wagmiAdapter.wagmiConfig;
