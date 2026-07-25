"use client";

// Open/close state for the right-side wallet drawer, lifted out of AppShell so
// ANY surface can raise it — the borrow page's XRP-Ledger mode offers "Open
// wallets" instead of duplicating a connect step.
//
// The state lives in this component (not in a child) so the route-change close
// can be a render-phase setState, which React only permits for the component
// that owns the state.
import { createContext, useContext, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";

interface WalletUiValue {
  walletsOpen: boolean;
  openWallets: () => void;
  closeWallets: () => void;
}

const WalletUiContext = createContext<WalletUiValue | null>(null);

export function WalletUiProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [walletsOpen, setWalletsOpen] = useState(false);

  const [lastPathname, setLastPathname] = useState(pathname);
  if (lastPathname !== pathname) {
    setLastPathname(pathname);
    setWalletsOpen(false);
  }

  const value: WalletUiValue = {
    walletsOpen,
    openWallets: () => setWalletsOpen(true),
    closeWallets: () => setWalletsOpen(false),
  };

  return <WalletUiContext.Provider value={value}>{children}</WalletUiContext.Provider>;
}

export function useWalletUi(): WalletUiValue {
  const ctx = useContext(WalletUiContext);
  if (!ctx) throw new Error("useWalletUi must be used within <WalletUiProvider>");
  return ctx;
}
