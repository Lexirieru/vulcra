"use client";

// Client provider tree (KTD1). createAppKit runs once at module scope; the
// WagmiProvider is hydrated from the SSR cookie so there is no mismatch.
// Two wallets live side by side here: the EVM one (AppKit/wagmi, Coston2) and
// the XRPL one (XrplWalletProvider, Crossmark/GemWallet). They connect
// independently and can both be connected at the same time.
import { createAppKit } from "@reown/appkit/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { useState, type ReactNode } from "react";
import { cookieToInitialState, WagmiProvider, type Config } from "wagmi";
import {
  coston2,
  metadata,
  networks,
  projectId,
  wagmiAdapter,
} from "@/config";
import { WalletUiProvider } from "./wallet-ui";
import { XrplWalletProvider } from "./xrpl";

// AppKit's injected EVM connector calls the browser wallet's `connect()`. When
// two wallets fight over `window.ethereum` (Rabby installed alongside MetaMask)
// MetaMask's inpage script rejects with "MetaMask extension not found" during
// the eager reconnect — harmless here (users connect Rabby / WalletConnect for
// EVM and Crossmark for XRPL), and in a production build it is silently swallowed
// by the browser. But Next's DEV overlay hijacks the whole screen with it.
//
// Registered at MODULE SCOPE (not in an effect) so it is installed before the
// provider mounts and before wagmi's mount-time reconnect fires — an effect ran
// too late and missed the load-time rejection. Capture phase + swallow ONLY this
// one benign message; every other error still surfaces normally.
if (typeof window !== "undefined") {
  const isBenignWalletNoise = (msg: string) =>
    /metamask\s+(extension\s+)?not\s+found|failed\s+to\s+connect\s+to\s+metamask/i.test(
      msg,
    );
  window.addEventListener(
    "unhandledrejection",
    (e) => {
      const reason = e.reason as { message?: string } | string | undefined;
      const msg = typeof reason === "string" ? reason : (reason?.message ?? "");
      if (isBenignWalletNoise(msg)) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    },
    true,
  );
  window.addEventListener(
    "error",
    (e) => {
      if (isBenignWalletNoise(e.message || e.error?.message || "")) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    },
    true,
  );
}

createAppKit({
  adapters: [wagmiAdapter],
  networks,
  defaultNetwork: coston2,
  projectId,
  metadata,
  features: { analytics: false },
  themeMode: "light",
  themeVariables: {
    "--w3m-accent": "#e62058", // --color-brand — Vulcra pink
    "--w3m-border-radius-master": "2px",
  },
});

export default function ContextProvider({
  children,
  cookies,
}: {
  children: ReactNode;
  cookies: string | null;
}) {
  const [queryClient] = useState(() => new QueryClient());
  const initialState = cookieToInitialState(
    wagmiAdapter.wagmiConfig as Config,
    cookies,
  );

  return (
    // reconnectOnMount={false}: do NOT auto-reconnect the last EVM connector on
    // load. That mount-time reconnect is exactly what invokes the injected
    // wallet's connect() and triggers the MetaMask conflict rejection above. The
    // XRPL flow (Crossmark) is unaffected, and EVM users simply click connect
    // once per session — a fair trade for never crashing the page on load.
    <WagmiProvider
      config={wagmiAdapter.wagmiConfig as Config}
      initialState={initialState}
      reconnectOnMount={false}
    >
      <QueryClientProvider client={queryClient}>
        <XrplWalletProvider>
          <WalletUiProvider>{children}</WalletUiProvider>
        </XrplWalletProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
