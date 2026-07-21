"use client";

// Client provider tree (KTD1). createAppKit runs once at module scope; the
// WagmiProvider is hydrated from the SSR cookie so there is no mismatch.
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
    <WagmiProvider
      config={wagmiAdapter.wagmiConfig as Config}
      initialState={initialState}
    >
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
}
