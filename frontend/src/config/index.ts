// AppKit + wagmi configuration (KTD1 / U1). This module is imported by both the
// server layout and the client context provider, so it must NOT carry a
// 'use client' directive and must construct the adapter once at module scope.
import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";
import { flareTestnet } from "@reown/appkit/networks";
import type { AppKitNetwork } from "@reown/appkit/networks";
import { cookieStorage, createStorage } from "wagmi";

// `flareTestnet` in viem/AppKit IS Coston2 (chain id 114, native C2FLR).
// Verified at build time: @reown/appkit/networks exports it directly (A-6).
export const coston2 = flareTestnet;

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
});

export const wagmiConfig = wagmiAdapter.wagmiConfig;
