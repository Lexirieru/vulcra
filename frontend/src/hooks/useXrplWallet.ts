"use client";

// Connect + sign with an injected XRPL browser wallet (Crossmark / GemWallet).
// No server API key. Holds the connected r-address and exposes signPayment for
// the backend-built Payment (0xFE memo preserved).
//
// Connecting state is PER PROVIDER (`connectingId`), not a shared boolean: with
// one flag both provider buttons rendered "Connecting…" and both went disabled
// as soon as either was clicked, which read as "Crossmark is stuck". Only the
// clicked provider shows progress now, and every exit path — success, failure,
// or the user dismissing the extension popup — clears it in `finally`.
//
// This hook is instantiated exactly once, by XrplWalletProvider (context/xrpl),
// so the drawer and the borrow flow share one connection.
import { useState } from "react";
import {
  XRPL_PROVIDERS,
  type XrplPaymentInput,
  type XrplProviderId,
} from "@/lib/xrpl/wallets";

export function useXrplWallet() {
  const [providerId, setProviderId] = useState<XrplProviderId | undefined>();
  const [address, setAddress] = useState<string | undefined>();
  /** The provider currently being connected, if any. */
  const [connectingId, setConnectingId] = useState<XrplProviderId | undefined>();
  const [signing, setSigning] = useState(false);
  const [error, setError] = useState<string | undefined>();

  async function connect(id: XrplProviderId): Promise<string | undefined> {
    // Ignore a second click while a connect is already in flight — the wallet
    // extension only shows one prompt at a time.
    if (connectingId) return undefined;
    setConnectingId(id);
    setError(undefined);
    try {
      const p = XRPL_PROVIDERS[id];
      if (!(await p.isInstalled())) {
        throw new Error(`${p.name} not detected — install the extension and reload.`);
      }
      const addr = await p.connect();
      setProviderId(id);
      setAddress(addr);
      return addr;
    } catch (e) {
      // A declined sign-in leaves the previous connection (if any) untouched.
      setError(e instanceof Error ? e.message : "Failed to connect XRPL wallet");
      return undefined;
    } finally {
      setConnectingId(undefined);
    }
  }

  async function signPayment(p: XrplPaymentInput): Promise<string | undefined> {
    if (!providerId || !address) {
      setError("No XRPL wallet connected");
      return undefined;
    }
    setSigning(true);
    setError(undefined);
    try {
      return await XRPL_PROVIDERS[providerId].signPayment(address, p);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Signing failed");
      return undefined;
    } finally {
      setSigning(false);
    }
  }

  function disconnect() {
    setProviderId(undefined);
    setAddress(undefined);
    setConnectingId(undefined);
    setError(undefined);
  }

  /** Dismiss the last connect/sign error (e.g. when the user retries). */
  function clearError() {
    setError(undefined);
  }

  return {
    providerId,
    address,
    /** Which provider is mid-connect — compare against a provider id. */
    connectingId,
    /** True while ANY provider is connecting (for aggregate UI only). */
    connecting: connectingId !== undefined,
    signing,
    error,
    connect,
    signPayment,
    disconnect,
    clearError,
  };
}
