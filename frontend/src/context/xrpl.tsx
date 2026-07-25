"use client";

// Global XRPL wallet connection (Crossmark / GemWallet).
//
// The connect state used to live inside XrplMintFlow's own `useXrplWallet()`
// call, so connecting in the wallet sidebar and connecting on the mint page were
// two independent connections. Lifting the SAME hook into a provider makes it
// one source of truth app-wide: connect anywhere, see it everywhere, and sign
// the backend-built Payment from the mint flow with whatever wallet the user
// connected. Nothing about the hook's behaviour changes — this only moves where
// its state lives, so signing/flow semantics (0xFE memo verbatim) are untouched.
import { createContext, useContext, type ReactNode } from "react";
import { useXrplWallet } from "@/hooks/useXrplWallet";

export type XrplWalletContextValue = ReturnType<typeof useXrplWallet>;

const XrplWalletContext = createContext<XrplWalletContextValue | null>(null);

export function XrplWalletProvider({ children }: { children: ReactNode }) {
  const wallet = useXrplWallet();
  return (
    <XrplWalletContext.Provider value={wallet}>{children}</XrplWalletContext.Provider>
  );
}

/** The app-wide XRPL wallet. Throws outside <XrplWalletProvider>. */
export function useXrplWalletContext(): XrplWalletContextValue {
  const ctx = useContext(XrplWalletContext);
  if (!ctx) {
    throw new Error("useXrplWalletContext must be used within <XrplWalletProvider>");
  }
  return ctx;
}
